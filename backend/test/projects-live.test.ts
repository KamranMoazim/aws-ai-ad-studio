import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { DISPLAY_MAX_BYTES, SEED_TEMPLATES, SIZES, type SizeKey } from '../../shared/src/index.js';
import { check, finish } from './helpers.js';
import { testLogo, testPhoto } from './images.js';
import { call, createTestUser, deleteCognitoUsers, run, token } from './live.js';

const { deletePartitions, deletePrefix } = await import('./cleanup.js');
const EXPORT_WAIT_MS = 240_000;

const admin = await createTestUser('p-admin', ['super-admin']);
const cleanupUsers = [admin];
const partitions: string[] = [`USER#${admin.userId}`];
const prefixes: string[] = [];

async function upload(
  accessToken: string,
  clientId: string,
  body: Buffer,
  contentType: string,
  kind: string,
) {
  const start = await call(accessToken, 'POST', `/clients/${clientId}/assets/upload-url`, {
    contentType,
    size: body.length,
    kind,
    name: `test-${kind}`,
  });
  const put = await fetch(start.body.url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: new Uint8Array(body),
  });
  if (!put.ok) {
    throw new Error(`upload PUT failed ${put.status}`);
  }
  return call(accessToken, 'POST', `/clients/${clientId}/assets/${start.body.assetId}/complete`);
}

async function waitForExport(accessToken: string, projectId: string, exportId: string) {
  const deadline = Date.now() + EXPORT_WAIT_MS;
  let response = await call(accessToken, 'GET', `/projects/${projectId}/exports/${exportId}`);
  while (response.body.export?.status === 'rendering' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    response = await call(accessToken, 'GET', `/projects/${projectId}/exports/${exportId}`);
  }
  return response;
}

