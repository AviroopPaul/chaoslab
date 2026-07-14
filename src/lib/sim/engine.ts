import { CATALOG } from './catalog';
import type {
  ComponentKind,
  EdgeMetrics,
  Health,
  NodeConfig,
  NodeMetrics,
  SimEdge,
  SimGraph,
  SimNode,
  SimResult,
} from './types';

/**
 * ChaosLab simulation engine.
 *
 * `solve()` is a pure function: SimGraph -> SimResult. No React, no Date.now,
 * no Math.random. Traffic is modeled as `{ read, write }` request-per-second
 * tuples that flow along edges starting from `users` nodes, through a
 * topologically-ordered walk of the graph (Kahn's algorithm; cycles are
 * broken by dropping "back" edges and emitting a graph warning).
 *
 * Every node kind applies its own capacity/behavior model (see the per-kind
 * `process*` functions below), then fans its remaining outgoing traffic out
 * across its downstream edges (see `distributeEvenly`, `splitLoadBalancer`,
 * and `routeFromServer`). Traffic that a node cannot route anywhere (no
 * matching downstream, or literally no outgoing edges) is folded into that
 * node's dropped counters — it's a structural/config problem, not a capacity
 * problem, but from the system's point of view it's still a failed request.
 *
 * The engine never mutates the input graph and never throws on malformed
 * input (missing users node, disconnected components, cycles, edges to
 * unknown node ids) — it degrades gracefully instead.
 */

// ---------------------------------------------------------------------------
// Small numeric helpers — everything here guards against NaN/Infinity so the
// public SimResult never contains a non-finite number.
// ---------------------------------------------------------------------------

