import {
  DeleteItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  type AttributeValue,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

import type { DedupeRecord, DedupeStore, ReserveResult } from './types';

// 確保の条件。dedupe.ts の isAvailableForReservation と同じ条件を、DynamoDB の式で書く。
// expiresAt は秒、leaseUntil は ミリ秒で保存する。秒の比較は :nowSeconds（小数点以下3桁のミリ秒つき）で行う。
export const RESERVE_CONDITION_EXPRESSION =
  'attribute_not_exists(deliveryId) OR expiresAt < :nowSeconds OR (#state = :processing AND leaseUntil < :nowMs)';

// 解放と完了の条件。確保した試行の leaseUntil が一致するときだけ変更する（他の試行の状態を変えないため）。
export const LEASE_MATCH_CONDITION_EXPRESSION = '#state = :processing AND leaseUntil = :leaseUntil';

export interface DynamoDedupeOptions {
  client: Pick<DynamoDBClient, 'send'>;
  tableName: string;
}

// GetItem、Query、Scan は使わない。読むのは条件付き書き込みの失敗時に返される既存項目だけ。
export function createDynamoDedupeStore(options: DynamoDedupeOptions): DedupeStore {
  const { client, tableName } = options;

  return {
    async putIfAvailable(record: DedupeRecord, nowMs: number): Promise<ReserveResult> {
      try {
        await client.send(
          new PutItemCommand({
            TableName: tableName,
            Item: {
              deliveryId: { S: record.deliveryId },
              state: { S: record.state },
              leaseUntil: { N: String(record.leaseUntil) },
              receivedAt: { S: record.receivedAt },
              expiresAt: { N: String(record.expiresAt) },
            },
            ConditionExpression: RESERVE_CONDITION_EXPRESSION,
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: {
              ':processing': { S: 'processing' },
              ':nowSeconds': { N: exactSecondsString(nowMs) },
              ':nowMs': { N: String(nowMs) },
            },
            // 条件が失敗したとき、既存項目を返させる。処理済みか処理中かを判定するため。
            ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
          }),
        );
        return { written: true };
      } catch (error) {
        if (!isNamed(error, 'ConditionalCheckFailedException')) throw error;
        return { written: false, existing: toRecord(readItem(error)) };
      }
    },

    async markDone(deliveryId: string, leaseUntil: number): Promise<void> {
      // 条件に合わない場合は例外のまま渡す。呼び出し側（ハンドラー）が確保を解放して503にする。
      await client.send(
        new UpdateItemCommand({
          TableName: tableName,
          Key: { deliveryId: { S: deliveryId } },
          UpdateExpression: 'SET #state = :done',
          ConditionExpression: LEASE_MATCH_CONDITION_EXPRESSION,
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':done': { S: 'done' },
            ':processing': { S: 'processing' },
            ':leaseUntil': { N: String(leaseUntil) },
          },
        }),
      );
    },

    async release(deliveryId: string, leaseUntil: number): Promise<void> {
      try {
        await client.send(
          new DeleteItemCommand({
            TableName: tableName,
            Key: { deliveryId: { S: deliveryId } },
            ConditionExpression: LEASE_MATCH_CONDITION_EXPRESSION,
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: {
              ':processing': { S: 'processing' },
              ':leaseUntil': { N: String(leaseUntil) },
            },
          }),
        );
      } catch (error) {
        // 他の試行が確保している、または既に消えている場合は何もしない（メモリ実装と同じ扱い）。
        if (!isNamed(error, 'ConditionalCheckFailedException')) throw error;
      }
    },
  };
}

// 整数のミリ秒を、小数点以下3桁の秒の文字列にする。浮動小数点の誤差を入れないため。
function exactSecondsString(nowMs: number): string {
  if (!Number.isSafeInteger(nowMs)) {
    throw new TypeError('nowMs must be a safe integer');
  }
  const seconds = Math.floor(nowMs / 1000);
  const millis = nowMs - seconds * 1000;
  return `${seconds}.${String(millis).padStart(3, '0')}`;
}

function readItem(error: unknown): Record<string, AttributeValue> {
  const item = (error as { Item?: Record<string, AttributeValue> }).Item;
  if (item === undefined) {
    // 既存項目が無ければ判定できない。ハンドラーの想定外の例外（500）として扱う。
    throw new Error('existing item missing from condition failure');
  }
  return item;
}

// 保存された項目を DedupeRecord にする。形式が合わなければ例外にする（判定の根拠が無いため）。
function toRecord(item: Record<string, AttributeValue>): DedupeRecord {
  const deliveryId = item.deliveryId?.S;
  const state = item.state?.S;
  const receivedAt = item.receivedAt?.S;
  const leaseUntil = Number(item.leaseUntil?.N);
  const expiresAt = Number(item.expiresAt?.N);
  if (
    deliveryId === undefined ||
    (state !== 'processing' && state !== 'done') ||
    receivedAt === undefined ||
    !Number.isFinite(leaseUntil) ||
    !Number.isFinite(expiresAt)
  ) {
    throw new Error('stored dedupe item has an unexpected shape');
  }
  return { deliveryId, state, leaseUntil, receivedAt, expiresAt };
}

function isNamed(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name;
}
