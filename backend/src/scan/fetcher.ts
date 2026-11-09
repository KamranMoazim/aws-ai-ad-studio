import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const USER_AGENT = 'AdStudioBot/1.0 (+builds a brand kit for the site owner)';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
const DEFAULT_PORTS = ['', '80', '443'];

export type RefusalReason =
  | 'scheme'
  | 'credentials'
  | 'port'
  | 'private_address'
  | 'too_many_redirects'
  | 'too_large'
  | 'timeout'
  | 'status'
  | 'not_an_image';

export class FetchRefused extends Error {
  constructor(
    public reason: RefusalReason,
    message: string,
  ) {
    super(`${reason}: ${message}`);
    this.name = 'FetchRefused';
  }
}

const blocked = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  const family = net.isIP(ip);
  if (family === 4) {
    return !blocked.check(ip, 'ipv4');
  }
  if (family !== 6) {
    return false;
  }
  const embedded = ip.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (embedded) {
    return isPublicAddress(embedded);
  }
  if (/^(::ffff:|64:ff9b::|2002:)/.test(ip)) {
    return false;
  }
  return !blocked.check(ip, 'ipv6');
}

export interface FetchOptions {
  isAllowedAddress?: (address: string) => boolean;
  allowedPorts?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'svg' | 'ico';

export interface FetchedImage {
  url: string;
  format: ImageFormat;
  body: Buffer;
  redirects: string[];
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

function guardedLookup(isAllowed: (address: string) => boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, '');
        return;
      }
      const refused = addresses.find((entry) => !isAllowed(entry.address));
      if (refused || !addresses.length) {
        callback(
          new FetchRefused(
            'private_address',
            `${hostname} resolves to ${refused?.address ?? 'nothing'}`,
          ),
          '',
        );
        return;
      }
      if (options.all) {
        callback(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    });
  };
}

function checkUrl(url: URL, options: Required<FetchOptions>): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchRefused('scheme', url.protocol);
  }
  if (url.username || url.password) {
    throw new FetchRefused('credentials', 'urls with credentials are not fetched');
  }
  if (!options.allowedPorts.includes(url.port)) {
    throw new FetchRefused('port', url.port);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !options.isAllowedAddress(host)) {
    throw new FetchRefused('private_address', host);
  }
}

interface RawResponse {
  status: number;
  location?: string;
  body: Buffer;
}

function requestOnce(url: URL, options: Required<FetchOptions>): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (error: Error | null, value?: RawResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        request.destroy();
        reject(error);
      } else {
        resolve(value!);
      }
    };
    const request = client.request(
      url,
      {
        method: 'GET',
        agent: false,
        lookup: guardedLookup(options.isAllowedAddress) as never,
        headers: { 'user-agent': USER_AGENT, accept: 'image/*' },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          finish(null, { status, location: response.headers.location, body: Buffer.alloc(0) });
          return;
        }
        const declared = Number(response.headers['content-length'] ?? 0);
        if (declared > options.maxBytes) {
          finish(new FetchRefused('too_large', `${declared} bytes`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            finish(new FetchRefused('too_large', `over ${options.maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => finish(null, { status, body: Buffer.concat(chunks) }));
        response.on('error', (error) => finish(error));
      },
    );
    const timer = setTimeout(
      () => finish(new FetchRefused('timeout', `no complete response in ${options.timeoutMs} ms`)),
      options.timeoutMs,
    );
    request.on('error', (error) => finish(error));
    request.end();
  });
}

export function sniffImage(body: Buffer): ImageFormat | undefined {
  if (
    body.length >= 8 &&
    body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return 'jpeg';
  }
  if (
    body.length >= 12 &&
    body.toString('ascii', 0, 4) === 'RIFF' &&
    body.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (body.length >= 6 && /^GIF8[79]a$/.test(body.toString('ascii', 0, 6))) {
    return 'gif';
  }
  if (body.length >= 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0) {
    return 'ico';
  }
  const head = body.toString('utf8', 0, Math.min(body.length, 1024)).trimStart().toLowerCase();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/.test(head)) {
    return 'svg';
  }
  return undefined;
}

const withDefaults = (options: FetchOptions = {}): Required<FetchOptions> => ({
  isAllowedAddress: options.isAllowedAddress ?? isPublicAddress,
  allowedPorts: options.allowedPorts ?? DEFAULT_PORTS,
  maxBytes: options.maxBytes ?? MAX_IMAGE_BYTES,
  timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
  maxRedirects: options.maxRedirects ?? MAX_REDIRECTS,
});

export async function fetchImage(url: string, options?: FetchOptions): Promise<FetchedImage> {
  const settings = withDefaults(options);
  const redirects: string[] = [];
  let current = new URL(url);
  for (;;) {
    checkUrl(current, settings);
    const response = await requestOnce(current, settings);
    if (response.location) {
      if (redirects.length >= settings.maxRedirects) {
        throw new FetchRefused('too_many_redirects', `more than ${settings.maxRedirects}`);
      }
      redirects.push(current.toString());
      current = new URL(response.location, current);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new FetchRefused('status', String(response.status));
    }
    const format = sniffImage(response.body);
    if (!format) {
      throw new FetchRefused('not_an_image', current.toString());
    }
    return { url: current.toString(), format, body: response.body, redirects };
  }
}

export async function checkPublicUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FetchRefused('scheme', 'not a URL');
  }
  const settings = withDefaults();
  checkUrl(parsed, settings);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!net.isIP(host)) {
    const addresses = await dns.promises.lookup(host, { all: true });
    const refused = addresses.find((entry) => !settings.isAllowedAddress(entry.address));
    if (refused || !addresses.length) {
      throw new FetchRefused(
        'private_address',
        `${host} resolves to ${refused?.address ?? 'nothing'}`,
      );
    }
  }
  return parsed;
}
