/* Types for the ported FSRS module (fsrs.js). The strict type check reads these instead of the untyped port;
   tsconfig.legacy.json checks fsrs.js itself, non-strict, until it is annotated. */
export interface CardState {
  S: number; D: number; due: string; reps: number; lapses?: number; last?: string; first?: string;
  stage?: number; streak?: number; learn?: number | null; relearn?: boolean; u?: number; hist?: [string, number, number, string, string][];
  [k: string]: unknown;
}
export interface ScheduleCtx { today: string; exam: string | null; phase: string; forecast?: (day: string) => number }
export interface Answer { g: 1 | 2 | 3 | 4; ms?: number; onTime?: boolean; mode?: string; flags?: string; logOnly?: boolean }
export const W: number[];
export function R(t: number, S: number): number;
export function Ron(rec: CardState | null | undefined, day: string): number;
export function interval(S: number, r: number): number;
export function init(g: number): { S: number; D: number };
export function next(rec: CardState, g: number, t: number): { S: number; D: number };
export function rate(o: Record<string, unknown>): 1 | 2 | 3 | 4;
export function schedule(rec: CardState | null, o: Answer, ctx: ScheduleCtx, now?: number): { rec: CardState | null; reinsert: null | 'learn' | 'lapse'; wrote: boolean };
export function dueFor(S: number, ctx: ScheduleCtx): string;
export function D0(g: number): number;
export function recap(store: Record<string, { due?: string; reps?: number }>, ctx: { today: string; exam: string | null; phase: string }): Record<string, string>;
declare const api: { W: typeof W; R: typeof R; Ron: typeof Ron; interval: typeof interval; init: typeof init; next: typeof next; rate: typeof rate; schedule: typeof schedule; dueFor: typeof dueFor; D0: typeof D0; recap: typeof recap };
export default api;
