export interface FontSpec {
  family: string;
  weight: number;
  size: number;
  letterSpacing: number;
}

export type MeasureText = (text: string, font: FontSpec) => number;

export interface FitInput {
  text: string;
  width: number;
  height: number;
  family: string;
  weight: number;
  fontSize: number;
  minFontSize: number;
  lineHeight: number;
  letterSpacing: number;
  maxLines: number;
  mode: 'shrink' | 'clamp';
}

export interface FitResult {
  lines: string[];
  fontSize: number;
  fits: boolean;
  truncated: boolean;
}

const ELLIPSIS = '...';

function breakWord(word: string, maxWidth: number, measure: MeasureText, font: FontSpec): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const character of Array.from(word)) {
    if (current && measure(current + character, font) > maxWidth) {
      pieces.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) {
    pieces.push(current);
  }
  return pieces;
}

export function wrapText(
  text: string,
  maxWidth: number,
  measure: MeasureText,
  font: FontSpec,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, font) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
      }
      if (measure(word, font) <= maxWidth) {
        line = word;
        continue;
      }
      const pieces = breakWord(word, maxWidth, measure, font);
      lines.push(...pieces.slice(0, -1));
      line = pieces[pieces.length - 1] ?? '';
    }
    lines.push(line);
  }
  return lines;
}

function truncate(
  lines: string[],
  count: number,
  maxWidth: number,
  measure: MeasureText,
  font: FontSpec,
) {
  const kept = lines.slice(0, Math.max(count, 1));
  let last = kept[kept.length - 1];
  while (last && measure(last + ELLIPSIS, font) > maxWidth) {
    last = last.slice(0, -1).trimEnd();
  }
  kept[kept.length - 1] = last + ELLIPSIS;
  return kept;
}

export function fitText(input: FitInput, measure: MeasureText): FitResult {
  const fontAt = (size: number): FontSpec => ({
    family: input.family,
    weight: input.weight,
    size,
    letterSpacing: input.letterSpacing,
  });
  const linesThatFit = (size: number) =>
    Math.min(input.maxLines, Math.floor(input.height / (size * input.lineHeight) + 1e-6));

  if (!input.text.trim()) {
    return { lines: [], fontSize: input.fontSize, fits: true, truncated: false };
  }
  if (input.mode === 'clamp') {
    const font = fontAt(input.fontSize);
    const lines = wrapText(input.text, input.width, measure, font);
    const allowed = linesThatFit(input.fontSize);
    if (lines.length <= allowed) {
      return { lines, fontSize: input.fontSize, fits: true, truncated: false };
    }
    return {
      lines: truncate(lines, allowed, input.width, measure, font),
      fontSize: input.fontSize,
      fits: allowed >= 1,
      truncated: true,
    };
  }
  const smallest = Math.max(1, Math.min(input.minFontSize, input.fontSize));
  for (let size = input.fontSize; size >= smallest; size--) {
    const lines = wrapText(input.text, input.width, measure, fontAt(size));
    if (lines.length <= linesThatFit(size)) {
      return { lines, fontSize: size, fits: true, truncated: false };
    }
  }
  return {
    lines: wrapText(input.text, input.width, measure, fontAt(smallest)),
    fontSize: smallest,
    fits: false,
    truncated: false,
  };
}
