import type { DedupeRecord, DedupeStore } from './types';

// 保持期間は GitHub の再配信期間（3日）に合わせる（clarify.md Q-002）。
export const DEDUPE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

// 「過ぎた」は厳密な大小比較で判定する。期限の時刻ちょうどは、まだ有効とみなす。
export function isExpired(record: DedupeRecord, nowMs: number): boolean {
  return nowMs > record.expiresAt * 1000;
}

export function isLeaseExpired(record: DedupeRecord, nowMs: number): boolean {
  return nowMs > record.leaseUntil;
}

// 確保できる条件: 項目が無い、expiresAt を過ぎた、または processing かつ leaseUntil を過ぎた。
// DynamoDB の条件式は、この関数と同じ条件を書く（後続フェーズのアダプター）。
export function isAvailableForReservation(
  existing: DedupeRecord | undefined,
  nowMs: number,
): boolean {
  if (existing === undefined) return true;
  if (isExpired(existing, nowMs)) return true;
  return existing.state === 'processing' && isLeaseExpired(existing, nowMs);
}

export type ReserveOutcome =
  | { outcome: 'reserved'; leaseUntil: number }
  | { outcome: 'duplicate' }
  | { outcome: 'duplicate_in_flight' };

export interface ReserveInput {
  deliveryId: string;
  receivedAtMs: number;
  nowMs: number;
  leaseSeconds: number;
}

// 確保の結果を3通りにする。処理済みは duplicate、処理中（leaseUntil 内）は duplicate_in_flight。
// leaseUntil は受信時刻にタイムアウト秒数を足す。expiresAt は処理時刻から3日後（秒単位）。
export async function reserveDelivery(
  store: DedupeStore,
  input: ReserveInput,
): Promise<ReserveOutcome> {
  const leaseUntil = input.receivedAtMs + input.leaseSeconds * 1000;
  const record: DedupeRecord = {
    deliveryId: input.deliveryId,
    state: 'processing',
    leaseUntil,
    receivedAt: new Date(input.receivedAtMs).toISOString(),
    expiresAt: Math.floor((input.nowMs + DEDUPE_RETENTION_MS) / 1000),
  };

  const result = await store.putIfAvailable(record, input.nowMs);
  if (result.written) {
    return { outcome: 'reserved', leaseUntil };
  }
  return result.existing.state === 'done'
    ? { outcome: 'duplicate' }
    : { outcome: 'duplicate_in_flight' };
}

// テスト用と、Lambdaより前の段階の検証用に使うメモリ実装。条件はDynamoDBアダプターと同じ式を使う。
export function createMemoryDedupeStore(): DedupeStore {
  const items = new Map<string, DedupeRecord>();

  return {
    async putIfAvailable(record, nowMs) {
      const existing = items.get(record.deliveryId);
      if (!isAvailableForReservation(existing, nowMs)) {
        if (existing === undefined) {
          throw new Error('availability rule and stored item disagree');
        }
        return { written: false, existing: { ...existing } };
      }
      items.set(record.deliveryId, { ...record });
      return { written: true };
    },

    async markDone(deliveryId, leaseUntil) {
      const existing = items.get(deliveryId);
      if (existing?.state !== 'processing' || existing.leaseUntil !== leaseUntil) {
        throw new Error('lease is not held by this attempt');
      }
      items.set(deliveryId, { ...existing, state: 'done' });
    },

    async release(deliveryId, leaseUntil) {
      const existing = items.get(deliveryId);
      if (existing?.state === 'processing' && existing.leaseUntil === leaseUntil) {
        items.delete(deliveryId);
      }
    },
  };
}
