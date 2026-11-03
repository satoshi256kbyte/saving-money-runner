import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

// 後続キューの保持期間。GitHubの再配信期間（3日）より長くして、Issue #5の停止中も欠落させない（clarify.md Q-002）。
const HANDOFF_RETENTION = cdk.Duration.days(4);

export interface WebhookReceiverProps {
  /** Lambdaの実行ロール。権限ポリシーを持たないロールを渡し、このConstructが必要な権限だけを付ける。 */
  readonly executionRole: iam.IRole;
  /** Webhook Secret。読取りはこのSecretのARNだけに限る。 */
  readonly secretResource: secretsmanager.ISecret;
  readonly rateLimit: number;
  readonly burstLimit: number;
  readonly reservedConcurrency: number;
  readonly maxBodyBytes: number;
}

/**
 * Webhook受信の永続リソース（重複排除テーブル、後続キュー）と、受信Lambdaを作る。
 * DLQは作らない。消費側（Issue #5）が無い本Specでは再受信が起きないため、DLQ設計はIssue #5で定める。
 */
export class WebhookReceiver extends Construct {
  public readonly dedupeTable: dynamodb.Table;
  public readonly handoffQueue: sqs.Queue;
  public readonly handlerFunction: NodejsFunction;
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: WebhookReceiverProps) {
    super(scope, id);

    // 重複排除テーブルは3日で失効する識別子だけを持つ。失われても再配信の重複が起きるだけで、
    // Issue #5が冪等に処理するため、削除ポリシーはDESTROYにする（plan.md のDynamoDB節）。
    this.dedupeTable = new dynamodb.Table(this, 'DedupeTable', {
      partitionKey: { name: 'deliveryId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 標準キューは同じメッセージを複数回配信しうる。冪等性はIssue #5が deliveryId で担保する。
    this.handoffQueue = new sqs.Queue(this, 'HandoffQueue', {
      retentionPeriod: HANDOFF_RETENTION,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });

    // 診断の保持期間は30日（J-5）。LogGroupを明示しないと、Lambdaが自動で作るロググループは期限なしになる。
    const logGroup = new logs.LogGroup(this, 'HandlerLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // 権限は必要な操作だけを、固定のARNへ与える。ワイルドカードや書き込み系のSecret操作は付けない。
    // ログは独自ロールだとAWS管理の基本ポリシーが付かないため、CreateLogGroupを除いて明示する。
    props.executionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [logGroup.logGroupArn],
      }),
    );
    props.executionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [props.secretResource.secretArn],
      }),
    );
    props.executionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
        resources: [this.dedupeTable.tableArn],
      }),
    );
    props.executionRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [this.handoffQueue.queueArn],
      }),
    );

    this.handlerFunction = new NodejsFunction(this, 'Handler', {
      entry: 'src/webhook/handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      // GitHubの応答期限は10秒。3秒はLambdaの既定値で、Secret取得を含めて収まる想定（clarify.md Q-008）。
      timeout: cdk.Duration.seconds(3),
      reservedConcurrentExecutions: props.reservedConcurrency,
      role: props.executionRole,
      logGroup,
      environment: {
        // src/webhook/handler.ts の ENV_KEYS と名前を一致させる。handler.ts は読み込むと初期化するため、ここでimportしない。
        WEBHOOK_SECRET_ARN: props.secretResource.secretArn,
        WEBHOOK_DEDUPE_TABLE_NAME: this.dedupeTable.tableName,
        WEBHOOK_HANDOFF_QUEUE_URL: this.handoffQueue.queueUrl,
        WEBHOOK_MAX_BODY_BYTES: String(props.maxBodyBytes),
      },
    });

    // パスはspecに定めがないため、本Specでは /webhook とする。GitHub Appへ登録するURLは出力値から取る。
    const webhookPath = '/webhook';
    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      // 既定ステージは作らない。スロットルを設定できる $default ステージを下で明示する。
      createDefaultStage: false,
    });
    this.httpApi.addRoutes({
      path: webhookPath,
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('WebhookIntegration', this.handlerFunction),
    });
    // レートとバーストは顧客ごとの必須設定（J-2）。API Gatewayの値は目標値で、厳密な上限ではない。
    // アクセスログは有効にしない。IPなどの記録を増やさないため（plan.md のAPI節）。
    new apigwv2.HttpStage(this, 'DefaultStage', {
      httpApi: this.httpApi,
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: props.rateLimit, burstLimit: props.burstLimit },
    });

    new cdk.CfnOutput(this, 'GitHubAppWebhookUrl', {
      description: 'GitHub Appに登録するWebhook URL（HTTPSのエンドポイントとルートパスの連結）',
      value: cdk.Fn.join('', [this.httpApi.apiEndpoint, webhookPath]),
    });

    new cdk.CfnOutput(this, 'HandoffQueueArn', {
      description:
        '後続キューのARN（Issue #5が消費する）。標準キューのため配信は重複しうる。Issue #5は deliveryId を冪等キーとして処理すること',
      value: this.handoffQueue.queueArn,
    });
    new cdk.CfnOutput(this, 'HandoffQueueUrl', {
      description:
        '後続キューのURL（Issue #5が消費する）。標準キューのため配信は重複しうる。Issue #5は deliveryId を冪等キーとして処理すること',
      value: this.handoffQueue.queueUrl,
    });
  }
}
