import type { CustomMessageTriggerEvent } from 'aws-lambda';
import { getSettings } from '../data/settings.js';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

export async function handler(event: CustomMessageTriggerEvent) {
  const settings = await getSettings();
  const appName = escapeHtml(settings.appName);
  const siteUrl = process.env.SITE_URL ?? '';
  const { codeParameter, usernameParameter } = event.request;

  if (event.triggerSource === 'CustomMessage_AdminCreateUser') {
    event.response.emailSubject = `You're invited to ${settings.appName}`;
    event.response.emailMessage = [
      `<p>You have been invited to ${appName}.</p>`,
      `<p>Sign in at <a href="${siteUrl}">${siteUrl}</a> with:</p>`,
      `<p>Email: ${usernameParameter}<br>Temporary password: ${codeParameter}</p>`,
      '<p>You will be asked to choose your own password. The temporary password expires in 7 days.</p>',
    ].join('');
  } else if (event.triggerSource === 'CustomMessage_ForgotPassword') {
    event.response.emailSubject = `Reset your ${settings.appName} password`;
    event.response.emailMessage = `<p>Your ${appName} password reset code is ${codeParameter}.</p>`;
  }
  return event;
}
