import { DetectFacesCommand, RekognitionClient } from '@aws-sdk/client-rekognition';
import sharp, { type Metadata } from 'sharp';

export const MAX_INPUT_PIXELS = 100_000_000;
const MAX_DIMENSION = 12_000;
const PHOTO_LONG_SIDE = 4000;
const LOGO_LONG_SIDE = 2000;
const FACE_LONG_SIDE = 1600;
const ACCEPTED_FORMATS = ['jpeg', 'png', 'webp'];

export interface ProcessedImage {
  body: Buffer;
  contentType: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
  width: number;
  height: number;
}

export class ImageRejected extends Error {}

export async function processImage(input: Buffer, kind: 'logo' | 'photo'): Promise<ProcessedImage> {
  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ImageRejected('The file is not a readable image');
  }
  if (!metadata.format || !ACCEPTED_FORMATS.includes(metadata.format)) {
    throw new ImageRejected('Only PNG, JPEG and WebP images are accepted');
  }
  if (
    !metadata.width ||
    !metadata.height ||
    Math.max(metadata.width, metadata.height) > MAX_DIMENSION
  ) {
    throw new ImageRejected(`Images must be at most ${MAX_DIMENSION} pixels on each side`);
  }
  const longSide = kind === 'photo' ? PHOTO_LONG_SIDE : LOGO_LONG_SIDE;
  const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: longSide, height: longSide, fit: 'inside', withoutEnlargement: true });
  const output =
    kind === 'photo'
      ? await pipeline
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 90, mozjpeg: true })
          .toBuffer({ resolveWithObject: true })
      : await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
  return {
    body: output.data,
    contentType: kind === 'photo' ? 'image/jpeg' : 'image/png',
    extension: kind === 'photo' ? 'jpg' : 'png',
    width: output.info.width,
    height: output.info.height,
  };
}

const rekognition = new RekognitionClient({});

export interface FocalPoint {
  focalX: number;
  focalY: number;
  facesFound: number;
}

export async function detectFocalPoint(image: Buffer): Promise<FocalPoint> {
  const small = await sharp(image)
    .resize({
      width: FACE_LONG_SIDE,
      height: FACE_LONG_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  const response = await rekognition.send(new DetectFacesCommand({ Image: { Bytes: small } }));
  const faces = (response.FaceDetails ?? [])
    .map((face) => face.BoundingBox)
    .filter((box): box is Required<NonNullable<typeof box>> =>
      Boolean(box?.Width && box.Height && box.Left !== undefined && box.Top !== undefined),
    );
  if (!faces.length) {
    return { focalX: 0.5, focalY: 0.5, facesFound: 0 };
  }
  let weight = 0;
  let x = 0;
  let y = 0;
  for (const box of faces) {
    const area = box.Width * box.Height;
    weight += area;
    x += (box.Left + box.Width / 2) * area;
    y += (box.Top + box.Height / 2) * area;
  }
  const clamp = (value: number) => Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
  return { focalX: clamp(x / weight), focalY: clamp(y / weight), facesFound: faces.length };
}
