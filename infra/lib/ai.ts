import { Duration, Stack } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
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
const INFERENCE_PROFILE = /^(us|eu|apac|global)\./;

export type ClaudeProvider = 'bedrock' | 'bedrock-legacy' | 'anthropic';

export interface ClaudeModels {
  fast: string;
  copy: string;
}

export const DEFAULT_CLAUDE_MODELS: Record<ClaudeProvider, ClaudeModels> = {
  bedrock: { fast: 'anthropic.claude-haiku-5-5', copy: 'anthropic.claude-sonnet-5-5' },
  'bedrock-legacy': {
    fast: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    copy: 'us.anthropic.claude-sonnet-4-6',
  },
  anthropic: { fast: 'claude-haiku-5-5', copy: 'claude-sonnet-5-5' },
};

export interface ClaudeAccess {
  provider: ClaudeProvider;
  models: ClaudeModels;
}

function modelArns(stack: Stack, model: string): string[] {
  const base = model.replace(INFERENCE_PROFILE, '');
  // Cross-region profiles route to any region they cover, so the model is allowed everywhere
  const foundation = `arn:${stack.partition}:bedrock:*::foundation-model/${base}`;
  return model === base
    ? [foundation]
    : [
        foundation,
        `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/${model}`,
      ];
}

export function grantClaude(scope: Construct, fn: lambda.Function, access: ClaudeAccess): void {
  const stack = Stack.of(scope);
  fn.addEnvironment('CLAUDE_PROVIDER', access.provider);
  fn.addEnvironment('CLAUDE_FAST_MODEL', access.models.fast);
  fn.addEnvironment('CLAUDE_COPY_MODEL', access.models.copy);
  grantReadParameters(scope, fn, [ANTHROPIC_KEY_PARAMETER]);
  fn.addToRolePolicy(
    new iam.PolicyStatement({ actions: ['bedrock-mantle:CreateInference'], resources: ['*'] }),
  );
  if (access.provider !== 'anthropic') {
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          ...new Set(
            [access.models.fast, access.models.copy].flatMap((model) => modelArns(stack, model)),
          ),
        ],
      }),
    );
  }
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
  readonly deadLetterQueue: sqs.Queue;

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
    this.deadLetterQueue = new sqs.Queue(this, 'GenerateDeadLetters', {
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    this.generate.configureAsyncInvoke({
      retryAttempts: 1,
      onFailure: new destinations.SqsDestination(this.deadLetterQueue),
    });
    props.table.grantReadWriteData(this.generate);
    props.assetsBucket.grantRead(this.generate, 'templates/*');
    props.media.render.grantInvoke(this.generate);
    grantClaude(this, this.generate, props.claude);

    this.imageEdit = new lambda.DockerImageFunction(this, 'ImageEdit', {
      code: props.media.image('image-edit.handler'),
      architecture: lambda.Architecture.X86_64,
      memorySize: 2048,
      timeout: Duration.seconds(120),
      environment: {
        TABLE_NAME: props.table.tableName,
        ASSETS_BUCKET: props.assetsBucket.bucketName,
      },
      logGroup: logGroup(this, 'ImageEditLogs'),
    });
    this.imageEdit.configureAsyncInvoke({ retryAttempts: 0 });
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
