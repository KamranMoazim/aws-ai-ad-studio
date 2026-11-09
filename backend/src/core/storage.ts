import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;
export const MAX_LOGO_BYTES = 1024 * 1024;
export const MAX_SAMPLE_IMAGE_BYTES = 5 * 1024 * 1024;
const UPLOAD_URL_SECONDS = 300;

const s3Client = new S3Client({});
const bucket = () => process.env.ASSETS_BUCKET!;

export const assetUrl = (key: string) => `${process.env.SITE_URL ?? ''}/${key}`;

export function uploadUrl(key: string, contentType: string, size: number): Promise<string> {
  return getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    }),
    { expiresIn: UPLOAD_URL_SECONDS },
  );
}

export async function objectSize(key: string): Promise<number | undefined> {
  try {
    const response = await s3Client.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return response.ContentLength;
  } catch (error) {
    if ((error as Error).name === 'NotFound') {
      return undefined;
    }
    throw error;
  }
}

export async function putJson(key: string, value: unknown): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: JSON.stringify(value),
      ContentType: 'application/json',
    }),
  );
}

export async function getJson<T>(key: string): Promise<T> {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return JSON.parse(await response.Body!.transformToString()) as T;
}
