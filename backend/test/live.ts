import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomBytes } from 'node:crypto';
import { loadOutputs } from '../scripts/outputs.js';

export const outputs = loadOutputs();
const { createUser } = await import('../src/data/users.js');

const cognito = new CognitoIdentityProviderClient({ region: outputs.Region });
export const run = randomBytes(4).toString('hex');
const password = `Test-${randomBytes(9).toString('base64url')}1a!`;
export const testEmail = (label: string) =>
  `success+adstudio-${run}-${label}@simulator.amazonses.com`;

export async function token(email: string): Promise<string> {
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: outputs.UserPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );
  const response = await cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: outputs.UserPoolId,
      ClientId: outputs.UserPoolClientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );
  return response.AuthenticationResult!.AccessToken!;
}

export async function call(
  accessToken: string | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${outputs.ApiUrl}${path}`, {
    method,
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

export async function createTestUser(
  label: string,
  roleIds: string[],
  clientId?: string,
): Promise<{ userId: string; email: string }> {
  const email = testEmail(label);
  const created = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: outputs.UserPoolId,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
    }),
  );
  const userId = created.User!.Attributes!.find((attribute) => attribute.Name === 'sub')!.Value!;
  await createUser({
    userId,
    email,
    name: `Test ${label} ${run}`,
    type: clientId ? 'client' : 'staff',
    roleIds,
    clientId,
    status: 'active',
    createdAt: new Date().toISOString(),
  });
  return { userId, email };
}

export async function deleteCognitoUsers(emails: string[]): Promise<void> {
  for (const email of emails) {
    await cognito
      .send(new AdminDeleteUserCommand({ UserPoolId: outputs.UserPoolId, Username: email }))
      .catch(() => undefined);
  }
}
