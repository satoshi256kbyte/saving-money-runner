import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  MAX_BODY_BYTES,
  NOW_MS,
  ROTATED_VALUE,
  SIGNING_VALUE,
  buildRequest,
  iso,
  jsonText,
  runInChild,
  runInChildWithStderr,
  workflowJobPayload,
} from './support/webhook-harness.mjs';

// 契約テスト（T011、T020〜T026）。ハンドラーはメモリ実装のポートに差し替えて動かす。
// 1つの子プロセスで、関連する入力をまとめて順に通す。各ステップは前のステップの重複排除の状態を引き継ぐ。

const clarifyUrl = new URL('../specs/003-webhook-receiver/clarify.md', import.meta.url);
const deliveryId = (n) => `00000000-0000-4000-8000-a${String(n).padStart(11, '0')}`; // 末尾に英字を含め、12桁の数字だけの並びを作らない（公開情報の検査）。
const ALLOWED_DIAGNOSTIC_KEYS = [
  'classification',
  'status',
  'deliveryId',
  'durationMs',
  'requestId',
];
const HANDOFF_KEYS = [
  'action',
  'bodyDigest',
  'deliveryId',
  'event',
  'installationId',
  'jobId',
  'labels',
  'organizationLogin',
  'receivedAt',
  'repositoryFullName',
  'repositoryId',
  'runId',
  'schemaVersion',
  'status',
];

function handlerRun(steps, extra = {}) {
  return runInChild({
    mode: 'handler',
    startMs: NOW_MS,
    secrets: [SIGNING_VALUE],
    steps,
    ...extra,
  });
}

const classOf = (step) => JSON.parse(step.body).classification;
const diagOf = (step) => step.diagnostics.map((line) => JSON.parse(line));
const freshPayload = (extra = {}) =>
  workflowJobPayload({ createdAt: iso(NOW_MS - 60_000), ...extra });
// 配信ごとに本文を変える。重複排除は本文のダイジェストで判定するため、同じ本文の別配信は重複になる。
// 同じ配信の再受信だけは、同じ GUID と同じ本文で作る。
const bodyOf = (n) => {
  const payload = freshPayload();
  payload.workflow_job.id = 2000 + n;
  return jsonText(payload);
};

// T011: 契約表の定数が clarify.md の表と一致することを機械的に検査する。
function parseClarifyContractTable(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith('| 順 | 検査 |'));
  assert.notEqual(start, -1, 'clarify.md に契約表の見出しが無い');
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i += 1) {
    const cells = lines[i]
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    rows.push({
      label: cells[0],
      // 行 1a は順1の内部の判定なので、検査順の番号は 1 とする。
      step: Number.parseInt(cells[0], 10),
      statuses: [...cells[2].matchAll(/\d{3}/gu)].map((match) => Number(match[0])),
      classifications: [...cells[3].matchAll(/`([a-z_]+)`/gu)].map((match) => match[1]),
    });
  }
  return rows;
}

const clarifyRows = parseClarifyContractTable(readFileSync(clarifyUrl, 'utf8'));
const contract = runInChild({
  mode: 'exports',
  exports: [{ module: 'contract.ts', name: 'RESPONSE_CONTRACT' }],
}).values.RESPONSE_CONTRACT;

