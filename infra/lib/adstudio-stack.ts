import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { Ai, DEFAULT_CLAUDE_MODELS, type ClaudeModels, type ClaudeProvider } from './ai.js';
import { Auth } from './auth.js';
import { Edge } from './edge.js';
import { ExportPipeline } from './export-pipeline.js';
import { Media } from './media.js';
import { Monitoring } from './monitoring.js';
import { ScanPipeline } from './scan-pipeline.js';
import { Storage } from './storage.js';
import { Web, type CustomDomain } from './web.js';

export interface AdStudioStackProps extends StackProps {
  appName: string;
  clientDistPath: string;
  senderEmail?: string;
  claudeProvider: ClaudeProvider;
  claudeModels?: Partial<ClaudeModels>;
  alertEmail?: string;
  waf: boolean;
  renderConcurrency?: number;
  domain?: CustomDomain;
}

export class AdStudioStack extends Stack {
  readonly storage: Storage;
  readonly auth: Auth;
  readonly web: Web;
  readonly media: Media;
  readonly exports: ExportPipeline;
  readonly scans: ScanPipeline;
  readonly ai: Ai;
  readonly edge?: Edge;
  readonly monitoring: Monitoring;

  constructor(scope: Construct, id: string, props: AdStudioStackProps) {
    super(scope, id, props);
    const claude = {
      provider: props.claudeProvider,
      models: { ...DEFAULT_CLAUDE_MODELS[props.claudeProvider], ...props.claudeModels },
    };

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
      renderConcurrency: props.renderConcurrency,
    });
    this.scans = new ScanPipeline(this, 'Scan', {
      table: this.storage.table,
      assetsBucket: this.storage.assetsBucket,
      scanAssets: this.media.scanAssets,
      claude,
    });
    this.ai = new Ai(this, 'Ai', {
      table: this.storage.table,
      assetsBucket: this.storage.assetsBucket,
      media: this.media,
      claude,
    });
    this.edge = props.waf ? new Edge(this, 'Edge', { userPool: this.auth.userPool }) : undefined;
    this.web = new Web(this, 'Web', {
      storage: this.storage,
      auth: this.auth,
      media: this.media,
      exports: this.exports,
      scans: this.scans,
      ai: this.ai,
      clientDistPath: props.clientDistPath,
      senderEmail: props.senderEmail,
      webAclArn: this.edge?.siteAcl.attrArn,
      domain: props.domain,
    });
    this.monitoring = new Monitoring(this, 'Monitoring', {
      alertEmail: props.alertEmail,
      functions: {
        Api: this.web.api,
        StripeWebhook: this.web.stripeWebhook,
        Render: this.media.render,
        ProcessUpload: this.media.processUpload,
        ExportZip: this.exports.zip,
        ScanBrowse: this.scans.browse,
        ScanAssets: this.media.scanAssets,
        ScanAnalyze: this.scans.analyze,
        Generate: this.ai.generate,
        ImageEdit: this.ai.imageEdit,
      },
      throttleWatch: { Api: this.web.api, Render: this.media.render },
      stateMachines: { Export: this.exports.stateMachine, Scan: this.scans.stateMachine },
      httpApi: this.web.httpApi,
      deadLetterQueue: this.ai.deadLetterQueue,
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
    new CfnOutput(this, 'AlertTopicArn', { value: this.monitoring.topic.topicArn });
    new CfnOutput(this, 'GenerateDlqUrl', { value: this.ai.deadLetterQueue.queueUrl });
    new CfnOutput(this, 'GenerateFunctionName', { value: this.ai.generate.functionName });
    new CfnOutput(this, 'ScanStateMachineArn', { value: this.scans.stateMachine.stateMachineArn });
    new CfnOutput(this, 'ExportStateMachineArn', {
      value: this.exports.stateMachine.stateMachineArn,
    });
  }
}
