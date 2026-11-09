import {
  contrastRatio,
  resolveColor,
  SIZES,
  sizesForChannel,
  type ColorRole,
  type Content,
  type Element,
  type Template,
} from '../../../shared/src/index.js';
import type { Asset, BrandKit } from '../core/schemas.js';

const MIN_CONTRAST = 4.5;
const DARK = '#111111';
const LIGHT = '#ffffff';

function averageAspect(template: Template, slot: string): number {
  const aspects: number[] = [];
  for (const size of sizesForChannel(template.channel)) {
    for (const element of template.layouts[size]!.elements) {
      if (element.bind === slot && !element.hidden) {
        aspects.push(element.frame.w / element.frame.h);
      }
    }
  }
  return aspects.length ? aspects.reduce((total, value) => total + value, 0) / aspects.length : 1;
}

function luminanceOf(hex: string): number {
  return contrastRatio(hex, '#000000');
}

function backgroundUnder(template: Template, slot: string, colors: Content['colors']): string {
  const size = sizesForChannel(template.channel)[0];
  const elements = template.layouts[size]!.elements;
  const index = elements.findIndex((element) => element.bind === slot);
  for (let below = index - 1; below >= 0; below--) {
    const element = elements[below];
    if (element.type === 'rect' && (element.style.opacity ?? 1) >= 0.5) {
      return resolveColor(element.style.fill, colors);
    }
    if (element.type === 'image') {
      return DARK;
    }
  }
  return colors.background ?? LIGHT;
}

export function assignImages(
  template: Template,
  kit: BrandKit,
  assets: Asset[],
  colors: Content['colors'],
): Content['images'] {
  const byId = new Map(
    assets
      .filter((asset) => asset.status === 'ready' && asset.key)
      .map((asset) => [asset.assetId, asset]),
  );
  const images: Content['images'] = {};
  const unused = kit.photoIds
    .map((id) => byId.get(id))
    .filter((asset): asset is Asset => Boolean(asset));
  for (const slot of template.slots.filter((candidate) => candidate.kind === 'image')) {
    if (slot.key.includes('logo')) {
      const darkBackground = luminanceOf(backgroundUnder(template, slot.key, colors)) < 6;
      const logo =
        byId.get((darkBackground ? kit.logoDarkId : kit.logoLightId) ?? '') ??
        byId.get(kit.logoLightId ?? kit.logoDarkId ?? '');
      if (logo?.key) {
        images[slot.key] = { src: logo.key, focalX: 0.5, focalY: 0.5 };
      }
      continue;
    }
    const target = averageAspect(template, slot.key);
    unused.sort(
      (left, right) =>
        Math.abs(Math.log((left.width ?? 1) / (left.height ?? 1) / target)) -
        Math.abs(Math.log((right.width ?? 1) / (right.height ?? 1) / target)),
    );
    const photo = unused.shift();
    if (photo?.key) {
      images[slot.key] = { src: photo.key, focalX: photo.focalX, focalY: photo.focalY };
    }
  }
  return images;
}

type TextPair = { element: Element; background: string | undefined };

function textPairs(template: Template): TextPair[] {
  const size =
    sizesForChannel(template.channel).find((key) => SIZES[key].channel === 'meta') ??
    sizesForChannel(template.channel)[0];
  const elements = template.layouts[size]!.elements;
  return elements
    .map((element, index): TextPair | undefined => {
      if (element.type === 'button') {
        return { element, background: element.style.fill };
      }
      if (element.type !== 'text') {
        return undefined;
      }
      const centerX = element.frame.x + element.frame.w / 2;
      const centerY = element.frame.y + element.frame.h / 2;
      for (let below = index - 1; below >= 0; below--) {
        const under = elements[below];
        const { x, y, w, h } = under.frame;
        if (under.hidden || centerX < x || centerX > x + w || centerY < y || centerY > y + h) {
          continue;
        }
        if (
          under.type === 'image' ||
          ((under.type === 'rect' || under.type === 'button') && (under.style.opacity ?? 1) < 1)
        ) {
          return { element, background: undefined };
        }
        if (under.type === 'rect' || under.type === 'button') {
          return { element, background: under.style.fill };
        }
      }
      return { element, background: 'color:background' };
    })
    .filter((pair): pair is TextPair => Boolean(pair));
}

export function assignColors(template: Template, kit: BrandKit): Content['colors'] {
  const colors: Content['colors'] = { ...template.sample.colors };
  for (const role of template.colorRoles) {
    if (kit.colors[role]) {
      colors[role] = kit.colors[role];
    }
  }
  for (const { element, background } of textPairs(template)) {
    const foreground = element.style.color;
    if (!background || !foreground?.startsWith('color:')) {
      continue;
    }
    const role = foreground.slice('color:'.length) as ColorRole;
    if (role !== 'text') {
      continue;
    }
    const back = resolveColor(background, colors);
    if (contrastRatio(resolveColor(foreground, colors), back) < MIN_CONTRAST) {
      colors[role] = contrastRatio(DARK, back) >= contrastRatio(LIGHT, back) ? DARK : LIGHT;
    }
  }
  return colors;
}
