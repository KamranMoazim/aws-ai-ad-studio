import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import {
  contentForSize,
  DEFAULT_SAFE_ZONE,
  SEED_TEMPLATES,
  sizesForChannel,
  type LintIssue,
  type Template,
} from '../../shared/src/index.js';
import { buildSites } from './fixtures/sites.js';
import { check, finish } from './helpers.js';
import { call, createTestUser, deleteCognitoUsers, outputs, run, token } from './live.js';

const { deletePartitions, deletePrefix } = await import('./cleanup.js');
const { claimProblems } = await import('../src/generate/claims.js');
const WAIT_MS = 8 * 60_000;
const FIT_CODES = new Set(['overflow', 'max-chars']);
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};
const s3Client = new S3Client({ region: outputs.Region });
const lambdaClient = new LambdaClient({ region: outputs.Region });

const admin = await createTestUser('gen-admin', ['super-admin']);
const partitions = [`USER#${admin.userId}`];
const prefixes = [`scan-fixtures/${run}/`];

async function poll<T>(
  read: () => Promise<{ body: any }>,
  done: (body: any) => boolean,
): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  let latest = await read();
  while (!done(latest.body) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    latest = await read();
  }
  return latest.body as T;
}

async function imageJob(adminToken: string, clientId: string, path: string, body: unknown) {
  const started = await call(adminToken, 'POST', `/clients/${clientId}/images/${path}`, body);
  if (started.status !== 202) {
    return started;
  }
  const finished = await poll<any>(
    () => call(adminToken, 'GET', `/clients/${clientId}/images/jobs/${started.body.jobId}`),
    (latest) => latest.job?.status !== 'running',
  );
  return {
    status: finished.job?.status === 'ready' ? 201 : 400,
    body: finished.asset ?? finished.job,
  };
}

async function fitIssues(template: Template, content: unknown): Promise<LintIssue[]> {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: outputs.RenderFunctionName,
      Payload: JSON.stringify({ mode: 'check', template, content, safeZone: DEFAULT_SAFE_ZONE }),
    }),
  );
  return JSON.parse(new TextDecoder().decode(response.Payload)).issues as LintIssue[];
}

