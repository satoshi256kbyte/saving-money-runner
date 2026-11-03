import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'corepack',
  [
    'pnpm',
    'exec',
    'cdk',
    'synth',
    '--app',
    'tsx cdk/bin/check-app.ts',
    '--output',
    'cdk.out',
    '--quiet',
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(`AWS CDKを実行できません: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const template = JSON.parse(readFileSync(join('cdk.out', 'FoundationStack.template.json'), 'utf8'));
const secretResources = Object.values(template.Resources ?? {}).filter(
  (resource) => resource.Type === 'AWS::SecretsManager::Secret',
);
if (secretResources.length !== 1 || !secretResources[0].Properties?.GenerateSecretString) {
  console.error('GitHub App Webhook Secretの生成定義が不正です');
  process.exit(1);
}
const secretResource = secretResources[0];
if (secretResource.DeletionPolicy !== 'Retain' || secretResource.UpdateReplacePolicy !== 'Retain') {
  console.error('GitHub App Webhook Secretの保持ポリシーがRetainではありません');
  process.exit(1);
}
if (secretResource.Properties.Name !== 'saving-money-runner/github-app/webhook') {
  console.error('GitHub App Webhook Secretの物理名が不正です');
  process.exit(1);
}
const templateText = JSON.stringify(template);
if (
  /"SecretString"\s*:/u.test(templateText) ||
  /"PrivateKey"\s*:/u.test(templateText) ||
  /AWS_SECRET_ACCESS_KEY/iu.test(templateText) ||
  /github_pat_/iu.test(templateText)
) {
  console.error('CDKテンプレートへ機密値の形式が含まれています');
  process.exit(1);
}
const secretArnOutput = Object.values(template.Outputs ?? {}).find((output) =>
  (output.Description ?? '').includes('Secret ARN'),
);
const secretLogicalId = Object.keys(template.Resources ?? {}).find(
  (key) => template.Resources[key] === secretResource,
);
if (secretLogicalId === undefined || secretArnOutput?.Value?.Ref !== secretLogicalId) {
  console.error('GitHub App Webhook Secret ARNの出力値が唯一のSecretリソースを参照していません');
  process.exit(1);
}
const outputDescriptions = Object.values(template.Outputs ?? {}).map(
  (output) => output.Description ?? '',
);
if (!outputDescriptions.some((description) => description.includes('Secret ARN'))) {
  console.error('GitHub App Webhook Secret ARNの出力がありません');
  process.exit(1);
}
if (!outputDescriptions.some((description) => description.includes('Organization'))) {
  console.error('GitHub App Organizationの出力がありません');
  process.exit(1);
}
if (!outputDescriptions.some((description) => description.includes('App名'))) {
  console.error('GitHub App名の出力がありません');
  process.exit(1);
}
if (!Object.keys(template.Outputs ?? {}).some((key) => key.includes('GitHubAppWebhookUrl'))) {
  console.error('GitHubAppWebhookUrlの出力がありません');
  process.exit(1);
}
