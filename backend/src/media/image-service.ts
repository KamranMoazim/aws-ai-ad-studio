import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export const STABILITY_MODELS = {
  removeBackground: 'us.stability.stable-image-remove-background-v1:0',
  outpaint: 'us.stability.stable-outpaint-v1:0',
  styleGuide: 'us.stability.stable-image-style-guide-v1:0',
};

export interface Extension {
  left: number;
  right: number;
  up: number;
  down: number;
}

export interface ImageService {
  removeBackground(image: Buffer): Promise<Buffer>;
  outpaint(image: Buffer, extension: Extension): Promise<Buffer>;
  generateBackground(styleReference: Buffer, prompt: string, aspectRatio: string): Promise<Buffer>;
}

export class ImageServiceError extends Error {}

const NEGATIVE =
  'people, person, face, hands, body, text, letters, words, numbers, logo, watermark, signature, product, packaging, brand';

const bedrock = new BedrockRuntimeClient({});

async function invoke(modelId: string, body: Record<string, unknown>): Promise<Buffer> {
  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    }),
  );
  const payload = JSON.parse(new TextDecoder().decode(response.body)) as {
    images?: string[];
    finish_reasons?: Array<string | null>;
  };
  const reason = payload.finish_reasons?.[0];
  if (reason) {
    throw new ImageServiceError(
      reason === 'Filter reason: prompt'
        ? 'The request was blocked by the content filter'
        : `Image service: ${reason}`,
    );
  }
  if (!payload.images?.[0]) {
    throw new ImageServiceError('The image service returned no image');
  }
  return Buffer.from(payload.images[0], 'base64');
}

export const stabilityImageService: ImageService = {
  removeBackground: (image) =>
    invoke(STABILITY_MODELS.removeBackground, {
      image: image.toString('base64'),
      output_format: 'png',
    }),
  outpaint: (image, extension) =>
    invoke(STABILITY_MODELS.outpaint, {
      image: image.toString('base64'),
      ...extension,
      creativity: 0.4,
      output_format: 'jpeg',
    }),
  generateBackground: (styleReference, prompt, aspectRatio) =>
    invoke(STABILITY_MODELS.styleGuide, {
      image: styleReference.toString('base64'),
      prompt,
      negative_prompt: NEGATIVE,
      aspect_ratio: aspectRatio,
      fidelity: 0.6,
      output_format: 'jpeg',
    }),
};

export function extensionFor(
  width: number,
  height: number,
  targetRatio: number,
  maxSide = 2000,
): Extension {
  const current = width / height;
  if (Math.abs(current - targetRatio) < 0.01) {
    return { left: 0, right: 0, up: 0, down: 0 };
  }
  if (current > targetRatio) {
    const extra = Math.min(maxSide * 2, Math.round(width / targetRatio - height));
    return { left: 0, right: 0, up: Math.floor(extra / 2), down: Math.ceil(extra / 2) };
  }
  const extra = Math.min(maxSide * 2, Math.round(height * targetRatio - width));
  return { left: Math.floor(extra / 2), right: Math.ceil(extra / 2), up: 0, down: 0 };
}
