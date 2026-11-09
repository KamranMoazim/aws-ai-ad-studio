import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type Stripe from 'stripe';
import { META_SK, stripeEventPk } from '../core/keys.js';
import type { TaskType } from '../core/schemas.js';
import type { PaymentMetadata } from '../core/stripe.js';
import { documentClient, TABLE_NAME, ttlAfterDays } from '../core/table.js';
import { recordAudit } from '../data/audit.js';
import { getExport, updateExport } from '../data/exports.js';
import { createTransaction, markRefunded } from '../data/transactions.js';
import { startRender } from '../export/start.js';

const EVENT_DAYS = 30;
const WEBHOOK_ACTOR = 'stripe-webhook';

export interface WebhookDeps {
  receiptUrl: (paymentIntentId: string) => Promise<string | undefined>;
}

const metadataOf = (value: Stripe.Metadata | null | undefined): PaymentMetadata | undefined =>
  value?.exportId && value.projectId && value.clientId && value.exportCreatedAt
    ? (value as PaymentMetadata)
    : undefined;

async function seen(eventId: string): Promise<boolean> {
  const response = await documentClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: stripeEventPk(eventId), SK: META_SK } }),
  );
  return Boolean(response.Item);
}

async function remember(event: Stripe.Event): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: stripeEventPk(event.id),
        SK: META_SK,
        type: event.type,
        receivedAt: new Date().toISOString(),
        expiresAt: ttlAfterDays(EVENT_DAYS),
      },
    }),
  );
}

async function paid(session: Stripe.Checkout.Session, deps: WebhookDeps): Promise<string> {
  const metadata = metadataOf(session.metadata);
  if (!metadata || session.payment_status !== 'paid') {
    return 'ignored: not paid or no export';
  }
  const record = await getExport(metadata.projectId, metadata.exportId);
  if (!record) {
    return 'ignored: export not found';
  }
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  await createTransaction({
    txnId: metadata.exportId,
    clientId: metadata.clientId,
    projectId: metadata.projectId,
    exportId: metadata.exportId,
    taskType: metadata.taskType as TaskType,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
    status: 'paid',
    stripeSessionId: session.id,
    stripePaymentIntentId: paymentIntentId,
    receiptUrl: paymentIntentId ? await deps.receiptUrl(paymentIntentId) : undefined,
    createdAt: metadata.exportCreatedAt,
  });
  if (record.status === 'awaiting_payment') {
    await updateExport(record, { status: 'rendering', checkoutUrl: undefined }, 'awaiting_payment');
    await startRender(record);
  }
  await recordAudit(WEBHOOK_ACTOR, 'payment:paid', `PROJ#${metadata.projectId}`, {
    exportId: metadata.exportId,
    amount: session.amount_total,
  });
  return 'paid';
}

async function refunded(charge: Stripe.Charge): Promise<string> {
  const metadata = metadataOf(charge.metadata);
  if (!metadata) {
    return 'ignored: no export';
  }
  await markRefunded({
    clientId: metadata.clientId,
    createdAt: metadata.exportCreatedAt,
    txnId: metadata.exportId,
  }).catch((error) => {
    if ((error as Error).name !== 'ConditionalCheckFailedException') {
      throw error;
    }
  });
  const record = await getExport(metadata.projectId, metadata.exportId);
  if (record) {
    await updateExport(record, { revoked: true });
  }
  await recordAudit(WEBHOOK_ACTOR, 'payment:refunded', `PROJ#${metadata.projectId}`, {
    exportId: metadata.exportId,
  });
  return 'refunded';
}

export async function processEvent(event: Stripe.Event, deps: WebhookDeps): Promise<string> {
  if (await seen(event.id)) {
    return 'duplicate';
  }
  let outcome = 'ignored';
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    outcome = await paid(event.data.object, deps);
  } else if (event.type === 'charge.refunded') {
    outcome = await refunded(event.data.object);
  }
  await remember(event);
  return outcome;
}
