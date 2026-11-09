import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  DISPLAY_MAX_BYTES,
  SEED_TEMPLATES,
  SIZES,
  sizesForChannel,
  DEFAULT_SAFE_ZONE,
  type Content,
} from '../../shared/src/index.js';
import { check, finish } from './helpers.js';

process.env.CHROME_PATH ??= '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
process.env.RENDER_ROOT ??= fileURLToPath(new URL('../../client/dist', import.meta.url));
const { closeBrowser, renderPng, stopServer } = await import('../src/media/render.js');
const { compressForChannel } = await import('../src/media/compress.js');

const PHOTO = 'assets/test/0000000000000001.jpg';
const LOGO = 'assets/test/0000000000000002.png';

async function testImages(): Promise<Record<string, string>> {
  const width = 1600;
  const height = 1000;
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < pixels.length; index += 3) {
    const x = (index / 3) % width;
    const noise = Math.floor(Math.random() * 90);
    pixels[index] = Math.min(255, (x / width) * 200 + noise);
    pixels[index + 1] = Math.min(255, 120 + noise);
    pixels[index + 2] = Math.min(255, 220 - (x / width) * 150 + noise);
  }
  const photo = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
  const logo = await sharp({
    create: {
      width: 400,
      height: 120,
      channels: 4,
      background: { r: 242, g: 165, b: 65, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return {
    [PHOTO]: `data:image/jpeg;base64,${photo.toString('base64')}`,
    [LOGO]: `data:image/png;base64,${logo.toString('base64')}`,
  };
}

const images = await testImages();
const content = (texts: Record<string, string>): Content => ({
  texts,
  images: {
    photo: { src: PHOTO, focalX: 0.3, focalY: 0.5 },
    logo: { src: LOGO, focalX: 0.5, focalY: 0.5 },
  },
  colors: SEED_TEMPLATES[0].sample.colors,
});
const ready = content({
  headline: 'Fresh spring cleaning for every room',
  subhead: 'Trusted local team',
  offer: 'Free quote',
  cta: 'Book now',
});

try {
  for (const template of SEED_TEMPLATES) {
    for (const size of sizesForChannel(template.channel)) {
      const snapshot = {
        template,
        content: { ...ready, textOverrides: { '320x50': { headline: 'Spring cleaning' } } },
        safeZone: DEFAULT_SAFE_ZONE,
      };
      const { png, issues } = await renderPng(snapshot as never, size, images);
      const meta = await sharp(png).metadata();
      const errors = issues.filter((issue) => issue.severity === 'error');
      const compressed = await compressForChannel(png, SIZES[size].channel);
      check(
        `${template.name} ${size} renders at exact size, fits and compresses`,
        meta.width === SIZES[size].width &&
          meta.height === SIZES[size].height &&
          errors.length === 0 &&
          (SIZES[size].channel === 'meta' || compressed.body.length <= DISPLAY_MAX_BYTES),
        { width: meta.width, height: meta.height, errors, bytes: compressed.body.length },
      );
    }
  }
  const placeholder = await renderPng(
    {
      template: SEED_TEMPLATES[0],
      content: content({ headline: '[confirm]', cta: 'Go' }),
      safeZone: DEFAULT_SAFE_ZONE,
    } as never,
    '300x250',
    images,
  );
  check(
    'render page reports a placeholder as an error',
    placeholder.issues.some((issue) => issue.code === 'placeholder'),
    placeholder.issues,
  );
  const overflow = await renderPng(
    {
      template: SEED_TEMPLATES[0],
      content: content({ headline: 'Supercalifragilistic '.repeat(6), cta: 'Go' }),
      safeZone: DEFAULT_SAFE_ZONE,
    } as never,
    '320x50',
    images,
  );
  check(
    'render page reports overflow for long copy',
    overflow.issues.some((issue) => issue.code === 'overflow' || issue.code === 'max-chars'),
    overflow.issues,
  );
} finally {
  await closeBrowser();
  await stopServer();
}
finish();
