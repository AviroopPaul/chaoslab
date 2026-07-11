import { describe, expect, it } from 'vitest';
import { solve } from './engine';
import { PRESETS } from './presets';
import type { GlobalConfig, SimEdge, SimGraph, SimNode } from './types';

function graph(nodes: SimNode[], edges: SimEdge[], global: GlobalConfig): SimGraph {
  return { nodes, edges, global };
}

function usersNode(users: number, id = 'users-1'): SimNode {
  return { id, kind: 'users', label: 'Users', config: { users } };
}

/** Same M/M/1-flavored formula the engine uses, for independent expected-value checks. */
function expectedLatency(base: number, util: number): number {
  const rho = Math.min(Math.max(util, 0), 0.999);
  return Math.min(base * (1 + (rho * rho) / (1 - rho)), base * 20);
}

describe('solve() — single server happy path', () => {
  it('produces exact traffic, utilization, and latency numbers', () => {
    const users = usersNode(100);
    const server: SimNode = { id: 'server-1', kind: 'server', label: 'Server', config: { instances: 1, rpsPerInstance: 500 } };
    const database: SimNode = { id: 'db-1', kind: 'database', label: 'DB', config: { shards: 1, readReplicas: 0 } };
    const edges: SimEdge[] = [
      { id: 'e1', source: 'users-1', target: 'server-1' },
      { id: 'e2', source: 'server-1', target: 'db-1' },
    ];
    const global: GlobalConfig = { users: 100, rpsPerUser: 0.1, readWriteRatio: 0.9 };
    const result = solve(graph([users, server, database], edges, global));

    // offered = 100 * 0.1 = 10 rps, split 9 read / 1 write
    expect(result.totals.offeredRps).toBeCloseTo(10, 9);
    expect(result.totals.servedRps).toBeCloseTo(10, 9);
    expect(result.totals.availability).toBeCloseTo(1, 9);

    const serverUtil = 10 / 500;
    const dbUtil = Math.max(9 / 8000, 1 / 4000);
    expect(result.nodes['server-1'].utilization).toBeCloseTo(serverUtil, 9);
    expect(result.nodes['server-1'].health).toBe('ok');
    expect(result.nodes['db-1'].inRps).toBeCloseTo(10, 9);
    expect(result.nodes['db-1'].utilization).toBeCloseTo(dbUtil, 9);

    const expectedP50 = 0 + expectedLatency(30, serverUtil) + expectedLatency(12, dbUtil);
    expect(result.totals.p50Ms).toBeCloseTo(expectedP50, 6);
    expect(result.totals.verdict).toBe('healthy');
    expect(result.totals.bottlenecks).toEqual([]);
  });
});

describe('solve() — server overload drop math', () => {
  it('drops exactly what exceeds effective (down-penalized) capacity', () => {
    const users = usersNode(1000);
    const server: SimNode = { id: 'server-1', kind: 'server', label: 'Server', config: { instances: 1, rpsPerInstance: 100 } };
    const database: SimNode = { id: 'db-1', kind: 'database', label: 'DB', config: {} };
    const edges: SimEdge[] = [
      { id: 'e1', source: 'users-1', target: 'server-1' },
      { id: 'e2', source: 'server-1', target: 'db-1' },
    ];
    // offered = 1000 users * 1 rps/user = 1000 rps, capacity 100 -> util1 = 10 (>1.5, down penalty halves capacity to 50)
    const global: GlobalConfig = { users: 1000, rpsPerUser: 1, readWriteRatio: 0.9 };
    const result = solve(graph([users, server, database], edges, global));

    const serverMetrics = result.nodes['server-1'];
    expect(serverMetrics.inRps).toBeCloseTo(1000, 9);
    expect(serverMetrics.servedRps).toBeCloseTo(50, 9);
    expect(serverMetrics.droppedRps).toBeCloseTo(950, 9);
    expect(serverMetrics.utilization).toBeCloseTo(20, 9); // 1000 / (100*0.5)
    expect(serverMetrics.health).toBe('down');
    expect(result.totals.verdict).toBe('meltdown');
  });
});

describe('solve() — cache absorption', () => {
  it('absorbs hitRatio of reads; downstream DB only sees misses + writes', () => {
    const users = usersNode(1000);
    const cache: SimNode = { id: 'cache-1', kind: 'cache', label: 'Cache', config: { hitRatio: 0.8 } };
    const database: SimNode = { id: 'db-1', kind: 'database', label: 'DB', config: {} };
    const edges: SimEdge[] = [
      { id: 'e1', source: 'users-1', target: 'cache-1' },
      { id: 'e2', source: 'cache-1', target: 'db-1' },
    ];
    // offered = 1000 rps, 90% reads (900) / 10% writes (100)
    const global: GlobalConfig = { users: 1000, rpsPerUser: 1, readWriteRatio: 0.9 };
    const result = solve(graph([users, cache, database], edges, global));

    expect(result.nodes['cache-1'].inRps).toBeCloseTo(1000, 9);
    expect(result.nodes['cache-1'].servedRps).toBeCloseTo(1000, 9); // fully handled, no capacity drop
    // misses = 900 * (1 - 0.8) = 180, plus all 100 writes -> DB sees 280
    expect(result.nodes['db-1'].inRps).toBeCloseTo(280, 9);
    expect(result.nodes['db-1'].servedRps).toBeCloseTo(280, 9);
    expect(result.totals.availability).toBeCloseTo(1, 9);
  });
});

