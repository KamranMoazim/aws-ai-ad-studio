import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Content, LintIssue } from '../../../shared/src/index.js';
import { clientPk, GENERATION_PREFIX, generationSk } from '../core/keys.js';
import { documentClient, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

export interface GenerationBrief {
  brandKitId: string;
  channel: 'display' | 'meta' | 'both';
  serviceName?: string;
  offerText?: string;
  notes?: string;
  quality: 'final' | 'draft';
}

export interface Variant {
  templateId: string;
  templateVersion: number;
  templateName: string;
  values: Content;
  issues: LintIssue[];
  confirmed: string[];
}

export interface Generation {
  generationId: string;
  clientId: string;
  status: 'queued' | 'writing' | 'checking' | 'ready' | 'failed';
  brief: GenerationBrief;
  variants?: Variant[];
  model?: string;
  error?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export async function createGeneration(generation: Generation): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: clientPk(generation.clientId),
        SK: generationSk(generation.generationId),
        ...generation,
      },
    }),
  );
}

export async function getGeneration(
  clientId: string,
  generationId: string,
): Promise<Generation | undefined> {
  const response = await documentClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: clientPk(clientId), SK: generationSk(generationId) },
    }),
  );
  return response.Item ? withoutKeys<Generation>(response.Item) : undefined;
}

export async function updateGeneration(
  clientId: string,
  generationId: string,
  fields: Partial<Generation>,
) {
  const all: Record<string, unknown> = { ...fields, updatedAt: new Date().toISOString() };
  const names = Object.keys(all).filter((field) => all[field] !== undefined);
  await documentClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: clientPk(clientId), SK: generationSk(generationId) },
      UpdateExpression: `SET ${names.map((field) => `#${field} = :${field}`).join(', ')}`,
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: Object.fromEntries(names.map((field) => [`#${field}`, field])),
      ExpressionAttributeValues: Object.fromEntries(
        names.map((field) => [`:${field}`, all[field]]),
      ),
    }),
  );
}

export async function listGenerations(clientId: string, limit = 50): Promise<Generation[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': clientPk(clientId), ':prefix': GENERATION_PREFIX },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (response.Items ?? []).map((item) => withoutKeys<Generation>(item));
}
