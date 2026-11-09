import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  blankTemplate,
  hasErrors,
  lintTemplate,
  validateTemplate,
  type LintIssue,
  type Template,
} from '../../../../shared/src/index.js';
import { isAllowed } from '../../authz/authorize.js';
import { HttpError } from '../../core/http-error.js';
import { isId, newId } from '../../core/ids.js';
import { IMAGE_TYPES, MAX_SAMPLE_IMAGE_BYTES, uploadUrl } from '../../core/storage.js';
import { recordAudit } from '../../data/audit.js';
import { getSettings, safeZoneOf } from '../../data/settings.js';
import {
  createTemplate,
  getDraft,
  getTemplateMeta,
  getVersion,
  listTemplates,
  listVersions,
  publishVersion,
  saveDraft,
  type TemplateMeta,
  type TemplateStatus,
} from '../../data/templates.js';
import type { AppEnv } from '../auth.js';
import { permitOrg } from '../permit.js';

export const templateRoutes = new Hono<AppEnv>();

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  channel: z.enum(['display', 'meta', 'both']),
});
const saveSchema = z.object({ revision: z.number().int().min(1), template: z.unknown() });
const publishSchema = z.object({
  revision: z.number().int().min(1),
  report: z.object({
    issues: z.array(
      z.object({ code: z.string(), severity: z.enum(['error', 'warning']), message: z.string() }),
    ),
  }),
});
const uploadSchema = z.object({
  contentType: z.enum(Object.keys(IMAGE_TYPES) as Array<keyof typeof IMAGE_TYPES>),
  size: z.number().int().min(1).max(MAX_SAMPLE_IMAGE_BYTES),
});

async function readableTemplate(context: Context<AppEnv>): Promise<TemplateMeta> {
  const templateId = context.req.param('id') ?? '';
  const meta = isId(templateId) ? await getTemplateMeta(templateId) : undefined;
  const allowed =
    meta &&
    (await isAllowed(context.get('principal'), {
      action: 'template:read',
      resource: { type: 'Template', id: templateId },
    }));
  if (!meta || !allowed) {
    throw new HttpError(404, 'not_found', 'Template not found');
  }
  return meta;
}

function checkedTemplate(value: unknown, templateId: string): Template {
  const issues = validateTemplate(value);
  if (issues.length) {
    throw new HttpError(400, 'bad_request', `${issues[0].path}: ${issues[0].message}`, issues);
  }
  return { ...(value as Template), id: templateId, version: 0 };
}

templateRoutes.get('/', async (context) => {
  await permitOrg(context, 'template:read');
  const status = context.req.query('status');
  const statuses: TemplateStatus[] =
    status === 'draft' || status === 'published' ? [status] : ['draft', 'published'];
  const lists = await Promise.all(statuses.map((item) => listTemplates(item)));
  return context.json({ templates: lists.flat() });
});

templateRoutes.post('/', async (context) => {
  await permitOrg(context, 'template:create');
  const input = createSchema.parse(await context.req.json());
  const template = blankTemplate(newId(), input.name, input.channel);
  const meta = await createTemplate(template, context.get('principal').userId);
  await recordAudit(context.get('principal').userId, 'template:create', `TPL#${meta.templateId}`);
  return context.json({ meta, template }, 201);
});

templateRoutes.get('/:id', async (context) => {
  const meta = await readableTemplate(context);
  const [template, settings] = await Promise.all([getDraft(meta.templateId), getSettings()]);
  return context.json({ meta, template, safeZone: safeZoneOf(settings) });
});

templateRoutes.put('/:id', async (context) => {
  const meta = await readableTemplate(context);
  await permitOrg(context, 'template:create');
  const input = saveSchema.parse(await context.req.json());
  const template = checkedTemplate(input.template, meta.templateId);
  const next = await saveDraft(meta, template, input.revision, context.get('principal').userId);
  return context.json({ meta: next });
});

templateRoutes.post('/:id/publish', async (context) => {
  const meta = await readableTemplate(context);
  const allowed = await isAllowed(context.get('principal'), {
    action: 'template:publish',
    resource: { type: 'Template', id: meta.templateId },
  });
  if (!allowed) {
    throw new HttpError(403, 'forbidden', 'You do not have permission to publish templates');
  }
  const input = publishSchema.parse(await context.req.json());
  if (input.revision !== meta.revision) {
    throw new HttpError(409, 'conflict', 'Save the latest changes, then run lint again');
  }
  if (meta.publishedRevision === meta.revision) {
    throw new HttpError(409, 'conflict', `Nothing changed since version ${meta.latestVersion}`);
  }
  if (hasErrors(input.report.issues as LintIssue[])) {
    throw new HttpError(400, 'lint_failed', 'Fix the lint errors before publishing');
  }
  const [template, settings] = await Promise.all([getDraft(meta.templateId), getSettings()]);
  const issues = lintTemplate(template, { safeZone: safeZoneOf(settings) });
  if (hasErrors(issues)) {
    throw new HttpError(400, 'lint_failed', 'Fix the lint errors before publishing', issues);
  }
  const next = await publishVersion(meta, template, context.get('principal').userId);
  await recordAudit(context.get('principal').userId, 'template:publish', `TPL#${meta.templateId}`, {
    version: next.latestVersion,
    warnings: input.report.issues.length,
  });
  return context.json({ meta: next });
});

templateRoutes.get('/:id/versions', async (context) => {
  const meta = await readableTemplate(context);
  return context.json({ versions: await listVersions(meta.templateId) });
});

templateRoutes.get('/:id/versions/:version', async (context) => {
  const meta = await readableTemplate(context);
  const version = Number(context.req.param('version'));
  if (!Number.isInteger(version) || version < 1 || version > meta.latestVersion) {
    throw new HttpError(404, 'not_found', 'Version not found');
  }
  return context.json({ template: await getVersion(meta.templateId, version) });
});

templateRoutes.post('/:id/asset-upload-url', async (context) => {
  const meta = await readableTemplate(context);
  await permitOrg(context, 'template:create');
  const { contentType, size } = uploadSchema.parse(await context.req.json());
  const key = `template-assets/${meta.templateId}/${newId()}.${IMAGE_TYPES[contentType]}`;
  return context.json({ key, url: await uploadUrl(key, contentType, size) });
});
