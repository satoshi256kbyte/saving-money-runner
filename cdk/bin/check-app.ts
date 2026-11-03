import * as cdk from 'aws-cdk-lib';

import { loadGitHubAppConfig } from '../lib/github-app-config.js';
import { FoundationStack } from '../lib/foundation-stack.js';

// 品質ゲート専用。プレースホルダーのままテンプレートの構造だけを検査する。
// デプロイ経路（cdk.jsonのapp）では使わない。
const config = loadGitHubAppConfig(true);

// 未指定（null）の受信設定を、検査専用の固定値で補ってsynthできるようにする。
// この固定値はこのファイルだけに置き、デプロイ経路（app.ts）からは参照しない。
const CHECK_ONLY_WEBHOOK_RECEIVER = {
  rateLimit: 10,
  burstLimit: 20,
  reservedConcurrency: 5,
};

const app = new cdk.App();
new FoundationStack(app, 'FoundationStack', {
  githubOrganization: config.organization,
  githubAppName: config.appName,
  adminRoleArn: config.adminRoleArn,
  additionalReaderRoleArns: config.additionalReaderRoleArns,
  webhookReceiver: {
    rateLimit: config.webhookReceiver.rateLimit ?? CHECK_ONLY_WEBHOOK_RECEIVER.rateLimit,
    burstLimit: config.webhookReceiver.burstLimit ?? CHECK_ONLY_WEBHOOK_RECEIVER.burstLimit,
    reservedConcurrency:
      config.webhookReceiver.reservedConcurrency ?? CHECK_ONLY_WEBHOOK_RECEIVER.reservedConcurrency,
    maxBodyBytes: config.webhookReceiver.maxBodyBytes,
  },
});
