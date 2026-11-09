import type Konva from 'konva';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  checkContent,
  contentForSize,
  elementText,
  fitElement,
  type Content,
  type LintIssue,
  type SafeZone,
  type SizeKey,
  type Template,
} from '../../../shared/src/index';
import { AdStage } from '../renderer/AdStage';
import { ensureFonts } from '../renderer/fonts';
import { measureText } from '../renderer/measure';
import { loadImage } from '../renderer/useImage';

export interface RenderInput {
  template: Template;
  content: Content;
  size: SizeKey;
  images: Record<string, string>;
  safeZone: SafeZone;
}

export interface RenderOutput {
  dataUrl: string;
  issues: LintIssue[];
  layout: Record<string, { fontSize: number; lines: string[] }>;
}

const IMAGE_WAIT_MS = 10_000;
const root = createRoot(document.getElementById('root')!);

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

async function waitForImages(stage: Konva.Stage, expected: number): Promise<void> {
  const deadline = Date.now() + IMAGE_WAIT_MS;
  while (stage.find('Image').length < expected) {
    if (Date.now() > deadline) {
      throw new Error('images did not load');
    }
    await nextFrame();
  }
  await nextFrame();
}

async function renderAd(input: RenderInput): Promise<RenderOutput> {
  await ensureFonts();
  const content = contentForSize(input.content, input.size);
  const layout = input.template.layouts[input.size]!;
  const sources = layout.elements
    .filter((element) => element.type === 'image' && !element.hidden && element.bind)
    .map((element) => content.images[element.bind!]?.src)
    .filter((src): src is string => Boolean(src && input.images[src]));
  await Promise.all(sources.map((src) => loadImage(input.images[src])));
  let stage: Konva.Stage | null = null;
  flushSync(() =>
    root.render(
      <AdStage
        ref={(node) => {
          stage = node;
        }}
        template={input.template}
        size={input.size}
        content={content}
        scale={1}
        imageUrl={(src) => input.images[src]}
      />,
    ),
  );
  await waitForImages(stage!, sources.length);
  const issues = checkContent(input.template, input.content, {
    safeZone: input.safeZone,
    measure: measureText,
  }).filter((issue) => issue.size === input.size);
  const layoutOf: RenderOutput['layout'] = {};
  for (const element of layout.elements) {
    if (!element.hidden && (element.type === 'text' || element.type === 'button')) {
      const fit = fitElement(input.template, element, elementText(element, content), measureText);
      layoutOf[element.id] = { fontSize: fit.fontSize, lines: fit.lines };
    }
  }
  return {
    dataUrl: stage!.toDataURL({ mimeType: 'image/png', pixelRatio: 1 }),
    issues,
    layout: layoutOf,
  };
}

async function checkAd(input: Omit<RenderInput, 'size' | 'images'>): Promise<LintIssue[]> {
  await ensureFonts();
  return checkContent(input.template, input.content, {
    safeZone: input.safeZone,
    measure: measureText,
  });
}

Object.assign(window, { renderAd, checkAd });
