import { Duration, Fn, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import type { Auth } from './auth.js';
import type { ExportPipeline } from './export-pipeline.js';
import { CLIENT_ASSETS_PREFIX, EXPORTS_PREFIX, UPLOADS_PREFIX, type Media } from './media.js';
import { appFunction, logGroup } from './function.js';
import {
  grantReadParameters,
  STRIPE_SECRET_KEY_PARAMETER,
  STRIPE_WEBHOOK_SECRET_PARAMETER,
} from './secrets.js';
import type { Storage } from './storage.js';

export const LOCAL_ORIGIN = 'http://localhost:5173';
export const BRANDING_PREFIX = 'branding/';
export const DOWNLOAD_PREFIX = 'd/';
export const TEMPLATE_ASSETS_PREFIX = 'template-assets/';
export const TEMPLATES_PREFIX = 'templates/';

export interface WebProps {
  storage: Storage;
  auth: Auth;
  media: Media;
  exports: ExportPipeline;
  clientDistPath: string;
  senderEmail?: string;
}

export class Web extends Construct {
  readonly api: NodejsFunction;
  readonly httpApi: apigwv2.HttpApi;
  readonly siteBucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  readonly siteUrl: string;
  readonly stripeWebhook: NodejsFunction;

  constructor(scope: Construct, id: string, props: WebProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const { table, assetsBucket } = props.storage;
    const { userPool, webClient, policyStore } = props.auth;

    this.siteBucket = new s3.Bucket(this, 'SiteBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SiteHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self'",
            [
              "connect-src 'self'",
              `https://cognito-idp.${stack.region}.amazonaws.com`,
              `https://*.execute-api.${stack.region}.amazonaws.com`,
              `https://*.s3.${stack.region}.amazonaws.com`,
              'https://*.s3.amazonaws.com',
            ].join(' '),
            "frame-ancestors 'none'",
            "base-uri 'none'",
            "form-action 'self'",
          ].join('; '),
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
      },
    });
    // CORS is handled in the Lambda; API-level CORS naming CloudFront would cycle with /d/*.
    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', { apiName: 'adstudio-api' });
    const apiOrigin = new origins.HttpOrigin(
      Fn.select(2, Fn.split('/', this.httpApi.apiEndpoint)),
      { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY },
    );

    const spaFallback = (httpStatus: number): cloudfront.ErrorResponse => ({
      httpStatus,
      responseHttpStatus: 200,
      responsePagePath: '/index.html',
      ttl: Duration.seconds(0),
    });
    const assetsOrigin = origins.S3BucketOrigin.withOriginAccessControl(assetsBucket);
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: headers,
      },
      additionalBehaviors: {
        ...Object.fromEntries(
          [BRANDING_PREFIX, TEMPLATE_ASSETS_PREFIX].map((prefix) => [
            `${prefix}*`,
            {
              origin: assetsOrigin,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
              responseHeadersPolicy: headers,
            },
          ]),
        ),
        [`${DOWNLOAD_PREFIX}*`]: {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [spaFallback(403), spaFallback(404)],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
    this.siteUrl = `https://${this.distribution.distributionDomainName}`;

    // Listing the CloudFront domain here would make a bucket <-> distribution cycle.
    assetsBucket.addCorsRule({
      allowedOrigins: ['*'],
      allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
      allowedHeaders: ['content-type', 'content-length'],
      maxAge: 3600,
    });

    this.api = appFunction(this, 'Api', {
      entry: 'src/api/lambda.ts',
      environment: {
        TABLE_NAME: table.tableName,
        ASSETS_BUCKET: assetsBucket.bucketName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: webClient.userPoolClientId,
        POLICY_STORE_ID: policyStore.attrPolicyStoreId,
        SITE_URL: this.siteUrl,
        PROCESS_UPLOAD_FUNCTION: props.media.processUpload.functionName,
        EXPORT_STATE_MACHINE_ARN: props.exports.stateMachine.stateMachineArn,
        CORS_ORIGINS: `${LOCAL_ORIGIN},${this.siteUrl}`,
        ...(props.senderEmail ? { SENDER_EMAIL: props.senderEmail } : {}),
      },
      timeout: Duration.seconds(29),
      memorySize: 512,
    });
    table.grantReadWriteData(this.api);
    for (const prefix of [
      BRANDING_PREFIX,
      TEMPLATE_ASSETS_PREFIX,
      TEMPLATES_PREFIX,
      EXPORTS_PREFIX,
    ]) {
      assetsBucket.grantReadWrite(this.api, `${prefix}*`);
    }
    assetsBucket.grantPut(this.api, `${UPLOADS_PREFIX}*`);
    assetsBucket.grantRead(this.api, `${CLIENT_ASSETS_PREFIX}*`);
    props.media.processUpload.grantInvoke(this.api);
    props.exports.stateMachine.grantStartExecution(this.api);
    this.api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'verifiedpermissions:IsAuthorized',
          'verifiedpermissions:BatchIsAuthorized',
          'verifiedpermissions:CreatePolicy',
          'verifiedpermissions:DeletePolicy',
        ],
        resources: [policyStore.attrArn],
      }),
    );
    this.api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
        ],
        resources: [userPool.userPoolArn],
      }),
    );

    const integration = new HttpLambdaIntegration('ApiIntegration', this.api);
    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${stack.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [webClient.userPoolClientId] },
    );
    this.stripeWebhook = appFunction(this, 'StripeWebhook', {
      entry: 'src/stripe-webhook/handler.ts',
      environment: {
        TABLE_NAME: table.tableName,
        EXPORT_STATE_MACHINE_ARN: props.exports.stateMachine.stateMachineArn,
      },
      timeout: Duration.seconds(20),
    });
    table.grantReadWriteData(this.stripeWebhook);
    props.exports.stateMachine.grantStartExecution(this.stripeWebhook);
    grantReadParameters(this, this.stripeWebhook, [
      STRIPE_SECRET_KEY_PARAMETER,
      STRIPE_WEBHOOK_SECRET_PARAMETER,
    ]);
    grantReadParameters(this, this.api, [STRIPE_SECRET_KEY_PARAMETER]);
    if (props.senderEmail) {
      new ses.EmailIdentity(this, 'Sender', { identity: ses.Identity.email(props.senderEmail) });
      this.api.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['ses:SendEmail'],
          resources: [`arn:${stack.partition}:ses:${stack.region}:${stack.account}:identity/*`],
        }),
      );
    }

    const publicRoutes: Array<[string, apigwv2.HttpMethod]> = [
      ['/health', apigwv2.HttpMethod.GET],
      ['/branding', apigwv2.HttpMethod.GET],
      ['/d/{token}', apigwv2.HttpMethod.GET],
      // Preflight requests carry no token; the Lambda answers them from CORS_ORIGINS.
      ['/{proxy+}', apigwv2.HttpMethod.OPTIONS],
    ];
    for (const [path, method] of publicRoutes) {
      this.httpApi.addRoutes({ path, methods: [method], integration });
    }
    this.httpApi.addRoutes({
      path: '/webhooks/stripe',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('StripeWebhookIntegration', this.stripeWebhook),
    });
    this.httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.PUT,
        apigwv2.HttpMethod.DELETE,
      ],
      integration,
      authorizer,
    });

    new s3deploy.BucketDeployment(this, 'SiteDeployment', {
      destinationBucket: this.siteBucket,
      sources: [
        s3deploy.Source.asset(props.clientDistPath),
        s3deploy.Source.jsonData('config.json', {
          region: stack.region,
          apiUrl: this.httpApi.apiEndpoint,
          userPoolId: userPool.userPoolId,
          userPoolClientId: webClient.userPoolClientId,
          siteUrl: this.siteUrl,
        }),
      ],
      distribution: this.distribution,
      distributionPaths: ['/*'],
      logGroup: logGroup(this, 'SiteDeploymentLogs'),
    });
  }
}
