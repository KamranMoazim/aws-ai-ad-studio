import { Hono } from 'hono';
import { allowedMany } from '../../authz/authorize.js';
import { clientResource } from '../../authz/entities.js';
import type { Action } from '../../authz/schema.js';
import { HttpError } from '../../core/http-error.js';
import {
  clientInputSchema,
  clientUpdateSchema,
  staffAssignmentSchema,
  type Client,
} from '../../core/schemas.js';
import { recordAudit } from '../../data/audit.js';
import {
  clientStaffIds,
  createClient,
  getClient,
  listAllClients,
  saveClient,
  setClientStaff,
} from '../../data/clients.js';
import { clientMemberIds, forgetPrincipal, getUsers, listUsers } from '../../data/users.js';
import type { AppEnv } from '../auth.js';
import { canOrg, permitOrg, permittedClient } from '../permit.js';

export const clientRoutes = new Hono<AppEnv>();

const CLIENT_ACTIONS: Action[] = [
  'client:update',
  'client:archive',
  'client:assign-staff',
  'payment:toggle',
  'user:invite',
  'txn:read',
];

clientRoutes.get('/', async (context) => {
  const principal = context.get('principal');
  let candidates: Client[];
  if (principal.type === 'client') {
    const own = principal.clientId ? await getClient(principal.clientId) : undefined;
    candidates = own ? [own] : [];
  } else {
    candidates = await listAllClients();
  }
  const decisions = await allowedMany(
    principal,
    candidates.map((client) => ({
      action: 'client:read',
      resource: clientResource(client.clientId),
    })),
  );
  return context.json({ clients: candidates.filter((_, index) => decisions[index]) });
});

clientRoutes.post('/', async (context) => {
  await permitOrg(context, 'client:create');
  const input = clientInputSchema.parse(await context.req.json());
  if (input.paymentRequired && !(await canOrg(context, 'pricing:manage'))) {
    throw new HttpError(403, 'forbidden', 'paymentRequired: only pricing managers can set this');
  }
  const client = await createClient(input);
  await recordAudit(context.get('principal').userId, 'client:create', `CLIENT#${client.clientId}`);
  return context.json(client, 201);
});

clientRoutes.get('/:id', async (context) => {
  const client = await permittedClient(context, 'client:read');
  const decisions = await allowedMany(
    context.get('principal'),
    CLIENT_ACTIONS.map((action) => ({ action, resource: clientResource(client.clientId) })),
  );
  const can = CLIENT_ACTIONS.filter((_, index) => decisions[index]);
  const [staff, members] = await Promise.all([
    can.includes('client:assign-staff')
      ? clientStaffIds(client.clientId).then(getUsers)
      : undefined,
    can.includes('user:invite') ? clientMemberIds(client.clientId).then(getUsers) : undefined,
  ]);
  return context.json({ client, can, staff, members });
});

clientRoutes.put('/:id', async (context) => {
  let client = await permittedClient(context, 'client:update');
  const patch = clientUpdateSchema.parse(await context.req.json());
  if (patch.paymentRequired !== undefined && patch.paymentRequired !== client.paymentRequired) {
    client = await permittedClient(context, 'payment:toggle');
  }
  if (patch.status && patch.status !== client.status) {
    client = await permittedClient(context, 'client:archive');
  }
  const updated: Client = { ...client, ...patch };
  await saveClient(updated);
  await recordAudit(
    context.get('principal').userId,
    'client:update',
    `CLIENT#${client.clientId}`,
    patch,
  );
  return context.json(updated);
});

clientRoutes.get('/:id/staff-options', async (context) => {
  await permittedClient(context, 'client:assign-staff');
  const users = await listUsers();
  return context.json({
    users: users.filter((user) => user.type === 'staff' && user.status === 'active'),
  });
});

clientRoutes.put('/:id/staff', async (context) => {
  const client = await permittedClient(context, 'client:assign-staff');
  const { userIds } = staffAssignmentSchema.parse(await context.req.json());
  const users = await getUsers([...new Set(userIds)]);
  const invalid = userIds.filter(
    (userId) =>
      !users.some(
        (user) => user.userId === userId && user.type === 'staff' && user.status === 'active',
      ),
  );
  if (invalid.length) {
    throw new HttpError(400, 'bad_request', `userIds: not active staff: ${invalid.join(', ')}`);
  }
  const previous = await clientStaffIds(client.clientId);
  await setClientStaff(client.clientId, userIds);
  for (const userId of new Set([...previous, ...userIds])) {
    forgetPrincipal(userId);
  }
  await recordAudit(
    context.get('principal').userId,
    'client:assign-staff',
    `CLIENT#${client.clientId}`,
    {
      userIds,
    },
  );
  return context.json({ staff: users });
});
