# ChaosLab Practice Mode — "LeetCode for System Design" (Spec v1)

Extends the MVP (see SPEC.md) with a question-driven practice experience. Users pick a classic system design question, build their answer in the playground, hit **Submit**, and get graded by a rubric evaluated against their graph JSON **and** a live simulation run at the question's target load. After grading, the optimal solution graph + reasoning writeup unlocks.

Everything stays client-side and open (no auth). Attempt state in localStorage.

---

## 1. Philosophy → mechanics

"Match submitted JSON against expected JSON" is implemented as **property matching, not shape matching**: the expected answer is a rubric of declarative checks over the submitted `SimGraph` and its `SimResult` at target load. Many topologies can pass; the rubric encodes what actually matters (the ideas), and each check carries teaching feedback for both pass and fail. Scoring is out of 100; **score ≥ 75 = Accepted** (LeetCode-style), below = "Not yet — see feedback".

## 2. Directory layout (new files only)

```
src/lib/practice/
  types.ts        // Question, RubricCheck, GradeReport (§3)
  grader.ts       // evaluate(question, graph) -> GradeReport (§4)
  questions/
    index.ts      // export QUESTIONS: Question[] (ordered easy→hard)
    url-shortener.ts, news-feed.ts, ...   // one file per question (§5)
  progress.ts     // localStorage attempt/solved tracking (§6)
src/app/practice/[id]/page.tsx            // question workspace (§8)
src/components/practice/                  // QuestionPanel, RubricResults, SolutionView, SubmitBar, QuestionCard, ...
docs/research/common-questions.md         // research dossier (source of truth for content)
```

## 3. Types — `src/lib/practice/types.ts`

```ts
import type { SimGraph, SimResult, ComponentKind, NodeConfig, GlobalConfig, SimNode, SimEdge } from '../sim/types';

export type Difficulty = 'easy' | 'medium' | 'hard';

// Declarative check — pure data, evaluated by grader.ts. NO functions in question files.
export type RubricCheck =
  | { type: 'has-kind'; kind: ComponentKind; min?: number; max?: number }
  | { type: 'path'; from: ComponentKind; to: ComponentKind }        // directed path exists through the graph
  | { type: 'direct-edge'; from: ComponentKind; to: ComponentKind } // some edge directly connects the kinds
  | { type: 'config'; kind: ComponentKind; key: keyof NodeConfig; op: 'gte' | 'lte' | 'eq'; value: number | string; anyNode?: boolean } // default: at least one node of kind satisfies
  | { type: 'sim'; metric: 'availability' | 'p99Ms' | 'p50Ms' | 'costPerMonth' | 'verdict-healthy' | 'no-overloaded-nodes'; op: 'gte' | 'lte' | 'eq'; value: number | boolean }
  | { type: 'not-kind'; kind: ComponentKind }                       // anti-pattern: this kind should NOT be present
  ;

export interface RubricItem {
  id: string;
  label: string;              // short, shown in results list
  points: number;             // all items sum to 100
  check: RubricCheck;
  why: string;                // 1-2 sentences of teaching rationale, shown pass or fail
  failHint: string;           // actionable nudge shown only on fail
}

export interface Question {
  id: string;                 // kebab-case slug, route param
  title: string;              // "Design a URL Shortener"
  difficulty: Difficulty;
  tags: string[];             // 'caching' | 'sharding' | 'async' | 'fan-out' | ...
  statement: string;          // markdown: scenario + functional requirements
  scale: string;              // markdown bullet block: DAU, r/w ratio, budgets (rendered under statement)
  targetLoad: GlobalConfig;   // users/rpsPerUser/readWriteRatio the grader simulates at
  budgets: { availability: number; p99Ms: number; costPerMonth: number }; // surfaced in UI; rubric sim checks should align
  hints: string[];            // progressive, revealed one at a time
  rubric: RubricItem[];
  solution: {
    nodes: SimNode[]; edges: SimEdge[]; positions: Record<string, {x:number;y:number}>;
    writeup: string;          // markdown: the ideas behind the design, interview narrative
    keyInsights: string[];    // 4-6 bullets
    sources?: { label: string; url: string }[];
  };
}

export interface GradeItemResult { item: RubricItem; passed: boolean; }
export interface GradeReport {
  score: number;              // 0-100
  accepted: boolean;          // score >= 75
  items: GradeItemResult[];
  sim: SimResult;             // at targetLoad, for the results panel
  gradedAt: number;
}
```

