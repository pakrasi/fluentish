// Practice's rows for Today's plan, as the registry's providers give them (not a test itself). Practice is split into
// sibling features (round 3, ARCHITECTURE §2), each with its own plan.js; the tests that read Practice's whole offer
// read it from here. Order does not matter: domain/today.js sorts by priority, then id.
import * as R from '../../src/features/practice-round/plan.js';
import * as W from '../../src/features/practice-write/plan.js';
import * as S from '../../src/features/practice-speak/plan.js';
import * as Sc from '../../src/features/practice-script/plan.js';
import * as Cl from '../../src/features/practice-clusters/plan.js';

export const PROVIDERS = [R, W, S, Sc, Cl];

/** @param {any} ctx a PlanCtx @returns {any[]} */
export const planItems = ctx => PROVIDERS.flatMap(p => p.planItems(ctx));

export { todayBudget, simToday, clusterToday, dueTomorrow, roundAction, writingTask } from '../../src/domain/allowance.js';