describe('solve() — load balancer fan-out', () => {
  it('splits traffic equally across 3 servers under round-robin', () => {
    const users = usersNode(1000);
    const lb: SimNode = { id: 'lb-1', kind: 'loadbalancer', label: 'LB', config: { algorithm: 'round-robin' } };
    const servers: SimNode[] = [1, 2, 3].map((i) => ({
      id: `server-${i}`,
      kind: 'server' as const,
      label: `Server ${i}`,
      config: { instances: 10, rpsPerInstance: 500 }, // plenty of headroom, no drops
    }));
    const database: SimNode = { id: 'db-1', kind: 'database', label: 'DB', config: {} };
    const edges: SimEdge[] = [
      { id: 'e-u-lb', source: 'users-1', target: 'lb-1' },
      ...servers.map((s, i) => ({ id: `e-lb-s${i}`, source: 'lb-1', target: s.id })),
      ...servers.map((s, i) => ({ id: `e-s${i}-db`, source: s.id, target: 'db-1' })),
    ];
    const global: GlobalConfig = { users: 1000, rpsPerUser: 1, readWriteRatio: 0.9 };
    const result = solve(graph([users, lb, ...servers, database], edges, global));

    for (let i = 0; i < 3; i++) {
      expect(result.edges[`e-lb-s${i}`].rps).toBeCloseTo(1000 / 3, 6);
      expect(result.nodes[`server-${i + 1}`].inRps).toBeCloseTo(1000 / 3, 6);
    }
  });
});

describe('solve() — database capacity scaling', () => {
  it('read capacity scales with shards and replicas; write capacity scales with shards only', () => {
    const buildDbGraph = (shards: number, readReplicas: number, users: number, readWriteRatio: number) => {
      const u = usersNode(users);
      // maxConnections set generously high so the connection-pool knob (knob
      // 4, tested separately below) never binds here — this test isolates
      // shard/replica capacity math specifically.
      const db: SimNode = {
        id: 'db-1',
        kind: 'database',
        label: 'DB',
        config: { shards, readReplicas, maxConnections: 100_000 },
      };
      const edges: SimEdge[] = [{ id: 'e1', source: 'users-1', target: 'db-1' }];
      const global: GlobalConfig = { users, rpsPerUser: 1, readWriteRatio };
      return solve(graph([u, db], edges, global));
    };

    // All-read traffic: readCap = 8000 * shards * (1 + replicas).
    // shards=2, replicas=0 -> readCap=16000; offered 17000 reads -> util1 =
    // 17000/16000 = 1.0625. C1 fix: capacity now ramps continuously from
    // util1=1 (no C1 test change here), so past util1=1 the effective
    // capacity is already less than 16000 (down-penalty ramp:
    // capEff = cap * (1 - 0.5 * clamp01(util1-1)) = 16000 * (1 - 0.5*0.0625)
    // = 15500) instead of the old model's unpenalized 16000 up to util1=1.5.
    // dropped = 17000 - 15500 = 1500 (was 1000 pre-C1).
    const noReplicas = buildDbGraph(2, 0, 17_000, 1);
    expect(noReplicas.nodes['db-1'].droppedRps).toBeCloseTo(1500, 6);

    // shards=2, replicas=3 -> readCap=64000; same 17000 reads now comfortably fit.
    const withReplicas = buildDbGraph(2, 3, 17_000, 1);
    expect(withReplicas.nodes['db-1'].droppedRps).toBeCloseTo(0, 6);

    // All-write traffic: writeCap = 4000 * shards, independent of replicas.
    // shards=2 -> writeCap=8000 regardless of replicas=0 vs replicas=5.
    // offered 9000 writes -> util1 = 9000/8000 = 1.125; C1 ramp:
    // capEff = 8000 * (1 - 0.5*0.125) = 7500 -> dropped = 1500 (was 1000).
    const writesNoReplicas = buildDbGraph(2, 0, 9_000, 0);
    const writesWithReplicas = buildDbGraph(2, 5, 9_000, 0);
    expect(writesNoReplicas.nodes['db-1'].droppedRps).toBeCloseTo(1500, 6);
    expect(writesWithReplicas.nodes['db-1'].droppedRps).toBeCloseTo(1500, 6);
  });
});

describe('solve() — rate limiter shedding', () => {
  it('sheds excess traffic without hurting availability', () => {
    const users = usersNode(1000);
    const rl: SimNode = { id: 'rl-1', kind: 'ratelimiter', label: 'RL', config: { limitRps: 800 } };
    const database: SimNode = { id: 'db-1', kind: 'database', label: 'DB', config: {} };
    const edges: SimEdge[] = [
      { id: 'e1', source: 'users-1', target: 'rl-1' },
      { id: 'e2', source: 'rl-1', target: 'db-1' },
    ];
    // All-read traffic, offered = 1000, limit = 800 -> util1 = 1.25 (no down penalty)
    const global: GlobalConfig = { users: 1000, rpsPerUser: 1, readWriteRatio: 1 };
    const result = solve(graph([users, rl, database], edges, global));

    expect(result.nodes['rl-1'].shedRps).toBeCloseTo(200, 6);
    expect(result.nodes['rl-1'].droppedRps).toBeCloseTo(0, 6);
    expect(result.totals.servedRps).toBeCloseTo(800, 6);
    expect(result.totals.availability).toBeCloseTo(1, 9);
    expect(result.totals.verdict).toBe('healthy');
  });
});

