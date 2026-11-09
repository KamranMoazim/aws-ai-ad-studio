import { finishExport } from '../data/exports.js';
import type { ExportInput } from './snapshot.js';

const GENERIC = 'The export failed. Try again, or contact support if it keeps failing.';

function reason(error: { Error?: string; Cause?: string } | undefined): string {
  try {
    const cause = JSON.parse(error?.Cause ?? '{}') as { errorType?: string; errorMessage?: string };
    if (cause.errorType === 'RenderCheckFailed' && cause.errorMessage) {
      return cause.errorMessage;
    }
  } catch {
    return GENERIC;
  }
  return GENERIC;
}

export async function handler(event: ExportInput & { error?: { Error?: string; Cause?: string } }) {
  console.error(
    `export ${event.exportId} failed: ${event.error?.Error} ${event.error?.Cause?.slice(0, 500)}`,
  );
  await finishExport(event, { status: 'failed', error: reason(event.error) });
}
