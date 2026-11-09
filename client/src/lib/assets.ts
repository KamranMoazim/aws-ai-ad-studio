import { api } from './api';
import type { Asset } from './types';

export async function uploadAsset(
  clientId: string,
  file: File,
  kind: Asset['kind'],
): Promise<Asset> {
  const { assetId, url } = await api<{ assetId: string; url: string }>(
    `/clients/${clientId}/assets/upload-url`,
    {
      method: 'POST',
      body: { contentType: file.type, size: file.size, kind, name: file.name.slice(0, 120) },
    },
  );
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!response.ok) {
    throw new Error('Upload failed');
  }
  return api<Asset>(`/clients/${clientId}/assets/${assetId}/complete`, { method: 'POST' });
}