test('T011: clarify.md の契約表は14行で、順1〜13と、順1の内部の行 1a が並ぶ（判断2）', () => {
  assert.equal(clarifyRows.length, 14);
  assert.deepEqual(
    clarifyRows.map((row) => row.label),
    ['1', '1a', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'],
  );
});

test('T011: 各行の分類とステータスが契約の定数と一致する（同じ行の複数の分類は順に対応づける）', () => {
  for (const row of clarifyRows) {
    const pairs =
      row.statuses.length === row.classifications.length
        ? row.classifications.map((classification, index) => [classification, row.statuses[index]])
        : row.classifications.map((classification) => [classification, row.statuses[0]]);
    for (const [classification, status] of pairs) {
      assert.ok(contract[classification], `契約に無い分類: ${classification}`);
      assert.equal(contract[classification].status, status, `ステータス: ${classification}`);
      assert.ok(contract[classification].steps.includes(row.step), `順: ${classification}`);
    }
  }
});

test('T011: 契約の分類は、clarify.md の表の分類に、表に無い2件（署名欠落、想定外の例外）を足したものと一致する', () => {
  const fromTable = new Set(clarifyRows.flatMap((row) => row.classifications));
  const expected = new Set([...fromTable, 'signature_missing', 'internal_error']);
  assert.deepEqual(new Set(Object.keys(contract)), expected);
});

// T020: 正常系。
const happyPayload = freshPayload();
// 署名の対象は受信したバイト列そのもの。値を変えず空白だけ変えた本文でも通ることを確認する。
const spacedText = JSON.stringify(happyPayload, null, 2);
const base64Text = Buffer.from(
  jsonText(freshPayload({ installation: { id: 4002 } })),
  'utf8',
).toString('base64');

const happy = handlerRun([
  { event: buildRequest({ text: spacedText, delivery: deliveryId(1) }) },
  { event: buildRequest({ text: base64Text, base64: true, delivery: deliveryId(2) }) },
]);

test('T020: 正しい署名の workflow_job は202 accepted になり、引き渡しは1回ずつ', () => {
  assert.equal(happy.steps[0].statusCode, 202, happy.steps[0].body);
  assert.equal(classOf(happy.steps[0]), 'accepted');
  assert.equal(happy.steps[0].handoffs, 1);
  assert.equal(happy.steps[1].statusCode, 202, happy.steps[1].body);
  assert.equal(happy.steps[1].handoffs, 1);
  assert.equal(happy.handoffs.length, 2);
});

test('T020: 後続メッセージは許可リストの項目だけを持つ（bodyの他の項目を含まない）', () => {
  for (const message of happy.handoffs) {
    assert.deepEqual(Object.keys(message).sort(), HANDOFF_KEYS);
    assert.equal(message.schemaVersion, 1);
    assert.equal(message.event, 'workflow_job');
  }
  assert.equal(happy.handoffs[0].deliveryId, deliveryId(1));
  assert.equal(happy.handoffs[1].installationId, 4002);
});

test('T020: 成功の診断が1行だけ記録され、許可されたキーだけを持つ', () => {
  const diagnostics = diagOf(happy.steps[0]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].classification, 'accepted');
  assert.equal(diagnostics[0].status, 202);
  assert.equal(diagnostics[0].deliveryId, deliveryId(1));
  assert.deepEqual(Object.keys(diagnostics[0]).sort(), [
    'classification',
    'deliveryId',
    'durationMs',
    'requestId',
    'status',
  ]);
});

