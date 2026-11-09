import { Hono } from 'hono';
import { allowedMany } from '../../authz/authorize.js';
import { ORG } from '../../authz/entities.js';
import { ACTION_RESOURCES, ACTIONS } from '../../authz/schema.js';
import { hasTotp } from '../../core/cognito.js';
import { HttpError } from '../../core/http-error.js';
import { recordAudit } from '../../data/audit.js';
import { cachedSettingsValue, staffMfaRequired } from '../../data/settings.js';
import { forgetPrincipal, getUser, saveUser } from '../../data/users.js';
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
  const settings = await cachedSettingsValue();
  return context.json({
    user,
    can: ORG_ACTIONS.filter((_, index) => decisions[index]),
    mfa: {
      required: principal.type === 'staff' && staffMfaRequired(settings),
      enabled: user?.mfaEnabled === true,
    },
  });
});

meRoutes.post('/mfa', async (context) => {
  const principal = context.get('principal');
  const user = await getUser(principal.userId);
  if (!user || !(await hasTotp(user.email))) {
    throw new HttpError(400, 'bad_request', 'Two-step sign-in is not set up on this account yet');
  }
  await saveUser({ ...user, mfaEnabled: true });
  forgetPrincipal(user.userId);
  await recordAudit(user.userId, 'user:mfa-enabled', `USER#${user.userId}`);
  return context.json({ enabled: true });
});
