import { describe, expect, it } from 'vitest';

import { CATALOG } from '../sim/catalog';
import { solve } from '../sim/engine';
import type { ComponentKind, GlobalConfig, SimEdge, SimNode } from '../sim/types';
import { evaluate, evaluateCheck, validateQuestion } from './grader';
import { QUESTIONS } from './questions';
import type { Question, RubricCheck } from './types';

function usersNode(users: number, id = 'users-1'): SimNode {
  return { id, kind: 'users', label: 'Users', config: { users } };
}

const DEFAULT_GLOBAL: GlobalConfig = { users: 1000, rpsPerUser: 0.1, readWriteRatio: 0.9 };

/** A minimal, otherwise-valid Question wrapping a single RubricCheck, for
 * grader unit tests that only care about one check at a time. */
function makeQuestion(check: RubricCheck, targetLoad: GlobalConfig = DEFAULT_GLOBAL): Question {
  return {
    id: 'test-question',
    title: 'Test question',
    difficulty: 'easy',
    tags: [],
    statement: 'statement',
    scale: 'scale',
    targetLoad,
    budgets: { availability: 0.99, p99Ms: 1000, costPerMonth: 1_000_000 },
    hints: [],
    rubric: [{ id: 'only-check', label: 'Only check', points: 100, check, why: 'why', failHint: 'hint' }],
    solution: { nodes: [], edges: [], positions: {}, writeup: 'writeup', keyInsights: [] },
  };
}