describe('solve() — cycles', () => {
  it('does not crash on a cycle, and reports a graph warning', () => {
    const users = usersNode(100);
    const a: SimNode = { id: 'a', kind: 'server', label: 'A', config: {} };
    const b: SimNode = { id: 'b', kind: 'server', label: 'B', config: {} };
    const c: SimNode = { id: 'c', kind: 'server', label: 'C', config: {} };
    const edges: SimEdge[] = [
      { id: 'e-u-a', source: 'users-1', target: 'a' },
      { id: 'e-a-b', source: 'a', target: 'b' },
      { id: 'e-b-c', source: 'b', target: 'c' },
      { id: 'e-c-a', source: 'c', target: 'a' }, // back edge, closes the cycle
    ];
    const global: GlobalConfig = { users: 100, rpsPerUser: 0.1, readWriteRatio: 0.9 };

    expect(() => solve(graph([users, a, b, c], edges, global))).not.toThrow();
    const result = solve(graph([users, a, b, c], edges, global));
    expect(result.totals.graphWarnings.some((w) => w.includes('Cycle detected'))).toBe(true);
    // Every node must still finite metrics (no NaN/Infinity leaking out).
    for (const m of Object.values(result.nodes)) {
      expect(Number.isFinite(m.inRps)).toBe(true);
      expect(Number.isFinite(m.utilization)).toBe(true);
      expect(Number.isFinite(m.latencyMs)).toBe(true);
    }
  });
});

describe('solve() — disconnected nodes', () => {
  it('leaves a node with no path from users idle', () => {
    const users = usersNode(100);
    const server: SimNode = { id: 'server-1', kind: 'server', label: 'Server', config: {} };
    const orphanDb: SimNode = { id: 'db-orphan', kind: 'database', label: 'Orphan DB', config: {} };
    const edges: SimEdge[] = [{ id: 'e1', source: 'users-1', target: 'server-1' }];
    const global: GlobalConfig = { users: 100, rpsPerUser: 0.1, readWriteRatio: 0.9 };

    const result = solve(graph([users, server, orphanDb], edges, global));
    expect(result.nodes['db-orphan'].inRps).toBe(0);
    expect(result.nodes['db-orphan'].servedRps).toBe(0);
    expect(result.nodes['db-orphan'].health).toBe('idle');
  });
});

describe('solve() — users connected to nothing', () => {
  it('warns and drives availability to 0', () => {
    const users = usersNode(100);
    const result = solve(graph([users], [], { users: 100, rpsPerUser: 0.1, readWriteRatio: 0.9 }));

    expect(result.totals.offeredRps).toBeCloseTo(10, 9);
    expect(result.totals.servedRps).toBeCloseTo(0, 9);
    expect(result.totals.availability).toBeCloseTo(0, 9);
    expect(result.totals.verdict).toBe('meltdown');
    expect(result.totals.graphWarnings.some((w) => w.includes('not connected to anything'))).toBe(true);
  });

  it('handles a graph with no users node at all without crashing', () => {
    const server: SimNode = { id: 'server-1', kind: 'server', label: 'Server', config: {} };
    const result = solve(graph([server], [], { users: 0, rpsPerUser: 0.1, readWriteRatio: 0.9 }));
    expect(result.totals.offeredRps).toBe(0);
    expect(result.totals.verdict).toBe('healthy');
    expect(result.totals.graphWarnings.some((w) => w.includes('No users node'))).toBe(true);
  });
});

describe('solve() — verdict transitions with scale (Classic 3-Tier shaped graph)', () => {
  function classic3Tier(users: number) {
    const preset = PRESETS.find((p) => p.id === 'classic-3-tier')!;
    const built = preset.build();
    built.global.users = users;
    for (const n of built.nodes) if (n.kind === 'users') n.config.users = users;
    return graph(built.nodes, built.edges, built.global);
  }

  it('is healthy at the preset scale (10k users)', () => {
    const result = solve(classic3Tier(10_000));
    expect(result.totals.verdict).toBe('healthy');
  });

  it('degrades at an intermediate scale', () => {
    const result = solve(classic3Tier(25_000));
    expect(result.totals.verdict).toBe('degraded');
  });

  it('melts down at a much larger scale', () => {
    const result = solve(classic3Tier(1_000_000));
    expect(result.totals.verdict).toBe('meltdown');
    expect(result.totals.availability).toBeLessThan(0.9);
  });
});

