import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { Hono } from 'hono';
import { z } from 'zod';
import { HttpError } from '../../core/http-error.js';
import { newId } from '../../core/ids.js';
import { clientAssetKey, scanFolder } from '../../core/keys.js';
import type { Asset, BrandKit } from '../../core/schemas.js';
import { copyObject, getJson, readUrl } from '../../core/storage.js';
import { saveAsset } from '../../data/assets.js';
import { recordAudit } from '../../data/audit.js';
import { saveBrandKit } from '../../data/brand-kits.js';
import { getSettings, limitsOf } from '../../data/settings.js';
import {
  createScan,
  getScan,
  listScans,
  OWNERSHIP_STATEMENT,
  updateScan,
  type Scan,
} from '../../data/scans.js';
import { checkPublicUrl, FetchRefused } from '../../scan/fetcher.js';
import type { ScanResult } from '../../scan-steps/analyze.js';
import type { AppEnv } from '../auth.js';
import { permittedClient } from '../permit.js';

export const scanRoutes = new Hono<AppEnv>();
const sfnClient = new SFNClient({});
const RUNNING: Scan['status'][] = ['queued', 'browsing', 'processing', 'analyzing'];
const SCAN_ID = /^\d{8}T\d{6}Z-[a-f0-9]{8}$/;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const startSchema = z.object({
  url: z.string().trim().min(4).max(2000),
  confirmOwnership: z.literal(true, { message: 'Confirm that you own or represent this website' }),
});

const saveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  logoIndex: z.number().int().min(0).nullable(),
  photoIndexes: z.array(z.number().int().min(0)).max(40),
  colors: z.object({
    primary: hex,
    secondary: hex.optional(),
    accent: hex,
    text: hex,
    background: hex,
  }),
  services: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().max(300).optional(),
      }),
    )
    .max(30),
  offerQuotes: z.array(z.string().max(500)).max(30),
  ctas: z.array(z.string().trim().min(1).max(40)).max(20),
});

const newScanId = (at = new Date()) =>
  `${at.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}-${newId().slice(0, 8)}`;

async function scanFor(clientId: string, scanId: string): Promise<Scan> {
  const scan = SCAN_ID.test(scanId) ? await getScan(clientId, scanId) : undefined;
  if (!scan) {
    throw new HttpError(404, 'not_found', 'Scan not found');
  }
  return scan;
}

scanRoutes.post('/:id/scans', async (context) => {
  const client = await permittedClient(context, 'brandkit:edit');
  const input = startSchema.parse(await context.req.json());
  let url: URL;
  try {
    url = await checkPublicUrl(
      /^https?:\/\//i.test(input.url) ? input.url : `https://${input.url}`,
    );
  } catch (error) {
    const reason = error instanceof FetchRefused ? error.reason : 'unreachable';
    throw new HttpError(
      400,
      'bad_url',
      `That address can't be scanned (${reason}). Use the public http(s) address of the website.`,
    );
  }
  const recent = await listScans(client.clientId, 50);
  const today = new Date().toISOString().slice(0, 10);
  if (recent.some((scan) => RUNNING.includes(scan.status))) {
    throw new HttpError(409, 'conflict', 'A scan for this client is already running');
  }
  const { scansPerDay } = limitsOf(await getSettings());
  if (recent.filter((scan) => scan.createdAt.startsWith(today)).length >= scansPerDay) {
    throw new HttpError(429, 'limit', `Up to ${scansPerDay} scans a day per client`);
  }
  const now = new Date();
  const scanId = newScanId(now);
  const scan: Scan = {
    scanId,
    clientId: client.clientId,
    url: url.href,
    status: 'queued',
    attestation: {
      userId: context.get('principal').userId,
      at: now.toISOString(),
      statement: OWNERSHIP_STATEMENT,
    },
    prefix: scanFolder(client.clientId, scanId),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await createScan(scan);
  await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: process.env.SCAN_STATE_MACHINE_ARN!,
      name: `scan-${scanId}`,
      input: JSON.stringify({
        clientId: scan.clientId,
        scanId,
        url: scan.url,
        prefix: scan.prefix,
      }),
    }),
  );
  await recordAudit(context.get('principal').userId, 'scan:start', `CLIENT#${client.clientId}`, {
    scanId,
    url: scan.url,
    attestation: OWNERSHIP_STATEMENT,
  });
  return context.json(scan, 202);
});

scanRoutes.get('/:id/scans', async (context) => {
  const client = await permittedClient(context, 'client:read');
  return context.json({ scans: await listScans(client.clientId) });
});

