import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DAY_MS, DELIVERY_ID, NOW_MS, runInChild } from './support/webhook-harness.mjs';

// T017: 重複排除の状態遷移。時計は注入した値で固定し、境界の直前と直後を検査する。
// 受信時刻 T0 で確保すると leaseUntil は T0 + 3秒。保持期間は処理時刻から3日（秒単位で保存）。
const T0 = NOW_MS;
const LEASE_MS = 3000;
const RETENTION_MS = 3 * DAY_MS;
const OTHER = '2f9b4c1e-7d3a-4b8e-9c21-5a6d7e8f9013';
const THIRD = '2f9b4c1e-7d3a-4b8e-9c21-5a6d7e8f9014';

const reserve = (deliveryId, atMs) => ({
  op: 'reserve',
  input: { deliveryId, receivedAtMs: atMs, nowMs: atMs, leaseSeconds: 3 },
});

const run = runInChild({
  mode: 'dedupe',
  ops: [
    reserve(DELIVERY_ID, T0), // 0: 新規
    reserve(DELIVERY_ID, T0 + 1000), // 1: 処理中（lease内）
    reserve(DELIVERY_ID, T0 + LEASE_MS), // 2: leaseUntil ちょうどは、まだ処理中
    reserve(DELIVERY_ID, T0 + LEASE_MS + 1), // 3: leaseUntil の直後は再確保できる
    { op: 'markDone', deliveryId: DELIVERY_ID, leaseUntil: T0 + LEASE_MS }, // 4: 古い試行の done は拒否
    { op: 'markDone', deliveryId: DELIVERY_ID, leaseUntil: T0 + 2 * LEASE_MS + 1 }, // 5: 現在の試行は done にできる
    reserve(DELIVERY_ID, T0 + 4000), // 6: 処理済みは duplicate
    reserve(OTHER, T0), // 7: 別の配信IDで新規
    { op: 'release', deliveryId: OTHER, leaseUntil: T0 + 999 }, // 8: 解放は leaseUntil が一致するときだけ
    reserve(OTHER, T0 + 1), // 9: まだ処理中（解放されていない）
    { op: 'release', deliveryId: OTHER, leaseUntil: T0 + LEASE_MS }, // 10: 一致したので解放
    reserve(OTHER, T0 + 1), // 11: 解放後は新規として確保できる
    reserve(THIRD, T0), // 12: 保持期間の検査用に新規で確保
    { op: 'markDone', deliveryId: THIRD, leaseUntil: T0 + LEASE_MS }, // 13: done にする
    reserve(THIRD, T0 + RETENTION_MS), // 14: 保持期間ちょうどは有効なので duplicate
    reserve(THIRD, T0 + RETENTION_MS + 1), // 15: 1ミリ秒超えたら期限切れとして新規扱い
  ],
});

const [r0, r1, r2, r3, m4, m5, r6, r7, rel8, r9, rel10, r11, r12, m13, r14, r15] = run.results;

test('T017: 新規の配信は確保でき、leaseUntil は受信時刻 + 3秒', () => {
  assert.deepEqual(r0, { outcome: 'reserved', leaseUntil: T0 + LEASE_MS });
});

test('T017: lease内の二度目は duplicate_in_flight。leaseUntil ちょうどはまだ処理中とみなす', () => {
  assert.deepEqual(r1, { outcome: 'duplicate_in_flight' });
  assert.deepEqual(r2, { outcome: 'duplicate_in_flight' });
});

test('T017: leaseUntil を1ミリ秒過ぎた処理中の項目は再確保できる', () => {
  assert.deepEqual(r3, { outcome: 'reserved', leaseUntil: T0 + LEASE_MS + 1 + LEASE_MS });
});

test('T017: 解放や done 更新は leaseUntil が一致する試行だけが行える', () => {
  assert.equal(m4.ok, false);
  assert.equal(m5.ok, true);
});

test('T017: 処理済みの配信は duplicate', () => {
  assert.deepEqual(r6, { outcome: 'duplicate' });
});

test('T017: 解放は leaseUntil が一致する場合だけ効く。一致した解放の後は新規として確保できる', () => {
  assert.deepEqual(r7, { outcome: 'reserved', leaseUntil: T0 + LEASE_MS });
  assert.equal(rel8.ok, true);
  assert.deepEqual(r9, { outcome: 'duplicate_in_flight' });
  assert.equal(rel10.ok, true);
  assert.deepEqual(r11, { outcome: 'reserved', leaseUntil: T0 + 1 + LEASE_MS });
});

test('T017: expiresAt は処理時刻から3日後（秒単位）。ちょうどは有効、1ミリ秒超で期限切れとして新規扱い', () => {
  assert.deepEqual(r12, { outcome: 'reserved', leaseUntil: T0 + LEASE_MS });
  assert.equal(m13.ok, true);
  assert.deepEqual(r14, { outcome: 'duplicate' });
  assert.deepEqual(r15, { outcome: 'reserved', leaseUntil: T0 + RETENTION_MS + 1 + LEASE_MS });
});

test('T017: 保存されるのは許可された5項目だけで、本文とヘッダーの値を含まない', () => {
  for (const keys of run.storedKeys) {
    assert.deepEqual(keys, ['deliveryId', 'expiresAt', 'leaseUntil', 'receivedAt', 'state']);
  }
  const first = run.storedRecords[0];
  assert.equal(first.state, 'processing');
  assert.equal(first.expiresAt, Math.floor((T0 + RETENTION_MS) / 1000));
  assert.equal(first.receivedAt, new Date(T0).toISOString());
});