// T021: 拒否系。いずれも引き渡し0回。Secret取得の回数は、順6より前で拒否したものは0回にする。
const rejectionCases = [
  {
    name: '署名ヘッダーの欠落',
    input: { dropHeaders: ['x-hub-signature-256'] },
    status: 401,
    classification: 'signature_missing',
    secretCalls: 0,
  },
  {
    name: '署名ヘッダーの形式不正',
    input: { headers: { 'x-hub-signature-256': 'sha256=zz' } },
    status: 401,
    classification: 'signature_malformed',
    secretCalls: 0,
  },
  {
    name: '署名の不一致',
    input: { signingValue: 'wrong-value-for-tests' },
    status: 401,
    classification: 'signature_mismatch',
    secretCalls: 1,
  },
  {
    name: '時刻が3日を超えて古い配信',
    input: {
      text: jsonText(
        freshPayload({ action: 'queued', createdAt: iso(NOW_MS - 4 * 24 * 3600_000) }),
      ),
    },
    status: 400,
    classification: 'expired',
    secretCalls: 1,
  },
  {
    name: '対象外のイベント',
    input: { event: 'issues' },
    status: 400,
    classification: 'event_not_allowed',
    secretCalls: 0,
  },
  {
    name: '配信IDの欠落',
    input: { dropHeaders: ['x-github-delivery'] },
    status: 400,
    classification: 'delivery_id_invalid',
    secretCalls: 0,
  },
  {
    name: '配信IDの形式不正',
    input: { delivery: 'not-a-guid' },
    status: 400,
    classification: 'delivery_id_invalid',
    secretCalls: 0,
  },
  {
    name: 'Content-Type の不一致',
    input: { headers: { 'content-type': 'text/plain' } },
    status: 415,
    classification: 'unsupported_media_type',
    secretCalls: 0,
  },
  {
    name: '署名は正しいがJSONとして不正',
    input: { text: '{"workflow_job": ' },
    status: 400,
    classification: 'payload_invalid',
    secretCalls: 1,
  },
  {
    name: '署名は正しいが repository が無い',
    input: { text: jsonText(freshPayload({ omit: ['repository'] })) },
    status: 400,
    classification: 'payload_invalid',
    secretCalls: 1,
  },
  {
    name: '上限を1バイト超える本文（署名検証より前に拒否）',
    input: { text: 'a'.repeat(MAX_BODY_BYTES + 1) },
    status: 413,
    classification: 'payload_too_large',
    secretCalls: 0,
  },
  // 判断2: 不正な base64 は順1の内部で 400 payload_invalid にする（clarify.md の行 1a）。
  {
    name: '不正な base64（長さが4の倍数でない）',
    input: { text: 'abc', base64: true },
    status: 400,
    classification: 'payload_invalid',
    secretCalls: 0,
  },
  {
    name: '不正な base64（base64の文字以外を含む）',
    input: { text: 'ab!d', base64: true },
    status: 400,
    classification: 'payload_invalid',
    secretCalls: 0,
  },
];

const rejected = handlerRun(
  rejectionCases.map((c) => ({ event: buildRequest(c.input) })),
  {},
);

for (const [index, c] of rejectionCases.entries()) {
  test(`T021: ${c.name} は ${c.status} ${c.classification} で拒否し、引き渡しをしない`, () => {
    const step = rejected.steps[index];
    assert.equal(step.statusCode, c.status, step.body);
    assert.equal(classOf(step), c.classification);
    assert.equal(step.handoffs, 0);
    assert.equal(step.secretCalls, c.secretCalls);
  });
}

test('T021: 拒否したいずれの入力でも引き渡しが0回で、重複排除に記録されない', () => {
  assert.equal(rejected.handoffs.length, 0);
  assert.equal(rejected.storeWrites, 0);
});

test('T021: Secret取得の失敗（不在、権限なし）は503 secret_unavailable で拒否し、引き渡しをしない', () => {
  const run = handlerRun([
    { event: buildRequest({ delivery: deliveryId(30) }), flags: { secretUnavailable: true } },
  ]);
  assert.equal(run.steps[0].statusCode, 503);
  assert.equal(classOf(run.steps[0]), 'secret_unavailable');
  assert.equal(run.steps[0].handoffs, 0);
  assert.equal(run.handoffs.length, 0);
});

// T022: 再試行系と重複。同じ配信IDの扱いと、確保の解放を検査する。
const retryRun = handlerRun([
  // 0: 初回は受理する
  { event: buildRequest({ text: bodyOf(40), delivery: deliveryId(40) }) },
  // 1: 処理済みの再受信は200 duplicate。引き渡しは増えない
  { event: buildRequest({ text: bodyOf(40), delivery: deliveryId(40) }) },
  // 2: 引き渡し中に同じ配信が届く。内側の試行は処理中として503 duplicate_in_flight
  {
    event: buildRequest({ text: bodyOf(41), delivery: deliveryId(41) }),
    flags: { reenter: buildRequest({ text: bodyOf(41), delivery: deliveryId(41) }) },
  },
  // 3: 引き渡し失敗で503 handoff_failed。確保は解放される
  {
    event: buildRequest({ text: bodyOf(42), delivery: deliveryId(42) }),
    flags: { handoffFail: true },
  },
  // 4: 解放されたので、同じ配信IDは新規として受理される
  { event: buildRequest({ text: bodyOf(42), delivery: deliveryId(42) }) },
  // 5: done の更新が失敗したら、確保を解放して503 handoff_failed
  {
    event: buildRequest({ text: bodyOf(43), delivery: deliveryId(43) }),
    flags: { failMarkDone: true },
  },
  // 6: 解放されたので、同じ配信IDは再試行で受理される（引き渡しは2回になりうる。Issue #5が冪等に処理する）
  { event: buildRequest({ text: bodyOf(43), delivery: deliveryId(43) }) },
  // 7: 想定外の例外（重複排除の書込みが失敗）は500 internal_error
  {
    event: buildRequest({ text: bodyOf(44), delivery: deliveryId(44) }),
    flags: { storeFailure: true },
  },
]);

