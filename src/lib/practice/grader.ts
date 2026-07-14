import { CATALOG } from '../sim/catalog';
import { solve } from '../sim/engine';
import { BOTTLENECK_SUGGESTIONS } from '../sim/suggestions';
import type { ComponentKind, NodeConfig, SimEdge, SimGraph, SimNode, SimResult } from '../sim/types';
import type { GradeItemResult, GradeReport, Question, RubricCheck } from './types';

/**
 * ChaosLab practice grader (SPEC-PRACTICE.md §4).
 *
 * `evaluate()` is a pure function: (Question, SimGraph) -> GradeReport. It
 * always re-solves at the question's `targetLoad` (SPEC §4 step 1) — a
 * submission is graded at target load regardless of whatever the user's
 * slider happens to be sitting at when they hit Submit. No side effects, no
 * randomness; the only non-deterministic field on the returned report is
 * `gradedAt` (a wall-clock timestamp for display/progress bookkeeping), which
 * plays no part in scoring.
 */

// ---------------------------------------------------------------------------
// Small graph helpers
// ---------------------------------------------------------------------------

function nodesOfKind(nodes: SimNode[], kind: ComponentKind): SimNode[] {
  return nodes.filter((n) => n.kind === kind);
}

/** Directed adjacency (target ids reachable via one hop) built once per check. */
function buildAdjacency(edges: SimEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source);
    if (list) list.push(e.target);
    else adj.set(e.source, [e.target]);
  }
  return adj;
}

/**
 * BFS: is there a directed path from ANY node of kind `from` to ANY node of
 * kind `to`? A start node that itself matches `to` counts as a (zero-length)
 * path — relevant only when from === to.
 */
function pathExists(nodes: SimNode[], edges: SimEdge[], from: ComponentKind, to: ComponentKind): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(edges);
  const starts = nodesOfKind(nodes, from);
  for (const start of starts) {
    const visited = new Set<string>([start.id]);
    const queue = [start.id];
    let qi = 0;
    while (qi < queue.length) {
      const id = queue[qi++];
      const node = byId.get(id);
      if (node?.kind === to) return true;
      for (const next of adj.get(id) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }
  return false;
}

function directEdgeExists(nodes: SimNode[], edges: SimEdge[], from: ComponentKind, to: ComponentKind): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.some((e) => byId.get(e.source)?.kind === from && byId.get(e.target)?.kind === to);
}

/** Resolve a node's config value for `key`, falling back to the catalog default. */
function resolvedConfigValue(kind: ComponentKind, config: NodeConfig, key: keyof NodeConfig): number | string | undefined {
  const own = config[key];
  if (own !== undefined) return own as number | string;
  return CATALOG[kind].defaultConfig[key] as number | string | undefined;
}

function compare(actual: number | string | undefined, op: 'gte' | 'lte' | 'eq', expected: number | string): boolean {
  if (actual === undefined) return false;
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (op === 'gte') return actual >= expected;
    if (op === 'lte') return actual <= expected;
    return actual === expected;
  }
  // string (or mixed) values: only exact equality is well-defined.
  return op === 'eq' && actual === expected;
}

function noOverloadedNodes(result: SimResult): boolean {
  return Object.values(result.nodes).every((n) => n.health !== 'overloaded' && n.health !== 'down');
}

/**
 * Fairness-fix #2 — "what's actually melting": sim.totals.bottlenecks is
 * already sorted worst-utilization-first by the engine, so the worst 1-2
 * nodes plus their per-kind remedy (BOTTLENECK_SUGGESTIONS, the same map the
 * sandbox MetricsBar uses) gives a concrete, non-generic explanation instead
 * of just "a sim check failed". Returns undefined when nothing crossed the
 * engine's 0.9 utilization bottleneck threshold.
 */
