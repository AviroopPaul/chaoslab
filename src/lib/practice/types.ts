/* SimGraph kept verbatim per SPEC-PRACTICE.md §3 (the shape of what
 * grader.ts's evaluate() accepts) even though no interface below spells the
 * name out directly. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  /** Fairness-fix #2: plain-English "what's actually melting" summary of the
   * worst 1-2 bottleneck nodes (from sim.totals.bottlenecks) plus their
   * per-kind remedy, built by grader.ts. Undefined when nothing is
   * bottlenecked (util never exceeded 0.9 anywhere). Additive/optional so it
   * never breaks anything that destructures GradeReport without it. */
  bottleneckSummary?: string;
}
