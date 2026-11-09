export type Channel = 'display' | 'meta';
export type TemplateChannel = Channel | 'both';

export const SIZES = {
  '300x250': { width: 300, height: 250, channel: 'display' },
  '728x90': { width: 728, height: 90, channel: 'display' },
  '300x600': { width: 300, height: 600, channel: 'display' },
  '336x280': { width: 336, height: 280, channel: 'display' },
  '320x50': { width: 320, height: 50, channel: 'display' },
  '1080x1080': { width: 1080, height: 1080, channel: 'meta' },
  '1080x1350': { width: 1080, height: 1350, channel: 'meta' },
  '1080x1920': { width: 1080, height: 1920, channel: 'meta' },
} as const satisfies Record<string, { width: number; height: number; channel: Channel }>;

export type SizeKey = keyof typeof SIZES;
export const SIZE_KEYS = Object.keys(SIZES) as SizeKey[];

export const DISPLAY_MAX_BYTES = 150 * 1024;
export const STORY_SIZE: SizeKey = '1080x1920';

export const sizesForChannel = (channel: TemplateChannel): SizeKey[] =>
  SIZE_KEYS.filter((size) => channel === 'both' || SIZES[size].channel === channel);

export const isSizeKey = (value: string): value is SizeKey => value in SIZES;