describe('solve() — Planet Scale preset is tuned against this engine', () => {
  it('is healthy at 100M users and melts down at 500M', () => {
    const preset = PRESETS.find((p) => p.id === 'planet-scale')!;
    expect(preset).toBeDefined();

    const at100M = preset.build();
    const result100M = solve(graph(at100M.nodes, at100M.edges, at100M.global));
    expect(result100M.totals.verdict).toBe('healthy');
    expect(result100M.totals.availability).toBeGreaterThanOrEqual(0.995);

    const at500M = preset.build();
    at500M.global.users = 500_000_000;
    for (const n of at500M.nodes) if (n.kind === 'users') n.config.users = 500_000_000;
    const result500M = solve(graph(at500M.nodes, at500M.edges, at500M.global));
    expect(result500M.totals.verdict).not.toBe('healthy');
    expect(result500M.totals.availability).toBeLessThan(0.9);
  });
});

describe('solve() — new real-world presets are tuned against this engine', () => {
  it('Netflix-Style Streaming is healthy at its default load and degrades by 3x', () => {
    const preset = PRESETS.find((p) => p.id === 'netflix-streaming')!;
    expect(preset).toBeDefined();

    const atDefault = preset.build();
    const resultDefault = solve(graph(atDefault.nodes, atDefault.edges, atDefault.global));
    expect(resultDefault.totals.verdict).toBe('healthy');

    const at3x = preset.build();
    const users3x = at3x.global.users * 3;
    at3x.global.users = users3x;
    for (const n of at3x.nodes) if (n.kind === 'users') n.config.users = users3x;
    const result3x = solve(graph(at3x.nodes, at3x.edges, at3x.global));
    expect(result3x.totals.verdict).not.toBe('healthy');
  });

  it('Instagram-Style Social Feed is healthy at its default load and degrades by 3x', () => {
    const preset = PRESETS.find((p) => p.id === 'instagram-feed')!;
    expect(preset).toBeDefined();

    const atDefault = preset.build();
    const resultDefault = solve(graph(atDefault.nodes, atDefault.edges, atDefault.global));
    expect(resultDefault.totals.verdict).toBe('healthy');

    const at3x = preset.build();
    const users3x = at3x.global.users * 3;
    at3x.global.users = users3x;
    for (const n of at3x.nodes) if (n.kind === 'users') n.config.users = users3x;
    const result3x = solve(graph(at3x.nodes, at3x.edges, at3x.global));
    expect(result3x.totals.verdict).not.toBe('healthy');
  });
});

describe('solve() — Read-Heavy at Scale preset is tuned against this engine', () => {
  it('is healthy at its default 1M users (presets must load healthy, not degraded)', () => {
    const preset = PRESETS.find((p) => p.id === 'read-heavy-at-scale')!;
    expect(preset).toBeDefined();

    const built = preset.build();
    const result = solve(graph(built.nodes, built.edges, built.global));
    expect(result.totals.verdict).toBe('healthy');
    expect(result.totals.availability).toBeGreaterThanOrEqual(0.995);
  });
});

