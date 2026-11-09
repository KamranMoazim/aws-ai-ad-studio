import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { HttpError } from '../../core/http-error.js';
import { isId, newId } from '../../core/ids.js';
import type { Project } from '../../core/schemas.js';
import { getAsset, listAssets } from '../../data/assets.js';
import { createImageJob, getImageJob, type ImageJob } from '../../data/image-jobs.js';
import { recordAudit } from '../../data/audit.js';
import { getBrandKit } from '../../data/brand-kits.js';
import {
  createGeneration,
  getGeneration,
  listGenerations,
  type Generation,
} from '../../data/generations.js';
import { createProject } from '../../data/projects.js';
import { getSettings, limitsOf } from '../../data/settings.js';
import { getTemplateMeta } from '../../data/templates.js';
import type { AppEnv } from '../auth.js';
import { permittedClient } from '../permit.js';
import { withUrl } from './assets.js';

export const generationRoutes = new Hono<AppEnv>();
const lambdaClient = new LambdaClient({});
const GENERATION_ID = /^[a-f0-9]{16}$/;
const ASPECT = z.enum(['9:16', '4:5', '1:1', '16:9']);

const generateSchema = z.object({
  brandKitId: z.string().min(1).max(64),
  channel: z.enum(['display', 'meta', 'both']).default('both'),
  serviceName: z.string().max(120).optional(),
  offerText: z.string().max(200).optional(),
  notes: z.string().max(400).optional(),
  quality: z.enum(['final', 'draft']).default('final'),
});

const today = () => new Date().toISOString().slice(0, 10);

async function startImageEdit(
  context: Context<AppEnv>,
  clientId: string,
  op: ImageJob['op'],
  payload: Record<string, unknown>,
): Promise<ImageJob> {
  const job: ImageJob = {
    jobId: newId(),
    clientId,
    op,
    status: 'running',
    createdAt: new Date().toISOString(),
    createdBy: context.get('principal').userId,
  };
  await createImageJob(job);
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.IMAGE_EDIT_FUNCTION!,
      InvocationType: 'Event',
      Payload: JSON.stringify({
        op,
        clientId,
        userId: job.createdBy,
        jobId: job.jobId,
        ...payload,
      }),
    }),
  );
  await recordAudit(job.createdBy, `image:${op}`, `CLIENT#${clientId}`, {
    jobId: job.jobId,
    ...payload,
  });
  return job;
}

async function checkImageLimit(clientId: string): Promise<void> {
  const edits = (await listAssets(clientId)).filter(
    (asset) => asset.source?.startsWith('ai-') && asset.createdAt.startsWith(today()),
  );
  const { imageEditsPerDay } = limitsOf(await getSettings());
  if (edits.length >= imageEditsPerDay) {
    throw new HttpError(429, 'limit', `Up to ${imageEditsPerDay} AI image edits a day per client`);
  }
}

generationRoutes.post('/:id/generations', async (context) => {
  const client = await permittedClient(context, 'project:create');
  const brief = generateSchema.parse(await context.req.json());
  const kit = await getBrandKit(client.clientId, brief.brandKitId);
  if (!kit) {
    throw new HttpError(400, 'bad_request', 'brandKitId: brand kit not found');
  }
  if (brief.offerText && !kit.offers.some((offer) => offer.text === brief.offerText)) {
    throw new HttpError(
      400,
      'bad_request',
      'offerText: only offers saved in the brand kit can be used',
    );
  }
  if (brief.serviceName && !kit.services.some((service) => service.name === brief.serviceName)) {
    throw new HttpError(400, 'bad_request', 'serviceName: not a service of this brand kit');
  }
  const recent = await listGenerations(client.clientId);
  const { generationsPerDay } = limitsOf(await getSettings());
  if (recent.filter((item) => item.createdAt.startsWith(today())).length >= generationsPerDay) {
    throw new HttpError(429, 'limit', `Up to ${generationsPerDay} AI generations a day per client`);
  }
  const now = new Date().toISOString();
  const generation: Generation = {
    generationId: newId(),
    clientId: client.clientId,
    status: 'queued',
    brief,
    createdAt: now,
    createdBy: context.get('principal').userId,
    updatedAt: now,
  };
  await createGeneration(generation);
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.GENERATE_FUNCTION!,
      InvocationType: 'Event',
      Payload: JSON.stringify({ clientId: client.clientId, generationId: generation.generationId }),
    }),
  );
  await recordAudit(generation.createdBy, 'generation:start', `CLIENT#${client.clientId}`, {
    generationId: generation.generationId,
    brandKitId: brief.brandKitId,
  });
  return context.json(generation, 202);
});

