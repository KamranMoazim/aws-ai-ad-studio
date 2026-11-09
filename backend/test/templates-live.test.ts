import { SEED_TEMPLATES } from '../../shared/src/index.js';
import { check, finish } from './helpers.js';
import { call, createTestUser, deleteCognitoUsers, token } from './live.js';

const { deletePartitions, deletePrefix } = await import('./cleanup.js');

const admin = await createTestUser('tpl-admin', ['super-admin']);
const manager = await createTestUser('tpl-manager', ['account-manager']);
const created: string[] = [];
const clean = { issues: [] };

try {
  const adminToken = await token(admin.email);
  const managerToken = await token(manager.email);

  const create = await call(adminToken, 'POST', '/templates', {
    name: 'Live test',
    channel: 'both',
  });
  check('admin creates a template', create.status === 201, create);
  const templateId = create.body.meta.templateId as string;
  created.push(templateId);
  check(
    'new template is a draft at revision 1',
    create.body.meta.revision === 1 && create.body.meta.status === 'draft',
  );

  const opened = await call(adminToken, 'GET', `/templates/${templateId}`);
  check(
    'draft opens with 8 layouts and the safe zone',
    Object.keys(opened.body.template?.layouts ?? {}).length === 8 &&
      opened.body.safeZone?.bottom === 35,
    opened.body.safeZone,
  );

  const invalid = await call(adminToken, 'PUT', `/templates/${templateId}`, {
    revision: 1,
    template: { ...opened.body.template, channel: 'tv' },
  });
  check('invalid template is refused', invalid.status === 400, invalid.body);

  const seed = structuredClone(SEED_TEMPLATES[0]);
  const saved = await call(adminToken, 'PUT', `/templates/${templateId}`, {
    revision: 1,
    template: { ...seed, name: 'Live test' },
  });
  check('valid draft saves and bumps the revision', saved.body.meta?.revision === 2, saved.body);
  const stale = await call(adminToken, 'PUT', `/templates/${templateId}`, {
    revision: 1,
    template: { ...seed, name: 'Live test' },
  });
  check('stale revision is a conflict', stale.status === 409);

  const reported = await call(adminToken, 'POST', `/templates/${templateId}/publish`, {
    revision: 2,
    report: { issues: [{ code: 'overflow', severity: 'error', message: 'x' }] },
  });
  check('publish refused when the browser lint has errors', reported.status === 400);

  const unsafe = structuredClone(seed);
  unsafe.layouts['1080x1920']!.elements.find((element) => element.id === 'headline')!.frame.y =
    1700;
  await call(adminToken, 'PUT', `/templates/${templateId}`, {
    revision: 2,
    template: { ...unsafe, name: 'Live test' },
  });
  const serverLint = await call(adminToken, 'POST', `/templates/${templateId}/publish`, {
    revision: 3,
    report: clean,
  });
  check(
    'server lint refuses text in the 9:16 no-go area',
    serverLint.status === 400 &&
      serverLint.body.details?.some((issue: { code: string }) => issue.code === 'safe-zone'),
    serverLint.body,
  );

  await call(adminToken, 'PUT', `/templates/${templateId}`, {
    revision: 3,
    template: { ...seed, name: 'Live test' },
  });
  const published = await call(adminToken, 'POST', `/templates/${templateId}/publish`, {
    revision: 4,
    report: clean,
  });
  check(
    'clean template publishes as version 1',
    published.body.meta?.latestVersion === 1,
    published.body,
  );

  const again = await call(adminToken, 'POST', `/templates/${templateId}/publish`, {
    revision: 4,
    report: clean,
  });
  check('publishing an unchanged draft again is refused', again.status === 409, again.body);

  const edited = structuredClone(seed);
  edited.sample.texts.headline = 'Changed after publishing';
  await call(adminToken, 'PUT', `/templates/${templateId}`, {
    revision: 4,
    template: { ...edited, name: 'Live test' },
  });
  const version = await call(adminToken, 'GET', `/templates/${templateId}/versions/1`);
  check(
    'published version is immutable',
    version.body.template?.version === 1 &&
      version.body.template?.sample.texts.headline === seed.sample.texts.headline,
    version.body.template?.sample?.texts,
  );
  const versions = await call(adminToken, 'GET', `/templates/${templateId}/versions`);
  check('versions are listed', versions.body.versions?.length === 1);

  const listed = await call(adminToken, 'GET', '/templates?status=published');
  check(
    'published list includes it',
    listed.body.templates?.some((item: { templateId: string }) => item.templateId === templateId),
  );

  check(
    'account manager can read templates',
    (await call(managerToken, 'GET', `/templates/${templateId}`)).status === 200,
  );
  check(
    'account manager cannot create templates',
    (await call(managerToken, 'POST', '/templates', { name: 'x', channel: 'both' })).status === 403,
  );
  check(
    'account manager cannot publish',
    (
      await call(managerToken, 'POST', `/templates/${templateId}/publish`, {
        revision: 5,
        report: clean,
      })
    ).status === 403,
  );
  const upload = await call(adminToken, 'POST', `/templates/${templateId}/asset-upload-url`, {
    contentType: 'image/png',
    size: 1000,
  });
  check(
    'sample image upload url is scoped to the template',
    upload.status === 200 && upload.body.key.startsWith(`template-assets/${templateId}/`),
    upload.body,
  );
  const tooBig = await call(adminToken, 'POST', `/templates/${templateId}/asset-upload-url`, {
    contentType: 'image/png',
    size: 6 * 1024 * 1024,
  });
  check('oversized sample image is refused', tooBig.status === 400);
} finally {
  await deleteCognitoUsers([admin.email, manager.email]);
  await deletePartitions([
    `USER#${admin.userId}`,
    `USER#${manager.userId}`,
    ...created.map((templateId) => `TPL#${templateId}`),
  ]);
  for (const templateId of created) {
    await deletePrefix(`templates/${templateId}/`);
  }
}
finish();
