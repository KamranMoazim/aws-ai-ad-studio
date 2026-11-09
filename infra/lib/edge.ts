import type * as cognito from 'aws-cdk-lib/aws-cognito';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export const DOWNLOAD_LIMIT_PER_5_MIN = 100;
export const SITE_LIMIT_PER_5_MIN = 2000;
export const SIGN_IN_LIMIT_PER_5_MIN = 300;

const visibility = (name: string): wafv2.CfnWebACL.VisibilityConfigProperty => ({
  cloudWatchMetricsEnabled: true,
  metricName: name,
  sampledRequestsEnabled: true,
});

const managed = (name: string, priority: number): wafv2.CfnWebACL.RuleProperty => ({
  name,
  priority,
  overrideAction: { none: {} },
  statement: { managedRuleGroupStatement: { vendorName: 'AWS', name } },
  visibilityConfig: visibility(name),
});

const rateLimit = (
  name: string,
  priority: number,
  limit: number,
  pathPrefix?: string,
): wafv2.CfnWebACL.RuleProperty => ({
  name,
  priority,
  action: { block: {} },
  statement: {
    rateBasedStatement: {
      limit,
      aggregateKeyType: 'IP',
      scopeDownStatement: pathPrefix
        ? {
            byteMatchStatement: {
              fieldToMatch: { uriPath: {} },
              positionalConstraint: 'STARTS_WITH',
              searchString: pathPrefix,
              textTransformations: [{ priority: 0, type: 'NONE' }],
            },
          }
        : undefined,
    },
  },
  visibilityConfig: visibility(name),
});

export interface EdgeProps {
  userPool: cognito.IUserPool;
}

export class Edge extends Construct {
  readonly siteAcl: wafv2.CfnWebACL;
  readonly signInAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: EdgeProps) {
    super(scope, id);

    this.siteAcl = new wafv2.CfnWebACL(this, 'SiteAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('adstudio-site'),
      rules: [
        managed('AWSManagedRulesAmazonIpReputationList', 0),
        managed('AWSManagedRulesCommonRuleSet', 1),
        managed('AWSManagedRulesKnownBadInputsRuleSet', 2),
        rateLimit('DownloadLinks', 3, DOWNLOAD_LIMIT_PER_5_MIN, '/d/'),
        rateLimit('AllRequests', 4, SITE_LIMIT_PER_5_MIN),
      ],
    });

    this.signInAcl = new wafv2.CfnWebACL(this, 'SignInAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('adstudio-sign-in'),
      rules: [
        managed('AWSManagedRulesAmazonIpReputationList', 0),
        rateLimit('SignInAttempts', 1, SIGN_IN_LIMIT_PER_5_MIN),
      ],
    });
    new wafv2.CfnWebACLAssociation(this, 'SignInAssociation', {
      resourceArn: props.userPool.userPoolArn,
      webAclArn: this.signInAcl.attrArn,
    });
  }
}
