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

export async function updateExport(
  record: Pick<ExportRecord, 'projectId' | 'createdAt' | 'exportId'>,
  fields: Partial<ExportRecord>,
  expectedStatus?: ExportRecord['status'],
): Promise<boolean> {
  const setNames = Object.keys(fields).filter(
    (field) => fields[field as keyof ExportRecord] !== undefined,
  );
  const removeNames = Object.keys(fields).filter(
    (field) => fields[field as keyof ExportRecord] === undefined,
  );
  const names = [...setNames, ...removeNames];
  const clauses = [
    setNames.length ? `SET ${setNames.map((field) => `#${field} = :${field}`).join(', ')}` : '',
    removeNames.length ? `REMOVE ${removeNames.map((field) => `#${field}`).join(', ')}` : '',
  ].filter(Boolean);
  try {
    await documentClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: projectPk(record.projectId), SK: exportSk(record.createdAt, record.exportId) },
        UpdateExpression: clauses.join(' '),
        ConditionExpression: expectedStatus
          ? 'attribute_exists(PK) AND #currentStatus = :expectedStatus'
          : 'attribute_exists(PK)',
        ExpressionAttributeNames: {
          ...Object.fromEntries(names.map((field) => [`#${field}`, field])),
          ...(expectedStatus ? { '#currentStatus': 'status' } : {}),
        },
        ExpressionAttributeValues:
          setNames.length || expectedStatus
            ? {
                ...Object.fromEntries(
                  setNames.map((field) => [`:${field}`, fields[field as keyof ExportRecord]]),
                ),
                ...(expectedStatus ? { ':expectedStatus': expectedStatus } : {}),
              }
            : undefined,
      }),
    );
    return true;
  } catch (error) {
    if ((error as Error).name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw error;
  }
}

export async function finishExport(
  record: Pick<ExportRecord, 'projectId' | 'createdAt' | 'exportId'>,
  result:
    | { status: 'ready'; files: ExportFile[]; zipKey: string; zipBytes: number }
    | { status: 'failed'; error: string },
): Promise<void> {
  await updateExport(record, { ...result, finishedAt: new Date().toISOString() });
}
