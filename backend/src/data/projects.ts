import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { HttpError } from '../core/http-error.js';
import { clientProjectsIndexPk, META_SK, projectPk } from '../core/keys.js';
import type { Project } from '../core/schemas.js';
import { documentClient, GSI1, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

const projectItem = (project: Project) => ({
  PK: projectPk(project.projectId),
  SK: META_SK,
  GSI1PK: clientProjectsIndexPk(project.clientId),
  GSI1SK: project.createdAt,
  ...project,
});

export async function getProject(projectId: string): Promise<Project | undefined> {
  const response = await documentClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: projectPk(projectId), SK: META_SK } }),
  );
  return response.Item ? withoutKeys<Project>(response.Item) : undefined;
}

export async function createProject(project: Project): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: projectItem(project),
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
}

export async function saveProject(project: Project, expectedRevision: number): Promise<void> {
  try {
    await documentClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: projectItem(project),
        ConditionExpression: 'revision = :revision',
        ExpressionAttributeValues: { ':revision': expectedRevision },
      }),
    );
  } catch (error) {
    if ((error as Error).name === 'ConditionalCheckFailedException') {
      throw new HttpError(409, 'conflict', 'This project was saved elsewhere; reload it first');
    }
    throw error;
  }
}

export async function listProjects(clientId: string): Promise<Project[]> {
  const projects: Project[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await documentClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': clientProjectsIndexPk(clientId) },
        ScanIndexForward: false,
        ExclusiveStartKey: startKey,
      }),
    );
    projects.push(...(page.Items ?? []).map((item) => withoutKeys<Project>(item)));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return projects;
}
