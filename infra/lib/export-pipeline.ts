import { Duration } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { appFunction, logGroup } from './function.js';
import { EXPORTS_PREFIX } from './media.js';

export const RENDER_CONCURRENCY = 8;

export interface ExportPipelineProps {
  table: dynamodb.ITableV2;
  assetsBucket: s3.IBucket;
  render: lambda.IFunction;
}

export class ExportPipeline extends Construct {
  readonly stateMachine: sfn.StateMachine;
  readonly zip: NodejsFunction;
  readonly failed: NodejsFunction;

  constructor(scope: Construct, id: string, props: ExportPipelineProps) {
    super(scope, id);
    const environment = {
      TABLE_NAME: props.table.tableName,
      ASSETS_BUCKET: props.assetsBucket.bucketName,
    };
    this.zip = appFunction(this, 'Zip', {
      entry: 'src/export/zip.ts',
      environment,
      timeout: Duration.seconds(60),
      memorySize: 1024,
    });
    props.assetsBucket.grantReadWrite(this.zip, `${EXPORTS_PREFIX}*`);
    props.table.grantReadWriteData(this.zip);
    this.failed = appFunction(this, 'Failed', { entry: 'src/export/failed.ts', environment });
    props.table.grantReadWriteData(this.failed);

    const failed = new tasks.LambdaInvoke(this, 'MarkFailed', {
      lambdaFunction: this.failed,
      payloadResponseOnly: true,
      resultPath: sfn.JsonPath.DISCARD,
    }).next(new sfn.Fail(this, 'ExportFailed'));
    const render = new tasks.LambdaInvoke(this, 'RenderSize', {
      lambdaFunction: props.render,
      payloadResponseOnly: true,
    });
    render.addRetry({
      errors: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException', 'States.Timeout'],
      interval: Duration.seconds(3),
      maxAttempts: 2,
      backoffRate: 2,
    });
    const sizes = new sfn.Map(this, 'Sizes', {
      itemsPath: '$.sizes',
      maxConcurrency: RENDER_CONCURRENCY,
      itemSelector: {
        'snapshotKey.$': '$.snapshotKey',
        'size.$': '$$.Map.Item.Value',
      },
      resultPath: '$.files',
    });
    sizes.itemProcessor(render);
    sizes.addCatch(failed, { resultPath: '$.error' });
    const zip = new tasks.LambdaInvoke(this, 'ZipFiles', {
      lambdaFunction: this.zip,
      payloadResponseOnly: true,
      resultPath: sfn.JsonPath.DISCARD,
    });
    zip.addCatch(failed, { resultPath: '$.error' });

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(
        sizes.next(zip).next(new sfn.Succeed(this, 'Done')),
      ),
      timeout: Duration.minutes(10),
      logs: { destination: logGroup(this, 'StateMachineLogs'), level: sfn.LogLevel.ERROR },
    });
  }
}
