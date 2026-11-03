import * as cdk from 'aws-cdk-lib';

import { loadGitHubAppConfig } from '../lib/github-app-config.js';
import { FoundationStack } from '../lib/foundation-stack.js';

// デプロイ経路。プレースホルダーは環境変数に関係なく拒否する。
const config = loadGitHubAppConfig(false);

const app = new cdk.App();
new FoundationStack(app, 'FoundationStack', {
  githubOrganization: config.organization,
  githubAppName: config.appName,
  adminRoleArn: config.adminRoleArn,
  additionalReaderRoleArns: config.additionalReaderRoleArns,
});
