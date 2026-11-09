import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { clientPk, imageJobSk } from '../core/keys.js';
import { documentClient, TABLE_NAME, ttlAfterDays } from '../core/table.js';
import { withoutKeys } from './items.js';

const JOB_DAYS = 7;

export interface ImageJob {
  jobId: string;
  clientId: string;
  op: 'remove-bg' | 'outpaint' | 'background';
  status: 'running' | 'ready' | 'failed';
  assetId?: string;
  message?: string;
  createdAt: string;
  createdBy: string;
}

export async function createImageJob(job: ImageJob): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: clientPk(job.clientId),
        SK: imageJobSk(job.jobId),
        ...job,
        expiresAt: ttlAfterDays(JOB_DAYS),
      },
    }),
  );
}

export async function getImageJob(clientId: string, jobId: string): Promise<ImageJob | undefined> {
  const response = await documentClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: clientPk(clientId), SK: imageJobSk(jobId) },
    }),
  );
  return response.Item ? withoutKeys<ImageJob>(response.Item) : undefined;
}

export async function finishImageJob(
  clientId: string,
  jobId: string,
  result: { status: 'ready'; assetId: string } | { status: 'failed'; message: string },
): Promise<void> {
  const fields: Record<string, unknown> = { ...result };
  const names = Object.keys(fields);
  await documentClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: clientPk(clientId), SK: imageJobSk(jobId) },
      UpdateExpression: `SET ${names.map((name) => `#${name} = :${name}`).join(', ')}`,
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: Object.fromEntries(names.map((name) => [`#${name}`, name])),
      ExpressionAttributeValues: Object.fromEntries(
        names.map((name) => [`:${name}`, fields[name]]),
      ),
    }),
  );
}
