import { Hono } from 'hono';
import { readUrl } from '../../core/storage.js';
import { resolveDownloadToken } from '../../data/download-tokens.js';
import { getExport } from '../../data/exports.js';
import type { AppEnv } from '../auth.js';

export const downloadRoutes = new Hono<AppEnv>();

const GONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Link expired</title><p style="font-family:sans-serif;padding:2rem">This download link has expired or is no longer available. Sign in to download your ads again.</p>';

downloadRoutes.get('/:token', async (context) => {
  context.header('cache-control', 'no-store');
  context.header('referrer-policy', 'no-referrer');
  const token = await resolveDownloadToken(context.req.param('token'));
  const record = token ? await getExport(token.projectId, token.exportId) : undefined;
  if (!record || record.status !== 'ready' || record.revoked || !record.zipKey) {
    return context.html(GONE_PAGE, 404);
  }
  return context.redirect(
    await readUrl(record.zipKey, { downloadName: record.zipKey.split('/').pop() }),
    302,
  );
});
