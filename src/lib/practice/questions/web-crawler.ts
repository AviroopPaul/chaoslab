// Sourced from docs/research/common-questions.md §9 "Web Crawler". Tuned
// against the real engine (src/lib/sim/engine.ts) — see the temporary
// tuning test used during authoring; the config below is what actually
// clears its own rubric at 100/100 and simulates HEALTHY at targetLoad.

import type { Question } from '../types';

const TARGET_USERS = 8_000; // crawl-worker fleet, not human end-users
const RPS_PER_USER = 0.1; // 8,000 * 0.1 = 800 rps offered

export const webCrawler: Question = {
  id: 'web-crawler',
  title: 'Design a Web Crawler',
  difficulty: 'hard',
  tags: ['rate limiting', 'dedup', 'async pipeline'],
  statement: `Design a web crawler that fetches and indexes a large portion
of the public web: respect per-domain politeness (robots.txt, crawl-delay),
avoid re-crawling duplicate/unchanged content, and extract page content and
links to feed the next crawl frontier.

**Modeling note**

This problem has no traditional end-users. Reinterpret the **Users node as
the crawl-worker fleet** — the scheduler issuing fetch requests against the
crawl frontier, not humans hitting an API. Every "read" here is a fetch
attempt; every "write" is the extracted content + links landing in the page
store.

**Functional requirements**

- Fetch a URL, respecting per-domain crawl-delay.
- Check whether the content has already been seen (dedup) before
  re-indexing it.
- Extract content and links, feeding both the page store and the next
  crawl frontier.`,
  scale: `- Target: crawling **1 billion pages over 30 days** (~400 pages/sec
  sustained)
- **50% reads / 50% writes** — each successful fetch produces roughly one
  downstream extraction write
- Target load: **800 rps** total (400 read / 400 write)
- Availability budget: **97%** (crawlers can tolerate more shedding/
  backpressure than user-facing systems)
- p99 latency budget: **2000ms** (an inherently background/batch-ish
  workload)
- Cost budget: **$6,000/month**`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: RPS_PER_USER,
    readWriteRatio: 0.5,
  },
  budgets: {
    availability: 0.97,
    p99Ms: 2000,
    costPerMonth: 6_000,
  },
  hints: [
    'This is a pipeline, not a request/response system — treat the Users node as the crawl-worker fleet generating fetch work, not human traffic.',
    'A per-domain politeness budget (robots.txt/crawl-delay) maps directly onto the rate limiter component — a real crawler needs thousands of independent per-domain budgets, but this single-region simulator collapses them into one aggregate limit.',
    'Fetching (network-bound) and extraction/indexing (CPU-bound HTML parsing) are different bottleneck shapes — a fetcher fleet (server) should feed a separate extraction pipeline (queue), not be one monolith.',
    'The URL/content-hash dedup cache should have a deliberately modest hit ratio — you want to keep discovering new URLs, so an unrealistically high hit ratio (0.9+) is a sign the crawl frontier has gone stale, not a sign of good caching.',
    'Size the extraction queue\'s worker capacity for the actual extraction write rate, not an arbitrary large number — under-provisioning it lets the backlog grow silently.',
  ],
  rubric: [
    {
      id: 'has-ratelimiter',
      label: 'Has a politeness rate limiter',
      points: 10,
      check: { type: 'has-kind', kind: 'ratelimiter', min: 1 },
      why: 'A crawler with no rate limiting/politeness control gets IP-banned by every site it touches — the rate limiter is an aggregate stand-in for thousands of independent per-domain crawl-delay budgets.',
      failHint: 'Add a Rate Limiter node between the crawl-worker fleet and the fetchers to model per-domain politeness.',
    },
    {
      id: 'edge-rl-server',
      label: 'Politeness gate precedes fetching',
      points: 10,
      check: { type: 'direct-edge', from: 'ratelimiter', to: 'server' },
      why: 'Politeness has to be enforced before a fetch is attempted, not after — a limiter placed anywhere else doesn\'t actually throttle outbound requests to a domain.',
      failHint: 'Wire the Rate Limiter directly into your fetcher Server node.',
    },
    {
      id: 'cache-modest-hit-ratio',
      label: 'Dedup cache hit ratio stays modest (<= 0.75)',
      points: 10,
      check: { type: 'config', kind: 'cache', key: 'hitRatio', op: 'lte', value: 0.75 },
      why: 'The dedup cache has a fundamentally lower target hit ratio than a typical read cache — you want to keep discovering new URLs, so an unrealistically high hit ratio here is a design smell (a stale, no-longer-exploring frontier), not a win.',
      failHint: 'Lower the dedup cache\'s hit ratio — a very high hit ratio here means the crawler has mostly stopped discovering new content.',
    },
    {
      id: 'edge-server-queue',
      label: 'Fetching and extraction are separate pipeline stages',
      points: 12,
      check: { type: 'direct-edge', from: 'server', to: 'queue' },
      why: 'Fetching (network-bound, highly parallel) and extraction/indexing (CPU-bound HTML/text processing) are different bottleneck shapes — treating them as one synchronous step means a slow, parse-heavy page blocks the fetcher from moving on.',
      failHint: 'Connect your fetcher Server node to a Queue node so extraction runs as a separate, async pipeline stage.',
    },
    {
      id: 'edge-queue-database',
      label: 'Extraction queue feeds the page store',
      points: 10,
      check: { type: 'direct-edge', from: 'queue', to: 'database' },
      why: 'Extracted content and links need a durable home — a page-store database is what the rest of the crawl frontier and index are built from.',
      failHint: 'Connect your extraction Queue node to a Database node.',
    },
    {
      id: 'queue-worker-capacity',
      label: 'Extraction queue has meaningful worker capacity (>= 40 workers)',
      points: 8,
      check: { type: 'config', kind: 'queue', key: 'workers', op: 'gte', value: 40 },
      why: 'Extraction/indexing is CPU-bound and comparatively slow per page — under-provisioning worker count here lets the backlog (and thus indexing delay) grow silently even while fetches keep succeeding.',
      failHint: 'Increase the extraction queue\'s worker count — it needs enough parallel capacity to keep up with the fetch rate.',
    },
    {
      id: 'db-has-replica',
      label: 'Page store has at least one read replica',
      points: 6,
      check: { type: 'config', kind: 'database', key: 'readReplicas', op: 'gte', value: 1 },
      why: 'The page store and link graph are read by the crawl scheduler to pick the next fetch targets — a read replica keeps that scheduling query off the primary\'s write path.',
      failHint: 'Add at least one read replica to the page-store database.',
    },
    {
      id: 'sim-availability',
      label: `Availability >= ${(0.97 * 100).toFixed(0)}%`,
      points: 12,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.97 },
      why: 'A crawler can tolerate more backpressure/shedding than a user-facing system — but it should still successfully fetch and process the overwhelming majority of admitted work.',
      failHint: 'Check for overloaded nodes in the pipeline — a stalled fetcher or extraction stage silently wastes crawl budget.',
    },
    {
      id: 'sim-no-overload',
      label: 'No node is overloaded',
      points: 14,
      check: { type: 'sim', metric: 'no-overloaded-nodes', op: 'eq', value: true },
      why: 'An overloaded fetcher or extraction stage means the pipeline is falling behind the crawl frontier it\'s supposed to be draining — the whole point of separate stages is to avoid exactly this.',
      failHint: 'Find the red/orange node in the pipeline and give it more capacity (more fetcher instances or more extraction workers).',
    },
    {
      id: 'sim-cost',
      label: 'Cost <= $6,000/month',
      points: 8,
      check: { type: 'sim', metric: 'costPerMonth', op: 'lte', value: 6_000 },
      why: 'At 800 rps this is a modest-scale pipeline — the design should stay lean, not throw disproportionate hardware at a background/batch workload.',
      failHint: 'Trim over-provisioned fetcher instances or extraction workers once availability is comfortably met.',
    },
  ],
  solution: {
    nodes: [
      { id: 'users-1', kind: 'users', label: 'Crawl Workers', config: { users: TARGET_USERS } },
      { id: 'rl-1', kind: 'ratelimiter', label: 'Politeness Limiter', config: { limitRps: 700 } },
      { id: 'server-1', kind: 'server', label: 'Fetchers', config: { instances: 25, rpsPerInstance: 50 } },
      { id: 'cache-1', kind: 'cache', label: 'Dedup Cache', config: { hitRatio: 0.6, capacityRps: 300_000 } },
      { id: 'queue-1', kind: 'queue', label: 'Extraction Queue', config: { workers: 60, jobsPerWorkerRps: 10, mode: 'queue' } },
      { id: 'database-1', kind: 'database', label: 'Page Store', config: { shards: 1, readReplicas: 1, maxConnections: 500 } },
    ],
    edges: [
      { id: 'e-users-rl', source: 'users-1', target: 'rl-1' },
      { id: 'e-rl-server', source: 'rl-1', target: 'server-1' },
      { id: 'e-server-cache', source: 'server-1', target: 'cache-1' },
      { id: 'e-server-queue', source: 'server-1', target: 'queue-1' },
      { id: 'e-cache-database', source: 'cache-1', target: 'database-1' },
      { id: 'e-queue-database', source: 'queue-1', target: 'database-1' },
    ],
    positions: {
      'users-1': { x: 60, y: 220 },
      'rl-1': { x: 280, y: 220 },
      'server-1': { x: 500, y: 220 },
      'cache-1': { x: 720, y: 100 },
      'queue-1': { x: 720, y: 340 },
      'database-1': { x: 940, y: 220 },
    },
    writeup: `A web crawler is a **pipeline, not a request/response system** —
there is no human on the other end of a fetch, so the Users node here
stands in for the crawl-worker fleet generating outbound fetch work.

**Capacity estimation.** Crawling 1 billion pages over 30 days works out to
roughly 400 pages/sec sustained, and with each fetch producing about one
downstream extraction write, that's ~800 rps total at a 1:1 read:write
ratio. This is a modest absolute throughput number — the interesting
constraints are shape (politeness, dedup, pipeline separation), not raw
scale.

**Design decisions.** A politeness rate limiter gates fetches before they
leave the fetcher fleet — an aggregate stand-in for the thousands of
independent per-domain crawl-delay budgets a real crawler needs, which this
single-region simulator collapses into one limit. Fetchers are modeled
with deliberately low per-instance throughput (50 rps/instance) reflecting
network-I/O-bound work, not CPU-bound app logic. A dedup cache checks
"have we already seen this URL/content-hash" — tuned to a **deliberately
modest** 0.6 hit ratio, the opposite instinct from most caching problems,
because a crawler wants to keep discovering new content. Extraction (CPU-
bound HTML parsing and link discovery) is split into its own queue-backed
stage rather than living inside the fetch request, so a slow page never
blocks the fetcher from moving to the next URL.

**Bottleneck walk.** The rate limiter runs pinned at its configured ceiling
(the intended politeness ceiling, not a failure). Downstream, fetchers sit
at ~56% utilization, the dedup cache is nowhere near its capacity, the
extraction queue drains at ~58% of its rate, and the single-shard page store
(with a read replica for frontier-scheduling queries) sits under 10%
utilization. Nothing is close to overloaded, which is exactly why this
clears the generous 2000ms p99 budget for what is fundamentally a
background, batch-shaped workload.`,
    keyInsights: [
      'This is a pipeline, not a request/response system — the Users node here represents the crawl-worker fleet, not human end-users.',
      'The URL/content-hash dedup cache has a deliberately lower target hit ratio than a typical read cache — you want to keep discovering new content, so a very high hit ratio is a design smell, not a win.',
      'Fetching (network-bound) and extraction/indexing (CPU-bound) are different bottleneck shapes and belong in separate tiers — a fetcher fleet feeding a distinct queue-backed extraction pipeline, not one monolith.',
      'Per-domain politeness maps to the rate limiter component, but a real crawler needs thousands of independent per-domain budgets — this simulator\'s single aggregate limiter is an explicit simplification.',
      'The crawl frontier\'s prioritization policy (what to fetch next) is an algorithm/data-structure problem this simulator can express the pipeline\'s throughput for, but not its scheduling policy.',
    ],
    sources: [
      { label: 'Alex Xu, System Design Interview Vol. 1, ch. 9 — Design A Web Crawler', url: 'https://www.amazon.com/dp/B08CMF2CQF' },
    ],
  },
};
