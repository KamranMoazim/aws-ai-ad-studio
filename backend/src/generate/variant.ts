import {
  CONFIRM_PLACEHOLDER,
  contentForSize,
  sizesForChannel,
  type Content,
  type LintIssue,
  type SafeZone,
  type SizeKey,
  type Template,
} from '../../../shared/src/index.js';
import { claimProblems } from './claims.js';
import type { WrittenCopy } from './copy.js';

export type FitChecker = (
  template: Template,
  content: Content,
  safeZone: SafeZone,
) => Promise<LintIssue[]>;

const FIT_CODES = new Set(['overflow', 'max-chars', 'truncated']);

export function applyCopy(
  template: Template,
  copy: WrittenCopy,
  base: Omit<Content, 'texts' | 'textOverrides'>,
): Content {
  const sizes = sizesForChannel(template.channel);
  const texts: Record<string, string> = {};
  const textOverrides: Partial<Record<SizeKey, Record<string, string>>> = {};
  for (const slot of template.slots.filter((candidate) => candidate.kind === 'text')) {
    const written = copy.slots.find((entry) => entry.key === slot.key);
    texts[slot.key] = written?.text.trim() || (slot.required ? CONFIRM_PLACEHOLDER : '');
    for (const shorter of written?.shorter ?? []) {
      if (sizes.includes(shorter.size as SizeKey) && shorter.text.trim()) {
        textOverrides[shorter.size as SizeKey] = {
          ...(textOverrides[shorter.size as SizeKey] ?? {}),
          [slot.key]: shorter.text.trim(),
        };
      }
    }
  }
  return { ...base, texts, textOverrides };
}

export interface Problem {
  slot: string;
  size?: SizeKey;
  message: string;
}

export function problemsOf(
  template: Template,
  content: Content,
  issues: LintIssue[],
  facts: string[],
): Problem[] {
  const problems: Problem[] = [];
  const sizes = sizesForChannel(template.channel);
  const elementSlot = (size: SizeKey | undefined, elementId: string | undefined) =>
    size && elementId
      ? template.layouts[size]?.elements.find((element) => element.id === elementId)?.bind
      : undefined;
  for (const issue of issues.filter(
    (item) => FIT_CODES.has(item.code) && item.severity === 'error',
  )) {
    const slot = elementSlot(issue.size, issue.elementId);
    if (slot) {
      problems.push({ slot, size: issue.size, message: issue.message });
    }
  }
  for (const size of sizes) {
    for (const [slot, text] of Object.entries(contentForSize(content, size).texts)) {
      for (const problem of claimProblems(text, facts)) {
        if (
          !problems.some(
            (existing) => existing.slot === slot && existing.message.includes(problem.value),
          )
        ) {
          problems.push({
            slot,
            message: `"${text}" makes an unsupported ${problem.kind} claim: ${problem.value}`,
          });
        }
      }
    }
  }
  return problems;
}

export function confirmProblems(
  content: Content,
  problems: Problem[],
): { content: Content; confirmed: string[] } {
  const next: Content = {
    ...content,
    texts: { ...content.texts },
    textOverrides: Object.fromEntries(
      Object.entries(content.textOverrides ?? {}).map(([size, texts]) => [size, { ...texts }]),
    ),
  };
  const confirmed = new Set<string>();
  for (const problem of problems) {
    if (problem.size && !problem.message.includes('claim')) {
      next.textOverrides![problem.size] = {
        ...(next.textOverrides![problem.size] ?? {}),
        [problem.slot]: CONFIRM_PLACEHOLDER,
      };
    } else {
      next.texts[problem.slot] = CONFIRM_PLACEHOLDER;
      for (const texts of Object.values(next.textOverrides ?? {})) {
        delete texts![problem.slot];
      }
    }
    confirmed.add(problem.slot);
  }
  return { content: next, confirmed: [...confirmed] };
}

export const describeProblems = (problems: Problem[]) =>
  problems
    .map(
      (problem) =>
        `- ${problem.slot}${problem.size ? ` at ${problem.size}` : ''}: ${problem.message}`,
    )
    .join('\n');
