import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import { CONFIRM_PLACEHOLDER, sizesForChannel, type Template } from '../../../shared/src/index.js';
import { claude, claudeModel, supportsEffort } from '../core/claude.js';
import type { BrandKit } from '../core/schemas.js';
import type { GenerationBrief } from '../data/generations.js';

const MAX_TOKENS = 16000;

export const copySchema = z.object({
  slots: z.array(
    z.object({
      key: z.string(),
      text: z.string(),
      shorter: z.array(z.object({ size: z.string(), text: z.string() })),
    }),
  ),
});
export type WrittenCopy = z.infer<typeof copySchema>;

const SYSTEM = [
  'You write the words for a display and social ad that fills a fixed, professionally designed template. The layout is fixed; you only supply text for each slot.',
  'Use only the facts in <brand_kit>. Never state prices, percentages, discounts, free items, deadlines, guarantees, awards, rankings or superlatives unless the exact claim is in an offer in <brand_kit>.',
  `If a slot needs a fact you do not have, write ${CONFIRM_PLACEHOLDER} instead of guessing.`,
  'Respect every character limit. Give a shorter version for any size whose limit the main text exceeds.',
  "Write in the brand's voice: plain, specific and confident. No hashtags or emoji.",
].join('\n');

export function factsOf(kit: BrandKit, brief: GenerationBrief): string[] {
  return [
    kit.name,
    ...kit.services.map((service) => `${service.name} ${service.description ?? ''}`),
    ...(brief.offerText ? [brief.offerText] : []),
    ...kit.ctas,
  ];
}

function slotSpec(template: Template): string {
  const sizes = sizesForChannel(template.channel);
  return template.slots
    .filter((slot) => slot.kind === 'text')
    .map((slot) => {
      const limits = sizes
        .map((size) =>
          slot.limits?.maxChars[size] ? `${size}: ${slot.limits.maxChars[size]}` : undefined,
        )
        .filter(Boolean)
        .join(', ');
      return `- ${slot.key} ("${slot.label}", ${slot.required ? 'required' : 'optional'}, max ${slot.limits?.maxLines ?? 2} lines; max characters per size: ${limits || 'none'})`;
    })
    .join('\n');
}

export async function writeCopy(
  template: Template,
  kit: BrandKit,
  brief: GenerationBrief,
  feedback?: string,
): Promise<WrittenCopy> {
  const brandKit = {
    business: kit.name,
    services: kit.services,
    offer: brief.offerText ?? null,
    callsToAction: kit.ctas,
  };
  const request = [
    `<brand_kit>\n${JSON.stringify(brandKit, null, 2)}\n</brand_kit>`,
    `<brief>\nFocus: ${brief.serviceName ?? 'the business as a whole'}\nNotes from the client: ${brief.notes ?? 'none'}\n</brief>`,
    `<template name="${template.name}" tags="${template.tags.join(', ')}">\nText slots:\n${slotSpec(template)}\n</template>`,
    'Return one entry per text slot, using the slot keys exactly.',
    ...(feedback ? [`Your previous attempt had these problems; fix them:\n${feedback}`] : []),
  ].join('\n\n');
  const client = await claude();
  const model = claudeModel(brief.quality === 'draft' ? 'draft' : 'copy');
  const response = await client.messages.parse({
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    messages: [{ role: 'user', content: request }],
    output_config: {
      format: zodOutputFormat(copySchema),
      ...(supportsEffort(model) ? { effort: 'medium' as const } : {}),
    },
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(`no copy returned (${response.stop_reason})`);
  }
  return response.parsed_output;
}
