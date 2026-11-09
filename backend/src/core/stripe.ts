import Stripe from 'stripe';
import { HttpError } from './http-error.js';
import { getSecret, STRIPE_SECRET_KEY_PARAMETER, STRIPE_WEBHOOK_SECRET_PARAMETER } from './ssm.js';

let client: Stripe | undefined;

export async function stripe(): Promise<Stripe> {
  if (!client) {
    const key = await getSecret(STRIPE_SECRET_KEY_PARAMETER);
    if (!key) {
      throw new HttpError(
        503,
        'payments_unavailable',
        'Payments are not set up yet; ask the agency',
      );
    }
    client = new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
  }
  return client;
}

export async function webhookSecret(): Promise<string> {
  const secret = await getSecret(STRIPE_WEBHOOK_SECRET_PARAMETER);
  if (!secret) {
    throw new Error('stripe webhook secret is not set');
  }
  return secret;
}

export interface PaymentMetadata {
  exportId: string;
  projectId: string;
  clientId: string;
  exportCreatedAt: string;
  taskType: string;
  [key: string]: string;
}
