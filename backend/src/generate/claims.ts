import { CONFIRM_PLACEHOLDER } from '../../../shared/src/index.js';

const CLAIM_WORDS = [
  'free',
  'guarantee',
  'guaranteed',
  'best',
  'cheapest',
  'lowest',
  'number one',
  '#1',
  'award',
  'award-winning',
  'certified',
  'top-rated',
  'save',
  'discount',
  'sale',
  'off',
  'deal',
  'only',
  'limited',
  'today only',
];
const BANNED = ['guaranteed results', 'risk-free', 'miracle', 'cure', '100%'];
const NUMBER = /\d+(?:[.,]\d+)*/g;

export interface ClaimProblem {
  kind: 'number' | 'claim' | 'banned';
  value: string;
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ');

export function claimProblems(text: string, facts: string[]): ClaimProblem[] {
  if (text.includes(CONFIRM_PLACEHOLDER)) {
    return [];
  }
  const corpus = normalize(facts.join(' \n '));
  const lower = normalize(text);
  const problems: ClaimProblem[] = [];
  for (const number of lower.match(NUMBER) ?? []) {
    if (!corpus.includes(number)) {
      problems.push({ kind: 'number', value: number });
    }
  }
  for (const symbol of ['%', '$', '£', '€']) {
    if (lower.includes(symbol) && !corpus.includes(symbol)) {
      problems.push({ kind: 'number', value: symbol });
    }
  }
  for (const word of CLAIM_WORDS) {
    const pattern = new RegExp(
      `(^|[^a-z0-9#])${word.replace(/[#-]/g, (character) => `\\${character}`)}([^a-z0-9]|$)`,
    );
    if (pattern.test(lower) && !pattern.test(corpus)) {
      problems.push({ kind: 'claim', value: word });
    }
  }
  for (const phrase of BANNED) {
    if (lower.includes(phrase)) {
      problems.push({ kind: 'banned', value: phrase });
    }
  }
  return problems;
}
