import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { stripe, webhookSecret } from '../core/stripe.js';
import { processEvent } from './process.js';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const signature = event.headers['stripe-signature'];
  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');
  if (!signature) {
    return { statusCode: 400, body: 'missing signature' };
  }
  const client = await stripe();
  let parsed;
  try {
    parsed = client.webhooks.constructEvent(body, signature, await webhookSecret());
  } catch {
    return { statusCode: 400, body: 'bad signature' };
  }
  const outcome = await processEvent(parsed, {
    receiptUrl: async (paymentIntentId) => {
      try {
        const intent = await client.paymentIntents.retrieve(paymentIntentId, {
          expand: ['latest_charge'],
        });
        const charge = intent.latest_charge;
        return typeof charge === 'object' && charge ? (charge.receipt_url ?? undefined) : undefined;
      } catch {
        return undefined;
      }
    },
  });
  console.log(`stripe ${parsed.type} ${parsed.id}: ${outcome}`);
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}
