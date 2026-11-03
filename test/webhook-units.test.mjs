import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  DELIVERY_ID,
  MAX_BODY_BYTES,
  NOW_MS,
  SIGNING_VALUE,
  ROTATED_VALUE,
  iso,
  runInChild,
  signatureFor,
  workflowJobPayload,
} from './support/webhook-harness.mjs';

// T012〜T015 と T018 の検査は、純粋関数を1回の子プロセスで実行してまとめて確認する（起動時間を抑えるため）。
const DIGEST = createHash('sha256').update('units-body').digest('hex');
const DIGITS = 'a';
const exactBytes = Buffer.alloc(MAX_BODY_BYTES, DIGITS);
const oneUnder = Buffer.alloc(MAX_BODY_BYTES - 1, DIGITS);
const oneOver = Buffer.alloc(MAX_BODY_BYTES + 1, DIGITS);

const sampleText = '{ "spacing" :  1 }';
const sampleBytes = Buffer.from(sampleText, 'utf8');
const goodSignature = signatureFor(sampleBytes, SIGNING_VALUE);
const rotatedSignature = signatureFor(sampleBytes, ROTATED_VALUE);

const fullPayload = workflowJobPayload({
  createdAt: iso(NOW_MS),
  startedAt: iso(NOW_MS),
  completedAt: null,
});

const ok = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.value;
};

