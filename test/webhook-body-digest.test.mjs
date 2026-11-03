import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  NOW_MS,
  SIGNING_VALUE,
  buildRequest,
  iso,
  jsonText,
  runInChild,
  workflowJobPayload,
} from './support/webhook-harness.mjs';

// 重複排除のキーを、署名対象の生の本文のSHA-256（bodyDigest）にする検査（clarify.md Q-002）。
// 配信IDは署名されないため、署名済みの本文に新しい配信IDを付けて送り直す再送を、重複として止める。

const GUID_FIRST = '2f9b4c1e-7d3a-4b8e-9c21-5a6d7e8f9012';
const GUID_RESENT = '7a1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const WRONG_SIGNING_VALUE = 'wrong-value-for-tests';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

// 作成時刻は受信時刻の1分前にして、期限判定を通す。job の id と状態を変えると、本文が変わる。
function payloadText({ id = 1001, action = 'queued', status = 'queued' } = {}) {
  const payload = workflowJobPayload({
    action,
    createdAt: iso(NOW_MS - 60_000),
    installation: { id: 4001 },
  });
  payload.workflow_job.id = id;
  payload.workflow_job.status = status;
  return jsonText(payload);
}

const run = (steps) =>
  runInChild({
    mode: 'handler',
    startMs: NOW_MS,
    secrets: [SIGNING_VALUE],
    steps,
  });

const classOf = (step) => JSON.parse(step.body).classification;

// 1. 回帰: 同じ本文でGUIDだけ違う2回目の配信は duplicate になり、引き渡しは1回だけ。
// 修正前のコードでは、この2回目が 202 accepted になり、SQS へ2回送られていた（修正前の再現で確認済み）。
const text = payloadText();
const resent = run([
  { event: buildRequest({ text, delivery: GUID_FIRST }) },
  { event: buildRequest({ text, delivery: GUID_RESENT }) },
]);

test('同じ本文でGUIDだけ違う再送は、2回目が200 duplicateになり、引き渡しは1回だけ', () => {
  assert.notEqual(GUID_FIRST, GUID_RESENT, '前提: 配信IDは違う');
  assert.equal(resent.steps[0].statusCode, 202, resent.steps[0].body);
  assert.equal(resent.steps[1].statusCode, 200, resent.steps[1].body);
  assert.equal(classOf(resent.steps[1]), 'duplicate');
  assert.equal(resent.steps[1].handoffs, 0);
  assert.equal(resent.handoffs.length, 1);
});

// 2. 状態が変わった配信は本文が違うため別キーになり、従来どおり処理される。
const states = run([
  { event: buildRequest({ text: payloadText({ action: 'queued' }), delivery: GUID_FIRST }) },
  {
    event: buildRequest({
      text: payloadText({ action: 'in_progress', status: 'in_progress' }),
      delivery: GUID_RESENT,
    }),
  },
  {
    event: buildRequest({
      text: payloadText({ action: 'completed', status: 'completed' }),
      delivery: '9c3e5f7a-1b2c-4d5e-8f90-a1b2c3d4e5f6',
    }),
  },
]);

test('同じjobの状態が変わった配信（queued、in_progress、completed）は別キーとして3回とも受理される', () => {
  assert.deepEqual(
    states.steps.map((step) => step.statusCode),
    [202, 202, 202],
  );
  assert.equal(states.handoffs.length, 3);
  const digests = new Set(states.handoffs.map((message) => message.bodyDigest));
  assert.equal(digests.size, 3, '3つの本文は3つのダイジェストになる');
  assert.ok(states.handoffs.every((message) => message.jobId === 1001));
});

// 3. 署名検証に失敗した配信は、重複排除のストアに一切書き込まれない。
// 失敗のあとに同じ本文を正しい署名で送ると、重複扱いにならず受理されることも確認する。
const badOnly = run([
  {
    event: buildRequest({
      text,
      delivery: GUID_FIRST,
      signingValue: WRONG_SIGNING_VALUE,
    }),
  },
]);
const badThenGood = run([
  {
    event: buildRequest({
      text,
      delivery: GUID_FIRST,
      signingValue: WRONG_SIGNING_VALUE,
    }),
  },
  { event: buildRequest({ text, delivery: GUID_RESENT }) },
]);

test('署名検証に失敗した配信は、重複排除のストアに書き込まれない（書込み0回、保存されたキー0件）', () => {
  assert.equal(badOnly.steps[0].statusCode, 401);
  assert.equal(classOf(badOnly.steps[0]), 'signature_mismatch');
  assert.equal(badOnly.storeWrites, 0);
  assert.deepEqual(badOnly.storedKeys, []);
  assert.equal(badOnly.handoffs.length, 0);
});

test('署名に失敗した同じ本文の後の正しい配信は、重複にならず受理される（保存は1回だけ）', () => {
  assert.equal(badThenGood.steps[0].statusCode, 401);
  assert.equal(badThenGood.steps[1].statusCode, 202, badThenGood.steps[1].body);
  assert.equal(badThenGood.storeWrites, 1);
  assert.equal(badThenGood.handoffs.length, 1);
});

// 4. SQS のメッセージに bodyDigest が含まれ、生の本文のSHA-256（16進小文字64桁）である。
// base64 で届いた同じバイト列も、同じダイジェストになることを確かめる。
const base64Text = Buffer.from(text, 'utf8').toString('base64');
const encoded = run([
  { event: buildRequest({ text: base64Text, base64: true, delivery: GUID_FIRST }) },
]);

test('SQSのメッセージに bodyDigest があり、64桁の16進小文字で、生の本文のSHA-256と一致する', () => {
  assert.equal(encoded.steps[0].statusCode, 202, encoded.steps[0].body);
  const [message] = encoded.handoffs;
  assert.match(message.bodyDigest, DIGEST_PATTERN);
  assert.equal(message.bodyDigest, sha256Hex(Buffer.from(text, 'utf8')));
  assert.equal(message.deliveryId, GUID_FIRST, '配信IDは診断用の属性として残る');
});

test('base64で届いた同じバイト列は、utf8で届いた本文と同じダイジェストになる', () => {
  assert.match(encoded.handoffs[0].bodyDigest, DIGEST_PATTERN);
  assert.equal(encoded.handoffs[0].bodyDigest, resent.handoffs[0].bodyDigest);
});

// 保存の検査: 重複排除の項目のキーは bodyDigest で、配信IDはキーではない。
test('重複排除の項目はbodyDigestを含み、キーとして配信IDを使わない', () => {
  assert.deepEqual(resent.storedKeys[0], [
    'bodyDigest',
    'deliveryId',
    'expiresAt',
    'leaseUntil',
    'receivedAt',
    'state',
  ]);
});
