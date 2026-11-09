import { Hono, type Context } from 'hono';
import { HttpError } from '../../core/http-error.js';
import { inviteCognitoUser, setCognitoUserEnabled } from '../../core/cognito.js';
import { isId } from '../../core/ids.js';
import {
  inviteUserSchema,
  updateUserSchema,
  type User,
  type UserType,
} from '../../core/schemas.js';
import { recordAudit } from '../../data/audit.js';
import { getClient } from '../../data/clients.js';
import { listRoles } from '../../data/roles.js';
import {
  clientMemberIds,
  createUser,
  forgetPrincipal,
  getUser,
  getUsers,
  listUsers,
  saveUser,
} from '../../data/users.js';
import type { AppEnv } from '../auth.js';
import { canOrg, permitOrg, permittedClient } from '../permit.js';

export const userRoutes = new Hono<AppEnv>();

async function checkRoles(roleIds: string[], type: UserType): Promise<void> {
  const roles = new Map((await listRoles()).map((role) => [role.roleId, role]));
  for (const roleId of roleIds) {
    const role = roles.get(roleId);
    if (!role || role.type !== type) {
      throw new HttpError(400, 'bad_request', `roleIds: ${roleId} is not a ${type} role`);
    }
  }
}

async function permitUserAdmin(context: Context<AppEnv>, user: Pick<User, 'type' | 'clientId'>) {
  if (await canOrg(context, 'user:manage')) {
    return;
  }
  if (user.type === 'client' && user.clientId) {
    await permittedClient(context, 'user:invite', user.clientId);
    return;
  }
  throw new HttpError(403, 'forbidden', 'You do not have permission to do this');
}

userRoutes.get('/', async (context) => {
  const clientId = context.req.query('clientId');
  if (clientId) {
    await permittedClient(context, 'user:invite', clientId);
    return context.json({ users: await getUsers(await clientMemberIds(clientId)) });
  }
  await permitOrg(context, 'user:manage');
  return context.json({ users: await listUsers() });
});

userRoutes.post('/', async (context) => {
  const input = inviteUserSchema.parse(await context.req.json());
  await permitUserAdmin(context, input);
  if (input.clientId && !(await getClient(input.clientId))) {
    throw new HttpError(400, 'bad_request', 'clientId: client not found');
  }
  await checkRoles(input.roleIds, input.type);
  const userId = await inviteCognitoUser(input.email);
  const user: User = {
    userId,
    email: input.email,
    name: input.name,
    type: input.type,
    roleIds: input.roleIds,
    clientId: input.clientId,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  await createUser(user);
  await recordAudit(context.get('principal').userId, 'user:invite', `USER#${userId}`, {
    email: user.email,
    type: user.type,
    roleIds: user.roleIds,
    clientId: user.clientId,
  });
  return context.json(user, 201);
});

userRoutes.put('/:id', async (context) => {
  const userId = context.req.param('id');
  const user = isId(userId) ? await getUser(userId) : undefined;
  if (!user) {
    throw new HttpError(404, 'not_found', 'User not found');
  }
  await permitUserAdmin(context, user);
  const patch = updateUserSchema.parse(await context.req.json());
  if (patch.status && userId === context.get('principal').userId) {
    throw new HttpError(400, 'bad_request', 'status: you cannot disable your own account');
  }
  if (patch.roleIds) {
    await checkRoles(patch.roleIds, user.type);
  }
  if (patch.status && patch.status !== user.status) {
    await setCognitoUserEnabled(user.email, patch.status === 'active');
  }
  const updated: User = { ...user, ...patch };
  await saveUser(updated);
  forgetPrincipal(userId);
  await recordAudit(context.get('principal').userId, 'user:update', `USER#${userId}`, patch);
  return context.json(updated);
});