const batch = runInChild({
  mode: 'batch',
  calls: [
    // T012: 上限の境界（非base64）
    {
      module: 'body.ts',
      fn: 'readRawBody',
      args: [{ body: exactBytes.toString('utf8') }, MAX_BODY_BYTES],
    },
    {
      module: 'body.ts',
      fn: 'readRawBody',
      args: [{ body: oneOver.toString('utf8') }, MAX_BODY_BYTES],
    },
    // T012: 上限の境界（base64）。6291456バイトは末尾に=が無い。6291455バイトは=が1個。6291457は超過。
    {
      module: 'body.ts',
      fn: 'readRawBody',
      args: [{ body: exactBytes.toString('base64'), isBase64Encoded: true }, MAX_BODY_BYTES],
    },
    {
      module: 'body.ts',
      fn: 'readRawBody',
      args: [{ body: oneUnder.toString('base64'), isBase64Encoded: true }, MAX_BODY_BYTES],
    },
    {
      module: 'body.ts',
      fn: 'readRawBody',
      args: [{ body: oneOver.toString('base64'), isBase64Encoded: true }, MAX_BODY_BYTES],
    },
    // T012: 形式が不正なbase64
    { module: 'body.ts', fn: 'readRawBody', args: [{ body: 'AB!D', isBase64Encoded: true }, 100] },
    { module: 'body.ts', fn: 'readRawBody', args: [{ body: 'ABC', isBase64Encoded: true }, 100] },
    // T012: 受信したバイト列がそのまま渡る（空白や並びを変えない）
    { module: 'body.ts', fn: 'readRawBody', args: [{ body: sampleText }, 1000] },
    // T013: ヘッダー
    { module: 'headers.ts', fn: 'checkRequestHeaders', args: [validHeaders()] },
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [validHeaders({ 'x-github-event': 'ping' })],
    },
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [validHeaders({ 'content-type': 'text/plain' })],
    },
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [validHeaders({ 'content-type': 'application/json; charset=utf-8' })],
    },
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [validHeaders({ 'x-github-event': 'issues' })],
    },
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [validHeaders({ 'x-github-delivery': undefined })],
    },
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [validHeaders({ 'x-github-delivery': 'not-a-guid' })],
    },
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [validHeaders({ 'x-hub-signature-256': undefined })],
    },
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [validHeaders({ 'x-hub-signature-256': `sha256=${'a'.repeat(63)}` })],
    },
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [validHeaders({ 'x-hub-signature-256': `${goodSignature}, ${goodSignature}` })],
    },
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [
        {
          ...validHeaders(),
          'x-hub-signature-256': undefined,
          'x-hub-signature': `sha1=${'b'.repeat(40)}`,
        },
      ],
    },
    // ヘッダー名は大文字でも読める（正規化）。
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [
        {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'workflow_job',
          'X-GitHub-Delivery': DELIVERY_ID,
          'X-Hub-Signature-256': goodSignature,
        },
      ],
    },
    // 順序: 形式の誤りが複数あるとき、先の順の分類を返す。
    {
      module: 'headers.ts',
      fn: 'checkRequestHeaders',
      args: [validHeaders({ 'content-type': 'text/plain', 'x-hub-signature-256': undefined })],
    },
    // T014: 署名（候補数と呼び出し回数）
    {
      module: 'signature.ts',
      fn: 'verifyWebhookSignature',
      args: [{ $base64: sampleBytes.toString('base64') }, goodSignature, [SIGNING_VALUE]],
    },
    {
      module: 'signature.ts',
      fn: 'verifyWebhookSignature',
      args: [
        { $base64: sampleBytes.toString('base64') },
        rotatedSignature,
        [SIGNING_VALUE, ROTATED_VALUE],
      ],
    },
    {
      module: 'signature.ts',
      fn: 'verifyWebhookSignature',
      args: [
        { $base64: sampleBytes.toString('base64') },
        goodSignature,
        [SIGNING_VALUE, ROTATED_VALUE],
      ],
    },
    {
      module: 'signature.ts',
      fn: 'verifyWebhookSignature',
      args: [
        { $base64: sampleBytes.toString('base64') },
        goodSignature,
        [ROTATED_VALUE, 'other-value-for-tests'],
      ],
    },
    {
      module: 'signature.ts',
      fn: 'verifyWebhookSignature',
      args: [
        { $base64: sampleBytes.toString('base64') },
        `sha256=${'c'.repeat(62)}`,
        [SIGNING_VALUE, ROTATED_VALUE],
      ],
    },
    // 1バイト違う本文（改ざん）は不一致。
    {
      module: 'signature.ts',
      fn: 'verifyWebhookSignature',
      args: [
        { $base64: Buffer.from(sampleText + ' ', 'utf8').toString('base64') },
        goodSignature,
        [SIGNING_VALUE],
      ],
    },
    // T015: JSON検証と抽出
    {
      module: 'message.ts',
      fn: 'parseJsonBody',
      args: [{ $base64: Buffer.from('{"a":', 'utf8').toString('base64') }],
    },
    {
      module: 'message.ts',
      fn: 'parseJsonBody',
      args: [{ $base64: Buffer.from([0xff, 0xfe, 0x7b, 0x7d]).toString('base64') }],
    },
    {
      module: 'message.ts',
      fn: 'extractWorkflowJobMessage',
      args: [fullPayload, DELIVERY_ID, iso(NOW_MS), DIGEST],
    },
    {
      module: 'message.ts',
      fn: 'extractWorkflowJobMessage',
      args: [
        workflowJobPayload({
          createdAt: iso(NOW_MS),
          installation: null,
          organization: null,
          omit: [],
        }),
        DELIVERY_ID,
        iso(NOW_MS),
        DIGEST,
      ],
    },
    {
      module: 'message.ts',
      fn: 'extractWorkflowJobMessage',
      args: [
        workflowJobPayload({ createdAt: iso(NOW_MS), omit: ['installation', 'organization'] }),
        DELIVERY_ID,
        iso(NOW_MS),
        DIGEST,
      ],
    },
    {
      module: 'message.ts',
      fn: 'extractWorkflowJobMessage',
      args: [
        workflowJobPayload({ createdAt: iso(NOW_MS), omit: ['repository'] }),
        DELIVERY_ID,
        iso(NOW_MS),
        DIGEST,
      ],
    },
    {
      module: 'message.ts',
      fn: 'extractWorkflowJobMessage',
      args: [
        workflowJobPayload({ createdAt: iso(NOW_MS), omit: ['job.labels'] }),
        DELIVERY_ID,
        iso(NOW_MS),
        DIGEST,
      ],
    },
    {
      module: 'message.ts',
      fn: 'extractWorkflowJobMessage',
      args: [{ ...fullPayload, installation: 'not-an-object' }, DELIVERY_ID, iso(NOW_MS), DIGEST],
    },
    // T018: 診断行のキー
    {
      module: 'diagnostics.ts',
      fn: 'buildDiagnosticLine',
      args: [
        {
          classification: 'accepted',
          status: 202,
          deliveryId: DELIVERY_ID,
          durationMs: 4,
          requestId: 'request-test-0001',
          body: 'extra-field-must-not-appear',
        },
      ],
    },
    {
      module: 'diagnostics.ts',
      fn: 'buildDiagnosticLine',
      args: [{ classification: 'payload_invalid', status: 400, durationMs: 1 }],
    },
  ],
});

