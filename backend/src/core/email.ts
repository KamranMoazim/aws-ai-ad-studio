import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { HttpError } from './http-error.js';

const sesClient = new SESv2Client({});

export async function sendEmail(input: {
  to: string;
  fromName: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const sender = process.env.SENDER_EMAIL;
  if (!sender) {
    throw new HttpError(
      503,
      'email_unavailable',
      'Email is not set up yet; download from the app instead',
    );
  }
  const fromName = input.fromName.replace(/["<>\r\n]/g, '').slice(0, 60);
  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: `"${fromName}" <${sender}>`,
      Destination: { ToAddresses: [input.to] },
      Content: {
        Simple: {
          Subject: { Data: input.subject },
          Body: { Html: { Data: input.html }, Text: { Data: input.text } },
        },
      },
    }),
  );
}

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
