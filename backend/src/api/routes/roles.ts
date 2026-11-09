import { Hono } from 'hono';
import { HttpError } from '../../core/http-error.js';
import { isId } from '../../core/ids.js';
import { roleInputSchema } from '../../core/schemas.js';
import { recordAudit } from '../../data/audit.js';
import { deleteRole, getRole, listRoles, saveRole } from '../../data/roles.js';
import { listUsers } from '../../data/users.js';
import type { AppEnv } from '../auth.js';
import { permitOrg } from '../permit.js';

export const roleRoutes = new Hono<AppEnv>();

const LOCKED_ROLES = ['super-admin'];

roleRoutes.get('/', async (context) => {
  const roles = await listRoles();
  return context.json({
    roles: roles.map(({ policyIds, ...role }) => role),
  });
});

roleRoutes.put('/:id', async (context) => {
  await permitOrg(context, 'role:manage');
  const roleId = context.req.param('id');
  if (!isId(roleId) || LOCKED_ROLES.includes(roleId)) {
    throw new HttpError(400, 'bad_request', 'This role id cannot be changed');
  }
  const input = roleInputSchema.parse(await context.req.json());
  const existing = await getRole(roleId);
  if (existing && existing.type !== input.type) {
    throw new HttpError(400, 'bad_request', 'type: a role cannot switch between staff and client');
  }
  const { policyIds, ...role } = await saveRole(roleId, input);
  await recordAudit(context.get('principal').userId, 'role:save', `ROLE#${roleId}`, {
    grants: input.grants,
  });
  return context.json(role);
});

roleRoutes.delete('/:id', async (context) => {
  await permitOrg(context, 'role:manage');
  const roleId = context.req.param('id');
  const role = isId(roleId) ? await getRole(roleId) : undefined;
  if (!role) {
    throw new HttpError(404, 'not_found', 'Role not found');
  }
  if (role.builtIn) {
    throw new HttpError(400, 'bad_request', 'Starting roles can be edited but not deleted');
  }
  const holders = (await listUsers()).filter((user) => user.roleIds.includes(roleId));
  if (holders.length) {
    throw new HttpError(409, 'conflict', `${holders.length} user(s) still have this role`);
  }
  await deleteRole(role);
  await recordAudit(context.get('principal').userId, 'role:delete', `ROLE#${roleId}`);
  return context.json({ ok: true });
});