function validHeaders(overrides = {}) {
  const base = {
    'content-type': 'application/json',
    'x-github-event': 'workflow_job',
    'x-github-delivery': DELIVERY_ID,
    'x-hub-signature-256': goodSignature,
  };
  const merged = { ...base, ...overrides };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged;
}

const [
  bodyExact,
  bodyOver,
  b64Exact,
  b64One,
  b64Over,
  b64BadChars,
  b64BadLength,
  bodyRaw,
  hOk,
  hPing,
  hMediaText,
  hMediaCharset,
  hEventBad,
  hDeliveryMissing,
  hDeliveryBad,
  hSigMissing,
  hSigShort,
  hSigJoined,
  hSigSha1Only,
  hUpper,
  hOrder,
  sigOne,
  sigSecond,
  sigBoth,
  sigNone,
  sigBadLength,
  sigTampered,
  jsonBroken,
  jsonBadUtf8,
  extractOk,
  extractNullOptional,
  extractNoOptional,
  extractNoRepo,
  extractNoLabels,
  extractBadInstallation,
  diagWithDelivery,
  diagWithout,
] = batch.results;

test('T012: 非base64の本文は上限ちょうどを受理し、上限+1を413で拒否する', () => {
  assert.equal(ok(bodyExact).ok, true);
  assert.equal(ok(bodyOver).classification, 'payload_too_large');
});

test('T012: base64の本文は復元後のバイト長で上限を判定する（ちょうど、=1個、超過）', () => {
  assert.equal(ok(b64Exact).ok, true);
  assert.equal(Buffer.from(ok(b64Exact).bytes.$base64, 'base64').length, MAX_BODY_BYTES);
  assert.equal(ok(b64One).ok, true);
  assert.equal(Buffer.from(ok(b64One).bytes.$base64, 'base64').length, MAX_BODY_BYTES - 1);
  assert.equal(ok(b64Over).classification, 'payload_too_large');
});

test('T012: 形式が不正なbase64は 400 payload_invalid で拒否する（判断2、clarify.md の行 1a）', () => {
  assert.equal(ok(b64BadChars).classification, 'payload_invalid');
  assert.equal(ok(b64BadLength).classification, 'payload_invalid');
});

test('T012: 受信したバイト列をそのまま渡す（JSONの整形や並びを変えない）', () => {
  assert.equal(ok(bodyRaw).ok, true);
  assert.equal(ok(bodyRaw).bytes.$base64, sampleBytes.toString('base64'));
});

test('T013: 正しいヘッダーはイベントと配信IDを返す。ping も受理する', () => {
  assert.deepEqual(ok(hOk), {
    ok: true,
    value: { event: 'workflow_job', deliveryId: DELIVERY_ID, signatureHeader: goodSignature },
  });
  assert.equal(ok(hPing).ok, true);
  assert.equal(ok(hPing).value.event, 'ping');
});

test('T013: Content-Type の不一致は415、charset つきの application/json は受理する', () => {
  assert.equal(ok(hMediaText).classification, 'unsupported_media_type');
  assert.equal(ok(hMediaCharset).ok, true);
});

