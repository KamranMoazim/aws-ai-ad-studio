import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { newId } from '../core/ids.js';
import { auditPk, auditSk, userAuditIndexPk } from '../core/keys.js';
import { documentClient, TABLE_NAME } from '../core/table.js';

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
