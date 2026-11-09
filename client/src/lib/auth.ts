import { Amplify } from 'aws-amplify';
import {
  confirmResetPassword,
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  resetPassword,
  signIn,
  signOut,
} from 'aws-amplify/auth';
import type { AppConfig } from './config';

export function configureAuth(config: AppConfig): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        loginWith: { email: true },
      },
    },
  });
}

export type SignInStep = 'done' | 'new-password';

export async function startSignIn(email: string, password: string): Promise<SignInStep> {
  const result = await signIn({ username: email, password });
  if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
    return 'new-password';
  }
  if (!result.isSignedIn) {
    throw new Error(`Unsupported sign-in step: ${result.nextStep.signInStep}`);
  }
  return 'done';
}

export async function setNewPassword(password: string): Promise<void> {
  const result = await confirmSignIn({ challengeResponse: password });
  if (!result.isSignedIn) {
    throw new Error(`Unsupported sign-in step: ${result.nextStep.signInStep}`);
  }
}

export const requestPasswordReset = (email: string) => resetPassword({ username: email });

export const finishPasswordReset = (email: string, code: string, password: string) =>
  confirmResetPassword({ username: email, confirmationCode: code, newPassword: password });

export async function isSignedIn(): Promise<boolean> {
  try {
    await getCurrentUser();
    return true;
  } catch {
    return false;
  }
}

export async function accessToken(): Promise<string | undefined> {
  const session = await fetchAuthSession();
  return session.tokens?.accessToken?.toString();
}

export { signOut };
