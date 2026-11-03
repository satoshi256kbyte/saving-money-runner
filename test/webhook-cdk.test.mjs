import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// 既存の github-app-cdk.test.mjs と同じく、CDKのTypeScriptは子プロセスで読み、テンプレートだけをJSONで受け取る。
const root = process.cwd();
const stackPath = join(root, 'cdk', 'lib', 'foundation-stack.ts');
const arnPrefix = ['arn', 'aws', 'iam'].join(':');
const adminRoleArn = `${arnPrefix}::${'1'.repeat(12)}:role/saving-money-runner-test-admin`;
const extraReaderRoleArn = `${arnPrefix}::${'1'.repeat(12)}:role/webhook-reader`;

// 子プロセスには実行に必要な変数だけを渡し、AWSの認証や既定アカウントの変数は渡さない。
const childEnv = Object.fromEntries(
  Object.entries({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
  }).filter(([, value]) => value !== undefined),
);

function synthTemplate(additionalReaderRoleArns = []) {
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
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

const template = synthTemplate();

function resourcesOfType(type) {
  return Object.entries(template.Resources).filter(([, resource]) => resource.Type === type);
}

// 同じ種類のリソースが1件だけであることを前提に取り出す。件数が違えば検査を失敗させる。
function onlyOne(type) {
  const found = resourcesOfType(type);
  assert.equal(found.length, 1, `${type}が1件ではありません: ${found.length}件`);
  return found[0];
}

function findOutput(keyPart) {
  const entry = Object.entries(template.Outputs).find(([key]) => key.includes(keyPart));
  assert.ok(entry, `Outputがありません: ${keyPart}`);
  return entry[1];
}

test('HTTP APIはHTTPプロトコルで1つ作られ、POST /webhookのルートだけを持つ', () => {
  const [, api] = onlyOne('AWS::ApiGatewayV2::Api');
  assert.equal(api.Properties.ProtocolType, 'HTTP');
  const routes = resourcesOfType('AWS::ApiGatewayV2::Route');
  assert.equal(routes.length, 1);
  assert.equal(routes[0][1].Properties.RouteKey, 'POST /webhook');
});

test('$defaultステージは自動デプロイし、レートとバーストを設定値どおりに持ち、アクセスログを持たない', () => {
  const [, stage] = onlyOne('AWS::ApiGatewayV2::Stage');
  assert.equal(stage.Properties.StageName, '$default');
  assert.equal(stage.Properties.AutoDeploy, true);
  assert.deepEqual(stage.Properties.DefaultRouteSettings, {
    ThrottlingRateLimit: 10,
    ThrottlingBurstLimit: 20,
  });
  assert.equal(stage.Properties.AccessLogSettings, undefined);
});

test('受信Lambdaは Node.js 22、タイムアウト3秒、予約同時実行数5で、作成したロググループを使う', () => {
  const [, fn] = onlyOne('AWS::Lambda::Function');
  const [logGroupId] = onlyOne('AWS::Logs::LogGroup');
  assert.equal(fn.Properties.Runtime, 'nodejs22.x');
  assert.equal(fn.Properties.Timeout, 3);
  assert.equal(fn.Properties.ReservedConcurrentExecutions, 5);
  assert.deepEqual(fn.Properties.LoggingConfig.LogGroup, { Ref: logGroupId });
});

test('重複排除テーブルは bodyDigest を鍵にし、オンデマンド課金とexpiresAtのTTLを持ち、削除ポリシーはDeleteである', () => {
  const [, table] = onlyOne('AWS::DynamoDB::Table');
  assert.deepEqual(table.Properties.KeySchema, [{ AttributeName: 'bodyDigest', KeyType: 'HASH' }]);
  assert.equal(table.Properties.BillingMode, 'PAY_PER_REQUEST');
  assert.deepEqual(table.Properties.TimeToLiveSpecification, {
    AttributeName: 'expiresAt',
    Enabled: true,
  });
  assert.equal(table.DeletionPolicy, 'Delete');
});

test('後続キューは保持4日、SQS管理の暗号化、再配信先のDLQなしで、非TLSを拒否するポリシーを持つ', () => {
  const [, queue] = onlyOne('AWS::SQS::Queue');
  assert.equal(queue.Properties.MessageRetentionPeriod, 4 * 24 * 60 * 60);
  assert.equal(queue.Properties.SqsManagedSseEnabled, true);
  assert.equal(queue.Properties.RedrivePolicy, undefined);
  const [, queuePolicy] = onlyOne('AWS::SQS::QueuePolicy');
  const denyInsecure = queuePolicy.Properties.PolicyDocument.Statement.find(
    (statement) =>
      statement.Effect === 'Deny' && statement.Condition?.Bool?.['aws:SecureTransport'] === 'false',
  );
  assert.ok(denyInsecure, '非TLSを拒否する文がない');
});

test('診断用のロググループは保持期間30日である', () => {
  const [, logGroup] = onlyOne('AWS::Logs::LogGroup');
  assert.equal(logGroup.Properties.RetentionInDays, 30);
});

test('GitHubAppWebhookUrl のOutputは、APIのエンドポイントに /webhook を連結した値を持つ', () => {
  const output = findOutput('GitHubAppWebhookUrl');
  assert.equal(output.Value['Fn::Join'][0], '');
  assert.equal(output.Value['Fn::Join'][1][1], '/webhook');
  assert.ok(output.Value['Fn::Join'][1][0]['Fn::GetAtt'], 'エンドポイントをGetAttで参照していない');
});

test('キューのOutputは、Issue #5が bodyDigest で冪等に処理する旨を説明に持つ', () => {
  for (const keyPart of ['HandoffQueueArn', 'HandoffQueueUrl']) {
    const output = findOutput(keyPart);
    assert.ok(output.Description.includes('bodyDigest'), `${keyPart}に bodyDigest の説明がない`);
    assert.ok(output.Description.includes('冪等'), `${keyPart}に冪等性の説明がない`);
  }
});

const FORBIDDEN_ACTIONS = [
  'logs:CreateLogGroup',
  'secretsmanager:PutSecretValue',
  'secretsmanager:UpdateSecretVersionStage',
  'secretsmanager:DeleteSecret',
  'secretsmanager:ListSecrets',
  'secretsmanager:DescribeSecret',
  'dynamodb:Scan',
  'dynamodb:Query',
  'dynamodb:GetItem',
];

function webhookRoleId() {
  const entry = Object.entries(template.Resources).find(
    ([key, resource]) => resource.Type === 'AWS::IAM::Role' && key.includes('WebhookReceiverRole'),
  );
  assert.ok(entry, 'Webhook受信ロールがない');
  return entry[0];
}

// ロールに付いたポリシーの文だけを集める。同名の権限を持つ別ロールは含めない。
function roleStatements(roleId) {
  return resourcesOfType('AWS::IAM::Policy')
    .filter(([, policy]) => policy.Properties.Roles.some((role) => role.Ref === roleId))
    .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement);
}

