import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EXPORT_PREFIX, exportSk, projectPk } from '../core/keys.js';
import type { ExportFile, ExportRecord } from '../core/schemas.js';
import { documentClient, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

export async function createExport(record: ExportRecord): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: projectPk(record.projectId),
        SK: exportSk(record.createdAt, record.exportId),
        ...record,
      },
    }),
  );
}

export async function listExports(projectId: string): Promise<ExportRecord[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': projectPk(projectId), ':prefix': EXPORT_PREFIX },
      ScanIndexForward: false,
    }),
  );
  return (response.Items ?? []).map((item) => withoutKeys<ExportRecord>(item));
}

export async function getExport(projectId: string, exportId: string) {
  return (await listExports(projectId)).find((record) => record.exportId === exportId);
}

export async function finishExport(
  record: Pick<ExportRecord, 'projectId' | 'createdAt' | 'exportId'>,
  result:
    | { status: 'ready'; files: ExportFile[]; zipKey: string; zipBytes: number }
    | { status: 'failed'; error: string },
): Promise<void> {
  const fields: Record<string, unknown> = { ...result, finishedAt: new Date().toISOString() };
  const names = Object.keys(fields);
  await documentClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: projectPk(record.projectId), SK: exportSk(record.createdAt, record.exportId) },
      UpdateExpression: `SET ${names.map((field) => `#${field} = :${field}`).join(', ')}`,
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: Object.fromEntries(names.map((field) => [`#${field}`, field])),
      ExpressionAttributeValues: Object.fromEntries(
        names.map((field) => [`:${field}`, fields[field]]),
      ),
    }),
  );
}
