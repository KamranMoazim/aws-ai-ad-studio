import { isId, newId } from '../src/core/ids.js';
import {
  auditPk,
  auditSk,
  clientIdFromKey,
  clientIndexSk,
  clientPk,
  memberSk,
  roleSk,
  staffSk,
  userAuditIndexPk,
  userIndexSk,
  userPk,
} from '../src/core/keys.js';
import { roleInputSchema, inviteUserSchema } from '../src/core/schemas.js';
import { check, finish } from './helpers.js';

const iso = '2026-11-09T10:00:00.000Z';
check('role sk', roleSk('admin') === 'ROLE#admin');
check('user pk', userPk('abc') === 'USER#abc');
check('user index sk sorts by type then name', userIndexSk('staff', 'Ana B') === 'staff#ana b');
check('client pk', clientPk('c1') === 'CLIENT#c1');
check('client id round trip', clientIdFromKey(clientPk('c1')) === 'c1');
check('client index sk', clientIndexSk('active', 'Acme') === 'active#acme');
check('member and staff sk', memberSk('u1') === 'MEMBER#u1' && staffSk('u1') === 'STAFF#u1');
check('audit partition by month', auditPk(iso) === 'AUDIT#2026-11');
check('audit sk sorts by time', auditSk(iso, 'x').startsWith(iso));
check('user audit index', userAuditIndexPk('u1') === 'USER#u1#AUDIT');
check('new id is a valid id', isId(newId()) && newId().length === 16);
check('id rejects key separators', !isId('a#b') && !isId(''));
check(
  'client role rejects scope all',
  !roleInputSchema.safeParse({
    name: 'x',
    type: 'client',
    grants: [{ actions: ['client:read'], scope: 'all' }],
  }).success,
);
check(
  'staff role rejects scope own',
  !roleInputSchema.safeParse({
    name: 'x',
    type: 'staff',
    grants: [{ actions: ['client:read'], scope: 'own' }],
  }).success,
);
check(
  'client user needs a client',
  !inviteUserSchema.safeParse({
    email: 'a@b.co',
    name: 'A',
    type: 'client',
    roleIds: ['client-user'],
  }).success,
);
check(
  'staff user must not have a client',
  !inviteUserSchema.safeParse({
    email: 'a@b.co',
    name: 'A',
    type: 'staff',
    roleIds: ['admin'],
    clientId: 'c1',
  }).success,
);
check(
  'invite lowercases email',
  inviteUserSchema.parse({ email: 'Ana@B.co', name: 'A', type: 'staff', roleIds: ['admin'] })
    .email === 'ana@b.co',
);
finish();
