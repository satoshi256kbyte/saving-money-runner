import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { runOps } from './support/adapter-harness.mjs';
import {
  DAY_MS,
  NOW_MS,
  SIGNING_VALUE,
  buildRequest,
  jsonText,
  workflowJobPayload,
} from './support/webhook-harness.mjs';

// T031: アダプターの契約テスト（T027〜T030 の完了条件に挙げた挙動）。
// SDKのクライアントは子プロセス内の偽物に差し替える。実AWSには接続せず、AWSの認証情報も使わない。
// 公開情報の検査に触れないよう、ARN やアカウントIDは、プレースホルダーの文字列を使う。

const SECRET_ARN = '<SECRET_ARN>';
const TABLE_NAME = '<DEDUPE_TABLE_NAME>';
const QUEUE_URL = '<HANDOFF_QUEUE_URL>';
const CURRENT_VALUE = 'current-value-for-tests';
const PENDING_VALUE = 'pending-value-for-tests';
const ALLOWED_BODY_KEYS = [
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
].sort();

const ok = (result) => {
  assert.equal(result.ok, true, result.message);
  return result.value;
};

const deliveryId = (n) => `00000000-0000-4000-8000-b${String(n).padStart(11, '0')}`; // 12桁の数字だけの並びを作らない。
const FIVE_MIN_MS = 300_000;
const THREE_DAYS_MS = 3 * DAY_MS;
const expiresAtSeconds = (nowMs) => Math.floor((nowMs + THREE_DAYS_MS) / 1000);

// T027: Secret の取得アダプター。
function secretsRun(config, steps) {
  return runOps([
    { op: 'fake', id: 'secrets', kind: 'secrets', config },
    { op: 'clock', id: 'clock', nowMs: NOW_MS },
    {
      op: 'call',
      module: 'secret-provider.ts',
      fn: 'createSecretProvider',
      args: [{ client: { $ref: 'secrets' }, secretId: SECRET_ARN, clock: { $ref: 'clock' } }],
      store: 'provider',
    },
    ...steps,
  ]);
}

const twoVersions = {
  stages: { AWSCURRENT: CURRENT_VALUE, AWSPENDING: PENDING_VALUE },
  failStages: [],
};
const cacheSteps = [
  { op: 'invoke', target: 'provider', method: 'getSigningSecrets' },
  { op: 'clock', id: 'clock', nowMs: NOW_MS + FIVE_MIN_MS },
  { op: 'invoke', target: 'provider', method: 'getSigningSecrets' },
  { op: 'clock', id: 'clock', nowMs: NOW_MS + FIVE_MIN_MS + 1 },
  { op: 'invoke', target: 'provider', method: 'getSigningSecrets' },
];
const cacheRun = secretsRun(twoVersions, cacheSteps);

test('T027: AWSCURRENT と AWSPENDING の両方を取得し、この順で返す', () => {
  assert.deepEqual(ok(cacheRun.results[3]), [CURRENT_VALUE, PENDING_VALUE]);
});

test('T027: 300秒以内は再取得せず、300秒を超えると再取得する（取得は版ごとに1回ずつ）', () => {
  // 最初の取得で2回（AWSCURRENT と AWSPENDING）。300秒ちょうどは同じ値を使う。300秒1ミリ秒後に再取得する。
  assert.deepEqual(ok(cacheRun.results[5]), [CURRENT_VALUE, PENDING_VALUE]);
  assert.equal(cacheRun.calls.secrets.length, 4);
});

test('T027: 取得は GetSecretValue だけを使い、版の指定が AWSCURRENT と AWSPENDING である', () => {
  const stages = cacheRun.calls.secrets.map((call) => {
    assert.equal(call.name, 'GetSecretValueCommand');
    assert.equal(call.input.SecretId, SECRET_ARN);
    return call.input.VersionStage;
  });
  assert.deepEqual(stages, ['AWSCURRENT', 'AWSPENDING', 'AWSCURRENT', 'AWSPENDING']);
});

test('T027: AWSPENDING が存在しない（ResourceNotFoundException）のは失敗にせず、AWSCURRENT だけを返す', () => {
  const run = secretsRun({ stages: { AWSCURRENT: CURRENT_VALUE }, failStages: [] }, [
    { op: 'invoke', target: 'provider', method: 'getSigningSecrets' },
  ]);
  assert.deepEqual(ok(run.results[3]), [CURRENT_VALUE]);
});

