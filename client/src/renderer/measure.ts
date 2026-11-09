import { cssFamily, type FontSpec, type MeasureText } from '../../../shared/src/index';

const context = document.createElement('canvas').getContext('2d')!;
const cache = new Map<string, number>();
const MAX_CACHE = 20000;

export const fontString = (weight: number, size: number, family: string) =>
  `${weight} ${size}px "${cssFamily(family)}"`;

export const measureText: MeasureText = (text: string, font: FontSpec) => {
  const key = `${font.family}|${font.weight}|${font.size}|${font.letterSpacing}|${text}`;
  let width = cache.get(key);
  if (width === undefined) {
    context.font = fontString(font.weight, font.size, font.family);
    width = context.measureText(text).width + font.letterSpacing * Array.from(text).length;
    if (cache.size > MAX_CACHE) {
      cache.clear();
    }
    cache.set(key, width);
  }
  return width;
};
