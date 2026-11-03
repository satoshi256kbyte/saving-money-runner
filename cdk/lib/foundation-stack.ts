import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { GitHubAppIntegration } from './github-app-integration.js';

export interface FoundationStackProps extends cdk.StackProps {
  readonly githubOrganization?: string;
  readonly githubAppName?: string;
  readonly adminRoleArn?: string;
  readonly additionalReaderRoleArns?: string[];
}

export class FoundationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FoundationStackProps = {}) {
    super(scope, id, props);

    new cdk.CfnOutput(this, 'ProjectName', {
      description: 'プロジェクトの識別名',
      value: 'saving-money-runner',
    });

    new GitHubAppIntegration(this, 'GitHubAppIntegration', {
      organization: props.githubOrganization ?? '<ORGANIZATION>',
      appName: props.githubAppName ?? 'saving-money-runner',
      adminRoleArn: props.adminRoleArn ?? '<ADMIN_ROLE_ARN>',
      additionalReaderRoleArns: props.additionalReaderRoleArns ?? [],
    });
  }
}
