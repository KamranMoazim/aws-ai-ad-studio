import type { SizeKey, TemplateChannel } from './sizes.js';

export const COLOR_ROLES = ['primary', 'secondary', 'accent', 'text', 'background'] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export const ELEMENT_TYPES = ['text', 'image', 'rect', 'button'] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const LOCKABLE = ['text', 'fill', 'src', 'visible'] as const;
export type Lockable = (typeof LOCKABLE)[number];

export type SlotKind = 'text' | 'image';

export interface SlotLimits {
  maxChars: Partial<Record<SizeKey, number>>;
  maxLines: number;
}

export interface Slot {
  key: string;
  label: string;
  kind: SlotKind;
  required: boolean;
  limits?: SlotLimits;
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

/** A color is either a role reference like "color:accent" or a "#rrggbb" hex value. */
export type ColorValue = string;

export interface ElementStyle {
  fill?: ColorValue;
  color?: ColorValue;
  opacity?: number;
  radius?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  minFontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  uppercase?: boolean;
  padding?: number;
}

export interface Element {
  id: string;
  name?: string;
  type: ElementType;
  frame: Frame;
  bind?: string;
  text?: string;
  style: ElementStyle;
  locked: true | Lockable[];
  fit?: 'shrink' | 'clamp';
  crop?: 'cover' | 'contain';
  hidden?: boolean;
}

export interface Layout {
  width: number;
  height: number;
  elements: Element[];
}

export interface ImageValue {
  src: string;
  focalX: number;
  focalY: number;
}

export interface Content {
  texts: Record<string, string>;
  textOverrides?: Partial<Record<SizeKey, Record<string, string>>>;
  images: Record<string, ImageValue>;
  colors: Partial<Record<ColorRole, string>>;
}

export interface Template {
  id: string;
  version: number;
  name: string;
  channel: TemplateChannel;
  tags: string[];
  colorRoles: ColorRole[];
  slots: Slot[];
  layouts: Partial<Record<SizeKey, Layout>>;
  sample: Content;
}

export interface ResolvedContent {
  texts: Record<string, string>;
  images: Record<string, ImageValue>;
  colors: Partial<Record<ColorRole, string>>;
}

export function contentForSize(content: Content, size: SizeKey): ResolvedContent {
  return {
    texts: { ...content.texts, ...(content.textOverrides?.[size] ?? {}) },
    images: content.images,
    colors: content.colors,
  };
}
