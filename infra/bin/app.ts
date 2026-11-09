import { App, Tags } from 'aws-cdk-lib';
import { fileURLToPath } from 'node:url';
import { AdStudioStack } from '../lib/adstudio-stack.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Every setting has a default, so .env is optional.
}

const app = new App();
Tags.of(app).add('project', 'adstudio');
new AdStudioStack(app, 'AdStudioStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  appName: process.env.APP_NAME || 'AdStudio',
  clientDistPath: fileURLToPath(new URL('../../client/dist', import.meta.url)),
});
