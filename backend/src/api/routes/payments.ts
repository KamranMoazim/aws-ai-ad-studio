import { Hono } from 'hono';
import { HttpError } from '../../core/http-error.js';
import {
  priceInputSchema,
  TASK_TYPE_KEYS,
  TASK_TYPES,
  type Price,
  type TaskType,
  type Transaction,
} from '../../core/schemas.js';
import { recordAudit } from '../../data/audit.js';
import { listAllClients } from '../../data/clients.js';
import { deletePrice, listClientPrices, listDefaultPrices, putPrice } from '../../data/pricing.js';
import { listClientTransactions, listTransactions } from '../../data/transactions.js';
import type { AppEnv } from '../auth.js';
import { canClient, permitOrg, permittedClient } from '../permit.js';

export const priceRoutes = new Hono<AppEnv>();
export const transactionRoutes = new Hono<AppEnv>();
export const clientPaymentRoutes = new Hono<AppEnv>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 90;

function taskTypeParam(value: string | undefined): TaskType {
  if (!value || !TASK_TYPE_KEYS.includes(value as TaskType)) {
    throw new HttpError(404, 'not_found', 'Unknown task type');
  }
  return value as TaskType;
}

const csvCell = (value: unknown) => {
  const text = value === undefined || value === null ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function transactionsCsv(rows: Array<Transaction & { clientName?: string }>): string {
  const header = [
    'date',
    'client',
    'task',
    'status',
    'amount',
    'currency',
    'export',
    'receipt',
    'stripe payment',
  ];
  const lines = rows.map((row) =>
    [
      row.createdAt,
      row.clientName ?? row.clientId,
      TASK_TYPES[row.taskType] ?? row.taskType,
      row.status,
      (row.amountCents / 100).toFixed(2),
      row.currency.toUpperCase(),
      row.exportId,
      row.receiptUrl,
      row.stripePaymentIntentId,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}

priceRoutes.get('/', async (context) => {
  await permitOrg(context, 'pricing:manage');
  return context.json({ taskTypes: TASK_TYPES, prices: await listDefaultPrices() });
});

priceRoutes.put('/:taskType', async (context) => {
  await permitOrg(context, 'pricing:manage');
  const taskType = taskTypeParam(context.req.param('taskType'));
  const input = priceInputSchema.parse(await context.req.json());
  const price: Price = { taskType, ...input, updatedAt: new Date().toISOString() };
  await putPrice(price);
  await recordAudit(context.get('principal').userId, 'price:set', `PRICE#${taskType}`, input);
  return context.json(price);
});

priceRoutes.delete('/:taskType', async (context) => {
  await permitOrg(context, 'pricing:manage');
  const taskType = taskTypeParam(context.req.param('taskType'));
  await deletePrice(taskType);
  await recordAudit(context.get('principal').userId, 'price:delete', `PRICE#${taskType}`);
  return context.json({ ok: true });
});

clientPaymentRoutes.get('/:id/prices', async (context) => {
  await permitOrg(context, 'pricing:manage');
  const client = await permittedClient(context, 'client:read');
  return context.json({ prices: await listClientPrices(client.clientId) });
});

clientPaymentRoutes.put('/:id/prices/:taskType', async (context) => {
  await permitOrg(context, 'pricing:manage');
  const client = await permittedClient(context, 'client:read');
  const taskType = taskTypeParam(context.req.param('taskType'));
  const input = priceInputSchema.parse(await context.req.json());
  const price: Price = { taskType, ...input, updatedAt: new Date().toISOString() };
  await putPrice(price, client.clientId);
  await recordAudit(
    context.get('principal').userId,
    'price:override',
    `CLIENT#${client.clientId}`,
    {
      taskType,
      ...input,
    },
  );
  return context.json(price);
});

clientPaymentRoutes.delete('/:id/prices/:taskType', async (context) => {
  await permitOrg(context, 'pricing:manage');
  const client = await permittedClient(context, 'client:read');
  const taskType = taskTypeParam(context.req.param('taskType'));
  await deletePrice(taskType, client.clientId);
  await recordAudit(
    context.get('principal').userId,
    'price:override-delete',
    `CLIENT#${client.clientId}`,
    {
      taskType,
    },
  );
  return context.json({ ok: true });
});

clientPaymentRoutes.get('/:id/transactions', async (context) => {
  const client = await permittedClient(context, 'client:read');
  if (!(await canClient(context, 'txn:read', client.clientId))) {
    throw new HttpError(403, 'forbidden', 'You do not have permission to see payments');
  }
  return context.json({ transactions: await listClientTransactions(client.clientId) });
});

transactionRoutes.get('/', async (context) => {
  await permitOrg(context, 'txn:read');
  const today = new Date().toISOString().slice(0, 10);
  const from =
    context.req.query('from') ??
    new Date(Date.now() - DEFAULT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const to = context.req.query('to') ?? today;
  if (!DATE.test(from) || !DATE.test(to)) {
    throw new HttpError(400, 'bad_request', 'from and to must be YYYY-MM-DD');
  }
  const clientId = context.req.query('clientId');
  const status = context.req.query('status');
  const [all, clients] = await Promise.all([listTransactions(from, to), listAllClients()]);
  const names = new Map(clients.map((client) => [client.clientId, client.name]));
  const rows = all
    .filter((txn) => !clientId || txn.clientId === clientId)
    .filter((txn) => !status || txn.status === status)
    .map((txn) => ({ ...txn, clientName: names.get(txn.clientId) }));
  if (context.req.query('format') === 'csv') {
    context.header('content-disposition', `attachment; filename="transactions-${from}-${to}.csv"`);
    return context.body(transactionsCsv(rows), 200, { 'content-type': 'text/csv; charset=utf-8' });
  }
  return context.json({ transactions: rows, from, to });
});
