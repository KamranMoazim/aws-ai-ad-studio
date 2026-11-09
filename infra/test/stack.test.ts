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
  claudeProvider: 'bedrock',
  waf: true,
  alertEmail: 'alerts@example.com',
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
  zipFunctions.length === 9 &&
    zipFunctions.every(
      (fn) =>
        fn.Properties.Runtime === 'nodejs24.x' &&
        json(fn.Properties.Architectures) === json(['arm64']),
    ),
  zipFunctions.map((fn) => [fn.Properties.Runtime, fn.Properties.Architectures]),
);
check(
  'render, upload, scan-asset and image-edit functions are x86_64 container images',
  imageFunctions.length === 4 &&
    imageFunctions.every((fn) => json(fn.Properties.Architectures) === json(['x86_64'])),
  imageFunctions.map((fn) => fn.Properties.ImageConfig),
);
const stateMachines = ofType('AWS::StepFunctions::StateMachine');
const [stateMachine] = stateMachines.filter((machine) =>
  json(machine.Properties).includes('RenderSize'),
);
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
  'only health, branding, download links, the Stripe webhook and preflight are public',
  json(publicRoutes) ===
    json([
      'GET /branding',
      'GET /d/{token}',
      'GET /health',
      'OPTIONS /{proxy+}',
      'POST /webhooks/stripe',
    ]),
  publicRoutes,
);

const [distribution] = ofType('AWS::CloudFront::Distribution');
const behaviors = distribution?.Properties.DistributionConfig?.CacheBehaviors ?? [];
const paths = behaviors.map((behavior: { PathPattern: string }) => behavior.PathPattern).sort();
check(
  'branding, template assets and download links have their own paths',
  JSON.stringify(paths) ===
    JSON.stringify(['branding/*', 'd/*', 'scan-fixtures/*', 'template-assets/*']),
  paths,
);
check(
  'no nat gateway or vpc',
  ofType('AWS::EC2::NatGateway').length === 0 && ofType('AWS::EC2::VPC').length === 0,
);

const download = behaviors.find(
  (behavior: { PathPattern: string }) => behavior.PathPattern === 'd/*',
);
check(
  'download links are never cached',
  download?.CachePolicyId === '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
  download,
);
check(
  'stripe keys are readable only as named parameters',
  policies.includes('/adstudio/stripe-secret-key') && !policies.includes('parameter/*'),
);

const scanMachine = stateMachines.find((machine) =>
  json(machine.Properties).includes('BrowseSite'),
);
check(
  'scan state machine browses, processes and analyzes with a failure path',
  ['BrowseSite', 'ProcessAssets', 'AnalyzeContent', 'MarkFailed'].every((step) =>
    json(scanMachine?.Properties ?? {}).includes(step),
  ),
);
check(
  'scan browsing uses the managed AgentCore browser only',
  policies.includes('bedrock-agentcore:StartBrowserSession') &&
    policies.includes('browser/aws.browser.v1'),
);
check(
  'scan analysis may call Bedrock through the Mantle endpoint',
  policies.includes('bedrock-mantle:CreateInference'),
);

check(
  'image edits may invoke only the three Stability image services',
  policies.includes('stable-image-remove-background') &&
    policies.includes('stable-outpaint') &&
    policies.includes('stable-image-style-guide') &&
    !policies.includes('foundation-model/*'),
);
check(
  'the Anthropic key is readable as a named parameter',
  policies.includes('/adstudio/anthropic-api-key'),
);
check(
  'Claude on Bedrock is limited to the named models',
  policies.includes('foundation-model/anthropic.claude-haiku-5-5') &&
    policies.includes('foundation-model/anthropic.claude-sonnet-5-5') &&
    !policies.includes('foundation-model/anthropic.*'),
);

const siteHeaders = json(ofType('AWS::CloudFront::ResponseHeadersPolicy'));
const imageSources = siteHeaders.match(/img-src[^;]{0,200}/)?.[0] ?? '';
check(
  'the web app may show client photos from the assets bucket by presigned URL',
  imageSources.includes('StorageAssetsBucket') && imageSources.includes('RegionalDomainName'),
  imageSources,
);

