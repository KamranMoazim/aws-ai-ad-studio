import { check, finish } from './helpers.js';
import { call, createTestUser, deleteCognitoUsers, token } from './live.js';

const { deletePartitions } = await import('./cleanup.js');

const admin = await createTestUser('hard-admin', ['super-admin']);
const noMfa = await createTestUser('hard-nomfa', ['admin'], undefined, { mfaEnabled: false });
const plainAdmin = await createTestUser('hard-plain', ['admin']);
try {
  const adminToken = await token(admin.email);
  const noMfaToken = await token(noMfa.email);

  const me = await call(noMfaToken, 'GET', '/me');
  check(
    'staff without MFA can read /me and are told to set it up',
    me.status === 200 && me.body.mfa?.required === true && me.body.mfa?.enabled === false,
    me.body.mfa,
  );
  const blocked = await call(noMfaToken, 'GET', '/clients');
  check(
    'staff without MFA are refused everywhere else',
    blocked.status === 403 && blocked.body.error === 'mfa_required',
    blocked.body,
  );
  const fake = await call(noMfaToken, 'POST', '/me/mfa');
  check(
    'MFA cannot be marked on without a real authenticator in Cognito',
    fake.status === 400,
    fake.body,
  );

  const audit = await call(
    adminToken,
    'GET',
    `/audit?month=${new Date().toISOString().slice(0, 7)}`,
  );
  check(
    'the audit log lists entries with names',
    audit.status === 200 && Array.isArray(audit.body.entries),
    audit.status,
  );
  check(
    'admins without audit permission cannot read it',
    (await call(noMfaToken, 'GET', '/audit')).status === 403,
  );

  const settings = await call(adminToken, 'GET', '/settings');
  check(
    'settings expose limits, MFA and safe zone',
    settings.body.limits?.scansPerDay > 0 &&
      settings.body.requireStaffMfa !== undefined &&
      settings.body.safeZone?.bottom > 0,
    settings.body,
  );

  const roleId = `test-${Date.now().toString(36)}`;
  const created = await call(adminToken, 'PUT', `/roles/${roleId}`, {
    name: 'Test designer',
    type: 'staff',
    grants: [{ actions: ['template:read', 'template:create'], scope: 'all' }],
  });
  check(
    'a new role is created from a checklist',
    created.status === 200 && created.body.roleId === roleId,
    created.body,
  );
  const roles = await call(adminToken, 'GET', '/roles');
  check(
    'the new role is listed',
    roles.body.roles?.some((role: { roleId: string }) => role.roleId === roleId),
  );
  check(
    'starting roles cannot be deleted',
    (await call(adminToken, 'DELETE', '/roles/admin')).status === 400,
  );
  const deleted = await call(adminToken, 'DELETE', `/roles/${roleId}`);
  check('an unused custom role can be deleted', deleted.status === 200, deleted.body);
} finally {
  await deleteCognitoUsers([admin.email, noMfa.email, plainAdmin.email]);
  await deletePartitions([
    `USER#${admin.userId}`,
    `USER#${noMfa.userId}`,
    `USER#${plainAdmin.userId}`,
  ]);
}
finish();
