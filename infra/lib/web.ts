import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
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
import { appFunction, logGroup } from './function.js';
import type { Storage } from './storage.js';

export const LOCAL_ORIGIN = 'http://localhost:5173';
export const BRANDING_PREFIX = 'branding/';

export interface WebProps {
  storage: Storage;
  auth: Auth;
  clientDistPath: string;
}

export class Web extends Construct {
  readonly api: NodejsFunction;
  readonly httpApi: apigwv2.HttpApi;
  readonly siteBucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  readonly siteUrl: string;

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
    const spaFallback = (httpStatus: number): cloudfront.ErrorResponse => ({
      httpStatus,
      responseHttpStatus: 200,
      responsePagePath: '/index.html',
      ttl: Duration.seconds(0),
    });
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: headers,
      },
      additionalBehaviors: {
        [`${BRANDING_PREFIX}*`]: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(assetsBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy: headers,
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
      allowedMethods: [s3.HttpMethods.PUT],
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
      },
      timeout: Duration.seconds(29),
      memorySize: 512,
    });
    table.grantReadWriteData(this.api);
    assetsBucket.grantReadWrite(this.api, `${BRANDING_PREFIX}*`);
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

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'adstudio-api',
      corsPreflight: {
        allowOrigins: [LOCAL_ORIGIN, this.siteUrl],
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new HttpLambdaIntegration('ApiIntegration', this.api);
    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${stack.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [webClient.userPoolClientId] },
    );
    for (const path of ['/health', '/branding']) {
      this.httpApi.addRoutes({ path, methods: [apigwv2.HttpMethod.GET], integration });
    }
    this.httpApi.addRoutes({
      path: '/{proxy+}',
      // ANY would route OPTIONS through the authorizer and break CORS preflight.
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
        }),
      ],
      distribution: this.distribution,
      distributionPaths: ['/*'],
      logGroup: logGroup(this, 'SiteDeploymentLogs'),
    });
  }
}
