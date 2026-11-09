import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const LOGO_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;
export const MAX_LOGO_BYTES = 1024 * 1024;
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