// 計画どおりの許可文。Resourceは論理IDの参照で表し、synth結果と照合する。
function allowedPolicyEntries() {
  const [logGroupId] = onlyOne('AWS::Logs::LogGroup');
  const [secretId] = onlyOne('AWS::SecretsManager::Secret');
  const [tableId] = onlyOne('AWS::DynamoDB::Table');
  const [queueId] = onlyOne('AWS::SQS::Queue');
  return [
    {
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resource: { 'Fn::GetAtt': [logGroupId, 'Arn'] },
    },
    { actions: ['secretsmanager:GetSecretValue'], resource: { Ref: secretId } },
    {
      actions: ['dynamodb:DeleteItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resource: { 'Fn::GetAtt': [tableId, 'Arn'] },
    },
    { actions: ['sqs:SendMessage'], resource: { 'Fn::GetAtt': [queueId, 'Arn'] } },
  ];
}

// 違反の理由を文字列の配列で返す。空配列なら計画どおりの権限だけである。
function policyViolations(statements, allowed) {
  const violations = [];
  for (const statement of statements) {
    const actions = [statement.Action].flat().sort();
    const resources = [statement.Resource].flat();
    if (statement.Effect !== 'Allow') {
      violations.push(`Allow以外の文: ${actions.join(',')}`);
    }
    if (actions.some((action) => action.includes('*'))) {
      violations.push(`ワイルドカードのアクション: ${actions.join(',')}`);
    }
    if (resources.includes('*')) {
      violations.push(`Resourceが*: ${actions.join(',')}`);
    }
    for (const forbidden of FORBIDDEN_ACTIONS) {
      if (actions.includes(forbidden)) {
        violations.push(`禁止されたアクション: ${forbidden}`);
      }
    }
    const matched = allowed.some(
      (entry) =>
        JSON.stringify(entry.actions) === JSON.stringify(actions) &&
        JSON.stringify(entry.resource) === JSON.stringify(statement.Resource),
    );
    if (!matched) {
      violations.push(`許可リストにない文: ${actions.join(',')}`);
    }
  }
  for (const entry of allowed) {
    const present = statements.some(
      (statement) =>
        JSON.stringify([statement.Action].flat().sort()) === JSON.stringify(entry.actions) &&
        JSON.stringify(statement.Resource) === JSON.stringify(entry.resource),
    );
    if (!present) {
      violations.push(`許可された文がない: ${entry.actions.join(',')}`);
    }
  }
  return violations;
}

test('Lambdaロールの権限は計画どおりの4文だけで、ワイルドカードも禁止操作も含まない', () => {
  const statements = roleStatements(webhookRoleId());
  assert.deepEqual(policyViolations(statements, allowedPolicyEntries()), []);
});

test('Lambdaロールに管理ポリシーが付かず、権限はインラインの文だけで与えられる', () => {
  const [, role] = Object.entries(template.Resources).find(
    ([key, resource]) => resource.Type === 'AWS::IAM::Role' && key.includes('WebhookReceiverRole'),
  );
  assert.equal(role.Properties.ManagedPolicyArns, undefined);
});

test('ワイルドカード、禁止操作、別リソースへの許可を含む入力は違反として検出する(自己検査)', () => {
  const allowed = allowedPolicyEntries();
  const valid = allowed.map((entry) => ({
    Effect: 'Allow',
    Action: entry.actions,
    Resource: entry.resource,
  }));
  assert.deepEqual(policyViolations(valid, allowed), []);

  const invalidStatements = [
    { Effect: 'Allow', Action: 's3:*', Resource: '*' },
    { Effect: 'Allow', Action: 'logs:CreateLogGroup', Resource: allowed[0].resource },
    { Effect: 'Allow', Action: 'secretsmanager:PutSecretValue', Resource: allowed[1].resource },
    { Effect: 'Allow', Action: ['dynamodb:Scan'], Resource: allowed[2].resource },
    { Effect: 'Allow', Action: 'sqs:SendMessage', Resource: '*' },
  ];
  for (const invalid of invalidStatements) {
    const violations = policyViolations([...valid, invalid], allowed);
    assert.notDeepEqual(violations, [], `検出されなかった入力: ${JSON.stringify(invalid)}`);
  }
});

function secretDenyStatement(templateJson) {
  const policy = Object.values(templateJson.Resources).find(
    (resource) => resource.Type === 'AWS::SecretsManager::ResourcePolicy',
  );
  assert.ok(policy, 'Secretのリソースポリシーがない');
  return policy.Properties.ResourcePolicy.Statement.find((item) => item.Effect === 'Deny');
}

// 参照の方向（Ref、Fn::GetAtt、DependsOn）から、リソース間の依存グラフを作る。
function collectTargets(value, ids, targets) {
  if (Array.isArray(value)) {
    for (const item of value) collectTargets(item, ids, targets);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (typeof value.Ref === 'string' && ids.has(value.Ref)) targets.add(value.Ref);
  const getAtt = value['Fn::GetAtt'];
  if (Array.isArray(getAtt) && ids.has(getAtt[0])) targets.add(getAtt[0]);
  if (typeof getAtt === 'string' && ids.has(getAtt.split('.')[0])) {
    targets.add(getAtt.split('.')[0]);
  }
  for (const item of Object.values(value)) collectTargets(item, ids, targets);
}

function dependencyGraph(templateJson) {
  const ids = new Set(Object.keys(templateJson.Resources));
  const graph = new Map();
  for (const [id, resource] of Object.entries(templateJson.Resources)) {
    const targets = new Set();
    collectTargets(resource.Properties ?? {}, ids, targets);
    for (const dependency of resource.DependsOn ?? []) {
      if (ids.has(dependency)) targets.add(dependency);
    }
    targets.delete(id);
    graph.set(id, targets);
  }
  return graph;
}

// 循環が見つかれば、その経路を返す。無ければnullを返す。
function findCycle(graph) {
  const state = new Map();
  const stack = [];
  const visit = (node) => {
    state.set(node, 'active');
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 'active') {
        return [...stack.slice(stack.indexOf(next)), next];
      }
      if (!state.has(next)) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  };
  for (const node of graph.keys()) {
    if (!state.has(node)) {
      const cycle = visit(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

test('Secretの読取り許可に、管理者ロール、追加ロール、Webhook処理ロールのGetAttを並べて含める', () => {
  const extended = synthTemplate([extraReaderRoleArn]);
  const roleId = Object.keys(extended.Resources).find(
    (key) =>
      extended.Resources[key].Type === 'AWS::IAM::Role' && key.includes('WebhookReceiverRole'),
  );
  assert.ok(roleId, 'Webhook受信ロールがない');
  const allowed = secretDenyStatement(extended).Condition.ArnNotLike['aws:PrincipalArn'];
  assert.deepEqual(allowed, [adminRoleArn, extraReaderRoleArn, { 'Fn::GetAtt': [roleId, 'Arn'] }]);
});

test('リソース間の参照とDependsOnから作る依存グラフに循環がない', () => {
  const graph = dependencyGraph(template);
  const [lambdaId] = onlyOne('AWS::Lambda::Function');
  const roleId = webhookRoleId();
  assert.ok(graph.get(lambdaId).has(roleId), 'Lambdaからロールへの依存が見つからない');
  assert.equal(findCycle(graph), null);
});

test('循環を含む小さなテンプレートは循環として検出し、循環のない入力は検出しない(自己検査)', () => {
  const cyclic = {
    Resources: {
      A: { Type: 'X', Properties: { Value: { Ref: 'B' } } },
      B: { Type: 'X', Properties: { Value: { 'Fn::GetAtt': ['C', 'Arn'] } } },
      C: { Type: 'X', DependsOn: ['A'] },
    },
  };
  assert.notEqual(findCycle(dependencyGraph(cyclic)), null);

  const acyclic = {
    Resources: {
      A: { Type: 'X', Properties: { Value: { Ref: 'B' } } },
      B: { Type: 'X', Properties: {} },
    },
  };
  assert.equal(findCycle(dependencyGraph(acyclic)), null);
});

test('デプロイ経路（app.ts）は未決の受信設定を含む設定では、合成の前に失敗する', () => {
  // 同梱の設定例はプレースホルダーを含むため、受信設定の検査に届く前に止まる。
  // null の受信設定だけを検査する経路は、config/github-app.example.json を変えずには作れない（報告で論点にする）。
  const result = spawnSync('node', ['--import', 'tsx', join(root, 'cdk', 'bin', 'app.ts')], {
    cwd: root,
    encoding: 'utf8',
    env: childEnv,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /プレースホルダー|未指定/u);
});

test('AWS認証の環境変数がない状態で合成が成功し、cdk.context.json を生成しない', () => {
  assert.ok(template.Resources, 'テンプレートがない');
  assert.equal(existsSync(join(root, 'cdk.context.json')), false);
});

test('テンプレートに12桁のアカウント番号、Secretの実値、署名の形式が含まれない', () => {
  // テスト用に注入した管理者ロールARNは検査の対象外にする。ここでは生成されるテンプレートだけを見る。
  const text = JSON.stringify(template).split(adminRoleArn).join('');
  assert.doesNotMatch(text, /(^|[^0-9a-fA-F])[0-9]{12}([^0-9a-fA-F]|$)/u);
  assert.doesNotMatch(text, /"SecretString"/u);
  assert.doesNotMatch(text, /sha256=[0-9a-f]{64}/u);
  assert.doesNotMatch(text, /github_pat_|AWS_SECRET_ACCESS_KEY/iu);
});