scanRoutes.get('/:id/scans/:scanId', async (context) => {
  const client = await permittedClient(context, 'client:read');
  const scan = await scanFor(client.clientId, context.req.param('scanId'));
  if (scan.status !== 'ready' || !scan.resultKey) {
    return context.json({ scan });
  }
  const result = await getJson<ScanResult>(scan.resultKey);
  const urls = async (key: string) => readUrl(key, { preview: true });
  return context.json({
    scan,
    result: {
      ...result,
      logo: {
        ...result.logo,
        candidates: await Promise.all(
          result.logo.candidates.map(async (logo) => ({
            ...logo,
            url: await urls(logo.key),
            previewUrl: await urls(logo.previewKey),
          })),
        ),
      },
      photos: await Promise.all(
        result.photos.map(async (photo) => ({ ...photo, url: await urls(photo.thumbKey) })),
      ),
    },
  });
});

scanRoutes.post('/:id/scans/:scanId/brand-kit', async (context) => {
  const client = await permittedClient(context, 'brandkit:edit');
  const scan = await scanFor(client.clientId, context.req.param('scanId'));
  if (scan.status !== 'ready' || !scan.resultKey) {
    throw new HttpError(409, 'conflict', 'The scan has not finished');
  }
  const input = saveSchema.parse(await context.req.json());
  const result = await getJson<ScanResult>(scan.resultKey);
  const userId = context.get('principal').userId;
  const now = new Date().toISOString();
  const copyAsset = async (
    from: string,
    kind: Asset['kind'],
    name: string,
    focal: { focalX: number; focalY: number },
    size: { width: number; height: number },
  ) => {
    const assetId = newId();
    const extension = kind === 'logo' ? 'png' : 'jpg';
    const key = clientAssetKey(client.clientId, assetId, extension);
    const contentType = kind === 'logo' ? 'image/png' : 'image/jpeg';
    await copyObject(from, key, contentType);
    const asset: Asset = {
      assetId,
      clientId: client.clientId,
      kind,
      name: name.slice(0, 120),
      status: 'ready',
      key,
      contentType,
      width: size.width,
      height: size.height,
      focalX: focal.focalX,
      focalY: focal.focalY,
      source: 'scan',
      createdAt: now,
      createdBy: userId,
    };
    await saveAsset(asset);
    return asset;
  };
  const logo =
    input.logoIndex === null
      ? undefined
      : result.logo.candidates.find((candidate) => candidate.index === input.logoIndex);
  if (input.logoIndex !== null && !logo) {
    throw new HttpError(400, 'bad_request', 'logoIndex: not a candidate of this scan');
  }
  const photos = input.photoIndexes.map((index) => {
    const photo = result.photos.find((candidate) => candidate.index === index);
    if (!photo) {
      throw new HttpError(400, 'bad_request', `photoIndexes: ${index} is not a photo of this scan`);
    }
    return photo;
  });
  const offers = input.offerQuotes.map((quote) => {
    const offer = result.content.offers.find((candidate) => candidate.quote === quote);
    if (!offer) {
      throw new HttpError(
        400,
        'bad_request',
        'offerQuotes: only offers found on the website can be saved',
      );
    }
    return { text: offer.text, sourceUrl: offer.sourceUrl };
  });
  const logoAsset = logo
    ? await copyAsset(logo.key, 'logo', `${input.name} logo`, { focalX: 0.5, focalY: 0.5 }, logo)
    : undefined;
  const photoAssets = [];
  for (const photo of photos) {
    photoAssets.push(
      await copyAsset(
        photo.key,
        'photo',
        photo.description || photo.alt || 'Website photo',
        photo,
        photo,
      ),
    );
  }
  const darkLogo = result.logo.choice.background === 'dark' && logo?.tone === 'light';
  const kit: BrandKit = {
    kitId: newId(),
    clientId: client.clientId,
    name: input.name,
    colors: Object.fromEntries(
      Object.entries(input.colors).filter(([, value]) => value),
    ) as BrandKit['colors'],
    logoLightId: darkLogo ? undefined : logoAsset?.assetId,
    logoDarkId: darkLogo ? logoAsset?.assetId : undefined,
    photoIds: photoAssets.map((asset) => asset.assetId),
    services: input.services,
    offers,
    ctas: input.ctas,
    updatedAt: now,
    updatedBy: userId,
  };
  await saveBrandKit(kit);
  await updateScan(client.clientId, scan.scanId, { brandKitId: kit.kitId });
  await recordAudit(userId, 'scan:brand-kit', `CLIENT#${client.clientId}`, {
    scanId: scan.scanId,
    kitId: kit.kitId,
    photos: photoAssets.length,
    offers: offers.length,
  });
  return context.json(kit, 201);
});
