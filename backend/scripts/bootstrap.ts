import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { loadOutputs } from './outputs.js';

const outputs = loadOutputs();
const { DEFAULT_ROLES } = await import('../src/authz/default-roles.js');
const { getRole, saveRole } = await import('../src/data/roles.js');
const { createUser, getUser } = await import('../src/data/users.js');

const email = process.argv[2]?.trim().toLowerCase();
const resetRoles = process.argv.includes('--reset-roles');
if (!email || !email.includes('@')) {
  console.error('usage: npm run bootstrap -- <super admin email> [--reset-roles]');
  process.exit(1);
}

for (const [roleId, role] of Object.entries(DEFAULT_ROLES)) {
  if (!resetRoles && (await getRole(roleId))) {
    console.log(`role ${roleId} exists`);
    continue;
  }
  await saveRole(roleId, role, true);
  console.log(`role ${roleId} saved`);
}

const cognito = new CognitoIdentityProviderClient({ region: outputs.Region });
const password = process.env.ADSTUDIO_PASSWORD;

async function existingSubject(): Promise<string | undefined> {
  try {
    const response = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: outputs.UserPoolId, Username: email }),
    );
    return response.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      return undefined;
    }
    throw error;
  }
}

let userId = await existingSubject();
if (!userId) {
  const response = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: outputs.UserPoolId,
      Username: email,
      MessageAction: password ? 'SUPPRESS' : undefined,
      DesiredDeliveryMediums: ['EMAIL'],
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
    }),
  );
  userId = response.User!.Attributes!.find((attribute) => attribute.Name === 'sub')!.Value!;
  console.log(
    password ? `created ${email}` : `invited ${email}; check the inbox for a temporary password`,
  );
}
if (password) {
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: outputs.UserPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );
}
if (!(await getUser(userId))) {
  await createUser({
    userId,
    email,
    name: 'Super Admin',
    type: 'staff',
    roleIds: ['super-admin'],
    status: 'active',
    createdAt: new Date().toISOString(),
  });
  console.log(`${email} is Super Admin`);
}
console.log(`sign in at ${outputs.SiteUrl}`);
