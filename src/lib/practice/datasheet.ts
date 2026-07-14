import { CATALOG } from '../sim/catalog';
import {
  CACHE_CAPACITY,
  CDN_CAPACITY,
  DB_READ_RPS_PER_SHARD,
  DB_WRITE_RPS_PER_SHARD,
  LOADBALANCER_CAPACITY,
  QUEUE_ENQUEUE_CAPACITY,
  STORAGE_CAPACITY,
} from '../sim/engine';
import type { ComponentKind } from '../sim/types';

/**
 * Component Datasheet (fairness-fix #1) — the practice/sandbox rubrics and
 * sim used to assume knowledge of the engine's internal capacity formulas
 * (flat LB cap, per-shard DB rps, the connection-pool law, etc.) that was
 * nowhere written down for the player. This module is the single place that
 * writes it down, in plain English, pulling every number that's already
 * importable straight from CATALOG/engine.ts (single source of truth — no
 * re-hardcoded magic numbers) rather than re-typing it and risking drift.
 *
 * Pure data, no React — rendered by `ComponentDatasheet.tsx` in both the
 * practice Problem tab (collapsible section) and the sandbox/practice
 * PaletteBar's "ⓘ" popover.
 */

export interface DatasheetRow {
  kind: ComponentKind;
  name: string;
  capacity: string;
  cost: string;
}

/** `12345` -> `"12,345"` — plain thousands separators, no rounding, for the
 * precise capacity/cost numbers quoted in this reference table (as opposed
 * to the UI's compact `12.3k` display formatting elsewhere). */
function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

// Little's Law connection-pool cap (engine.ts `processDatabase`):
// connCapacityRps = maxConnections * (1000 / baseLatencyMs).
const DB_BASE_LATENCY_MS = CATALOG.database.baseLatencyMs;
const RPS_PER_CONNECTION = 1000 / DB_BASE_LATENCY_MS;
const DEFAULT_MAX_CONNECTIONS = CATALOG.database.defaultConfig.maxConnections ?? 400;
const DEFAULT_POOL_CAP_RPS = DEFAULT_MAX_CONNECTIONS * RPS_PER_CONNECTION;

const DEFAULT_CACHE_CAPACITY = CATALOG.cache.defaultConfig.capacityRps ?? CACHE_CAPACITY;
const DEFAULT_CDN_CAPACITY = CATALOG.cdn.defaultConfig.capacityRps ?? CDN_CAPACITY;
const DEFAULT_SERVER_RPS_PER_INSTANCE = CATALOG.server.defaultConfig.rpsPerInstance ?? 500;
const SERVER_COST_PER_INSTANCE = CATALOG.server.costPerMonth({ instances: 1 }, 0);
const LB_COST = CATALOG.loadbalancer.costPerMonth({}, 0);
const RATELIMITER_COST = CATALOG.ratelimiter.costPerMonth({}, 0);
const CACHE_COST = CATALOG.cache.costPerMonth({}, 0);
const STORAGE_COST = CATALOG.storage.costPerMonth({}, 0);
const DEFAULT_DB_COST = CATALOG.database.costPerMonth({ shards: 1, readReplicas: 0 }, 0);
const DEFAULT_QUEUE_COST = CATALOG.queue.costPerMonth({ workers: CATALOG.queue.defaultConfig.workers }, 0);

