import { Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export const STRIPE_SECRET_KEY_PARAMETER = '/adstudio/stripe-secret-key';
export const STRIPE_WEBHOOK_SECRET_PARAMETER = '/adstudio/stripe-webhook-secret';
export const ANTHROPIC_KEY_PARAMETER = '/adstudio/anthropic-api-key';

export function parameterArn(scope: Construct, name: string): string {
  const stack = Stack.of(scope);
  return `arn:${stack.partition}:ssm:${stack.region}:${stack.account}:parameter${name}`;
}

export function grantReadParameters(
  scope: Construct,
  grantee: iam.IGrantable,
  names: string[],
): void {
  grantee.grantPrincipal.addToPrincipalPolicy(
    new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: names.map((name) => parameterArn(scope, name)),
    }),
  );
}
