import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { HttpError } from './http-error.js';

const cognitoClient = new CognitoIdentityProviderClient({});
const userPoolId = () => process.env.USER_POOL_ID!;

export async function inviteCognitoUser(email: string): Promise<string> {
  try {
    const response = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId(),
        Username: email,
        DesiredDeliveryMediums: ['EMAIL'],
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    );
    const subject = response.User?.Attributes?.find((attribute) => attribute.Name === 'sub');
    return subject!.Value!;
  } catch (error) {
    if (error instanceof UsernameExistsException) {
      throw new HttpError(409, 'conflict', 'A user with this email already exists');
    }
    throw error;
  }
}

export async function setCognitoUserEnabled(email: string, enabled: boolean): Promise<void> {
  const Command = enabled ? AdminEnableUserCommand : AdminDisableUserCommand;
  await cognitoClient.send(new Command({ UserPoolId: userPoolId(), Username: email }));
}

export async function hasTotp(email: string): Promise<boolean> {
  const response = await cognitoClient.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId(), Username: email }),
  );
  return (response.UserMFASettingList ?? []).includes('SOFTWARE_TOKEN_MFA');
}
