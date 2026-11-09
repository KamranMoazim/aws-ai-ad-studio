import { isAuthorized, validate } from '@cedar-policy/cedar-wasm/nodejs';
import { DEFAULT_ROLES } from '../src/authz/default-roles.js';
import {
  actionUid,
  principalEntities,
  resourceEntities,
  uid,
  uniqueEntities,
  type Principal,
  type ResourceRef,
} from '../src/authz/entities.js';
import { grantPolicy, rolePolicies } from '../src/authz/policies.js';
import { CEDAR_SCHEMA } from '../src/authz/schema.js';
import { check, finish } from './helpers.js';
import { describe, matrixCases, PRINCIPALS, SPOT_CHECKS } from './matrix.js';

const schema = CEDAR_SCHEMA as never;
const policies = Object.entries(DEFAULT_ROLES).flatMap(([roleId, role]) =>
  rolePolicies(roleId, role),
);
const staticPolicies = Object.fromEntries(policies.map((text, index) => [`p${index}`, text]));

const validation = validate({ schema, policies: { staticPolicies } });
check(
  'generated policies validate against the schema',
  validation.type === 'success' && validation.validationErrors.length === 0,
  validation,
);
check(
  'all-scope policy has no condition',
  grantPolicy('r', { actions: ['client:read'], scope: 'all' }).endsWith(');'),
);
check(
  'role id is quoted in the principal clause',
  grantPolicy('client-user', { actions: ['client:read'], scope: 'own' }).includes(
    'principal in AdStudio::Role::"client-user"',
  ),
);

function decide(principal: Principal, action: string, resource: ResourceRef): boolean {
  const answer = isAuthorized({
    principal: uid('User', principal.userId),
    action: actionUid(action),
    resource: uid(resource.type, resource.id),
    context: {},
    schema,
    validateRequest: true,
    policies: { staticPolicies },
    entities: uniqueEntities([
      ...principalEntities(principal),
      ...resourceEntities(resource),
    ]) as never,
  });
  if (answer.type !== 'success') {
    throw new Error(JSON.stringify(answer.errors));
  }
  return answer.response.decision === 'allow';
}

const mismatches = matrixCases().filter(
  (item) => decide(item.principal, item.action, item.resource) !== item.expected,
);
check(
  `matrix of ${matrixCases().length} role x action x resource cases`,
  mismatches.length === 0,
  mismatches.slice(0, 5).map((item) => describe(item.principalName, item.action, item.resource)),
);
for (const [name, action, resource, expected] of SPOT_CHECKS) {
  check(
    `${describe(name, action, resource)} -> ${expected ? 'allow' : 'deny'}`,
    decide(PRINCIPALS[name], action, resource) === expected,
  );
}
finish();
