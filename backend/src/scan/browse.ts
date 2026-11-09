import type { Browser, Page } from 'puppeteer-core';
import { CAPTURE_SCRIPT } from './capture-script.js';
import type { CapturedPage, SiteCapture } from './types.js';

export const MAX_EXTRA_PAGES = 5;
const VIEWPORT = { width: 1280, height: 800 };
const SCREENSHOT_HEIGHT = 2400;
const NAVIGATION_TIMEOUT_MS = 25_000;
const SETTLE_MS = 800;
const PAGE_KEYWORDS: Array<[RegExp, number]> = [
  [/service|what-we-do|solutions/i, 6],
  [/product|shop|menu|store|collection/i, 5],
  [/offer|deal|special|promo|pricing|price|plans/i, 6],
  [/about|story|team|who-we-are/i, 4],
  [/contact|location|visit/i, 2],
];
const SKIP =
  /login|signin|sign-in|account|cart|checkout|privacy|terms|cookie|careers|jobs|\.(pdf|zip|jpg|png)$/i;

export type ScreenshotSink = (index: number, body: Uint8Array) => Promise<string>;

export function sitePrefix(start: URL): string {
  const path = start.pathname.endsWith('/') ? start.pathname : start.pathname.replace(/[^/]*$/, '');
  return `${start.origin}${path}`;
}

export function choosePages(start: URL, page: CapturedPage, limit = MAX_EXTRA_PAGES): string[] {
  const prefix = sitePrefix(start);
  const seen = new Set([start.href.split('#')[0], page.url.split('#')[0]]);
  const scored = page.navLinks
    .filter((link) => link.href.startsWith(prefix) && !seen.has(link.href) && !SKIP.test(link.href))
    .map((link) => {
      const haystack = `${link.text} ${new URL(link.href).pathname}`;
      const score = PAGE_KEYWORDS.reduce(
        (total, [pattern, weight]) => total + (pattern.test(haystack) ? weight : 0),
        0,
      );
      return { href: link.href, score };
    })
    .filter((link) => link.score > 0)
    .sort((left, right) => right.score - left.score);
  const chosen: string[] = [];
  for (const link of scored) {
    if (!chosen.includes(link.href)) {
      chosen.push(link.href);
    }
    if (chosen.length >= limit) {
      break;
    }
  }
  return chosen;
}

async function capture(page: Page, url: string): Promise<CapturedPage> {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT_MS });
  } catch {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
  }
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  return (await page.evaluate(CAPTURE_SCRIPT)) as CapturedPage;
}

async function screenshot(page: Page): Promise<Uint8Array> {
  const height = Math.min(
    SCREENSHOT_HEIGHT,
    (await page.evaluate('document.documentElement.scrollHeight')) as number,
  );
  return page.screenshot({
    type: 'jpeg',
    quality: 70,
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: Math.max(VIEWPORT.height, height) },
    captureBeyondViewport: true,
  });
}

export async function browseSite(
  browser: Browser,
  startUrl: string,
  saveScreenshot: ScreenshotSink,
): Promise<SiteCapture> {
  const start = new URL(startUrl);
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const result: SiteCapture = { startUrl: start.href, pages: [], failedPages: [] };
  try {
    const home = await capture(page, start.href);
    result.pages.push({ ...home, screenshotKey: await saveScreenshot(0, await screenshot(page)) });
    for (const url of choosePages(start, home)) {
      try {
        const captured = await capture(page, url);
        const index = result.pages.length;
        result.pages.push({
          ...captured,
          screenshotKey: await saveScreenshot(index, await screenshot(page)),
        });
      } catch {
        result.failedPages.push(url);
      }
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  return result;
}
