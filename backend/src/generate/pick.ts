import { sizesForChannel, type Template } from '../../../shared/src/index.js';
import type { Asset, BrandKit } from '../core/schemas.js';
import type { GenerationBrief } from '../data/generations.js';

export const VARIANT_COUNT = 3;
const WORDS = /[a-z]+/g;

export interface PickContext {
  kit: BrandKit;
  photos: Asset[];
  hasLogo: boolean;
}

export function channelFits(template: Template, channel: GenerationBrief['channel']): boolean {
  const wanted = sizesForChannel(channel);
  const available = sizesForChannel(template.channel);
  return wanted.every((size) => available.includes(size));
}

export function fillable(template: Template, context: PickContext): boolean {
  const imageSlots = template.slots.filter((slot) => slot.required && slot.kind === 'image');
  const photoSlots = imageSlots.filter((slot) => !slot.key.includes('logo')).length;
  const needsLogo = imageSlots.some((slot) => slot.key.includes('logo'));
  return (!needsLogo || context.hasLogo) && photoSlots <= context.photos.length;
}

export function scoreTemplate(
  template: Template,
  brief: GenerationBrief,
  context: PickContext,
): number {
  const tags = template.tags.map((tag) => tag.toLowerCase());
  const words = new Set((brief.notes ?? '').toLowerCase().match(WORDS) ?? []);
  let score = tags.filter((tag) => words.has(tag)).length * 3;
  const photoLed = tags.includes('photo-led');
  if (photoLed && context.photos.length >= 2) {
    score += 2;
  }
  if (photoLed && !context.photos.length) {
    score -= 5;
  }
  if (brief.offerText && template.slots.some((slot) => slot.key === 'offer')) {
    score += 3;
  }
  if (brief.offerText && (tags.includes('promo') || tags.includes('bold'))) {
    score += 1;
  }
  score += template.colorRoles.filter((role) => context.kit.colors[role]).length * 0.5;
  return score;
}

export function pickTemplates(
  templates: Template[],
  brief: GenerationBrief,
  context: PickContext,
): Template[] {
  return templates
    .filter((template) => channelFits(template, brief.channel) && fillable(template, context))
    .map((template) => ({ template, score: scoreTemplate(template, brief, context) }))
    .sort(
      (left, right) =>
        right.score - left.score || left.template.name.localeCompare(right.template.name),
    )
    .slice(0, VARIANT_COUNT)
    .map((entry) => entry.template);
}
