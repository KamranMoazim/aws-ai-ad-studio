import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { putJson } from '../core/storage.js';
import { updateScan } from '../data/scans.js';
import { withManagedBrowser } from '../scan/agentcore.js';
import { browseSite } from '../scan/browse.js';

const s3Client = new S3Client({});

export interface ScanInput {
  clientId: string;
  scanId: string;
  url: string;
  prefix: string;
}

export async function handler(event: ScanInput): Promise<ScanInput> {
  await updateScan(event.clientId, event.scanId, { status: 'browsing' });
  const capture = await withManagedBrowser(`scan-${event.scanId}`, (browser) =>
    browseSite(browser, event.url, async (index, body) => {
      const key = `${event.prefix}/screenshot-${index}.jpg`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.ASSETS_BUCKET!,
          Key: key,
          Body: body,
          ContentType: 'image/jpeg',
        }),
      );
      return key;
    }),
  );
  if (!capture.pages.length) {
    throw new Error('the site could not be loaded');
  }
  await putJson(`${event.prefix}/capture.json`, capture);
  await updateScan(event.clientId, event.scanId, {
    status: 'processing',
    pages: capture.pages.map((page) => ({ url: page.url, title: page.title })),
  });
  return event;
}
