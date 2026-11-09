import { SIZES, type SizeKey } from './sizes.js';
import type { Element, Layout } from './types.js';

const round = (value: number) => Math.round(value * 10) / 10;

function scaleElement(element: Element, scaleX: number, scaleY: number): Element {
  const scale = Math.min(scaleX, scaleY);
  const style = { ...element.style };
  for (const key of ['fontSize', 'minFontSize', 'radius', 'padding', 'letterSpacing'] as const) {
    if (style[key] !== undefined) {
      style[key] = Math.max(key === 'letterSpacing' ? -20 : 1, round(style[key]! * scale));
    }
  }
  if (style.fontSize !== undefined) {
    style.fontSize = Math.max(4, Math.round(style.fontSize));
  }
  if (style.minFontSize !== undefined) {
    style.minFontSize = Math.max(4, Math.round(style.minFontSize));
  }
  return {
    ...element,
    frame: {
      ...element.frame,
      x: round(element.frame.x * scaleX),
      y: round(element.frame.y * scaleY),
      w: Math.max(1, round(element.frame.w * scaleX)),
      h: Math.max(1, round(element.frame.h * scaleY)),
    },
    style,
  };
}

export function adaptLayout(source: Layout, target: SizeKey): Layout {
  const { width, height } = SIZES[target];
  const scaleX = width / source.width;
  const scaleY = height / source.height;
  return {
    width,
    height,
    elements: source.elements.map((element) => scaleElement(element, scaleX, scaleY)),
  };
}
