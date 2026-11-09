import { Hono } from 'hono';
import { HttpError } from '../../core/http-error.js';
import { isId, newId } from '../../core/ids.js';
import { brandKitInputSchema, type BrandKit, type BrandKitInput } from '../../core/schemas.js';
import { recordAudit } from '../../data/audit.js';
import { listAssets } from '../../data/assets.js';
import { getBrandKit, listBrandKits, saveBrandKit } from '../../data/brand-kits.js';
import type { AppEnv } from '../auth.js';
import { permittedClient } from '../permit.js';

export const brandKitRoutes = new Hono<AppEnv>();

async function checkAssets(clientId: string, input: BrandKitInput): Promise<void> {
  const ready = new Map(
    (await listAssets(clientId))
      .filter((asset) => asset.status === 'ready')
      .map((asset) => [asset.assetId, asset]),
  );
  const ids = [input.logoLightId, input.logoDarkId, ...input.photoIds].filter(Boolean) as string[];
  const missing = ids.filter((assetId) => !ready.has(assetId));
  if (missing.length) {
    throw new HttpError(400, 'bad_request', `Unknown assets: ${missing.join(', ')}`);
  }
}

brandKitRoutes.get('/:id/brand-kits', async (context) => {
  const client = await permittedClient(context, 'client:read');
  return context.json({ brandKits: await listBrandKits(client.clientId) });
});

brandKitRoutes.post('/:id/brand-kits', async (context) => {
  const client = await permittedClient(context, 'brandkit:edit');
  const input = brandKitInputSchema.parse(await context.req.json());
  await checkAssets(client.clientId, input);
  const kit: BrandKit = {
    ...input,
    kitId: newId(),
    clientId: client.clientId,
    updatedAt: new Date().toISOString(),
    updatedBy: context.get('principal').userId,
  };
  await saveBrandKit(kit);
  await recordAudit(
    context.get('principal').userId,
    'brandkit:create',
    `CLIENT#${client.clientId}`,
    {
      kitId: kit.kitId,
    },
  );
  return context.json(kit, 201);
});

brandKitRoutes.put('/:id/brand-kits/:kitId', async (context) => {
  const client = await permittedClient(context, 'brandkit:edit');
  const kitId = context.req.param('kitId');
  const existing = isId(kitId) ? await getBrandKit(client.clientId, kitId) : undefined;
  if (!existing) {
    throw new HttpError(404, 'not_found', 'Brand kit not found');
  }
  const input = brandKitInputSchema.parse(await context.req.json());
  await checkAssets(client.clientId, input);
  const kit: BrandKit = {
    ...input,
    kitId,
    clientId: client.clientId,
    updatedAt: new Date().toISOString(),
    updatedBy: context.get('principal').userId,
  };
  await saveBrandKit(kit);
  await recordAudit(
    context.get('principal').userId,
    'brandkit:update',
    `CLIENT#${client.clientId}`,
    { kitId },
  );
  return context.json(kit);
});
