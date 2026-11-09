import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { newId } from '../core/ids.js';
import { auditPk, auditSk, userAuditIndexPk } from '../core/keys.js';
import { documentClient, GSI1, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

export async function recordAudit(
  actorId: string,
  action: string,
  target: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  const at = new Date().toISOString();
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: auditPk(at),
        SK: auditSk(at, newId()),
        GSI1PK: userAuditIndexPk(actorId),
        GSI1SK: at,
        actorId,
        action,
        target,
        detail,
        at,
      },
    }),
  );
}

export interface AuditEntry {
  actorId: string;
  action: string;
  target: string;
  detail?: Record<string, unknown>;
  at: string;
}

export async function listAudit(month: string, limit = 500): Promise<AuditEntry[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `AUDIT#${month}` },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (response.Items ?? []).map((item) => withoutKeys<AuditEntry>(item));
}

export async function listUserAudit(userId: string, limit = 500): Promise<AuditEntry[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': userAuditIndexPk(userId) },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (response.Items ?? []).map((item) => withoutKeys<AuditEntry>(item));
}
