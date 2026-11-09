import type Konva from 'konva';
import {
  DISPLAY_MAX_BYTES,
  lintTemplate,
  SIZES,
  sizesForChannel,
  type LintIssue,
  type SafeZone,
  type SizeKey,
  type Template,
} from '../../../../shared/src/index';
import { measureText } from '../../renderer/measure';

const LOWEST_QUALITY = 0.6;

function jpegBytes(stage: Konva.Stage, size: SizeKey): Promise<number> {
  const pixelRatio = SIZES[size].width / stage.width();
  return new Promise((resolve, reject) => {
    stage
      .toBlob({ mimeType: 'image/jpeg', quality: LOWEST_QUALITY, pixelRatio })
      .then((blob) => (blob ? resolve((blob as Blob).size) : reject(new Error('render failed'))))
      .catch(reject);
  });
}

export async function lintInBrowser(
  template: Template,
  safeZone: SafeZone,
  stages: Partial<Record<SizeKey, Konva.Stage | null>>,
): Promise<LintIssue[]> {
  const issues = lintTemplate(template, { safeZone, measure: measureText });
  for (const size of sizesForChannel(template.channel)) {
    const stage = stages[size];
    if (SIZES[size].channel !== 'display' || !stage) {
      continue;
    }
    try {
      const bytes = await jpegBytes(stage, size);
      if (bytes > DISPLAY_MAX_BYTES) {
        issues.push({
          code: 'file-size',
          severity: 'error',
          size,
          message: `${Math.round(bytes / 1024)} KB at JPEG quality ${LOWEST_QUALITY * 100}; display ads must be 150 KB or less`,
        });
      }
    } catch (error) {
      issues.push({
        code: 'file-size',
        severity: 'error',
        size,
        message: `Could not test the file size: ${(error as Error).message}`,
      });
    }
  }
  return issues;
}
