// src/webhook の .ts を子プロセスで読み込み、結果だけを JSON で受け取るテスト用ハーネス。
// 方式は T060 で決めた（implementation-log.md）。テストプロセスへ tsx のローダーは登録しない。
// 子プロセスでは createRequire で CJS として読む（.ts は package.json の type が無いため CJS になる）。
// 1つのテストファイルは子プロセスを1回だけ起動し、複数の検査をまとめて実行する（起動時間を抑えるため）。
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const rootDir = fileURLToPath(new URL('../..', import.meta.url));

export const MAX_BODY_BYTES = 6291456;
export const DELIVERY_ID = '2f9b4c1e-7d3a-4b8e-9c21-5a6d7e8f9012';
// テスト用のダミー値。実際のWebhook Secretではない。
export const SIGNING_VALUE = 'dummy-signing-value-for-tests';
export const ROTATED_VALUE = 'dummy-rotated-value-for-tests';

const RUNNER = String.raw`
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const request = JSON.parse(readFileSync(0, 'utf8'));
const require = createRequire(request.rootDir + '/');
const crypto = require('node:crypto');

// timingSafeEqual の呼び出し回数を数える。モジュールは名前付き import で呼ぶため、差し替えが効く。
let timingCalls = 0;
const originalTimingSafeEqual = crypto.timingSafeEqual;
crypto.timingSafeEqual = (...args) => {
  timingCalls += 1;
  return originalTimingSafeEqual(...args);
};

const modulePath = (name) => request.rootDir + '/src/webhook/' + name;
const decode = (value) => {
  if (value && typeof value === 'object' && typeof value.$base64 === 'string') {
    return Buffer.from(value.$base64, 'base64');
  }
  return value;
};
const encode = function (key, value) {
  const original = this[key];
  return Buffer.isBuffer(original) ? { $base64: original.toString('base64') } : value;
};

let output;
if (request.mode === 'exports') {
  // 契約表の定数をそのまま返す。テストが clarify.md の表と突き合わせる。
  const values = {};
  for (const item of request.exports) {
    values[item.name] = require(modulePath(item.module))[item.name];
  }
  output = { values };
} else if (request.mode === 'batch') {
  const results = [];
  for (const call of request.calls) {
    const mod = require(modulePath(call.module));
    const before = timingCalls;
    try {
      const value = await mod[call.fn](...call.args.map(decode));
      results.push({ ok: true, value, timingSafeEqualCalls: timingCalls - before });
    } catch (error) {
      results.push({ ok: false, error: String(error && error.message), timingSafeEqualCalls: timingCalls - before });
    }
  }
  output = { results };
} else if (request.mode === 'dedupe') {
  const { createMemoryDedupeStore, reserveDelivery } = require(modulePath('dedupe.ts'));
  const memory = createMemoryDedupeStore();
  const storedKeys = [];
  const storedRecords = [];
  const store = {
    putIfAvailable: async (record, nowMs) => {
      storedKeys.push(Object.keys(record).sort());
      storedRecords.push({ ...record });
      return memory.putIfAvailable(record, nowMs);
    },
    markDone: (deliveryId, leaseUntil) => memory.markDone(deliveryId, leaseUntil),
    release: (deliveryId, leaseUntil) => memory.release(deliveryId, leaseUntil),
  };
  const results = [];
  for (const op of request.ops) {
    if (op.op === 'reserve') {
      results.push(await reserveDelivery(store, op.input));
    } else if (op.op === 'markDone') {
      try {
        await store.markDone(op.bodyDigest, op.leaseUntil);
        results.push({ ok: true });
      } catch (error) {
        results.push({ ok: false, error: String(error && error.message) });
      }
    } else if (op.op === 'release') {
      await store.release(op.bodyDigest, op.leaseUntil);
      results.push({ ok: true });
    }
  }
  output = { results, storedKeys, storedRecords };
} else if (request.mode === 'handler') {
  const { createWebhookHandler } = require(modulePath('handler-core.ts'));
  const { createMemoryDedupeStore } = require(modulePath('dedupe.ts'));
  const memory = createMemoryDedupeStore();

  // 1ステップごとに変わる入力。Secret、キューの失敗、done更新の失敗、キューの中での再入（同時受信）を指定する。
  const flags = {};
  const trace = { secretCalls: 0, handoffs: [], diagnostics: [], storedKeys: [], storeWrites: 0, reentrant: [] };
  let nowMs = request.startMs;
  let handler;

  const store = {
    putIfAvailable: async (record, now) => {
      trace.storedKeys.push(Object.keys(record).sort());
      if (flags.storeFailure) throw new Error('store detail');
      const result = await memory.putIfAvailable(record, now);
      if (result.written) trace.storeWrites += 1;
      return result;
    },
    markDone: async (deliveryId, leaseUntil) => {
      if (flags.failMarkDone) throw new Error('markDone failure detail');
      return memory.markDone(deliveryId, leaseUntil);
    },
    release: (deliveryId, leaseUntil) => memory.release(deliveryId, leaseUntil),
  };
  const secrets = {
    getSigningSecrets: async () => {
      trace.secretCalls += 1;
      if (flags.secretUnavailable) throw new Error('secret store detail');
      return flags.secrets ?? request.secrets;
    },
  };
  const queue = {
    send: async (message) => {
      if (flags.handoffFail) throw new Error('queue detail');
      trace.handoffs.push(message);
      if (flags.reenter) {
        const event = flags.reenter;
        flags.reenter = null;
        trace.reentrant.push(await handler(event));
      }
    },
  };
  const clock = { nowMs: () => nowMs };
  const diagnostics = { write: (line) => trace.diagnostics.push(line) };
  handler = createWebhookHandler({
    secrets,
    store,
    queue,
    clock,
    diagnostics,
    maxBodyBytes: request.maxBodyBytes ?? 6291456,
    leaseSeconds: 3,
  });

  const steps = [];
  for (const step of request.steps) {
    nowMs = step.nowMs ?? nowMs;
    for (const key of Object.keys(flags)) delete flags[key];
    Object.assign(flags, step.flags ?? {});
    const before = {
      secretCalls: trace.secretCalls,
      handoffs: trace.handoffs.length,
      diagnostics: trace.diagnostics.length,
      timing: timingCalls,
    };
    const response = await handler(step.event);
    steps.push({
      statusCode: response.statusCode,
      body: response.body,
      secretCalls: trace.secretCalls - before.secretCalls,
      handoffs: trace.handoffs.length - before.handoffs,
      diagnostics: trace.diagnostics.slice(before.diagnostics),
      timingSafeEqualCalls: timingCalls - before.timing,
    });
  }
  output = {
    steps,
    handoffs: trace.handoffs,
    secretCalls: trace.secretCalls,
    diagnostics: trace.diagnostics,
    storedKeys: trace.storedKeys,
    storeWrites: trace.storeWrites,
    reentrant: trace.reentrant,
  };
}

process.stdout.write(JSON.stringify(output, encode));
`;

