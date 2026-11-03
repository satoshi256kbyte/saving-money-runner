import { readFileSync } from 'node:fs';

import {
  assertReaderRolesInAccount,
  validateGitHubAppConfig,
} from '../../scripts/github-app/validate-config.mjs';

export interface GitHubAppConfig {
  readonly organization: string;
  readonly appName: string;
  readonly adminRoleArn: string;
  readonly additionalReaderRoleArns: string[];
}

/**
 * 設定例を読み込み、検証する。プレースホルダーを許すかは呼び出し側が決める。
 * 実デプロイの経路では許さず、品質ゲートの検証synthだけが許可する。
 */
export function loadGitHubAppConfig(allowPlaceholder: boolean): GitHubAppConfig {
  const config = JSON.parse(
    readFileSync(new URL('../../config/github-app.example.json', import.meta.url), 'utf8'),
  );
  validateGitHubAppConfig(config);
  if (
    !allowPlaceholder &&
    (config.organization === '<ORGANIZATION>' || config.adminRoleArn === '<ADMIN_ROLE_ARN>')
  ) {
    throw new Error(
      '組織名または管理者ロールARNがプレースホルダーのままです。実デプロイ前に置き換えてください',
    );
  }
  if (!allowPlaceholder) {
    // CDKのCLIがデプロイ先のアカウントを環境変数で渡す。ロールがそれ以外のアカウントなら拒否する。
    assertReaderRolesInAccount(config, process.env.CDK_DEFAULT_ACCOUNT);
  }
  return config;
}
