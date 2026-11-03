import type { Classification, WebhookEvent } from './types';

export type BodyResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; classification: Extract<Classification, 'payload_too_large' | 'payload_invalid'> };

// base64 として正しい文字だけで、パディング（=）は末尾の最大2個。長さの検査は呼び出し側で行う。
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;

// 署名は受信したバイト列そのものに対して計算する。ここではJSONとして解釈しない。
// 上限判定は署名検証より前に行う。isBase64Encoded のときは、復元前に文字列長から復元後のバイト長を求め、
// 上限を超える入力で大きなメモリを確保しないようにする（implementation-log.md の T003）。
export function readRawBody(event: WebhookEvent, maxBodyBytes: number): BodyResult {
  const body = event.body ?? '';

  if (!event.isBase64Encoded) {
    // UTF-16の文字数はUTF-8のバイト数以下なので、文字数が上限を超えたら確実に超過している。
    if (body.length > maxBodyBytes || Buffer.byteLength(body, 'utf8') > maxBodyBytes) {
      return { ok: false, classification: 'payload_too_large' };
    }
    return { ok: true, bytes: Buffer.from(body, 'utf8') };
  }

  // 復元後が上限以下になりうる最大の文字数。これを超えれば、復元する前に拒否する。
  const maxEncodedLength = Math.ceil(maxBodyBytes / 3) * 4;
  if (body.length > maxEncodedLength) {
    return { ok: false, classification: 'payload_too_large' };
  }
  if (body.length % 4 !== 0 || !BASE64_PATTERN.test(body)) {
    return { ok: false, classification: 'payload_invalid' };
  }

  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  const decodedLength = (body.length / 4) * 3 - padding;
  if (decodedLength > maxBodyBytes) {
    return { ok: false, classification: 'payload_too_large' };
  }
  return { ok: true, bytes: Buffer.from(body, 'base64') };
}
