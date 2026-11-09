import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { Content, LintIssue, SafeZone, Template } from '../../../shared/src/index.js';
import { listAssets } from '../data/assets.js';
import { getBrandKit } from '../data/brand-kits.js';
import { getClient } from '../data/clients.js';
import { getGeneration, updateGeneration, type Variant } from '../data/generations.js';
import { getSettings, safeZoneOf } from '../data/settings.js';
import { getVersion, listTemplates } from '../data/templates.js';
import { assignColors, assignImages } from './assign.js';
import { claudeModel } from '../core/claude.js';
import { factsOf, writeCopy } from './copy.js';
import { pickTemplates } from './pick.js';
import { applyCopy, confirmProblems, describeProblems, problemsOf } from './variant.js';

const lambdaClient = new LambdaClient({});

async function checkWithFonts(
  template: Template,
  content: Content,
  safeZone: SafeZone,
): Promise<LintIssue[]> {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.RENDER_FUNCTION!,
      Payload: JSON.stringify({ mode: 'check', template, content, safeZone }),
    }),
  );
  if (response.FunctionError) {
    throw new Error(
      `fit check failed: ${new TextDecoder().decode(response.Payload).slice(0, 300)}`,
    );
  }
  return (JSON.parse(new TextDecoder().decode(response.Payload)) as { issues: LintIssue[] }).issues;
}

export async function handler(event: { clientId: string; generationId: string }) {
  const generation = await getGeneration(event.clientId, event.generationId);
  if (!generation || generation.status !== 'queued') {
    return;
  }
  try {
    const { brief } = generation;
    const [client, kit, assets, settings, metas] = await Promise.all([
      getClient(event.clientId),
      getBrandKit(event.clientId, brief.brandKitId),
      listAssets(event.clientId),
      getSettings(),
      listTemplates('published'),
    ]);
    if (!client || !kit) {
      throw new Error('brand kit not found');
    }
    const safeZone = safeZoneOf(settings);
    const enabled = metas.filter(
      (meta) => !client.templateIds || client.templateIds.includes(meta.templateId),
    );
    const templates = await Promise.all(
      enabled.map((meta) => getVersion(meta.templateId, meta.latestVersion)),
    );
    const ready = assets.filter((asset) => asset.status === 'ready');
    const photos = ready.filter(
      (asset) => asset.kind === 'photo' && kit.photoIds.includes(asset.assetId),
    );
    const picked = pickTemplates(templates, brief, {
      kit,
      photos,
      hasLogo: Boolean(kit.logoLightId || kit.logoDarkId),
    });
    if (!picked.length) {
      throw new Error('No published template fits this brand kit and channel');
    }
    await updateGeneration(event.clientId, event.generationId, {
      status: 'writing',
      model: claudeModel(brief.quality === 'draft' ? 'draft' : 'copy'),
    });
    const facts = factsOf(kit, brief);
    const variants: Variant[] = await Promise.all(
      picked.map(async (template) => {
        const colors = assignColors(template, kit);
        const base = { images: assignImages(template, kit, ready, colors), colors };
        let content = applyCopy(template, await writeCopy(template, kit, brief), base);
        let problems = problemsOf(
          template,
          content,
          await checkWithFonts(template, content, safeZone),
          facts,
        );
        if (problems.length) {
          content = applyCopy(
            template,
            await writeCopy(template, kit, brief, describeProblems(problems)),
            base,
          );
          problems = problemsOf(
            template,
            content,
            await checkWithFonts(template, content, safeZone),
            facts,
          );
        }
        const fixed = confirmProblems(content, problems);
        return {
          templateId: template.id,
          templateVersion: template.version,
          templateName: template.name,
          values: fixed.content,
          issues: problems.length ? await checkWithFonts(template, fixed.content, safeZone) : [],
          confirmed: fixed.confirmed,
        };
      }),
    );
    await updateGeneration(event.clientId, event.generationId, { status: 'ready', variants });
  } catch (error) {
    console.error(
      `generation ${event.generationId} failed: ${(error as Error).name} ${(error as Error).message}`,
    );
    const known = /No published template/.test((error as Error).message);
    await updateGeneration(event.clientId, event.generationId, {
      status: 'failed',
      error: known
        ? (error as Error).message
        : 'The ads could not be written. Try again in a moment.',
    });
  }
}
