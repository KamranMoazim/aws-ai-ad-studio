import AnthropicBedrock, { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_KEY_PARAMETER, getSecret } from './ssm.js';

export type ClaudeProvider = 'bedrock' | 'bedrock-legacy' | 'anthropic';
export type ClaudeClient = Anthropic | AnthropicBedrockMantle | AnthropicBedrock;
export type ClaudeRole = 'scan' | 'copy' | 'draft';

export const CLAUDE_MODELS: Record<ClaudeProvider, Record<ClaudeRole, string>> = {
  bedrock: {
    scan: 'anthropic.claude-haiku-5-5',
    copy: 'anthropic.claude-sonnet-5-5',
    draft: 'anthropic.claude-haiku-5-5',
  },
  'bedrock-legacy': {
    scan: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    copy: 'us.anthropic.claude-sonnet-4-6',
    draft: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  },
  anthropic: { scan: 'claude-haiku-5-5', copy: 'claude-sonnet-5-5', draft: 'claude-haiku-5-5' },
};

const NO_EFFORT = /haiku-4-5/;
let cached: Promise<ClaudeClient> | undefined;

export function claudeProvider(): ClaudeProvider {
  const value = process.env.CLAUDE_PROVIDER;
  return value === 'anthropic' || value === 'bedrock-legacy' ? value : 'bedrock';
}

export const claudeModel = (role: ClaudeRole) => CLAUDE_MODELS[claudeProvider()][role];

export const supportsEffort = (model: string) => !NO_EFFORT.test(model);

async function create(): Promise<ClaudeClient> {
  const awsRegion = process.env.AWS_REGION ?? 'us-east-1';
  const provider = claudeProvider();
  if (provider === 'bedrock') {
    return new AnthropicBedrockMantle({ awsRegion });
  }
  if (provider === 'bedrock-legacy') {
    return new AnthropicBedrock({ awsRegion });
  }
  const apiKey = await getSecret(ANTHROPIC_KEY_PARAMETER);
  if (!apiKey) {
    throw new Error('the Anthropic API key is not set; run npm run claude:key');
  }
  return new Anthropic({ apiKey, maxRetries: 2 });
}

export function claude(): Promise<ClaudeClient> {
  cached ??= create();
  cached.catch(() => (cached = undefined));
  return cached;
}
