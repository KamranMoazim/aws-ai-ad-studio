import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getJson, putJson } from '../core/storage.js';
import { updateScan } from '../data/scans.js';
import type { ScanAssets } from '../media/scan-assets.js';
import {
  chooseLogo,
  extractContent,
  labelPhotos,
  type LogoChoice,
  type PhotoLabels,
} from '../scan/claude.js';
import { verifyContent, type VerifiedContent } from '../scan/offers.js';
import type { Palette } from '../scan/palette.js';
import { draftPhotoIndexes } from '../scan/photos.js';
import type { SiteCapture } from '../scan/types.js';
import type { ScanInput } from './browse.js';

const s3Client = new S3Client({});
const PHOTOS_PER_CALL = 20;

export interface ScanResult {
  url: string;
  pages: Array<{ url: string; title: string }>;
  logo: { choice: LogoChoice; candidates: ScanAssets['logos'] };
  palette: Palette;
  fonts: Record<string, string>;
  photos: Array<
    ScanAssets['photos'][number] & { label?: string; quality?: number; description?: string }
  >;
  content: VerifiedContent;
  draft: {
    name: string;
    colors: Palette;
    logoIndex: number | null;
    photoIndexes: number[];
    services: Array<{ name: string; description: string }>;
    offers: Array<{ text: string; quote: string; sourceUrl: string }>;
    ctas: string[];
  };
  skipped: string[];
}

async function bytes(key: string): Promise<Buffer> {
  const object = await s3Client.send(
    new GetObjectCommand({ Bucket: process.env.ASSETS_BUCKET!, Key: key }),
  );
  return Buffer.from(await object.Body!.transformToByteArray());
}

export async function handler(
  event: ScanInput & { assetsKey: string },
): Promise<{ resultKey: string }> {
  await updateScan(event.clientId, event.scanId, { status: 'analyzing' });
  const [capture, assets] = await Promise.all([
    getJson<SiteCapture>(`${event.prefix}/capture.json`),
    getJson<ScanAssets>(event.assetsKey),
  ]);
  const home = capture.pages[0];
  const logoChoice: LogoChoice = assets.logos.length
    ? await chooseLogo(
        { url: capture.startUrl, title: home.title },
        await Promise.all(
          assets.logos.map(async (logo) => ({
            index: logo.index,
            preview: await bytes(logo.previewKey),
            description: [
              logo.source.kind,
              logo.source.alt ? `alt "${logo.source.alt}"` : '',
              logo.source.hint ? `context "${logo.source.hint.slice(0, 120)}"` : '',
              logo.source.inHeader ? 'in the page header' : '',
              logo.source.linksHome ? 'links to the home page' : '',
              `found on ${logo.source.pages} page(s)`,
            ]
              .filter(Boolean)
              .join(', '),
          })),
        ),
      )
    : { logoIndex: null, background: 'light', reason: 'no logo candidates were found' };
  const validLogo =
    logoChoice.logoIndex !== null &&
    assets.logos.some((logo) => logo.index === logoChoice.logoIndex)
      ? logoChoice.logoIndex
      : null;

  const labels: PhotoLabels['photos'] = [];
  for (let start = 0; start < assets.photos.length; start += PHOTOS_PER_CALL) {
    const batch = assets.photos.slice(start, start + PHOTOS_PER_CALL);
    const result = await labelPhotos(
      await Promise.all(
        batch.map(async (photo) => ({
          index: photo.index,
          thumb: await bytes(photo.thumbKey),
          alt: photo.alt,
        })),
      ),
    );
    labels.push(...result.photos);
  }
  const photos = assets.photos.map((photo) => {
    const label = labels.find((item) => item.index === photo.index);
    return {
      ...photo,
      label: label?.label,
      quality: label ? Math.min(5, Math.max(1, label.quality)) : undefined,
      description: label?.description,
    };
  });

  const pages = capture.pages.map((page) => ({
    url: page.url,
    title: page.title,
    text: page.text,
  }));
  const content = verifyContent(
    await extractContent(pages),
    pages,
    capture.pages.flatMap((page) => page.ctas),
  );
  const result: ScanResult = {
    url: capture.startUrl,
    pages: capture.pages.map((page) => ({ url: page.url, title: page.title })),
    logo: { choice: { ...logoChoice, logoIndex: validLogo }, candidates: assets.logos },
    palette: assets.palette,
    fonts: assets.fonts,
    photos,
    content,
    draft: {
      name: content.businessName || home.title,
      colors: assets.palette,
      logoIndex: validLogo,
      photoIndexes: draftPhotoIndexes(photos),
      services: content.services.slice(0, 12),
      offers: content.offers,
      ctas: content.ctas.slice(0, 10),
    },
    skipped: assets.skipped,
  };
  const resultKey = `${event.prefix}/result.json`;
  await putJson(resultKey, result);
  await updateScan(event.clientId, event.scanId, { status: 'ready', resultKey });
  return { resultKey };
}