test('T022: 初回は202、同じ配信IDの再受信は200 duplicate で、引き渡しは増えない', () => {
  assert.equal(retryRun.steps[0].statusCode, 202);
  assert.equal(retryRun.steps[1].statusCode, 200);
  assert.equal(classOf(retryRun.steps[1]), 'duplicate');
  assert.equal(retryRun.steps[1].handoffs, 0);
});

test('T022: 処理中の重複は503 duplicate_in_flight になり、外側の試行は202で完了する', () => {
  assert.equal(retryRun.steps[2].statusCode, 202, retryRun.steps[2].body);
  assert.equal(retryRun.reentrant.length, 1);
  assert.equal(retryRun.reentrant[0].statusCode, 503);
  assert.equal(JSON.parse(retryRun.reentrant[0].body).classification, 'duplicate_in_flight');
});

test('T022: 引き渡し失敗は503 handoff_failed で、解放後の同じ配信IDは重複扱いにならない', () => {
  assert.equal(retryRun.steps[3].statusCode, 503);
  assert.equal(classOf(retryRun.steps[3]), 'handoff_failed');
  assert.equal(retryRun.steps[4].statusCode, 202);
  assert.equal(classOf(retryRun.steps[4]), 'accepted');
});

test('T022: done の更新の失敗は503 handoff_failed になり、同じ配信IDは次の再試行で受理される', () => {
  assert.equal(retryRun.steps[5].statusCode, 503);
  assert.equal(classOf(retryRun.steps[5]), 'handoff_failed');
  assert.equal(retryRun.steps[5].handoffs, 1);
  assert.equal(retryRun.steps[6].statusCode, 202);
});

test('T022: 想定外の例外は500 internal_error で、引き渡しをしない', () => {
  assert.equal(retryRun.steps[7].statusCode, 500);
  assert.equal(classOf(retryRun.steps[7]), 'internal_error');
  assert.equal(retryRun.steps[7].handoffs, 0);
});

test('T022: 成功、重複、処理中、引き渡し失敗、想定外の例外、署名欠落の分類は互いに区別できる', () => {
  const classes = [
    classOf(retryRun.steps[0]),
    classOf(retryRun.steps[1]),
    JSON.parse(retryRun.reentrant[0].body).classification,
    classOf(retryRun.steps[3]),
    classOf(retryRun.steps[7]),
    classOf(rejected.steps[0]),
  ];
  assert.deepEqual(classes, [
    'accepted',
    'duplicate',
    'duplicate_in_flight',
    'handoff_failed',
    'internal_error',
    'signature_missing',
  ]);
});

// T023: 検査の順序とログの安全性。
const BODY_MARKER = 'body-marker-7f3a9c';
const markedPayload = freshPayload({ omit: [] });
markedPayload.note = BODY_MARKER;

