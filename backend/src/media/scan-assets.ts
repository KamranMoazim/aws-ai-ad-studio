import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { getJson, putJson } from '../core/storage.js';
import { fetchImage, type FetchedImage } from '../scan/fetcher.js';
import { MAX_LOGO_CANDIDATES, rankLogoCandidates, type RankedLogo } from '../scan/logo.js';
import { buildPalette, kMeans, type Palette } from '../scan/palette.js';
import { sanitizeSvg } from '../scan/svg.js';
import type { PageImage, SiteCapture } from '../scan/types.js';
import { detectFocalPoint, MAX_INPUT_PIXELS } from './images.js';

const s3Client = new S3Client({});
const bucket = () => process.env.ASSETS_BUCKET!;
const MAX_PHOTOS = 40;
const MAX_FOCAL = 24;
const FETCH_CONCURRENCY = 6;
const LOGO_SIZE = 512;
const PHOTO_SIZE = 2000;
const THUMB_SIZE = 320;
const MIN_PHOTO = { width: 400, height: 300 };
const DUPLICATE_BITS = 5;

export interface ScanLogo {
  index: number;
  key: string;
  previewKey: string;
  width: number;
  height: number;
  tone: 'light' | 'dark';
  source: Pick<
    RankedLogo,
    'kind' | 'src' | 'alt' | 'hint' | 'score' | 'pages' | 'inHeader' | 'linksHome'
  >;
}

export interface ScanPhoto {
  index: number;
  key: string;
  thumbKey: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  focalX: number;
  focalY: number;
}

export interface ScanAssets {
  logos: ScanLogo[];
  photos: ScanPhoto[];
  palette: Palette;
  fonts: Record<string, string>;
  textLogo?: string;
  skipped: string[];
}

export interface ScanStepEvent {
  prefix: string;
}

const put = (key: string, body: Buffer, contentType: string) =>
  s3Client.send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );

async function inParallel<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index], index);
      }
    }),
  );
  return results;
}

async function logoBytes(candidate: RankedLogo): Promise<Buffer | undefined> {
  if (candidate.markup) {
    const clean = sanitizeSvg(candidate.markup);
    return clean ? sharp(Buffer.from(clean), { density: 288 }).png().toBuffer() : undefined;
  }
  const fetched: FetchedImage = await fetchImage(candidate.src!);
  if (fetched.format === 'ico') {
    return undefined;
  }
  if (fetched.format === 'svg') {
    const clean = sanitizeSvg(fetched.body.toString('utf8'));
    return clean ? sharp(Buffer.from(clean), { density: 288 }).png().toBuffer() : undefined;
  }
  return sharp(fetched.body, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
    .png()
    .toBuffer();
}

async function toneOf(png: Buffer): Promise<'light' | 'dark'> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .resize(64, 64, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let total = 0;
  let count = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset + 3] > 128) {
      total += 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
      count++;
    }
  }
  return count && total / count > 190 ? 'light' : 'dark';
}

