import type { ColorRole, ColorValue } from './types.js';

export const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const COLOR_PREFIX = 'color:';
export const MIN_CONTRAST = 4.5;
const FALLBACK = '#000000';

export const roleOf = (value: ColorValue | undefined): ColorRole | undefined =>
  value?.startsWith(COLOR_PREFIX) ? (value.slice(COLOR_PREFIX.length) as ColorRole) : undefined;

export function resolveColor(
  value: ColorValue | undefined,
  colors: Partial<Record<ColorRole, string>>,
  fallback = FALLBACK,
): string {
  if (!value) {
    return fallback;
  }
  const role = roleOf(value);
  if (role) {
    return colors[role] ?? fallback;
  }
  return HEX_PATTERN.test(value) ? value : fallback;
}

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);

export function contrastRatio(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}
