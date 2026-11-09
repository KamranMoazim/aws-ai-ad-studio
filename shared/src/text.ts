import { DEFAULT_FONT } from './fonts.js';
import { fitText, type FitResult, type MeasureText } from './fit.js';
import type { Element, ResolvedContent, Template } from './types.js';

export const DEFAULT_LINE_HEIGHT = 1.15;
const DEFAULT_MAX_LINES = 6;

export const elementText = (element: Element, content: ResolvedContent) => {
  const raw = element.bind ? (content.texts[element.bind] ?? '') : (element.text ?? '');
  return element.style.uppercase ? raw.toUpperCase() : raw;
};

export function textBox(element: Element) {
  const padding = element.type === 'button' ? (element.style.padding ?? element.frame.h * 0.15) : 0;
  return {
    width: Math.max(1, element.frame.w - padding * 2),
    height: Math.max(1, element.frame.h - padding * 2),
    padding,
  };
}

export function maxLinesFor(template: Pick<Template, 'slots'>, element: Element): number {
  if (element.type === 'button') {
    return 1;
  }
  const slot = template.slots.find((candidate) => candidate.key === element.bind);
  return slot?.limits?.maxLines ?? DEFAULT_MAX_LINES;
}

export function fitElement(
  template: Pick<Template, 'slots'>,
  element: Element,
  text: string,
  measure: MeasureText,
): FitResult {
  const box = textBox(element);
  const fontSize = element.style.fontSize ?? 16;
  return fitText(
    {
      text,
      width: box.width,
      height: box.height,
      family: element.style.fontFamily ?? DEFAULT_FONT,
      weight: element.style.fontWeight ?? 400,
      fontSize,
      minFontSize: element.style.minFontSize ?? fontSize,
      lineHeight: element.style.lineHeight ?? DEFAULT_LINE_HEIGHT,
      letterSpacing: element.style.letterSpacing ?? 0,
      maxLines: maxLinesFor(template, element),
      mode: element.fit ?? 'shrink',
    },
    measure,
  );
}
