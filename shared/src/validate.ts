import { COLOR_PREFIX, HEX_PATTERN } from './colors.js';
import { isFontName } from './fonts.js';
import { isSizeKey, SIZES, sizesForChannel } from './sizes.js';
import {
  COLOR_ROLES,
  ELEMENT_TYPES,
  LOCKABLE,
  type ColorRole,
  type Element,
  type Template,
} from './types.js';

export interface Issue {
  path: string;
  message: string;
}

const SLOT_KEY = /^[a-z][a-z0-9-]{0,31}$/;
const ELEMENT_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const ASSET_KEY = /^template-assets\/[a-z0-9-]{1,64}\/[a-z0-9]{1,64}\.(png|jpg|webp)$/;
const MAX_SLOTS = 20;
const MAX_ELEMENTS = 80;
const MAX_TEXT = 500;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isString = (value: unknown, max = MAX_TEXT): value is string =>
  typeof value === 'string' && value.length <= max;

function checkColor(value: unknown, roles: ColorRole[], path: string, issues: Issue[]) {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string') {
    issues.push({ path, message: 'must be a color' });
  } else if (value.startsWith(COLOR_PREFIX)) {
    if (!roles.includes(value.slice(COLOR_PREFIX.length) as ColorRole)) {
      issues.push({ path, message: `${value} is not one of the template's color roles` });
    }
  } else if (!HEX_PATTERN.test(value)) {
    issues.push({ path, message: 'must be #rrggbb or color:<role>' });
  }
}

function checkRange(
  style: Json,
  key: string,
  min: number,
  max: number,
  path: string,
  issues: Issue[],
) {
  const value = style[key];
  if (value !== undefined && (!isNumber(value) || value < min || value > max)) {
    issues.push({ path: `${path}.${key}`, message: `must be a number from ${min} to ${max}` });
  }
}

function checkElement(
  element: unknown,
  path: string,
  template: Template,
  issues: Issue[],
): element is Element {
  if (!isObject(element)) {
    issues.push({ path, message: 'must be an object' });
    return false;
  }
  if (!isString(element.id) || !ELEMENT_ID.test(element.id)) {
    issues.push({ path: `${path}.id`, message: 'must be 1-40 letters, digits, - or _' });
  }
  if (!ELEMENT_TYPES.includes(element.type as never)) {
    issues.push({ path: `${path}.type`, message: `must be one of ${ELEMENT_TYPES.join(', ')}` });
  }
  const frame = element.frame;
  if (
    !isObject(frame) ||
    !['x', 'y', 'w', 'h'].every((key) => isNumber(frame[key])) ||
    (frame.w as number) <= 0 ||
    (frame.h as number) <= 0 ||
    (frame.rotation !== undefined && !isNumber(frame.rotation))
  ) {
    issues.push({ path: `${path}.frame`, message: 'needs numeric x, y and positive w, h' });
  }
  if (element.text !== undefined && !isString(element.text)) {
    issues.push({ path: `${path}.text`, message: `must be text up to ${MAX_TEXT} characters` });
  }
  if (element.bind !== undefined) {
    const slot = template.slots.find((candidate) => candidate.key === element.bind);
    const expected = element.type === 'image' ? 'image' : 'text';
    if (!slot || (element.type === 'rect' ? true : slot.kind !== expected)) {
      issues.push({
        path: `${path}.bind`,
        message: `must name a ${expected} slot of this template`,
      });
    }
  }
  const style = element.style;
  if (!isObject(style)) {
    issues.push({ path: `${path}.style`, message: 'must be an object' });
  } else {
    checkColor(style.fill, template.colorRoles, `${path}.style.fill`, issues);
    checkColor(style.color, template.colorRoles, `${path}.style.color`, issues);
    checkRange(style, 'opacity', 0, 1, `${path}.style`, issues);
    checkRange(style, 'radius', 0, 2000, `${path}.style`, issues);
    checkRange(style, 'fontSize', 4, 400, `${path}.style`, issues);
    checkRange(style, 'minFontSize', 4, 400, `${path}.style`, issues);
    checkRange(style, 'fontWeight', 100, 900, `${path}.style`, issues);
    checkRange(style, 'lineHeight', 0.6, 3, `${path}.style`, issues);
    checkRange(style, 'letterSpacing', -20, 100, `${path}.style`, issues);
    checkRange(style, 'padding', 0, 500, `${path}.style`, issues);
    if (style.fontFamily !== undefined && !isFontName(String(style.fontFamily))) {
      issues.push({ path: `${path}.style.fontFamily`, message: 'must be a bundled font' });
    }
    for (const [key, allowed] of [
      ['align', ['left', 'center', 'right']],
      ['verticalAlign', ['top', 'middle', 'bottom']],
    ] as const) {
      if (
        style[key] !== undefined &&
        !(allowed as readonly string[]).includes(style[key] as string)
      ) {
        issues.push({ path: `${path}.style.${key}`, message: `must be ${allowed.join(', ')}` });
      }
    }
  }
  const locked = element.locked;
  if (
    locked !== true &&
    !(Array.isArray(locked) && locked.every((item) => LOCKABLE.includes(item as never)))
  ) {
    issues.push({
      path: `${path}.locked`,
      message: `must be true or a list of ${LOCKABLE.join(', ')}`,
    });
  }
  if (element.fit !== undefined && !['shrink', 'clamp'].includes(element.fit as string)) {
    issues.push({ path: `${path}.fit`, message: 'must be shrink or clamp' });
  }
  if (element.crop !== undefined && !['cover', 'contain'].includes(element.crop as string)) {
    issues.push({ path: `${path}.crop`, message: 'must be cover or contain' });
  }
  return true;
}

