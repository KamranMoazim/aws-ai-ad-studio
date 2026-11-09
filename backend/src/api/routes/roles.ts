import { Hono } from 'hono';
import { HttpError } from '../../core/http-error.js';
import { isId } from '../../core/ids.js';
import { roleInputSchema } from '../../core/schemas.js';
import { recordAudit } from '../../data/audit.js';
import { getRole, listRoles, saveRole } from '../../data/roles.js';
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