generationRoutes.get('/:id/generations/:generationId', async (context) => {
  const client = await permittedClient(context, 'client:read');
  const generationId = context.req.param('generationId');
  const generation = GENERATION_ID.test(generationId)
    ? await getGeneration(client.clientId, generationId)
    : undefined;
  if (!generation) {
    throw new HttpError(404, 'not_found', 'Generation not found');
  }
  return context.json(generation);
});

generationRoutes.post('/:id/generations/:generationId/variants/:index/project', async (context) => {
  const client = await permittedClient(context, 'project:create');
  const generationId = context.req.param('generationId');
  const generation = GENERATION_ID.test(generationId)
    ? await getGeneration(client.clientId, generationId)
    : undefined;
  const variant = generation?.variants?.[Number(context.req.param('index'))];
  if (!generation || !variant) {
    throw new HttpError(404, 'not_found', 'Variant not found');
  }
  const meta = await getTemplateMeta(variant.templateId);
  if (!meta || (client.templateIds && !client.templateIds.includes(variant.templateId))) {
    throw new HttpError(409, 'conflict', 'This template is no longer available');
  }
  const { name } = z
    .object({ name: z.string().trim().min(1).max(120) })
    .parse(await context.req.json());
  const now = new Date().toISOString();
  const project: Project = {
    projectId: newId(),
    clientId: client.clientId,
    name,
    templateId: variant.templateId,
    templateVersion: variant.templateVersion,
    brandKitId: generation.brief.brandKitId,
    origin: 'ai',
    values: variant.values as Project['values'],
    revision: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: context.get('principal').userId,
  };
  await createProject(project);
  await recordAudit(project.updatedBy, 'project:create', `PROJ#${project.projectId}`, {
    generationId,
    variant: Number(context.req.param('index')),
  });
  return context.json(project, 201);
});

generationRoutes.get('/:id/images/jobs/:jobId', async (context) => {
  const client = await permittedClient(context, 'client:read');
  const jobId = context.req.param('jobId');
  const job = GENERATION_ID.test(jobId) ? await getImageJob(client.clientId, jobId) : undefined;
  if (!job) {
    throw new HttpError(404, 'not_found', 'Image job not found');
  }
  const asset = job.assetId ? await getAsset(client.clientId, job.assetId) : undefined;
  return context.json({ job, asset: asset ? await withUrl(asset) : undefined });
});

generationRoutes.post('/:id/images/:assetId/:op', async (context) => {
  const client = await permittedClient(context, 'brandkit:edit');
  const op = context.req.param('op');
  if (op !== 'remove-bg' && op !== 'outpaint') {
    throw new HttpError(404, 'not_found', 'Unknown image operation');
  }
  await checkImageLimit(client.clientId);
  const assetId = context.req.param('assetId');
  const source = isId(assetId) ? await getAsset(client.clientId, assetId) : undefined;
  if (!source || source.status !== 'ready') {
    throw new HttpError(404, 'not_found', 'Image not found');
  }
  const body =
    op === 'outpaint' ? z.object({ aspect: ASPECT }).parse(await context.req.json()) : {};
  const job = await startImageEdit(context, client.clientId, op, { assetId, ...body });
  return context.json(job, 202);
});

generationRoutes.post('/:id/images/background', async (context) => {
  const client = await permittedClient(context, 'brandkit:edit');
  await checkImageLimit(client.clientId);
  const input = z
    .object({
      brandKitId: z.string().min(1).max(64),
      style: z.string().trim().min(3).max(200),
      aspect: ASPECT,
    })
    .parse(await context.req.json());
  if (!(await getBrandKit(client.clientId, input.brandKitId))) {
    throw new HttpError(400, 'bad_request', 'brandKitId: brand kit not found');
  }
  const job = await startImageEdit(context, client.clientId, 'background', input);
  return context.json(job, 202);
});
