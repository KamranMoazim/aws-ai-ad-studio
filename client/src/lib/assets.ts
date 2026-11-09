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

interface ImageJob {
  jobId: string;
  status: 'running' | 'ready' | 'failed';
  message?: string;
}

const JOB_POLL_MS = 3000;
const JOB_WAIT_MS = 3 * 60_000;

export async function runImageJob(clientId: string, path: string, body: unknown): Promise<Asset> {
  const job = await api<ImageJob>(`/clients/${clientId}/images/${path}`, { method: 'POST', body });
  const deadline = Date.now() + JOB_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
    const latest = await api<{ job: ImageJob; asset?: Asset }>(
      `/clients/${clientId}/images/jobs/${job.jobId}`,
    );
    if (latest.job.status === 'ready' && latest.asset) {
      return latest.asset;
    }
    if (latest.job.status === 'failed') {
      throw new Error(latest.job.message ?? 'The image could not be edited');
    }
  }
  throw new Error('The image is still being processed; check back in a minute');
}
