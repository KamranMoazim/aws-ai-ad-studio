import type { Grant, RoleInput, Scope } from '../core/schemas.js';
import { NAMESPACE } from './schema.js';

const CONDITIONS: Record<Scope, string | undefined> = {
  all: undefined,
  assigned: 'resource has client && resource.client in principal.assignedClients',
  own: 'principal has client && resource has client && resource.client == principal.client',
};

export function grantPolicy(roleId: string, grant: Grant): string {
  const actions = grant.actions.map((action) => `${NAMESPACE}::Action::"${action}"`).join(', ');
  const condition = CONDITIONS[grant.scope];
  return [
    'permit (',
    `  principal in ${NAMESPACE}::Role::"${roleId}",`,
    `  action in [${actions}],`,
    '  resource',
    condition ? `) when { ${condition} };` : ');',
  ].join('\n');
}

export const rolePolicies = (roleId: string, role: RoleInput) =>
  role.grants.map((grant) => grantPolicy(roleId, grant));
