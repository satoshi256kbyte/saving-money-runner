// 期限判定（J-1）。受信時刻と、本文の時刻項目の最新の差の絶対値が3日を超えたら拒否する。
// GitHubの配信ヘッダーには署名付きのタイムスタンプが無いため、署名対象のbodyにある時刻を使う（clarify.md Q-001）。
export const MAX_DELIVERY_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// ISO 8601 の日時だけを解釈する。Date.parse は「March 7, 2020」のような形式も読むため、先に形式を限定する。
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const TIME_FIELDS = ['created_at', 'started_at', 'completed_at'] as const;

export type ExpiryResult =
  | { ok: true }
  | { ok: false; classification: 'expired' | 'payload_invalid' };

// created_at は全 action で必須かつ null 不可（plan.md）。解釈できなければ、他の時刻があっても payload_invalid とする
// （implementation-log.md の判断3）。started_at と completed_at は null、欠落、解釈できない値を除外する（T004）。
// 基準は、解釈できた時刻のうち最新の値にする。
export function checkDeliveryExpiry(payload: unknown, receivedAtMs: number): ExpiryResult {
  const latestMs = latestReadableTimeMs(payload);
  if (latestMs === undefined) {
    return { ok: false, classification: 'payload_invalid' };
  }
  if (Math.abs(receivedAtMs - latestMs) > MAX_DELIVERY_AGE_MS) {
    return { ok: false, classification: 'expired' };
  }
  return { ok: true };
}

function readTimeMs(value: unknown): number | undefined {
  if (typeof value !== 'string' || !ISO_8601_PATTERN.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function latestReadableTimeMs(payload: unknown): number | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const job = (payload as Record<string, unknown>).workflow_job;
  if (typeof job !== 'object' || job === null) return undefined;
  const fields = job as Record<string, unknown>;

  const createdMs = readTimeMs(fields.created_at);
  if (createdMs === undefined) return undefined;

  let latest = createdMs;
  for (const field of TIME_FIELDS) {
    if (field === 'created_at') continue;
    const ms = readTimeMs(fields[field]);
    if (ms !== undefined) latest = Math.max(latest, ms);
  }
  return latest;
}
