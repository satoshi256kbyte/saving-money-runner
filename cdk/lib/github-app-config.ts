import { readFileSync } from 'node:fs';

import {
  assertReaderRolesInAccount,
  DEFAULT_MAX_BODY_BYTES,
  validateGitHubAppConfig,
} from '../../scripts/github-app/validate-config.mjs';

export interface WebhookReceiverSettings {
  readonly rateLimit: number | null;
  readonly burstLimit: number | null;
  readonly reservedConcurrency: number | null;
  readonly maxBodyBytes: number;
}

export interface GitHubAppConfig {
  readonly organization: string;
  readonly appName: string;
  readonly adminRoleArn: string;
  readonly additionalReaderRoleArns: string[];
  readonly webhookReceiver: WebhookReceiverSettings;
}

const requiredWebhookReceiverKeys = ['rateLimit', 'burstLimit', 'reservedConcurrency'] as const;

/**
 * 顧客ごとに決める3項目が、デプロイの前に決められているかを確認する。
 * nullと欠落を同じ扱いにするのは、どちらも「まだ決めていない」を意味するため。
 * エラーには項目名だけを出し、値は出さない。
 */
export function assertWebhookReceiverDeployable(
  webhookReceiver: Record<string, unknown> | undefined,
): void {
  const undecided = requiredWebhookReceiverKeys.filter((key) => {
    const value = webhookReceiver?.[key];
    return value === undefined || value === null;
  });
  if (undecided.length > 0) {
    throw new Error(
      `webhookReceiverの次の項目が未指定です。実デプロイの前に正の整数で設定してください: ${undecided.join(', ')}`,
    );
  }
}

/**
 * 設定例を読み込み、検証する。プレースホルダーと未決の受信設定を許すかは呼び出し側が決める。
 * 実デプロイの経路では許さず、品質ゲートの検証synthだけが許可する。
 */
export function loadGitHubAppConfig(allowPlaceholder: boolean): GitHubAppConfig {
  const config = JSON.parse(
    readFileSync(new URL('../../config/github-app.example.json', import.meta.url), 'utf8'),
  );
  validateGitHubAppConfig(config);
  if (
    !allowPlaceholder &&
    (config.organization === '<ORGANIZATION>' || config.adminRoleArn === '<ADMIN_ROLE_ARN>')
  ) {
    throw new Error(
      '組織名または管理者ロールARNがプレースホルダーのままです。実デプロイ前に置き換えてください',
    );
  }
  if (!allowPlaceholder) {
    assertWebhookReceiverDeployable(config.webhookReceiver);
    // CDKのCLIがデプロイ先のアカウントを環境変数で渡す。ロールがそれ以外のアカウントなら拒否する。
    assertReaderRolesInAccount(config, process.env.CDK_DEFAULT_ACCOUNT);
  }
  return {
    ...config,
    webhookReceiver: {
      ...config.webhookReceiver,
      maxBodyBytes: config.webhookReceiver.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    },
  };
}
