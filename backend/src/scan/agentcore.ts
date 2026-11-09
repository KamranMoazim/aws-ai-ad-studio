import {
  BedrockAgentCoreClient,
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { SignatureV4 } from '@smithy/signature-v4';
import puppeteer, { type Browser } from 'puppeteer-core';

export const MANAGED_BROWSER = 'aws.browser.v1';
const SESSION_SECONDS = 300;

const agentCore = new BedrockAgentCoreClient({});

async function signedHeaders(endpoint: string): Promise<Record<string, string>> {
  const url = new URL(endpoint);
  const signer = new SignatureV4({
    service: 'bedrock-agentcore',
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: defaultProvider(),
    sha256: Sha256,
  });
  const signed = await signer.sign({
    method: 'GET',
    protocol: 'https:',
    hostname: url.hostname,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: { host: url.hostname },
  });
  return signed.headers as Record<string, string>;
}

export async function withManagedBrowser<T>(
  name: string,
  work: (browser: Browser) => Promise<T>,
): Promise<T> {
  const session = await agentCore.send(
    new StartBrowserSessionCommand({
      browserIdentifier: MANAGED_BROWSER,
      name,
      sessionTimeoutSeconds: SESSION_SECONDS,
      viewPort: { width: 1280, height: 800 },
    }),
  );
  const endpoint = session.streams?.automationStream?.streamEndpoint;
  try {
    if (!endpoint) {
      throw new Error('browser session has no automation stream');
    }
    const browser = await puppeteer.connect({
      browserWSEndpoint: endpoint,
      headers: await signedHeaders(endpoint),
      defaultViewport: null,
    });
    try {
      return await work(browser);
    } finally {
      await browser.disconnect().catch(() => undefined);
    }
  } finally {
    await agentCore
      .send(
        new StopBrowserSessionCommand({
          browserIdentifier: MANAGED_BROWSER,
          sessionId: session.sessionId,
        }),
      )
      .catch(() => undefined);
  }
}