describe('grader — has-kind', () => {
  it('passes when at least one node of the kind exists (default min 1)', () => {
    const nodes: SimNode[] = [usersNode(100), { id: 'cache-1', kind: 'cache', label: 'Cache', config: {} }];
    const q = makeQuestion({ type: 'has-kind', kind: 'cache' });
    expect(evaluate(q, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(100);
  });

  it('fails when no node of the kind exists', () => {
    const nodes: SimNode[] = [usersNode(100)];
    const q = makeQuestion({ type: 'has-kind', kind: 'cache' });
    expect(evaluate(q, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(0);
  });

  it('respects min/max bounds', () => {
    const nodes: SimNode[] = [
      usersNode(100),
      { id: 'server-1', kind: 'server', label: 'S1', config: {} },
      { id: 'server-2', kind: 'server', label: 'S2', config: {} },
    ];
    const tooFew = makeQuestion({ type: 'has-kind', kind: 'server', min: 3 });
    const inRange = makeQuestion({ type: 'has-kind', kind: 'server', min: 1, max: 2 });
    const tooMany = makeQuestion({ type: 'has-kind', kind: 'server', max: 1 });
    expect(evaluate(tooFew, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(0);
    expect(evaluate(inRange, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(100);
    expect(evaluate(tooMany, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(0);
  });
});

describe('grader — not-kind', () => {
  it('passes when the anti-pattern kind is absent', () => {
    const nodes: SimNode[] = [usersNode(100)];
    const q = makeQuestion({ type: 'not-kind', kind: 'queue' });
    expect(evaluate(q, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(100);
  });

  it('fails when the anti-pattern kind is present', () => {
    const nodes: SimNode[] = [usersNode(100), { id: 'queue-1', kind: 'queue', label: 'Q', config: {} }];
    const q = makeQuestion({ type: 'not-kind', kind: 'queue' });
    expect(evaluate(q, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(0);
  });
});

describe('grader — path (BFS)', () => {
  const nodes: SimNode[] = [
    usersNode(100),
    { id: 'lb-1', kind: 'loadbalancer', label: 'LB', config: {} },
    { id: 'server-1', kind: 'server', label: 'Server', config: {} },
    { id: 'database-1', kind: 'database', label: 'DB', config: {} },
  ];
  const edges: SimEdge[] = [
    { id: 'e1', source: 'users-1', target: 'lb-1' },
    { id: 'e2', source: 'lb-1', target: 'server-1' },
    { id: 'e3', source: 'server-1', target: 'database-1' },
  ];

  it('finds a multi-hop directed path', () => {
    const q = makeQuestion({ type: 'path', from: 'users', to: 'database' });
    expect(evaluate(q, { nodes, edges, global: DEFAULT_GLOBAL }).score).toBe(100);
  });

  it('fails when no directed path connects the kinds', () => {
    const q = makeQuestion({ type: 'path', from: 'database', to: 'users' });
    expect(evaluate(q, { nodes, edges, global: DEFAULT_GLOBAL }).score).toBe(0);
  });

  it('fails when the target kind is unreachable (disconnected node)', () => {
    const disconnected: SimNode[] = [...nodes, { id: 'cache-1', kind: 'cache', label: 'Cache', config: {} }];
    const q = makeQuestion({ type: 'path', from: 'users', to: 'cache' });
    expect(evaluate(q, { nodes: disconnected, edges, global: DEFAULT_GLOBAL }).score).toBe(0);
  });
});

describe('grader — direct-edge', () => {
  const nodes: SimNode[] = [
    usersNode(100),
    { id: 'server-1', kind: 'server', label: 'Server', config: {} },
    { id: 'cache-1', kind: 'cache', label: 'Cache', config: {} },
    { id: 'database-1', kind: 'database', label: 'DB', config: {} },
  ];
  const edges: SimEdge[] = [
    { id: 'e1', source: 'users-1', target: 'server-1' },
    { id: 'e2', source: 'server-1', target: 'cache-1' },
    { id: 'e3', source: 'cache-1', target: 'database-1' },
  ];

  it('passes when an edge directly connects the two kinds', () => {
    const q = makeQuestion({ type: 'direct-edge', from: 'server', to: 'cache' });
    expect(evaluate(q, { nodes, edges, global: DEFAULT_GLOBAL }).score).toBe(100);
  });

  it('fails when the kinds are only connected transitively', () => {
    const q = makeQuestion({ type: 'direct-edge', from: 'server', to: 'database' });
    expect(evaluate(q, { nodes, edges, global: DEFAULT_GLOBAL }).score).toBe(0);
  });
});

describe('grader — config (with catalog defaults applied)', () => {
  it('reads an explicitly-set config value', () => {
    const nodes: SimNode[] = [usersNode(100), { id: 'cache-1', kind: 'cache', label: 'Cache', config: { hitRatio: 0.95 } }];
    const q = makeQuestion({ type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0.9 });
    expect(evaluate(q, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(100);
  });

  it('falls back to the catalog default when the node omits the key', () => {
    // CATALOG.cache.defaultConfig.hitRatio is 0.8 — an empty config must
    // resolve to that default, not to undefined/0.
    const nodes: SimNode[] = [usersNode(100), { id: 'cache-1', kind: 'cache', label: 'Cache', config: {} }];
    expect(CATALOG.cache.defaultConfig.hitRatio).toBe(0.8);

    const passing = makeQuestion({ type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0.7 });
    const failing = makeQuestion({ type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0.9 });
    expect(evaluate(passing, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(100);
    expect(evaluate(failing, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(0);
  });

  it('fails outright when no node of the kind exists', () => {
    const nodes: SimNode[] = [usersNode(100)];
    const q = makeQuestion({ type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0 });
    expect(evaluate(q, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(0);
  });

  it('anyNode default (unset/true): passes if ANY node of the kind satisfies', () => {
    const nodes: SimNode[] = [
      usersNode(100),
      { id: 'cache-1', kind: 'cache', label: 'Cache A', config: { hitRatio: 0.95 } },
      { id: 'cache-2', kind: 'cache', label: 'Cache B', config: { hitRatio: 0.1 } },
    ];
    const q = makeQuestion({ type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0.9 });
    expect(evaluate(q, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(100);
  });

  it('anyNode: false requires EVERY node of the kind to satisfy', () => {
    const nodes: SimNode[] = [
      usersNode(100),
      { id: 'cache-1', kind: 'cache', label: 'Cache A', config: { hitRatio: 0.95 } },
      { id: 'cache-2', kind: 'cache', label: 'Cache B', config: { hitRatio: 0.1 } },
    ];
    const q = makeQuestion({ type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0.9, anyNode: false });
    expect(evaluate(q, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(0);
  });

  it('string-valued config supports eq', () => {
    const nodes: SimNode[] = [
      usersNode(100),
      { id: 'lb-1', kind: 'loadbalancer', label: 'LB', config: { algorithm: 'least-connections' } },
    ];
    const matching = makeQuestion({ type: 'config', kind: 'loadbalancer', key: 'algorithm', op: 'eq', value: 'least-connections' });
    const mismatching = makeQuestion({ type: 'config', kind: 'loadbalancer', key: 'algorithm', op: 'eq', value: 'round-robin' });
    expect(evaluate(matching, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(100);
    expect(evaluate(mismatching, { nodes, edges: [], global: DEFAULT_GLOBAL }).score).toBe(0);
  });
});

describe('grader — sim', () => {
  function healthyGraph() {
    const nodes: SimNode[] = [
      usersNode(100),
      { id: 'server-1', kind: 'server', label: 'Server', config: { instances: 10, rpsPerInstance: 500 } },
      { id: 'database-1', kind: 'database', label: 'DB', config: { shards: 1, readReplicas: 0 } },
    ];
    const edges: SimEdge[] = [
      { id: 'e1', source: 'users-1', target: 'server-1' },
      { id: 'e2', source: 'server-1', target: 'database-1' },
    ];
    return { nodes, edges, global: DEFAULT_GLOBAL };
  }

  function overloadedGraph() {
    const nodes: SimNode[] = [
      usersNode(100_000),
      { id: 'server-1', kind: 'server', label: 'Server', config: { instances: 1, rpsPerInstance: 10 } },
      { id: 'database-1', kind: 'database', label: 'DB', config: { shards: 1, readReplicas: 0 } },
    ];
    const edges: SimEdge[] = [
      { id: 'e1', source: 'users-1', target: 'server-1' },
      { id: 'e2', source: 'server-1', target: 'database-1' },
    ];
    return { nodes, edges, global: DEFAULT_GLOBAL };
  }

  it('availability gte passes on a healthy graph, fails on an overloaded one', () => {
    const q = makeQuestion({ type: 'sim', metric: 'availability', op: 'gte', value: 0.995 });
    expect(evaluate(q, healthyGraph()).score).toBe(100);
    expect(evaluate(q, overloadedGraph()).score).toBe(0);
  });

  it('p99Ms lte / p50Ms lte read off the real solved totals', () => {
    const graph = healthyGraph();
    const result = solve(graph);
    const passing = makeQuestion({ type: 'sim', metric: 'p99Ms', op: 'lte', value: result.totals.p99Ms + 1 });
    const failing = makeQuestion({ type: 'sim', metric: 'p50Ms', op: 'lte', value: result.totals.p50Ms - 0.001 });
    expect(evaluate(passing, graph).score).toBe(100);
    expect(evaluate(failing, graph).score).toBe(0);
  });

  it('costPerMonth lte/gte compares against the real solved total cost', () => {
    const graph = healthyGraph();
    const result = solve(graph);
    const passing = makeQuestion({ type: 'sim', metric: 'costPerMonth', op: 'lte', value: result.totals.costPerMonth });
    const failing = makeQuestion({ type: 'sim', metric: 'costPerMonth', op: 'lte', value: result.totals.costPerMonth - 1 });
    expect(evaluate(passing, graph).score).toBe(100);
    expect(evaluate(failing, graph).score).toBe(0);
  });

  it('verdict-healthy compares the boolean healthy/not-healthy state', () => {
    const q = makeQuestion({ type: 'sim', metric: 'verdict-healthy', op: 'eq', value: true });
    expect(evaluate(q, healthyGraph()).score).toBe(100);
    expect(evaluate(q, overloadedGraph()).score).toBe(0);
  });

  it('no-overloaded-nodes is true only when every node health is below overloaded', () => {
    const q = makeQuestion({ type: 'sim', metric: 'no-overloaded-nodes', op: 'eq', value: true });
    expect(evaluate(q, healthyGraph()).score).toBe(100);
    expect(evaluate(q, overloadedGraph()).score).toBe(0);
  });
});

describe('grader — evaluate() re-solves at targetLoad, not the submitted global', () => {
  it('ignores the graph.global the user submits with', () => {
    const nodes: SimNode[] = [
      // No explicit config.users here — the users node's own config takes
      // priority over graph.global in the engine, so leaving it unset is
      // what lets targetLoad actually drive the offered traffic below.
      { id: 'users-1', kind: 'users', label: 'Users', config: {} },
      { id: 'server-1', kind: 'server', label: 'Server', config: { instances: 1, rpsPerInstance: 10 } },
      { id: 'database-1', kind: 'database', label: 'DB', config: {} },
    ];
    const edges: SimEdge[] = [
      { id: 'e1', source: 'users-1', target: 'server-1' },
      { id: 'e2', source: 'server-1', target: 'database-1' },
    ];
    // targetLoad is a meltdown load — the submitted graph.global (idle) must
    // NOT be what actually gets graded.
    const meltdownTarget: GlobalConfig = { users: 1_000_000, rpsPerUser: 1, readWriteRatio: 0.9 };
    const q = makeQuestion({ type: 'sim', metric: 'verdict-healthy', op: 'eq', value: true }, meltdownTarget);
    const submittedIdleGlobal: GlobalConfig = { users: 1, rpsPerUser: 0.001, readWriteRatio: 0.9 };
    const report = evaluate(q, { nodes, edges, global: submittedIdleGlobal });
    expect(report.score).toBe(0);
    expect(report.sim.totals.offeredRps).toBeCloseTo(meltdownTarget.users * meltdownTarget.rpsPerUser, 6);
  });
});

describe('evaluateCheck() (direct, no Question wrapper)', () => {
  it('dispatches has-kind the same way evaluate() does', () => {
    const nodes: SimNode[] = [usersNode(100), { id: 'cache-1', kind: 'cache', label: 'Cache', config: {} }];
    const graph = { nodes, edges: [], global: DEFAULT_GLOBAL };
    const result = solve(graph);
    expect(evaluateCheck({ type: 'has-kind', kind: 'cache' }, graph, result)).toBe(true);
    expect(evaluateCheck({ type: 'has-kind', kind: 'queue' }, graph, result)).toBe(false);
  });
});

describe('validateQuestion()', () => {
  it('flags a rubric that does not sum to 100', () => {
    const q = makeQuestion({ type: 'has-kind', kind: 'cache' });
    q.rubric.push({ id: 'extra', label: 'extra', points: 5, check: { type: 'has-kind', kind: 'database' }, why: 'w', failHint: 'h' });
    // solution is empty, so this will also fail the "scores 100" check —
    // that's fine, we're only asserting the points-sum error is present.
    const result = validateQuestion(q);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('sum to 105'))).toBe(true);
  });

  it('flags a solution that does not score 100 on its own rubric', () => {
    const q = makeQuestion({ type: 'has-kind', kind: 'cache' });
    // solution has no nodes at all, so it can't have a cache.
    const result = validateQuestion(q);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('own rubric'))).toBe(true);
  });

  it('passes for a well-formed question whose solution actually earns 100/healthy', () => {
    const nodes: SimNode[] = [
      usersNode(100),
      { id: 'server-1', kind: 'server', label: 'Server', config: { instances: 10, rpsPerInstance: 500 } },
      { id: 'database-1', kind: 'database', label: 'DB', config: {} },
    ];
    const edges: SimEdge[] = [
      { id: 'e1', source: 'users-1', target: 'server-1' },
      { id: 'e2', source: 'server-1', target: 'database-1' },
    ];
    const q = makeQuestion({ type: 'has-kind', kind: 'server' });
    q.solution = { nodes, edges, positions: {}, writeup: 'w', keyInsights: [] };
    const result = validateQuestion(q);
    expect(result).toEqual({ ok: true, errors: [] });
  });
});

// ---------------------------------------------------------------------------
// Authored-content suite (SPEC-PRACTICE.md §9) — loops every question in
// QUESTIONS, so each newly-authored question file is automatically covered
// without touching this test again.
// ---------------------------------------------------------------------------

function allReferencedKinds(check: RubricCheck): ComponentKind[] {
  switch (check.type) {
    case 'has-kind':
    case 'not-kind':
    case 'config':
      return [check.kind];
    case 'path':
    case 'direct-edge':
      return [check.from, check.to];
    default:
      return [];
  }
}

describe('authored questions (QUESTIONS)', () => {
  it('has at least one question', () => {
    expect(QUESTIONS.length).toBeGreaterThan(0);
  });

  it('has unique question ids', () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const question of QUESTIONS) {
    describe(`"${question.id}"`, () => {
      it('rubric sums to 100 and the solution earns 100/100 while HEALTHY at targetLoad', () => {
        const result = validateQuestion(question);
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
      });

      it('every rubric check references a real catalog kind', () => {
        for (const item of question.rubric) {
          for (const kind of allReferencedKinds(item.check)) {
            expect(CATALOG[kind], `rubric item '${item.id}' references unknown kind '${kind}'`).toBeDefined();
          }
        }
      });

      it('rubric item ids are unique', () => {
        const ids = question.rubric.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('the solution graph itself simulates HEALTHY at targetLoad', () => {
        const result = solve({ nodes: question.solution.nodes, edges: question.solution.edges, global: question.targetLoad });
        expect(result.totals.verdict).toBe('healthy');
      });
    });
  }
});