export const DATASHEET_ROWS: DatasheetRow[] = [
  {
    kind: 'loadbalancer',
    name: CATALOG.loadbalancer.name,
    capacity: `Flat ${fmt(LOADBALANCER_CAPACITY)} rps per node — not configurable. There is no field for it: the only way to raise the ceiling is to add more Load Balancer nodes.`,
    cost: `Flat $${fmt(LB_COST)}/mo per node.`,
  },
  {
    kind: 'cdn',
    name: CATALOG.cdn.name,
    capacity: `Default ${fmt(DEFAULT_CDN_CAPACITY)} rps, configurable via capacityRps — extremely high by design, rarely the bottleneck.`,
    cost: `$200/mo base + $0.50 per served rps/month — this engine bills on traffic actually served, not configured size, so it scales with load even though it's rarely capacity-constrained.`,
  },
  {
    kind: 'ratelimiter',
    name: CATALOG.ratelimiter.name,
    capacity: `Caps admitted throughput at limitRps (default ${fmt(CATALOG.ratelimiter.defaultConfig.limitRps ?? 10_000)} rps). Sheds — does not drop — everything above the limit: shed traffic is excluded from the availability calculation and the node never shows as "overloaded", because a rate limiter is a deliberate admission gate, not a capacity failure.`,
    cost: `Flat $${fmt(RATELIMITER_COST)}/mo.`,
  },
  {
    kind: 'server',
    name: CATALOG.server.name,
    capacity: `capacity = instances × rpsPerInstance (default ${fmt(DEFAULT_SERVER_RPS_PER_INSTANCE)} rps/instance).`,
    cost: `Flat $${fmt(SERVER_COST_PER_INSTANCE)}/mo per instance, regardless of rpsPerInstance — fewer, beefier instances (higher rpsPerInstance) cost exactly the same as many small ones for the same total capacity, so rpsPerInstance is effectively free capacity in this simulator.`,
  },
  {
    kind: 'cache',
    name: CATALOG.cache.name,
    capacity: `Default ${fmt(DEFAULT_CACHE_CAPACITY)} rps, configurable via capacityRps. Only the fraction of reads at or below hitRatio is absorbed — the rest (misses, plus all writes) passes straight through to whatever is wired downstream.`,
    cost: `Flat $${fmt(CACHE_COST)}/mo regardless of capacityRps or hit ratio.`,
  },
  {
    kind: 'database',
    name: CATALOG.database.name,
    capacity: `${fmt(DB_READ_RPS_PER_SHARD)} read rps + ${fmt(DB_WRITE_RPS_PER_SHARD)} write rps, PER SHARD. Read replicas add read capacity only — they do nothing for write throughput, which only shards increase. On top of that, combined served throughput is ALSO capped by the connection pool (Little's Law): maxConnections × (1000 / ${DB_BASE_LATENCY_MS}ms) ≈ ${fmt(RPS_PER_CONNECTION)} rps per connection. The default ${fmt(DEFAULT_MAX_CONNECTIONS)}-connection pool caps combined throughput at only ≈${fmt(DEFAULT_POOL_CAP_RPS)} rps — regardless of how many shards you add — so a database that "should" have plenty of shard capacity can still be pool-bound.`,
    cost: `$250/mo × shards × (1 + readReplicas). maxConnections is free — raising it never changes cost, only the pool ceiling above.`,
  },
  {
    kind: 'queue',
    name: CATALOG.queue.name,
    capacity: `Drain rate = workers × jobsPerWorkerRps (defaults: ${fmt(CATALOG.queue.defaultConfig.workers ?? 10)} workers × ${fmt(CATALOG.queue.defaultConfig.jobsPerWorkerRps ?? 50)} jobs/worker/rps). Enqueueing itself has a separate, much larger flat ceiling of ${fmt(QUEUE_ENQUEUE_CAPACITY)} rps — the real constraint to size for is almost always drain rate, not the enqueue ceiling. In pub/sub mode, every subscriber drains its own full copy of the stream, so required drain capacity is (enqueue rate × subscriberCount), not just the raw enqueue rate.`,
    cost: `$60/mo + $40/mo per worker, plus (in pub/sub mode) $20/mo per subscriber beyond the first.`,
  },
  {
    kind: 'storage',
    name: CATALOG.storage.name,
    capacity: `Flat ${fmt(STORAGE_CAPACITY)} rps — no config knob at all. Put a CDN in front of it to absorb read volume beyond that; storage itself cannot be scaled up directly in this simulator.`,
    cost: `Flat $${fmt(STORAGE_COST)}/mo.`,
  },
];

/** Reference defaults used above, exposed for anything that wants the raw
 * numbers alongside the formatted rows (e.g. tests). */
export const DATASHEET_REFERENCE = {
  rpsPerConnection: RPS_PER_CONNECTION,
  defaultMaxConnections: DEFAULT_MAX_CONNECTIONS,
  defaultPoolCapRps: DEFAULT_POOL_CAP_RPS,
  defaultDbCost: DEFAULT_DB_COST,
  defaultQueueCost: DEFAULT_QUEUE_COST,
};

/** Two cross-cutting behavior notes every question shares, regardless of
 * component kind (SPEC fairness-fix #1). */
export const DATASHEET_BEHAVIOR_NOTES: string[] = [
  'Routing: reads go to a Cache OR a Database (whichever is wired — cache is preferred when both are present), and writes go to a Queue OR a Database (queue preferred). If Object Storage is wired directly to a server, ~10% of that server\'s reads divert to storage as static-asset traffic, carved out before the cache/database split.',
  'Latency: p99 grows quadratically with utilization, not linearly — a node sitting at 90%+ utilization can already be blowing a tight latency budget even though it is nowhere near "overloaded". Keep hot components under roughly 70-80% utilization for latency headroom, not just enough to avoid dropped requests.',
];
