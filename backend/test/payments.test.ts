import Stripe from 'stripe';
import { transactionsCsv } from '../src/api/routes/payments.js';
import { priceInputSchema, type Transaction } from '../src/core/schemas.js';
import { hashToken, TOKEN_PATTERN } from '../src/data/download-tokens.js';
import { check, finish } from './helpers.js';

const stripe = new Stripe('sk_test_offline');
const secret = 'whsec_test_offline';
const payload = JSON.stringify({
  id: 'evt_1',
  object: 'event',
  type: 'charge.refunded',
  data: { object: {} },
});
const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
const verified = stripe.webhooks.constructEvent(payload, header, secret);
check('a correctly signed webhook verifies', verified.id === 'evt_1');
let tampered = false;
try {
  stripe.webhooks.constructEvent(payload.replace('evt_1', 'evt_2'), header, secret);
} catch {
  tampered = true;
}
check('a tampered webhook body is rejected', tampered);
let wrongSecret = false;
try {
  stripe.webhooks.constructEvent(payload, header, 'whsec_other');
} catch {
  wrongSecret = true;
}
check('a webhook signed with another secret is rejected', wrongSecret);
const old = stripe.webhooks.generateTestHeaderString({
  payload,
  secret,
  timestamp: Math.floor(Date.now() / 1000) - 3600,
});
let replay = false;
try {
  stripe.webhooks.constructEvent(payload, old, secret);
} catch {
  replay = true;
}
check('an hour-old signature is rejected as a replay', replay);

const row: Transaction & { clientName: string } = {
  txnId: 'e1',
  clientId: 'c1',
  clientName: '=HYPERLINK("http://evil")',
  projectId: 'p1',
  exportId: 'e1',
  taskType: 'template-set',
  amountCents: 2900,
  currency: 'usd',
  status: 'paid',
  createdAt: '2026-11-09T10:00:00.000Z',
};
const csv = transactionsCsv([row]);
const line = csv.split('\n')[1];
check('csv amounts are in currency units', line.includes(',29.00,USD,'), line);
check(
  'csv neutralises spreadsheet formulas',
  line.includes(`"'=HYPERLINK(""http://evil"")"`),
  line,
);
check('csv uses task labels', line.includes('Template ad set (all sizes)'));

check(
  'prices below the Stripe minimum are refused',
  !priceInputSchema.safeParse({ amountCents: 10, currency: 'usd' }).success,
);
check(
  'unknown currencies are refused',
  !priceInputSchema.safeParse({ amountCents: 900, currency: 'btc' }).success,
);
check(
  'fractional cents are refused',
  !priceInputSchema.safeParse({ amountCents: 9.5, currency: 'usd' }).success,
);

const token = 'a'.repeat(43);
check(
  'download tokens are 43 url-safe characters',
  TOKEN_PATTERN.test(token) && !TOKEN_PATTERN.test('../etc'),
);
check(
  'tokens are stored as sha-256 hashes',
  hashToken(token).length === 64 && hashToken(token) !== token,
);
finish();