test('T027: AWSCURRENT の取得に失敗したら 503 の分類になる例外（secret_unavailable）で、値を含まない', () => {
  const run = secretsRun({ stages: { AWSCURRENT: CURRENT_VALUE }, failStages: ['AWSCURRENT'] }, [
    { op: 'invoke', target: 'provider', method: 'getSigningSecrets' },
  ]);
  const result = run.results[3];
  assert.equal(result.ok, false);
  assert.equal(result.name, 'SecretUnavailableError');
  assert.equal(result.message, 'secret_unavailable');
  assert.ok(!JSON.stringify(run.results).includes(CURRENT_VALUE));
  assert.ok(!JSON.stringify(run.results).includes('AccessDenied'));
});

test('T027: AWSPENDING の不在以外の失敗は、2版を保証できないため失敗にする', () => {
  const run = secretsRun(
    {
      stages: { AWSCURRENT: CURRENT_VALUE, AWSPENDING: PENDING_VALUE },
      failStages: ['AWSPENDING'],
    },
    [{ op: 'invoke', target: 'provider', method: 'getSigningSecrets' }],
  );
  assert.equal(run.results[3].ok, false);
  assert.equal(run.results[3].message, 'secret_unavailable');
});

// T028: DynamoDB の重複排除アダプター。偽物は、アダプターが定義した式だけを評価する（Ministack の確認は T044）。
const record = (bodyDigestValue, leaseUntil, expiresAt, state = 'processing') => ({
  bodyDigest: bodyDigestValue,
  deliveryId: deliveryId(9),
  state,
  leaseUntil,
  receivedAt: new Date(NOW_MS).toISOString(),
  expiresAt,
});
const digestOf = (text) => createHash('sha256').update(text).digest('hex');
const D1 = digestOf('adapter-body-1');
const D2 = digestOf('adapter-body-2');
const D3 = digestOf('adapter-body-3');
const LEASE_MS = 3000;

