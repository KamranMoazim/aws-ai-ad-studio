import { readFileSync } from 'node:fs';

export interface StackOutputs {
  Region: string;
  TableName: string;
  AssetsBucketName: string;
  UserPoolId: string;
  UserPoolClientId: string;
  PolicyStoreId: string;
  ApiUrl: string;
  ApiFunctionName: string;
  SiteBucketName: string;
  SiteUrl: string;
  RenderFunctionName: string;
  ProcessUploadFunctionName: string;
  ExportStateMachineArn: string;
}

export function loadOutputs(): StackOutputs {
  let outputs: StackOutputs;
  try {
    outputs = JSON.parse(
      readFileSync(new URL('../../infra/cdk-outputs.json', import.meta.url), 'utf8'),
    ).AdStudioStack;
  } catch {
    throw new Error('infra/cdk-outputs.json not found; run npm run infra:deploy first');
  }
  process.env.AWS_REGION ??= outputs.Region;
  process.env.TABLE_NAME ??= outputs.TableName;
  process.env.ASSETS_BUCKET ??= outputs.AssetsBucketName;
  process.env.USER_POOL_ID ??= outputs.UserPoolId;
  process.env.USER_POOL_CLIENT_ID ??= outputs.UserPoolClientId;
  process.env.POLICY_STORE_ID ??= outputs.PolicyStoreId;
  process.env.SITE_URL ??= outputs.SiteUrl;
  return outputs;
}
