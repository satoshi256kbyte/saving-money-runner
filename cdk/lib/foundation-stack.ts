import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

import { GitHubAppIntegration } from './github-app-integration.js';
import { WebhookReceiver } from './webhook-receiver.js';

/**
 * 顧客ごとに決める受信設定（J-2、J-3）。このStackは数値だけを受け取る。
 * 未指定（null）を拒否するのは呼び出し側の役目で、デプロイ経路は cdk/bin/app.ts が行う。
 */
export interface WebhookReceiverLimits {
  readonly rateLimit: number;
  readonly burstLimit: number;
  readonly reservedConcurrency: number;
  readonly maxBodyBytes: number;
}

export interface FoundationStackProps extends cdk.StackProps {
  readonly githubOrganization?: string;
  readonly githubAppName?: string;
  readonly adminRoleArn?: string;
  readonly additionalReaderRoleArns?: string[];
  readonly webhookReceiver: WebhookReceiverLimits;
}

export class FoundationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    new cdk.CfnOutput(this, 'ProjectName', {
      description: 'プロジェクトの識別名',
      value: 'saving-money-runner',
    });

    // 権限ポリシーを持たないロールを先に作る。Secretのリソースポリシーと受信Lambdaの両方が参照するため、
    // 権限は受信Constructが必要な分だけ付ける。ロール名は固定しない。
    const webhookRole = new iam.Role(this, 'WebhookReceiverRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    const integration = new GitHubAppIntegration(this, 'GitHubAppIntegration', {
      organization: props.githubOrganization ?? '<ORGANIZATION>',
      appName: props.githubAppName ?? 'saving-money-runner',
      adminRoleArn: props.adminRoleArn ?? '<ADMIN_ROLE_ARN>',
      additionalReaderRoleArns: props.additionalReaderRoleArns ?? [],
      webhookReaderRoles: [webhookRole],
    });

    new WebhookReceiver(this, 'WebhookReceiver', {
      executionRole: webhookRole,
      secretResource: integration.secretResource,
      ...props.webhookReceiver,
    });
  }
}
