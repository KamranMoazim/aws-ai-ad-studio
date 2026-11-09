import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { newId } from '../core/ids.js';
import { clientAssetKey } from '../core/keys.js';
import type { Asset } from '../core/schemas.js';
import { getAsset, saveAsset } from '../data/assets.js';
import { getBrandKit } from '../data/brand-kits.js';
import { finishImageJob } from '../data/image-jobs.js';
import {
  extensionFor,
  ImageServiceError,
  stabilityImageService,
  type ImageService,
} from './image-service.js';
import { MAX_INPUT_PIXELS } from './images.js';

const s3Client = new S3Client({});
const bucket = () => process.env.ASSETS_BUCKET!;
const REMOVE_BG_SIDE = 2048;
const OUTPAINT_SIDE = 1536;
const SWATCH_SIZE = 512;
export const ASPECTS = { '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1, '16:9': 16 / 9 } as const;
export type Aspect = keyof typeof ASPECTS;

export type ImageEditEvent =
  | { op: 'remove-bg'; clientId: string; assetId: string; userId: string }
  | { op: 'outpaint'; clientId: string; assetId: string; aspect: Aspect; userId: string }
  | {
      op: 'background';
      clientId: string;
      brandKitId: string;
      style: string;
      aspect: Aspect;
      userId: string;
    };

export type ImageEditResult = { ok: true; asset: Asset } | { ok: false; message: string };

async function sourceBytes(asset: Asset): Promise<Buffer> {
  const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket(), Key: asset.key! }));
  return Buffer.from(await object.Body!.transformToByteArray());
}

async function store(
  event: ImageEditEvent,
  body: Buffer,
  kind: Asset['kind'],
  name: string,
  focal: { focalX: number; focalY: number },
  derivedFrom?: string,
): Promise<Asset> {
  const assetId = newId();
  const png = kind === 'logo' || event.op === 'remove-bg';
  const encoded = png
    ? await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true })
    : await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
  const key = clientAssetKey(event.clientId, assetId, png ? 'png' : 'jpg');
  const contentType = png ? 'image/png' : 'image/jpeg';
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: encoded.data,
      ContentType: contentType,
    }),
  );
  const asset: Asset = {
    assetId,
    clientId: event.clientId,
    kind,
    name: name.slice(0, 120),
    status: 'ready',
    key,
    contentType,
    width: encoded.info.width,
    height: encoded.info.height,
    bytes: encoded.data.length,
    focalX: focal.focalX,
    focalY: focal.focalY,
    source: event.op === 'background' ? 'ai-generated' : 'ai-edit',
    derivedFrom,
    createdAt: new Date().toISOString(),
    createdBy: event.userId,
  };
  await saveAsset(asset);
  return asset;
}

async function fallbackBackground(colors: string[], aspect: Aspect): Promise<Buffer> {
  const width = 1080;
  const height = Math.round(width / ASPECTS[aspect]);
  const stops = colors
    .map(
      (color, index) =>
        `<stop offset="${(index / Math.max(1, colors.length - 1)) * 100}%" stop-color="${color}"/>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

export async function editImage(
  event: ImageEditEvent,
  service: ImageService,
): Promise<ImageEditResult> {
  try {
    if (event.op === 'background') {
      const kit = await getBrandKit(event.clientId, event.brandKitId);
      if (!kit) {
        return { ok: false, message: 'Brand kit not found' };
      }
      const colors = [
        kit.colors.primary,
        kit.colors.secondary,
        kit.colors.accent,
        kit.colors.background,
      ].filter((color): color is string => Boolean(color));
      const bands = colors.map((color, index) => ({
        input: {
          create: {
            width: Math.ceil(SWATCH_SIZE / colors.length),
            height: SWATCH_SIZE,
            channels: 3 as const,
            background: color,
          },
        },
        left: Math.floor((index * SWATCH_SIZE) / colors.length),
        top: 0,
      }));
      const swatch = await sharp({
        create: { width: SWATCH_SIZE, height: SWATCH_SIZE, channels: 3, background: '#ffffff' },
      })
        .composite(bands)
        .png()
        .toBuffer();
      const prompt = `${event.style}. An abstract background texture in these brand colours, soft and uncluttered, with space for text. No people, faces, hands, products, packaging, text, letters, logos or watermarks.`;
      let image: Buffer;
      let generated = true;
      try {
        image = await service.generateBackground(swatch, prompt, event.aspect);
      } catch (error) {
        console.error(
          `background generation failed, using a gradient: ${(error as Error).message}`,
        );
        image = await fallbackBackground(
          colors.length ? colors : ['#1f3a5f', '#f2a541'],
          event.aspect,
        );
        generated = false;
      }
      return {
        ok: true,
        asset: await store(
          event,
          image,
          'photo',
          generated ? `Background: ${event.style}` : 'Background: brand gradient',
          { focalX: 0.5, focalY: 0.5 },
        ),
      };
    }
    const source = await getAsset(event.clientId, event.assetId);
    if (!source || source.status !== 'ready' || !source.key) {
      return { ok: false, message: 'Image not found' };
    }
    const original = await sourceBytes(source);
    if (event.op === 'remove-bg') {
      const input = await sharp(original)
        .resize(REMOVE_BG_SIDE, REMOVE_BG_SIDE, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      const result = await service.removeBackground(input);
      return {
        ok: true,
        asset: await store(
          event,
          result,
          source.kind,
          `${source.name} (no background)`,
          source,
          source.assetId,
        ),
      };
    }
    const input = await sharp(original)
      .resize(OUTPAINT_SIDE, OUTPAINT_SIDE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });
    const extension = extensionFor(input.info.width, input.info.height, ASPECTS[event.aspect]);
    if (!extension.left && !extension.right && !extension.up && !extension.down) {
      return { ok: false, message: `The image is already ${event.aspect}` };
    }
    const result = await service.outpaint(input.data, extension);
    const width = input.info.width + extension.left + extension.right;
    const height = input.info.height + extension.up + extension.down;
    const focal = {
      focalX: (extension.left + source.focalX * input.info.width) / width,
      focalY: (extension.up + source.focalY * input.info.height) / height,
    };
    return {
      ok: true,
      asset: await store(
        event,
        result,
        'photo',
        `${source.name} (extended to ${event.aspect})`,
        focal,
        source.assetId,
      ),
    };
  } catch (error) {
    if (error instanceof ImageServiceError) {
      return { ok: false, message: error.message };
    }
    console.error(`image ${event.op} failed: ${(error as Error).name} ${(error as Error).message}`);
    return { ok: false, message: 'The image could not be edited. Try again in a moment.' };
  }
}

export async function handler(event: ImageEditEvent & { jobId: string }): Promise<ImageEditResult> {
  const result = await editImage(event, stabilityImageService);
  await finishImageJob(
    event.clientId,
    event.jobId,
    result.ok
      ? { status: 'ready', assetId: result.asset.assetId }
      : { status: 'failed', message: result.message },
  );
  return result;
}
