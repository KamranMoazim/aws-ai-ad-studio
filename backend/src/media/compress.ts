import sharp from 'sharp';
import { DISPLAY_MAX_BYTES, type Channel } from '../../../shared/src/index.js';

export const DISPLAY_QUALITY = { highest: 90, lowest: 60 };
export const META_QUALITY = 90;

export interface Compressed {
  body: Buffer;
  format: 'jpg' | 'png';
  quality?: number;
}

export class TooLarge extends Error {}

const jpeg = (png: Buffer, quality: number) =>
  sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();

export async function compressForChannel(png: Buffer, channel: Channel): Promise<Compressed> {
  if (channel === 'meta') {
    return { body: await jpeg(png, META_QUALITY), format: 'jpg', quality: META_QUALITY };
  }
  let low = DISPLAY_QUALITY.lowest;
  let high = DISPLAY_QUALITY.highest;
  let best: Compressed | undefined;
  while (low <= high) {
    const quality = Math.floor((low + high) / 2);
    const body = await jpeg(png, quality);
    if (body.length <= DISPLAY_MAX_BYTES) {
      best = { body, format: 'jpg', quality };
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }
  if (best) {
    return best;
  }
  const palette = await sharp(png)
    .png({ palette: true, quality: 80, compressionLevel: 9 })
    .toBuffer();
  if (palette.length <= DISPLAY_MAX_BYTES) {
    return { body: palette, format: 'png' };
  }
  throw new TooLarge(
    `still ${Math.round(Math.min(palette.length, (await jpeg(png, DISPLAY_QUALITY.lowest)).length) / 1024)} KB at the lowest quality; simplify the photo or use a flatter template`,
  );
}