try {
  const adminToken = await token(admin.email);
  const template = structuredClone(SEED_TEMPLATES[1]);
  const created = await call(adminToken, 'POST', '/templates', {
    name: `Live ${run}`,
    channel: 'both',
  });
  const templateId = created.body.meta.templateId as string;
  partitions.push(`TPL#${templateId}`);
  prefixes.push(`templates/${templateId}/`);
  await call(adminToken, 'PUT', `/templates/${templateId}`, {
    revision: 1,
    template: { ...template, name: `Live ${run}` },
  });
  const published = await call(adminToken, 'POST', `/templates/${templateId}/publish`, {
    revision: 2,
    report: { issues: [] },
  });
  check('test template published', published.body.meta?.latestVersion === 1, published.body);

  const clientA = (await call(adminToken, 'POST', '/clients', { name: `Projects A ${run}` })).body;
  const clientB = (await call(adminToken, 'POST', '/clients', { name: `Projects B ${run}` })).body;
  partitions.push(`CLIENT#${clientA.clientId}`, `CLIENT#${clientB.clientId}`);
  prefixes.push(`assets/${clientA.clientId}/`, `exports/${clientA.clientId}/`);
  const owner = await createTestUser('p-owner', ['client-owner'], clientA.clientId);
  const other = await createTestUser('p-other', ['client-owner'], clientB.clientId);
  cleanupUsers.push(owner, other);
  partitions.push(`USER#${owner.userId}`, `USER#${other.userId}`);
  const ownerToken = await token(owner.email);
  const otherToken = await token(other.email);

  const photo = await upload(
    ownerToken,
    clientA.clientId,
    await testPhoto(),
    'image/jpeg',
    'photo',
  );
  check(
    'photo upload is processed',
    photo.status === 200 && photo.body.status === 'ready',
    photo.body,
  );
  const stored = Buffer.from(await (await fetch(photo.body.url)).arrayBuffer());
  check('stored photo has no EXIF', !(await sharp(stored).metadata()).exif);
  const logo = await upload(ownerToken, clientA.clientId, await testLogo(), 'image/png', 'logo');
  check('logo upload is processed', logo.body.status === 'ready', logo.body);
  const fake = await call(ownerToken, 'POST', `/clients/${clientA.clientId}/assets/upload-url`, {
    contentType: 'image/png',
    size: 20,
    kind: 'photo',
    name: 'fake',
  });
  await fetch(fake.body.url, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: 'not an image at all!',
  });
  const rejected = await call(
    ownerToken,
    'POST',
    `/clients/${clientA.clientId}/assets/${fake.body.assetId}/complete`,
  );
  check('a fake image is rejected', rejected.status === 400, rejected.body);
  check(
    'another client cannot upload into this client',
    (
      await call(otherToken, 'POST', `/clients/${clientA.clientId}/assets/upload-url`, {
        contentType: 'image/png',
        size: 20,
        kind: 'photo',
        name: 'x',
      })
    ).status === 404,
  );

  const kit = await call(ownerToken, 'POST', `/clients/${clientA.clientId}/brand-kits`, {
    name: 'Main',
    colors: { primary: '#123456', accent: '#f2a541', text: '#ffffff', background: '#f7f5f0' },
    logoLightId: logo.body.assetId,
    photoIds: [photo.body.assetId],
    services: [{ name: 'Deep cleaning' }],
    offers: [],
    ctas: ['Get a quote'],
  });
  check('brand kit saved', kit.status === 201, kit.body);

  const catalogue = await call(ownerToken, 'GET', `/clients/${clientA.clientId}/templates`);
  check(
    'client sees the published template',
    catalogue.body.templates?.some(
      (item: { templateId: string }) => item.templateId === templateId,
    ),
  );
  const project = await call(ownerToken, 'POST', `/clients/${clientA.clientId}/projects`, {
    name: 'Spring set',
    templateId,
    brandKitId: kit.body.kitId,
  });
  check('project created from the brand kit', project.status === 201, project.body);
  const projectId = project.body.projectId as string;
  partitions.push(`PROJ#${projectId}`);
  check(
    'brand kit fills colors, CTA, logo and photo',
    project.body.values.colors.primary === '#123456' &&
      project.body.values.texts.cta === 'Get a quote' &&
      project.body.values.images.logo?.src === logo.body.key &&
      project.body.values.images.photo?.src === photo.body.key,
    project.body.values,
  );
  check('unknown facts start as [confirm]', project.body.values.texts.headline === '[confirm]');
  check(
    'another client cannot open the project',
    (await call(otherToken, 'GET', `/projects/${projectId}`)).status === 404,
  );

  const blocked = await call(ownerToken, 'POST', `/projects/${projectId}/export`);
  check(
    'export is blocked while [confirm] remains',
    blocked.status === 400 &&
      blocked.body.details?.some((issue: { code: string }) => issue.code === 'placeholder'),
    blocked.body,
  );

  const values = structuredClone(project.body.values);
  values.texts.headline = 'Spotless homes, happy weekends';
  values.texts.subhead = 'Local team, flexible times';
  values.textOverrides = { '320x50': { headline: 'Spotless homes' } };
  const saved = await call(ownerToken, 'PUT', `/projects/${projectId}`, { revision: 1, values });
  check('project saved', saved.body.revision === 2, saved.body);
  const foreign = structuredClone(values);
  foreign.images.photo.src = `assets/${clientB.clientId}/0000000000000000.jpg`;
  check(
    'another client asset cannot be used',
    (await call(ownerToken, 'PUT', `/projects/${projectId}`, { revision: 2, values: foreign }))
      .status === 400,
  );

  const started = await call(ownerToken, 'POST', `/projects/${projectId}/export`);
  check('export started', started.status === 202, started.body);
  const finished = await waitForExport(ownerToken, projectId, started.body.exportId);
  const record = finished.body.export;
  check('export is ready', record?.status === 'ready', record);
  const files: Array<{ size: SizeKey; bytes: number; name: string }> = record?.files ?? [];
  check('8 files exported', files.length === 8, files.length);
  check(
    'every display file is 150 KB or less',
    files
      .filter((file) => SIZES[file.size].channel === 'display')
      .every((file) => file.bytes <= DISPLAY_MAX_BYTES),
    files.map((file) => [file.size, file.bytes]),
  );
  if (finished.body.downloadUrl) {
    const zip = unzipSync(
      new Uint8Array(await (await fetch(finished.body.downloadUrl)).arrayBuffer()),
    );
    const manifest = JSON.parse(new TextDecoder().decode(zip['manifest.json']));
    check(
      'zip has a manifest and 8 images',
      manifest.files.length === 8 && Object.keys(zip).length === 9,
    );
    let exact = true;
    for (const file of files) {
      const meta = await sharp(Buffer.from(zip[file.name])).metadata();
      exact &&= meta.width === SIZES[file.size].width && meta.height === SIZES[file.size].height;
    }
    check('every file has exact dimensions', exact);
  }
  check(
    'another client cannot download',
    (await call(otherToken, 'GET', `/projects/${projectId}/exports/${started.body.exportId}`))
      .status === 404,
  );

  const long = structuredClone(values);
  long.texts.headline = 'Spotless homes and happy weekends for every family in town';
  long.textOverrides = {};
  await call(ownerToken, 'PUT', `/projects/${projectId}`, { revision: 2, values: long });
  const overflow = await call(ownerToken, 'POST', `/projects/${projectId}/export`);
  const failed = await waitForExport(ownerToken, projectId, overflow.body.exportId);
  check(
    'server render fails an export whose text does not fit, with the reason',
    failed.body.export?.status === 'failed' &&
      /320x50|characters|overflow/i.test(failed.body.export?.error ?? ''),
    failed.body.export,
  );

  const copy = await call(ownerToken, 'POST', `/projects/${projectId}/duplicate`);
  check('project duplicates', copy.status === 201 && copy.body.projectId !== projectId);
  partitions.push(`PROJ#${copy.body.projectId}`);
  const listed = await call(ownerToken, 'GET', `/clients/${clientA.clientId}/projects`);
  check('archive lists both projects', listed.body.projects?.length === 2);
} finally {
  await deleteCognitoUsers(cleanupUsers.map((user) => user.email));
  await deletePartitions(partitions);
  for (const prefix of prefixes) {
    await deletePrefix(prefix);
  }
}
finish();