test('T013: 許可外のイベントは400、配信IDの欠落と形式不正は400', () => {
  assert.equal(ok(hEventBad).classification, 'event_not_allowed');
  assert.equal(ok(hDeliveryMissing).classification, 'delivery_id_invalid');
  assert.equal(ok(hDeliveryBad).classification, 'delivery_id_invalid');
});

test('T013: 署名の欠落、形式不正、連結された重複を拒否する。SHA-1だけの入力は署名欠落として拒否する', () => {
  assert.equal(ok(hSigMissing).classification, 'signature_missing');
  assert.equal(ok(hSigShort).classification, 'signature_malformed');
  assert.equal(ok(hSigJoined).classification, 'signature_malformed');
  assert.equal(ok(hSigSha1Only).classification, 'signature_missing');
});

test('T013: ヘッダー名の大文字は正規化して読む。複数の不正があれば、先の順の分類を返す', () => {
  assert.equal(ok(hUpper).ok, true);
  assert.equal(ok(hOrder).classification, 'unsupported_media_type');
});

test('T014: 候補1つの一致、後ろの候補だけ一致、両方不一致、長さ違い、改ざんを判定する', () => {
  assert.equal(ok(sigOne), true);
  assert.equal(ok(sigSecond), true);
  assert.equal(ok(sigBoth), true);
  assert.equal(ok(sigNone), false);
  assert.equal(ok(sigBadLength), false);
  assert.equal(ok(sigTampered), false);
});

test('T014: 候補のすべてに timingSafeEqual を1回ずつ呼び、途中で打ち切らない（長さ違いは呼ばない）', () => {
  assert.equal(sigOne.timingSafeEqualCalls, 1);
  assert.equal(sigSecond.timingSafeEqualCalls, 2);
  assert.equal(sigBoth.timingSafeEqualCalls, 2);
  assert.equal(sigNone.timingSafeEqualCalls, 2);
  assert.equal(sigBadLength.timingSafeEqualCalls, 0);
});

test('T015: JSONとして解釈できない本文（不正な構文、不正なUTF-8）は payload_invalid', () => {
  assert.equal(ok(jsonBroken).classification, 'payload_invalid');
  assert.equal(ok(jsonBadUtf8).classification, 'payload_invalid');
});

test('T015: 許可リストの項目だけを出力する。installation と organization が無いとき null', () => {
  const message = ok(extractOk).message;
  assert.deepEqual(Object.keys(message).sort(), [
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
  ]);
  assert.equal(message.bodyDigest, DIGEST);
  assert.equal(message.schemaVersion, 1);
  assert.equal(message.installationId, 4001);
  assert.equal(message.organizationLogin, 'example-org');

  const absent = ok(extractNoOptional);
  assert.equal(absent.ok, true);
  assert.equal(absent.message.installationId, null);
  assert.equal(absent.message.organizationLogin, null);
  assert.equal(ok(extractNullOptional).message.installationId, null);
});

test('T015: repository が無い、labels が配列でない、installation の形式が不正なら payload_invalid', () => {
  assert.equal(ok(extractNoRepo).classification, 'payload_invalid');
  assert.equal(ok(extractNoLabels).classification, 'payload_invalid');
  assert.equal(ok(extractBadInstallation).classification, 'payload_invalid');
});

test('T018: 診断行のキーは許可リストに限られ、未検証の配信IDを含めない', () => {
  const withDelivery = JSON.parse(ok(diagWithDelivery));
  assert.deepEqual(Object.keys(withDelivery).sort(), [
    'classification',
    'deliveryId',
    'durationMs',
    'requestId',
    'status',
  ]);
  const without = JSON.parse(ok(diagWithout));
  assert.deepEqual(Object.keys(without).sort(), ['classification', 'durationMs', 'status']);
  assert.equal(ok(diagWithDelivery).includes('extra-field-must-not-appear'), false);
});
