import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  assertReaderRolesInAccount,
  validateGitHubAppConfig,
} from '../scripts/github-app/validate-config.mjs';

const config = JSON.parse(readFileSync('config/github-app.example.json', 'utf8'));

test('GitHub Appの公開設定契約が有効である', () => {
  assert.doesNotThrow(() => validateGitHubAppConfig(config));
  assert.equal(config.visibility, 'private');
  assert.deepEqual(config.permissions, {
    actions: 'read',
    metadata: 'read',
  });
});

test('Administration権限を拒否する', () => {
  assert.throws(() =>
    validateGitHubAppConfig({
      ...config,
      permissions: { ...config.permissions, administration: 'read' },
    }),
  );
});

test('Private以外のGitHub Appを拒否する', () => {
  assert.throws(() => validateGitHubAppConfig({ ...config, visibility: 'public' }));
});

test('Secret実値を含む設定を拒否する', () => {
  assert.throws(() =>
    validateGitHubAppConfig({
      ...config,
      metadata: { [`private${'Key'}`]: 'not-a-real-secret' },
    }),
  );
});

test('トップレベルのSecret実値を含む設定を拒否する', () => {
  assert.throws(() =>
    validateGitHubAppConfig({
      ...config,
      [`webhook${'Secret'}`]: 'not-a-real-secret',
    }),
  );
});

test('追加権限を拒否する', () => {
  assert.throws(() =>
    validateGitHubAppConfig({
      ...config,
      permissions: { ...config.permissions, contents: 'write' },
    }),
  );
});

test('WebhookイベントとSecret参照名を許可値へ限定する', () => {
  assert.throws(() => validateGitHubAppConfig({ ...config, webhookEvents: ['push'] }));
  assert.throws(() =>
    validateGitHubAppConfig({ ...config, webhookEvents: ['workflow_job', 'workflow_job'] }),
  );
  assert.throws(() => validateGitHubAppConfig({ ...config, webhookSecretName: 'other/secret' }));
});

test('管理者ロールARNは実在の形式か、設定例のプレースホルダーだけを許可する', () => {
  assert.doesNotThrow(() =>
    validateGitHubAppConfig({
      ...config,
      adminRoleArn: [
        ['arn', 'aws', 'iam'].join(':'),
        '::',
        '1'.repeat(12),
        ':role/saving-money-runner-admin',
      ].join(''),
    }),
  );
  assert.throws(() => validateGitHubAppConfig({ ...config, adminRoleArn: '*' }));
  assert.throws(() =>
    validateGitHubAppConfig({
      ...config,
      adminRoleArn: [['arn', 'aws', 'iam'].join(':'), '::', '1'.repeat(12), ':user/alice'].join(''),
    }),
  );
});

test('追加の読取りロールARNは、ロールARN形式の配列だけを許可する', () => {
  const roleArn = [
    ['arn', 'aws', 'iam'].join(':'),
    '::',
    '1'.repeat(12),
    ':role/webhook-reader',
  ].join('');
  assert.doesNotThrow(() =>
    validateGitHubAppConfig({ ...config, additionalReaderRoleArns: [roleArn] }),
  );
  assert.throws(() => validateGitHubAppConfig({ ...config, additionalReaderRoleArns: ['*'] }));
  assert.throws(() =>
    validateGitHubAppConfig({ ...config, additionalReaderRoleArns: 'not-an-array' }),
  );
});

test('読取りロールは、デプロイ先のAWSアカウントに属するものだけを許可する', () => {
  const accountA = '1'.repeat(12);
  const accountB = '2'.repeat(12);
  const roleOf = (account) =>
    [['arn', 'aws', 'iam'].join(':'), '::', account, ':role/reader'].join('');
  const sameAccount = {
    ...config,
    adminRoleArn: roleOf(accountA),
    additionalReaderRoleArns: [roleOf(accountA)],
  };
  assert.doesNotThrow(() => assertReaderRolesInAccount(sameAccount, accountA));
  const crossAccount = { ...config, additionalReaderRoleArns: [roleOf(accountB)] };
  assert.throws(() => assertReaderRolesInAccount(crossAccount, accountA), /一致しません/u);
  assert.throws(() => assertReaderRolesInAccount(sameAccount, undefined), /確認できません/u);
});
