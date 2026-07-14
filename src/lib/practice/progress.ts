import type { SimGraph } from '../sim/types';

/**
 * Practice-mode attempt tracking (SPEC-PRACTICE.md §6). Entirely client-side
 * (no auth, no server) — one localStorage blob keyed by question id. Every
 * helper guards `typeof window === 'undefined'` so this module is safe to
 * import from server components / tests.
 */

export type QuestionStatus = 'todo' | 'attempted' | 'solved';

export interface QuestionProgress {
  status: QuestionStatus;
  bestScore: number;
  /** The user's last submitted graph JSON (for "resume where I left off"). */
  lastGraph: SimGraph | null;
  solutionViewed: boolean;
}

export type ProgressMap = Record<string, QuestionProgress>;

const STORAGE_KEY = 'chaoslab.practice.v1';

const DEFAULT_PROGRESS: QuestionProgress = {
  status: 'todo',
  bestScore: 0,
  lastGraph: null,
  solutionViewed: false,
};

function readAll(): ProgressMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ProgressMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: ProgressMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage can throw (quota, private mode) — best-effort persistence.
  }
}

/** Every question's progress, keyed by question id (missing entries omitted). */
export function getAllProgress(): ProgressMap {
  return readAll();
}

/** A single question's progress, defaulted to the "never attempted" shape. */
export function getProgress(questionId: string): QuestionProgress {
  const all = readAll();
  return all[questionId] ?? { ...DEFAULT_PROGRESS };
}

/**
 * Record a graded submission: bumps bestScore (never down), stores the
 * submitted graph, and promotes status — 'solved' is sticky (a later,
 * non-accepted resubmission attempt on an already-solved question does not
 * un-solve it).
 */
export function recordAttempt(questionId: string, graph: SimGraph, score: number, accepted: boolean): QuestionProgress {
  const all = readAll();
  const prev = all[questionId] ?? { ...DEFAULT_PROGRESS };
  const next: QuestionProgress = {
    status: accepted || prev.status === 'solved' ? 'solved' : 'attempted',
    bestScore: Math.max(prev.bestScore, score),
    lastGraph: graph,
    solutionViewed: prev.solutionViewed,
  };
  all[questionId] = next;
  writeAll(all);
  return next;
}

/** Mark that the user has revealed the optimal solution (the "give up" flow). */
export function markSolutionViewed(questionId: string): QuestionProgress {
  const all = readAll();
  const prev = all[questionId] ?? { ...DEFAULT_PROGRESS };
  const next: QuestionProgress = {
    ...prev,
    solutionViewed: true,
    status: prev.status === 'solved' ? 'solved' : 'attempted',
  };
  all[questionId] = next;
  writeAll(all);
  return next;
}
