import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  checkPublicUrl,
  fetchImage,
  FetchRefused,
  isPublicAddress,
  sniffImage,
  type FetchOptions,
} from '../src/scan/fetcher.js';
import { check, finish } from './helpers.js';

for (const address of [
  '127.0.0.1',
  '10.1.2.3',
  '172.20.0.1',
  '192.168.1.1',
  '169.254.169.254',
  '100.64.0.1',
  '0.0.0.0',
  '::1',
  '::',
  'fe80::1',
  'fd00::1',
  '::ffff:127.0.0.1',
  '::ffff:169.254.169.254',
  '64:ff9b::a9fe:a9fe',
  '2002:7f00:1::',
  'not-an-ip',
]) {
  check(`refuses ${address}`, !isPublicAddress(address));
}
for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
  check(`allows ${address}`, isPublicAddress(address));
}

async function refusal(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error instanceof FetchRefused ? error.reason : `other:${(error as Error).message}`;
  }
}
const image = (url: string, options?: FetchOptions) => refusal(() => fetchImage(url, options));

check('file scheme refused', (await image('file:///etc/passwd')) === 'scheme');
check(
  'metadata ip refused',
  (await image('http://169.254.169.254/latest/meta-data/')) === 'private_address',
);
check('loopback refused', (await image('http://127.0.0.1/')) === 'private_address');
check('ipv6 loopback refused', (await image('http://[::1]/')) === 'private_address');
check('decimal ip form refused', (await image('http://2130706433/')) === 'private_address');
check('hex ip form refused', (await image('http://0x7f000001/')) === 'private_address');
check('short ip form refused', (await image('http://127.1/')) === 'private_address');
check('localhost refused after dns', (await image('http://localhost/')) === 'private_address');
check('credentials refused', (await image('http://user:pass@example.com/')) === 'credentials');
check('odd port refused', (await image('http://example.com:22/')) === 'port');
check(
  'scan url to localhost refused',
  (await refusal(() => checkPublicUrl('http://localhost/'))) === 'private_address',
);
check(
  'scan url with javascript scheme refused',
  (await refusal(() => checkPublicUrl('javascript:alert(1)'))) === 'scheme',
);

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const server = http.createServer((request, response) => {
  const path = request.url ?? '/';
  if (path === '/logo.png') {
    response.end(PNG);
  } else if (path === '/page.html') {
    response.setHeader('content-type', 'image/png');
    response.end('<html>not really an image</html>');
  } else if (path === '/to-metadata') {
    response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
    response.end();
  } else if (path.startsWith('/loop/')) {
    response.writeHead(302, { location: `/loop/${Number(path.split('/')[2]) + 1}` });
    response.end();
  } else if (path === '/big') {
    response.write(PNG);
    response.end(Buffer.alloc(11 * 1024 * 1024));
  } else if (path === '/slow') {
    response.write(PNG);
    setTimeout(() => response.end(), 1500);
  } else {
    response.statusCode = 404;
    response.end('nope');
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = String((server.address() as AddressInfo).port);
const base = `http://127.0.0.1:${port}`;
const local: FetchOptions = {
  isAllowedAddress: (address) => address === '127.0.0.1',
  allowedPorts: ['', port],
};

try {
  check(
    'default options refuse the local server',
    (await image(`${base}/logo.png`, { allowedPorts: [port] })) === 'private_address',
  );
  const fetched = await fetchImage(`${base}/logo.png`, local);
  check('png fetched and sniffed', fetched.format === 'png');
  check(
    'html served as image/png is refused',
    (await image(`${base}/page.html`, local)) === 'not_an_image',
  );
  check(
    'redirect to metadata ip refused on the hop',
    (await image(`${base}/to-metadata`, local)) === 'private_address',
  );
  check('fourth redirect refused', (await image(`${base}/loop/0`, local)) === 'too_many_redirects');
  check('oversize body refused', (await image(`${base}/big`, local)) === 'too_large');
  check(
    'slow response times out',
    (await image(`${base}/slow`, { ...local, timeoutMs: 300 })) === 'timeout',
  );
  check('404 refused', (await image(`${base}/missing`, local)) === 'status');
} finally {
  server.close();
}

check(
  'sniffs svg with xml prolog',
  sniffImage(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')) ===
    'svg',
);
check(
  'does not call html an svg',
  sniffImage(Buffer.from('<html><svg></svg></html>')) === undefined,
);
check('sniffs jpeg', sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])) === 'jpeg');
finish();
