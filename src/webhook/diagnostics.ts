import type { Classification } from './types';

// 診断に出してよいキーの許可リスト。これ以外のキーは出力に含めない。
export const DIAGNOSTIC_KEYS = [
  'classification',
  'status',
  'deliveryId',
  'durationMs',
  'requestId',
] as const;

export interface DiagnosticInput {
  classification: Classification;
  status: number;
  // GUID形式を検証した後だけ渡す。未検証の値は渡さない。
  deliveryId?: string;
  durationMs: number;
  requestId?: string;
}

// 1行のJSONにする。値はすべて分類、数値、検証済みのIDだけで、入力のbodyやヘッダーを含まない。
export function buildDiagnosticLine(input: DiagnosticInput): string {
  const entry: Record<string, string | number> = {
    classification: input.classification,
    status: input.status,
    durationMs: input.durationMs,
  };
  if (input.deliveryId !== undefined) entry.deliveryId = input.deliveryId;
  if (input.requestId !== undefined) entry.requestId = input.requestId;
  return JSON.stringify(entry);
}
