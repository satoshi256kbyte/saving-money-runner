import { createHash } from 'node:crypto';

// 重複排除のキー。署名対象の生の本文（受信したバイト列）のSHA-256を、16進の小文字64桁で返す。
// 配信IDは署名されず、新しい値を付けて署名済みの本文を送り直せるため、キーにすると再送を止められない（clarify.md Q-002）。
// 呼び出し側は署名検証の後にだけ呼ぶ。この関数は計算だけで、保存も送信もしない。
export function computeBodyDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
