import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Template, TemplateChannel } from '../../../shared/src/index.js';
import { HttpError } from '../core/http-error.js';
import {
  META_SK,
  templateDraftKey,
  templateIndexPk,
  templateIndexSk,
  templatePk,
  templateVersionKey,
  VERSION_PREFIX,
  versionSk,
} from '../core/keys.js';
import { getJson, putJson } from '../core/storage.js';
import { documentClient, GSI1, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

export type TemplateStatus = 'draft' | 'published';

export interface TemplateMeta {
  templateId: string;
  name: string;
  channel: TemplateChannel;
  tags: string[];
  status: TemplateStatus;
  latestVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  publishedAt?: string;
  publishedRevision?: number;
}

export interface TemplateVersion {
  version: number;
  publishedAt: string;
  publishedBy: string;
  key: string;
}

const metaItem = (meta: TemplateMeta) => ({
  PK: templatePk(meta.templateId),
  SK: META_SK,
  GSI1PK: templateIndexPk(meta.status),
  GSI1SK: templateIndexSk(meta.channel, meta.name),
  ...meta,
});

const isConditionFailure = (error: unknown) =>
  ['ConditionalCheckFailedException', 'TransactionCanceledException'].includes(
    (error as Error).name,
  );

export async function getTemplateMeta(templateId: string): Promise<TemplateMeta | undefined> {
  const response = await documentClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: templatePk(templateId), SK: META_SK } }),
  );
  return response.Item ? withoutKeys<TemplateMeta>(response.Item) : undefined;
}

export async function listTemplates(status: TemplateStatus): Promise<TemplateMeta[]> {
  const templates: TemplateMeta[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await documentClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': templateIndexPk(status) },
        ExclusiveStartKey: startKey,
      }),
    );
    templates.push(...(page.Items ?? []).map((item) => withoutKeys<TemplateMeta>(item)));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return templates;
}

export const getDraft = (templateId: string) => getJson<Template>(templateDraftKey(templateId));

export async function createTemplate(template: Template, userId: string): Promise<TemplateMeta> {
  const now = new Date().toISOString();
  const meta: TemplateMeta = {
    templateId: template.id,
    name: template.name,
    channel: template.channel,
    tags: template.tags,
    status: 'draft',
    latestVersion: 0,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: userId,
  };
  await putJson(templateDraftKey(template.id), template);
  try {
    await documentClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: metaItem(meta),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  } catch (error) {
    if (isConditionFailure(error)) {
      throw new HttpError(409, 'conflict', 'A template with this id already exists');
    }
    throw error;
  }
  return meta;
}

export async function saveDraft(
  meta: TemplateMeta,
  template: Template,
  revision: number,
  userId: string,
): Promise<TemplateMeta> {
  if (revision !== meta.revision) {
    throw new HttpError(409, 'conflict', 'Someone else saved this template; reload it first');
  }
  const next: TemplateMeta = {
    ...meta,
    name: template.name,
    channel: template.channel,
    tags: template.tags,
    revision: meta.revision + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };
  await putJson(templateDraftKey(meta.templateId), template);
  try {
    await documentClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: metaItem(next),
        ConditionExpression: 'revision = :revision',
        ExpressionAttributeValues: { ':revision': meta.revision },
      }),
    );
  } catch (error) {
    if (isConditionFailure(error)) {
      throw new HttpError(409, 'conflict', 'Someone else saved this template; reload it first');
    }
    throw error;
  }
  return next;
}

export async function publishVersion(
  meta: TemplateMeta,
  template: Template,
  userId: string,
): Promise<TemplateMeta> {
  const version = meta.latestVersion + 1;
  const now = new Date().toISOString();
  const key = templateVersionKey(meta.templateId, version);
  await putJson(key, { ...template, version });
  const next: TemplateMeta = {
    ...meta,
    status: 'published',
    latestVersion: version,
    publishedAt: now,
    publishedRevision: meta.revision,
    updatedAt: now,
    updatedBy: userId,
  };
  const record: TemplateVersion = { version, publishedAt: now, publishedBy: userId, key };
  try {
    await documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE_NAME,
              Item: metaItem(next),
              ConditionExpression: 'latestVersion = :latest AND revision = :revision',
              ExpressionAttributeValues: {
                ':latest': meta.latestVersion,
                ':revision': meta.revision,
              },
            },
          },
          {
            Put: {
              TableName: TABLE_NAME,
              Item: { PK: templatePk(meta.templateId), SK: versionSk(version), ...record },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
  } catch (error) {
    if (isConditionFailure(error)) {
      throw new HttpError(409, 'conflict', 'The template changed while publishing; try again');
    }
    throw error;
  }
  return next;
}

export async function listVersions(templateId: string): Promise<TemplateVersion[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': templatePk(templateId), ':prefix': VERSION_PREFIX },
      ScanIndexForward: false,
    }),
  );
  return (response.Items ?? []).map((item) => withoutKeys<TemplateVersion>(item));
}

export const getVersion = (templateId: string, version: number) =>
  getJson<Template>(templateVersionKey(templateId, version));
