import type { Box } from './crop.js';

export interface SafeZone {
  top: number;
  bottom: number;
  sides: number;
}

export const DEFAULT_SAFE_ZONE: SafeZone = { top: 14, bottom: 35, sides: 6 };

export function safeRect(width: number, height: number, zone: SafeZone): Box {
  const x = (width * zone.sides) / 100;
  const y = (height * zone.top) / 100;
  return {
    x,
    y,
    width: width - x * 2,
    height: height - y - (height * zone.bottom) / 100,
  };
}
