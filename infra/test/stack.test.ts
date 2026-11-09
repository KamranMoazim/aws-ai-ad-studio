import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdStudioStack } from '../lib/adstudio-stack.js';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra?: unknown): void {
  if (ok) {
    passed++;
  } else {
    failed++;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(extra)}`);
}

const distPath = mkdtempSync(join(tmpdir(), 'adstudio-dist-'));
writeFileSync(join(distPath, 'index.html'), '<div id="root"></div>');
const stack = new AdStudioStack(new App(), 'TestStack', {
  env: { account: '111111111111', region: 'us-east-1' },
  appName: 'Acme Ads',
  clientDistPath: distPath,
});
const template = Template.fromStack(stack);
const resources = template.toJSON().Resources as Record<
  string,
  { Type: string; DeletionPolicy?: string; Properties: any }
>;
const ofType = (type: string) =>
  Object.values(resources).filter((resource) => resource.Type === type);
const json = (value: unknown) => JSON.stringify(value);

const [table] = ofType('AWS::DynamoDB::GlobalTable');
const tableProps = table?.Properties ?? {};
check(
  'table on demand with PK/SK',
  tableProps.TableName === 'adstudio' &&
    tableProps.BillingMode === 'PAY_PER_REQUEST' &&
    json(tableProps.KeySchema) ===
      json([
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ]),
  tableProps,
);
check('ttl on expiresAt', tableProps.TimeToLiveSpecification?.AttributeName === 'expiresAt');
check(
  'one gsi on GSI1PK/GSI1SK',
  tableProps.GlobalSecondaryIndexes?.length === 1 &&
    tableProps.GlobalSecondaryIndexes[0].IndexName === 'GSI1',
  tableProps.GlobalSecondaryIndexes,
);
check('table is destroyed with the stack', table?.DeletionPolicy === 'Delete');

const buckets = ofType('AWS::S3::Bucket');
check(
  'buckets are private and encrypted',
  buckets.length === 2 &&
    buckets.every(
      (bucket) =>
        bucket.Properties.PublicAccessBlockConfiguration?.BlockPublicPolicy === true &&
        bucket.Properties.BucketEncryption?.ServerSideEncryptionConfiguration?.[0]
          ?.ServerSideEncryptionByDefault?.SSEAlgorithm === 'AES256',
    ),
  buckets.map((bucket) => bucket.Properties),
);

const [pool] = ofType('AWS::Cognito::UserPool');
check(
  'user pool is invite only',
  pool?.Properties.AdminCreateUserConfig?.AllowAdminCreateUserOnly === true,
  pool?.Properties.AdminCreateUserConfig,
);
check(
  'mfa optional with totp',
  pool?.Properties.MfaConfiguration === 'OPTIONAL' &&
    json(pool?.Properties.EnabledMfas) === json(['SOFTWARE_TOKEN_MFA']),
  pool?.Properties,
);
check('custom message trigger set', Boolean(pool?.Properties.LambdaConfig?.CustomMessage));

const [webClient] = ofType('AWS::Cognito::UserPoolClient');
const flows: string[] = webClient?.Properties.ExplicitAuthFlows ?? [];
check(
  'web client uses srp, no plain password flow',
  flows.includes('ALLOW_USER_SRP_AUTH') && !flows.includes('ALLOW_USER_PASSWORD_AUTH'),
  flows,
);
check(
  'access tokens last 15 minutes',
  webClient?.Properties.AccessTokenValidity === 15 &&
    webClient?.Properties.TokenValidityUnits?.AccessToken === 'minutes',
  webClient?.Properties,
);

const [policyStore] = ofType('AWS::VerifiedPermissions::PolicyStore');
const schema = JSON.parse(policyStore?.Properties.Schema?.CedarJson ?? '{}');
check('policy store strict', policyStore?.Properties.ValidationSettings?.Mode === 'STRICT');
check(
  'cedar schema declares users in roles',
  json(schema.AdStudio?.entityTypes?.User?.memberOfTypes) === json(['Role']),
);

const appFunctions = ofType('AWS::Lambda::Function').filter(
  (fn) => fn.Properties.Environment?.Variables?.TABLE_NAME,
);
const zipFunctions = appFunctions.filter((fn) => fn.Properties.Runtime);
const imageFunctions = appFunctions.filter((fn) => fn.Properties.PackageType === 'Image');
check(
  'zip functions on node 24 arm64',
  zipFunctions.length === 4 &&
    zipFunctions.every(
      (fn) =>
        fn.Properties.Runtime === 'nodejs24.x' &&
        json(fn.Properties.Architectures) === json(['arm64']),
    ),
  zipFunctions.map((fn) => [fn.Properties.Runtime, fn.Properties.Architectures]),
);
check(
  'render and upload functions are x86_64 container images',
  imageFunctions.length === 2 &&
    imageFunctions.every((fn) => json(fn.Properties.Architectures) === json(['x86_64'])),
  imageFunctions.map((fn) => fn.Properties.ImageConfig),
);
const [stateMachine] = ofType('AWS::StepFunctions::StateMachine');
const definition = json(stateMachine?.Properties ?? {});
check(
  'export state machine maps over sizes with concurrency 8 and a failure path',
  definition.includes('MaxConcurrency') &&
    definition.includes('MarkFailed') &&
    definition.includes('8'),
);
const [bucket] = ofType('AWS::S3::Bucket').filter((item) =>
  json(item.Properties.LifecycleConfiguration ?? {}).includes('uploads/'),
);
check(
  'raw uploads expire after a day',
  json(bucket?.Properties.LifecycleConfiguration ?? {}).includes('"ExpirationInDays":1'),
  bucket?.Properties.LifecycleConfiguration,
);

const policies = json(ofType('AWS::IAM::Policy'));
check(
  'api may call verified permissions',
  policies.includes('verifiedpermissions:IsAuthorized') &&
    policies.includes('verifiedpermissions:BatchIsAuthorized'),
);
check('no wildcard verified permissions action', !policies.includes('verifiedpermissions:*'));

const routes = ofType('AWS::ApiGatewayV2::Route');
const publicRoutes = routes
  .filter((route) => route.Properties.AuthorizationType !== 'JWT')
  .map((route) => route.Properties.RouteKey)
  .sort();
check(
  'only health and branding are public',
  json(publicRoutes) === json(['GET /branding', 'GET /health']),
  publicRoutes,
);

const [distribution] = ofType('AWS::CloudFront::Distribution');
const behaviors = distribution?.Properties.DistributionConfig?.CacheBehaviors ?? [];
const paths = behaviors.map((behavior: { PathPattern: string }) => behavior.PathPattern).sort();
check(
  'only branding and template assets are served from the assets bucket',
  JSON.stringify(paths) === JSON.stringify(['branding/*', 'template-assets/*']),
  paths,
);
check(
  'no nat gateway or vpc',
  ofType('AWS::EC2::NatGateway').length === 0 && ofType('AWS::EC2::VPC').length === 0,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
