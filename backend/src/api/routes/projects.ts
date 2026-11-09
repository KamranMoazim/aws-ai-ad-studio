import { Hono } from 'hono';
import {
  checkContent,
  CONFIRM_PLACEHOLDER,
  hasErrors,
  sizesForChannel,
  type Template,
} from '../../../../shared/src/index.js';
import { allowedMany } from '../../authz/authorize.js';
import { HttpError } from '../../core/http-error.js';
import { isId, newId } from '../../core/ids.js';
import { exportPrefix } from '../../core/keys.js';
import {
  projectCreateSchema,
  projectUpdateSchema,
  type BrandKit,
  type Client,
  type ExportRecord,
  type Project,
  type ProjectValues,
  type TaskType,
  TASK_TYPES,
} from '../../core/schemas.js';
import { escapeHtml, sendEmail } from '../../core/email.js';
import { stripe, type PaymentMetadata } from '../../core/stripe.js';
import { getClient } from '../../data/clients.js';
import { createDownloadToken, TOKEN_DAYS } from '../../data/download-tokens.js';
import { effectivePrice } from '../../data/pricing.js';
import { createTransaction, listClientTransactions } from '../../data/transactions.js';
import { getUser } from '../../data/users.js';
import { startRender } from '../../export/start.js';
import { putJson, readUrl } from '../../core/storage.js';
import { listAssets } from '../../data/assets.js';
import { recordAudit } from '../../data/audit.js';
import { getBrandKit } from '../../data/brand-kits.js';
import { createExport, getExport, listExports } from '../../data/exports.js';
import { createProject, listProjects, saveProject } from '../../data/projects.js';
import { getSettings, safeZoneOf } from '../../data/settings.js';
import {
  getTemplateMeta,
  getVersion,
  listTemplates,
  type TemplateMeta,
} from '../../data/templates.js';
import { snapshotKeyFor, type ExportSnapshot } from '../../export/snapshot.js';
import type { AppEnv } from '../auth.js';
import { permittedClient, permittedProject } from '../permit.js';

export const clientProjectRoutes = new Hono<AppEnv>();
export const projectRoutes = new Hono<AppEnv>();

const enabledFor = (client: Client, meta: TemplateMeta) =>
  meta.status === 'published' &&
  (!client.templateIds || client.templateIds.includes(meta.templateId));

async function enabledTemplate(client: Client, templateId: string): Promise<Template> {
  const meta = isId(templateId) ? await getTemplateMeta(templateId) : undefined;
  if (!meta || !enabledFor(client, meta)) {
    throw new HttpError(404, 'not_found', 'Template not found');
  }
  return getVersion(meta.templateId, meta.latestVersion);
}

async function initialValues(
  template: Template,
  clientId: string,
  kit?: BrandKit,
): Promise<ProjectValues> {
  const assets = new Map((await listAssets(clientId)).map((asset) => [asset.assetId, asset]));
  const fromKit: Record<string, string | undefined> = {
    cta: kit?.ctas[0],
    offer: kit?.offers[0]?.text,
  };
  const texts: Record<string, string> = {};
  const images: ProjectValues['images'] = {};
  const photos = [...(kit?.photoIds ?? [])];
  for (const slot of template.slots) {
    if (slot.kind === 'text') {
      texts[slot.key] = fromKit[slot.key] ?? CONFIRM_PLACEHOLDER;
      continue;
    }
    const assetId = slot.key === 'logo' ? (kit?.logoLightId ?? kit?.logoDarkId) : photos.shift();
    const asset = assetId ? assets.get(assetId) : undefined;
    if (asset?.key) {
      images[slot.key] = { src: asset.key, focalX: asset.focalX, focalY: asset.focalY };
    }
  }
  return { texts, images, colors: { ...template.sample.colors, ...(kit?.colors ?? {}) } };
}

async function imageUrls(values: ProjectValues): Promise<Record<string, string>> {
  const sources = [...new Set(Object.values(values.images).map((image) => image.src))];
  return Object.fromEntries(
    await Promise.all(sources.map(async (src) => [src, await readUrl(src, { preview: true })])),
  );
}

async function checkImages(clientId: string, values: ProjectValues): Promise<void> {
  const keys = new Set(
    (await listAssets(clientId))
      .filter((asset) => asset.status === 'ready')
      .map((asset) => asset.key),
  );
  for (const [slot, image] of Object.entries(values.images)) {
    if (!keys.has(image.src)) {
      throw new HttpError(400, 'bad_request', `images.${slot}: not an asset of this client`);
    }
  }
}

clientProjectRoutes.get('/:id/templates', async (context) => {
  const client = await permittedClient(context, 'project:create');
  const templates = (await listTemplates('published')).filter((meta) => enabledFor(client, meta));
  return context.json({ templates });
});

