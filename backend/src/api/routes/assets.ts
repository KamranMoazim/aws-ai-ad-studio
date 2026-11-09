import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { Hono } from 'hono';
import { HttpError } from '../../core/http-error.js';
import { isId, newId } from '../../core/ids.js';
import { uploadKey } from '../../core/keys.js';
import { assetUpdateSchema, uploadRequestSchema, type Asset } from '../../core/schemas.js';
import { readUrl, uploadUrl } from '../../core/storage.js';
import { recordAudit } from '../../data/audit.js';
import { getAsset, listAssets, saveAsset } from '../../data/assets.js';
import type { ProcessUploadResult } from '../../media/process-upload.js';
import type { AppEnv } from '../auth.js';
import { permittedClient } from '../permit.js';

export const assetRoutes = new Hono<AppEnv>();
const lambdaClient = new LambdaClient({});

export async function withUrl(asset: Asset) {
  return { ...asset, url: asset.key ? await readUrl(asset.key, { preview: true }) : undefined };
}

assetRoutes.get('/:id/assets', async (context) => {
  const client = await permittedClient(context, 'client:read');
  const assets = (await listAssets(client.clientId)).filter((asset) => asset.status === 'ready');
  return context.json({ assets: await Promise.all(assets.map(withUrl)) });
});

assetRoutes.post('/:id/assets/upload-url', async (context) => {
  const client = await permittedClient(context, 'brandkit:edit');
  const input = uploadRequestSchema.parse(await context.req.json());
  const asset: Asset = {
    assetId: newId(),
    clientId: client.clientId,
    kind: input.kind,
    name: input.name,
    status: 'pending',
    focalX: 0.5,
    focalY: 0.5,
    createdAt: new Date().toISOString(),
    createdBy: context.get('principal').userId,
  };
  await saveAsset(asset);
  const url = await uploadUrl(
    uploadKey(client.clientId, asset.assetId),
    input.contentType,
    input.size,
  );
  return context.json({ assetId: asset.assetId, url }, 201);
});

assetRoutes.post('/:id/assets/:assetId/complete', async (context) => {
  const client = await permittedClient(context, 'brandkit:edit');
  const assetId = context.req.param('assetId');
  const asset = isId(assetId) ? await getAsset(client.clientId, assetId) : undefined;
  if (!asset) {
    throw new HttpError(404, 'not_found', 'Asset not found');
  }
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.PROCESS_UPLOAD_FUNCTION!,
      Payload: JSON.stringify({ clientId: client.clientId, assetId }),
    }),
  );
  if (response.FunctionError) {
    throw new Error(`process upload failed: ${response.FunctionError}`);
  }
  const result = JSON.parse(new TextDecoder().decode(response.Payload)) as ProcessUploadResult;
  if (!result.ok) {
    throw new HttpError(400, 'bad_request', result.message);
  }
  await recordAudit(context.get('principal').userId, 'asset:upload', `CLIENT#${client.clientId}`, {
    assetId,
    kind: result.asset.kind,
  });
  return context.json(await withUrl(result.asset));
});

assetRoutes.put('/:id/assets/:assetId', async (context) => {
  const client = await permittedClient(context, 'brandkit:edit');
  const assetId = context.req.param('assetId');
  const asset = isId(assetId) ? await getAsset(client.clientId, assetId) : undefined;
  if (!asset || asset.status !== 'ready') {
    throw new HttpError(404, 'not_found', 'Asset not found');
  }
  const patch = assetUpdateSchema.parse(await context.req.json());
  const updated = { ...asset, ...patch };
  await saveAsset(updated);
  return context.json(await withUrl(updated));
});