const acls = ofType('AWS::WAFv2::WebACL');
const siteAcl = acls.find((acl) => acl.Properties.Scope === 'CLOUDFRONT');
check(
  'CloudFront WAF uses managed rules and rate-limits download links',
  [
    'AWSManagedRulesCommonRuleSet',
    'AWSManagedRulesKnownBadInputsRuleSet',
    'AWSManagedRulesAmazonIpReputationList',
  ].every((name) => json(siteAcl?.Properties.Rules ?? []).includes(name)) &&
    json(siteAcl?.Properties.Rules ?? []).includes('"SearchString":"/d/"'),
);
check(
  'the distribution is behind the WAF',
  Boolean(distribution?.Properties.DistributionConfig?.WebACLId),
);
check(
  'sign-in is rate limited by a regional WAF on the user pool',
  acls.some((acl) => acl.Properties.Scope === 'REGIONAL') &&
    ofType('AWS::WAFv2::WebACLAssociation').length === 1,
);
const alarmNames = ofType('AWS::CloudWatch::Alarm').map((alarm) => json(alarm.Properties));
check(
  'alarms cover Lambda errors, throttles, failed exports and scans, API 5xx and dead letters',
  alarmNames.length >= 15 &&
    ['Throttles', 'ExecutionsFailed', '5xx', 'ApproximateNumberOfMessagesVisible'].every((name) =>
      alarmNames.some((alarm) => alarm.includes(name)),
    ),
  alarmNames.length,
);
const [budget] = ofType('AWS::Budgets::Budget');
check('a $50 monthly budget alerts by email', budget?.Properties.Budget.BudgetLimit.Amount === 50);
check(
  'failed async generations go to a dead-letter queue',
  json(ofType('AWS::Lambda::EventInvokeConfig')).includes('OnFailure'),
);
const [stage] = ofType('AWS::ApiGatewayV2::Stage');
check(
  'the API is throttled',
  stage?.Properties.DefaultRouteSettings?.ThrottlingRateLimit > 0 &&
    stage?.Properties.DefaultRouteSettings?.ThrottlingBurstLimit > 0,
);
const lifecycle = json(
  ofType('AWS::S3::Bucket').map((item) => item.Properties.LifecycleConfiguration ?? {}),
);
check(
  'scan files expire after 30 days',
  lifecycle.includes('"Prefix":"scans/"') && lifecycle.includes('"ExpirationInDays":30'),
);
check(
  'renders per export are capped for the account concurrency limit',
  /MaxConcurrency\\+":4[,}]/.test(json(stateMachine?.Properties ?? {})),
);

const withoutWaf = Template.fromStack(
  new AdStudioStack(new App(), 'NoWafStack', {
    env: { account: '111111111111', region: 'us-east-1' },
    appName: 'Acme Ads',
    clientDistPath: distPath,
    claudeProvider: 'bedrock-legacy',
    claudeModels: { copy: 'global.anthropic.claude-opus-4-6-v1' },
    waf: false,
  }),
).toJSON().Resources as Record<string, { Type: string; Properties: any }>;
const legacyPolicies = json(
  Object.values(withoutWaf).filter((resource) => resource.Type === 'AWS::IAM::Policy'),
);
const legacyEnvironments = json(
  Object.values(withoutWaf)
    .filter((resource) => resource.Type === 'AWS::Lambda::Function')
    .map((resource) => resource.Properties.Environment),
);
check(
  'Claude models from infra/.env reach the functions and their permissions',
  legacyEnvironments.includes('"CLAUDE_COPY_MODEL":"global.anthropic.claude-opus-4-6-v1"') &&
    legacyEnvironments.includes(
      '"CLAUDE_FAST_MODEL":"us.anthropic.claude-haiku-4-5-20251001-v1:0"',
    ) &&
    legacyPolicies.includes('foundation-model/anthropic.claude-opus-4-6-v1') &&
    legacyPolicies.includes('inference-profile/global.anthropic.claude-opus-4-6-v1') &&
    !legacyPolicies.includes('claude-sonnet-4-6'),
);
check(
  'WAF and budget can be left out',
  !Object.values(withoutWaf).some(
    (resource) =>
      resource.Type === 'AWS::WAFv2::WebACL' || resource.Type === 'AWS::Budgets::Budget',
  ),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
