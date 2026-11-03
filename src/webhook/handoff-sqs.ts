import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

import type { HandoffMessage, HandoffQueue } from './types';

// 後続へ送る項目の許可リスト（plan.md の「後続メッセージの契約」）。
// Record<keyof HandoffMessage, true> にしてあるため、型の項目を増減すると、ここがコンパイルエラーになる。
const HANDOFF_FIELDS: Record<keyof HandoffMessage, true> = {
  schemaVersion: true,
  deliveryId: true,
  event: true,
  receivedAt: true,
  action: true,
  jobId: true,
  runId: true,
  labels: true,
  status: true,
  repositoryId: true,
  repositoryFullName: true,
  installationId: true,
  organizationLogin: true,
};

// 渡された値の余分な項目を送らない。bodyを後続へそのまま渡さないための、送信直前の最後の絞り込み。
export function toHandoffBody(message: HandoffMessage): string {
  const wire: Record<string, unknown> = {};
  for (const field of Object.keys(HANDOFF_FIELDS) as (keyof HandoffMessage)[]) {
    wire[field] = message[field];
  }
  return JSON.stringify(wire);
}

export interface SqsHandoffOptions {
  client: Pick<SQSClient, 'send'>;
  queueUrl: string;
}

// SendMessage を1回だけ使う。失敗は例外のまま渡し、ハンドラーが確保を解放して503にする。
// 標準キューは配信が重複しうるため、後続（Issue #5）は deliveryId で冪等に処理する（plan.md）。
export function createSqsHandoffQueue(options: SqsHandoffOptions): HandoffQueue {
  return {
    async send(message: HandoffMessage): Promise<void> {
      await options.client.send(
        new SendMessageCommand({
          QueueUrl: options.queueUrl,
          MessageBody: toHandoffBody(message),
        }),
      );
    },
  };
}
