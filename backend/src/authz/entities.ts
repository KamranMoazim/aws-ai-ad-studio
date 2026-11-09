import type { UserType } from '../core/schemas.js';
import { NAMESPACE, ORG_ID, type ResourceType } from './schema.js';

export interface Principal {
  userId: string;
  type: UserType;
  roleIds: string[];
  clientId?: string;
  assignedClientIds: string[];
}

export interface ResourceRef {
  type: ResourceType;
  id: string;
  clientId?: string;
}

export interface EntityUid {
  type: string;
  id: string;
}

export type AttributeValue = string | boolean | { __entity: EntityUid } | AttributeValue[];

export interface Entity {
  uid: EntityUid;
  attrs: Record<string, AttributeValue>;
  parents: EntityUid[];
}

export const uid = (type: string, id: string): EntityUid => ({ type: `${NAMESPACE}::${type}`, id });
export const actionUid = (action: string): EntityUid => uid('Action', action);
export const ORG: ResourceRef = { type: 'Org', id: ORG_ID };
export const clientResource = (clientId: string): ResourceRef => ({
  type: 'Client',
  id: clientId,
  clientId,
});

const clientRef = (clientId: string) => ({ __entity: uid('Client', clientId) });

export function principalEntities(principal: Principal): Entity[] {
  const attrs: Record<string, AttributeValue> = {
    type: principal.type,
    assignedClients: principal.assignedClientIds.map(clientRef),
  };
  if (principal.clientId) {
    attrs.client = clientRef(principal.clientId);
  }
  return [
    {
      uid: uid('User', principal.userId),
      attrs,
      parents: principal.roleIds.map((roleId) => uid('Role', roleId)),
    },
    ...principal.roleIds.map((roleId) => ({ uid: uid('Role', roleId), attrs: {}, parents: [] })),
  ];
}

export function resourceEntities(resource: ResourceRef): Entity[] {
  if (!resource.clientId) {
    return [{ uid: uid(resource.type, resource.id), attrs: {}, parents: [] }];
  }
  const entities: Entity[] = [
    {
      uid: uid(resource.type, resource.id),
      attrs: { client: clientRef(resource.clientId) },
      parents: [],
    },
  ];
  if (resource.type !== 'Client') {
    entities.push({
      uid: uid('Client', resource.clientId),
      attrs: { client: clientRef(resource.clientId) },
      parents: [],
    });
  }
  return entities;
}

export function uniqueEntities(entities: Entity[]): Entity[] {
  const byKey = new Map<string, Entity>();
  for (const entity of entities) {
    byKey.set(`${entity.uid.type}::${entity.uid.id}`, entity);
  }
  return [...byKey.values()];
}
