import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { zipSync } from 'fflate';
import type { ExportFile } from '../core/schemas.js';
import { getJson } from '../core/storage.js';
import { finishExport } from '../data/exports.js';
import { fileBase, type ExportInput, type ExportSnapshot } from './snapshot.js';

const s3Client = new S3Client({});
const bucket = () => process.env.ASSETS_BUCKET!;

export async function handler(event: ExportInput & { files: ExportFile[] }) {
  const snapshot = await getJson<ExportSnapshot>(event.snapshotKey);
  const entries: Record<string, Uint8Array> = {};
  for (const file of event.files) {
    const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket(), Key: file.key }));
    entries[file.name] = await object.Body!.transformToByteArray();
  }
  const manifest = {
    project: snapshot.projectName,
    projectId: snapshot.projectId,
    exportId: snapshot.exportId,
    template: {
      id: snapshot.template.id,
      name: snapshot.template.name,
      version: snapshot.template.version,
    },
    createdAt: snapshot.createdAt,
    files: event.files.map(({ size, name, bytes, format, quality }) => ({
      size,
      name,
      bytes,
      format,
      quality,
    })),
  };
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const zip = zipSync(entries, { level: 0 });
  const prefix = event.snapshotKey.slice(0, event.snapshotKey.lastIndexOf('/'));
  const zipKey = `${prefix}/${fileBase(snapshot.projectName)}-${snapshot.exportId}.zip`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: zipKey,
      Body: zip,
      ContentType: 'application/zip',
    }),
  );
  await finishExport(event, { status: 'ready', files: event.files, zipKey, zipBytes: zip.length });
  return { zipKey };
}