clientProjectRoutes.get('/:id/templates/:templateId', async (context) => {
  const client = await permittedClient(context, 'project:create');
  return context.json({ template: await enabledTemplate(client, context.req.param('templateId')) });
});

clientProjectRoutes.get('/:id/projects', async (context) => {
  const client = await permittedClient(context, 'client:read');
  const projects = await listProjects(client.clientId);
  const decisions = await allowedMany(
    context.get('principal'),
    projects.map((project) => ({
      action: 'project:read',
      resource: { type: 'Project', id: project.projectId, clientId: project.clientId },
    })),
  );
  return context.json({ projects: projects.filter((_, index) => decisions[index]) });
});

clientProjectRoutes.post('/:id/projects', async (context) => {
  const client = await permittedClient(context, 'project:create');
  const input = projectCreateSchema.parse(await context.req.json());
  const template = await enabledTemplate(client, input.templateId);
  const kit = input.brandKitId ? await getBrandKit(client.clientId, input.brandKitId) : undefined;
  if (input.brandKitId && !kit) {
    throw new HttpError(400, 'bad_request', 'brandKitId: brand kit not found');
  }
  const now = new Date().toISOString();
  const project: Project = {
    projectId: newId(),
    clientId: client.clientId,
    name: input.name,
    templateId: template.id,
    templateVersion: template.version,
    brandKitId: kit?.kitId,
    values: await initialValues(template, client.clientId, kit),
    revision: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: context.get('principal').userId,
  };
  await createProject(project);
  await recordAudit(
    context.get('principal').userId,
    'project:create',
    `PROJ#${project.projectId}`,
    {
      clientId: client.clientId,
      templateId: template.id,
      templateVersion: template.version,
    },
  );
  return context.json(project, 201);
});

projectRoutes.get('/:id', async (context) => {
  const project = await permittedProject(context, 'project:read');
  const [template, settings, urls, client, transactions] = await Promise.all([
    getVersion(project.templateId, project.templateVersion),
    getSettings(),
    imageUrls(project.values),
    getClient(project.clientId),
    listClientTransactions(project.clientId),
  ]);
  const paid = transactions.some(
    (txn) =>
      txn.projectId === project.projectId && (txn.status === 'paid' || txn.status === 'exempt'),
  );
  return context.json({
    project,
    template,
    safeZone: safeZoneOf(settings),
    imageUrls: urls,
    payment: { required: Boolean(client?.paymentRequired), paid },
  });
});

projectRoutes.put('/:id', async (context) => {
  const project = await permittedProject(context, 'project:edit');
  const input = projectUpdateSchema.parse(await context.req.json());
  if (input.values) {
    await checkImages(project.clientId, input.values);
  }
  const next: Project = {
    ...project,
    name: input.name ?? project.name,
    values: input.values ?? project.values,
    revision: project.revision + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: context.get('principal').userId,
  };
  if (input.revision !== project.revision) {
    throw new HttpError(409, 'conflict', 'This project was saved elsewhere; reload it first');
  }
  await saveProject(next, project.revision);
  return context.json(next);
});

projectRoutes.post('/:id/duplicate', async (context) => {
  const project = await permittedProject(context, 'project:read');
  await permittedClient(context, 'project:create', project.clientId);
  const now = new Date().toISOString();
  const copy: Project = {
    ...project,
    projectId: newId(),
    name: `Copy of ${project.name}`.slice(0, 120),
    revision: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: context.get('principal').userId,
  };
  await createProject(copy);
  await recordAudit(
    context.get('principal').userId,
    'project:duplicate',
    `PROJ#${copy.projectId}`,
    {
      from: project.projectId,
    },
  );
  return context.json(copy, 201);
});

