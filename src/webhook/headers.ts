import type { Classification } from './types';

export type HeaderMap = Record<string, string | undefined>;

export type AcceptedEvent = 'workflow_job' | 'ping';

export interface CheckedHeaders {
  event: AcceptedEvent;
  deliveryId: string;
  signatureHeader: string;
}

export type HeaderResult =
  | { ok: true; value: CheckedHeaders }
  | {
      ok: false;
      classification: Extract<
        Classification,
        | 'unsupported_media_type'
        | 'event_not_allowed'
        | 'delivery_id_invalid'
        | 'signature_missing'
        | 'signature_malformed'
      >;
    };

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
// 連結されたカンマ区切りの値（重複した署名ヘッダー）は、この形式に一致しないため拒否される。
const SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/iu;

export function isValidDeliveryId(value: string | undefined): value is string {
  return value !== undefined && GUID_PATTERN.test(value);
}

// ヘッダー名は小文字に正規化して読む。値の検査はbodyの内容を使わない。
// X-Hub-Signature（SHA-1）は読まない（clarify.md の追加で確認した事項）。
export function checkRequestHeaders(headers: HeaderMap): HeaderResult {
  const normalized = normalizeHeaderNames(headers);

  const mediaType = (normalized['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return { ok: false, classification: 'unsupported_media_type' };
  }

  const event = normalized['x-github-event'];
  if (event !== 'workflow_job' && event !== 'ping') {
    return { ok: false, classification: 'event_not_allowed' };
  }

  const deliveryId = normalized['x-github-delivery'];
  if (!isValidDeliveryId(deliveryId)) {
    return { ok: false, classification: 'delivery_id_invalid' };
  }

  const signatureHeader = normalized['x-hub-signature-256'];
  if (signatureHeader === undefined || signatureHeader === '') {
    return { ok: false, classification: 'signature_missing' };
  }
  if (!SIGNATURE_PATTERN.test(signatureHeader)) {
    return { ok: false, classification: 'signature_malformed' };
  }

  return { ok: true, value: { event, deliveryId, signatureHeader } };
}

export function normalizeHeaderNames(headers: HeaderMap): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name.toLowerCase()] = value;
  }
  return result;
}
