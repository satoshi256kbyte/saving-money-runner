// Webhook受信の純粋ロジックが使う型とポート。AWS SDKの型は含めない。
// AWS SDKの実装は後続のフェーズで、これらのポートを満たすアダプターとして作る。

// 診断の分類。値は clarify.md の「応答と診断の契約」と一致させる（contract.ts で固定する）。
export type Classification =
  | 'accepted'
  | 'ping_accepted'
  | 'duplicate'
  | 'duplicate_in_flight'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'event_not_allowed'
  | 'delivery_id_invalid'
  | 'signature_missing'
  | 'signature_malformed'
  | 'secret_unavailable'
  | 'signature_mismatch'
  | 'payload_invalid'
  | 'expired'
  | 'handoff_failed'
  | 'internal_error';

// API Gateway HTTP API の payload format 2.0 で受け取る入力のうち、使う項目だけを書く。
// ヘッダー名は小文字に正規化されて届く（clarify.md A3）。
export interface WebhookEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: { requestId?: string };
}

export interface WebhookResponse {
  statusCode: number;
  body: string;
}

// Secretの候補（AWSCURRENT と、存在すれば AWSPENDING）を返す。取得に失敗したら例外を投げる。
export interface SecretSource {
  getSigningSecrets(): Promise<readonly string[]>;
}

// 後続（Issue #5）へ渡すメッセージ。plan.md の「後続メッセージの契約」と一致させる。
export interface HandoffMessage {
  schemaVersion: 1;
  deliveryId: string;
  event: 'workflow_job';
  receivedAt: string;
  action: string;
  jobId: number;
  runId: number;
  labels: string[];
  status: string;
  repositoryId: number;
  repositoryFullName: string;
  installationId: number | null;
  organizationLogin: string | null;
}

export interface HandoffQueue {
  send(message: HandoffMessage): Promise<void>;
}

export interface Clock {
  nowMs(): number;
}

// 1行のJSON文字列を受け取る出力先。Lambdaでは標準出力になる。
export interface DiagnosticSink {
  write(line: string): void;
}

export type DedupeState = 'processing' | 'done';

// 重複排除の1項目。bodyとヘッダーの値は含めない。
// leaseUntil はエポックのミリ秒、expiresAt は DynamoDB TTL に合わせてエポックの秒。
export interface DedupeRecord {
  deliveryId: string;
  state: DedupeState;
  leaseUntil: number;
  receivedAt: string;
  expiresAt: number;
}

export type ReserveResult = { written: true } | { written: false; existing: DedupeRecord };

export interface DedupeStore {
  // 確保の条件（項目が無い、expiresAt を過ぎた、processing かつ leaseUntil を過ぎた）を満たすときだけ書く。
  putIfAvailable(record: DedupeRecord, nowMs: number): Promise<ReserveResult>;
  // leaseUntil が一致する場合だけ done にする。一致しなければ例外を投げる。
  markDone(deliveryId: string, leaseUntil: number): Promise<void>;
  // leaseUntil が一致する場合だけ削除する。一致しなければ何もしない。
  release(deliveryId: string, leaseUntil: number): Promise<void>;
}