export function validateTemplate(value: unknown): Issue[] {
  const issues: Issue[] = [];
  if (!isObject(value)) {
    return [{ path: '', message: 'template must be an object' }];
  }
  const template = value as unknown as Template;
  if (!isString(template.name, 120) || !template.name.trim()) {
    issues.push({ path: 'name', message: 'must be 1-120 characters' });
  }
  if (!['display', 'meta', 'both'].includes(template.channel)) {
    issues.push({ path: 'channel', message: 'must be display, meta or both' });
    return issues;
  }
  if (
    !Array.isArray(template.tags) ||
    template.tags.length > 20 ||
    !template.tags.every((tag) => isString(tag, 40))
  ) {
    issues.push({ path: 'tags', message: 'must be up to 20 tags of 40 characters' });
  }
  if (
    !Array.isArray(template.colorRoles) ||
    !template.colorRoles.every((role) => COLOR_ROLES.includes(role))
  ) {
    issues.push({ path: 'colorRoles', message: `must be from ${COLOR_ROLES.join(', ')}` });
    return issues;
  }
  if (!Array.isArray(template.slots) || template.slots.length > MAX_SLOTS) {
    issues.push({ path: 'slots', message: `must be a list of up to ${MAX_SLOTS} slots` });
    return issues;
  }
  const slotKeys = new Set<string>();
  template.slots.forEach((slot, index) => {
    const path = `slots.${index}`;
    if (!isObject(slot) || !isString(slot.key) || !SLOT_KEY.test(slot.key)) {
      issues.push({ path: `${path}.key`, message: 'must be lowercase letters, digits or -' });
      return;
    }
    if (slotKeys.has(slot.key)) {
      issues.push({ path: `${path}.key`, message: `duplicate slot ${slot.key}` });
    }
    slotKeys.add(slot.key);
    if (!isString(slot.label, 60)) {
      issues.push({ path: `${path}.label`, message: 'must be up to 60 characters' });
    }
    if (!['text', 'image'].includes(slot.kind)) {
      issues.push({ path: `${path}.kind`, message: 'must be text or image' });
    }
    if (typeof slot.required !== 'boolean') {
      issues.push({ path: `${path}.required`, message: 'must be true or false' });
    }
    if (slot.limits !== undefined) {
      const limits = slot.limits as unknown;
      if (
        !isObject(limits) ||
        !isNumber(limits.maxLines) ||
        limits.maxLines < 1 ||
        !isObject(limits.maxChars) ||
        !Object.entries(limits.maxChars).every(
          ([size, count]) => isSizeKey(size) && isNumber(count) && count >= 1,
        )
      ) {
        issues.push({
          path: `${path}.limits`,
          message: 'needs maxLines >= 1 and maxChars per size',
        });
      }
    }
  });
  if (!isObject(template.layouts)) {
    issues.push({ path: 'layouts', message: 'must be an object' });
    return issues;
  }
  for (const size of Object.keys(template.layouts)) {
    if (!sizesForChannel(template.channel).includes(size as never)) {
      issues.push({ path: `layouts.${size}`, message: 'is not a size of this channel' });
    }
  }
  for (const size of sizesForChannel(template.channel)) {
    const layout = template.layouts[size];
    const path = `layouts.${size}`;
    if (!isObject(layout)) {
      issues.push({ path, message: 'is missing' });
      continue;
    }
    if (layout.width !== SIZES[size].width || layout.height !== SIZES[size].height) {
      issues.push({ path, message: `must be ${SIZES[size].width} x ${SIZES[size].height}` });
    }
    if (!Array.isArray(layout.elements) || layout.elements.length > MAX_ELEMENTS) {
      issues.push({ path: `${path}.elements`, message: `must be up to ${MAX_ELEMENTS} elements` });
      continue;
    }
    const ids = new Set<string>();
    layout.elements.forEach((element, index) => {
      if (checkElement(element, `${path}.elements.${index}`, template, issues)) {
        if (ids.has(element.id)) {
          issues.push({
            path: `${path}.elements.${index}.id`,
            message: `duplicate id ${element.id}`,
          });
        }
        ids.add(element.id);
      }
    });
  }
  const sample = template.sample as unknown;
  if (
    !isObject(sample) ||
    !isObject(sample.texts) ||
    !isObject(sample.images) ||
    !isObject(sample.colors)
  ) {
    issues.push({ path: 'sample', message: 'needs texts, images and colors' });
    return issues;
  }
  for (const [key, text] of Object.entries(sample.texts)) {
    if (!isString(text)) {
      issues.push({ path: `sample.texts.${key}`, message: `must be up to ${MAX_TEXT} characters` });
    }
  }
  if (sample.textOverrides !== undefined) {
    if (
      !isObject(sample.textOverrides) ||
      !Object.entries(sample.textOverrides).every(
        ([size, texts]) =>
          isSizeKey(size) &&
          isObject(texts) &&
          Object.values(texts).every((text) => isString(text)),
      )
    ) {
      issues.push({ path: 'sample.textOverrides', message: 'must map sizes to slot texts' });
    }
  }
  for (const [key, image] of Object.entries(sample.images)) {
    if (
      !isObject(image) ||
      !isString(image.src) ||
      !ASSET_KEY.test(image.src) ||
      !isNumber(image.focalX) ||
      !isNumber(image.focalY)
    ) {
      issues.push({
        path: `sample.images.${key}`,
        message: 'needs an uploaded src and focal point',
      });
    }
  }
  for (const [role, color] of Object.entries(sample.colors)) {
    if (!COLOR_ROLES.includes(role as ColorRole) || !HEX_PATTERN.test(String(color))) {
      issues.push({ path: `sample.colors.${role}`, message: 'must be a #rrggbb color for a role' });
    }
  }
  return issues;
}
