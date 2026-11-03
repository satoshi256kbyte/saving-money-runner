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

const webhookReceiverSettings = { rateLimit: 10, burstLimit: 20, reservedConcurrency: 5 };
const requiredWebhookKeys = ['rateLimit', 'burstLimit', 'reservedConcurrency'];

function withWebhookReceiver(webhookReceiver) {
  return { ...config, webhookReceiver };
}

test('webhookReceiverの3項目が正の整数の設定を許可する', () => {
  assert.doesNotThrow(() => validateGitHubAppConfig(withWebhookReceiver(webhookReceiverSettings)));
});

test('設定例のように3項目がnullの設定を許可する（デプロイ経路の拒否は別に行う）', () => {
  assert.doesNotThrow(() =>
    validateGitHubAppConfig(
      withWebhookReceiver({ rateLimit: null, burstLimit: null, reservedConcurrency: null }),
    ),
  );
});

test('maxBodyBytesを省略した設定と、上限ちょうどの設定を許可する', () => {
  assert.doesNotThrow(() => validateGitHubAppConfig(withWebhookReceiver(webhookReceiverSettings)));
  assert.doesNotThrow(() =>
    validateGitHubAppConfig(
      withWebhookReceiver({ ...webhookReceiverSettings, maxBodyBytes: 6291456 }),
    ),
  );
});

test('webhookReceiverの欠落を拒否する', () => {
  const withoutReceiver = { ...config };
  delete withoutReceiver.webhookReceiver;
  assert.throws(() => validateGitHubAppConfig(withoutReceiver), /webhookReceiverを指定/u);
});

test('webhookReceiverが配列やオブジェクト以外の値なら拒否する', () => {
  assert.throws(() => validateGitHubAppConfig(withWebhookReceiver(null)), /webhookReceiverを指定/u);
  assert.throws(() => validateGitHubAppConfig(withWebhookReceiver([])), /webhookReceiverを指定/u);
});

for (const key of requiredWebhookKeys) {
  test(`webhookReceiver.${key}の欠落を拒否する`, () => {
    const settings = { ...webhookReceiverSettings };
    delete settings[key];
    assert.throws(() => validateGitHubAppConfig(withWebhookReceiver(settings)), /必須項目/u);
  });

  for (const value of [0, -1, 1.5, '10', true]) {
    test(`webhookReceiver.${key}に正の整数以外（${JSON.stringify(value)}）を拒否する`, () => {
      assert.throws(
        () =>
          validateGitHubAppConfig(
            withWebhookReceiver({ ...webhookReceiverSettings, [key]: value }),
          ),
        /正の整数またはnull/u,
      );
    });
  }
}

for (const value of [0, -1, 1.5, '1000', null, 6291457]) {
  test(`maxBodyBytesに不正な値（${JSON.stringify(value)}）を拒否する`, () => {
    assert.throws(
      () =>
        validateGitHubAppConfig(
          withWebhookReceiver({ ...webhookReceiverSettings, maxBodyBytes: value }),
        ),
      /maxBodyBytes/u,
    );
  });
}

test('burstLimitがrateLimit未満の設定を拒否し、同値は許可する', () => {
  assert.throws(
    () =>
      validateGitHubAppConfig(
        withWebhookReceiver({ ...webhookReceiverSettings, rateLimit: 10, burstLimit: 9 }),
      ),
    /burstLimit/u,
  );
  assert.doesNotThrow(() =>
    validateGitHubAppConfig(
      withWebhookReceiver({ ...webhookReceiverSettings, rateLimit: 10, burstLimit: 10 }),
    ),
  );
});

test('webhookReceiverの未知のキーを拒否する', () => {
  assert.throws(
    () =>
      validateGitHubAppConfig(withWebhookReceiver({ ...webhookReceiverSettings, unknownLimit: 1 })),
    /未許可のwebhookReceiver設定キー/u,
  );
});

test('webhookReceiverの検証エラーに設定値を含めない', () => {
  assert.throws(
    () =>
      validateGitHubAppConfig(
        withWebhookReceiver({ ...webhookReceiverSettings, reservedConcurrency: 1.5 }),
      ),
    (error) => {
      assert.match(error.message, /reservedConcurrency/u);
      assert.doesNotMatch(error.message, /1\.5/u);
      return true;
    },
  );
});
