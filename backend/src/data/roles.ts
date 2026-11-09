import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { deletePolicies, createRolePolicies } from '../authz/store.js';
import { ORG_PK, ROLE_PREFIX, roleSk } from '../core/keys.js';
import type { Role, RoleInput } from '../core/schemas.js';
import { documentClient, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

export async function listRoles(): Promise<Role[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': ORG_PK, ':prefix': ROLE_PREFIX },
    }),
  );
  return (response.Items ?? []).map((item) => withoutKeys<Role>(item));
}

export async function getRole(roleId: string): Promise<Role | undefined> {
  const response = await documentClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: ORG_PK, SK: roleSk(roleId) } }),
  );
  return response.Item ? withoutKeys<Role>(response.Item) : undefined;
}

export async function saveRole(roleId: string, input: RoleInput, builtIn = false): Promise<Role> {
  const existing = await getRole(roleId);
  const policyIds = await createRolePolicies(roleId, input);
  const role: Role = {
    ...input,
    roleId,
    builtIn: existing?.builtIn ?? builtIn,
    policyIds,
    updatedAt: new Date().toISOString(),
  };
  try {
    await documentClient.send(
      new PutCommand({ TableName: TABLE_NAME, Item: { PK: ORG_PK, SK: roleSk(roleId), ...role } }),
    );
  } catch (error) {
    await deletePolicies(policyIds);
    throw error;
  }
  await deletePolicies(existing?.policyIds ?? []);
  return role;
}

export async function deleteRole(role: Role): Promise<void> {
  await documentClient.send(
    new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: ORG_PK, SK: roleSk(role.roleId) } }),
  );
  await deletePolicies(role.policyIds);
}
