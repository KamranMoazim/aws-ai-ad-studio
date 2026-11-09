import { createHash } from 'node:crypto';
import type { LogoCandidate, SiteCapture } from './types.js';

export const MAX_LOGO_CANDIDATES = 6;
const DISTRACTOR =
  /award|partner|client|sponsor|badge|certif|featured|press|as seen|payment|visa|mastercard|paypal|social|facebook|instagram|twitter|linkedin|youtube|tiktok/i;

export interface RankedLogo extends LogoCandidate {
  key: string;
  score: number;
  pages: number;
}

const keyOf = (candidate: LogoCandidate) =>
  candidate.src ??
  `svg:${createHash('sha256')
    .update(candidate.markup ?? '')
    .digest('hex')
    .slice(0, 16)}`;

function scoreOf(candidate: LogoCandidate, pages: number): number {
  let score = 0;
  if (candidate.inHeader) {
    score += 5;
  }
  if (candidate.linksHome) {
    score += 5;
  }
  if (candidate.hasLogoWord) {
    score += 6;
  }
  if ((candidate.kind === 'img' || candidate.kind === 'svg-inline') && candidate.top < 150) {
    score += 3;
  }
  if (candidate.kind === 'img' || candidate.kind === 'svg-inline') {
    score += 2;
  }
  if (candidate.kind === 'css') {
    score += 3;
  }
  if (candidate.kind === 'meta') {
    score += candidate.hint === 'og:logo' ? 4 : -2;
  }
  if (candidate.kind === 'icon') {
    score += /apple-touch/i.test(candidate.hint ?? '') ? 1 : -2;
  }
  if (candidate.top > 1000) {
    score -= 6;
  }
  if (
    candidate.width >= 40 &&
    candidate.width <= 600 &&
    candidate.height >= 16 &&
    candidate.height <= 300
  ) {
    score += 2;
  }
  if (DISTRACTOR.test(`${candidate.hint ?? ''} ${candidate.alt ?? ''} ${candidate.src ?? ''}`)) {
    score -= 8;
  }
  return score + Math.min(pages - 1, 3) * 2;
}

export function rankLogoCandidates(capture: SiteCapture): RankedLogo[] {
  const byKey = new Map<string, { candidate: LogoCandidate; pages: Set<number> }>();
  capture.pages.forEach((page, pageIndex) => {
    for (const candidate of page.logoCandidates) {
      if (!candidate.src && !candidate.markup) {
        continue;
      }
      const key = keyOf(candidate);
      const entry = byKey.get(key);
      if (entry) {
        entry.pages.add(pageIndex);
      } else {
        byKey.set(key, { candidate, pages: new Set([pageIndex]) });
      }
    }
  });
  return [...byKey.entries()]
    .map(([key, { candidate, pages }]) => ({
      ...candidate,
      key,
      pages: pages.size,
      score: scoreOf(candidate, pages.size),
    }))
    .sort((left, right) => right.score - left.score);
}
