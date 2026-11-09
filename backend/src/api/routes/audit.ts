import { Hono } from 'hono';
import { HttpError } from '../../core/http-error.js';
import { isId } from '../../core/ids.js';
import { listAudit, listUserAudit } from '../../data/audit.js';
import { listUsers } from '../../data/users.js';
import type { AppEnv } from '../auth.js';
import { permitOrg } from '../permit.js';

export const auditRoutes = new Hono<AppEnv>();
const MONTH = /^\d{4}-\d{2}$/;

auditRoutes.get('/', async (context) => {
  await permitOrg(context, 'audit:read');
  const month = context.req.query('month') ?? new Date().toISOString().slice(0, 7);
  const userId = context.req.query('userId');
  if (!MONTH.test(month) || (userId && !isId(userId))) {
    throw new HttpError(400, 'bad_request', 'month must be YYYY-MM');
  }
  const [entries, users] = await Promise.all([
    userId ? listUserAudit(userId) : listAudit(month),
    listUsers(),
  ]);
  const names = new Map(users.map((user) => [user.userId, `${user.name} <${user.email}>`]));
  return context.json({
    month,
    entries: entries.map((entry) => ({
      ...entry,
      actor: names.get(entry.actorId) ?? entry.actorId,
    })),
  });
});