const orderRun = runInChildWithStderr({
  mode: 'handler',
  startMs: NOW_MS,
  secrets: [SIGNING_VALUE],
  steps: [
    // 複数の不正があるとき、先の順の分類を返す
    {
      event: buildRequest({
        text: 'a'.repeat(MAX_BODY_BYTES + 1),
        headers: { 'content-type': 'text/plain' },
        dropHeaders: ['x-hub-signature-256'],
      }),
    },
    {
      event: buildRequest({
        headers: { 'content-type': 'text/plain' },
        signingValue: 'wrong-value-for-tests',
      }),
    },
    // 署名の検査は JSON の検査より先
    { event: buildRequest({ text: '{ broken', signingValue: 'wrong-value-for-tests' }) },
    // 署名の検査は期限の検査より先（期限切れで不一致なら401）
    {
      event: buildRequest({
        text: jsonText(freshPayload({ createdAt: iso(NOW_MS - 4 * 24 * 3600_000) })),
        signingValue: 'wrong-value-for-tests',
      }),
    },
    // 秘密、ヘッダー、本文の内容が、拒否と例外のどちらの経路にも出ない
    {
      event: buildRequest({ text: jsonText(markedPayload), delivery: deliveryId(60) }),
      flags: { secretUnavailable: true },
    },
    {
      event: buildRequest({ text: jsonText(markedPayload), delivery: deliveryId(61) }),
      flags: { handoffFail: true },
    },
    {
      event: buildRequest({ text: jsonText(markedPayload), delivery: deliveryId(62) }),
      flags: { failMarkDone: true },
    },
    {
      event: buildRequest({ text: jsonText(markedPayload), delivery: deliveryId(63) }),
      flags: { storeFailure: true },
    },
    {
      event: buildRequest({ text: jsonText(markedPayload), signingValue: 'wrong-value-for-tests' }),
    },
  ],
});

const orderResult = orderRun.value;

test('T023: 複数の不正があるとき、検査順で先の分類を返す', () => {
  assert.equal(classOf(orderResult.steps[0]), 'payload_too_large');
  assert.equal(orderResult.steps[0].statusCode, 413);
  assert.equal(classOf(orderResult.steps[1]), 'unsupported_media_type');
  assert.equal(orderResult.steps[1].statusCode, 415);
  assert.equal(classOf(orderResult.steps[2]), 'signature_mismatch');
  assert.equal(classOf(orderResult.steps[3]), 'signature_mismatch');
});

test('T023: 想定外の例外（重複排除の失敗）は500 internal_error で、例外のメッセージを出さない', () => {
  const step = orderResult.steps[7];
  assert.equal(step.statusCode, 500);
  assert.equal(classOf(step), 'internal_error');
  assert.equal(JSON.stringify(diagOf(step)).includes('store detail'), false);
});

test('T023: 秘密、署名の値、本文の内容、ヘッダー値は、応答、診断、標準エラーのどこにも出ない', () => {
  const secretsAndBodies = [
    SIGNING_VALUE,
    'wrong-value-for-tests',
    BODY_MARKER,
    'secret store detail',
    'queue detail',
    'markDone failure detail',
    'store detail',
  ];
  const sampleSignature = buildRequest({ text: jsonText(markedPayload) }).headers[
    'x-hub-signature-256'
  ].slice('sha256='.length);
  const haystacks = [
    JSON.stringify(orderResult.steps),
    orderResult.diagnostics.join('\n'),
    orderRun.stderr,
    JSON.stringify(orderResult.reentrant),
  ];
  for (const haystack of haystacks) {
    for (const forbidden of secretsAndBodies) {
      assert.equal(haystack.includes(forbidden), false, `含まれてはならない値: ${forbidden}`);
    }
    assert.equal(haystack.includes(sampleSignature), false, '署名の値が含まれている');
  }
});

test('T023: すべての診断行は許可されたキーだけを持つ', () => {
  for (const line of orderResult.diagnostics) {
    const keys = Object.keys(JSON.parse(line));
    for (const key of keys) {
      assert.ok(ALLOWED_DIAGNOSTIC_KEYS.includes(key), `許可されていないキー: ${key}`);
    }
  }
});

// T025: ローテーション中の2版の検証。
const rotationCurrentOnly = handlerRun([{ event: buildRequest({ delivery: deliveryId(70) }) }], {
  secrets: [SIGNING_VALUE],
});

