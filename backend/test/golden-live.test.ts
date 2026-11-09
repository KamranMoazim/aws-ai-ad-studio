import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import {
  DEFAULT_SAFE_ZONE,
  SEED_TEMPLATES,
  sizesForChannel,
  type Content,
} from '../../shared/src/index.js';
import { check, finish } from './helpers.js';
import { testLogo, testPhoto } from './images.js';
import { outputs, run } from './live.js';

process.env.CHROME_PATH ??= '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
process.env.RENDER_ROOT ??= fileURLToPath(new URL('../../client/dist', import.meta.url));
const { closeBrowser, renderPng, stopServer } = await import('../src/media/render.js');
const { deletePrefix } = await import('./cleanup.js');

const MAX_DIFF_RATIO = 0.005;
const PIXEL_THRESHOLD = 0.1;
const DIFF_DIR = fileURLToPath(new URL('../../.playwright-mcp/golden-diffs/', import.meta.url));
const s3Client = new S3Client({ region: outputs.Region });
const lambdaClient = new LambdaClient({ region: outputs.Region });
const bucket = outputs.AssetsBucketName;
const assetPrefix = `assets/golden-${run}`;
const exportPrefix = `exports/golden-${run}`;
const PHOTO = `${assetPrefix}/0000000000000001.jpg`;
const LOGO = `${assetPrefix}/0000000000000002.png`;

const photo = await sharp(await testPhoto())
  .jpeg({ quality: 90 })
  .toBuffer();
const logo = await testLogo();
await s3Client.send(
  new PutObjectCommand({ Bucket: bucket, Key: PHOTO, Body: photo, ContentType: 'image/jpeg' }),
);
await s3Client.send(
  new PutObjectCommand({ Bucket: bucket, Key: LOGO, Body: logo, ContentType: 'image/png' }),
);
const images = {
  [PHOTO]: `data:image/jpeg;base64,${photo.toString('base64')}`,
  [LOGO]: `data:image/png;base64,${logo.toString('base64')}`,
};

const CONTENT_SETS: Array<[string, Record<string, string>]> = [
  [
    'short',
    { headline: 'Spring cleaning', subhead: 'Local team', offer: 'Free quote', cta: 'Book now' },
  ],
  [
    'long',
    {
      headline: 'Fresh spring cleaning for every room',
      subhead: 'Trusted local team, flexible times',
      offer: 'First visit free',
      cta: 'Get a quote today',
    },
  ],
];

async function serverPng(snapshotKey: string, size: string): Promise<Buffer> {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: outputs.RenderFunctionName,
      Payload: JSON.stringify({ snapshotKey, size, mode: 'preview' }),
    }),
  );
  const payload = JSON.parse(new TextDecoder().decode(response.Payload));
  if (response.FunctionError) {
    throw new Error(JSON.stringify(payload));
  }
  const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: payload.key }));
  return Buffer.from(await object.Body!.transformToByteArray());
}

try {
  let worst = 0;
  for (const template of SEED_TEMPLATES) {
    for (const [setName, texts] of CONTENT_SETS) {
      const content: Content = {
        texts,
        textOverrides: { '320x50': { headline: 'Spring cleaning' } },
        images: {
          photo: { src: PHOTO, focalX: 0.3, focalY: 0.4 },
          logo: { src: LOGO, focalX: 0.5, focalY: 0.5 },
        },
        colors: template.sample.colors,
      };
      const snapshotKey = `${exportPrefix}/${template.id}-${setName}/snapshot.json`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: snapshotKey,
          Body: JSON.stringify({
            template: { ...template, version: 1 },
            content,
            safeZone: DEFAULT_SAFE_ZONE,
          }),
          ContentType: 'application/json',
        }),
      );
      const results = await Promise.all(
        sizesForChannel(template.channel).map(async (size) => {
          const [server, local] = await Promise.all([
            serverPng(snapshotKey, size),
            renderPng({ template, content, safeZone: DEFAULT_SAFE_ZONE }, size, images).then(
              (result) => result.png,
            ),
          ]);
          const left = PNG.sync.read(server);
          const right = PNG.sync.read(local);
          if (left.width !== right.width || left.height !== right.height) {
            return { size, ratio: 1 };
          }
          const diff = new PNG({ width: left.width, height: left.height });
          const pixels = pixelmatch(left.data, right.data, diff.data, left.width, left.height, {
            threshold: PIXEL_THRESHOLD,
          });
          const ratio = pixels / (left.width * left.height);
          if (ratio >= MAX_DIFF_RATIO) {
            mkdirSync(DIFF_DIR, { recursive: true });
            writeFileSync(`${DIFF_DIR}${template.id}-${setName}-${size}.png`, PNG.sync.write(diff));
          }
          return { size, ratio };
        }),
      );
      for (const { size, ratio } of results) {
        worst = Math.max(worst, ratio);
        check(
          `${template.name} ${setName} ${size} server matches browser (${(ratio * 100).toFixed(3)}% differ)`,
          ratio < MAX_DIFF_RATIO,
        );
      }
    }
  }
  console.log(`worst difference ${(worst * 100).toFixed(3)}%`);
} finally {
  await closeBrowser();
  await stopServer();
  await deletePrefix(`${assetPrefix}/`);
  await deletePrefix(`${exportPrefix}/`);
}
finish();
