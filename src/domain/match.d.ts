/* Types for the ported answer matcher (match.js), for the strict modules that import it (domain/wordbuild-grade.js).
   tsconfig.legacy.json checks match.js itself, non-strict, until it is annotated. Only what strict code uses. */
export interface Word { raw: string; low: string; n: string; len: number; start: number; end: number }
export interface Slip { typed: string; expected: string; start: number; end: number }
export interface CheckResult {
  ok: boolean; exact: boolean; close: boolean; articleMiss: boolean; caseMiss: boolean; matched: string | null; others: string[];
  fixed: string; typos: Slip[]; input: string; umlautMiss?: Slip[]; capMiss?: Slip[]; focusMiss?: Slip[]; nearest?: number | null;
  span?: [number, number] | null; fills?: string[];
}
export interface CheckOptions {
  pos?: string; strictCase?: boolean; slots?: boolean; anywhere?: boolean; typos?: boolean; loose?: Iterable<string>;
  slotMax?: number; endings?: boolean; umlaut?: boolean; strict?: string[]; caseRef?: Map<string, string>; never?: Iterable<string>; lexicon?: Set<string> | null;
}
export function check(input: string, accepted: string | string[], opts?: CheckOptions): CheckResult;
export function words(s: string, offset?: number): Word[];
export function fold(s: string): string;
export function diffWords(a: string, b: string): { wrong: { start: number; end: number; word: string }[]; missing: number[]; right: Word[] };
declare const api: { check: typeof check; words: typeof words; fold: typeof fold; diffWords: typeof diffWords };
export default api;
