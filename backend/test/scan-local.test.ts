import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';
import { browseSite } from '../src/scan/browse.js';
import { rankLogoCandidates } from '../src/scan/logo.js';
import { buildPalette, contrast, distance } from '../src/scan/palette.js';
import { buildSites } from './fixtures/sites.js';
import { check, finish } from './helpers.js';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const COLOR_TOLERANCE = 40;
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const root = mkdtempSync(join(tmpdir(), 'adstudio-sites-'));
const sites = await buildSites(root);
const server = http.createServer((request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname));
  try {
    const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
    const body = readFileSync(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

let logos = 0;
let palettes = 0;
try {
  for (const site of sites) {
    const capture = await browseSite(
      browser,
      `${base}/${site.name}/index.html`,
      async (index) => `shot-${index}`,
    );
    const urls = capture.pages.map((item) => item.url);
    check(
      `${site.name}: visits services${site.offers.length ? ' and offers' : ''}`,
      urls.some((url) => url.endsWith('services.html')) &&
        (!site.offers.length || urls.some((url) => url.endsWith('offers.html'))),
      urls,
    );
    const ranked = rankLogoCandidates(capture);
    const top = ranked[0];
    const topHit = Boolean(top && `${top.src ?? ''} ${top.markup ?? ''}`.includes(site.logoMarker));
    const inShortlist = ranked
      .slice(0, 6)
      .some((candidate) =>
        `${candidate.src ?? ''} ${candidate.markup ?? ''}`.includes(site.logoMarker),
      );
    logos += topHit ? 1 : 0;
    check(
      `${site.name}: real logo is in the shortlist${site.hard ? ` (${site.hard})` : ''}`,
      inShortlist,
      ranked.slice(0, 3).map((candidate) => candidate.src ?? candidate.kind),
    );
    const palette = buildPalette(capture.pages.flatMap((item) => item.colors));
    const near = (color: string) =>
      [palette.primary, palette.accent, palette.secondary].some(
        (value) => value && distance(value, color) <= COLOR_TOLERANCE,
      );
    const usable =
      near(site.primary) && near(site.accent) && contrast(palette.text, palette.background) >= 4.5;
    palettes += usable ? 1 : 0;
    check(`${site.name}: palette has the brand colours and readable text`, usable, {
      palette,
      expected: [site.primary, site.accent],
    });
    const allText = capture.pages.map((item) => item.text).join('\n');
    check(
      `${site.name}: every real offer is in the captured text`,
      site.offers.every((offer) => allText.includes(offer)),
    );
  }
  console.log(`rules-only logo top pick: ${logos}/10, usable palettes: ${palettes}/10`);
  check('rules alone pick the right logo for at least 8 of 10 sites', logos >= 8, logos);
  check('every site gets a usable palette', palettes === 10, palettes);
} finally {
  await browser.close();
  server.close();
}
finish();
