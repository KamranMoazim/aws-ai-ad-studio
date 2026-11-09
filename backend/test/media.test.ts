import sharp from 'sharp';
import { DISPLAY_MAX_BYTES } from '../../shared/src/index.js';
import { compressForChannel, TooLarge } from '../src/media/compress.js';
import { ImageRejected, processImage } from '../src/media/images.js';
import { check, finish } from './helpers.js';

function noise(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < pixels.length; index++) {
    pixels[index] = Math.floor(Math.random() * 256);
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

const flat = await sharp({
  create: { width: 300, height: 250, channels: 3, background: { r: 31, g: 58, b: 95 } },
})
  .png()
  .toBuffer();
const flatResult = await compressForChannel(flat, 'display');
check(
  'flat display ad keeps quality 90',
  flatResult.format === 'jpg' && flatResult.quality === 90,
  flatResult.quality,
);

const busy = await noise(300, 600);
try {
  const busyResult = await compressForChannel(busy, 'display');
  check('busy display ad is squeezed under 150 KB', busyResult.body.length <= DISPLAY_MAX_BYTES, {
    bytes: busyResult.body.length,
    quality: busyResult.quality,
    format: busyResult.format,
  });
} catch (error) {
  check(
    'busy display ad is squeezed under 150 KB',
    error instanceof TooLarge,
    (error as Error).message,
  );
}

let refused: unknown;
try {
  await compressForChannel(await noise(1080, 1920), 'display');
} catch (error) {
  refused = error;
}
check(
  'an impossible display file is refused with a reason',
  refused instanceof TooLarge,
  String(refused),
);

const meta = await compressForChannel(await noise(1080, 1080), 'meta');
check('meta sizes are JPEG at quality 90', meta.format === 'jpg' && meta.quality === 90);

const withExif = await sharp({
  create: { width: 5000, height: 3000, channels: 3, background: { r: 200, g: 100, b: 50 } },
})
  .jpeg()
  .withExif({ IFD0: { Copyright: 'secret camera owner' } })
  .toBuffer();
check('test input carries EXIF', Boolean((await sharp(withExif).metadata()).exif));
const photo = await processImage(withExif, 'photo');
const photoMeta = await sharp(photo.body).metadata();
check('photos are re-encoded without EXIF', !photoMeta.exif && photo.contentType === 'image/jpeg');
check('photos are capped at 4000 px', photo.width === 4000 && photo.height === 2400, [
  photo.width,
  photo.height,
]);

const transparentLogo = await sharp({
  create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .png()
  .toBuffer();
const logo = await processImage(transparentLogo, 'logo');
check(
  'logos stay PNG with transparency',
  logo.contentType === 'image/png' && (await sharp(logo.body).metadata()).hasAlpha === true,
);

const rejects = async (input: Buffer) => {
  try {
    await processImage(input, 'photo');
    return false;
  } catch (error) {
    return error instanceof ImageRejected;
  }
};
check(
  'non-images are rejected',
  await rejects(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
);
const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } })
  .gif()
  .toBuffer();
check('GIFs are rejected', await rejects(gif));
check('text files are rejected', await rejects(Buffer.from('hello')));
finish();
