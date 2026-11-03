import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DAY_MS,
  NOW_MS,
  SIGNING_VALUE,
  buildRequest,
  iso,
  jsonText,
  runInChild,
  workflowJobPayload,
} from './support/webhook-harness.mjs';

// T016 と T024: 期限判定（J-1）。時計は注入した値で固定する。
// 入力の一覧は implementation-log.md の T004 に従う（番号は同じ）。
const RECEIVED = NOW_MS;
const THREE_DAYS_MS = 3 * DAY_MS;

const job = ({ action = 'queued', created, started, completed } = {}) =>
  workflowJobPayload({ action, createdAt: created, startedAt: started, completedAt: completed });

const cases = [
  { no: 1, payload: job({ created: iso(RECEIVED - 3600_000) }), expect: { ok: true } },
  {
    no: 2,
    payload: job({
      action: 'completed',
      created: iso(RECEIVED - 3600_000),
      started: iso(RECEIVED - 1800_000),
      completed: null,
    }),
    expect: { ok: true },
  },
  {
    no: 3,
    payload: job({
      action: 'completed',
      created: iso(RECEIVED - THREE_DAYS_MS - 1000),
      started: iso(RECEIVED - THREE_DAYS_MS - 1000),
      completed: null,
    }),
    expect: { ok: false, classification: 'expired' },
  },
  {
    no: 4,
    payload: job({
      action: 'completed',
      created: iso(RECEIVED - THREE_DAYS_MS - 1000),
      started: iso(RECEIVED - 3600_000),
      completed: null,
    }),
    expect: { ok: true },
  },
  {
    no: 5,
    payload: job({
      action: 'completed',
      created: iso(RECEIVED - 3600_000),
      started: iso(RECEIVED - 3600_000),
      completed: iso(RECEIVED - 3600_000),
    }),
    expect: { ok: true },
  },
  {
    no: 6,
    payload: job({ created: iso(RECEIVED - THREE_DAYS_MS) }),
    expect: { ok: true },
  },
  {
    no: 7,
    payload: job({ created: iso(RECEIVED - THREE_DAYS_MS - 1000) }),
    expect: { ok: false, classification: 'expired' },
  },
  {
    no: 8,
    payload: job({ created: iso(RECEIVED + THREE_DAYS_MS + 1000) }),
    expect: { ok: false, classification: 'expired' },
  },
  {
    no: 9,
    payload: job({ created: 'not a date' }),
    expect: { ok: false, classification: 'payload_invalid' },
  },
  {
    no: 10,
    payload: job({ created: 1700000000 }),
    expect: { ok: false, classification: 'payload_invalid' },
  },
  {
    no: 11,
    payload: job({ created: 'not a date', started: iso(RECEIVED - 3600_000) }),
    // 判断3: created_at は必須のため、解釈できなければ他の時刻があっても拒否する。
    expect: { ok: false, classification: 'payload_invalid' },
  },
  {
    no: 12,
    payload: job({ created: iso(RECEIVED - THREE_DAYS_MS), started: null, completed: null }),
    expect: { ok: true },
  },
  {
    no: 13,
    payload: workflowJobPayload({ action: 'queued' }),
    expect: { ok: false, classification: 'payload_invalid' },
  },
];

// 1ミリ秒だけ超える境界。3日ちょうどは受理し、1ミリ秒超えると拒否する（J-1）。
cases.push(
  {
    no: 14,
    payload: job({ created: iso(RECEIVED - THREE_DAYS_MS - 1) }),
    expect: { ok: false, classification: 'expired' },
  },
  {
    no: 15,
    payload: job({ created: iso(RECEIVED + THREE_DAYS_MS + 1) }),
    expect: { ok: false, classification: 'expired' },
  },
  // 判断3: created_at が null、または欠落なら、他の時刻があっても payload_invalid。
  {
    no: 16,
    payload: job({ created: null, started: iso(RECEIVED - 3600_000) }),
    expect: { ok: false, classification: 'payload_invalid' },
  },
  {
    no: 17,
    payload: { workflow_job: { action: 'queued', started_at: iso(RECEIVED - 3600_000) } },
    expect: { ok: false, classification: 'payload_invalid' },
  },
);

const unit = runInChild({
  mode: 'batch',
  calls: cases.map((c) => ({
    module: 'expiry.ts',
    fn: 'checkDeliveryExpiry',
    args: [c.payload, RECEIVED],
  })),
});

for (const [index, c] of cases.entries()) {
  test(`T016: 入力 ${c.no} の期限判定の結果が implementation-log.md の一覧と一致する`, () => {
    const result = unit.results[index];
    assert.equal(result.ok, true, result.error);
    const value = result.value;
    if (c.expect.ok) {
      assert.deepEqual(value, { ok: true });
    } else {
      assert.deepEqual(value, { ok: false, classification: c.expect.classification });
    }
  });
}

// T024: 同じ入力を handler 経由で通し、ステータスと分類、引き渡しと記録の有無を検査する。
// 期限切れの配信は重複排除に記録せず、引き渡しもしない（clarify.md の順10）。
const deliveryId = (n) => `00000000-0000-4000-8000-a${String(n).padStart(11, '0')}`; // 末尾に英字を含め、12桁の数字だけの並びを作らない（公開情報の検査）。
const handlerRun = runInChild({
  mode: 'handler',
  startMs: RECEIVED,
  secrets: [SIGNING_VALUE],
  steps: cases.map((c) => ({
    event: buildRequest({ text: jsonText(c.payload), delivery: deliveryId(100 + c.no) }),
  })),
});

const acceptedCount = cases.filter((c) => c.expect.ok).length;

for (const [index, c] of cases.entries()) {
  test(`T024: 入力 ${c.no} を handler に通した結果が期待どおり（受理は202、拒否は400）`, () => {
    const step = handlerRun.steps[index];
    if (c.expect.ok) {
      assert.equal(step.statusCode, 202, step.body);
      assert.equal(step.handoffs, 1);
    } else {
      assert.equal(step.statusCode, 400, step.body);
      assert.equal(JSON.parse(step.body).classification, c.expect.classification);
      assert.equal(step.handoffs, 0);
      assert.equal(step.secretCalls, 1);
    }
  });
}

test('T024: 拒否された期限切れは重複排除に記録されず、受理された入力だけが記録される', () => {
  assert.equal(handlerRun.storeWrites, acceptedCount);
});

test('T024: ping の本文（時刻項目なし）は、期限判定が呼ばれず expired にも payload_invalid にもならない', () => {
  // 期限判定はハンドラーの順10にだけあり、ping は順9で終了する。ここでは本文だけを確認する（検査は T026）。
  const pingBody = { zen: 'Keep it logically awesome.', hook_id: 1 };
  const result = runInChild({
    mode: 'handler',
    startMs: RECEIVED,
    secrets: [SIGNING_VALUE],
    steps: [
      {
        event: buildRequest({
          text: JSON.stringify(pingBody),
          event: 'ping',
          delivery: deliveryId(900),
        }),
      },
    ],
  });
  assert.equal(result.steps[0].statusCode, 200, result.steps[0].body);
  assert.equal(JSON.parse(result.steps[0].body).classification, 'ping_accepted');
});