const dedupeRun = runOps([
  { op: 'fake', id: 'dynamo', kind: 'dynamo' },
  { op: 'clock', id: 'clock', nowMs: NOW_MS },
  {
    op: 'call',
    module: 'dedupe-dynamodb.ts',
    fn: 'createDynamoDedupeStore',
    args: [{ client: { $ref: 'dynamo' }, tableName: TABLE_NAME }],
    store: 'store',
  },
  // A: 新規の確保。
  {
    op: 'invoke',
    target: 'store',
    method: 'putIfAvailable',
    args: [record(D1, NOW_MS + LEASE_MS, expiresAtSeconds(NOW_MS)), NOW_MS],
  },
  // B: 処理中（leaseUntil の内）。小数点以下のミリ秒つきの時刻を使い、秒の表記を検査する。
  { op: 'clock', id: 'clock', nowMs: NOW_MS + 1123 },
  {
    op: 'invoke',
    target: 'store',
    method: 'putIfAvailable',
    args: [record(D1, NOW_MS + 1123 + LEASE_MS, expiresAtSeconds(NOW_MS)), NOW_MS + 1123],
  },
  // C: leaseUntil を過ぎた processing は再確保できる。
  { op: 'clock', id: 'clock', nowMs: NOW_MS + LEASE_MS + 1 },
  {
    op: 'invoke',
    target: 'store',
    method: 'putIfAvailable',
    args: [record(D1, NOW_MS + 2 * LEASE_MS + 1, expiresAtSeconds(NOW_MS)), NOW_MS + LEASE_MS + 1],
  },
  // D: 完了。確保した試行の leaseUntil で done にする。
  { op: 'invoke', target: 'store', method: 'markDone', args: [D1, NOW_MS + 2 * LEASE_MS + 1] },
  // E: 処理済みは再確保できない（existing が done）。
  { op: 'clock', id: 'clock', nowMs: NOW_MS + LEASE_MS + 2 },
  {
    op: 'invoke',
    target: 'store',
    method: 'putIfAvailable',
    args: [record(D1, NOW_MS + 2 * LEASE_MS + 2, expiresAtSeconds(NOW_MS)), NOW_MS + LEASE_MS + 2],
  },
  // F・G・H・I: 期限切れ項目の境界。3日ちょうどは期限内、1ミリ秒後に期限切れ。
  { op: 'clock', id: 'clock', nowMs: NOW_MS },
  {
    op: 'invoke',
    target: 'store',
    method: 'putIfAvailable',
    args: [record(D2, NOW_MS + LEASE_MS, expiresAtSeconds(NOW_MS)), NOW_MS],
  },
  { op: 'invoke', target: 'store', method: 'markDone', args: [D2, NOW_MS + LEASE_MS] },
  {
    op: 'invoke',
    target: 'store',
    method: 'putIfAvailable',
    args: [
      record(D2, NOW_MS + THREE_DAYS_MS + LEASE_MS, expiresAtSeconds(NOW_MS + THREE_DAYS_MS)),
      NOW_MS + THREE_DAYS_MS,
    ],
  },
  { op: 'clock', id: 'clock', nowMs: NOW_MS + THREE_DAYS_MS + 1 },
  {
    op: 'invoke',
    target: 'store',
    method: 'putIfAvailable',
    args: [
      record(
        D2,
        NOW_MS + THREE_DAYS_MS + 1 + LEASE_MS,
        expiresAtSeconds(NOW_MS + THREE_DAYS_MS + 1),
      ),
      NOW_MS + THREE_DAYS_MS + 1,
    ],
  },
  // J: 解放と完了は、leaseUntil が一致するときだけ効く。
  {
    op: 'invoke',
    target: 'store',
    method: 'putIfAvailable',
    args: [
      record(
        D3,
        NOW_MS + THREE_DAYS_MS + 1 + LEASE_MS,
        expiresAtSeconds(NOW_MS + THREE_DAYS_MS + 1),
      ),
      NOW_MS + THREE_DAYS_MS + 1,
    ],
  },
  { op: 'invoke', target: 'store', method: 'markDone', args: [D3, 1] },
  { op: 'invoke', target: 'store', method: 'release', args: [D3, 1] },
  {
    op: 'invoke',
    target: 'store',
    method: 'putIfAvailable',
    args: [
      record(
        D3,
        NOW_MS + THREE_DAYS_MS + 1 + LEASE_MS,
        expiresAtSeconds(NOW_MS + THREE_DAYS_MS + 1),
      ),
      NOW_MS + THREE_DAYS_MS + 1,
    ],
  },
  {
    op: 'invoke',
    target: 'store',
    method: 'release',
    args: [D3, NOW_MS + THREE_DAYS_MS + 1 + LEASE_MS],
  },
  {
    op: 'invoke',
    target: 'store',
    method: 'putIfAvailable',
    args: [
      record(
        D3,
        NOW_MS + THREE_DAYS_MS + 1 + LEASE_MS,
        expiresAtSeconds(NOW_MS + THREE_DAYS_MS + 1),
      ),
      NOW_MS + THREE_DAYS_MS + 1,
    ],
  },
]);
const R = dedupeRun.results;

test('T028: 新規の確保は条件付き PutItem で、保存する項目は本文のダイジェストを含む6つだけ（bodyとヘッダーを含まない）', () => {
  assert.deepEqual(ok(R[3]), { written: true });
  const put = dedupeRun.calls.dynamo.find((call) => call.name === 'PutItemCommand');
  assert.deepEqual(Object.keys(put.input.Item).sort(), [
    'bodyDigest',
    'deliveryId',
    'expiresAt',
    'leaseUntil',
    'receivedAt',
    'state',
  ]);
});

