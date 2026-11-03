import * as cdk from 'aws-cdk-lib';

import { loadGitHubAppConfig } from '../lib/github-app-config.js';
import { FoundationStack } from '../lib/foundation-stack.js';

// 品質ゲート専用。プレースホルダーのままテンプレートの構造だけを検査する。
// デプロイ経路（cdk.jsonのapp）では使わない。
const config = loadGitHubAppConfig(true);

const app = new cdk.App();
new FoundationStack(app, 'FoundationStack', {
  githubOrganization: config.organization,
  githubAppName: config.appName,
  adminRoleArn: config.adminRoleArn,
  additionalReaderRoleArns: config.additionalReaderRoleArns,
});
