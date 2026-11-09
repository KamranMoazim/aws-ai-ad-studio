import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import puppeteer, { type Browser } from 'puppeteer-core';
import { SIZES, type LintIssue, type SizeKey } from '../../../shared/src/index.js';
import { getJson } from '../core/storage.js';
import { fileBase, type ExportSnapshot } from '../export/snapshot.js';
import type { ExportFile } from '../core/schemas.js';
import { compressForChannel, TooLarge } from './compress.js';
import { startStaticServer } from './render-server.js';

const s3Client = new S3Client({});
const bucket = () => process.env.ASSETS_BUCKET!;
const RENDER_ROOT = process.env.RENDER_ROOT ?? '/var/task/render';
const RENDER_TIMEOUT_MS = 30_000;

export interface RenderEvent {
  snapshotKey: string;
  size: SizeKey;
  mode?: 'export' | 'preview';
}

export class RenderCheckFailed extends Error {
  override name = 'RenderCheckFailed';
}

let browserPromise: Promise<Browser> | undefined;
let serverPromise: ReturnType<typeof startStaticServer> | undefined;

async function launch(): Promise<Browser> {
  if (process.env.CHROME_PATH) {
    return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  }
  const { default: chromium } = await import('@sparticuz/chromium');
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: 'shell',
  });
}

export async function closeBrowser(): Promise<void> {
  const current = browserPromise;
  browserPromise = undefined;
  await (await current)?.close();
}

function browser(): Promise<Browser> {
  browserPromise ??= launch();
  browserPromise.catch(() => (browserPromise = undefined));
  return browserPromise;
}

async function origin(): Promise<string> {
  serverPromise ??= startStaticServer(process.env.RENDER_ROOT ?? RENDER_ROOT);
  return (await serverPromise).origin;
}

export async function stopServer(): Promise<void> {
  const current = serverPromise;
  serverPromise = undefined;
  (await current)?.server.close();
}

async function imageData(
  snapshot: Pick<ExportSnapshot, 'content'>,
): Promise<Record<string, string>> {
  const sources = [...new Set(Object.values(snapshot.content.images).map((image) => image.src))];
  const entries = await Promise.all(
    sources.map(async (src) => {
      const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket(), Key: src }));
      const bytes = Buffer.from(await object.Body!.transformToByteArray());
      return [src, `data:${object.ContentType ?? 'image/png'};base64,${bytes.toString('base64')}`];
    }),
  );
  return Object.fromEntries(entries);
}

export async function renderPng(
  snapshot: Pick<ExportSnapshot, 'template' | 'content' | 'safeZone'>,
  size: SizeKey,
  suppliedImages?: Record<string, string>,
) {
  const [instance, base, images] = await Promise.all([
    browser(),
    origin(),
    suppliedImages ?? imageData(snapshot),
  ]);
  const page = await instance.newPage();
  try {
    const { width, height } = SIZES[size];
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`${base}/render.html`, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });
    await page.waitForFunction('typeof window.renderAd === "function"', {
      timeout: RENDER_TIMEOUT_MS,
    });
    const result = (await page.evaluate(
      (payload) =>
        (window as unknown as { renderAd: (input: unknown) => Promise<unknown> }).renderAd(payload),
      {
        template: snapshot.template,
        content: snapshot.content,
        size,
        images,
        safeZone: snapshot.safeZone,
      },
    )) as { dataUrl: string; issues: LintIssue[] };
    return {
      png: Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), 'base64'),
      issues: result.issues,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function handler(event: RenderEvent): Promise<ExportFile | { key: string }> {
  const snapshot = await getJson<ExportSnapshot>(event.snapshotKey);
  const prefix = event.snapshotKey.slice(0, event.snapshotKey.lastIndexOf('/'));
  const { png, issues } = await renderPng(snapshot, event.size);
  if (event.mode === 'preview') {
    const key = `${prefix}/preview-${event.size}.png`;
    await s3Client.send(
      new PutObjectCommand({ Bucket: bucket(), Key: key, Body: png, ContentType: 'image/png' }),
    );
    return { key };
  }
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    throw new RenderCheckFailed(
      `${event.size}: ${errors.map((issue) => issue.message).join('; ')}`,
    );
  }
  let compressed;
  try {
    compressed = await compressForChannel(png, SIZES[event.size].channel);
  } catch (error) {
    if (error instanceof TooLarge) {
      throw new RenderCheckFailed(`${event.size}: ${error.message}`);
    }
    throw error;
  }
  const name = `${fileBase(snapshot.projectName)}-${event.size}.${compressed.format}`;
  const key = `${prefix}/files/${name}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: compressed.body,
      ContentType: compressed.format === 'jpg' ? 'image/jpeg' : 'image/png',
    }),
  );
  return {
    size: event.size,
    name,
    key,
    bytes: compressed.body.length,
    format: compressed.format,
    quality: compressed.quality,
  };
}
