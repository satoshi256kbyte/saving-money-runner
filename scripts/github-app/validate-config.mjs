import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const requiredPermissions = {
  actions: 'read',
  metadata: 'read',
};
const forbiddenKeys = /(?:secret|token|password|private[_-]?key|credential)/iu;

const allowedConfigKeys = new Set([
  'organization',
  'appName',
  'visibility',
  'permissions',
  'webhookEvents',
  'webhookSecretName',
  'adminRoleArn',
  'additionalReaderRoleArns',
]);
// 公開テキストの秘密情報検査に合わせ、ARNの接頭辞は組み立てて表す。
const arnPrefix = ['arn', 'aws', 'iam'].join(':');
const roleArnPattern = new RegExp(`^${arnPrefix}::[0-9]{12}:role/[\\w+=,.@/-]+$`, 'u');
const allowedPermissionKeys = new Set(Object.keys(requiredPermissions));

function rejectForbiddenKeys(value, path = 'config') {
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key !== 'webhookSecretName' && forbiddenKeys.test(key)) {
      throw new Error(`Secret実値または認証情報を設定できません: ${path}.${key}`);
    }
    rejectForbiddenKeys(nestedValue, `${path}.${key}`);
  }
}

/**
 * 読取りを許可するロールが、デプロイ先のAWSアカウントに属することを確認する。
 * クロスアカウントのロールは、信頼関係とIAMレビューの対象を増やすため、この契約では許可しない。
 */
export function assertReaderRolesInAccount(config, accountId) {
  if (!/^[0-9]{12}$/u.test(accountId ?? '')) {
    throw new Error('デプロイ先のAWSアカウントを確認できません');
  }
  const readerRoleArns = [config.adminRoleArn, ...(config.additionalReaderRoleArns ?? [])];
  for (const arn of readerRoleArns) {
    if (arn === '<ADMIN_ROLE_ARN>') {
      continue;
    }
    if (arn.split(':')[4] !== accountId) {
      throw new Error('読取りロールが、デプロイ先のAWSアカウントと一致しません');
    }
  }
}

export function validateGitHubAppConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('GitHub App設定はオブジェクトで指定してください');
  }
  if (
    config.organization !== '<ORGANIZATION>' &&
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/u.test(config.organization)
  ) {
    throw new Error('Organization名が不正です');
  }
  if (!/^[a-z0-9][a-z0-9-]{2,49}$/u.test(config.appName)) {
    throw new Error('App名が不正です');
  }
  if (config.visibility !== 'private') {
    throw new Error('GitHub AppはPrivateでなければなりません');
  }
  const unknownConfigKeys = Object.keys(config).filter((key) => !allowedConfigKeys.has(key));
  if (unknownConfigKeys.length > 0) {
    throw new Error(`未許可の設定キーです: ${unknownConfigKeys.join(', ')}`);
  }
  rejectForbiddenKeys(config);
  if (!config.permissions || typeof config.permissions !== 'object') {
    throw new Error('permissionsを指定してください');
  }
  const unknownPermissionKeys = Object.keys(config.permissions).filter(
    (key) => !allowedPermissionKeys.has(key),
  );
  if (unknownPermissionKeys.length > 0) {
    throw new Error(`未許可の権限です: ${unknownPermissionKeys.join(', ')}`);
  }
  for (const [permission, value] of Object.entries(requiredPermissions)) {
    if (config.permissions?.[permission] !== value) {
      throw new Error(`権限が最小構成と一致しません: ${permission}`);
    }
  }
  if (
    !Array.isArray(config.webhookEvents) ||
    JSON.stringify(config.webhookEvents) !== JSON.stringify(['workflow_job'])
  ) {
    throw new Error('Webhookイベントはworkflow_jobの1件だけを指定してください');
  }
  if (config.webhookSecretName !== 'saving-money-runner/github-app/webhook') {
    throw new Error('Webhook Secret名は固定契約と一致しません');
  }
  // 実値のARNは顧客の口座情報を含むため、設定例はプレースホルダーのままにする。
  if (config.adminRoleArn !== '<ADMIN_ROLE_ARN>' && !roleArnPattern.test(config.adminRoleArn)) {
    throw new Error('管理者ロールARNが不正です');
  }
  const readerRoleArns = config.additionalReaderRoleArns ?? [];
  if (
    !Array.isArray(readerRoleArns) ||
    readerRoleArns.some((arn) => typeof arn !== 'string' || !roleArnPattern.test(arn))
  ) {
    throw new Error('追加の読取りロールARNが不正です');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] ?? 'config/github-app.example.json';
  try {
    validateGitHubAppConfig(JSON.parse(readFileSync(path, 'utf8')));
    console.log(`GitHub App設定を検証しました: ${path}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
