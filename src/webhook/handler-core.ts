import { buildDiagnosticLine } from './diagnostics';
import { computeBodyDigest } from './body-digest';
import { checkDeliveryExpiry } from './expiry';
import { checkRequestHeaders, isValidDeliveryId, normalizeHeaderNames } from './headers';
import { RESPONSE_CONTRACT } from './contract';
import { readRawBody } from './body';
import { extractWorkflowJobMessage, parseJsonBody } from './message';
import { reserveDelivery } from './dedupe';
import { verifyWebhookSignature } from './signature';
import type {
  Classification,
  Clock,
  DedupeStore,
  DiagnosticSink,
  HandoffQueue,
  SecretSource,
  WebhookEvent,
  WebhookResponse,
} from './types';

export interface WebhookDependencies {
  secrets: SecretSource;
  store: DedupeStore;
  queue: HandoffQueue;
  clock: Clock;
  diagnostics: DiagnosticSink;
  maxBodyBytes: number;
  leaseSeconds: number;
}

// 検査は clarify.md の順1〜13に従い、失敗した時点で終了する。
// 署名検証を通過するまで、bodyの内容を使わない。
export function createWebhookHandler(deps: WebhookDependencies) {
  return async function handle(event: WebhookEvent): Promise<WebhookResponse> {
    // 開始時刻と入力の読取りも try の中で行う。時計や入力が想定外でも、例外を外へ漏らさず500で返すため。
    let startMs = 0;
    let requestId: string | undefined;
    let verifiedDeliveryId: string | undefined;

    const respond = (classification: Classification, deliveryId?: string): WebhookResponse => {
      const { status } = RESPONSE_CONTRACT[classification];
      deps.diagnostics.write(
        buildDiagnosticLine({
          classification,
          status,
          deliveryId,
          durationMs: Math.max(0, deps.clock.nowMs() - startMs),
          requestId,
        }),
      );
      return { statusCode: status, body: JSON.stringify({ classification }) };
    };

    try {
      startMs = deps.clock.nowMs();
      requestId = event.requestContext?.requestId;
      const headers = normalizeHeaderNames(event.headers ?? {});
      // 診断に出す配信IDは、GUID形式を検証できたものだけにする。
      const candidateDeliveryId = headers['x-github-delivery'];
      verifiedDeliveryId = isValidDeliveryId(candidateDeliveryId) ? candidateDeliveryId : undefined;

      // 順1: 長さの上限（署名検証より前）
      const body = readRawBody(event, deps.maxBodyBytes);
      if (!body.ok) return respond(body.classification, verifiedDeliveryId);

      // 順2〜5: ヘッダーだけで判定する。Secretは取得しない。
      const checked = checkRequestHeaders(headers);
      if (!checked.ok) return respond(checked.classification, verifiedDeliveryId);
      const deliveryId = checked.value.deliveryId;

      // 順6: Secretの取得。取得の失敗はどの例外でも 503 にする。
      let secrets: readonly string[];
      try {
        secrets = await deps.secrets.getSigningSecrets();
      } catch {
        return respond('secret_unavailable', deliveryId);
      }

      // 順7: 署名の検証（受信したバイト列に対して計算する）
      if (!verifyWebhookSignature(body.bytes, checked.value.signatureHeader, secrets)) {
        return respond('signature_mismatch', deliveryId);
      }

      // 署名を通過した本文だけ、重複排除のキーを計算する。ここは計算だけで、書き込みはしない。
      // 同じ署名対象のバイト列から計算するため、配信IDを変えて送り直した同じ本文は同じキーになる。
      const bodyDigest = computeBodyDigest(body.bytes);

      // 順8: JSONとして解釈できるか（ping を含む）
      const parsed = parseJsonBody(body.bytes);
      if (!parsed.ok) return respond('payload_invalid', deliveryId);

      // 順9: ping は受理して終了する。後続へ渡さず、抽出と期限判定も適用しない。
      if (checked.value.event === 'ping') return respond('ping_accepted', deliveryId);

      // 順10: workflow_job の抽出（許可リスト）と期限判定
      const receivedAtMs = startMs;
      const receivedAt = new Date(receivedAtMs).toISOString();
      const extracted = extractWorkflowJobMessage(parsed.value, deliveryId, receivedAt, bodyDigest);
      if (!extracted.ok) return respond(extracted.classification, deliveryId);
      const expiry = checkDeliveryExpiry(parsed.value, receivedAtMs);
      if (!expiry.ok) return respond(expiry.classification, deliveryId);

      // 順11: 重複排除の確保（キーは本文のダイジェスト。配信IDは診断用の属性として保存する）
      const reservation = await reserveDelivery(deps.store, {
        deliveryId,
        bodyDigest,
        receivedAtMs,
        nowMs: deps.clock.nowMs(),
        leaseSeconds: deps.leaseSeconds,
      });
      if (reservation.outcome !== 'reserved') {
        return respond(
          reservation.outcome === 'duplicate' ? 'duplicate' : 'duplicate_in_flight',
          deliveryId,
        );
      }
      const lease = reservation.leaseUntil;

      // 順12: 後続への引き渡し。失敗したら確保を解放して、再配信で再試行できるようにする。
      try {
        await deps.queue.send(extracted.message);
      } catch {
        await releaseLease(deps.store, bodyDigest, lease);
        return respond('handoff_failed', deliveryId);
      }
      // done の更新に失敗したら、確保を解放して503にする。引き渡し済みの配信は再配信で二重になりうるため、
      // 後続（Issue #5）が bodyDigest で冪等に処理する（plan.md の「Issue #5への冪等性の要請」）。
      try {
        await deps.store.markDone(bodyDigest, lease);
      } catch {
        await releaseLease(deps.store, bodyDigest, lease);
        return respond('handoff_failed', deliveryId);
      }

      // 順13: 受理
      return respond('accepted', deliveryId);
    } catch {
      // 想定外の例外は分類だけを返す。メッセージとスタックは応答にも診断にも出さない。
      return respond('internal_error', verifiedDeliveryId);
    }
  };
}

// 解放の失敗は握りつぶす。確保の leaseUntil を過ぎれば、同じ本文のキーは再確保できるため、影響は次の試行までに限られる。
async function releaseLease(store: DedupeStore, bodyDigest: string, leaseUntil: number) {
  try {
    await store.release(bodyDigest, leaseUntil);
  } catch {
    // 意図的に無視する。上の理由により、失敗した解放で配信が永久に塞がることは無い。
  }
}
