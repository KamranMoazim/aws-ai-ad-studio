import type { Context } from 'hono';
import { isAllowed } from '../authz/authorize.js';
import { clientResource, ORG } from '../authz/entities.js';
import type { Action } from '../authz/schema.js';
import { HttpError } from '../core/http-error.js';
import { isId } from '../core/ids.js';
import type { Client } from '../core/schemas.js';
import { getClient } from '../data/clients.js';
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
