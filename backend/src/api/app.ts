import { Hono } from 'hono';
import { ZodError } from 'zod';
import { HttpError } from '../core/http-error.js';
import { requireUser, type AppEnv } from './auth.js';
import { brandingRoutes } from './routes/branding.js';
import { clientRoutes } from './routes/clients.js';
import { meRoutes } from './routes/me.js';
import { roleRoutes } from './routes/roles.js';
import { settingsRoutes } from './routes/settings.js';
import { templateRoutes } from './routes/templates.js';
import { userRoutes } from './routes/users.js';

export const app = new Hono<AppEnv>();

app.get('/health', (context) => context.json({ ok: true }));
app.route('/branding', brandingRoutes);
for (const path of ['/me', '/settings', '/users', '/roles', '/clients', '/templates']) {
  app.use(path, requireUser);
  app.use(`${path}/*`, requireUser);
}
app.route('/me', meRoutes);
app.route('/settings', settingsRoutes);
app.route('/users', userRoutes);
app.route('/roles', roleRoutes);
app.route('/clients', clientRoutes);
app.route('/templates', templateRoutes);

app.notFound((context) => context.json({ error: 'not_found', message: 'Not found' }, 404));
app.onError((error, context) => {
  if (error instanceof HttpError) {
    return context.json(
      { error: error.code, message: error.message, details: error.details },
      error.status as 400,
    );
  }
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return context.json(
      { error: 'bad_request', message: `${issue.path.join('.') || 'body'}: ${issue.message}` },
      400,
    );
  }
  if (error instanceof SyntaxError) {
    return context.json({ error: 'bad_request', message: 'Body must be JSON' }, 400);
  }
  console.error(`${context.req.method} ${context.req.path} failed: ${error.name} ${error.message}`);
  return context.json({ error: 'internal', message: 'internal error' }, 500);
});
