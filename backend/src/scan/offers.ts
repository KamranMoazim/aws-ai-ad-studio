import type { ExtractedContent } from './claude.js';

export const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

const NUMBER = /\d+(?:[.,]\d+)?%?/g;

export interface VerifiedContent extends ExtractedContent {
  dropped: { offers: number; ctas: number };
}

export function verifyContent(
  content: ExtractedContent,
  pages: Array<{ url: string; text: string }>,
  capturedCtas: string[],
): VerifiedContent {
  const normalizedPages = pages.map((page) => ({ url: page.url, text: normalizeText(page.text) }));
  const offers: ExtractedContent['offers'] = [];
  for (const offer of content.offers) {
    const quote = normalizeText(offer.quote);
    if (quote.length < 4) {
      continue;
    }
    const page =
      normalizedPages.find(
        (candidate) => candidate.url === offer.sourceUrl && candidate.text.includes(quote),
      ) ?? normalizedPages.find((candidate) => candidate.text.includes(quote));
    if (!page) {
      continue;
    }
    const quoteNumbers = new Set(quote.match(NUMBER) ?? []);
    const invented = (normalizeText(offer.text).match(NUMBER) ?? []).some(
      (number) => !quoteNumbers.has(number),
    );
    offers.push({
      text: invented ? offer.quote.trim() : offer.text.trim(),
      quote: offer.quote.trim(),
      sourceUrl: page.url,
    });
  }
  const allText = normalizedPages.map((page) => page.text).join('\n');
  const known = new Set(capturedCtas.map(normalizeText));
  const ctas = content.ctas.filter(
    (cta) => known.has(normalizeText(cta)) || allText.includes(normalizeText(cta)),
  );
  return {
    ...content,
    offers,
    ctas,
    dropped: {
      offers: content.offers.length - offers.length,
      ctas: content.ctas.length - ctas.length,
    },
  };
}
