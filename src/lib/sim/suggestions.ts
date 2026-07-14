import type { ComponentKind } from './types';

/**
 * Bottleneck-node-kind -> plain-English fix suggestion. Single source of
 * truth shared by the sandbox MetricsBar (via components/lab/format.ts,
 * which re-exports this) and the practice grader's bottleneckSummary
 * (src/lib/practice/grader.ts) — previously this lived only in
 * components/lab/format.ts, which the grader (a `lib/` module) shouldn't
 * reach into.
 */
export const BOTTLENECK_SUGGESTIONS: Record<ComponentKind, string> = {
  users: 'Traffic source — pull back the USER LOAD slider to relieve pressure.',
  cdn: 'Raise the CDN hit ratio, or add another edge PoP in front of it.',
  loadbalancer: 'Scale out the load balancer tier.',
  ratelimiter: 'Raise the limit, or shed more aggressively upstream at the edge.',
  server: 'Add instances, or put a load balancer in front to spread the load.',
  cache: 'Raise cache capacity or hit ratio, or add a CDN in front of it.',
  database: 'Add a cache, read replicas, or shards — and check maxConnections, which caps combined throughput independent of shard count.',
  queue: 'Add workers (or raise jobsPerWorkerRps) to raise the drain rate.',
  storage: 'Shard or replicate storage, or front it with a CDN.',
};
