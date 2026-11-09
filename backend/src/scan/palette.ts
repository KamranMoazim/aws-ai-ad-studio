import type { ColorSample } from './types.js';

export interface Palette {
  primary: string;
  secondary?: string;
  accent: string;
  text: string;
  background: string;
}

export interface WeightedColor {
  color: string;
  weight: number;
}

const MERGE_DISTANCE = 28;
const DISTINCT_DISTANCE = 60;
const MIN_CONTRAST = 4.5;
const ROLE_WEIGHTS = {
  primary: { 'header-bg': 3, 'css-var': 2, heading: 1.5, link: 1.2, 'button-bg': 1 },
  accent: { 'button-bg': 3, 'css-var': 1, link: 0.5 },
} as const;

const channels = (hex: string) =>
  [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));

export const distance = (left: string, right: string) => {
  const [a, b, c] = channels(left);
  const [d, e, f] = channels(right);
  return Math.sqrt((a - d) ** 2 + (b - e) ** 2 + (c - f) ** 2);
};

export function saturationLightness(hex: string): { saturation: number; lightness: number } {
  const [red, green, blue] = channels(hex).map((value) => value / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return { saturation, lightness };
}

export const isNeutral = (hex: string) => {
  const { saturation, lightness } = saturationLightness(hex);
  return saturation < 0.15 || lightness > 0.94 || lightness < 0.06;
};

function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrast(left: string, right: string): number {
  const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function merge(colors: WeightedColor[]): WeightedColor[] {
  const clusters: WeightedColor[] = [];
  for (const entry of [...colors].sort((left, right) => right.weight - left.weight)) {
    const near = clusters.find((cluster) => distance(cluster.color, entry.color) < MERGE_DISTANCE);
    if (near) {
      near.weight += entry.weight;
    } else {
      clusters.push({ ...entry });
    }
  }
  return clusters.sort((left, right) => right.weight - left.weight);
}

function byRole(
  samples: ColorSample[],
  weights: Record<string, number>,
  extra: WeightedColor[] = [],
) {
  return merge([
    ...samples
      .filter((sample) => weights[sample.role] && !isNeutral(sample.color))
      .map((sample) => ({ color: sample.color, weight: sample.weight * weights[sample.role] })),
    ...extra.filter((entry) => !isNeutral(entry.color)),
  ]);
}

function readableOn(background: string, preferred?: string): string {
  if (preferred && contrast(preferred, background) >= MIN_CONTRAST) {
    return preferred;
  }
  return contrast('#111111', background) >= contrast('#ffffff', background) ? '#111111' : '#ffffff';
}

export function buildPalette(samples: ColorSample[], imageColors: WeightedColor[] = []): Palette {
  const weakImage = imageColors.map((entry) => ({ ...entry, weight: entry.weight * 0.3 }));
  const primaryCandidates = byRole(samples, ROLE_WEIGHTS.primary, weakImage);
  const primary = primaryCandidates[0]?.color ?? '#1f3a5f';
  const accentCandidates = byRole(samples, ROLE_WEIGHTS.accent, weakImage).filter(
    (entry) => distance(entry.color, primary) > DISTINCT_DISTANCE,
  );
  const secondaryCandidates = primaryCandidates.filter(
    (entry) => distance(entry.color, primary) > DISTINCT_DISTANCE,
  );
  const accent =
    accentCandidates[0]?.color ??
    secondaryCandidates[0]?.color ??
    (saturationLightness(primary).lightness > 0.5 ? '#1b1b1b' : '#f2a541');
  const secondary = secondaryCandidates.find(
    (entry) => distance(entry.color, accent) > DISTINCT_DISTANCE,
  )?.color;
  const backgrounds = merge(
    samples
      .filter((sample) => sample.role === 'body-bg')
      .map(({ color, weight }) => ({ color, weight })),
  );
  const background = backgrounds[0]?.color ?? '#ffffff';
  const texts = merge(
    samples
      .filter((sample) => sample.role === 'body-text')
      .map(({ color, weight }) => ({ color, weight })),
  );
  return { primary, secondary, accent, background, text: readableOn(background, texts[0]?.color) };
}

export function kMeans(
  pixels: Array<[number, number, number]>,
  clusters = 6,
  rounds = 10,
): WeightedColor[] {
  if (!pixels.length) {
    return [];
  }
  const step = Math.max(1, Math.floor(pixels.length / clusters));
  let centers = Array.from(
    { length: clusters },
    (_, index) => pixels[Math.min(index * step, pixels.length - 1)],
  );
  let counts = new Array(clusters).fill(0);
  for (let round = 0; round < rounds; round++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = new Array(clusters).fill(0);
    for (const pixel of pixels) {
      let best = 0;
      let bestDistance = Infinity;
      centers.forEach((center, index) => {
        const value =
          (pixel[0] - center[0]) ** 2 + (pixel[1] - center[1]) ** 2 + (pixel[2] - center[2]) ** 2;
        if (value < bestDistance) {
          bestDistance = value;
          best = index;
        }
      });
      counts[best]++;
      sums[best][0] += pixel[0];
      sums[best][1] += pixel[1];
      sums[best][2] += pixel[2];
    }
    centers = centers.map((center, index) =>
      counts[index]
        ? ([0, 1, 2].map((channel) => Math.round(sums[index][channel] / counts[index])) as [
            number,
            number,
            number,
          ])
        : center,
    );
  }
  const hex = (value: number) => value.toString(16).padStart(2, '0');
  return centers
    .map((center, index) => ({
      color: `#${hex(center[0])}${hex(center[1])}${hex(center[2])}`,
      weight: counts[index] / pixels.length,
    }))
    .filter((entry) => entry.weight > 0)
    .sort((left, right) => right.weight - left.weight);
}
