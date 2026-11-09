import { contrastRatio, MIN_CONTRAST, resolveColor } from './colors.js';
import type { Box } from './crop.js';
import type { MeasureText } from './fit.js';
import { safeRect, type SafeZone } from './safe-zone.js';
import { sizesForChannel, STORY_SIZE, type SizeKey } from './sizes.js';
import { elementText, fitElement } from './text.js';
import {
  contentForSize,
  type Element,
  type Layout,
  type ResolvedContent,
  type Template,
} from './types.js';
import { validateTemplate } from './validate.js';

export type LintCode =
  | 'invalid'
  | 'missing-slot'
  | 'safe-zone'
  | 'contrast'
  | 'off-artboard'
  | 'overflow'
  | 'truncated'
  | 'max-chars'
  | 'file-size';

export interface LintIssue {
  code: LintCode;
  severity: 'error' | 'warning';
  message: string;
  size?: SizeKey;
  elementId?: string;
}

export interface LintOptions {
  safeZone: SafeZone;
  measure?: MeasureText;
}

const LONG_COPY_WORDS =
  'Book your spring service today and save on every visit with our friendly local team near you';

export function longCopy(maxChars: number): string {
  let text = LONG_COPY_WORDS;
  while (text.length < maxChars) {
    text = `${text} ${LONG_COPY_WORDS}`;
  }
  return text.slice(0, maxChars).trim();
}

const boxOf = (element: Element): Box => ({
  x: element.frame.x,
  y: element.frame.y,
  width: element.frame.w,
  height: element.frame.h,
});

const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

const label = (element: Element) => element.name ?? element.bind ?? element.id;

export function isSafeZoneContent(element: Element): boolean {
  return element.type === 'text' || element.type === 'button' || element.bind === 'logo';
}

function backgroundBehind(
  layout: Layout,
  index: number,
  content: ResolvedContent,
): string | undefined {
  const target = layout.elements[index];
  const centerX = target.frame.x + target.frame.w / 2;
  const centerY = target.frame.y + target.frame.h / 2;
  for (let below = index - 1; below >= 0; below--) {
    const element = layout.elements[below];
    const { x, y, w, h } = element.frame;
    if (element.hidden || centerX < x || centerX > x + w || centerY < y || centerY > y + h) {
      continue;
    }
    if (element.type === 'image') {
      return undefined;
    }
    if (element.type === 'rect' || element.type === 'button') {
      return (element.style.opacity ?? 1) < 1
        ? undefined
        : resolveColor(element.style.fill, content.colors);
    }
  }
  return content.colors.background ?? '#ffffff';
}

function lintLayout(
  template: Template,
  size: SizeKey,
  layout: Layout,
  options: LintOptions,
  issues: LintIssue[],
) {
  const content = contentForSize(template.sample, size);
  const visible = layout.elements.filter((element) => !element.hidden);
  for (const slot of template.slots.filter((candidate) => candidate.required)) {
    if (!visible.some((element) => element.bind === slot.key)) {
      issues.push({
        code: 'missing-slot',
        severity: 'error',
        size,
        message: `Required slot "${slot.label}" is not placed`,
      });
    }
  }
  const safe =
    size === STORY_SIZE ? safeRect(layout.width, layout.height, options.safeZone) : undefined;
  layout.elements.forEach((element, index) => {
    if (element.hidden) {
      return;
    }
    const box = boxOf(element);
    if (
      box.x >= layout.width ||
      box.y >= layout.height ||
      box.x + box.width <= 0 ||
      box.y + box.height <= 0
    ) {
      issues.push({
        code: 'off-artboard',
        severity: 'warning',
        size,
        elementId: element.id,
        message: `"${label(element)}" is outside the artboard`,
      });
    }
    if (safe && isSafeZoneContent(element) && !contains(safe, box)) {
      issues.push({
        code: 'safe-zone',
        severity: 'error',
        size,
        elementId: element.id,
        message: `"${label(element)}" is in the 9:16 no-go area`,
      });
    }
    if (element.type === 'text' || element.type === 'button') {
      const foreground = resolveColor(element.style.color, content.colors);
      const background =
        element.type === 'button'
          ? resolveColor(element.style.fill, content.colors)
          : backgroundBehind(layout, index, content);
      if (background && contrastRatio(foreground, background) < MIN_CONTRAST) {
        issues.push({
          code: 'contrast',
          severity: 'warning',
          size,
          elementId: element.id,
          message: `"${label(element)}" contrast ${contrastRatio(foreground, background).toFixed(1)}:1 is below 4.5:1`,
        });
      }
    }
  });
  if (options.measure) {
    lintText(template, size, visible, content, options.measure, issues);
  }
}

function lintText(
  template: Template,
  size: SizeKey,
  elements: Element[],
  content: ResolvedContent,
  measure: MeasureText,
  issues: LintIssue[],
) {
  for (const element of elements.filter((item) => item.type === 'text' || item.type === 'button')) {
    const slot = template.slots.find((candidate) => candidate.key === element.bind);
    const maxChars = slot?.limits?.maxChars[size];
    const sample = elementText(element, content);
    if (maxChars && sample.length > maxChars) {
      issues.push({
        code: 'max-chars',
        severity: 'error',
        size,
        elementId: element.id,
        message: `Sample "${label(element)}" is ${sample.length} characters; the limit is ${maxChars}`,
      });
    }
    const texts = [sample];
    if (maxChars) {
      const long = longCopy(maxChars);
      texts.push(element.style.uppercase ? long.toUpperCase() : long);
    }
    for (const [index, text] of texts.entries()) {
      const result = fitElement(template, element, text, measure);
      const which = index === 0 ? 'sample' : `${maxChars}-character`;
      if (!result.fits) {
        issues.push({
          code: 'overflow',
          severity: 'error',
          size,
          elementId: element.id,
          message: `"${label(element)}" overflows with ${which} copy`,
        });
      } else if (result.truncated) {
        issues.push({
          code: 'truncated',
          severity: 'warning',
          size,
          elementId: element.id,
          message: `"${label(element)}" is cut short with ${which} copy`,
        });
      }
    }
  }
}

export function lintTemplate(template: Template, options: LintOptions): LintIssue[] {
  const structural = validateTemplate(template);
  if (structural.length) {
    return structural.map((issue) => ({
      code: 'invalid',
      severity: 'error',
      message: `${issue.path}: ${issue.message}`,
    }));
  }
  const issues: LintIssue[] = [];
  for (const size of sizesForChannel(template.channel)) {
    lintLayout(template, size, template.layouts[size]!, options, issues);
  }
  return issues;
}

export const hasErrors = (issues: LintIssue[]) =>
  issues.some((issue) => issue.severity === 'error');