describe('solve() — every preset is well-formed', () => {
  it('solves without crashing and produces metrics for every declared node/edge/position', () => {
    for (const preset of PRESETS) {
      const built = preset.build();
      const result = solve(graph(built.nodes, built.edges, built.global));
      for (const n of built.nodes) {
        expect(result.nodes[n.id]).toBeDefined();
        expect(built.positions[n.id]).toBeDefined();
        expect(Number.isFinite(result.nodes[n.id].utilization)).toBe(true);
      }
      for (const e of built.edges) {
        expect(result.edges[e.id]).toBeDefined();
      }
      expect(Number.isFinite(result.totals.p50Ms)).toBe(true);
      expect(Number.isFinite(result.totals.p99Ms)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// C1 — continuous down-penalty ramp (no more cliff at util1 = 1.5)
// ---------------------------------------------------------------------------

describe('solve() — C1 continuity fix', () => {
  it('served RPS barely changes across the old util1=1.5 cliff (util1=1.49 vs 1.51)', () => {
    // storage: flat 100k rps capacity, no fan-out complexity — a clean single
    // capacity number to probe the ramp with.
    const build = (users: number) => {
      const u = usersNode(users);
      const storage: SimNode = { id: 'storage-1', kind: 'storage', label: 'Storage', config: {} };
      const edges: SimEdge[] = [{ id: 'e1', source: 'users-1', target: 'storage-1' }];
      const global: GlobalConfig = { users, rpsPerUser: 1, readWriteRatio: 1 };
      return solve(graph([u, storage], edges, global));
    };

    const below = build(149_000); // util1 = 1.49
    const above = build(151_000); // util1 = 1.51

    const servedBelow = below.nodes['storage-1'].servedRps;
    const servedAbove = above.nodes['storage-1'].servedRps;
    const relativeDiff = Math.abs(servedBelow - servedAbove) / servedBelow;

    expect(relativeDiff).toBeLessThan(0.05);
    // Sanity: this used to be a hard 2x cliff (served roughly halved) — make
    // sure we're actually exercising the down-penalty region, not comparing
    // two unpenalized numbers.
    expect(servedBelow).toBeLessThan(100_000);
    expect(servedAbove).toBeLessThan(servedBelow);
  });
});

// ---------------------------------------------------------------------------
// M1 — latency keeps climbing past saturation instead of plateauing
// ---------------------------------------------------------------------------

describe('solve() — M1 latency monotonicity fix', () => {
  it('latency strictly increases with util1 past 1.0 until the 50x-base cap, then plateaus', () => {
    const build = (users: number) => {
      const u = usersNode(users);
      const storage: SimNode = { id: 'storage-1', kind: 'storage', label: 'Storage', config: {} };
      const edges: SimEdge[] = [{ id: 'e1', source: 'users-1', target: 'storage-1' }];
      const global: GlobalConfig = { users, rpsPerUser: 1, readWriteRatio: 1 };
      return solve(graph([u, storage], edges, global));
    };

    // storage capacity is a flat 100k rps -> users count IS util1 x 100k.
    const latencyAt = (util1: number) => build(util1 * 100_000).nodes['storage-1'].latencyMs;

    const l100 = latencyAt(1.0);
    const l120 = latencyAt(1.2);
    const l150 = latencyAt(1.5);
    const l165 = latencyAt(1.65);
    const l200 = latencyAt(2.0);
    const l300 = latencyAt(3.0);
    const l500 = latencyAt(5.0);

    // Strictly increasing while still climbing toward the cap.
    expect(l120).toBeGreaterThan(l100);
    expect(l150).toBeGreaterThan(l120);
    expect(l165).toBeGreaterThan(l150);

    // Plateaus at the 50x-base ceiling once reached, instead of climbing forever.
    const baseLatencyMs = 25; // storage's base latency (SPEC.md §3)
    const ceiling = baseLatencyMs * 50;
    expect(l200).toBeCloseTo(ceiling, 6);
    expect(l300).toBeCloseTo(ceiling, 6);
    expect(l500).toBeCloseTo(ceiling, 6);

    // Never exceeds the outer ceiling anywhere in the sweep.
    for (const l of [l100, l120, l150, l165, l200, l300, l500]) {
      expect(l).toBeLessThanOrEqual(ceiling + 1e-6);
    }
  });
});

// ---------------------------------------------------------------------------
// C2 — p99 is traffic-weighted (a near-idle misconfigured node can't blow it up)
// ---------------------------------------------------------------------------

describe('solve() — C2 traffic-weighted p99 fix', () => {
  it('a near-idle, badly overloaded node does not inflate p99 for the whole system', () => {
    const users = usersNode(100_000);
    // Healthy main path: half of users' traffic (distributeEvenly dedup —
    // 2 distinct targets off the users node) goes to a big, comfortable server + database.
    const mainServer: SimNode = {
      id: 'main-server',
      kind: 'server',
      label: 'Main',
      config: { instances: 100, rpsPerInstance: 1000 },
    };
    const database: SimNode = {
      id: 'db-1',
      kind: 'database',
      label: 'DB',
      config: { shards: 100, maxConnections: 100_000 },
    };
    // Misconfigured, near-idle side branch: a rate limiter starves it down to
    // 500 rps (0.5% of the 100k total offered load — under the 1% threshold),
    // but its own capacity is even tinier, so ITS utilization is enormous.
    const rl: SimNode = { id: 'rl-1', kind: 'ratelimiter', label: 'RL', config: { limitRps: 500 } };
    const tinyServer: SimNode = {
      id: 'tiny-server',
      kind: 'server',
      label: 'Tiny',
      config: { instances: 1, rpsPerInstance: 10 },
    };

    const edges: SimEdge[] = [
      { id: 'e-users-main', source: 'users-1', target: 'main-server' },
      { id: 'e-main-db', source: 'main-server', target: 'db-1' },
      { id: 'e-users-rl', source: 'users-1', target: 'rl-1' },
      { id: 'e-rl-tiny', source: 'rl-1', target: 'tiny-server' },
    ];
    const global: GlobalConfig = { users: 100_000, rpsPerUser: 1, readWriteRatio: 1 };
    const result = solve(graph([users, mainServer, database, rl, tinyServer], edges, global));

    // The misconfigured branch really is deeply overloaded...
    expect(result.nodes['tiny-server'].utilization).toBeGreaterThan(20);
    // ...and really is under the 1% traffic-weighting threshold.
    expect(result.nodes['tiny-server'].inRps).toBeLessThan(0.01 * result.totals.offeredRps);

    // ...but p99 stays sane (reflects the healthy main path), not exploded by
    // the tiny branch's huge utilization.
    expect(result.totals.p99Ms).toBeLessThan(5 * result.totals.p50Ms);
  });
});

// ---------------------------------------------------------------------------
// M3 — duplicate edges to the same target no longer double its share
// ---------------------------------------------------------------------------

describe('solve() — M3 duplicate-edge dedup fix', () => {
  it('distributeEvenly: two edges from a cache to the same database do not double its traffic', () => {
    const users = usersNode(1000);
    const cache: SimNode = { id: 'cache-1', kind: 'cache', label: 'Cache', config: { hitRatio: 0 } };
    const database: SimNode = { id: 'db-1', kind: 'database', label: 'DB', config: { maxConnections: 100_000 } };
    const edges: SimEdge[] = [
      { id: 'e-users-cache', source: 'users-1', target: 'cache-1' },
      { id: 'e-cache-db-a', source: 'cache-1', target: 'db-1' },
      { id: 'e-cache-db-b', source: 'cache-1', target: 'db-1' }, // duplicate edge, same target
    ];
    const global: GlobalConfig = { users: 1000, rpsPerUser: 1, readWriteRatio: 1 };
    const result = solve(graph([users, cache, database], edges, global));

    // hitRatio 0 -> all 1000 rps miss through to the DB exactly once, not twice.
    expect(result.nodes['db-1'].inRps).toBeCloseTo(1000, 6);
    // Split evenly across the two duplicate edges to that one target.
    expect(result.edges['e-cache-db-a'].rps).toBeCloseTo(500, 6);
    expect(result.edges['e-cache-db-b'].rps).toBeCloseTo(500, 6);
  });

  it('splitLoadBalancer: a duplicated target does not get double weight under round-robin', () => {
    const users = usersNode(1000);
    const lb: SimNode = { id: 'lb-1', kind: 'loadbalancer', label: 'LB', config: { algorithm: 'round-robin' } };
    const serverA: SimNode = { id: 'server-a', kind: 'server', label: 'A', config: { instances: 10, rpsPerInstance: 500 } };
    const serverB: SimNode = { id: 'server-b', kind: 'server', label: 'B', config: { instances: 10, rpsPerInstance: 500 } };
    const edges: SimEdge[] = [
      { id: 'e-users-lb', source: 'users-1', target: 'lb-1' },
      { id: 'e-lb-a-1', source: 'lb-1', target: 'server-a' },
      { id: 'e-lb-a-2', source: 'lb-1', target: 'server-a' }, // duplicate edge to A
      { id: 'e-lb-b', source: 'lb-1', target: 'server-b' },
    ];
    const global: GlobalConfig = { users: 1000, rpsPerUser: 1, readWriteRatio: 1 };
    const result = solve(graph([users, lb, serverA, serverB], edges, global));

    // 2 DISTINCT targets -> 50/50 split, not 2/3 to A because it has 2 edges.
    expect(result.nodes['server-a'].inRps).toBeCloseTo(500, 6);
    expect(result.nodes['server-b'].inRps).toBeCloseTo(500, 6);
    // A's share is itself split evenly across its 2 duplicate edges.
    expect(result.edges['e-lb-a-1'].rps).toBeCloseTo(250, 6);
    expect(result.edges['e-lb-a-2'].rps).toBeCloseTo(250, 6);
  });
});

// ---------------------------------------------------------------------------
// M5(d) — least-connections LB unit test
// ---------------------------------------------------------------------------

describe('solve() — load balancer least-connections weighting', () => {
  it('favors the target with more remaining (nominal) capacity', () => {
    const users = usersNode(500);
    const lb: SimNode = { id: 'lb-1', kind: 'loadbalancer', label: 'LB', config: { algorithm: 'least-connections' } };
    // server-1: capacity 1000; server-2: capacity 4000 -> 1:4 weighting.
    const server1: SimNode = { id: 'server-1', kind: 'server', label: '1', config: { instances: 1, rpsPerInstance: 1000 } };
    const server2: SimNode = { id: 'server-2', kind: 'server', label: '2', config: { instances: 1, rpsPerInstance: 4000 } };
    const edges: SimEdge[] = [
      { id: 'e-users-lb', source: 'users-1', target: 'lb-1' },
      { id: 'e-lb-1', source: 'lb-1', target: 'server-1' },
      { id: 'e-lb-2', source: 'lb-1', target: 'server-2' },
    ];
    const global: GlobalConfig = { users: 500, rpsPerUser: 1, readWriteRatio: 1 };
    const result = solve(graph([users, lb, server1, server2], edges, global));

    // Total 500 rps split 1:4 by nominal capacity -> 100 / 400.
    expect(result.nodes['server-1'].inRps).toBeCloseTo(100, 6);
    expect(result.nodes['server-2'].inRps).toBeCloseTo(400, 6);
  });
});

// ---------------------------------------------------------------------------
// M4 — queue-specific health bands
// ---------------------------------------------------------------------------

describe('solve() — M4 queue health bands', () => {
  function queueAt(util1: number) {
    // workers=10, jobsPerWorkerRps=100 -> drain rate 1000 rps; users count IS
    // util1 x 1000 (all-read traffic, rpsPerUser=1). Queue has no downstream —
    // it's a pure write-behind sink, which is fine for health purposes.
    const users = usersNode(util1 * 1000);
    const queue: SimNode = {
      id: 'queue-1',
      kind: 'queue',
      label: 'Queue',
      config: { workers: 10, jobsPerWorkerRps: 100 },
    };
    const edges: SimEdge[] = [{ id: 'e1', source: 'users-1', target: 'queue-1' }];
    const global: GlobalConfig = { users: util1 * 1000, rpsPerUser: 1, readWriteRatio: 1 };
    return solve(graph([users, queue], edges, global)).nodes['queue-1'];
  }

  it('ok below 0.7, warn 0.7-1.0', () => {
    expect(queueAt(0.5).health).toBe('ok');
    expect(queueAt(0.85).health).toBe('warn');
  });

  it('hot 1.0-1.5 (backlog growing, still draining) — not "down" like a failing server', () => {
    const m = queueAt(1.2);
    expect(m.health).toBe('hot');
    expect(m.warnings).toContain("Backlog growing — consumers can't keep up");
  });

  it('overloaded 1.5-2.0, down only past 2.0', () => {
    expect(queueAt(1.4).health).toBe('overloaded');
    expect(queueAt(2.5).health).toBe('down');
  });

  it('no backlog warning while comfortably under capacity', () => {
    expect(queueAt(0.5).warnings).not.toContain("Backlog growing — consumers can't keep up");
  });
});

// ---------------------------------------------------------------------------
// Knob 1 — autoscaling
// ---------------------------------------------------------------------------

describe('solve() — autoscaling knob', () => {
  it('scales instances up to hold utilization near the target as load rises', () => {
    const users = usersNode(350);
    const server: SimNode = {
      id: 'server-1',
      kind: 'server',
      label: 'Server',
      config: {
        rpsPerInstance: 100,
        autoscale: 'on',
        minInstances: 1,
        maxInstances: 10,
        targetUtilization: 0.7,
      },
    };
    const database: SimNode = { id: 'db-1', kind: 'database', label: 'DB', config: { shards: 10, maxConnections: 100_000 } };
    const edges: SimEdge[] = [
      { id: 'e1', source: 'users-1', target: 'server-1' },
      { id: 'e2', source: 'server-1', target: 'db-1' },
    ];
    const global: GlobalConfig = { users: 350, rpsPerUser: 1, readWriteRatio: 1 };
    const result = solve(graph([users, server, database], edges, global));

    // needed = ceil(350 / (100 * 0.7)) = ceil(5) = 5
    expect(result.nodes['server-1'].effectiveInstances).toBe(5);
    // capacity = 5 * 100 = 500 -> util = 350/500 = 0.7
    expect(result.nodes['server-1'].utilization).toBeCloseTo(0.7, 6);
    expect(result.nodes['server-1'].servedRps).toBeCloseTo(350, 6);
    // Cost follows effectiveInstances (80 x 5), not the nominal `instances` field.
    expect(result.nodes['server-1'].costPerMonth).toBeCloseTo(80 * 5, 6);
    expect(result.nodes['server-1'].warnings).not.toContain(
      'Autoscaler maxed out — raise the ceiling or add capacity elsewhere',
    );
  });

  it('pins at maxInstances and warns when demand exceeds the ceiling', () => {
    const users = usersNode(10_000);
    const server: SimNode = {
      id: 'server-1',
      kind: 'server',
      label: 'Server',
      config: {
        rpsPerInstance: 100,
        autoscale: 'on',
        minInstances: 1,
        maxInstances: 3,
        targetUtilization: 0.7,
      },
    };
    const edges: SimEdge[] = [{ id: 'e1', source: 'users-1', target: 'server-1' }];
    const global: GlobalConfig = { users: 10_000, rpsPerUser: 1, readWriteRatio: 1 };
    const result = solve(graph([users, server], edges, global));

    // needed = ceil(10000 / 70) = 143, way past maxInstances=3 -> pinned.
    expect(result.nodes['server-1'].effectiveInstances).toBe(3);
    expect(result.nodes['server-1'].costPerMonth).toBeCloseTo(80 * 3, 6);
    expect(result.nodes['server-1'].warnings).toContain(
      'Autoscaler maxed out — raise the ceiling or add capacity elsewhere',
    );
  });
});

// ---------------------------------------------------------------------------
// Knobs 2-3 — retries and circuit breaker (second solve pass)
// ---------------------------------------------------------------------------

describe('solve() — retry amplification and circuit breaker knobs', () => {
  // Shared shape: users -> server -> database (writes only, so DB write
  // capacity — 4000 rps for 1 shard — is the easy, deliberate bottleneck).
  // Server itself has huge capacity so it's never the constraint.
  function build(serverConfig: SimNode['config']) {
    const users = usersNode(6000);
    const server: SimNode = {
      id: 'server-1',
      kind: 'server',
      label: 'Server',
      config: { instances: 100, rpsPerInstance: 1000, ...serverConfig },
    };
    const database: SimNode = {
      id: 'db-1',
      kind: 'database',
      label: 'DB',
      config: { shards: 1, maxConnections: 100_000 },
    };
    const edges: SimEdge[] = [
      { id: 'e1', source: 'users-1', target: 'server-1' },
      { id: 'e2', source: 'server-1', target: 'db-1' },
    ];
    const global: GlobalConfig = { users: 6000, rpsPerUser: 1, readWriteRatio: 0 }; // all writes
    return solve(graph([users, server, database], edges, global));
  }

  it('with retries off, downstream just sees the plain (unamplified) forwarded load', () => {
    const result = build({});
    expect(result.nodes['server-1'].retriedRps ?? 0).toBeCloseTo(0, 6);
    expect(result.nodes['db-1'].inRps).toBeCloseTo(6000, 6);
  });

  it('retries amplify downstream demand once the dependency is overloaded (pass-1 util > 1)', () => {
    const result = build({ retriesEnabled: 'on', maxRetries: 3 });
    // Server's own client-facing numbers are unaffected by retries.
    expect(result.nodes['server-1'].servedRps).toBeCloseTo(6000, 6);
    // But it generated substantial extra downstream demand...
    expect(result.nodes['server-1'].retriedRps).toBeGreaterThan(0);
    // ...and the database sees noticeably MORE than the original 6000 rps as a result.
    expect(result.nodes['db-1'].inRps).toBeGreaterThan(6000);
  });

  it('circuit breaker sheds (not drops) traffic and protects the downstream dependency', () => {
    const result = build({ circuitBreaker: 'on', circuitThreshold: 0.9 });
    const server = result.nodes['server-1'];
    const db = result.nodes['db-1'];

    expect(server.shedRps).toBeGreaterThan(0);
    expect(server.droppedRps).toBeCloseTo(0, 6); // fail-fast shed, not an error
    // Downstream is meaningfully protected vs. the un-mitigated case (db would
    // otherwise see the full 6000 rps against its 4000 rps write capacity).
    expect(db.utilization).toBeLessThanOrEqual(0.9 + 1e-6);
    expect(db.inRps).toBeLessThan(6000);
  });

  it('a tripped breaker suppresses retry amplification (breaker takes precedence)', () => {
    const result = build({
      circuitBreaker: 'on',
      circuitThreshold: 0.9,
      retriesEnabled: 'on',
      maxRetries: 3,
    });
    expect(result.nodes['server-1'].retriedRps ?? 0).toBeCloseTo(0, 6);
    expect(result.nodes['server-1'].shedRps).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Knob 4 — database connection pool
// ---------------------------------------------------------------------------

describe('solve() — connection pool binding knob', () => {
  it('a too-small pool caps throughput before disk/CPU capacity does, and warns', () => {
    const build = (maxConnections: number) => {
      const users = usersNode(5000);
      const database: SimNode = {
        id: 'db-1',
        kind: 'database',
        label: 'DB',
        config: { shards: 1, readReplicas: 0, maxConnections },
      };
      const edges: SimEdge[] = [{ id: 'e1', source: 'users-1', target: 'db-1' }];
      const global: GlobalConfig = { users: 5000, rpsPerUser: 1, readWriteRatio: 1 }; // all reads
      return solve(graph([users, database], edges, global));
    };

    const constrained = build(100); // connCapacityRps = 100 * 1000/12 = 8333.3
    const unconstrained = build(100_000); // connCapacityRps way above readCap (8000)

    expect(constrained.nodes['db-1'].warnings).toContain(
      'Connection pool exhausted before disk/CPU — raise max_connections or add a pooler',
    );
    expect(unconstrained.nodes['db-1'].warnings).not.toContain(
      'Connection pool exhausted before disk/CPU — raise max_connections or add a pooler',
    );
    expect(constrained.nodes['db-1'].utilization).toBeGreaterThan(unconstrained.nodes['db-1'].utilization);
  });
});

// ---------------------------------------------------------------------------
// Knob 5 — pub/sub queue mode
// ---------------------------------------------------------------------------

describe('solve() — pub/sub queue mode', () => {
  function build(mode: 'queue' | 'pubsub') {
    const users = usersNode(900);
    const queue: SimNode = {
      id: 'queue-1',
      kind: 'queue',
      label: 'Queue',
      config: { workers: 10, jobsPerWorkerRps: 100, mode, subscriberCount: 3 },
    };
    const serverA: SimNode = { id: 'server-a', kind: 'server', label: 'A', config: { instances: 100, rpsPerInstance: 1000 } };
    const serverB: SimNode = { id: 'server-b', kind: 'server', label: 'B', config: { instances: 100, rpsPerInstance: 1000 } };
    const edges: SimEdge[] = [
      { id: 'e-users-queue', source: 'users-1', target: 'queue-1' },
      { id: 'e-queue-a', source: 'queue-1', target: 'server-a' },
      { id: 'e-queue-b', source: 'queue-1', target: 'server-b' },
    ];
    const global: GlobalConfig = { users: 900, rpsPerUser: 1, readWriteRatio: 1 };
    return solve(graph([users, queue, serverA, serverB], edges, global));
  }

  it('point-to-point queue mode splits drained traffic across downstream edges', () => {
    const result = build('queue');
    // drain rate 1000 comfortably covers 900 rps admitted -> healthy, no drop.
    expect(result.nodes['queue-1'].health).toBe('warn'); // util 0.9, in [0.7,1.0)
    expect(result.nodes['queue-1'].droppedRps).toBeCloseTo(0, 3);
    // Split (not broadcast) across the 2 downstream edges.
    expect(result.edges['e-queue-a'].rps).toBeCloseTo(450, 3);
    expect(result.edges['e-queue-b'].rps).toBeCloseTo(450, 3);
  });

  it('pub/sub mode delivers the FULL stream to every subscriber and multiplies drain demand', () => {
    const result = build('pubsub');
    // demand = 900 x 3 = 2700 vs drain 1000 -> deeply overloaded, unlike 'queue' mode.
    expect(result.nodes['queue-1'].health).toBe('down');
    expect(result.nodes['queue-1'].utilization).toBeGreaterThan(2);

    // Both edges get the SAME full amount (broadcast), not a split.
    const rpsA = result.edges['e-queue-a'].rps;
    const rpsB = result.edges['e-queue-b'].rps;
    expect(rpsA).toBeCloseTo(rpsB, 3);
    expect(rpsA).toBeGreaterThan(0);
    // Each subscriber's edge carries the full served-per-subscriber amount,
    // not half of it the way point-to-point splitting would.
    expect(result.nodes['server-a'].inRps).toBeCloseTo(rpsA, 6);
    expect(result.nodes['server-b'].inRps).toBeCloseTo(rpsB, 6);
  });
});
