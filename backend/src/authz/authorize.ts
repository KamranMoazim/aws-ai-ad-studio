import {
  BatchIsAuthorizedCommand,
  IsAuthorizedCommand,
  VerifiedPermissionsClient,
  type AttributeValue as AvpAttributeValue,
  type EntityItem,
} from '@aws-sdk/client-verifiedpermissions';
import {
  actionUid,
  principalEntities,
  resourceEntities,
  uid,
  uniqueEntities,
  type AttributeValue,
  type Entity,
  type EntityUid,
  type Principal,
  type ResourceRef,
} from './entities.js';
import type { Action } from './schema.js';

const BATCH_LIMIT = 30;
const avpClient = new VerifiedPermissionsClient({});
const policyStoreId = () => process.env.POLICY_STORE_ID!;

const identifier = (entity: EntityUid) => ({ entityType: entity.type, entityId: entity.id });

function toAvpValue(value: AttributeValue): AvpAttributeValue {
  if (typeof value === 'string') {
    return { string: value };
  }
  if (typeof value === 'boolean') {
    return { boolean: value };
  }
  if (Array.isArray(value)) {
    return { set: value.map(toAvpValue) };
  }
  return { entityIdentifier: identifier(value.__entity) };
}

function toAvpEntities(entities: Entity[]): EntityItem[] {
  return uniqueEntities(entities).map((entity) => ({
    identifier: identifier(entity.uid),
    attributes: Object.fromEntries(
      Object.entries(entity.attrs).map(([name, value]) => [name, toAvpValue(value)]),
    ),
    parents: entity.parents.map(identifier),
  }));
}

export interface Check {
  action: Action;
  resource: ResourceRef;
}

export async function isAllowed(principal: Principal, check: Check): Promise<boolean> {
  const response = await avpClient.send(
    new IsAuthorizedCommand({
      policyStoreId: policyStoreId(),
      principal: identifier(uid('User', principal.userId)),
      action: { actionType: actionUid(check.action).type, actionId: check.action },
      resource: identifier(uid(check.resource.type, check.resource.id)),
      entities: {
        entityList: toAvpEntities([
          ...principalEntities(principal),
          ...resourceEntities(check.resource),
        ]),
      },
    }),
  );
  return response.decision === 'ALLOW';
}

export async function allowedMany(principal: Principal, checks: Check[]): Promise<boolean[]> {
  const decisions: boolean[] = [];
  for (let start = 0; start < checks.length; start += BATCH_LIMIT) {
    const chunk = checks.slice(start, start + BATCH_LIMIT);
    const response = await avpClient.send(
      new BatchIsAuthorizedCommand({
        policyStoreId: policyStoreId(),
        entities: {
          entityList: toAvpEntities([
            ...principalEntities(principal),
            ...chunk.flatMap((check) => resourceEntities(check.resource)),
          ]),
        },
        requests: chunk.map((check) => ({
          principal: identifier(uid('User', principal.userId)),
          action: { actionType: actionUid(check.action).type, actionId: check.action },
          resource: identifier(uid(check.resource.type, check.resource.id)),
        })),
      }),
    );
    decisions.push(...(response.results ?? []).map((result) => result.decision === 'ALLOW'));
  }
  return decisions;
}
