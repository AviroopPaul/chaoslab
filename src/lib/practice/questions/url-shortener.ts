// Research-driven authoring pass — see docs/research/common-questions.md §1
// (URL Shortener) for the dossier this question is built from.

import type { Question } from '../types';

const TARGET_USERS = 5_000_000;

export const urlShortener: Question = {
  id: 'url-shortener',
  title: 'Design a URL Shortener',
  difficulty: 'easy',
  tags: ['caching', 'sharding', 'read-heavy'],
  statement: `Design a service like Bitly/TinyURL: given a long URL, generate a short,
unique alias, and redirect visitors from the short code back to the original
URL with very low latency.

**Functional requirements**

- \`POST /shorten\` — given a long URL, return a short code (optionally a
  custom alias, optionally with an expiration).
- \`GET /:code\` — redirect to the original long URL.
- Redirects vastly outnumber new-link creation — this is an almost pure
  read-heavy caching problem.

Design a backend that serves redirects fast and cheaply at this scale, and
stays healthy even as a handful of links go viral.`,
  scale: `- **100M DAU**, **100M new links/day** — redirects vastly outnumber creations (~**100:1 read:write**)
- Peak load: **100,000 rps** (99,000 read / 1,000 write)
- Availability budget: **99.5%**
- p99 latency budget: **300ms**
- Cost budget: **$4,000/month**`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: 0.02,
    readWriteRatio: 0.99,
  },
  budgets: {
    availability: 0.995,
    p99Ms: 300,
    costPerMonth: 4_000,
  },
  hints: [
    'A redirect is just a key lookup (shortCode -> longURL) — a cache in front of the database absorbs almost all of that read traffic.',
    'Hash/base62-encode the short code (or use a distributed ID generator) so keys are quasi-random. Sharding by a sequential/auto-increment id instead would hot-spot whichever shard holds the newest links.',
    'Write volume is tiny next to reads (~1% of traffic) — a synchronous write straight to the database is fine here. Reaching for a queue is unnecessary complexity this load doesn\'t justify.',
    'Nothing here needs a CDN either — this is a caching + horizontal-scaling story, not an asset-delivery one.',
    'Put a load balancer in front of your app servers so no single server is a fixed capacity ceiling or a single point of failure.',
    'Server cost in this simulator is a flat $80/month per instance, regardless of rpsPerInstance — fewer, beefier instances (a higher rpsPerInstance) cost exactly the same as many small ones for the same total capacity, so rpsPerInstance is effectively free capacity here.',
  ],
  rubric: [
    {
      id: 'has-cache',
      label: 'Has a cache',
      points: 10,
      check: { type: 'has-kind', kind: 'cache', min: 1 },
      why: 'Redirect lookups are a classic cache-friendly read path — a hot-key cache can absorb the vast majority of traffic before it ever reaches the database.',
      failHint: 'Add a Cache node between your app servers and the database.',
    },
    {
      id: 'has-database',
      label: 'Has a database',
      points: 10,
      check: { type: 'has-kind', kind: 'database', min: 1 },
      why: 'Short code -> long URL mappings need a durable source of truth — sharded by a hash of the code, not by creation order, so a burst of new links doesn\'t hot-spot one shard.',
      failHint: 'Add a Database node to persist the code -> URL mapping.',
    },
    {
      id: 'path-users-to-server',
      label: 'Traffic reaches an app server',
      points: 12,
      check: { type: 'path', from: 'users', to: 'server' },
      why: 'Every request needs to actually reach application logic — a dangling users node or a cache/DB with nothing upstream defeats the whole design.',
      failHint: 'Wire the Users node through to at least one Server node (directly or via a load balancer).',
    },
    {
      id: 'direct-edge-cache-database',
      label: 'Cache misses fall through to the database',
      points: 10,
      check: { type: 'direct-edge', from: 'cache', to: 'database' },
      why: 'Not every read is a hit — the ~8% that miss need somewhere to go. Forgetting this edge means cache misses have nowhere to land.',
      failHint: 'Connect the Cache node directly to the Database node for the miss-fallback path.',
    },
    {
      id: 'cache-hit-ratio',
      label: 'Cache hit ratio >= 85%',
      points: 13,
      check: { type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0.85 },
      why: 'At this read volume, even a mediocre hit ratio still lets a lot of traffic leak through to the database. Short-code lookups are extremely cache-friendly, so a high hit ratio is realistic and expected — assuming 100% is over-optimistic, but landing well above 85% is not.',
      failHint: 'Raise the cache hit ratio to at least 85% in the inspector panel.',
    },
    {
      id: 'sim-availability',
      label: 'Availability >= 99.5%',
      points: 15,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.995 },
      why: 'At this scale the redirect path needs to hold up almost every single time — a broken short link is a highly visible failure, and that reliability is the entire product.',
      failHint: 'Something in the path is dropping requests — check for overloaded nodes in the Results tab and add capacity there.',
    },
    {
      id: 'sim-p99',
      label: 'p99 latency <= 300ms',
      points: 15,
      check: { type: 'sim', metric: 'p99Ms', op: 'lte', value: 300 },
      why: 'A redirect is on the critical path of someone clicking a link — it needs to feel instant, not just "eventually work".',
      failHint: 'A saturated node inflates p99 the most — check utilization per node and add capacity (or raise rps/instance) on the hottest one.',
    },
    {
      id: 'sim-cost',
      label: 'Cost <= $4,000/month',
      points: 10,
      check: { type: 'sim', metric: 'costPerMonth', op: 'lte', value: 4_000 },
      why: 'A URL shortener is a simple, high-read-ratio product — the architecture should be efficient, not throw unlimited hardware at the problem.',
      failHint: 'Trim over-provisioned capacity (fewer instances/shards) once availability and latency are already comfortably met.',
    },
    {
      id: 'sim-no-overload',
      label: 'No node is overloaded',
      points: 5,
      check: { type: 'sim', metric: 'no-overloaded-nodes', op: 'eq', value: true },
      why: 'An "overloaded" or "down" node is actively dropping requests right now, not just running warm.',
      failHint: 'Find the red/orange node in the canvas and give it more capacity (instances, shards, or a bigger cache).',
    },
  ],
  solution: {
    nodes: [
      { id: 'users-1', kind: 'users', label: 'Users', config: { users: TARGET_USERS } },
      { id: 'lb-1', kind: 'loadbalancer', label: 'Load Balancer', config: { algorithm: 'round-robin' } },
      {
        id: 'server-1',
        kind: 'server',
        label: 'App Servers',
        config: { instances: 30, rpsPerInstance: 8000 },
      },
      { id: 'cache-1', kind: 'cache', label: 'Redirect Cache', config: { hitRatio: 0.92, capacityRps: 300_000 } },
      { id: 'database-1', kind: 'database', label: 'URL Database', config: { shards: 1, readReplicas: 1, maxConnections: 500 } },
    ],
    edges: [
      { id: 'e-users-lb', source: 'users-1', target: 'lb-1' },
      { id: 'e-lb-server', source: 'lb-1', target: 'server-1' },
      { id: 'e-server-cache', source: 'server-1', target: 'cache-1' },
      { id: 'e-server-database', source: 'server-1', target: 'database-1' },
      { id: 'e-cache-database', source: 'cache-1', target: 'database-1' },
    ],
    positions: {
      'users-1': { x: 60, y: 220 },
      'lb-1': { x: 280, y: 220 },
      'server-1': { x: 500, y: 220 },
      'cache-1': { x: 720, y: 120 },
      'database-1': { x: 940, y: 220 },
    },
    writeup: `The whole design hinges on one observation: **redirects are just a key
lookup, and reads vastly outnumber writes (~100:1)**. That makes this an
almost pure caching problem, not a hard distributed-systems one.

**Capacity estimate.** At 5M monthly users and 0.02 rps/user, offered load is
100,000 rps — 99,000 read (redirects) and 1,000 write (new short links). A
load balancer sits in front of an app-server fleet so no single server (or
the load balancer itself) is a fixed capacity ceiling or a single point of
failure. Each server sends reads through a cache first; only cache misses —
and all writes — fall through to the database.

**Design decisions.** With a 92% hit ratio, the database only ever sees the
~8% of reads that miss plus the small write trickle — a single shard with a
read replica comfortably clears the latency and availability budget even at
this scale, because the read-amplification problem was solved one layer up.
Short codes are hashed (base62 over a random or Snowflake-style id), not
sequential — sharding by hash spreads load evenly across shards as the
dataset grows, where a sequential id would hot-spot whichever shard holds the
newest links. There's deliberately no queue and no CDN here: nothing about
creating or redirecting a short link benefits from async processing or edge
caching at this scale — reaching for either would be unjustified complexity.

**Bottleneck walk.** At target load the app-server fleet runs at ~42%
utilization (30 instances, 8,000 rps/instance) — comfortable headroom so p99
stays well under budget even under the cache's queueing-latency contribution.
The database, seeing only cache misses plus the tiny write volume, sits under
50% utilization on both its read and write ceilings. Nothing in this graph
gets close to saturated, which is exactly the point: this is a genuinely
cheap problem once the cache is doing its job.

A worthwhile follow-up: 301 (permanent) vs. 302 (temporary) redirects. 301 is
far more cacheable by browsers/CDNs (less origin load) but breaks per-click
analytics, since the browser stops asking your server at all after the first
visit.`,
    keyInsights: [
      'Read-heavy, cache-friendly access pattern — the cache is the single highest-leverage component here, not the database.',
      'Hash the short code (not a sequential id) so sharding spreads load evenly instead of hot-spotting the newest shard.',
      'Write volume is tiny relative to reads — a synchronous write straight to the database is fine; a queue would be unjustified complexity.',
      'No CDN needed — short-code redirects aren\'t asset delivery, so an edge cache tier wouldn\'t earn its cost here.',
      '301 vs. 302 redirects is a classic trade-off: 301 is more cacheable (less origin load) but breaks per-click analytics.',
    ],
    sources: [
      { label: 'Alex Xu — System Design Interview Vol. 1, ch. 8 ("Design A URL Shortener")', url: 'https://www.amazon.com/dp/B08CMF2CQF' },
      { label: 'HelloInterview — Problem Breakdowns (Bitly, Easy tier)', url: 'https://www.hellointerview.com/learn/system-design/problem-breakdowns/overview' },
      { label: 'Grokking the System Design Interview curriculum', url: 'https://www.grokkingsystemdesign.com/curriculum' },
    ],
  },
};
