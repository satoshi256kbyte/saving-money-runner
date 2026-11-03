import * as cdk from 'aws-cdk-lib';

import { loadGitHubAppConfig } from '../lib/github-app-config.js';
import { FoundationStack } from '../lib/foundation-stack.js';

// デプロイ経路。プレースホルダーは環境変数に関係なく拒否する。
const config = loadGitHubAppConfig(false);

// loadGitHubAppConfig(false) が未指定（null）を拒否済み。ここでは型を数値に絞る。
const { rateLimit, burstLimit, reservedConcurrency, maxBodyBytes } = config.webhookReceiver;
if (rateLimit === null || burstLimit === null || reservedConcurrency === null) {
  throw new Error('webhookReceiverの必須項目が未指定です');
}

const app = new cdk.App();
new FoundationStack(app, 'FoundationStack', {
  githubOrganization: config.organization,
  githubAppName: config.appName,
  adminRoleArn: config.adminRoleArn,
  additionalReaderRoleArns: config.additionalReaderRoleArns,
  webhookReceiver: { rateLimit, burstLimit, reservedConcurrency, maxBodyBytes },
});
