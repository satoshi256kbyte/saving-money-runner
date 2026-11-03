import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SQSClient } from '@aws-sdk/client-sqs';

import { createDynamoDedupeStore } from './dedupe-dynamodb';
import { createWebhookHandler, type WebhookDependencies } from './handler-core';
import { createSqsHandoffQueue } from './handoff-sqs';
import { createSecretProvider } from './secret-provider';
import type { Clock, WebhookEvent, WebhookResponse } from './types';

// Lambda の環境変数の名前。CDK（フェーズ5）がこの名前で設定する。値は秘密ではない（ARN、テーブル名、URL、上限）。
export const ENV_KEYS = {
  secretArn: 'WEBHOOK_SECRET_ARN',
  tableName: 'WEBHOOK_DEDUPE_TABLE_NAME',
  queueUrl: 'WEBHOOK_HANDOFF_QUEUE_URL',
  maxBodyBytes: 'WEBHOOK_MAX_BODY_BYTES',
} as const;

// Lambda のタイムアウトと同じ秒数。確保の leaseUntil に使う（clarify.md Q-002）。
export const LAMBDA_TIMEOUT_SECONDS = 3;

// body 上限の既定と上限（clarify.md J-3）。
export const MAX_BODY_BYTES_LIMIT = 6291456;

// 起動時の失敗は分類コードだけにする。環境変数の名前も値も例外に含めない。
// 注意: この分類は clarify.md の契約表に無い。登録するかどうかは人が決める（implementation-log.md）。
export class StartupConfigError extends Error {
  constructor() {
    super('startup_config_invalid');
    this.name = 'StartupConfigError';
  }
}

export interface WebhookRuntimeConfig {
  secretArn: string;
  tableName: string;
  queueUrl: string;
  maxBodyBytes: number;
}

export function readRuntimeConfig(env: Record<string, string | undefined>): WebhookRuntimeConfig {
  const secretArn = env[ENV_KEYS.secretArn];
  const tableName = env[ENV_KEYS.tableName];
  const queueUrl = env[ENV_KEYS.queueUrl];
  if (!isNonEmpty(secretArn) || !isNonEmpty(tableName) || !isNonEmpty(queueUrl)) {
    throw new StartupConfigError();
  }

  // 数字だけを許す。小数や符号つきの値は、上限の判定を曖昧にするため拒否する。
  const rawMax = env[ENV_KEYS.maxBodyBytes];
  if (rawMax === undefined || !/^\d+$/u.test(rawMax)) {
    throw new StartupConfigError();
  }
  const maxBodyBytes = Number(rawMax);
  if (
    !Number.isSafeInteger(maxBodyBytes) ||
    maxBodyBytes < 1 ||
    maxBodyBytes > MAX_BODY_BYTES_LIMIT
  ) {
    throw new StartupConfigError();
  }

  return { secretArn, tableName, queueUrl, maxBodyBytes };
}

export interface WebhookClients {
  secrets: Pick<SecretsManagerClient, 'send'>;
  dynamo: Pick<DynamoDBClient, 'send'>;
  sqs: Pick<SQSClient, 'send'>;
}

export function createAwsClients(): WebhookClients {
  return {
    secrets: new SecretsManagerClient({}),
    dynamo: new DynamoDBClient({}),
    sqs: new SQSClient({}),
  };
}

// 環境変数の検査は、この関数の呼び出しで行う（Lambdaの初期化時に失敗させるため）。
// SDKのクライアントは最初の呼び出しで作る。読込み時に作らないため、検査のときにAWSの設定を読まない。
export function createLambdaHandler(
  env: Record<string, string | undefined>,
  clients?: WebhookClients,
): (event: WebhookEvent) => Promise<WebhookResponse> {
  const config = readRuntimeConfig(env);
  const clock: Clock = { nowMs: () => Date.now() };

  let handle: ((event: WebhookEvent) => Promise<WebhookResponse>) | undefined;
  return async function lambdaHandler(event: WebhookEvent): Promise<WebhookResponse> {
    if (handle === undefined) {
      handle = createWebhookHandler(dependenciesFor(config, clients ?? createAwsClients(), clock));
    }
    return handle(event);
  };
}

function dependenciesFor(
  config: WebhookRuntimeConfig,
  clients: WebhookClients,
  clock: Clock,
): WebhookDependencies {
  return {
    secrets: createSecretProvider({ client: clients.secrets, secretId: config.secretArn, clock }),
    store: createDynamoDedupeStore({ client: clients.dynamo, tableName: config.tableName }),
    queue: createSqsHandoffQueue({ client: clients.sqs, queueUrl: config.queueUrl }),
    clock,
    // 診断は1行のJSONとして標準出力へ出す。Lambdaではこれが CloudWatch Logs に入る。
    diagnostics: { write: (line: string) => console.log(line) },
    maxBodyBytes: config.maxBodyBytes,
    leaseSeconds: LAMBDA_TIMEOUT_SECONDS,
  };
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

// Lambda の handler の指定先（フェーズ5の CDK で `handler.handler` とする）。
export const handler = createLambdaHandler(process.env);
