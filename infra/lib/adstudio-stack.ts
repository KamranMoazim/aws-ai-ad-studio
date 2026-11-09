import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { Ai, type ClaudeProvider } from './ai.js';
import { Auth } from './auth.js';
import { ExportPipeline } from './export-pipeline.js';
import { Media } from './media.js';
import { ScanPipeline } from './scan-pipeline.js';
import { Storage } from './storage.js';
import { Web } from './web.js';

export interface AdStudioStackProps extends StackProps {
  appName: string;
  clientDistPath: string;
  senderEmail?: string;
  claudeProvider: ClaudeProvider;
}

export class AdStudioStack extends Stack {
  readonly storage: Storage;
  readonly auth: Auth;
  readonly web: Web;
  readonly media: Media;
  readonly exports: ExportPipeline;
  readonly scans: ScanPipeline;
  readonly ai: Ai;

  constructor(scope: Construct, id: string, props: AdStudioStackProps) {
    super(scope, id, props);

    this.storage = new Storage(this, 'Storage');
    this.auth = new Auth(this, 'Auth', { table: this.storage.table, appName: props.appName });
    this.media = new Media(this, 'Media', {
      table: this.storage.table,
      assetsBucket: this.storage.assetsBucket,
    });
    this.exports = new ExportPipeline(this, 'Export', {
      table: this.storage.table,
      assetsBucket: this.storage.assetsBucket,
      render: this.media.render,
    });
    this.scans = new ScanPipeline(this, 'Scan', {
      table: this.storage.table,
      assetsBucket: this.storage.assetsBucket,
      scanAssets: this.media.scanAssets,
      claude: { provider: props.claudeProvider },
    });
    this.ai = new Ai(this, 'Ai', {
      table: this.storage.table,
      assetsBucket: this.storage.assetsBucket,
      media: this.media,
      claude: { provider: props.claudeProvider },
    });
    this.web = new Web(this, 'Web', {
      storage: this.storage,
      auth: this.auth,
      media: this.media,
      exports: this.exports,
      scans: this.scans,
      ai: this.ai,
      clientDistPath: props.clientDistPath,
      senderEmail: props.senderEmail,
    });
    this.auth.customMessage.addEnvironment('SITE_URL', this.web.siteUrl);

    new CfnOutput(this, 'Region', { value: this.region });
    new CfnOutput(this, 'TableName', { value: this.storage.table.tableName });
    new CfnOutput(this, 'AssetsBucketName', { value: this.storage.assetsBucket.bucketName });
    new CfnOutput(this, 'UserPoolId', { value: this.auth.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.auth.webClient.userPoolClientId });
    new CfnOutput(this, 'PolicyStoreId', { value: this.auth.policyStore.attrPolicyStoreId });
    new CfnOutput(this, 'ApiUrl', { value: this.web.httpApi.apiEndpoint });
    new CfnOutput(this, 'ApiFunctionName', { value: this.web.api.functionName });
    new CfnOutput(this, 'SiteBucketName', { value: this.web.siteBucket.bucketName });
    new CfnOutput(this, 'SiteUrl', { value: this.web.siteUrl });
    new CfnOutput(this, 'RenderFunctionName', { value: this.media.render.functionName });
    new CfnOutput(this, 'ProcessUploadFunctionName', {
      value: this.media.processUpload.functionName,
    });
    new CfnOutput(this, 'StripeWebhookUrl', {
      value: `${this.web.httpApi.apiEndpoint}/webhooks/stripe`,
    });
    new CfnOutput(this, 'ScanStateMachineArn', { value: this.scans.stateMachine.stateMachineArn });
    new CfnOutput(this, 'ExportStateMachineArn', {
      value: this.exports.stateMachine.stateMachineArn,
    });
  }
}
