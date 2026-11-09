import { Hono } from 'hono';
import { z } from 'zod';
import { HttpError } from '../../core/http-error.js';
import { newId } from '../../core/ids.js';
import { settingsInputSchema } from '../../core/schemas.js';
import {
  assetUrl,
  IMAGE_TYPES,
  MAX_LOGO_BYTES,
  objectSize,
  uploadUrl,
} from '../../core/storage.js';
import { recordAudit } from '../../data/audit.js';
import { getSettings, putSettings } from '../../data/settings.js';
import type { AppEnv } from '../auth.js';
import { permitOrg } from '../permit.js';

export const settingsRoutes = new Hono<AppEnv>();

const logoUploadSchema = z.object({
  contentType: z.enum(Object.keys(IMAGE_TYPES) as Array<keyof typeof IMAGE_TYPES>),
  size: z.number().int().min(1).max(MAX_LOGO_BYTES),
});

settingsRoutes.get('/', async (context) => {
  await permitOrg(context, 'settings:manage');
  const settings = await getSettings();
  return context.json({
    ...settings,
    logoUrl: settings.logoKey ? assetUrl(settings.logoKey) : undefined,
  });
});

settingsRoutes.put('/', async (context) => {
  await permitOrg(context, 'settings:manage');
  const input = settingsInputSchema.parse(await context.req.json());
  if (input.logoKey) {
    const size = await objectSize(input.logoKey);
    if (!size || size > MAX_LOGO_BYTES) {
      throw new HttpError(400, 'bad_request', 'logoKey: upload the logo first (max 1 MB)');
    }
  }
  const settings = await putSettings(input);
  await recordAudit(context.get('principal').userId, 'settings:update', 'ORG');
  return context.json(settings);
});

settingsRoutes.post('/logo-upload-url', async (context) => {
  await permitOrg(context, 'settings:manage');
  const { contentType, size } = logoUploadSchema.parse(await context.req.json());
  const key = `branding/logo-${newId()}.${IMAGE_TYPES[contentType]}`;
  return context.json({ key, url: await uploadUrl(key, contentType, size) });
});