async function preview(png: Buffer): Promise<Buffer> {
  const logo = await sharp(png).resize(260, 160, { fit: 'inside' }).png().toBuffer();
  const tile = (background: string) =>
    sharp({ create: { width: 300, height: 200, channels: 3, background } })
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toBuffer();
  return sharp({ create: { width: 600, height: 200, channels: 3, background: '#ffffff' } })
    .composite([
      { input: await tile('#ffffff'), left: 0, top: 0 },
      { input: await tile('#222222'), left: 300, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function processLogos(
  capture: SiteCapture,
  prefix: string,
  skipped: string[],
): Promise<ScanLogo[]> {
  const ranked = rankLogoCandidates(capture).slice(0, MAX_LOGO_CANDIDATES * 2);
  const logos: ScanLogo[] = [];
  for (const candidate of ranked) {
    if (logos.length >= MAX_LOGO_CANDIDATES) {
      break;
    }
    try {
      const raw = await logoBytes(candidate);
      if (!raw) {
        skipped.push(`logo ${candidate.src ?? candidate.kind}: unsupported`);
        continue;
      }
      const png = await sharp(raw)
        .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      const meta = await sharp(png).metadata();
      const index = logos.length;
      const key = `${prefix}/logo-${index}.png`;
      const previewKey = `${prefix}/logo-${index}-preview.png`;
      await put(key, png, 'image/png');
      await put(previewKey, await preview(png), 'image/png');
      const { kind, src, alt, hint, score, pages, inHeader, linksHome } = candidate;
      logos.push({
        index,
        key,
        previewKey,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        tone: await toneOf(png),
        source: { kind, src, alt, hint, score, pages, inHeader, linksHome },
      });
    } catch (error) {
      skipped.push(
        `logo ${candidate.src ?? candidate.kind}: ${(error as Error).message.slice(0, 120)}`,
      );
    }
  }
  return logos;
}

async function hash(image: Buffer): Promise<bigint> {
  const pixels = await sharp(image).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      bits = (bits << 1n) | (pixels[row * 9 + column] > pixels[row * 9 + column + 1] ? 1n : 0n);
    }
  }
  return bits;
}

const hamming = (left: bigint, right: bigint) => {
  let value = left ^ right;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
};

async function processPhotos(
  capture: SiteCapture,
  prefix: string,
  skipped: string[],
): Promise<ScanPhoto[]> {
  const unique = new Map<string, PageImage>();
  for (const image of capture.pages.flatMap((page) => page.images)) {
    if (!unique.has(image.src)) {
      unique.set(image.src, image);
    }
  }
  const candidates = [...unique.values()]
    .sort((left, right) => right.width * right.height - left.width * left.height)
    .slice(0, MAX_PHOTOS);
  const fetched = await inParallel(candidates, FETCH_CONCURRENCY, async (image) => {
    try {
      const result = await fetchImage(image.src);
      if (result.format === 'svg' || result.format === 'ico') {
        return undefined;
      }
      const meta = await sharp(result.body, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      if ((meta.width ?? 0) < MIN_PHOTO.width || (meta.height ?? 0) < MIN_PHOTO.height) {
        return undefined;
      }
      return { image, body: result.body, signature: await hash(result.body) };
    } catch (error) {
      skipped.push(`photo ${image.src}: ${(error as Error).message.slice(0, 120)}`);
      return undefined;
    }
  });
  const kept: typeof fetched = [];
  for (const entry of fetched) {
    if (
      entry &&
      !kept.some((other) => other && hamming(other.signature, entry.signature) <= DUPLICATE_BITS)
    ) {
      kept.push(entry);
    }
  }
  const photos: ScanPhoto[] = [];
  for (const entry of kept) {
    const index = photos.length;
    const pipeline = sharp(entry!.body, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .flatten({ background: '#ffffff' });
    const full = await pipeline
      .clone()
      .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const thumb = await pipeline
      .clone()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' })
      .jpeg({ quality: 75 })
      .toBuffer();
    const key = `${prefix}/photo-${index}.jpg`;
    const thumbKey = `${prefix}/photo-${index}-thumb.jpg`;
    await put(key, full.data, 'image/jpeg');
    await put(thumbKey, thumb, 'image/jpeg');
    const focal =
      index < MAX_FOCAL
        ? await detectFocalPoint(full.data).catch(() => ({ focalX: 0.5, focalY: 0.5 }))
        : { focalX: 0.5, focalY: 0.5 };
    photos.push({
      index,
      key,
      thumbKey,
      src: entry!.image.src,
      alt: entry!.image.alt,
      width: full.info.width,
      height: full.info.height,
      focalX: focal.focalX,
      focalY: focal.focalY,
    });
  }
  return photos;
}

async function screenshotColors(capture: SiteCapture) {
  const pixels: Array<[number, number, number]> = [];
  for (const page of capture.pages) {
    if (!page.screenshotKey) {
      continue;
    }
    const object = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket(), Key: page.screenshotKey }),
    );
    const { data } = await sharp(Buffer.from(await object.Body!.transformToByteArray()))
      .resize(48, 64, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let offset = 0; offset < data.length; offset += 3) {
      pixels.push([data[offset], data[offset + 1], data[offset + 2]]);
    }
  }
  return kMeans(pixels, 8);
}

export async function handler(event: ScanStepEvent): Promise<{ assetsKey: string }> {
  const capture = await getJson<SiteCapture>(`${event.prefix}/capture.json`);
  const skipped: string[] = [];
  const [logos, photos, imageColors] = await Promise.all([
    processLogos(capture, event.prefix, skipped),
    processPhotos(capture, event.prefix, skipped),
    screenshotColors(capture),
  ]);
  const assets: ScanAssets = {
    logos,
    photos,
    palette: buildPalette(
      capture.pages.flatMap((page) => page.colors),
      imageColors,
    ),
    fonts: capture.pages[0]?.fonts ?? {},
    textLogo: capture.pages.find((page) => page.textLogo)?.textLogo,
    skipped: skipped.slice(0, 50),
  };
  const assetsKey = `${event.prefix}/assets.json`;
  await putJson(assetsKey, assets);
  return { assetsKey };
}
