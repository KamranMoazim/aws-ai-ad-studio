export const NAMESPACE = 'AdStudio';
export const ORG_ID = 'org';

export type ResourceType =
  | 'Org'
  | 'Client'
  | 'Project'
  | 'BrandKit'
  | 'Export'
  | 'Template'
  | 'Transaction';

export const ACTION_RESOURCES = {
  'settings:manage': ['Org'],
  'pricing:manage': ['Org'],
  'user:manage': ['Org'],
  'role:manage': ['Org'],
  'audit:read': ['Org'],
  'client:create': ['Org'],
  'template:create': ['Org'],
  'template:read': ['Org', 'Template'],
  'template:publish': ['Template'],
  'client:read': ['Client'],
  'client:update': ['Client'],
  'client:archive': ['Client'],
  'client:assign-staff': ['Client'],
  'payment:toggle': ['Client'],
  'user:invite': ['Client'],
  'txn:read': ['Org', 'Client', 'Transaction'],
  'project:create': ['Client'],
  'project:read': ['Project'],
  'project:edit': ['Project'],
  'project:export': ['Project'],
  'project:download': ['Project', 'Export'],
  'brandkit:read': ['BrandKit'],
  'brandkit:edit': ['Client', 'BrandKit'],
} as const satisfies Record<string, readonly ResourceType[]>;

export type Action = keyof typeof ACTION_RESOURCES;
export const ACTIONS = Object.keys(ACTION_RESOURCES) as Action[];

const clientRef = { type: 'Entity', name: 'Client' };
const ownedByClient = {
  shape: { type: 'Record', attributes: { client: clientRef } },
};

export const CEDAR_SCHEMA = {
  [NAMESPACE]: {
    entityTypes: {
      Role: {},
      Org: {},
      Template: {},
      User: {
        memberOfTypes: ['Role'],
        shape: {
          type: 'Record',
          attributes: {
            type: { type: 'String' },
            client: { ...clientRef, required: false },
            assignedClients: { type: 'Set', element: clientRef },
          },
        },
      },
      Client: ownedByClient,
      Project: ownedByClient,
      BrandKit: ownedByClient,
      Export: ownedByClient,
      Transaction: ownedByClient,
    },
    actions: Object.fromEntries(
      ACTIONS.map((action) => [
        action,
        { appliesTo: { principalTypes: ['User'], resourceTypes: [...ACTION_RESOURCES[action]] } },
      ]),
    ),
  },
};
