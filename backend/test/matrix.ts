import { DEFAULT_ROLES } from '../src/authz/default-roles.js';
import { ORG, type Principal, type ResourceRef } from '../src/authz/entities.js';
import { ACTION_RESOURCES, ACTIONS, type Action } from '../src/authz/schema.js';

export const PRINCIPALS: Record<string, Principal> = {
  superAdmin: { userId: 'u-super', type: 'staff', roleIds: ['super-admin'], assignedClientIds: [] },
  admin: { userId: 'u-admin', type: 'staff', roleIds: ['admin'], assignedClientIds: [] },
  manager: {
    userId: 'u-manager',
    type: 'staff',
    roleIds: ['account-manager'],
    assignedClientIds: ['A'],
  },
  owner: {
    userId: 'u-owner',
    type: 'client',
    roleIds: ['client-owner'],
    clientId: 'A',
    assignedClientIds: [],
  },
  clientUser: {
    userId: 'u-client',
    type: 'client',
    roleIds: ['client-user'],
    clientId: 'A',
    assignedClientIds: [],
  },
  noRole: { userId: 'u-none', type: 'staff', roleIds: [], assignedClientIds: [] },
};

export const RESOURCES: ResourceRef[] = [
  ORG,
  { type: 'Client', id: 'A', clientId: 'A' },
  { type: 'Client', id: 'B', clientId: 'B' },
  { type: 'Project', id: 'pA', clientId: 'A' },
  { type: 'Project', id: 'pB', clientId: 'B' },
  { type: 'BrandKit', id: 'kA', clientId: 'A' },
  { type: 'Export', id: 'eB', clientId: 'B' },
  { type: 'Transaction', id: 'tA', clientId: 'A' },
  { type: 'Template', id: 't1' },
];

export interface Case {
  principalName: string;
  principal: Principal;
  action: Action;
  resource: ResourceRef;
  expected: boolean;
}

function expectedDecision(principal: Principal, action: Action, resource: ResourceRef): boolean {
  return principal.roleIds.some((roleId) =>
    DEFAULT_ROLES[roleId].grants.some((grant) => {
      if (!grant.actions.includes(action)) {
        return false;
      }
      if (grant.scope === 'all') {
        return true;
      }
      if (!resource.clientId) {
        return false;
      }
      return grant.scope === 'assigned'
        ? principal.assignedClientIds.includes(resource.clientId)
        : principal.clientId === resource.clientId;
    }),
  );
}

export function matrixCases(): Case[] {
  const cases: Case[] = [];
  for (const [principalName, principal] of Object.entries(PRINCIPALS)) {
    for (const action of ACTIONS) {
      const types: readonly string[] = ACTION_RESOURCES[action];
      for (const resource of RESOURCES.filter((candidate) => types.includes(candidate.type))) {
        cases.push({
          principalName,
          principal,
          action,
          resource,
          expected: expectedDecision(principal, action, resource),
        });
      }
    }
  }
  return cases;
}

export const SPOT_CHECKS: Array<[string, Action, ResourceRef, boolean]> = [
  ['superAdmin', 'settings:manage', ORG, true],
  ['admin', 'settings:manage', ORG, false],
  ['admin', 'role:manage', ORG, false],
  ['admin', 'client:read', { type: 'Client', id: 'B', clientId: 'B' }, true],
  ['manager', 'client:read', { type: 'Client', id: 'A', clientId: 'A' }, true],
  ['manager', 'client:read', { type: 'Client', id: 'B', clientId: 'B' }, false],
  ['manager', 'project:edit', { type: 'Project', id: 'pB', clientId: 'B' }, false],
  ['manager', 'client:create', ORG, false],
  ['owner', 'txn:read', { type: 'Transaction', id: 'tA', clientId: 'A' }, true],
  ['owner', 'project:read', { type: 'Project', id: 'pB', clientId: 'B' }, false],
  ['clientUser', 'txn:read', { type: 'Transaction', id: 'tA', clientId: 'A' }, false],
  ['clientUser', 'user:invite', { type: 'Client', id: 'A', clientId: 'A' }, false],
  ['clientUser', 'user:manage', ORG, false],
  ['clientUser', 'brandkit:edit', { type: 'Client', id: 'A', clientId: 'A' }, false],
  ['clientUser', 'project:edit', { type: 'Project', id: 'pA', clientId: 'A' }, true],
  ['owner', 'brandkit:edit', { type: 'Client', id: 'A', clientId: 'A' }, true],
  ['noRole', 'client:read', { type: 'Client', id: 'A', clientId: 'A' }, false],
];

export const describe = (name: string, action: string, resource: ResourceRef) =>
  `${name} ${action} ${resource.type}:${resource.id}`;