function buildBottleneckSummary(graph: SimGraph, result: SimResult): string | undefined {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const parts = result.totals.bottlenecks
    .slice(0, 2)
    .map((nodeId) => {
      const node = nodeById.get(nodeId);
      const metrics = result.nodes[nodeId];
      if (!node || !metrics) return undefined;
      const suggestion = BOTTLENECK_SUGGESTIONS[node.kind];
      return `『${node.label}』 (${node.kind}) at ×${metrics.utilization.toFixed(1)} capacity — ${suggestion}`;
    })
    .filter((s): s is string => Boolean(s));
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/** Evaluate a single declarative RubricCheck against the (already re-solved) graph + result. */
export function evaluateCheck(check: RubricCheck, graph: SimGraph, result: SimResult): boolean {
  switch (check.type) {
    case 'has-kind': {
      const count = nodesOfKind(graph.nodes, check.kind).length;
      const min = check.min ?? 1;
      const max = check.max ?? Infinity;
      return count >= min && count <= max;
    }

    case 'not-kind': {
      return nodesOfKind(graph.nodes, check.kind).length === 0;
    }

    case 'path': {
      return pathExists(graph.nodes, graph.edges, check.from, check.to);
    }

    case 'direct-edge': {
      return directEdgeExists(graph.nodes, graph.edges, check.from, check.to);
    }

    case 'config': {
      const candidates = nodesOfKind(graph.nodes, check.kind);
      if (candidates.length === 0) return false;
      const satisfies = (n: SimNode) => compare(resolvedConfigValue(n.kind, n.config, check.key), check.op, check.value);
      // Default (anyNode unset or true): at least one node of this kind
      // satisfies. anyNode === false: every node of this kind must.
      return check.anyNode === false ? candidates.every(satisfies) : candidates.some(satisfies);
    }

    case 'sim': {
      const { metric, op, value } = check;
      let actual: number;
      switch (metric) {
        case 'availability':
          actual = result.totals.availability;
          break;
        case 'p99Ms':
          actual = result.totals.p99Ms;
          break;
        case 'p50Ms':
          actual = result.totals.p50Ms;
          break;
        case 'costPerMonth':
          actual = result.totals.costPerMonth;
          break;
        case 'verdict-healthy':
          actual = result.totals.verdict === 'healthy' ? 1 : 0;
          break;
        case 'no-overloaded-nodes':
          actual = noOverloadedNodes(result) ? 1 : 0;
          break;
        default:
          actual = 0;
      }
      const expected = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      if (op === 'gte') return actual >= expected;
      if (op === 'lte') return actual <= expected;
      return actual === expected;
    }

    default:
      return false;
  }
}

/**
 * evaluate(question, graph) -> GradeReport (SPEC-PRACTICE.md §4).
 * 1. Replace graph.global with question.targetLoad.
 * 2. Run solve() once.
 * 3. Evaluate each RubricCheck.
 * 4. Sum points, build report.
 */
export function evaluate(question: Question, graph: SimGraph): GradeReport {
  const gradedGraph: SimGraph = {
    nodes: graph.nodes,
    edges: graph.edges,
    global: question.targetLoad,
  };
  const result = solve(gradedGraph);

  const items: GradeItemResult[] = question.rubric.map((item) => ({
    item,
    passed: evaluateCheck(item.check, gradedGraph, result),
  }));

  const score = items.reduce((sum, r) => sum + (r.passed ? r.item.points : 0), 0);

  return {
    score,
    accepted: score >= 75,
    items,
    sim: result,
    gradedAt: Date.now(),
    bottleneckSummary: buildBottleneckSummary(gradedGraph, result),
  };
}

export interface QuestionValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * validateQuestion(q) — used by practice.test.ts (SPEC §4/§9) to enforce that
 * every authored question's rubric sums to 100 and its own solution graph
 * actually earns 100/100 and simulates HEALTHY at targetLoad, so the "correct
 * answer" is tuned against the real engine rather than picked by hand.
 */
export function validateQuestion(q: Question): QuestionValidationResult {
  const errors: string[] = [];

  const pointsSum = q.rubric.reduce((sum, item) => sum + item.points, 0);
  if (pointsSum !== 100) {
    errors.push(`rubric points sum to ${pointsSum}, expected 100`);
  }

  const seenIds = new Set<string>();
  for (const item of q.rubric) {
    if (seenIds.has(item.id)) errors.push(`duplicate rubric item id '${item.id}'`);
    seenIds.add(item.id);
  }

  const solutionGraph: SimGraph = {
    nodes: q.solution.nodes,
    edges: q.solution.edges,
    global: q.targetLoad,
  };
  const report = evaluate(q, solutionGraph);
  if (report.score !== 100) {
    const failed = report.items.filter((r) => !r.passed).map((r) => r.item.id);
    errors.push(`solution scores ${report.score}/100 on its own rubric (failing: ${failed.join(', ') || 'none'})`);
  }
  if (report.sim.totals.verdict !== 'healthy') {
    errors.push(`solution simulates '${report.sim.totals.verdict}' at target load, expected 'healthy'`);
  }

  return { ok: errors.length === 0, errors };
}
