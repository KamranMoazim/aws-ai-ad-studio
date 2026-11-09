import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { Auth } from './auth.js';
import { Storage } from './storage.js';
import { Web } from './web.js';

export interface AdStudioStackProps extends StackProps {
  appName: string;
  clientDistPath: string;
}

export class AdStudioStack extends Stack {
  readonly storage: Storage;
  readonly auth: Auth;
  readonly web: Web;

  constructor(scope: Construct, id: string, props: AdStudioStackProps) {
    super(scope, id, props);

    this.storage = new Storage(this, 'Storage');
    this.auth = new Auth(this, 'Auth', { table: this.storage.table, appName: props.appName });
    this.web = new Web(this, 'Web', {
      storage: this.storage,
      auth: this.auth,
      clientDistPath: props.clientDistPath,
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
  }
}
