import Stripe from 'stripe';
import { SEED_TEMPLATES } from '../../shared/src/index.js';
import { check, finish } from './helpers.js';
import { testLogo } from './images.js';
import { call, createTestUser, deleteCognitoUsers, outputs, run, token } from './live.js';

const { deletePartitions, deletePrefix } = await import('./cleanup.js');
const { getSecret, STRIPE_SECRET_KEY_PARAMETER, STRIPE_WEBHOOK_SECRET_PARAMETER } = await import(
  '../src/core/ssm.js'
);
const { createDownloadToken } = await import('../src/data/download-tokens.js');
const EXPORT_WAIT_MS = 240_000;

const admin = await createTestUser('pay-admin', ['super-admin']);
const users = [admin];
const partitions = [`USER#${admin.userId}`];
const prefixes: string[] = [];

async function setUpClient(
  adminToken: string,
  label: string,
  templateId: string,
  paymentRequired: boolean,
) {
  const client = (
    await call(adminToken, 'POST', '/clients', { name: `Pay ${label} ${run}`, paymentRequired })
  ).body;
  partitions.push(`CLIENT#${client.clientId}`);
  prefixes.push(`assets/${client.clientId}/`, `exports/${client.clientId}/`);
  const owner = await createTestUser(`pay-${label}`, ['client-owner'], client.clientId);
  users.push(owner);
  partitions.push(`USER#${owner.userId}`);
  const ownerToken = await token(owner.email);
  const logo = await testLogo();
  const start = await call(ownerToken, 'POST', `/clients/${client.clientId}/assets/upload-url`, {
    contentType: 'image/png',
    size: logo.length,
    kind: 'logo',
    name: 'logo',
  });
  await fetch(start.body.url, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: new Uint8Array(logo),
  });
  const asset = (
    await call(
      ownerToken,
      'POST',
      `/clients/${client.clientId}/assets/${start.body.assetId}/complete`,
    )
  ).body;
  const project = (
    await call(ownerToken, 'POST', `/clients/${client.clientId}/projects`, {
      name: `Ads ${label}`,
      templateId,
    })
  ).body;
  partitions.push(`PROJ#${project.projectId}`);
  const values = {
    ...project.values,
    texts: { headline: 'Spotless homes, happy weekends', offer: 'Free quote', cta: 'Book now' },
    textOverrides: { '320x50': { headline: 'Spotless homes' } },
    images: { logo: { src: asset.key, focalX: 0.5, focalY: 0.5 } },
  };
  await call(ownerToken, 'PUT', `/projects/${project.projectId}`, { revision: 1, values });
  return { client, ownerToken, projectId: project.projectId as string };
}

async function waitFor(ownerToken: string, projectId: string, exportId: string, status: string) {
  const deadline = Date.now() + EXPORT_WAIT_MS;
  let response = await call(ownerToken, 'GET', `/projects/${projectId}/exports/${exportId}`);
  while (
    response.body.export?.status !== status &&
    response.body.export?.status !== 'failed' &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    response = await call(ownerToken, 'GET', `/projects/${projectId}/exports/${exportId}`);
  }
  return response;
}

async function postEvent(secret: string, event: Record<string, unknown>, signature?: string) {
  const payload = JSON.stringify(event);
  const header = signature ?? Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const response = await fetch(outputs.StripeWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: payload,
  });
  return response.status;
}

