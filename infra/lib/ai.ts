import { Duration, Stack } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { appFunction, logGroup } from './function.js';
import { CLIENT_ASSETS_PREFIX, type Media } from './media.js';
import { ANTHROPIC_KEY_PARAMETER, grantReadParameters } from './secrets.js';

export const STABILITY_MODELS = [
  'stability.stable-image-remove-background-v1:0',
  'stability.stable-outpaint-v1:0',
  'stability.stable-image-style-guide-v1:0',
];
const US_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2'];

export type ClaudeProvider = 'bedrock' | 'bedrock-legacy' | 'anthropic';
export const LEGACY_CLAUDE_MODELS = [
  'anthropic.claude-haiku-4-5-20251001-v1:0',
  'anthropic.claude-sonnet-4-6',
];

export interface ClaudeAccess {
  provider: ClaudeProvider;
}

export function grantClaude(scope: Construct, fn: lambda.Function, access: ClaudeAccess): void {
  const stack = Stack.of(scope);
  fn.addEnvironment('CLAUDE_PROVIDER', access.provider);
  grantReadParameters(scope, fn, [ANTHROPIC_KEY_PARAMETER]);
  fn.addToRolePolicy(
    new iam.PolicyStatement({ actions: ['bedrock-mantle:CreateInference'], resources: ['*'] }),
  );
  fn.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        ...LEGACY_CLAUDE_MODELS.flatMap((model) =>
          US_REGIONS.map(
            (region) => `arn:${stack.partition}:bedrock:${region}::foundation-model/${model}`,
          ),
        ),
        ...LEGACY_CLAUDE_MODELS.map(
          (model) =>
            `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/us.${model}`,
        ),
      ],
    }),
  );
}

export interface AiProps {
  table: dynamodb.ITableV2;
  assetsBucket: s3.IBucket;
  media: Media;
  claude: ClaudeAccess;
}

export class Ai extends Construct {
  readonly generate: NodejsFunction;
  readonly imageEdit: lambda.DockerImageFunction;

  constructor(scope: Construct, id: string, props: AiProps) {
    super(scope, id);
    const stack = Stack.of(this);

    this.generate = appFunction(this, 'Generate', {
      entry: 'src/generate/handler.ts',
      environment: {
        TABLE_NAME: props.table.tableName,
        ASSETS_BUCKET: props.assetsBucket.bucketName,
        RENDER_FUNCTION: props.media.render.functionName,
      },
      timeout: Duration.minutes(5),
      memorySize: 1024,
    });
    props.table.grantReadWriteData(this.generate);
    props.assetsBucket.grantRead(this.generate, 'templates/*');
    props.media.render.grantInvoke(this.generate);
    grantClaude(this, this.generate, props.claude);

    this.imageEdit = new lambda.DockerImageFunction(this, 'ImageEdit', {
      code: props.media.image('image-edit.handler'),
      architecture: lambda.Architecture.X86_64,
      memorySize: 2048,
      timeout: Duration.seconds(60),
      environment: {
        TABLE_NAME: props.table.tableName,
        ASSETS_BUCKET: props.assetsBucket.bucketName,
      },
      logGroup: logGroup(this, 'ImageEditLogs'),
    });
    props.table.grantReadWriteData(this.imageEdit);
    props.assetsBucket.grantReadWrite(this.imageEdit, `${CLIENT_ASSETS_PREFIX}*`);
    this.imageEdit.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          ...STABILITY_MODELS.flatMap((model) =>
            US_REGIONS.map(
              (region) => `arn:${stack.partition}:bedrock:${region}::foundation-model/${model}`,
            ),
          ),
          ...STABILITY_MODELS.map(
            (model) =>
              `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/us.${model}`,
          ),
        ],
      }),
    );
  }
}
