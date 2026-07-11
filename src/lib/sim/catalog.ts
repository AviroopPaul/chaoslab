import type { ComponentKind, NodeConfig } from './types';

export interface FieldDef {
  key: keyof NodeConfig;
  label: string;
  type: 'number' | 'percent' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  help?: string;
}

export interface CatalogEntry {
  kind: ComponentKind;
  name: string;
  /** lucide-react icon component name, resolved by the UI layer */
  icon: string;
  /** hex accent color used for the node's icon/border in the canvas */
  accent: string;
  /** one-line educational description shown in the palette and inspector */
  description: string;
  /** optional one-liner describing the fixed machine spec per unit (display only) */
  hardware?: string;
  baseLatencyMs: number;
  defaultConfig: NodeConfig;
  fields: FieldDef[];
  costPerMonth: (config: NodeConfig, servedRps: number) => number;
}

export const CATALOG: Record<ComponentKind, CatalogEntry> = {
  users: {
    kind: 'users',
    name: 'Users',
    icon: 'Users',
    accent: '#38bdf8',
    description:
      'The traffic source. Every request in the system starts here — drag the USER LOAD slider to see how the graph behaves from 10 users to 500 million.',
    baseLatencyMs: 0,
    defaultConfig: { users: 100 },
    fields: [
      {
        key: 'users',
        label: 'Users',
        type: 'number',
        min: 10,
        max: 500_000_000,
        step: 10,
        help:
          'Concurrent/active users generating traffic. This is normally driven by the global USER LOAD slider in the toolbar rather than edited directly.',
      },
    ],
    costPerMonth: () => 0,
  },

  cdn: {
    kind: 'cdn',
    name: 'CDN',
    icon: 'Globe',
    accent: '#22d3ee',
    description:
      'Caches static/edge-cacheable reads geographically close to users. A high hit ratio means most read traffic never reaches your origin at all.',
    hardware: 'global edge PoPs (managed)',
    baseLatencyMs: 5,
    defaultConfig: { hitRatio: 0.9, capacityRps: 5_000_000 },
    fields: [
      {
        key: 'hitRatio',
        label: 'Hit ratio',
        type: 'percent',
        min: 0,
        max: 1,
        step: 0.01,
        help:
          'Fraction of read requests served directly from edge cache. Misses (and all writes) pass through to whatever is downstream — a low hit ratio defeats the purpose of a CDN.',
      },
      {
        key: 'capacityRps',
        label: 'Capacity (rps)',
        type: 'number',
        min: 10_000,
        max: 50_000_000,
        step: 10_000,
        help:
          'Maximum sustained requests per second the CDN edge network can absorb. Extremely high by design — usually not your bottleneck unless traffic is enormous.',
      },
    ],
    costPerMonth: (_config, servedRps) => 200 + servedRps * 0.5,
  },

  loadbalancer: {
    kind: 'loadbalancer',
    name: 'Load Balancer',
    icon: 'Shuffle',
    accent: '#a78bfa',
    description:
      'Spreads incoming requests across multiple downstream servers so no single instance is overwhelmed. The algorithm decides how evenly (or how smartly) that spread happens.',
    hardware: 'managed L7 (ALB/Envoy-class)',
    baseLatencyMs: 2,
    defaultConfig: { algorithm: 'round-robin' },
    fields: [
      {
        key: 'algorithm',
        label: 'Algorithm',
        type: 'select',
        options: ['round-robin', 'least-connections'],
        help:
          'Round-robin splits traffic equally across every downstream target. Least-connections favors targets with more remaining capacity — better when instances are unevenly loaded.',
      },
    ],
    costPerMonth: () => 150,
  },

  ratelimiter: {
    kind: 'ratelimiter',
    name: 'Rate Limiter',
    icon: 'Gauge',
    accent: '#f59e0b',
    description:
      'Caps throughput at a fixed request rate, deliberately shedding excess traffic before it can overload anything downstream. Shed requests are not errors — they are a deliberate trade-off.',
    hardware: 'in-memory token bucket (Envoy/Redis-class)',
    baseLatencyMs: 1,
    defaultConfig: { limitRps: 10_000 },
    fields: [
      {
        key: 'limitRps',
        label: 'Limit (rps)',
        type: 'number',
        min: 1,
        max: 10_000_000,
        step: 100,
        help:
          'Maximum requests per second allowed through. Anything above this is shed at the edge, protecting downstream services from being overwhelmed by a traffic spike.',
      },
    ],
    costPerMonth: () => 50,
  },

  server: {
    kind: 'server',
    name: 'App Server',
    icon: 'Server',
    accent: '#34d399',
    description:
      'Runs your application logic. Capacity scales horizontally with instance count — more instances means more throughput, at a proportional dollar cost.',
    hardware: '4 vCPU · 8 GB RAM per instance (c5.xlarge-class)',
    baseLatencyMs: 30,
    defaultConfig: {
      instances: 1,
      rpsPerInstance: 500,
      autoscale: 'off',
      minInstances: 1,
      maxInstances: 20,
      targetUtilization: 0.7,
      retriesEnabled: 'off',
      maxRetries: 2,
      circuitBreaker: 'off',
      circuitThreshold: 0.9,
    },
    fields: [
      {
        key: 'instances',
        label: 'Instances',
        type: 'number',
        min: 1,
        max: 10_000,
        step: 1,
        help:
          'Number of horizontally scaled copies of this service. Total capacity = instances × rps per instance. Scaling out is usually cheaper and safer than scaling one instance up. Ignored while autoscaling is on.',
      },
      {
        key: 'rpsPerInstance',
        label: 'RPS / instance',
        type: 'number',
        min: 1,
        max: 100_000,
        step: 50,
        help:
          'Requests per second a single instance can sustain before its latency starts to climb. Depends on how heavy the request-handling logic is.',
      },
      {
        key: 'autoscale',
        label: 'Autoscaling',
        type: 'select',
        options: ['off', 'on'],
        help:
          'Automatically add or remove instances to hold utilization near the target as load changes — off means capacity is fixed no matter how much traffic arrives.',
      },
      {
        key: 'minInstances',
        label: 'Min instances',
        type: 'number',
        min: 1,
        max: 10_000,
        step: 1,
        help:
          'Floor on instance count even when autoscaling — keeps a minimum footprint for redundancy and cold-start latency.',
      },
      {
        key: 'maxInstances',
        label: 'Max instances',
        type: 'number',
        min: 1,
        max: 10_000,
        step: 1,
        help:
          'Ceiling on instance count — protects your budget (and your quota), but traffic beyond what this many instances can serve gets dropped.',
      },
      {
        key: 'targetUtilization',
        label: 'Target utilization',
        type: 'percent',
        min: 0.1,
        max: 0.95,
        step: 0.01,
        help:
          "Autoscaler adds instances to try to keep per-instance utilization near this target. Lower targets mean more headroom (and more cost) per instance.",
      },
      {
        key: 'retriesEnabled',
        label: 'Retries',
        type: 'select',
        options: ['off', 'on'],
        help:
          "Retries recover transient failures — but against an overloaded dependency they multiply the load and make the outage worse.",
      },
      {
        key: 'maxRetries',
        label: 'Max retries',
        type: 'number',
        min: 0,
        max: 5,
        step: 1,
        help:
          'Upper bound on retry attempts per request. Higher values recover more transient failures, and amplify more load onto a struggling dependency.',
      },
      {
        key: 'circuitBreaker',
        label: 'Circuit breaker',
        type: 'select',
        options: ['off', 'on'],
        help: 'Fail fast instead of piling onto a struggling dependency.',
      },
      {
        key: 'circuitThreshold',
        label: 'Breaker threshold',
        type: 'percent',
        min: 0.5,
        max: 0.99,
        step: 0.01,
        help:
          'Downstream utilization at which the breaker trips and starts shedding traffic (fail-fast, not an error) instead of forwarding it. Trumps retries when tripped.',
      },
    ],
    costPerMonth: (config) => 80 * (config.instances ?? 1),
  },

  cache: {
    kind: 'cache',
    name: 'Cache',
    icon: 'Zap',
    accent: '#fbbf24',
    description:
      'Absorbs repeated reads in memory so they never hit the database. Hit ratio determines how much database traffic gets soaked up — the single highest-leverage knob in most backends.',
    hardware: '2 vCPU · 32 GB RAM per node (r6g memory-optimized)',
    baseLatencyMs: 2,
    defaultConfig: { hitRatio: 0.8, capacityRps: 300_000 },
    fields: [
      {
        key: 'hitRatio',
        label: 'Hit ratio',
        type: 'percent',
        min: 0,
        max: 1,
        step: 0.01,
        help:
          'Fraction of read requests answered from cache without touching the database. Cold caches (low hit ratio) or highly unique queries limit how much this can help.',
      },
      {
        key: 'capacityRps',
        label: 'Capacity (rps)',
        type: 'number',
        min: 10_000,
        max: 5_000_000,
        step: 10_000,
        help:
          'Maximum sustained requests per second this cache tier can serve before latency climbs and requests start dropping. Raise it (bigger/more cache nodes) if the cache itself becomes the bottleneck.',
      },
    ],
    costPerMonth: () => 120,
  },

  database: {
    kind: 'database',
    name: 'Database',
    icon: 'Database',
    accent: '#60a5fa',
    description:
      'The durable source of truth — and usually the first thing to fall over at scale. Read replicas add read capacity; sharding splits both read and write capacity across independent partitions.',
    hardware: '16 vCPU · 64 GB RAM · NVMe SSD per shard (db.r6-class)',
    baseLatencyMs: 12,
    defaultConfig: { shards: 1, readReplicas: 0, maxConnections: 400 },
    fields: [
      {
        key: 'shards',
        label: 'Shards',
        type: 'number',
        min: 1,
        max: 64,
        step: 1,
        help:
          'Horizontal partitions of the dataset, each an independent database. Multiplies both read and write capacity, but adds operational and query complexity.',
      },
      {
        key: 'readReplicas',
        label: 'Read replicas',
        type: 'number',
        min: 0,
        max: 15,
        step: 1,
        help:
          'Read-only copies of each shard that offload read traffic from the primary. They do nothing for write capacity — writes still go through the primary of each shard.',
      },
      {
        key: 'maxConnections',
        label: 'Max connections',
        type: 'number',
        min: 10,
        max: 100_000,
        step: 10,
        help:
          "Total connection pool size across the cluster. By Little's Law (connections × 1000/latency), a too-small pool caps throughput before disk or CPU ever become the bottleneck — raise it or add a connection pooler (e.g. PgBouncer).",
      },
    ],
    costPerMonth: (config) =>
      250 * (config.shards ?? 1) * (1 + (config.readReplicas ?? 0)),
  },

  queue: {
    kind: 'queue',
    name: 'Queue',
    icon: 'ListOrdered',
    accent: '#f472b6',
    description:
      'Decouples producers from consumers by buffering work. Absorbs traffic spikes (write-behind) at the cost of eventual, not immediate, consistency — the backlog grows if workers can\'t drain fast enough.',
    hardware: '1 vCPU · 2 GB per worker',
    baseLatencyMs: 4,
    defaultConfig: { workers: 10, jobsPerWorkerRps: 50, mode: 'queue', subscriberCount: 3 },
    fields: [
      {
        key: 'workers',
        label: 'Workers',
        type: 'number',
        min: 1,
        max: 10_000,
        step: 1,
        help:
          'Consumer processes draining the queue in parallel. Drain rate = workers × jobs per worker per second — if this falls behind enqueue rate, the backlog (and latency) grows.',
      },
      {
        key: 'jobsPerWorkerRps',
        label: 'Jobs / worker (rps)',
        type: 'number',
        min: 1,
        max: 10_000,
        step: 5,
        help:
          'Throughput of a single worker. Depends on how expensive each queued job is to process.',
      },
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        options: ['queue', 'pubsub'],
        help:
          'Queue mode: work is split once across consumers (point-to-point). Pub/sub mode: every subscriber gets its own full copy of the stream — fan-out, not load-splitting.',
      },
      {
        key: 'subscriberCount',
        label: 'Subscribers',
        type: 'number',
        min: 1,
        max: 20,
        step: 1,
        help:
          'Number of independent subscribers in pub/sub mode. Each one receives every message, so total consumption work scales with subscriber count, not just message volume. Only meaningful in pub/sub mode.',
      },
    ],
    costPerMonth: (config) =>
      60 + 40 * (config.workers ?? 10) + (config.mode === 'pubsub' ? 20 * (Math.max(1, config.subscriberCount ?? 3) - 1) : 0),
  },

  storage: {
    kind: 'storage',
    name: 'Object Storage',
    icon: 'HardDrive',
    accent: '#94a3b8',
    description:
      'Holds large static assets (images, video, files) outside the database. Cheap and effectively infinite capacity, but higher latency than an in-memory cache.',
    hardware: 'object store (S3-class, well-partitioned prefixes)',
    baseLatencyMs: 25,
    defaultConfig: {},
    fields: [],
    costPerMonth: () => 100,
  },
};
