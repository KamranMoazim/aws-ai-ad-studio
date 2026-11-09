import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
};

export async function startStaticServer(root: string): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (request, response) => {
    const path = normalize(
      decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname),
    );
    if (path.includes('..')) {
      response.writeHead(400).end();
      return;
    }
    try {
      const body = await readFile(join(root, path));
      response.writeHead(200, {
        'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