function num(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Capacity constants — from SPEC.md §3. `catalog.ts` doesn't carry raw
// numeric capacities (only cost/latency/field metadata), so they live here.
// ---------------------------------------------------------------------------

// Exported (in addition to being used internally below) so UI-facing code —
// notably the practice-mode component datasheet (src/lib/practice/datasheet.ts)
// — can read the same numbers instead of re-hardcoding them and risking drift.
export const CDN_CAPACITY = 5_000_000;
export const LOADBALANCER_CAPACITY = 200_000;
export const CACHE_CAPACITY = 300_000;
export const QUEUE_ENQUEUE_CAPACITY = 500_000;
export const STORAGE_CAPACITY = 100_000;
export const DB_WRITE_RPS_PER_SHARD = 4_000;
export const DB_READ_RPS_PER_SHARD = 8_000;

/** Utilization above which a node "goes down" and serves at half effective capacity. */
const DOWN_UTIL_THRESHOLD = 1.5;
const DOWN_PENALTY_FACTOR = 0.5;

// ---------------------------------------------------------------------------
// Per-kind raw capacity formulas — the SINGLE source of truth for "how big is
// this node", used both by LB least-connections weighting (via
// `baseCapacity`, below) and by the per-kind node processing in `runPass`.
// Keeping these as standalone functions (rather than duplicating the same
// arithmetic inline in two places) is a deliberate fix for a desync bug an
// audit found: the LB-weighting copy and the node-processing copy could drift
// apart under maintenance. Not the same as effective/served capacity after
// the down-penalty ramp — that's computed inline per node in `runPass`.
// ---------------------------------------------------------------------------

function serverCapacity(cfg: NodeConfig): number {
  const instances = Math.max(1, num(cfg.instances, CATALOG.server.defaultConfig.instances ?? 1));
  const rpsPerInstance = Math.max(1, num(cfg.rpsPerInstance, CATALOG.server.defaultConfig.rpsPerInstance ?? 500));
  return instances * rpsPerInstance;
}

function rateLimiterCapacity(cfg: NodeConfig): number {
  return Math.max(1, num(cfg.limitRps, CATALOG.ratelimiter.defaultConfig.limitRps ?? 10_000));
}

function cacheCapacity(cfg: NodeConfig): number {
  return Math.max(10_000, num(cfg.capacityRps, CATALOG.cache.defaultConfig.capacityRps ?? CACHE_CAPACITY));
}

function cdnCapacity(cfg: NodeConfig): number {
  return Math.max(10_000, num(cfg.capacityRps, CATALOG.cdn.defaultConfig.capacityRps ?? CDN_CAPACITY));
}

function databaseCapacities(cfg: NodeConfig): { readCap: number; writeCap: number } {
  const shards = Math.max(1, num(cfg.shards, CATALOG.database.defaultConfig.shards ?? 1));
  const replicas = Math.max(0, num(cfg.readReplicas, CATALOG.database.defaultConfig.readReplicas ?? 0));
  return {
    writeCap: DB_WRITE_RPS_PER_SHARD * shards,
    readCap: DB_READ_RPS_PER_SHARD * shards * (1 + replicas),
  };
}

function queueDrainCapacity(cfg: NodeConfig): number {
  const workers = Math.max(1, num(cfg.workers, CATALOG.queue.defaultConfig.workers ?? 10));
  const jobsPerWorkerRps = Math.max(1, num(cfg.jobsPerWorkerRps, CATALOG.queue.defaultConfig.jobsPerWorkerRps ?? 50));
  return workers * jobsPerWorkerRps;
}

/** "How big is this node" bookkeeping used for LB least-connections weighting. */
function baseCapacity(node: SimNode): number {
  const cfg = node.config;
  switch (node.kind) {
    case 'users':
      return Infinity;
    case 'cdn':
      return cdnCapacity(cfg);
    case 'cache':
      return cacheCapacity(cfg);
    case 'loadbalancer':
      return LOADBALANCER_CAPACITY;
    case 'ratelimiter':
      return rateLimiterCapacity(cfg);
    case 'server':
      return serverCapacity(cfg);
    case 'database': {
      const { readCap, writeCap } = databaseCapacities(cfg);
      return readCap + writeCap;
    }
    case 'queue':
      return queueDrainCapacity(cfg);
    case 'storage':
      return STORAGE_CAPACITY;
    default:
      return Infinity;
  }
}

// ---------------------------------------------------------------------------
// Generic single-capacity model shared by cdn/cache/loadbalancer/ratelimiter/
// server/storage: total inflow vs. one capacity number, with the "down"
// penalty applied as a single re-pass once first-pass utilization is known.
// `overflowMode` decides whether excess is a hard drop (error) or a shed
// (deliberate, e.g. rate limiter).
// ---------------------------------------------------------------------------

interface CapacityResult {
  servedRead: number;
  servedWrite: number;
  droppedRead: number;
  droppedWrite: number;
  shedRead: number;
  shedWrite: number;
  util: number;
  /** database only: true when the connection pool (not disk/CPU) is the binding constraint. */
  poolBinding?: boolean;
}

function applyCapacity(
  inRead: number,
  inWrite: number,
  capacity: number,
  overflowMode: 'drop' | 'shed',
): CapacityResult {
  const totalIn = inRead + inWrite;
  const cap = Math.max(capacity, 1e-9);

  // C1 fix: effective capacity ramps down CONTINUOUSLY from full capacity at
  // util1=1 to half capacity at util1>=2, instead of snapping instantly the
  // moment util1 crosses the old 1.5 threshold. `clamp01(util1 - 1)` is 0 at
  // util1<=1 (no penalty) and 1 at util1>=2 (full 0.5x penalty), linear
  // between — so a 0.1% change in offered load now produces a ~0.1% change
  // in served RPS, never a step.
  const util1 = totalIn > 0 ? totalIn / cap : 0;
  const capEff = cap * (1 - DOWN_PENALTY_FACTOR * clamp01(util1 - 1));
  const util = totalIn > 0 ? totalIn / capEff : 0;

  const servedTotal = Math.min(totalIn, capEff);
  const overflow = Math.max(0, totalIn - servedTotal);
  const readShare = totalIn > 0 ? inRead / totalIn : 0;

  const servedRead = servedTotal * readShare;
  const servedWrite = servedTotal - servedRead;
  const overflowRead = overflow * readShare;
  const overflowWrite = overflow - overflowRead;

  return overflowMode === 'drop'
    ? {
        servedRead,
        servedWrite,
        droppedRead: overflowRead,
        droppedWrite: overflowWrite,
        shedRead: 0,
        shedWrite: 0,
        util,
      }
    : {
        servedRead,
        servedWrite,
        droppedRead: 0,
        droppedWrite: 0,
        shedRead: overflowRead,
        shedWrite: overflowWrite,
        util,
      };
}

/** "Ideal" bypass: pretend capacity is infinite (util -> 0), nothing drops or sheds. */
function idealCapacity(inRead: number, inWrite: number): CapacityResult {
  return {
    servedRead: inRead,
    servedWrite: inWrite,
    droppedRead: 0,
    droppedWrite: 0,
    shedRead: 0,
    shedWrite: 0,
    util: 0,
  };
}

/**
 * Rate limiter: unlike the other capacity-bound kinds, a limiter is a
 * stateless O(1) admission gate, not a queueing server — it never "backs up"
 * or degrades the requests it lets through, it just shreds whatever is over
 * the configured rate. So there's no M/M/1 queueing blowup and no "down"
 * penalty for what gets admitted; utilization is capped at 1.0 (fully
 * saturated, but not "overloaded" in the serving sense) even when far more
 * traffic than the limit is being offered.
 */
function applyRateLimit(inRead: number, inWrite: number, limitRps: number): CapacityResult {
  const totalIn = inRead + inWrite;
  const cap = Math.max(limitRps, 1e-9);
  const servedTotal = Math.min(totalIn, cap);
  const shed = Math.max(0, totalIn - servedTotal);
  const readShare = totalIn > 0 ? inRead / totalIn : 0;
  const util = totalIn > 0 ? Math.min(totalIn / cap, 1) : 0;
  return {
    servedRead: servedTotal * readShare,
    servedWrite: servedTotal - servedTotal * readShare,
    droppedRead: 0,
    droppedWrite: 0,
    shedRead: shed * readShare,
    shedWrite: shed - shed * readShare,
    util,
  };
}

// ---------------------------------------------------------------------------
// Database: separate read/write capacities, util = max(readUtil, writeUtil),
// with the same single-pass "down" penalty applied to both capacities at once
// (it's one physical box overloading, not two independent ones).
// ---------------------------------------------------------------------------

function processDatabase(inRead: number, inWrite: number, cfg: NodeConfig, ideal: boolean): CapacityResult {
  if (ideal) return idealCapacity(inRead, inWrite);

  const { readCap: readCapRaw, writeCap: writeCapRaw } = databaseCapacities(cfg);

  // Knob 4 — connection pool (Little's Law): connCapacityRps = maxConnections
  // x (1000 / baseLatencyMs). If that's smaller than the disk/CPU-derived
  // read+write capacity, the pool becomes the binding constraint — scale both
  // capacities down proportionally so combined served throughput never
  // exceeds what the pool can carry.
  const maxConnections = Math.max(10, num(cfg.maxConnections, CATALOG.database.defaultConfig.maxConnections ?? 400));
  const connCapacityRps = maxConnections * (1000 / CATALOG.database.baseLatencyMs);
  const combinedRaw = readCapRaw + writeCapRaw;
  const poolScale = combinedRaw > 1e-9 ? Math.min(1, connCapacityRps / combinedRaw) : 1;

  let readCap = readCapRaw * poolScale;
  let writeCap = writeCapRaw * poolScale;

  const readUtil1 = inRead / Math.max(readCap, 1e-9);
  const writeUtil1 = inWrite / Math.max(writeCap, 1e-9);
  const util1 = Math.max(readUtil1, writeUtil1);

  // The pool is the *actual* binding constraint (as opposed to a merely
  // theoretical one) once it's genuinely smaller than disk/CPU capacity AND
  // load is high enough to be pushing against it.
  const poolBinding = poolScale < 0.999 && util1 >= 0.9;

  // C1 fix: same continuous down-penalty ramp as applyCapacity — one
  // physical box overloading, not two independent ones, so a single ramp
  // factor (from the worse of read/write util1) is applied to both capacities.
  const rampFactor = 1 - DOWN_PENALTY_FACTOR * clamp01(util1 - 1);
  writeCap *= rampFactor;
  readCap *= rampFactor;

  const readUtil = inRead / Math.max(readCap, 1e-9);
  const writeUtil = inWrite / Math.max(writeCap, 1e-9);
  const util = Math.max(readUtil, writeUtil);

  const servedRead = Math.min(inRead, readCap);
  const droppedRead = Math.max(0, inRead - readCap);
  const servedWrite = Math.min(inWrite, writeCap);
  const droppedWrite = Math.max(0, inWrite - writeCap);

  return { servedRead, servedWrite, droppedRead, droppedWrite, shedRead: 0, shedWrite: 0, util, poolBinding };
}

// ---------------------------------------------------------------------------
// Queue: enqueue nearly always succeeds up to a large flat enqueue capacity;
// the real bottleneck is drain rate (workers * jobsPerWorkerRps). Backlog
// grows (utilization climbs) once enqueue > drain, but requests are only
// actually dropped once admitted load exceeds 2x drain rate.
// ---------------------------------------------------------------------------

function processQueue(inRead: number, inWrite: number, cfg: NodeConfig, ideal: boolean): CapacityResult {
  if (ideal) return idealCapacity(inRead, inWrite);

  const rawDrainRate = queueDrainCapacity(cfg);

  const totalIn = inRead + inWrite;
  const enqueueDropped = Math.max(0, totalIn - QUEUE_ENQUEUE_CAPACITY);
  const admitted = Math.min(totalIn, QUEUE_ENQUEUE_CAPACITY);

  // Knob 5 — pub/sub mode: every subscriber gets its own full copy of the
  // drained stream (fan-out), so the workers must collectively drain
  // `admitted x subscriberCount`, not just `admitted`. Plain queue mode is the
  // subscriberCount=1 case, which reduces to the original math exactly.
  const isPubsub = (cfg.mode ?? CATALOG.queue.defaultConfig.mode ?? 'queue') === 'pubsub';
  const subscriberCount = isPubsub
    ? Math.max(1, Math.round(num(cfg.subscriberCount, CATALOG.queue.defaultConfig.subscriberCount ?? 3)))
    : 1;
  const demand = admitted * subscriberCount;

  // C1 fix: continuous down-penalty ramp (see applyCapacity) applied to drain
  // rate instead of the old instant-halving step at util1 > 1.5.
  const util1 = rawDrainRate > 0 ? demand / rawDrainRate : 0;
  const drainEff = rawDrainRate * (1 - DOWN_PENALTY_FACTOR * clamp01(util1 - 1));
  const util = drainEff > 0 ? demand / drainEff : 0;

  const backlogCeiling = drainEff * 2;
  const backlogDroppedDemand = Math.max(0, demand - backlogCeiling);
  const servedDemand = demand - backlogDroppedDemand;

  // Convert back from "demand" units (post fan-out multiplication) to
  // "admitted message" units so served/dropped stay conserved against inRead/
  // inWrite regardless of subscriberCount.
  const servedTotal = servedDemand / subscriberCount;
  const backlogDropped = backlogDroppedDemand / subscriberCount;
  const totalDropped = enqueueDropped + backlogDropped;

  const readShare = totalIn > 0 ? inRead / totalIn : 0;
  const servedRead = servedTotal * readShare;
  const servedWrite = servedTotal - servedRead;
  const droppedRead = totalDropped * readShare;
  const droppedWrite = totalDropped - droppedRead;

  return { servedRead, servedWrite, droppedRead, droppedWrite, shedRead: 0, shedWrite: 0, util };
}

// ---------------------------------------------------------------------------
// Health & latency
// ---------------------------------------------------------------------------

function healthOf(util: number, totalIn: number): Health {
  if (totalIn < 1e-9) return 'idle';
  if (util < 0.7) return 'ok';
  if (util < 0.9) return 'warn';
  if (util <= 1.0) return 'hot';
  if (util <= DOWN_UTIL_THRESHOLD) return 'overloaded';
  return 'down';
}

/**
 * M4 fix: a queue has different failure semantics than a server/database — a
 * growing backlog (util 1.0-2.0) is degraded-but-draining, not "down". Actual
 * message loss only starts once admitted load exceeds 2x drain rate, so
 * that's where 'down' begins for a queue (vs. 1.5x for capacity-bound kinds).
 */
function healthOfQueue(util: number, totalIn: number): Health {
  if (totalIn < 1e-9) return 'idle';
  if (util < 0.7) return 'ok';
  if (util < 1.0) return 'warn';
  if (util <= 1.5) return 'hot';
  if (util <= 2.0) return 'overloaded';
  return 'down';
}

/**
 * M1 fix: the old cap (`min(raw, 20 x base)`) meant latency flatlined at 20x
 * base starting around ρ≈0.952 clear through total meltdown — 95% load looked
 * identical to a 10x overload. The cap now grows with overload itself
 * (`20 x base x max(1, util)`, `util` here being the pre-rho-clamp value the
 * caller passes in), so latency keeps climbing past saturation instead of
 * pinning, up to an outer ceiling of 50x base.
 */
function latencyOf(baseMs: number, util: number): number {
  const rho = Math.min(Math.max(util, 0), 0.999);
  const raw = baseMs * (1 + (rho * rho) / (1 - rho));
  const overloadMultiplier = Math.min(20 * Math.max(1, util), 50);
  const cap = baseMs * overloadMultiplier;
  return finite(Math.min(raw, cap));
}

// ---------------------------------------------------------------------------
// Fan-out helpers. Each returns the per-edge flow assigned plus whatever
// portion of the outgoing traffic could not be routed anywhere (folded back
// into the caller's dropped counters).
// ---------------------------------------------------------------------------

interface Flow {
  read: number;
  write: number;
}

interface FanOutResult {
  edgeFlow: Map<string, Flow>;
  unroutedRead: number;
  unroutedWrite: number;
  warnings: string[];
}

/** Group outgoing edges by their target node id (M3 fix helper). */
function groupEdgesByTarget(outEdges: SimEdge[]): Map<string, SimEdge[]> {
  const byTarget = new Map<string, SimEdge[]>();
  for (const edge of outEdges) {
    const list = byTarget.get(edge.target);
    if (list) list.push(edge);
    else byTarget.set(edge.target, [edge]);
  }
  return byTarget;
}

/**
 * Split outgoing traffic evenly across every DISTINCT downstream target (the
 * default fan-out rule). M3 fix: two duplicate edges to the same target used
 * to each get a full 1/N share, silently doubling that target's traffic —
 * now the target's share is computed once and only then divided equally
 * across its own duplicate edges.
 */
function distributeEvenly(outRead: number, outWrite: number, outEdges: SimEdge[]): FanOutResult {
  const edgeFlow = new Map<string, Flow>();
  if (outEdges.length === 0) {
    return { edgeFlow, unroutedRead: outRead, unroutedWrite: outWrite, warnings: [] };
  }
  const byTarget = groupEdgesByTarget(outEdges);
  const targetShare = 1 / byTarget.size;
  for (const edgesForTarget of byTarget.values()) {
    const perEdgeShare = targetShare / edgesForTarget.length;
    for (const edge of edgesForTarget) {
      edgeFlow.set(edge.id, { read: outRead * perEdgeShare, write: outWrite * perEdgeShare });
    }
  }
  return { edgeFlow, unroutedRead: 0, unroutedWrite: 0, warnings: [] };
}

/**
 * Knob 5 (pub/sub queue): broadcast the FULL flow to every outgoing edge
 * rather than splitting it — each subscriber gets its own complete copy of
 * the stream. (Unlike `distributeEvenly`, duplicate edges to the same target
 * are not deduped here — a duplicate edge in pub/sub mode models a second,
 * independent subscription to the same downstream node, which legitimately
 * should receive its own full copy too.)
 */
function broadcastToAll(outRead: number, outWrite: number, outEdges: SimEdge[]): FanOutResult {
  const edgeFlow = new Map<string, Flow>();
  for (const edge of outEdges) {
    edgeFlow.set(edge.id, { read: outRead, write: outWrite });
  }
  return { edgeFlow, unroutedRead: 0, unroutedWrite: 0, warnings: [] };
}

/**
 * Load balancer fan-out: equal split for round-robin; for least-connections,
 * proportional to each downstream target's *remaining* capacity. Since the
 * engine does a single topological pass, "remaining capacity" is tracked via
 * a shared `remainingCapacity` map that every fan-out decrements as it
 * assigns flow — so two load balancers feeding the same pool of servers
 * still get plausible (order-dependent, but self-consistent) results.
 */
function splitLoadBalancer(
  outRead: number,
  outWrite: number,
  outEdges: SimEdge[],
  algorithm: 'round-robin' | 'least-connections',
  remainingCapacity: Map<string, number>,
): FanOutResult {
  const edgeFlow = new Map<string, Flow>();
  if (outEdges.length === 0) {
    return {
      edgeFlow,
      unroutedRead: outRead,
      unroutedWrite: outWrite,
      warnings: ['Load balancer has no downstream servers'],
    };
  }

  // M3 fix: weight (and split) per DISTINCT target, not per edge — a target
  // wired up twice used to get counted (and therefore weighted/fed) twice.
  const byTarget = groupEdgesByTarget(outEdges);
  const targets = Array.from(byTarget.keys());

  let weights: number[];
  if (algorithm === 'least-connections') {
    weights = targets.map((t) => Math.max(remainingCapacity.get(t) ?? 1e-6, 1e-6));
  } else {
    weights = targets.map(() => 1);
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  targets.forEach((target, i) => {
    const share = weights[i] / totalWeight;
    const edgesForTarget = byTarget.get(target)!;
    const perEdgeShare = share / edgesForTarget.length;
    for (const edge of edgesForTarget) {
      edgeFlow.set(edge.id, { read: outRead * perEdgeShare, write: outWrite * perEdgeShare });
    }
  });
  return { edgeFlow, unroutedRead: 0, unroutedWrite: 0, warnings: [] };
}

/**
 * Server request routing (SPEC.md §4): a server's outgoing edges may point at
 * several different downstream kinds at once. We model this as one routing
 * decision per traffic type, not a literal broadcast:
 *   - READS go to a cache if one is downstream, else straight to a database.
 *     Additionally, 10% of reads are treated as static-asset requests and
 *     routed to object storage if a storage node is downstream (this slice
 *     is carved out of reads *before* the cache/db split, not duplicated on
 *     top of it).
 *   - WRITES go to a queue if one is downstream (async write-behind — the
 *     queue absorbs the synchronous write load), else straight to a database.
 * If a server has multiple downstream edges of the *same* winning kind (e.g.
 * two databases), that kind's share is split evenly across them.
 * Traffic with no matching downstream kind at all has nowhere to go and is
 * reported back as "unrouted" (the caller folds it into dropped traffic).
 */
function routeFromServer(servedRead: number, servedWrite: number, outEdges: SimEdge[], nodesById: Map<string, SimNode>): FanOutResult {
  // M5(b): a bare server with no downstream at all gets a single, clearer
  // warning instead of the separate read/write "nowhere to go" messages.
  if (outEdges.length === 0) {
    const hasTraffic = servedRead + servedWrite > 1e-9;
    return {
      edgeFlow: new Map(),
      unroutedRead: servedRead,
      unroutedWrite: servedWrite,
      warnings: hasTraffic ? ['Server has no downstream — connect a database to serve reads/writes'] : [],
    };
  }

  const kindOf = (edge: SimEdge): ComponentKind | undefined => nodesById.get(edge.target)?.kind;

  const cacheEdges = outEdges.filter((e) => kindOf(e) === 'cache');
  const dbEdges = outEdges.filter((e) => kindOf(e) === 'database');
  const queueEdges = outEdges.filter((e) => kindOf(e) === 'queue');
  const storageEdges = outEdges.filter((e) => kindOf(e) === 'storage');

  const storageRead = storageEdges.length > 0 ? servedRead * 0.1 : 0;
  const remainingRead = servedRead - storageRead;

  const readTargets = cacheEdges.length > 0 ? cacheEdges : dbEdges.length > 0 ? dbEdges : [];
  const writeTargets = queueEdges.length > 0 ? queueEdges : dbEdges.length > 0 ? dbEdges : [];

  const edgeFlow = new Map<string, Flow>();
  const addFlow = (edge: SimEdge, read: number, write: number) => {
    const existing = edgeFlow.get(edge.id) ?? { read: 0, write: 0 };
    edgeFlow.set(edge.id, { read: existing.read + read, write: existing.write + write });
  };

  for (const edge of storageEdges) addFlow(edge, storageRead / storageEdges.length, 0);
  for (const edge of readTargets) addFlow(edge, remainingRead / readTargets.length, 0);
  for (const edge of writeTargets) addFlow(edge, 0, servedWrite / writeTargets.length);

  const warnings: string[] = [];
  const unroutedRead = readTargets.length > 0 ? 0 : remainingRead;
  const unroutedWrite = writeTargets.length > 0 ? 0 : servedWrite;
  // M5(a): improved wording for the common "server only wired to a queue"
  // case — a queue only carries async writes, so reads have nowhere to go.
  if (unroutedRead > 1e-9) {
    warnings.push('Reads have nowhere to go — connect a cache or database (queues only carry async writes)');
  }
  if (unroutedWrite > 1e-9) warnings.push('No downstream queue or database for write traffic');

  return { edgeFlow, unroutedRead, unroutedWrite, warnings };
}

// ---------------------------------------------------------------------------
// Graph prep: filter dangling edges, break cycles (DFS back-edge removal),
// Kahn topological order, and structural reachability from users nodes.
// ---------------------------------------------------------------------------

function validEdges(nodes: SimNode[], edges: SimEdge[]): SimEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  return edges.filter((e) => ids.has(e.source) && ids.has(e.target));
}

function findBackEdges(nodes: SimNode[], edges: SimEdge[]): Set<string> {
  const outByNode = new Map<string, SimEdge[]>();
  for (const n of nodes) outByNode.set(n.id, []);
  for (const e of edges) outByNode.get(e.source)?.push(e);

  const state = new Map<string, 0 | 1 | 2>();
  for (const n of nodes) state.set(n.id, 0);
  const backEdges = new Set<string>();

  const stack: Array<{ id: string; edgeIndex: number }> = [];
  for (const start of nodes) {
    if (state.get(start.id) !== 0) continue;
    stack.push({ id: start.id, edgeIndex: 0 });
    state.set(start.id, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const outEdges = outByNode.get(frame.id) ?? [];
      if (frame.edgeIndex >= outEdges.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const edge = outEdges[frame.edgeIndex];
      frame.edgeIndex++;
      const targetState = state.get(edge.target);
      if (targetState === 1) {
        backEdges.add(edge.id);
      } else if (targetState === 0) {
        state.set(edge.target, 1);
        stack.push({ id: edge.target, edgeIndex: 0 });
      }
    }
  }
  return backEdges;
}

function topoOrder(nodes: SimNode[], effectiveEdges: SimEdge[]): string[] {
  const indeg = new Map<string, number>();
  const outByNode = new Map<string, SimEdge[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    outByNode.set(n.id, []);
  }
  for (const e of effectiveEdges) {
    outByNode.get(e.source)?.push(e);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const n of nodes) if ((indeg.get(n.id) ?? 0) === 0) queue.push(n.id);

  const order: string[] = [];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    order.push(id);
    for (const e of outByNode.get(id) ?? []) {
      const d = (indeg.get(e.target) ?? 0) - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }

  if (order.length < nodes.length) {
    const seen = new Set(order);
    for (const n of nodes) if (!seen.has(n.id)) order.push(n.id);
  }
  return order;
}

function reachableFromUsers(nodes: SimNode[], effectiveEdges: SimEdge[]): Set<string> {
  const usersIds = nodes.filter((n) => n.kind === 'users').map((n) => n.id);
  const outByNode = new Map<string, string[]>();
  for (const n of nodes) outByNode.set(n.id, []);
  for (const e of effectiveEdges) outByNode.get(e.source)?.push(e.target);

  const seen = new Set<string>(usersIds);
  const queue = [...usersIds];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    for (const t of outByNode.get(id) ?? []) {
      if (!seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Main pass: walks the topological order once, computing per-node
// served/dropped/shed traffic, per-edge flow, path latencies, and the
// terminal (successfully-completed-request) contributions used for the
// traffic-weighted p50. Runs twice: once for real numbers, once in "ideal"
// mode (infinite capacity everywhere, base latency only) to get the p50
// floor used by the verdict/health comparison.
// ---------------------------------------------------------------------------

interface NodeInternal {
  inRead: number;
  inWrite: number;
  servedRead: number;
  servedWrite: number;
  droppedRead: number;
  droppedWrite: number;
  shedRead: number;
  shedWrite: number;
  util: number;
  latencyMs: number;
  warnings: string[];
  effectiveInstances?: number;
  retriedRps?: number;
}

interface TerminalContribution {
  weight: number;
  latency: number;
}

interface PassResult {
  nodeInternal: Map<string, NodeInternal>;
  edgeFlow: Map<string, Flow>;
  totalOffered: number;
  totalDropped: number;
  totalShed: number;
  terminals: TerminalContribution[];
}

function runPass(
  graph: SimGraph,
  nodesById: Map<string, SimNode>,
  order: string[],
  effectiveEdges: SimEdge[],
  inEdgesByNode: Map<string, SimEdge[]>,
  outEdgesByNode: Map<string, SimEdge[]>,
  ideal: boolean,
  /**
   * Second-solve-pass input (knobs 2-3): per-node utilization from a prior
   * pass, used ONLY by servers to decide retry amplification / breaker
   * shedding against their downstream targets. Absent (pass 1, and the
   * separate "ideal" pass) means no amplification/shedding happens at all —
   * exactly today's behavior.
   */
  priorUtilByNode?: Map<string, number>,
): PassResult {
  const nodeInternal = new Map<string, NodeInternal>();
  const edgeFlow = new Map<string, Flow>();
  const exitPathLatency = new Map<string, number>();
  const remainingCapacity = new Map<string, number>();
  for (const n of graph.nodes) remainingCapacity.set(n.id, baseCapacity(n));

  let totalOffered = 0;
  let totalDropped = 0;
  let totalShed = 0;
  const terminals: TerminalContribution[] = [];

  const rpsPerUser = Math.max(0, num(graph.global?.rpsPerUser, 0.1));
  const readWriteRatio = clamp01(num(graph.global?.readWriteRatio, 0.9));

  const assign = (flowMap: Map<string, Flow>, edge: SimEdge, flow: Flow) => {
    flowMap.set(edge.id, flow);
    const cur = remainingCapacity.get(edge.target) ?? 0;
    remainingCapacity.set(edge.target, cur - (flow.read + flow.write));
  };

  for (const nodeId of order) {
    const node = nodesById.get(nodeId);
    if (!node) continue;
    const inEdges = inEdgesByNode.get(nodeId) ?? [];
    const outEdges = outEdgesByNode.get(nodeId) ?? [];

    // 1. Sum incoming read/write traffic (or, for a users node, generate it).
    let inRead = 0;
    let inWrite = 0;
    let incomingLatencyNumerator = 0;
    let incomingLatencyDenominator = 0;

    if (node.kind === 'users') {
      const usersCount = Math.max(0, num(node.config.users, graph.global?.users ?? 0));
      const offered = usersCount * rpsPerUser;
      inRead = offered * readWriteRatio;
      inWrite = offered * (1 - readWriteRatio);
      totalOffered += inRead + inWrite;
    } else {
      for (const edge of inEdges) {
        const flow = edgeFlow.get(edge.id);
        if (!flow) continue;
        inRead += flow.read;
        inWrite += flow.write;
        const w = flow.read + flow.write;
        if (w > 0) {
          incomingLatencyNumerator += w * (exitPathLatency.get(edge.source) ?? 0);
          incomingLatencyDenominator += w;
        }
      }
    }
    const incomingPathLatency = incomingLatencyDenominator > 0 ? incomingLatencyNumerator / incomingLatencyDenominator : 0;

    // 2. Apply kind-specific capacity/absorption behavior.
    let cap: CapacityResult;
    let absorbedRead = 0; // cache/cdn hits: final success, doesn't propagate further
    let outRead = 0;
    let outWrite = 0;
    const warnings: string[] = [];
    // Server-only additive metrics (knobs 1-3) — undefined/0 for every other kind.
    let effectiveInstancesForNode: number | undefined;
    let retriedRpsForNode = 0;

    switch (node.kind) {
      case 'users': {
        cap = { servedRead: inRead, servedWrite: inWrite, droppedRead: 0, droppedWrite: 0, shedRead: 0, shedWrite: 0, util: 0 };
        outRead = inRead;
        outWrite = inWrite;
        break;
      }
      case 'cdn':
      case 'cache': {
        const capacity = node.kind === 'cdn' ? cdnCapacity(node.config) : cacheCapacity(node.config);
        const defaultHit = node.kind === 'cdn' ? CATALOG.cdn.defaultConfig.hitRatio : CATALOG.cache.defaultConfig.hitRatio;
        const hitRatio = clamp01(num(node.config.hitRatio, defaultHit ?? 0.8));
        cap = ideal ? idealCapacity(inRead, inWrite) : applyCapacity(inRead, inWrite, capacity, 'drop');
        absorbedRead = cap.servedRead * hitRatio;
        outRead = cap.servedRead - absorbedRead;
        outWrite = cap.servedWrite;
        break;
      }
      case 'loadbalancer': {
        cap = ideal ? idealCapacity(inRead, inWrite) : applyCapacity(inRead, inWrite, LOADBALANCER_CAPACITY, 'drop');
        outRead = cap.servedRead;
        outWrite = cap.servedWrite;
        break;
      }
      case 'ratelimiter': {
        const limit = rateLimiterCapacity(node.config);
        cap = ideal ? idealCapacity(inRead, inWrite) : applyRateLimit(inRead, inWrite, limit);
        outRead = cap.servedRead;
        outWrite = cap.servedWrite;
        break;
      }
      case 'server': {
        const rpsPerInstance = Math.max(1, num(node.config.rpsPerInstance, CATALOG.server.defaultConfig.rpsPerInstance ?? 500));
        const totalInForServer = inRead + inWrite;
        const autoscaleOn = node.config.autoscale === 'on';

        // Knob 1 — autoscaling. Unlike retries/breaker this only depends on
        // the server's OWN inbound traffic (already known at this point in
        // the topological walk), so it's resolved within a single pass —
        // no need for the second-pass machinery.
        let instances = Math.max(1, num(node.config.instances, CATALOG.server.defaultConfig.instances ?? 1));
        if (autoscaleOn) {
          const minInstances = Math.max(1, num(node.config.minInstances, CATALOG.server.defaultConfig.minInstances ?? 1));
          const maxInstances = Math.max(
            minInstances,
            num(node.config.maxInstances, CATALOG.server.defaultConfig.maxInstances ?? 20),
          );
          const targetUtil = Math.max(
            0.01,
            clamp01(num(node.config.targetUtilization, CATALOG.server.defaultConfig.targetUtilization ?? 0.7)),
          );
          const uncappedNeeded = Math.ceil(totalInForServer / Math.max(rpsPerInstance * targetUtil, 1e-9));
          instances = Math.min(maxInstances, Math.max(minInstances, uncappedNeeded));
          effectiveInstancesForNode = instances;
          if (!ideal && uncappedNeeded > maxInstances) {
            warnings.push('Autoscaler maxed out — raise the ceiling or add capacity elsewhere');
          }
        }

        cap = ideal ? idealCapacity(inRead, inWrite) : applyCapacity(inRead, inWrite, instances * rpsPerInstance, 'drop');

        // Knobs 2-3 — retries / circuit breaker. Both depend on the
        // utilization of whatever this server forwards traffic to, which
        // isn't known until that downstream node has itself been processed
        // — impossible within a single topological pass when the server
        // comes before its downstream target. `priorUtilByNode` (present
        // only on the second solve pass) supplies that missing signal from
        // pass 1; on pass 1 (and the separate "ideal" pass) it's undefined,
        // so this whole block is a no-op and behavior is unchanged.
        let forwardRead = cap.servedRead;
        let forwardWrite = cap.servedWrite;

        if (!ideal && priorUtilByNode) {
          let downstreamUtil = 0;
          for (const edge of outEdges) {
            const u = priorUtilByNode.get(edge.target);
            if (typeof u === 'number' && Number.isFinite(u)) downstreamUtil = Math.max(downstreamUtil, u);
          }

          const breakerOn = node.config.circuitBreaker === 'on';
          const threshold = Math.max(
            0.01,
            clamp01(num(node.config.circuitThreshold, CATALOG.server.defaultConfig.circuitThreshold ?? 0.9)),
          );
          const breakerTripped = breakerOn && downstreamUtil >= threshold;

          if (breakerTripped) {
            // Shed exactly the fraction of forwarded traffic that would push
            // the downstream target's utilization above `threshold` — a
            // fail-fast rejection (shedRps), not an error.
            const shedFraction = clamp01(1 - threshold / downstreamUtil);
            const extraShedRead = forwardRead * shedFraction;
            const extraShedWrite = forwardWrite * shedFraction;
            forwardRead -= extraShedRead;
            forwardWrite -= extraShedWrite;
            cap = {
              ...cap,
              servedRead: cap.servedRead - extraShedRead,
              servedWrite: cap.servedWrite - extraShedWrite,
              shedRead: cap.shedRead + extraShedRead,
              shedWrite: cap.shedWrite + extraShedWrite,
            };
          }

          const retriesOn = node.config.retriesEnabled === 'on';
          // Breaker precedence: a tripped breaker suppresses retry amplification.
          if (retriesOn && !breakerTripped && downstreamUtil > 1) {
            const maxRetries = Math.max(
              0,
              Math.min(5, Math.round(num(node.config.maxRetries, CATALOG.server.defaultConfig.maxRetries ?? 2))),
            );
            const retryFactor = 1 + maxRetries * clamp01(downstreamUtil - 1);
            const amplifiedRead = forwardRead * retryFactor;
            const amplifiedWrite = forwardWrite * retryFactor;
            retriedRpsForNode = amplifiedRead + amplifiedWrite - (forwardRead + forwardWrite);
            forwardRead = amplifiedRead;
            forwardWrite = amplifiedWrite;
          }
        }

        outRead = forwardRead;
        outWrite = forwardWrite;
        break;
      }
      case 'database': {
        cap = processDatabase(inRead, inWrite, node.config, ideal);
        if (!ideal && cap.poolBinding) {
          warnings.push('Connection pool exhausted before disk/CPU — raise max_connections or add a pooler');
        }
        break;
      }
      case 'queue': {
        cap = processQueue(inRead, inWrite, node.config, ideal);
        outRead = cap.servedRead;
        outWrite = cap.servedWrite;
        if (!ideal && cap.util > 1) {
          warnings.push("Backlog growing — consumers can't keep up");
        }
        break;
      }
      case 'storage': {
        cap = ideal ? idealCapacity(inRead, inWrite) : applyCapacity(inRead, inWrite, STORAGE_CAPACITY, 'drop');
        break;
      }
      default: {
        cap = idealCapacity(inRead, inWrite);
        break;
      }
    }

    // 3. Fan traffic out across downstream edges (kind-specific routing);
    // whatever can't be routed becomes additional dropped traffic here.
    let routingLossRead = 0;
    let routingLossWrite = 0;

    if (node.kind === 'loadbalancer') {
      const algorithm = node.config.algorithm ?? CATALOG.loadbalancer.defaultConfig.algorithm ?? 'round-robin';
      const result = splitLoadBalancer(outRead, outWrite, outEdges, algorithm, remainingCapacity);
      for (const [edgeId, flow] of result.edgeFlow) {
        const edge = outEdges.find((e) => e.id === edgeId)!;
        assign(edgeFlow, edge, flow);
      }
      routingLossRead = result.unroutedRead;
      routingLossWrite = result.unroutedWrite;
      warnings.push(...result.warnings);
    } else if (node.kind === 'server') {
      const result = routeFromServer(outRead, outWrite, outEdges, nodesById);
      for (const [edgeId, flow] of result.edgeFlow) {
        const edge = outEdges.find((e) => e.id === edgeId)!;
        assign(edgeFlow, edge, flow);
      }
      routingLossRead = result.unroutedRead;
      routingLossWrite = result.unroutedWrite;
      warnings.push(...result.warnings);
    } else if (node.kind === 'database' || node.kind === 'storage') {
      // Natural sinks: whatever they successfully process is the end of the
      // line (the durable source of truth). Any accidental outgoing edges
      // (unusual graphs) carry nothing.
      for (const edge of outEdges) assign(edgeFlow, edge, { read: 0, write: 0 });
    } else if (node.kind === 'queue' && outEdges.length === 0) {
      // A queue with nothing downstream is still a valid write-behind sink —
      // the durable enqueue itself is the success (the caller doesn't wait
      // for a database write that isn't even modeled here).
    } else if (node.kind === 'queue' && (node.config.mode ?? CATALOG.queue.defaultConfig.mode ?? 'queue') === 'pubsub') {
      // Knob 5 — pub/sub: every downstream edge gets its own FULL copy of the
      // drained stream (each subscriber consumes the whole topic), not an
      // evenly-split share.
      const result = broadcastToAll(outRead, outWrite, outEdges);
      for (const [edgeId, flow] of result.edgeFlow) {
        const edge = outEdges.find((e) => e.id === edgeId)!;
        assign(edgeFlow, edge, flow);
      }
      routingLossRead = result.unroutedRead;
      routingLossWrite = result.unroutedWrite;
    } else {
      const result = distributeEvenly(outRead, outWrite, outEdges);
      for (const [edgeId, flow] of result.edgeFlow) {
        const edge = outEdges.find((e) => e.id === edgeId)!;
        assign(edgeFlow, edge, flow);
      }
      routingLossRead = result.unroutedRead;
      routingLossWrite = result.unroutedWrite;
      if (routingLossRead + routingLossWrite > 1e-9) {
        if (node.kind === 'cdn') warnings.push('CDN has no downstream — miss traffic dropped');
        else if (node.kind === 'cache') warnings.push('Cache has no downstream — miss traffic dropped');
        else if (node.kind === 'ratelimiter') warnings.push('Rate limiter has no downstream');
        else if (node.kind === 'users') warnings.push('Users are not connected to anything');
      }
    }

    // Safety clamp: routing loss is normally a subset of `outRead/outWrite`,
    // which in turn is <= cap.servedRead/servedWrite for every kind except a
    // server with retry amplification switched on (there, outRead/outWrite
    // can legitimately exceed cap.servedRead, since retries inflate the
    // DOWNSTREAM demand without inflating what the server itself accepted).
    // Bound routing loss by what was actually served so the reclassification
    // below can never push served negative or dropped above inRps.
    routingLossRead = Math.min(routingLossRead, cap.servedRead);
    routingLossWrite = Math.min(routingLossWrite, cap.servedWrite);

    // Reclassify unroutable traffic from "served" into "dropped" while
    // leaving utilization/health (computed from `cap`) untouched — this is a
    // wiring problem, not a capacity problem. `routingLossRead/Write` are
    // already scoped to the `outRead/outWrite` portion for every kind above
    // (for cache/cdn that's the miss+write slice — the absorbed-hit portion
    // is never part of `outRead`, so it's untouched here), so subtracting
    // directly is correct and keeps the inRps = served + dropped + shed
    // invariant intact at every node.
    const exposedServedRead = cap.servedRead - routingLossRead;
    const exposedServedWrite = cap.servedWrite - routingLossWrite;
    const exposedDroppedRead = cap.droppedRead + routingLossRead;
    const exposedDroppedWrite = cap.droppedWrite + routingLossWrite;

    const finalServedRead = Math.max(0, exposedServedRead);
    const finalServedWrite = Math.max(0, exposedServedWrite);

    totalDropped += exposedDroppedRead + exposedDroppedWrite;
    totalShed += cap.shedRead + cap.shedWrite;

    // 4. Latency (M/M/1-flavored) & health. A rate limiter is a stateless
    // admission gate, not a queueing server — admitted requests don't slow
    // down just because a lot of *other* traffic is being shed, so it always
    // reports its flat base latency rather than running through the
    // congestion formula (which otherwise pins near its 20x cap the instant
    // any shedding occurs, since admitted == limit means util == 1).
    const baseLatencyMs = CATALOG[node.kind].baseLatencyMs;
    const latencyMs = ideal || node.kind === 'ratelimiter' ? baseLatencyMs : latencyOf(baseLatencyMs, cap.util);
    exitPathLatency.set(nodeId, incomingPathLatency + latencyMs);

    // Terminal contributions to the traffic-weighted end-to-end latency:
    // cache/cdn hits are a short-circuit success; database/storage are
    // natural sinks whose successfully-processed traffic is also a success.
    // A queue only counts as terminal when it has nothing downstream (a pure
    // write-behind buffer) — if it forwards to a database, that database is
    // the real terminal instead (its own health then reflects the drained
    // queue load too), avoiding double-counting the same request twice.
    const queueIsSink = node.kind === 'queue' && outEdges.length === 0;
    if ((node.kind === 'cdn' || node.kind === 'cache') && absorbedRead > 1e-9) {
      terminals.push({ weight: absorbedRead, latency: exitPathLatency.get(nodeId) ?? 0 });
    }
    if (node.kind === 'database' || node.kind === 'storage' || queueIsSink) {
      const servedHere = finalServedRead + finalServedWrite;
      if (servedHere > 1e-9) {
        terminals.push({ weight: servedHere, latency: exitPathLatency.get(nodeId) ?? 0 });
      }
    }

    nodeInternal.set(nodeId, {
      inRead,
      inWrite,
      servedRead: finalServedRead,
      servedWrite: finalServedWrite,
      droppedRead: exposedDroppedRead,
      droppedWrite: exposedDroppedWrite,
      shedRead: cap.shedRead,
      shedWrite: cap.shedWrite,
      util: cap.util,
      latencyMs,
      warnings,
      effectiveInstances: effectiveInstancesForNode,
      retriedRps: retriedRpsForNode > 1e-9 ? retriedRpsForNode : undefined,
    });
  }

  return { nodeInternal, edgeFlow, totalOffered, totalDropped, totalShed, terminals };
}

function weightedAverageLatency(terminals: TerminalContribution[]): number {
  let numerator = 0;
  let denominator = 0;
  for (const t of terminals) {
    numerator += t.weight * t.latency;
    denominator += t.weight;
  }
  return denominator > 1e-9 ? finite(numerator / denominator) : 0;
}

// ---------------------------------------------------------------------------
// solve()
// ---------------------------------------------------------------------------

export function solve(graph: SimGraph): SimResult {
  const nodes = graph.nodes ?? [];
  const edges = validEdges(nodes, graph.edges ?? []);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const backEdges = findBackEdges(nodes, edges);
  const effectiveEdges = edges.filter((e) => !backEdges.has(e.id));

  const inEdgesByNode = new Map<string, SimEdge[]>();
  const outEdgesByNode = new Map<string, SimEdge[]>();
  for (const n of nodes) {
    inEdgesByNode.set(n.id, []);
    outEdgesByNode.set(n.id, []);
  }
  for (const e of effectiveEdges) {
    outEdgesByNode.get(e.source)?.push(e);
    inEdgesByNode.get(e.target)?.push(e);
  }

  const order = topoOrder(nodes, effectiveEdges);
  const reachable = reachableFromUsers(nodes, effectiveEdges);

  const graphWarnings: string[] = [];
  if (backEdges.size > 0) graphWarnings.push('Cycle detected — back edge ignored');

  const usersNodes = nodes.filter((n) => n.kind === 'users');
  if (usersNodes.length === 0) {
    graphWarnings.push('No users node in the graph');
  }
  for (const u of usersNodes) {
    if ((outEdgesByNode.get(u.id) ?? []).length === 0) {
      graphWarnings.push('Users are not connected to anything');
    }
  }
  for (const n of nodes) {
    if (n.kind === 'server' && !reachable.has(n.id)) {
      graphWarnings.push(`Server '${n.label}' has no path from users`);
    }
    if ((n.kind === 'cache' || n.kind === 'cdn') && (outEdgesByNode.get(n.id) ?? []).length === 0) {
      graphWarnings.push(
        n.kind === 'cache' ? 'Cache has no downstream — miss traffic dropped' : 'CDN has no downstream — miss traffic dropped',
      );
    }
    if (n.kind === 'loadbalancer' && (outEdgesByNode.get(n.id) ?? []).length === 0) {
      graphWarnings.push('Load balancer has no downstream servers');
    }
  }

  // Two-pass solve for knobs 2-3 (retries / circuit breaker): pass 1 is
  // exactly "today's" single-pass solve; its per-node utilization then feeds
  // pass 2, where servers can amplify (retries) or shed (breaker) their
  // outgoing demand based on how overloaded their downstream targets already
  // are. Pass 2's numbers are what's reported. Deterministic, capped at
  // exactly two passes — no further iteration.
  const pass1 = runPass(graph, nodesById, order, effectiveEdges, inEdgesByNode, outEdgesByNode, false);
  const priorUtilByNode = new Map<string, number>();
  for (const [nodeId, internal] of pass1.nodeInternal) priorUtilByNode.set(nodeId, internal.util);
  const real = runPass(graph, nodesById, order, effectiveEdges, inEdgesByNode, outEdgesByNode, false, priorUtilByNode);
  // The "ideal" (infinite-capacity) baseline is unaffected by retries/breaker
  // by construction — utilization is always 0 there, so amplification/
  // shedding would be no-ops anyway — so it stays a single pass.
  const ideal = runPass(graph, nodesById, order, effectiveEdges, inEdgesByNode, outEdgesByNode, true);

  const offeredRps = finite(real.totalOffered);
  const droppedRpsTotal = finite(real.totalDropped);
  const shedRpsTotal = finite(real.totalShed);
  const servedRps = Math.max(0, offeredRps - droppedRpsTotal - shedRpsTotal);
  const availDenominator = offeredRps - shedRpsTotal;
  const availability = availDenominator > 1e-9 ? clamp01(servedRps / availDenominator) : 1;

  const p50Ms = weightedAverageLatency(real.terminals);
  const idealP50Ms = weightedAverageLatency(ideal.terminals);

  // C2 fix: a near-idle, misconfigured node (e.g. one server with a tiny
  // rpsPerInstance sitting off to the side of the real traffic path) used to
  // be able to inflate p99 for the WHOLE system just by having a high util on
  // essentially no traffic. Only nodes carrying at least 1% of total offered
  // load are eligible to set the p99 spread — a traffic-weighted view of "how
  // bad does it get on the path that actually matters". Rate limiters are
  // still excluded: their utilization is a capped admission-fraction ("how
  // far over your configured limit are you"), not a queueing-congestion
  // signal, so it shouldn't inflate the p99 spread either way.
  const trafficThreshold = 0.01 * offeredRps;
  let maxPathUtil = 0;
  for (const [nodeId, internal] of real.nodeInternal) {
    if (nodesById.get(nodeId)?.kind === 'ratelimiter') continue;
    const nodeInRps = internal.inRead + internal.inWrite;
    if (nodeInRps < trafficThreshold) continue;
    if (Number.isFinite(internal.util)) maxPathUtil = Math.max(maxPathUtil, internal.util);
  }
  const maxPathUtilForSpread = Math.min(maxPathUtil, 3);
  const p99Ms = finite(p50Ms * (2 + 6 * maxPathUtilForSpread * maxPathUtilForSpread));

  // Build public NodeMetrics.
  const nodeMetrics: Record<string, NodeMetrics> = {};
  const bottleneckCandidates: Array<{ id: string; util: number }> = [];
  let totalCost = 0;

  for (const node of nodes) {
    const internal = real.nodeInternal.get(node.id);
    const inRps = internal ? internal.inRead + internal.inWrite : 0;
    const servedRpsNode = internal ? internal.servedRead + internal.servedWrite : 0;
    const droppedRpsNode = internal ? internal.droppedRead + internal.droppedWrite : 0;
    const shedRpsNode = internal ? internal.shedRead + internal.shedWrite : 0;
    const util = internal ? internal.util : 0;
    const latencyMs = internal ? internal.latencyMs : 0;
    // M4 fix: queues get their own health mapping (a growing-but-draining
    // backlog isn't "down" the way an overloaded server/database is).
    const health = node.kind === 'queue' ? healthOfQueue(util, inRps) : healthOf(util, inRps);

    // Autoscaling (knob 1): cost follows effectiveInstances, not the
    // configured `instances` field, by resolving a config copy with
    // `instances` overridden — the catalog's cost formula stays untouched.
    const effectiveInstances = internal?.effectiveInstances;
    const costConfig = effectiveInstances !== undefined ? { ...node.config, instances: effectiveInstances } : node.config;
    const cost = CATALOG[node.kind].costPerMonth(costConfig, servedRpsNode);
    totalCost += finite(cost);

    const warnings = [...(internal?.warnings ?? [])];
    if (node.kind !== 'users' && !reachable.has(node.id)) {
      warnings.push('Not connected to any traffic source');
    }

    nodeMetrics[node.id] = {
      nodeId: node.id,
      inRps: finite(inRps),
      servedRps: finite(servedRpsNode),
      droppedRps: finite(droppedRpsNode),
      shedRps: finite(shedRpsNode),
      utilization: finite(util),
      latencyMs: finite(latencyMs),
      health,
      costPerMonth: finite(cost),
      warnings,
      effectiveInstances,
      retriedRps: internal?.retriedRps,
    };

    if (util > 0.9) bottleneckCandidates.push({ id: node.id, util });
  }
  bottleneckCandidates.sort((a, b) => b.util - a.util);
  const bottlenecks = bottleneckCandidates.map((b) => b.id);

  // Build public EdgeMetrics.
  const edgeMetrics: Record<string, EdgeMetrics> = {};
  for (const edge of graph.edges ?? []) {
    const flow = real.edgeFlow.get(edge.id);
    const rps = flow ? flow.read + flow.write : 0;
    const targetInternal = real.nodeInternal.get(edge.target);
    const targetInRps = targetInternal ? targetInternal.inRead + targetInternal.inWrite : 0;
    const targetDropped = targetInternal ? targetInternal.droppedRead + targetInternal.droppedWrite : 0;
    const droppedShare = targetInRps > 1e-9 ? clamp01(targetDropped / targetInRps) : 0;
    edgeMetrics[edge.id] = {
      edgeId: edge.id,
      rps: finite(rps),
      droppedShare: finite(droppedShare),
    };
  }

  // Verdict.
  let verdict: 'healthy' | 'degraded' | 'meltdown';
  if (offeredRps <= 1e-9) {
    verdict = 'healthy';
  } else if (availability < 0.9) {
    verdict = 'meltdown';
  } else if (availability >= 0.995 && p99Ms < 8 * idealP50Ms) {
    verdict = 'healthy';
  } else {
    verdict = 'degraded';
  }

  const dedupedWarnings = Array.from(new Set(graphWarnings));

  return {
    nodes: nodeMetrics,
    edges: edgeMetrics,
    totals: {
      offeredRps: finite(offeredRps),
      servedRps: finite(servedRps),
      availability: finite(availability, 1),
      p50Ms: finite(p50Ms),
      p99Ms: finite(p99Ms),
      costPerMonth: finite(totalCost),
      verdict,
      bottlenecks,
      graphWarnings: dedupedWarnings,
    },
  };
}