projectRoutes.post('/:id/export', async (context) => {
  const project = await permittedProject(context, 'project:export');
  const [template, settings, exports, client] = await Promise.all([
    getVersion(project.templateId, project.templateVersion),
    getSettings(),
    listExports(project.projectId),
    getClient(project.clientId),
  ]);
  if (exports.some((record) => record.status === 'rendering')) {
    throw new HttpError(409, 'conflict', 'An export of this project is already running');
  }
  const safeZone = safeZoneOf(settings);
  const issues = checkContent(template, project.values, { safeZone });
  if (hasErrors(issues)) {
    throw new HttpError(400, 'not_ready', 'Fix the highlighted problems before exporting', issues);
  }
  const taskType: TaskType = exports.some((record) => record.status === 'ready')
    ? 're-export'
    : 'template-set';
  const price = client!.paymentRequired
    ? await effectivePrice(project.clientId, taskType)
    : undefined;
  if (client!.paymentRequired && !price) {
    throw new HttpError(
      400,
      'no_price',
      `No price is set for "${TASK_TYPES[taskType]}"; ask the agency to set one`,
    );
  }
  const exportId = newId();
  const createdAt = new Date().toISOString();
  const prefix = exportPrefix(project.clientId, project.projectId, exportId);
  const sizes = sizesForChannel(template.channel);
  const snapshotKey = snapshotKeyFor(prefix);
  const snapshot: ExportSnapshot = {
    exportId,
    projectId: project.projectId,
    clientId: project.clientId,
    projectName: project.name,
    createdAt,
    template,
    content: project.values,
    safeZone,
    sizes,
  };
  await putJson(snapshotKey, snapshot);
  const record: ExportRecord = {
    exportId,
    projectId: project.projectId,
    clientId: project.clientId,
    status: price ? 'awaiting_payment' : 'rendering',
    templateId: template.id,
    templateVersion: template.version,
    revision: project.revision,
    taskType,
    amountCents: price?.amountCents ?? 0,
    currency: price?.currency,
    snapshotKey,
    sizes,
    createdAt,
    createdBy: context.get('principal').userId,
  };
  const userId = context.get('principal').userId;
  if (!price) {
    await createExport(record);
    await createTransaction({
      txnId: exportId,
      clientId: project.clientId,
      projectId: project.projectId,
      exportId,
      taskType,
      amountCents: 0,
      currency: 'usd',
      status: 'exempt',
      createdAt,
    });
    await startRender(record);
    await recordAudit(userId, 'project:export', `PROJ#${project.projectId}`, {
      exportId,
      exempt: true,
    });
    return context.json({ exportId }, 202);
  }
  const metadata: PaymentMetadata = {
    exportId,
    projectId: project.projectId,
    clientId: project.clientId,
    exportCreatedAt: createdAt,
    taskType,
  };
  const projectUrl = `${process.env.SITE_URL}/#/projects/${project.projectId}`;
  const session = await (
    await stripe()
  ).checkout.sessions.create(
    {
      mode: 'payment',
      client_reference_id: exportId,
      metadata,
      payment_intent_data: { metadata },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: price.currency,
            unit_amount: price.amountCents,
            product_data: { name: `${TASK_TYPES[taskType]}: ${project.name}`.slice(0, 250) },
          },
        },
      ],
      success_url: `${projectUrl}?paid=${exportId}`,
      cancel_url: projectUrl,
    },
    { idempotencyKey: `checkout-${exportId}` },
  );
  await createExport({ ...record, checkoutUrl: session.url ?? undefined });
  await recordAudit(userId, 'project:checkout', `PROJ#${project.projectId}`, {
    exportId,
    amountCents: price.amountCents,
    currency: price.currency,
  });
  return context.json({ exportId, checkoutUrl: session.url }, 202);
});

projectRoutes.post('/:id/exports/:exportId/email', async (context) => {
  const project = await permittedProject(context, 'project:download');
  const exportId = context.req.param('exportId');
  const record = isId(exportId) ? await getExport(project.projectId, exportId) : undefined;
  if (!record || record.status !== 'ready' || record.revoked) {
    throw new HttpError(404, 'not_found', 'Export not found or not ready');
  }
  const userId = context.get('principal').userId;
  const [user, settings] = await Promise.all([getUser(userId), getSettings()]);
  const token = await createDownloadToken({
    exportId,
    projectId: project.projectId,
    clientId: project.clientId,
    createdBy: userId,
  });
  const link = `${process.env.SITE_URL}/d/${token}`;
  const name = escapeHtml(project.name);
  await sendEmail({
    to: user!.email,
    fromName: settings.appName,
    subject: `Your ads are ready: ${project.name}`,
    text: `Your ad set "${project.name}" is ready. Download it here (the link works for ${TOKEN_DAYS} days): ${link}`,
    html: `<p>Your ad set <strong>${name}</strong> is ready.</p><p><a href="${link}">Download the ZIP</a></p><p>The link works for ${TOKEN_DAYS} days.</p>`,
  });
  await recordAudit(userId, 'export:email', `PROJ#${project.projectId}`, { exportId });
  return context.json({ sentTo: user!.email });
});

projectRoutes.get('/:id/exports', async (context) => {
  const project = await permittedProject(context, 'project:read');
  return context.json({ exports: await listExports(project.projectId) });
});

projectRoutes.get('/:id/exports/:exportId', async (context) => {
  const project = await permittedProject(context, 'project:download');
  const exportId = context.req.param('exportId');
  const record = isId(exportId) ? await getExport(project.projectId, exportId) : undefined;
  if (!record) {
    throw new HttpError(404, 'not_found', 'Export not found');
  }
  const downloadUrl =
    record.status === 'ready' && record.zipKey && !record.revoked
      ? await readUrl(record.zipKey, { downloadName: record.zipKey.split('/').pop() })
      : undefined;
  return context.json({ export: record, downloadUrl });
});
