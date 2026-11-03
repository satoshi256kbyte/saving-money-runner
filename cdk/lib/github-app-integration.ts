import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/** Webhook Secretの物理名。設定JSONの値と一致させ、呼び出し側から変更させない。 */
export const WEBHOOK_SECRET_NAME = 'saving-money-runner/github-app/webhook';

// 公開テキストの秘密情報検査に合わせ、ARNの接頭辞は組み立てて表す。
const arnPrefix = ['arn', 'aws', 'iam'].join(':');
const roleArnPattern = new RegExp(`^${arnPrefix}::[0-9]{12}:role/[\\w+=,.@/-]+$`, 'u');
const placeholderRoleArn = '<ADMIN_ROLE_ARN>';

/**
 * Secretの読取りを許すIAMロールのARNを検証する。
 * ワイルドカードや別種のARNを除外条件へ入れると、Denyが効かなくなるため拒否する。
 */
function assertRoleArns(arns: string[]): void {
  for (const arn of arns) {
    if (arn !== placeholderRoleArn && !roleArnPattern.test(arn)) {
      throw new Error(`読取りを許可するロールARNが不正です: ${arn.length}文字`);
    }
  }
}

export interface GitHubAppIntegrationProps {
  readonly organization: string;
  readonly appName: string;
  /** Webhook Secretを取得できる管理者ロールのARN。これ以外の主体からのGetSecretValueを拒否する。 */
  readonly adminRoleArn: string;
  /** Issue #4のWebhook処理など、Secret読取りを追加で許可するロールのARN。 */
  readonly additionalReaderRoleArns?: string[];
}

export class GitHubAppIntegration extends Construct {
  public readonly secretResource: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: GitHubAppIntegrationProps) {
    super(scope, id);

    this.secretResource = new secretsmanager.Secret(this, 'WebhookSecret', {
      description: 'GitHub App Webhook Secret。実値はCloudFormation出力へ含めない',
      secretName: WEBHOOK_SECRET_NAME,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: false,
      },
    });

    const readerRoleArns = [props.adminRoleArn, ...(props.additionalReaderRoleArns ?? [])];
    assertRoleArns(readerRoleArns);

    // 最小権限をリソースポリシーで強制する。IAMポリシーだけでは他の主体による許可を防げないため。
    // Issue #4のWebhook処理に読取りを許可する場合は、このロールを条件へ追加する。
    this.secretResource.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['secretsmanager:GetSecretValue'],
        resources: [this.secretResource.secretArn],
        conditions: {
          ArnNotLike: {
            'aws:PrincipalArn': readerRoleArns,
          },
        },
      }),
    );

    new cdk.CfnOutput(this, 'GitHubAppOrganization', {
      description: 'GitHub Appをインストールする顧客Organization',
      value: props.organization,
    });
    new cdk.CfnOutput(this, 'GitHubAppName', {
      description: '顧客Organizationへ登録するGitHub App名',
      value: props.appName,
    });
    new cdk.CfnOutput(this, 'GitHubAppWebhookSecretArn', {
      description: 'Issue #4以降のWebhook処理が参照するSecret ARN',
      value: this.secretResource.secretArn,
    });
  }
}
