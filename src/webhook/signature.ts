import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/iu;

// 受信したバイト列に対するHMAC-SHA256を、候補のSecretごとに計算して定数時間で比較する。
// 一致しても打ち切らず、すべての候補を比較してから結果を返す。
// 長さが違う場合は timingSafeEqual を呼ばずに不一致とする（呼ぶと例外になるため）。
// 呼び出し先は `timingSafeEqual` の名前付き import を通すので、テストでスパイできる。
export function verifyWebhookSignature(
  body: Uint8Array,
  signatureHeader: string,
  secrets: readonly string[],
): boolean {
  const match = SIGNATURE_PATTERN.exec(signatureHeader);
  if (!match?.[1]) {
    return false;
  }
  const provided = Buffer.from(match[1], 'hex');

  let matched = false;
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(body).digest();
    const sameLength = expected.length === provided.length;
    const same = sameLength && timingSafeEqual(expected, provided);
    matched = same || matched;
  }
  return matched;
}
