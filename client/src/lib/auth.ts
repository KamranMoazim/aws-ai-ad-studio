import { Amplify } from 'aws-amplify';
import {
  confirmResetPassword,
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  resetPassword,
  setUpTOTP,
  signIn,
  signOut,
  updateMFAPreference,
  verifyTOTPSetup,
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

export type SignInStep = 'done' | 'new-password' | 'totp';

function stepOf(result: Awaited<ReturnType<typeof signIn>>): SignInStep {
  switch (result.nextStep.signInStep) {
    case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
      return 'new-password';
    case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
      return 'totp';
    case 'DONE':
      return 'done';
    default:
      throw new Error(`Unsupported sign-in step: ${result.nextStep.signInStep}`);
  }
}

export async function startSignIn(email: string, password: string): Promise<SignInStep> {
  return stepOf(await signIn({ username: email, password }));
}

export async function setNewPassword(password: string): Promise<SignInStep> {
  return stepOf(await confirmSignIn({ challengeResponse: password }));
}

export async function submitTotpCode(code: string): Promise<SignInStep> {
  return stepOf(await confirmSignIn({ challengeResponse: code }));
}

export async function beginTotpSetup(appName: string, email: string): Promise<string> {
  const details = await setUpTOTP();
  return details.getSetupUri(appName, email).toString();
}

export async function finishTotpSetup(code: string): Promise<void> {
  await verifyTOTPSetup({ code });
  await updateMFAPreference({ totp: 'PREFERRED' });
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
