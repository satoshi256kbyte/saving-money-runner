import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';

// tsxのローダーをテストプロセスへ直接登録すると循環参照で失敗するため、
// CDKのTypeScriptは子プロセスで読み込み、テンプレートだけをJSONで受け取る。
const root = process.cwd();
const stackPath = join(root, 'cdk', 'lib', 'foundation-stack.ts');
const adminRoleArn =
  [['arn', 'aws', 'iam'].join(':'), '::', '1'.repeat(12), ':role/'].join('') +
  'saving-money-runner-test-admin';

function synthTemplate(additionalReaderRoleArns) {
  const script = `
import { createRequire } from 'node:module';
const require = createRequire(${JSON.stringify(stackPath)});
const { App } = require('aws-cdk-lib');
const { Template } = require('aws-cdk-lib/assertions');
const { FoundationStack } = require(${JSON.stringify(stackPath)});

const app = new App();
const stack = new FoundationStack(app, 'FoundationStack', {
  githubOrganization: 'example-org',
  githubAppName: 'saving-money-runner',
  adminRoleArn: ${JSON.stringify(adminRoleArn)},
  additionalReaderRoleArns: ${JSON.stringify(additionalReaderRoleArns)},
  webhookReceiver: { rateLimit: 10, burstLimit: 20, reservedConcurrency: 5, maxBodyBytes: 6291456 },
});
const template = Template.fromStack(stack);
process.stdout.write(JSON.stringify(template.toJSON()));
`;
  return JSON.parse(
    execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

function secretDenyStatement(template) {
  const resourcePolicy = Object.values(template.Resources).find(
    (resource) => resource.Type === 'AWS::SecretsManager::ResourcePolicy',
  );
  assert.ok(resourcePolicy, 'Secretのリソースポリシーがない');
  return resourcePolicy.Properties.ResourcePolicy.Statement.find((item) => item.Effect === 'Deny');
}

// 受信ロールはStack内で作るためARNがトークンになる。論理IDの参照で照合する。
function webhookRoleRef(template) {
  const roleId = Object.keys(template.Resources).find(
    (key) =>
      template.Resources[key].Type === 'AWS::IAM::Role' && key.includes('WebhookReceiverRole'),
  );
  assert.ok(roleId, 'Webhook受信ロールがない');
  return { 'Fn::GetAtt': [roleId, 'Arn'] };
}

const template = synthTemplate([]);
const secrets = Object.entries(template.Resources).filter(
  ([, resource]) => resource.Type === 'AWS::SecretsManager::Secret',
);

test('Webhook Secretは1件だけ作成し、固定名と保持ポリシーを持つ', () => {
  assert.equal(secrets.length, 1);
  const [logicalId, secret] = secrets[0];
  assert.equal(secret.Properties.Name, 'saving-money-runner/github-app/webhook');
  assert.ok(secret.Properties.GenerateSecretString, '実値を置かず生成定義だけを持つ');
  assert.equal(secret.DeletionPolicy, 'Retain');
  assert.equal(secret.UpdateReplacePolicy, 'Retain');
  assert.ok(logicalId.includes('WebhookSecret'));
});

test('Secret ARNのOutputは唯一のSecretリソースをRefで参照する', () => {
  const [logicalId] = secrets[0];
  const arnOutput = Object.values(template.Outputs).find((output) =>
    (output.Description ?? '').includes('Secret ARN'),
  );
  assert.deepEqual(arnOutput.Value, { Ref: logicalId });
});

test('Organization・App名のOutputは入力値を参照し、Secret実値を含まない', () => {
  const outputs = Object.values(template.Outputs);
  assert.ok(
    outputs.find((output) => output.Value === 'example-org'),
    'Organizationの出力がない',
  );
  assert.ok(
    outputs.find((output) => output.Value === 'saving-money-runner'),
    'App名の出力がない',
  );
  assert.doesNotMatch(JSON.stringify(template.Outputs), /SecretString/u);
});

test('Secretの読取りは管理者ロールと受信ロールだけに限定し、それ以外のGetSecretValueを拒否する', () => {
  const statement = secretDenyStatement(template);
  assert.deepEqual(statement.Action, 'secretsmanager:GetSecretValue');
  const [logicalId] = secrets[0];
  assert.deepEqual(statement.Resource, { Ref: logicalId });
  assert.deepEqual(statement.Condition.ArnNotLike['aws:PrincipalArn'], [
    adminRoleArn,
    webhookRoleRef(template),
  ]);
});

test('Webhook処理ロールを追加すると、Secretの読取り許可に管理者と並べて含まれる', () => {
  const extraRole = [
    ['arn', 'aws', 'iam'].join(':'),
    '::',
    '1'.repeat(12),
    ':role/webhook-reader',
  ].join('');
  const extended = synthTemplate([extraRole]);
  assert.deepEqual(secretDenyStatement(extended).Condition.ArnNotLike['aws:PrincipalArn'], [
    adminRoleArn,
    extraRole,
    webhookRoleRef(extended),
  ]);
});

test('読取りを許可するロールARNにワイルドカードや別種のARNを渡すと合成を拒否する', () => {
  const userArn = [['arn', 'aws', 'iam'].join(':'), '::', '1'.repeat(12), ':user/alice'].join('');
  for (const invalid of ['*', userArn]) {
    assert.throws(() => synthTemplate([invalid]), /読取りを許可するロールARNが不正です/u);
  }
});