test('T028: 確保の条件は「項目が無い」「expiresAt を過ぎた」「processing かつ leaseUntil を過ぎた」の3つを含み、キーは bodyDigest', () => {
  const put = dedupeRun.calls.dynamo.find((call) => call.name === 'PutItemCommand');
  const expression = put.input.ConditionExpression;
  assert.match(expression, /attribute_not_exists\(bodyDigest\)/u);
  assert.match(expression, /expiresAt < :nowSeconds/u);
  assert.match(expression, /#state = :processing AND leaseUntil < :nowMs/u);
});

test('T028: 処理中（leaseUntil の内）は既存項目を返し、確保は行わない（秒の表記は小数点以下3桁）', () => {
  assert.equal(ok(R[5]).written, false);
  assert.equal(ok(R[5]).existing.state, 'processing');
  const puts = dedupeRun.calls.dynamo.filter((call) => call.name === 'PutItemCommand');
  assert.equal(
    puts[1].input.ExpressionAttributeValues[':nowSeconds'].N,
    `${NOW_MS / 1000 + 1}.123`,
  );
});

test('T028: leaseUntil を過ぎた processing は、別の試行が再確保できる', () => {
  assert.deepEqual(ok(R[7]), { written: true });
});

test('T028: done の項目は再確保できず、既存項目が done として返る', () => {
  assert.equal(ok(R[10]).written, false);
  assert.equal(ok(R[10]).existing.state, 'done');
});

test('T028: 期限切れの境界。3日ちょうどは期限内で再確保できず、1ミリ秒超えると再確保できる', () => {
  assert.deepEqual(ok(R[12]), { written: true });
  assert.equal(ok(R[14]).written, false, 'exactly three days is still within retention');
  assert.deepEqual(ok(R[16]), { written: true });
});

test('T028: 解放と完了は leaseUntil が一致するときだけ効く（一致しなければ解放されず、完了も拒否される）', () => {
  // 完了の不一致は例外として渡す（ハンドラーが確保を解放して503にする）。
  assert.equal(R[18].ok, false);
  assert.equal(R[18].name, 'ConditionalCheckFailedException');
  // 解放の不一致は何もしない（例外にならず、項目は残る）。
  assert.equal(R[19].ok, true);
  assert.equal(ok(R[20]).written, false);
  // 一致する解放で項目が消え、再確保できる。
  assert.equal(R[21].ok, true);
  assert.deepEqual(ok(R[22]), { written: true });
});

test('T028: 発行されたコマンドは PutItem、UpdateItem、DeleteItem だけで、GetItem、Query、Scan は無い', () => {
  const names = new Set(dedupeRun.calls.dynamo.map((call) => call.name));
  assert.deepEqual([...names].sort(), ['DeleteItemCommand', 'PutItemCommand', 'UpdateItemCommand']);
});

// T029: SQS の送信アダプター。
const handoffMessage = {
  schemaVersion: 1,
  deliveryId: deliveryId(1),
  bodyDigest: D1,
  event: 'workflow_job',
  receivedAt: new Date(NOW_MS).toISOString(),
  action: 'queued',
  jobId: 1001,
  runId: 2001,
  labels: ['self-hosted', 'linux'],
  status: 'queued',
  repositoryId: 3001,
  repositoryFullName: 'example-org/example-repo',
  installationId: 4001,
  organizationLogin: 'example-org',
};

const sqsRun = runOps([
  { op: 'fake', id: 'sqs', kind: 'sqs' },
  {
    op: 'call',
    module: 'handoff-sqs.ts',
    fn: 'createSqsHandoffQueue',
    args: [{ client: { $ref: 'sqs' }, queueUrl: QUEUE_URL }],
    store: 'queue',
  },
  { op: 'invoke', target: 'queue', method: 'send', args: [handoffMessage] },
  // 余分な項目（bodyの一部など）を渡しても、送信の本文には含めない。
  {
    op: 'invoke',
    target: 'queue',
    method: 'send',
    args: [
      {
        ...handoffMessage,
        rawBody: 'must-not-leave-the-adapter',
        headers: { 'x-hub-signature-256': 'x' },
      },
    ],
  },
  { op: 'configure', id: 'sqs', config: { failNext: true } },
  { op: 'invoke', target: 'queue', method: 'send', args: [handoffMessage] },
]);

test('T029: 送信は SendMessage を1回だけ使い、キューのURLを指定する', () => {
  assert.equal(sqsRun.results[2].ok, true);
  const first = sqsRun.calls.sqs[0];
  assert.equal(first.name, 'SendMessageCommand');
  assert.equal(first.input.QueueUrl, QUEUE_URL);
  assert.equal(sqsRun.calls.sqs.length, 3, 'one SendMessage per send call');
});

test('T029: 本文は許可リストの項目だけで、schemaVersion は 1', () => {
  const body = JSON.parse(sqsRun.calls.sqs[0].input.MessageBody);
  assert.deepEqual(Object.keys(body).sort(), ALLOWED_BODY_KEYS);
  assert.equal(body.schemaVersion, 1);
});

test('T029: 余分な項目（本文やヘッダーに相当するもの）は送信しない', () => {
  const body = JSON.parse(sqsRun.calls.sqs[1].input.MessageBody);
  assert.deepEqual(Object.keys(body).sort(), ALLOWED_BODY_KEYS);
  assert.ok(!sqsRun.calls.sqs[1].input.MessageBody.includes('must-not-leave-the-adapter'));
});

test('T029: 送信の失敗は例外として渡す（ハンドラーが handoff_failed の経路に入る）', () => {
  assert.equal(sqsRun.results[5].ok, false);
  assert.equal(sqsRun.results[5].name, 'ServiceUnavailable');
});

// T030: Lambda のエントリ。環境変数の検査と、アダプターを組み立てたハンドラーの動作。
const VALID_ENV = {
  WEBHOOK_SECRET_ARN: SECRET_ARN,
  WEBHOOK_DEDUPE_TABLE_NAME: TABLE_NAME,
  WEBHOOK_HANDOFF_QUEUE_URL: QUEUE_URL,
  WEBHOOK_MAX_BODY_BYTES: '6291456',
};

const configRun = runOps(
  [
    { op: 'require', module: 'handler.ts' },
    ...[
      { ...VALID_ENV },
      { ...VALID_ENV, WEBHOOK_MAX_BODY_BYTES: '6291457' },
      { ...VALID_ENV, WEBHOOK_MAX_BODY_BYTES: '0' },
      { ...VALID_ENV, WEBHOOK_MAX_BODY_BYTES: '1.5' },
      { ...VALID_ENV, WEBHOOK_MAX_BODY_BYTES: '-1' },
      { ...VALID_ENV, WEBHOOK_SECRET_ARN: '' },
      { ...VALID_ENV, WEBHOOK_HANDOFF_QUEUE_URL: undefined },
    ].map((env) => ({ op: 'call', module: 'handler.ts', fn: 'readRuntimeConfig', args: [env] })),
  ],
  { env: VALID_ENV },
);

test('T030: 全部の環境変数が揃い、body上限が1以上6291456以下の整数なら設定を読める', () => {
  const config = ok(configRun.results[1]);
  assert.deepEqual(config, {
    secretArn: SECRET_ARN,
    tableName: TABLE_NAME,
    queueUrl: QUEUE_URL,
    maxBodyBytes: 6291456,
  });
});

test('T030: body上限が範囲外（上限超過、0、小数、負数）や、必須の値が空なら起動時に失敗する', () => {
  for (const index of [2, 3, 4, 5, 6, 7]) {
    const result = configRun.results[index];
    assert.equal(result.ok, false, `case ${index}`);
    assert.equal(result.message, 'startup_config_invalid', `case ${index}`);
  }
});

test('T030: 失敗の例外は分類コードだけを含み、環境変数の値を含まない', () => {
  const serialized = JSON.stringify(configRun.results.slice(2));
  assert.ok(!serialized.includes(SECRET_ARN));
  assert.ok(!serialized.includes(QUEUE_URL));
  assert.ok(!serialized.includes(TABLE_NAME));
});

test('T030: 必須の環境変数が無いと、読込み（Lambda の初期化）の時点で失敗する', () => {
  const run = runOps([{ op: 'require', module: 'handler.ts' }], { env: {} });
  assert.equal(run.results[0].ok, false);
  assert.equal(run.results[0].message, 'startup_config_invalid');
});

// T030: 環境変数を与えたハンドラーの結合テスト。SDK の偽物を組み込み、実AWSには接続しない。
// created_at は実行時刻から1分前にする（期限判定は実行時刻と本文の時刻の差を使うため）。
// 配信ごとに本文を変える。重複排除は本文のダイジェストで判定するため、同じ本文は別の配信にならない。
// 作成時刻は1回だけ決める。呼び出しのたびに現在時刻を読むと、同じ配信の再送でも本文が変わってしまう。
const LIVE_CREATED_AT = new Date(Date.now() - 60_000).toISOString();
const liveText = (n) => {
  const payload = workflowJobPayload({
    action: 'queued',
    createdAt: LIVE_CREATED_AT,
    installation: { id: 4002 },
  });
  payload.workflow_job.id = 1000 + n;
  return jsonText(payload);
};
const deliveryEvent = (n, extra = {}) =>
  buildRequest({ text: liveText(n), delivery: deliveryId(n), ...extra });

const ALL_CLASSIFICATIONS_RUN = runOps(
  [
    { op: 'require', module: 'handler.ts' },
    {
      op: 'fake',
      id: 'secrets',
      kind: 'secrets',
      config: { stages: { AWSCURRENT: SIGNING_VALUE }, failStages: [] },
    },
    { op: 'fake', id: 'dynamo', kind: 'dynamo' },
    { op: 'fake', id: 'sqs', kind: 'sqs' },
    {
      op: 'call',
      module: 'handler.ts',
      fn: 'createLambdaHandler',
      args: [
        VALID_ENV,
        { secrets: { $ref: 'secrets' }, dynamo: { $ref: 'dynamo' }, sqs: { $ref: 'sqs' } },
      ],
      store: 'lambda',
    },
    // 1: 受理。2: 同じ配信IDの再受信は重複。
    { op: 'apply', target: 'lambda', args: [deliveryEvent(1)] },
    { op: 'apply', target: 'lambda', args: [deliveryEvent(1)] },
    // 3: 送信に失敗すると 503 になり、確保は解放される。4: 同じ配信IDは再試行で受理される。5: その後は重複。
    { op: 'configure', id: 'sqs', config: { failNext: true } },
    { op: 'apply', target: 'lambda', args: [deliveryEvent(2)] },
    { op: 'apply', target: 'lambda', args: [deliveryEvent(2)] },
    { op: 'apply', target: 'lambda', args: [deliveryEvent(2)] },
    // 6: 署名が一致しない配信は、重複排除に記録せず拒否する。
    {
      op: 'apply',
      target: 'lambda',
      args: [deliveryEvent(3, { signingValue: 'wrong-value-for-tests' })],
    },
  ],
  { env: VALID_ENV },
);

const runResults = ALL_CLASSIFICATIONS_RUN.results;
const responseOf = (index) => {
  const value = ok(runResults[index]);
  return { status: value.statusCode, classification: JSON.parse(value.body).classification };
};

test('T030: 初回の受理は202 accepted で、後続への送信は1回', () => {
  assert.deepEqual(responseOf(5), { status: 202, classification: 'accepted' });
});

test('T030: 同じ配信IDの再受信は200 duplicate で、送信は増えない', () => {
  assert.deepEqual(responseOf(6), { status: 200, classification: 'duplicate' });
});

test('T030: 送信の失敗は503 handoff_failed で、同じ配信IDは次の再試行で受理される（確保が解放されている）', () => {
  assert.deepEqual(responseOf(8), { status: 503, classification: 'handoff_failed' });
  assert.deepEqual(responseOf(9), { status: 202, classification: 'accepted' });
  assert.deepEqual(responseOf(10), { status: 200, classification: 'duplicate' });
});

test('T030: 署名が一致しない配信は401で拒否する', () => {
  assert.deepEqual(responseOf(11), { status: 401, classification: 'signature_mismatch' });
});

test('T030: Secrets Manager は実行環境内のキャッシュで、300秒以内は取得を繰り返さない（版ごとに1回）', () => {
  // AWSCURRENT（存在）と AWSPENDING（不在）の2回だけ。6回のリクエストで増えない。
  assert.equal(ALL_CLASSIFICATIONS_RUN.calls.secrets.length, 2);
});

test('T030: 重複排除は条件付きの PutItem と UpdateItem、解放の DeleteItem だけを使う', () => {
  const names = ALL_CLASSIFICATIONS_RUN.calls.dynamo.map((call) => call.name);
  assert.ok(
    names.every((name) =>
      ['PutItemCommand', 'UpdateItemCommand', 'DeleteItemCommand'].includes(name),
    ),
  );
  assert.ok(names.includes('DeleteItemCommand'), 'release after the failed handoff');
});

test('T030: 送信は成功した配信の数だけ行われる（失敗した1回を含めて3回）', () => {
  assert.equal(ALL_CLASSIFICATIONS_RUN.calls.sqs.length, 3);
});

test('T030: 診断ログは1行のJSONで、キーは許可リストに限られ、本文と署名の値を含まない', () => {
  const lines = ALL_CLASSIFICATIONS_RUN.logs;
  assert.equal(lines.length, 6);
  const allowed = ['classification', 'status', 'deliveryId', 'durationMs', 'requestId'];
  for (const line of lines) {
    const entry = JSON.parse(line);
    for (const key of Object.keys(entry)) assert.ok(allowed.includes(key), key);
  }
  // 後続への送信の本文には、許可リストの項目（リポジトリ名など）が入る。診断ログには入れない。
  const text = lines.join('\n');
  assert.ok(!text.includes(SIGNING_VALUE));
  assert.ok(!text.includes('wrong-value-for-tests'));
  assert.ok(!text.includes('example-org/example-repo'));
  assert.ok(!text.includes('self-hosted'));
});
