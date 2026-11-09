import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { clientAssetKey, uploadKey } from '../core/keys.js';
import type { Asset } from '../core/schemas.js';
import { getAsset, saveAsset } from '../data/assets.js';
import { detectFocalPoint, ImageRejected, processImage } from './images.js';

const s3Client = new S3Client({});
const bucket = () => process.env.ASSETS_BUCKET!;

export interface ProcessUploadEvent {
  clientId: string;
  assetId: string;
}

export type ProcessUploadResult = { ok: true; asset: Asset } | { ok: false; message: string };

export async function handler(event: ProcessUploadEvent): Promise<ProcessUploadResult> {
  const asset = await getAsset(event.clientId, event.assetId);
  if (!asset || asset.status !== 'pending') {
    return { ok: false, message: 'Upload not found or already processed' };
  }
  const source = uploadKey(asset.clientId, asset.assetId);
  try {
    const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket(), Key: source }));
    const input = Buffer.from(await object.Body!.transformToByteArray());
    const image = await processImage(input, asset.kind);
    const focal =
      asset.kind === 'photo'
        ? await detectFocalPoint(image.body)
        : { focalX: 0.5, focalY: 0.5, facesFound: 0 };
    const key = clientAssetKey(asset.clientId, asset.assetId, image.extension);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: image.body,
        ContentType: image.contentType,
      }),
    );
    const ready: Asset = {
      ...asset,
      status: 'ready',
      key,
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      bytes: image.body.length,
      ...focal,
    };
    await saveAsset(ready);
    return { ok: true, asset: ready };
  } catch (error) {
    const message =
      error instanceof ImageRejected
        ? error.message
        : (error as Error).name === 'NoSuchKey'
          ? 'Upload the file first'
          : 'The image could not be processed';
    if (!(error instanceof ImageRejected) && (error as Error).name !== 'NoSuchKey') {
      console.error(
        `process ${asset.assetId} failed: ${(error as Error).name} ${(error as Error).message}`,
      );
    }
    await saveAsset({ ...asset, status: 'failed' });
    return { ok: false, message };
  } finally {
    await s3Client
      .send(new DeleteObjectCommand({ Bucket: bucket(), Key: source }))
      .catch(() => undefined);
  }
}
