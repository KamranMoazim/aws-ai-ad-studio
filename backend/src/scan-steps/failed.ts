import { updateScan } from '../data/scans.js';
import type { ScanInput } from './browse.js';

const KNOWN: Array<[RegExp, string]> = [
  [
    /could not be loaded|net::ERR|Navigation timeout|ERR_NAME_NOT_RESOLVED/i,
    'The website could not be loaded. Check the address and try again.',
  ],
  [
    /no structured answer|refusal/i,
    'The website content could not be analysed. Fill in the brand kit by hand.',
  ],
];

export async function handler(event: ScanInput & { error?: { Error?: string; Cause?: string } }) {
  const cause = `${event.error?.Error ?? ''} ${event.error?.Cause ?? ''}`;
  console.error(`scan ${event.scanId} failed: ${cause.slice(0, 600)}`);
  const message =
    KNOWN.find(([pattern]) => pattern.test(cause))?.[1] ??
    'The scan failed. You can try again, or build the brand kit by hand.';
  await updateScan(event.clientId, event.scanId, { status: 'failed', error: message });
}
