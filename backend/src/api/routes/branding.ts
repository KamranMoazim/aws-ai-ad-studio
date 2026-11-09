import { Hono } from 'hono';
import { assetUrl } from '../../core/storage.js';
import { getSettings } from '../../data/settings.js';
import type { AppEnv } from '../auth.js';

export const brandingRoutes = new Hono<AppEnv>();

brandingRoutes.get('/', async (context) => {
  const settings = await getSettings();
  context.header('cache-control', 'public, max-age=60');
  return context.json({
    appName: settings.appName,
    colors: settings.colors,
    logoUrl: settings.logoKey ? assetUrl(settings.logoKey) : undefined,
  });
});
