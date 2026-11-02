import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class FoundationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new cdk.CfnOutput(this, 'ProjectName', {
      description: 'プロジェクトの識別名',
      value: 'saving-money-runner',
    });
  }
}
