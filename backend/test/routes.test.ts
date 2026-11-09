import { app, PROTECTED_PREFIXES } from '../src/api/app.js';
import { check, finish } from './helpers.js';

const PUBLIC = ['/health', '/branding', '/d/'];
const mounted = new Set(
  app.routes
    .map((route) => `/${route.path.split('/')[1]}`)
    .filter((prefix) => prefix !== '/*' && prefix !== '/'),
);
const unguarded = [...mounted].filter(
  (prefix) =>
    !PROTECTED_PREFIXES.includes(prefix) && !PUBLIC.some((path) => path.startsWith(prefix)),
);
check(
  'every mounted route prefix requires a signed-in user or is deliberately public',
  unguarded.length === 0,
  unguarded,
);

for (const prefix of PROTECTED_PREFIXES) {
  const response = await app.request(prefix);
  check(`${prefix} without a token is 401`, response.status === 401, response.status);
}
finish();