## 4. Grader — `src/lib/practice/grader.ts`

`evaluate(question, graph: SimGraph): GradeReport`. Steps:
1. Replace `graph.global` with `question.targetLoad` (submission is graded at target load regardless of the user's slider position).
2. Run `solve()` once.
3. Evaluate each RubricCheck (pure functions per check type; `path` = BFS over edges between any node of `from` kind to any of `to` kind; `config` compares against node config *with catalog defaults applied*; `sim` reads SimResult totals; `no-overloaded-nodes` = no node with health 'overloaded'/'down').
4. Sum points, build report. Deterministic, no side effects.

Also export `validateQuestion(q)` used by tests: rubric points sum to 100, solution graph passes its own rubric with score 100, and solution simulates HEALTHY at targetLoad.

## 5. Question files

One file per question exporting a `Question`. Content comes from `docs/research/common-questions.md` — statements, insights, mistakes→rubric feedback, solutions. Solutions must be TUNED against the real engine (tests enforce). 12 questions, ordered easy→hard in `questions/index.ts`.

## 6. Progress — `src/lib/practice/progress.ts`

localStorage `chaoslab.practice.v1`: per question id → { status: 'todo'|'attempted'|'solved', bestScore, lastGraph (their last submitted graph JSON), solutionViewed }. Helpers: `getProgress`, `recordAttempt`, `markSolutionViewed`. Guard `typeof window`.

## 7. Landing page restructure

Modules grid is REPLACED by a practice-first layout (hero stays):
1. **Questions section** (primary): LeetCode-style list — each row: status icon (○ todo / ◐ attempted / ● solved, green when solved), title, difficulty chip (green/amber/red), tags, best score. Click → `/practice/[id]`. A small filter row (All / difficulty) is nice-to-have, only if cheap.
2. **Templates section**: the 6 existing presets as cards (name, tagline from their explanation, mini description) → link to `/lab/backend?preset=<id>`; the lab opens with that preset loaded + explanation panel open (Toolbar reads the query param on mount — tiny store/page change).
3. **Sandbox card**: "Free play — blank canvas" → `/lab/backend`.
The old "coming soon" modules become a single muted footnote row ("More arenas coming: Frontend Delivery · LLM Inference · Realtime"), not cards.

## 8. Question workspace — `/practice/[id]`

Split layout, same header family as the lab:
- **Left panel** (~420px, resizable optional, collapsible): tabs **Problem | Hints | Results | Solution**.
  - *Problem*: title, difficulty+tags, statement markdown, scale/budget block (target users, availability/p99/cost budgets shown as chips).
  - *Hints*: N hints, blur-hidden, "reveal" one at a time.
  - *Results*: after submit — big score dial/number, Accepted banner or "Not yet", rubric list grouped pass/fail (each with label, points, why, failHint on fails), sim summary at target load (availability, p99, cost vs budgets).
  - *Solution*: LOCKED until accepted OR user clicks "Give up & reveal" (confirm dialog; marks solutionViewed, question can no longer flip to solved on this attempt... keep simple: still gradeable but flagged). Contains writeup markdown, key insights, sources, and a **"Load optimal solution onto canvas"** button (saves user's current graph to progress first, then loads solution graph+positions with fitView).
- **Right**: the standard playground canvas (palette, inspector, context menu, particles — full reuse of existing components). The user-load slider REMAINS usable for experimentation, but a small chip notes "Graded at <target> users". Metrics bar stays.
- **Submit bar**: prominent Submit button (top toolbar area right side, accent) → runs grader, switches left panel to Results, records attempt, confetti-free (keep it classy — verdict banner is enough).
- Canvas state per question: autosave to `chaoslab.practice.graph.<id>` so switching questions doesn't clobber the sandbox or other attempts. Entering a question with no saved graph starts with ONLY a Users node placed.

Store: reuse `useLabStore` — add a `mode: 'sandbox' | 'practice'` + `activeQuestionId` (additive) so autosave targets the right key; alternatively a parallel narrow store — implementer's choice, but do NOT duplicate the canvas components.

## 9. Testing

`src/lib/practice/practice.test.ts`: for every question — rubric sums to 100, solution passes own rubric at 100, solution HEALTHY at target load, all check kinds referenced exist in catalog, ids unique. Grader unit tests per check type incl. defaults-applied config checks and the path BFS.

## 10. Non-goals (v1)

No auth/server, no timers, no partial-credit curves beyond point sums, no free-text grading, no per-user analytics, no mobile canvas.
