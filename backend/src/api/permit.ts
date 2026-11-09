import type { Context } from 'hono';
import { isAllowed } from '../authz/authorize.js';
import { clientResource, ORG } from '../authz/entities.js';
import type { Action } from '../authz/schema.js';
import { HttpError } from '../core/http-error.js';
import { isId } from '../core/ids.js';
import type { Client, Project } from '../core/schemas.js';
import { getClient } from '../data/clients.js';
import { getProject } from '../data/projects.js';
import type { AppEnv } from './auth.js';

export async function permitOrg(context: Context<AppEnv>, action: Action): Promise<void> {
  if (!(await isAllowed(context.get('principal'), { action, resource: ORG }))) {
    throw new HttpError(403, 'forbidden', 'You do not have permission to do this');
  }
}

export const canOrg = (context: Context<AppEnv>, action: Action) =>
  isAllowed(context.get('principal'), { action, resource: ORG });

export const canClient = (context: Context<AppEnv>, action: Action, clientId: string) =>
  isAllowed(context.get('principal'), { action, resource: clientResource(clientId) });

export async function permittedClient(
  context: Context<AppEnv>,
  action: Action,
  clientId = context.req.param('id') ?? '',
): Promise<Client> {
  const client = isId(clientId) ? await getClient(clientId) : undefined;
  if (!client || !(await canClient(context, 'client:read', clientId))) {
    throw new HttpError(404, 'not_found', 'Client not found');
  }
  if (action !== 'client:read' && !(await canClient(context, action, clientId))) {
    throw new HttpError(403, 'forbidden', 'You do not have permission to do this');
  }
  return client;
}

export async function permittedProject(
  context: Context<AppEnv>,
  action: Action,
  projectId = context.req.param('id') ?? '',
): Promise<Project> {
  const project = isId(projectId) ? await getProject(projectId) : undefined;
  const resource = project && {
    type: 'Project' as const,
    id: projectId,
    clientId: project.clientId,
  };
  if (
    !project ||
    !(await isAllowed(context.get('principal'), { action: 'project:read', resource: resource! }))
  ) {
    throw new HttpError(404, 'not_found', 'Project not found');
  }
  if (
    action !== 'project:read' &&
    !(await isAllowed(context.get('principal'), { action, resource: resource! }))
  ) {
    throw new HttpError(403, 'forbidden', 'You do not have permission to do this');
  }
  return project;
}
