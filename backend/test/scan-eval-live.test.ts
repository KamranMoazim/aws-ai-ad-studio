import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { buildSites, type SiteExpectation } from './fixtures/sites.js';
import { check, finish } from './helpers.js';
import { call, createTestUser, deleteCognitoUsers, outputs, run, token } from './live.js';

const { deletePartitions, deletePrefix } = await import('./cleanup.js');
const { contrast, distance } = await import('../src/scan/palette.js');
const { normalizeText } = await import('../src/scan/offers.js');

const SCAN_WAIT_MS = 8 * 60_000;
const CONCURRENCY = 3;
const COLOR_TOLERANCE = 40;
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};
const s3Client = new S3Client({ region: outputs.Region });
const fixturePrefix = `scan-fixtures/${run}`;

const root = mkdtempSync(join(tmpdir(), 'adstudio-scan-'));
const sites = await buildSites(root);
for (const site of sites) {
  for (const file of readdirSync(join(root, site.name))) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: outputs.AssetsBucketName,
        Key: `${fixturePrefix}/${site.name}/${file}`,
        Body: readFileSync(join(root, site.name, file)),
        ContentType: TYPES[extname(file)] ?? 'application/octet-stream',
      }),
    );
  }
}

const admin = await createTestUser('scan-admin', ['super-admin']);
const partitions = [`USER#${admin.userId}`];
const prefixes = [`${fixturePrefix}/`];
const siteText = (site: SiteExpectation) =>
  normalizeText(
    readdirSync(join(root, site.name))
      .filter((file) => file.endsWith('.html'))
      .map((file) => readFileSync(join(root, site.name, file), 'utf8').replace(/<[^>]+>/g, ' '))
      .join(' '),
  );

interface Outcome {
  site: SiteExpectation;
  logo: boolean;
  palette: boolean;
  offersReal: boolean;
  offersFound: number;
  failed?: string;
  clientId: string;
  scanId?: string;
  result?: any;
}

async function scanSite(adminToken: string, site: SiteExpectation): Promise<Outcome> {
  const client = (await call(adminToken, 'POST', '/clients', { name: `Scan ${site.name} ${run}` }))
    .body;
  partitions.push(`CLIENT#${client.clientId}`);
  prefixes.push(`scans/${client.clientId}/`, `assets/${client.clientId}/`);
  const url = `${outputs.SiteUrl}/${fixturePrefix}/${site.name}/index.html`;
  const started = await call(adminToken, 'POST', `/clients/${client.clientId}/scans`, {
    url,
    confirmOwnership: true,
  });
  if (started.status !== 202) {
    return {
      site,
      logo: false,
      palette: false,
      offersReal: false,
      offersFound: 0,
      failed: JSON.stringify(started.body),
      clientId: client.clientId,
    };
  }
  const deadline = Date.now() + SCAN_WAIT_MS;
  let latest = started;
  do {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    latest = await call(
      adminToken,
      'GET',
      `/clients/${client.clientId}/scans/${started.body.scanId}`,
    );
  } while (!['ready', 'failed'].includes(latest.body.scan?.status) && Date.now() < deadline);
  if (latest.body.scan?.status !== 'ready') {
    return {
      site,
      logo: false,
      palette: false,
      offersReal: false,
      offersFound: 0,
      failed: latest.body.scan?.error ?? latest.body.scan?.status,
      clientId: client.clientId,
      scanId: started.body.scanId,
    };
  }
  const result = latest.body.result;
  const chosen = result.logo.candidates.find(
    (candidate: any) => candidate.index === result.logo.choice.logoIndex,
  );
  const logo = Boolean(
    chosen && `${chosen.source.src ?? ''} ${chosen.source.hint ?? ''}`.includes(site.logoMarker),
  );
  const colors = [result.palette.primary, result.palette.accent, result.palette.secondary].filter(
    Boolean,
  );
  const near = (expected: string) =>
    colors.some((color: string) => distance(color, expected) <= COLOR_TOLERANCE);
  const palette =
    near(site.primary) &&
    near(site.accent) &&
    contrast(result.palette.text, result.palette.background) >= 4.5;
  const text = siteText(site);
  const offersReal = result.content.offers.every((offer: any) =>
    text.includes(normalizeText(offer.quote)),
  );
  const offersFound = site.offers.filter((expected) =>
    result.content.offers.some(
      (offer: any) =>
        normalizeText(offer.quote).includes(normalizeText(expected)) ||
        normalizeText(expected).includes(normalizeText(offer.quote)),
    ),
  ).length;
  return {
    site,
    logo,
    palette,
    offersReal,
    offersFound,
    clientId: client.clientId,
    scanId: started.body.scanId,
    result,
  };
}

