import { Duration, Size } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';
import { logGroup } from './function.js';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const UPLOADS_PREFIX = 'uploads/';
export const CLIENT_ASSETS_PREFIX = 'assets/';
export const EXPORTS_PREFIX = 'exports/';
export const SCANS_PREFIX = 'scans/';

export interface MediaProps {
  table: dynamodb.ITableV2;
  assetsBucket: s3.IBucket;
}

export class Media extends Construct {
  readonly processUpload: lambda.DockerImageFunction;
  readonly render: lambda.DockerImageFunction;
  readonly scanAssets: lambda.DockerImageFunction;
  readonly image: (handler: string) => lambda.DockerImageCode;

  constructor(scope: Construct, id: string, props: MediaProps) {
    super(scope, id);

    const image = (this.image = (handler: string) =>
      lambda.DockerImageCode.fromImageAsset(REPO_ROOT, {
        file: 'media/Dockerfile',
        platform: Platform.LINUX_AMD64,
        cmd: [handler],
      }));
    const environment = {
      TABLE_NAME: props.table.tableName,
      ASSETS_BUCKET: props.assetsBucket.bucketName,
    };

    this.processUpload = new lambda.DockerImageFunction(this, 'ProcessUpload', {
      code: image('process-upload.handler'),
      architecture: lambda.Architecture.X86_64,
      memorySize: 2048,
      timeout: Duration.seconds(25),
      environment,
      logGroup: logGroup(this, 'ProcessUploadLogs'),
    });
    props.table.grantReadWriteData(this.processUpload);
    props.assetsBucket.grantRead(this.processUpload, `${UPLOADS_PREFIX}*`);
    props.assetsBucket.grantDelete(this.processUpload, `${UPLOADS_PREFIX}*`);
    props.assetsBucket.grantPut(this.processUpload, `${CLIENT_ASSETS_PREFIX}*`);
    this.processUpload.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['rekognition:DetectFaces'], resources: ['*'] }),
    );

    this.render = new lambda.DockerImageFunction(this, 'Render', {
      code: image('render.handler'),
      architecture: lambda.Architecture.X86_64,
      memorySize: 3008,
      timeout: Duration.seconds(90),
      ephemeralStorageSize: Size.mebibytes(1024),
      environment,
      logGroup: logGroup(this, 'RenderLogs'),
    });
    props.assetsBucket.grantRead(this.render, `${CLIENT_ASSETS_PREFIX}*`);

    this.scanAssets = new lambda.DockerImageFunction(this, 'ScanAssets', {
      code: image('scan-assets.handler'),
      architecture: lambda.Architecture.X86_64,
      memorySize: 2048,
      timeout: Duration.minutes(3),
      environment,
      logGroup: logGroup(this, 'ScanAssetsLogs'),
    });
    props.assetsBucket.grantReadWrite(this.scanAssets, `${SCANS_PREFIX}*`);
    this.scanAssets.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['rekognition:DetectFaces'], resources: ['*'] }),
    );
    props.assetsBucket.grantReadWrite(this.render, `${EXPORTS_PREFIX}*`);
  }
}
