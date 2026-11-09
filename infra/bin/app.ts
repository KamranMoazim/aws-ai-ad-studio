import { App, Tags } from 'aws-cdk-lib';
import { fileURLToPath } from 'node:url';
import { AdStudioStack } from '../lib/adstudio-stack.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Every setting has a default, so .env is optional.
}

const renderConcurrency = Number(process.env.RENDER_CONCURRENCY ?? 4);
if (!Number.isInteger(renderConcurrency) || renderConcurrency < 1 || renderConcurrency > 8) {
  throw new Error('RENDER_CONCURRENCY in infra/.env must be a whole number from 1 to 8');
}
const domainParts = [
  process.env.DOMAIN_NAME,
  process.env.HOSTED_ZONE_ID,
  process.env.HOSTED_ZONE_NAME,
];
if (domainParts.some(Boolean) && !domainParts.every(Boolean)) {
  throw new Error('Set DOMAIN_NAME, HOSTED_ZONE_ID and HOSTED_ZONE_NAME together in infra/.env');
}

const app = new App();
Tags.of(app).add('project', 'adstudio');
new AdStudioStack(app, 'AdStudioStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  appName: process.env.APP_NAME || 'AdStudio',
  senderEmail: process.env.SENDER_EMAIL || undefined,
  claudeProvider:
    process.env.CLAUDE_PROVIDER === 'anthropic' || process.env.CLAUDE_PROVIDER === 'bedrock-legacy'
      ? process.env.CLAUDE_PROVIDER
      : 'bedrock',
  clientDistPath: fileURLToPath(new URL('../../client/dist', import.meta.url)),
  alertEmail: process.env.ALERT_EMAIL || undefined,
  waf: process.env.WAF !== 'false',
  renderConcurrency,
  domain: domainParts.every(Boolean)
    ? {
        domainName: process.env.DOMAIN_NAME!,
        hostedZoneId: process.env.HOSTED_ZONE_ID!,
        zoneName: process.env.HOSTED_ZONE_NAME!,
      }
    : undefined,
});
