// アダプター（SDKのクライアントを使う層）の契約テスト用のハーネス。
// SDKのクライアントは、子プロセスの中で作る偽物（fake）に差し替える。実AWSには接続しない。
// 偽物の send は、実際の SDK のコマンドクラス（入力の形を含む）を受け取り、呼び出しを記録する。
// 子プロセスの環境は最小にする（AWS の認証に関係する変数を渡さないため）。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const rootDir = fileURLToPath(new URL('../..', import.meta.url));

// 1回の実行で、ops を順に実行する。各 op の結果と、偽物の呼び出し記録を返す。
// op の種類:
//   fake    : 偽物のクライアントを作る（kind は secrets | dynamo | sqs）
//   configure: 偽物の振る舞いを変える（ローテーションの途中、送信失敗など）
//   clock   : 注入する時計の値を設定する
//   exports : モジュールの export を値として返す（契約の定数を読むため）
//   require : モジュールを読み込む（トップレベルの例外も結果に含める）
//   call    : export された関数を呼ぶ。store を指定すると結果のオブジェクトを保存する
//   invoke  : 保存したオブジェクトのメソッドを呼ぶ
//   apply   : 保存した関数を呼ぶ
// 引数の { $ref: id } は、保存された偽物かオブジェクトに置き換える。
const RUNNER = String.raw`
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const request = JSON.parse(readFileSync(0, 'utf8'));
const require = createRequire(request.rootDir + '/');
const modulePath = (name) => request.rootDir + '/src/webhook/' + name;

// 子プロセスの標準出力は結果のJSONに使うため、アプリの診断ログは配列に集める。
const logs = [];
console.log = (...parts) => {
  logs.push(parts.map((part) => String(part)).join(' '));
};

const objects = new Map();
const calls = {};
const fakeConfigs = {};
// 式の文字列はアダプターの定数をそのまま使う。テストの側に式を書き写さないため。
const expressions = require(modulePath('dedupe-dynamodb.ts'));

const resolve = (value) => {
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === 'object') {
    if (typeof value.$ref === 'string') return objects.get(value.$ref);
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = resolve(item);
    return out;
  }
  return value;
};

const failure = (name, message) => {
  const error = new Error(message);
  error.name = name;
  return error;
};

// Secrets Manager の偽物。stages に無い版は ResourceNotFoundException にする（実際の振る舞いと同じ）。
const secretsFake = (id) => ({
  send: async (command) => {
    calls[id].push({ name: command.constructor.name, input: command.input });
    const config = fakeConfigs[id];
    const stage = command.input.VersionStage;
    if (config.failAll) throw failure('InternalServiceError', 'fake failure');
    if (config.failStages.includes(stage)) throw failure('AccessDeniedException', 'denied');
    const value = config.stages[stage];
    if (value === undefined || value === null) {
      throw failure('ResourceNotFoundException', 'version not found');
    }
    return { SecretString: value };
  },
});

// DynamoDB の偽物。送られる式は、アダプターが定義した式だけを評価する。
// 知らない式や知らないコマンドは例外にし、アダプターが想定外の操作をしたことを検出する。
// 注意: これは式の意味を再現した簡易な評価器。実際の DynamoDB の評価は Ministack（T044）で確認する。
const dynamoFake = (id) => {
  const items = new Map();
  const attr = (value) => (value.S !== undefined ? value.S : Number(value.N));
  const leaseMatches = (existing, values) =>
    existing !== undefined &&
    existing.state.S === 'processing' &&
    existing.leaseUntil.N === values[':leaseUntil'].N;

  return {
    send: async (command) => {
      const name = command.constructor.name;
      const input = command.input;
      calls[id].push({ name, input });
      if (name === 'PutItemCommand') {
        if (input.ConditionExpression !== expressions.RESERVE_CONDITION_EXPRESSION) {
          throw failure('UnexpectedExpression', 'unknown condition for PutItem');
        }
        const values = input.ExpressionAttributeValues;
        const key = input.Item.bodyDigest.S;
        const existing = items.get(key);
        const nowSeconds = Number(values[':nowSeconds'].N);
        const nowMs = Number(values[':nowMs'].N);
        const available =
          existing === undefined ||
          attr(existing.expiresAt) < nowSeconds ||
          (existing.state.S === 'processing' && attr(existing.leaseUntil) < nowMs);
        if (!available) {
          const error = failure('ConditionalCheckFailedException', 'condition failed');
          if (input.ReturnValuesOnConditionCheckFailure === 'ALL_OLD') error.Item = existing;
          throw error;
        }
        items.set(key, input.Item);
        return {};
      }
      if (name === 'UpdateItemCommand') {
        if (input.ConditionExpression !== expressions.LEASE_MATCH_CONDITION_EXPRESSION) {
          throw failure('UnexpectedExpression', 'unknown condition for UpdateItem');
        }
        if (input.UpdateExpression !== 'SET #state = :done') {
          throw failure('UnexpectedExpression', 'unknown update expression');
        }
        const key = input.Key.bodyDigest.S;
        const existing = items.get(key);
        if (!leaseMatches(existing, input.ExpressionAttributeValues)) {
          throw failure('ConditionalCheckFailedException', 'lease does not match');
        }
        existing.state = { S: 'done' };
        return {};
      }
      if (name === 'DeleteItemCommand') {
        if (input.ConditionExpression !== expressions.LEASE_MATCH_CONDITION_EXPRESSION) {
          throw failure('UnexpectedExpression', 'unknown condition for DeleteItem');
        }
        const key = input.Key.bodyDigest.S;
        const existing = items.get(key);
        if (!leaseMatches(existing, input.ExpressionAttributeValues)) {
          throw failure('ConditionalCheckFailedException', 'lease does not match');
        }
        items.delete(key);
        return {};
      }
      throw failure('UnexpectedCommand', 'command not allowed by the adapter contract: ' + name);
    },
  };
};

// SQS の偽物。failNext が真なら次の送信を失敗させる。
const sqsFake = (id) => ({
  send: async (command) => {
    calls[id].push({ name: command.constructor.name, input: command.input });
    if (fakeConfigs[id].failNext) {
      fakeConfigs[id].failNext = false;
      throw failure('ServiceUnavailable', 'fake send failure');
    }
    return { MessageId: 'fake-message-id' };
  },
});

const fakes = { secrets: secretsFake, dynamo: dynamoFake, sqs: sqsFake };
const clockValues = {};

const runOp = async (op) => {
  if (op.op === 'fake') {
    if (!fakes[op.kind]) throw new Error('unknown fake kind');
    calls[op.id] = [];
    fakeConfigs[op.id] = { ...(fakeConfigs[op.id] ?? {}), ...(op.config ?? {}) };
    const client = fakes[op.kind](op.id);
    objects.set(op.id, client);
    return { ok: true };
  }
  if (op.op === 'configure') {
    Object.assign(fakeConfigs[op.id], op.config);
    return { ok: true };
  }
  if (op.op === 'clock') {
    clockValues[op.id] = op.nowMs;
    objects.set(op.id, { nowMs: () => clockValues[op.id] });
    return { ok: true };
  }
  if (op.op === 'exports') {
    const mod = require(modulePath(op.module));
    const values = {};
    for (const name of op.names) values[name] = mod[name];
    return { ok: true, value: values };
  }
  if (op.op === 'require') {
    require(modulePath(op.module));
    return { ok: true };
  }
  if (op.op === 'call') {
    const mod = require(modulePath(op.module));
    const value = await mod[op.fn](...resolve(op.args ?? []));
    if (op.store) objects.set(op.store, value);
    return { ok: true, value };
  }
  if (op.op === 'apply') {
    // 保存した関数（createLambdaHandler が返すハンドラー）を呼ぶ。
    const value = await objects.get(op.target)(...resolve(op.args ?? []));
    return { ok: true, value };
  }
  if (op.op === 'invoke') {
    const target = objects.get(op.target);
    const value = await target[op.method](...resolve(op.args ?? []));
    return { ok: true, value };
  }
  throw new Error('unknown op: ' + op.op);
};

const results = [];
for (const op of request.ops) {
  try {
    results.push(await runOp(op));
  } catch (error) {
    results.push({
      ok: false,
      name: error && error.name,
      message: String(error && error.message),
    });
  }
}
process.stdout.write(JSON.stringify({ results, calls, logs }));
`;

export function runOps(ops, { env = {} } = {}) {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', RUNNER],
    {
      cwd: rootDir,
      input: JSON.stringify({ rootDir, ops }),
      encoding: 'utf8',
      // AWS の認証に関係する環境変数は渡さない。テストに必要な値だけを env で指定する。
      env: { PATH: process.env.PATH, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`adapter child exited with ${child.status}: ${child.stderr}`);
  }
  return JSON.parse(child.stdout);
}