try {
  const adminToken = await token(admin.email);
  const root = mkdtempSync(join(tmpdir(), 'adstudio-gen-'));
  await buildSites(root);
  for (const file of readdirSync(join(root, 'bakery'))) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: outputs.AssetsBucketName,
        Key: `scan-fixtures/${run}/bakery/${file}`,
        Body: readFileSync(join(root, 'bakery', file)),
        ContentType: TYPES[extname(file)] ?? 'application/octet-stream',
      }),
    );
  }

  const templateIds: string[] = [];
  for (const seed of SEED_TEMPLATES) {
    const created = await call(adminToken, 'POST', '/templates', {
      name: `${seed.name} ${run}`,
      channel: 'both',
    });
    const templateId = created.body.meta.templateId as string;
    templateIds.push(templateId);
    partitions.push(`TPL#${templateId}`);
    prefixes.push(`templates/${templateId}/`);
    await call(adminToken, 'PUT', `/templates/${templateId}`, {
      revision: 1,
      template: { ...seed, name: `${seed.name} ${run}` },
    });
    await call(adminToken, 'POST', `/templates/${templateId}/publish`, {
      revision: 2,
      report: { issues: [] },
    });
  }
  const client = (await call(adminToken, 'POST', '/clients', { name: `Generate ${run}` })).body;
  partitions.push(`CLIENT#${client.clientId}`);
  prefixes.push(`scans/${client.clientId}/`, `assets/${client.clientId}/`);
  await call(adminToken, 'PUT', `/clients/${client.clientId}`, { templateIds });

  const scan = await call(adminToken, 'POST', `/clients/${client.clientId}/scans`, {
    url: `${outputs.SiteUrl}/scan-fixtures/${run}/bakery/index.html`,
    confirmOwnership: true,
  });
  const scanned = await poll<any>(
    () => call(adminToken, 'GET', `/clients/${client.clientId}/scans/${scan.body.scanId}`),
    (body) => ['ready', 'failed'].includes(body.scan?.status),
  );
  check('the website scan finishes', scanned.scan?.status === 'ready', scanned.scan);
  const draft = scanned.result.draft;
  check(
    'the scan suggests photos for the brand kit',
    draft.photoIndexes.length > 0,
    scanned.result.photos.map((photo: any) => ({
      index: photo.index,
      label: photo.label,
      quality: photo.quality,
    })),
  );
  const kit = (
    await call(
      adminToken,
      'POST',
      `/clients/${client.clientId}/scans/${scan.body.scanId}/brand-kit`,
      {
        name: draft.name,
        logoIndex: draft.logoIndex,
        photoIndexes: draft.photoIndexes,
        colors: Object.fromEntries(Object.entries(draft.colors).filter(([, value]) => value)),
        services: draft.services,
        offerQuotes: draft.offers.map((offer: any) => offer.quote),
        ctas: draft.ctas.length ? draft.ctas : ['Book now'],
      },
    )
  ).body;
  check('the scanned brand kit is saved', Boolean(kit.kitId), kit);

  const started = await call(adminToken, 'POST', `/clients/${client.clientId}/generations`, {
    brandKitId: kit.kitId,
    channel: 'both',
    offerText: kit.offers[0]?.text,
    serviceName: kit.services[0]?.name,
    notes: 'warm and friendly',
  });
  check('generation starts', started.status === 202, started.body);
  const generation = await poll<any>(
    () =>
      call(
        adminToken,
        'GET',
        `/clients/${client.clientId}/generations/${started.body.generationId}`,
      ),
    (body) => ['ready', 'failed'].includes(body.status),
  );
  check(
    'generation finishes with 3 variants',
    generation.status === 'ready' && generation.variants?.length === 3,
    generation,
  );

  const facts = [
    kit.name,
    ...kit.services.map((service: any) => `${service.name} ${service.description ?? ''}`),
    kit.offers[0]?.text ?? '',
    ...kit.ctas,
  ];
  for (const [index, variant] of (generation.variants ?? []).entries()) {
    const project = await call(
      adminToken,
      'POST',
      `/clients/${client.clientId}/generations/${started.body.generationId}/variants/${index}/project`,
      {
        name: `Variant ${index + 1}`,
      },
    );
    partitions.push(`PROJ#${project.body.projectId}`);
    const opened = await call(adminToken, 'GET', `/projects/${project.body.projectId}`);
    check(
      `variant ${index + 1} (${variant.templateName}) opens in the editor`,
      opened.status === 200 && opened.body.project.origin === 'ai',
    );
    const template: Template = opened.body.template;
    const issues = await fitIssues(template, opened.body.project.values);
    const overflow = issues.filter(
      (issue) => FIT_CODES.has(issue.code) && issue.severity === 'error',
    );
    check(`variant ${index + 1}: no text overflows at any size`, overflow.length === 0, overflow);
    const unsourced = sizesForChannel(template.channel).flatMap((size) =>
      Object.entries(contentForSize(opened.body.project.values, size).texts).flatMap(
        ([slot, text]) =>
          claimProblems(text as string, facts).map(
            (problem) => `${size} ${slot}: "${text}" (${problem.value})`,
          ),
      ),
    );
    check(`variant ${index + 1}: no unsourced claims`, unsourced.length === 0, unsourced);
    console.log(
      `  variant ${index + 1} headline: "${opened.body.project.values.texts.headline}"; to confirm: ${variant.confirmed.join(', ') || 'nothing'}`,
    );
  }

  const assets = (await call(adminToken, 'GET', `/clients/${client.clientId}/assets`)).body.assets;
  const photo = assets.find((asset: any) => asset.kind === 'photo');
  check(
    'brand kit photos copied from a scan live in the client assets folder',
    assets.every((asset: any) => asset.key.startsWith(`assets/${client.clientId}/`)),
    assets.map((asset: any) => asset.key),
  );
  const logo = assets.find((asset: any) => asset.kind === 'logo');
  if (logo) {
    const removed = await imageJob(adminToken, client.clientId, `${logo.assetId}/remove-bg`, {});
    check(
      'remove background makes a new AI-edited asset',
      removed.status === 201 &&
        removed.body.source === 'ai-edit' &&
        removed.body.derivedFrom === logo.assetId,
      removed.body,
    );
  }
  if (photo) {
    const extended = await imageJob(adminToken, client.clientId, `${photo.assetId}/outpaint`, {
      aspect: '9:16',
    });
    check(
      'outpaint extends a photo to 9:16',
      extended.status === 201 &&
        Math.abs(extended.body.width / extended.body.height - 9 / 16) < 0.02,
      extended.body,
    );
  }
  const background = await imageJob(adminToken, client.clientId, 'background', {
    brandKitId: kit.kitId,
    style: 'Soft abstract waves',
    aspect: '1:1',
  });
  check(
    'a background is generated in the brand colours',
    background.status === 201 && background.body.source === 'ai-generated',
    background.body,
  );
  const userAccount = await createTestUser('gen-user', ['client-user'], client.clientId);
  partitions.push(`USER#${userAccount.userId}`);
  const userToken = await token(userAccount.email);
  check(
    'client users cannot use AI image edits',
    (
      await call(userToken, 'POST', `/clients/${client.clientId}/images/background`, {
        brandKitId: kit.kitId,
        style: 'waves',
        aspect: '1:1',
      })
    ).status === 403,
  );
  await deleteCognitoUsers([userAccount.email]);
  check(
    'offers that are not in the brand kit are refused',
    (
      await call(adminToken, 'POST', `/clients/${client.clientId}/generations`, {
        brandKitId: kit.kitId,
        offerText: '90% off everything',
      })
    ).status === 400,
  );
} finally {
  await deleteCognitoUsers([admin.email]);
  await deletePartitions(partitions);
  for (const prefix of prefixes) {
    await deletePrefix(prefix);
  }
}
finish();
