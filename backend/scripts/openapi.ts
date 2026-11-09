import { writeFileSync } from 'node:fs';

process.env.CORS_ORIGINS ??= 'http://localhost:5173';
const { app } = await import('../src/api/app.js');

const PUBLIC = new Set(['GET /health', 'GET /branding', 'GET /d/{token}', 'POST /webhooks/stripe']);
const TAGS: Array<[RegExp, string]> = [
  [/^\/clients\/\{id\}\/(scans)/, 'Website scan'],
  [/^\/clients\/\{id\}\/(generations|images)/, 'AI generation'],
  [/^\/clients\/\{id\}\/(assets|brand-kits)/, 'Brand kits and assets'],
  [/^\/clients\/\{id\}\/(projects|templates)/, 'Ad sets'],
  [/^\/clients\/\{id\}\/(prices|transactions)/, 'Payments'],
  [/^\/(prices|transactions|d)/, 'Payments'],
  [/^\/projects/, 'Ad sets'],
  [/^\/templates/, 'Templates'],
  [/^\/(clients)/, 'Clients'],
  [/^\/(users|roles|me|audit|settings|branding|health)/, 'Administration'],
];

const paths: Record<string, Record<string, unknown>> = {};
for (const route of app.routes) {
  if (route.method === 'ALL' || route.path.includes('*')) {
    continue;
  }
  const path = route.path.replace(/:([A-Za-z]+)/g, '{$1}');
  const method = route.method.toLowerCase();
  const parameters = [...path.matchAll(/\{([A-Za-z]+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  const key = `${route.method} ${path}`;
  paths[path] ??= {};
  paths[path][method] = {
    tags: [TAGS.find(([pattern]) => pattern.test(path))?.[1] ?? 'Other'],
    summary: key,
    parameters,
    security: PUBLIC.has(key) ? [] : [{ cognito: [] }],
    responses: {
      '200': { description: 'Success' },
      '400': { description: 'Invalid input: { error, message, details? }' },
      '401': { description: 'Missing or expired token' },
      '403': { description: "Not allowed by the caller's roles (or two-step sign-in not set up)" },
      '404': { description: 'Not found, or not visible to the caller' },
    },
  };
}
paths['/webhooks/stripe'] = {
  post: {
    tags: ['Payments'],
    summary: 'POST /webhooks/stripe (separate Lambda; Stripe signature required)',
    security: [],
    responses: { '200': { description: 'Received' }, '400': { description: 'Bad signature' } },
  },
};
const document = {
  openapi: '3.1.0',
  info: {
    title: 'AdStudio API',
    version: '1.0.0',
    description:
      'Generated from the Hono routes by `npm run openapi`. Permissions per route are in README.md.',
  },
  components: {
    securitySchemes: {
      cognito: { type: 'http', scheme: 'bearer', bearerFormat: 'Cognito access token' },
    },
  },
  paths: Object.fromEntries(
    Object.entries(paths).sort(([left], [right]) => left.localeCompare(right)),
  ),
};
const target = new URL('../../docs/openapi.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote docs/openapi.json with ${Object.keys(paths).length} paths`);
