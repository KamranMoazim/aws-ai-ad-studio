import type { RoleInput } from '../core/schemas.js';
import { ACTIONS, type Action } from './schema.js';

const PROJECT_ACTIONS: Action[] = [
  'project:create',
  'project:read',
  'project:edit',
  'project:export',
  'project:download',
  'brandkit:read',
  'brandkit:edit',
];

export const DEFAULT_ROLES: Record<string, RoleInput> = {
  'super-admin': {
    name: 'Super Admin',
    type: 'staff',
    grants: [{ actions: ACTIONS, scope: 'all' }],
  },
  admin: {
    name: 'Admin',
    type: 'staff',
    grants: [
      {
        actions: [
          'client:create',
          'client:read',
          'client:update',
          'client:archive',
          'client:assign-staff',
          'user:invite',
          'template:read',
          'template:create',
          'template:publish',
          ...PROJECT_ACTIONS,
        ],
        scope: 'all',
      },
    ],
  },
  'account-manager': {
    name: 'Account Manager',
    type: 'staff',
    grants: [
      { actions: ['template:read'], scope: 'all' },
      {
        actions: ['client:read', 'client:update', 'user:invite', ...PROJECT_ACTIONS],
        scope: 'assigned',
      },
    ],
  },
  'client-owner': {
    name: 'Client Owner',
    type: 'client',
    grants: [
      { actions: ['client:read', 'user:invite', 'txn:read', ...PROJECT_ACTIONS], scope: 'own' },
    ],
  },
  'client-user': {
    name: 'Client User',
    type: 'client',
    grants: [
      {
        actions: [
          'client:read',
          'project:create',
          'project:read',
          'project:edit',
          'project:export',
          'project:download',
          'brandkit:read',
        ],
        scope: 'own',
      },
    ],
  },
};
