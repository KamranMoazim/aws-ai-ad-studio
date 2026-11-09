import { Duration, Stack } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { appFunction, logGroup } from './function.js';
import { SCANS_PREFIX } from './media.js';

export const SCAN_MODEL = 'anthropic.claude-haiku-5-5';
export const MANAGED_BROWSER = 'aws.browser.v1';

export interface ScanPipelineProps {
  table: dynamodb.ITableV2;
  assetsBucket: s3.IBucket;
  scanAssets: lambda.IFunction;
}

export class ScanPipeline extends Construct {
  readonly stateMachine: sfn.StateMachine;
  readonly browse: NodejsFunction;
  readonly analyze: NodejsFunction;
  readonly failed: NodejsFunction;

  constructor(scope: Construct, id: string, props: ScanPipelineProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const environment = {
      TABLE_NAME: props.table.tableName,
      ASSETS_BUCKET: props.assetsBucket.bucketName,
    };

    this.browse = appFunction(this, 'Browse', {
      entry: 'src/scan-steps/browse.ts',
      environment,
      timeout: Duration.minutes(3),
      memorySize: 1024,
      nodeModules: ['puppeteer-core'],
    });
    props.table.grantReadWriteData(this.browse);
    props.assetsBucket.grantPut(this.browse, `${SCANS_PREFIX}*`);
    this.browse.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock-agentcore:StartBrowserSession',
          'bedrock-agentcore:StopBrowserSession',
          'bedrock-agentcore:ConnectBrowserAutomationStream',
        ],
        resources: [
          `arn:${stack.partition}:bedrock-agentcore:${stack.region}:aws:browser/${MANAGED_BROWSER}`,
          `arn:${stack.partition}:bedrock-agentcore:${stack.region}:${stack.account}:browser/*`,
        ],
      }),
    );

    this.analyze = appFunction(this, 'Analyze', {
      entry: 'src/scan-steps/analyze.ts',
      environment: { ...environment, SCAN_MODEL },
      timeout: Duration.minutes(5),
      memorySize: 1024,
    });
    props.table.grantReadWriteData(this.analyze);
    props.assetsBucket.grantReadWrite(this.analyze, `${SCANS_PREFIX}*`);
    this.analyze.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['bedrock-mantle:CreateInference'], resources: ['*'] }),
    );

    this.failed = appFunction(this, 'Failed', { entry: 'src/scan-steps/failed.ts', environment });
    props.table.grantReadWriteData(this.failed);

    const markFailed = new tasks.LambdaInvoke(this, 'MarkFailed', {
      lambdaFunction: this.failed,
      payloadResponseOnly: true,
      resultPath: sfn.JsonPath.DISCARD,
    }).next(new sfn.Fail(this, 'ScanFailed'));
    const browse = new tasks.LambdaInvoke(this, 'BrowseSite', {
      lambdaFunction: this.browse,
      payloadResponseOnly: true,
      resultPath: sfn.JsonPath.DISCARD,
    });
    browse.addRetry({ errors: ['States.ALL'], maxAttempts: 1, interval: Duration.seconds(5) });
    const assets = new tasks.LambdaInvoke(this, 'ProcessAssets', {
      lambdaFunction: props.scanAssets,
      payloadResponseOnly: true,
      resultPath: '$.assets',
    });
    const analyze = new tasks.LambdaInvoke(this, 'AnalyzeContent', {
      lambdaFunction: this.analyze,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({
        clientId: sfn.JsonPath.stringAt('$.clientId'),
        scanId: sfn.JsonPath.stringAt('$.scanId'),
        url: sfn.JsonPath.stringAt('$.url'),
        prefix: sfn.JsonPath.stringAt('$.prefix'),
        assetsKey: sfn.JsonPath.stringAt('$.assets.assetsKey'),
      }),
      resultPath: sfn.JsonPath.DISCARD,
    });
    analyze.addRetry({
      errors: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
      maxAttempts: 2,
      interval: Duration.seconds(5),
    });
    for (const step of [browse, assets, analyze]) {
      step.addCatch(markFailed, { resultPath: '$.error' });
    }

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(
        browse.next(assets).next(analyze).next(new sfn.Succeed(this, 'Done')),
      ),
      timeout: Duration.minutes(12),
      logs: { destination: logGroup(this, 'StateMachineLogs'), level: sfn.LogLevel.ERROR },
    });
  }
}
