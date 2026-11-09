import { check, finish } from './helpers.js';
import { call, createTestUser, deleteCognitoUsers, run, testEmail, token } from './live.js';

const { deletePartitions } = await import('./cleanup.js');
const ASSIGNMENT_WAIT_MS = 70_000;

const clientIds = (response: { body: any }) =>
  (response.body.clients ?? []).map((client: { clientId: string }) => client.clientId).sort();

const { userId: adminId, email: adminEmail } = await createTestUser('admin', ['super-admin']);

const userIds: string[] = [adminId];
const emails: string[] = [adminEmail];
const createdClients: string[] = [];
try {
  check('branding is public', (await call(undefined, 'GET', '/branding')).status === 200);
  check('clients need a token', (await call(undefined, 'GET', '/clients')).status === 401);

  const admin = await token(adminEmail);
  const me = await call(admin, 'GET', '/me');
  check('super admin can manage users', me.body.can?.includes('user:manage'), me);

  const clientA = await call(admin, 'POST', '/clients', { name: `Test A ${run}` });
  const clientB = await call(admin, 'POST', '/clients', { name: `Test B ${run}` });
  check('admin creates clients', clientA.status === 201 && clientB.status === 201, [
    clientA,
    clientB,
  ]);
  const idA = clientA.body.clientId as string;
  const idB = clientB.body.clientId as string;
  createdClients.push(idA, idB);

  const staffEmail = testEmail('staff');
  const staffInvite = await call(admin, 'POST', '/users', {
    email: staffEmail,
    name: `Test Staff ${run}`,
    type: 'staff',
    roleIds: ['account-manager'],
  });
  check('admin invites a staff user', staffInvite.status === 201, staffInvite);
  const clientEmail = testEmail('client');
  const clientInvite = await call(admin, 'POST', '/users', {
    email: clientEmail,
    name: `Test Client ${run}`,
    type: 'client',
    roleIds: ['client-user'],
    clientId: idA,
  });
  check('admin invites a client user', clientInvite.status === 201, clientInvite);
  userIds.push(staffInvite.body.userId, clientInvite.body.userId);
  emails.push(staffEmail, clientEmail);

  const badRole = await call(admin, 'POST', '/users', {
    email: testEmail('bad'),
    name: 'Bad',
    type: 'client',
    roleIds: ['admin'],
    clientId: idA,
  });
  check('staff role refused for a client user', badRole.status === 400, badRole);

  const staff = await token(staffEmail);
  const client = await token(clientEmail);

  check(
    'unassigned staff sees no test clients',
    !clientIds(await call(staff, 'GET', '/clients')).some(
      (clientId: string) => clientId === idA || clientId === idB,
    ),
  );
  const assign = await call(admin, 'PUT', `/clients/${idA}/staff`, {
    userIds: [staffInvite.body.userId],
  });
  check('admin assigns staff to client A', assign.status === 200, assign);

  let staffClients: string[] = [];
  const deadline = Date.now() + ASSIGNMENT_WAIT_MS;
  do {
    staffClients = clientIds(await call(staff, 'GET', '/clients'));
    if (staffClients.includes(idA)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (Date.now() < deadline);
  check('staff sees assigned client A', staffClients.includes(idA), staffClients);
  check('staff does not see client B', !staffClients.includes(idB), staffClients);
  check('staff opens client A', (await call(staff, 'GET', `/clients/${idA}`)).status === 200);
  check('staff gets 404 on client B', (await call(staff, 'GET', `/clients/${idB}`)).status === 404);
  check('staff cannot list users', (await call(staff, 'GET', '/users')).status === 403);
  check(
    'staff cannot assign staff',
    (await call(staff, 'PUT', `/clients/${idA}/staff`, { userIds: [] })).status === 403,
  );

  check(
    'client user sees only own client',
    JSON.stringify(clientIds(await call(client, 'GET', '/clients'))) === JSON.stringify([idA]),
  );
  check(
    'client user gets 404 on client B',
    (await call(client, 'GET', `/clients/${idB}`)).status === 404,
  );
  check('client user cannot list users', (await call(client, 'GET', '/users')).status === 403);
  check(
    'client user cannot edit client',
    (await call(client, 'PUT', `/clients/${idA}`, { name: 'x' })).status === 403,
  );
  check(
    'client user cannot read settings',
    (await call(client, 'GET', '/settings')).status === 403,
  );

  const disable = await call(admin, 'PUT', `/users/${clientInvite.body.userId}`, {
    status: 'disabled',
  });
  check('admin disables the client user', disable.body.status === 'disabled', disable);
} finally {
  await deleteCognitoUsers(emails);
  await deletePartitions([
    ...userIds.filter(Boolean).map((userId) => `USER#${userId}`),
    ...createdClients.map((clientId) => `CLIENT#${clientId}`),
  ]);
}
finish();