// 子プロセスの結果をJSONで受け取る。失敗（例外、終了コード0以外）はテストの失敗として扱う。
// 標準エラーも返す。T023 で、拒否と例外の経路で標準エラーに秘密が出ないことを検査するため。
export function runInChildWithStderr(request) {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', RUNNER],
    {
      cwd: rootDir,
      input: JSON.stringify({ rootDir, ...request }),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`child process failed with status ${child.status}: ${child.stderr}`);
  }
  return { value: JSON.parse(child.stdout), stderr: child.stderr };
}

export function runInChild(request) {
  return runInChildWithStderr(request).value;
}

// 署名ヘッダーの値。テストの入力を作るための計算で、実際の検証とは別の経路。
export function signatureFor(bodyBytes, signingValue) {
  return `sha256=${createHmac('sha256', signingValue).update(bodyBytes).digest('hex')}`;
}

export function signedHeaders({
  bodyBytes,
  event = 'workflow_job',
  delivery = DELIVERY_ID,
  signingValue = SIGNING_VALUE,
}) {
  return {
    'content-type': 'application/json',
    'x-github-event': event,
    'x-github-delivery': delivery,
    'x-hub-signature-256': signatureFor(bodyBytes, signingValue),
  };
}

// 本文の文字列を、署名と同じバイト列を基準にしてイベントを作る。base64 のときは本文をバイト列へ戻して署名する。
export function makeEvent({ text, base64 = false, headers, requestId = 'request-test-0001' }) {
  const bytes = base64 ? Buffer.from(text, 'base64') : Buffer.from(text, 'utf8');
  return {
    event: {
      body: text,
      isBase64Encoded: base64,
      headers,
      requestContext: { requestId },
    },
    bytes,
  };
}

export const NOW_MS = Date.UTC(2026, 10, 3, 5, 24, 5);
export const DAY_MS = 24 * 60 * 60 * 1000;

export function iso(ms) {
  return new Date(ms).toISOString();
}

export function jsonText(payload = workflowJobPayload({ createdAt: iso(NOW_MS - 60_000) })) {
  return JSON.stringify(payload);
}

// 署名つきのリクエストを作る。ヘッダーを上書きまたは削除して不正な入力を作れる。
export function buildRequest({
  text = jsonText(),
  base64 = false,
  event = 'workflow_job',
  delivery = DELIVERY_ID,
  signingValue = SIGNING_VALUE,
  headers: overrides = {},
  dropHeaders = [],
} = {}) {
  const bodyBytes = base64 ? Buffer.from(text, 'base64') : Buffer.from(text, 'utf8');
  const headers = { ...signedHeaders({ bodyBytes, event, delivery, signingValue }), ...overrides };
  for (const name of dropHeaders) delete headers[name];
  return {
    body: text,
    isBase64Encoded: base64,
    headers,
    requestContext: { requestId: 'request-test-0001' },
  };
}

export function workflowJobPayload({
  action = 'queued',
  createdAt,
  startedAt,
  completedAt,
  installation,
  organization,
  omit = [],
} = {}) {
  const job = {
    id: 1001,
    run_id: 2001,
    labels: ['self-hosted', 'linux'],
    status: action === 'completed' ? 'completed' : 'queued',
    created_at: createdAt,
    started_at: startedAt,
    completed_at: completedAt,
  };
  const payload = {
    action,
    workflow_job: job,
    repository: { id: 3001, full_name: 'example-org/example-repo' },
    installation: installation === undefined ? { id: 4001 } : installation,
    organization: organization === undefined ? { login: 'example-org' } : organization,
  };
  for (const key of omit) {
    if (key.startsWith('job.')) delete job[key.slice(4)];
    else delete payload[key];
  }
  return payload;
}
