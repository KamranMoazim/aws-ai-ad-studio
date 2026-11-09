import { Hono } from 'hono';
import { allowedMany } from '../../authz/authorize.js';
import { ORG } from '../../authz/entities.js';
import { ACTION_RESOURCES, ACTIONS } from '../../authz/schema.js';
import { getUser } from '../../data/users.js';
import type { AppEnv } from '../auth.js';

export const meRoutes = new Hono<AppEnv>();

const ORG_ACTIONS = ACTIONS.filter((action) =>
  (ACTION_RESOURCES[action] as readonly string[]).includes('Org'),
);

meRoutes.get('/', async (context) => {
  const principal = context.get('principal');
  const [user, decisions] = await Promise.all([
    getUser(principal.userId),
    allowedMany(
      principal,
      ORG_ACTIONS.map((action) => ({ action, resource: ORG })),
    ),
  ]);
  return context.json({
    user,
    can: ORG_ACTIONS.filter((_, index) => decisions[index]),
  });
});
