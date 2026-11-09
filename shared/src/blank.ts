import { SIZES, sizesForChannel, type SizeKey, type TemplateChannel } from './sizes.js';
import type { Content, Layout, Slot, Template } from './types.js';

export const SAMPLE_COLORS = {
  primary: '#1f3a5f',
  secondary: '#3d6b9e',
  accent: '#f2a541',
  text: '#ffffff',
  background: '#f7f5f0',
};

const DEFAULT_SLOTS: Slot[] = [
  { key: 'logo', label: 'Logo', kind: 'image', required: true },
  {
    key: 'headline',
    label: 'Headline',
    kind: 'text',
    required: true,
    limits: { maxChars: {}, maxLines: 3 },
  },
  {
    key: 'cta',
    label: 'Call to action',
    kind: 'text',
    required: true,
    limits: { maxChars: {}, maxLines: 1 },
  },
];

function blankLayout(size: SizeKey): Layout {
  const { width, height } = SIZES[size];
  return {
    width,
    height,
    elements: [
      {
        id: 'background',
        name: 'Background',
        type: 'rect',
        frame: { x: 0, y: 0, w: width, h: height },
        style: { fill: 'color:background' },
        locked: true,
      },
    ],
  };
}

export function blankTemplate(id: string, name: string, channel: TemplateChannel): Template {
  const sample: Content = {
    texts: { headline: 'Your headline here', cta: 'Learn more' },
    images: {},
    colors: { ...SAMPLE_COLORS },
  };
  return {
    id,
    version: 0,
    name,
    channel,
    tags: [],
    colorRoles: ['primary', 'accent', 'text', 'background'],
    slots: DEFAULT_SLOTS,
    layouts: Object.fromEntries(sizesForChannel(channel).map((size) => [size, blankLayout(size)])),
    sample,
  };
}