const rotationBoth = handlerRun(
  [
    {
      event: buildRequest({
        text: bodyOf(71),
        delivery: deliveryId(71),
        signingValue: SIGNING_VALUE,
      }),
    },
    {
      event: buildRequest({
        text: bodyOf(72),
        delivery: deliveryId(72),
        signingValue: ROTATED_VALUE,
      }),
    },
    { event: buildRequest({ delivery: deliveryId(73), signingValue: 'unknown-value-for-tests' }) },
  ],
  { secrets: [SIGNING_VALUE, ROTATED_VALUE] },
);

test('T025: AWSPENDING が無いとき AWSCURRENT だけで検証でき、202 になる', () => {
  assert.equal(rotationCurrentOnly.steps[0].statusCode, 202);
});

test('T025: AWSCURRENT と AWSPENDING のどちらで署名された配信も受理される', () => {
  assert.equal(rotationBoth.steps[0].statusCode, 202);
  assert.equal(rotationBoth.steps[1].statusCode, 202);
});

test('T025: どちらとも一致しない署名は401で拒否し、Secretを再取得しない。両方の候補を比較する', () => {
  assert.equal(rotationBoth.steps[2].statusCode, 401);
  assert.equal(classOf(rotationBoth.steps[2]), 'signature_mismatch');
  assert.equal(rotationBoth.steps[2].secretCalls, 1);
  assert.equal(rotationBoth.steps[2].timingSafeEqualCalls, 2);
  assert.equal(rotationBoth.steps[2].handoffs, 0);
});

// T026: ping。
const pingBodyWithoutWorkflowJob = JSON.stringify({
  zen: 'Keep it logically awesome.',
  hook_id: 4242,
});
const oldWorkflowJobBody = JSON.stringify(
  freshPayload({ createdAt: iso(NOW_MS - 10 * 24 * 3600_000) }),
);
const pingRun = handlerRun([
  {
    event: buildRequest({
      event: 'ping',
      text: pingBodyWithoutWorkflowJob,
      delivery: deliveryId(80),
    }),
  },
  { event: buildRequest({ event: 'ping', text: oldWorkflowJobBody, delivery: deliveryId(81) }) },
  {
    event: buildRequest({
      event: 'ping',
      text: pingBodyWithoutWorkflowJob,
      signingValue: 'wrong-value-for-tests',
    }),
  },
  { event: buildRequest({ event: 'ping', text: '{ not json', delivery: deliveryId(82) }) },
]);

test('T026: 正しい署名の ping は200 ping_accepted で、引き渡しも重複排除の記録も0回', () => {
  assert.equal(pingRun.steps[0].statusCode, 200, pingRun.steps[0].body);
  assert.equal(classOf(pingRun.steps[0]), 'ping_accepted');
  assert.equal(pingRun.steps[0].handoffs, 0);
});

test('T026: workflow_job を持たない ping は expired や payload_invalid にならず200で受理される', () => {
  assert.equal(pingRun.steps[0].statusCode, 200);
  assert.notEqual(classOf(pingRun.steps[0]), 'expired');
  assert.notEqual(classOf(pingRun.steps[0]), 'payload_invalid');
});

test('T026: ping は時刻の検査の対象外で、古い workflow_job を含む本文でも200 ping_accepted になる', () => {
  assert.equal(pingRun.steps[1].statusCode, 200);
  assert.equal(classOf(pingRun.steps[1]), 'ping_accepted');
});

test('T026: 署名が不正な ping は401で拒否し、JSONとして不正な ping は400 payload_invalid になる', () => {
  assert.equal(pingRun.steps[2].statusCode, 401);
  assert.equal(classOf(pingRun.steps[2]), 'signature_mismatch');
  assert.equal(pingRun.steps[3].statusCode, 400);
  assert.equal(classOf(pingRun.steps[3]), 'payload_invalid');
});

test('T026: ping の一連の処理で、重複排除への記録と引き渡しは0回', () => {
  assert.equal(pingRun.storeWrites, 0);
  assert.equal(pingRun.handoffs.length, 0);
});
