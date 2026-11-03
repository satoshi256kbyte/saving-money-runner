import type { Classification } from './types';

// clarify.md「応答と診断の契約」の順1〜13と、契約表に無い2件（署名ヘッダー欠落、想定外の例外）を固定する。
// steps は検査順の番号。clarify.md の表で同じ分類が複数の行にある場合は、すべての番号を書く。
// 不正なbase64（clarify.md の表の行 1a）は順1の内部で判定するため、payload_invalid の steps に 1 を含める（判断2）。
export interface ResponseContractRow {
  readonly status: number;
  readonly steps: readonly number[];
}

export const RESPONSE_CONTRACT: Readonly<Record<Classification, ResponseContractRow>> = {
  payload_too_large: { status: 413, steps: [1] },
  unsupported_media_type: { status: 415, steps: [2] },
  event_not_allowed: { status: 400, steps: [3] },
  delivery_id_invalid: { status: 400, steps: [4] },
  signature_missing: { status: 401, steps: [5] },
  signature_malformed: { status: 401, steps: [5] },
  secret_unavailable: { status: 503, steps: [6] },
  signature_mismatch: { status: 401, steps: [7] },
  payload_invalid: { status: 400, steps: [1, 8, 10] },
  ping_accepted: { status: 200, steps: [9] },
  expired: { status: 400, steps: [10] },
  duplicate: { status: 200, steps: [11] },
  duplicate_in_flight: { status: 503, steps: [11] },
  handoff_failed: { status: 503, steps: [12] },
  accepted: { status: 202, steps: [13] },
  internal_error: { status: 500, steps: [] },
};

// 一致させる値のうち、検査順の番号を持つ分類だけを返す。テストで clarify.md と突き合わせる。
export function classificationsForStep(step: number): Classification[] {
  return (Object.keys(RESPONSE_CONTRACT) as Classification[]).filter((classification) =>
    RESPONSE_CONTRACT[classification].steps.includes(step),
  );
}