try {
  const adminToken = await token(admin.email);
  const created = await call(adminToken, 'POST', '/templates', {
    name: `Pay ${run}`,
    channel: 'both',
  });
  const templateId = created.body.meta.templateId as string;
  partitions.push(`TPL#${templateId}`);
  prefixes.push(`templates/${templateId}/`);
  await call(adminToken, 'PUT', `/templates/${templateId}`, {
    revision: 1,
    template: { ...SEED_TEMPLATES[0], name: `Pay ${run}` },
  });
  await call(adminToken, 'POST', `/templates/${templateId}/publish`, {
    revision: 2,
    report: { issues: [] },
  });

  const exempt = await setUpClient(adminToken, 'exempt', templateId, false);
  const started = await call(exempt.ownerToken, 'POST', `/projects/${exempt.projectId}/export`);
  check(
    'exempt client exports without checkout',
    started.status === 202 && !started.body.checkoutUrl,
    started.body,
  );
  const ready = await waitFor(exempt.ownerToken, exempt.projectId, started.body.exportId, 'ready');
  check('exempt export becomes ready', ready.body.export?.status === 'ready', ready.body.export);
  const exemptTxns = await call(
    exempt.ownerToken,
    'GET',
    `/clients/${exempt.client.clientId}/transactions`,
  );
  check(
    'an exempt $0 transaction is recorded',
    exemptTxns.body.transactions?.[0]?.status === 'exempt' &&
      exemptTxns.body.transactions[0].amountCents === 0,
    exemptTxns.body,
  );

  const paying = await setUpClient(adminToken, 'paying', templateId, true);
  const project = await call(paying.ownerToken, 'GET', `/projects/${paying.projectId}`);
  check(
    'unpaid project previews are watermarked',
    project.body.payment?.required === true && project.body.payment?.paid === false,
    project.body.payment,
  );
  const key = await getSecret(STRIPE_SECRET_KEY_PARAMETER);
  const webhookSecret = await getSecret(STRIPE_WEBHOOK_SECRET_PARAMETER);
  if (!key || !webhookSecret) {
    const unavailable = await call(
      paying.ownerToken,
      'POST',
      `/projects/${paying.projectId}/export`,
    );
    check(
      'without Stripe keys a paying export is refused clearly',
      unavailable.status === 400 || unavailable.status === 503,
      unavailable.body,
    );
    console.log('SKIP paid flow: run npm run stripe:keys and npm run stripe:webhook first');
  } else {
    await call(adminToken, 'PUT', `/clients/${paying.client.clientId}/prices/template-set`, {
      amountCents: 1500,
      currency: 'usd',
    });
    const checkout = await call(paying.ownerToken, 'POST', `/projects/${paying.projectId}/export`);
    check(
      'paying client gets a Stripe Checkout URL',
      checkout.status === 202 &&
        String(checkout.body.checkoutUrl).startsWith('https://checkout.stripe.com/'),
      checkout.body,
    );
    const exportId = checkout.body.exportId as string;
    const pending = await call(
      paying.ownerToken,
      'GET',
      `/projects/${paying.projectId}/exports/${exportId}`,
    );
    check(
      'export waits for payment with the server-side amount',
      pending.body.export?.status === 'awaiting_payment' &&
        pending.body.export.amountCents === 1500 &&
        !pending.body.downloadUrl,
      pending.body,
    );
    const metadata = {
      exportId,
      projectId: paying.projectId,
      clientId: paying.client.clientId,
      exportCreatedAt: pending.body.export.createdAt,
      taskType: 'template-set',
    };
    const completed = {
      id: `evt_test_paid_${run}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_${run}`,
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 1500,
          currency: 'usd',
          payment_intent: `pi_test_${run}`,
          metadata,
        },
      },
    };
    check(
      'a bad signature is rejected',
      (await postEvent(webhookSecret, completed, 't=1,v1=bad')) === 400,
    );
    check('the paid event is accepted', (await postEvent(webhookSecret, completed)) === 200);
    check('a duplicate delivery is accepted', (await postEvent(webhookSecret, completed)) === 200);
    const paid = await waitFor(paying.ownerToken, paying.projectId, exportId, 'ready');
    check(
      'paid export renders and is downloadable',
      paid.body.export?.status === 'ready' && Boolean(paid.body.downloadUrl),
      paid.body.export,
    );
    const txns = await call(
      paying.ownerToken,
      'GET',
      `/clients/${paying.client.clientId}/transactions`,
    );
    check(
      'exactly one paid transaction is recorded',
      txns.body.transactions?.length === 1 &&
        txns.body.transactions[0].status === 'paid' &&
        txns.body.transactions[0].amountCents === 1500,
      txns.body,
    );

    const link = await createDownloadToken({
      exportId,
      projectId: paying.projectId,
      clientId: paying.client.clientId,
      createdBy: 'test',
    });
    const before = await fetch(`${outputs.SiteUrl}/d/${link}`, { redirect: 'manual' });
    check(
      'the emailed link redirects to the file',
      before.status === 302 && Boolean(before.headers.get('location')?.includes('X-Amz-Signature')),
    );
    const bogus = await fetch(`${outputs.SiteUrl}/d/${'x'.repeat(43)}`, { redirect: 'manual' });
    check('an unknown link is refused', bogus.status === 404);

    const refunded = {
      id: `evt_test_refund_${run}`,
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_test_${run}`,
          object: 'charge',
          amount: 1500,
          amount_refunded: 1500,
          metadata,
        },
      },
    };
    check('the refund event is accepted', (await postEvent(webhookSecret, refunded)) === 200);
    const after = await fetch(`${outputs.SiteUrl}/d/${link}`, { redirect: 'manual' });
    check('a refund revokes the emailed link', after.status === 404);
    const revoked = await call(
      paying.ownerToken,
      'GET',
      `/projects/${paying.projectId}/exports/${exportId}`,
    );
    check(
      'a refund removes the in-app download',
      revoked.body.export?.revoked === true && !revoked.body.downloadUrl,
      revoked.body,
    );
    const refundedTxns = await call(
      paying.ownerToken,
      'GET',
      `/clients/${paying.client.clientId}/transactions`,
    );
    check(
      'the transaction is marked refunded',
      refundedTxns.body.transactions?.[0]?.status === 'refunded',
    );
    const csv = await call(adminToken, 'GET', `/transactions?clientId=${paying.client.clientId}`);
    check('admins see the transaction in the report', csv.body.transactions?.length === 1);
  }
  const clientUser = await createTestUser('pay-user', ['client-user'], exempt.client.clientId);
  users.push(clientUser);
  partitions.push(`USER#${clientUser.userId}`);
  check(
    'client users cannot see payments',
    (
      await call(
        await token(clientUser.email),
        'GET',
        `/clients/${exempt.client.clientId}/transactions`,
      )
    ).status === 403,
  );
  check(
    'client owners cannot set prices',
    (await call(exempt.ownerToken, 'GET', '/prices')).status === 403,
  );
} finally {
  await deleteCognitoUsers(users.map((user) => user.email));
  await deletePartitions(partitions);
  for (const prefix of prefixes) {
    await deletePrefix(prefix);
  }
}
finish();
