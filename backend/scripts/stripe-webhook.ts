import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import Stripe from 'stripe';
import { loadOutputs } from './outputs.js';

const outputs = loadOutputs();
const { getSecret, STRIPE_SECRET_KEY_PARAMETER, STRIPE_WEBHOOK_SECRET_PARAMETER } = await import(
  '../src/core/ssm.js'
);
const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'charge.refunded',
];

const key = await getSecret(STRIPE_SECRET_KEY_PARAMETER);
if (!key) {
  console.error('store the Stripe secret key first: npm run stripe:keys');
  process.exit(1);
}
const stripe = new Stripe(key);
const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter(
  (endpoint) => endpoint.url === outputs.StripeWebhookUrl,
);
for (const endpoint of existing) {
  await stripe.webhookEndpoints.del(endpoint.id);
  console.log(`replaced old endpoint ${endpoint.id}`);
}
const endpoint = await stripe.webhookEndpoints.create({
  url: outputs.StripeWebhookUrl,
  enabled_events: EVENTS,
  description: 'AdStudio exports',
});
await new SSMClient({ region: outputs.Region }).send(
  new PutParameterCommand({
    Name: STRIPE_WEBHOOK_SECRET_PARAMETER,
    Value: endpoint.secret!,
    Type: 'SecureString',
    Overwrite: true,
  }),
);
console.log(
  `webhook ${endpoint.id} -> ${endpoint.url} (${key.startsWith('sk_live') ? 'LIVE' : 'test'} mode)`,
);
console.log(`stored the signing secret in ${STRIPE_WEBHOOK_SECRET_PARAMETER}`);