try {
  const adminToken = await token(admin.email);
  const outcomes: Outcome[] = [];
  for (let start = 0; start < sites.length; start += CONCURRENCY) {
    outcomes.push(
      ...(await Promise.all(
        sites.slice(start, start + CONCURRENCY).map((site) => scanSite(adminToken, site)),
      )),
    );
  }
  for (const outcome of outcomes) {
    const { site } = outcome;
    if (outcome.failed) {
      check(`${site.name}: scan finished`, false, outcome.failed);
      continue;
    }
    check(
      `${site.name}: correct logo${site.hard ? ` (${site.hard})` : ''}`,
      outcome.logo,
      outcome.result.logo.choice,
    );
    check(`${site.name}: usable palette`, outcome.palette, {
      palette: outcome.result.palette,
      expected: [site.primary, site.accent],
    });
    check(
      `${site.name}: every offer is quoted from the site`,
      outcome.offersReal,
      outcome.result.content.offers,
    );
    check(
      `${site.name}: found ${outcome.offersFound}/${site.offers.length} real offers`,
      outcome.offersFound === site.offers.length,
      outcome.result.content.offers,
    );
  }
  const logos = outcomes.filter((outcome) => outcome.logo).length;
  const palettes = outcomes.filter((outcome) => outcome.palette).length;
  const invented = outcomes.filter((outcome) => !outcome.failed && !outcome.offersReal).length;
  console.log(
    `\nEXIT CHECK: logos ${logos}/10, palettes ${palettes}/10, sites with invented offers ${invented}`,
  );
  check('correct logo for at least 8 of 10 sites', logos >= 8, logos);
  check('usable palette for all 10 sites', palettes === 10, palettes);
  check('no invented offers', invented === 0, invented);

  const sample = outcomes.find((outcome) => outcome.result && outcome.site.offers.length);
  if (sample) {
    const draft = sample.result.draft;
    const saved = await call(
      adminToken,
      'POST',
      `/clients/${sample.clientId}/scans/${sample.scanId}/brand-kit`,
      {
        name: draft.name,
        logoIndex: draft.logoIndex,
        photoIndexes: draft.photoIndexes,
        colors: Object.fromEntries(Object.entries(draft.colors).filter(([, value]) => value)),
        services: draft.services,
        offerQuotes: draft.offers.map((offer: any) => offer.quote),
        ctas: draft.ctas,
      },
    );
    check(
      'a reviewed scan saves as a brand kit with its assets',
      saved.status === 201 && saved.body.photoIds.length === draft.photoIndexes.length,
      saved.body,
    );
    const invented = await call(
      adminToken,
      'POST',
      `/clients/${sample.clientId}/scans/${sample.scanId}/brand-kit`,
      {
        name: 'x',
        logoIndex: null,
        photoIndexes: [],
        colors: { primary: '#000000', accent: '#ffffff', text: '#000000', background: '#ffffff' },
        services: [],
        offerQuotes: ['50% off everything forever'],
        ctas: [],
      },
    );
    check('an offer that was not found on the site cannot be saved', invented.status === 400);
  }
  const owner = await createTestUser('scan-user', ['client-user'], outcomes[0].clientId);
  partitions.push(`USER#${owner.userId}`);
  check(
    'client users cannot start scans',
    (
      await call(await token(owner.email), 'POST', `/clients/${outcomes[0].clientId}/scans`, {
        url: 'https://example.com',
        confirmOwnership: true,
      })
    ).status === 403,
  );
  await deleteCognitoUsers([owner.email]);
  check(
    'private addresses cannot be scanned',
    (
      await call(adminToken, 'POST', `/clients/${outcomes[0].clientId}/scans`, {
        url: 'http://169.254.169.254/latest',
        confirmOwnership: true,
      })
    ).status === 400,
  );
  check(
    'scans need the ownership confirmation',
    (
      await call(adminToken, 'POST', `/clients/${outcomes[0].clientId}/scans`, {
        url: 'https://example.com',
      })
    ).status === 400,
  );
} finally {
  await deleteCognitoUsers([admin.email]);
  await deletePartitions(partitions);
  for (const prefix of prefixes) {
    await deletePrefix(prefix);
  }
}
finish();
