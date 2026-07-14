// Research-driven authoring pass — see docs/research/common-questions.md §10
// (Autocomplete / Typeahead) for the dossier this question is built from.

import type { Question } from '../types';

const TARGET_USERS = 30_300_000;

export const autocomplete: Question = {
  id: 'autocomplete',
  title: 'Design Search Autocomplete',
  difficulty: 'medium',
  tags: ['precomputation', 'cache design', 'latency-bound'],
  statement: `Design a search-box autocomplete/typeahead service: as a user types, return
the top-K most likely completions within a **very tight latency budget**,
informed by overall and trending query popularity — without running a full
ranking query on every keystroke.

**Functional requirements**

- \`GET /suggest?prefix=...\` — return ranked completions for a prefix,
  near-instantly.
- Log completed searches asynchronously to feed an offline trending/ranking
  job — this is a separate, much lower-urgency pipeline from serving
  suggestions.

Unlike almost every other design in this set, the binding constraint here is
**latency, not raw throughput headroom** — every keystroke has to feel
instant.`,
  scale: `- **500M DAU**, many keystroke-level lookups per search
- **~99:1 read:write** — suggestion lookups vs. query-log writes
- **303,000 rps** total (300,000 read / 3,000 write)
- Availability budget: **99.5%**
- p99 latency budget: **100ms** — the tightest bar in this dossier set
- Cost budget: **$48,000/month**`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: 0.01,
    readWriteRatio: 0.99,
  },
  budgets: {
    availability: 0.995,
    p99Ms: 100,
    costPerMonth: 48_000,
  },
  hints: [
    'You cannot afford to rank candidates live on every keystroke at this volume — precompute a "top-K suggestions per prefix" structure offline, and let the online path only ever read it.',
    'Because suggestions are precomputed, the prefix cache can legitimately run a very high hit ratio — this is a case where a high hit ratio is a sign of good design, not over-optimism.',
    'The "log this search" write path is really a telemetry pipeline feeding an offline job — it doesn\'t need the same latency or consistency guarantees as serving a suggestion.',
    'p99 is the number that matters most here, more than in almost any other design in this set — a single load balancer\'s 200,000 rps cap alone isn\'t your real constraint, queueing latency at any hop is.',
    'Every hop on the read path (load balancer, server, cache) adds queueing delay under load — keep utilization low everywhere on that path, not just wherever looks "the bottleneck".',
    'Server cost is a flat $80/month per instance regardless of rpsPerInstance — fewer, beefier instances cost less than many small ones for the same total throughput, so rpsPerInstance is effectively free capacity to lean on here.',
  ],
  rubric: [
    {
      id: 'has-lb-3',
      label: 'At least 3 load balancers',
      points: 10,
      check: { type: 'has-kind', kind: 'loadbalancer', min: 3 },
      why: 'At 300,000+ rps, a single load balancer\'s 200,000 rps cap is already exceeded — and with a 100ms p99 budget, keeping every hop\'s utilization low matters even more than usual.',
      failHint: 'Add more Load Balancer nodes so per-node utilization stays low — this is a latency-bound problem, not just a throughput one.',
    },
    {
      id: 'has-cache',
      label: 'Has a suggestion cache',
      points: 8,
      check: { type: 'has-kind', kind: 'cache', min: 1 },
      why: 'The defining trick of this problem is precomputation — an offline job builds a "top-K per prefix" structure that the online path only ever reads from a cache.',
      failHint: 'Add a Cache node between your app servers and the database.',
    },
    {
      id: 'has-queue',
      label: 'Has a query-log queue',
      points: 8,
      check: { type: 'has-kind', kind: 'queue', min: 1 },
      why: 'Logging a completed search is a telemetry write feeding an offline aggregation job — it belongs on an async queue, not the hot suggestion-serving path.',
      failHint: 'Add a Queue node for the query-log ingestion write path.',
    },
    {
      id: 'has-database',
      label: 'Has a database',
      points: 6,
      check: { type: 'has-kind', kind: 'database', min: 1 },
      why: 'The suggestion index and trending aggregates still need a durable home, even though the online read path almost never touches it directly.',
      failHint: 'Add a Database node to back the suggestion index and trending aggregates.',
    },
    {
      id: 'path-users-server',
      label: 'Traffic reaches an app server',
      points: 8,
      check: { type: 'path', from: 'users', to: 'server' },
      why: 'Every suggestion request needs to actually reach application logic — a dangling users node or a cache/DB with nothing upstream defeats the design.',
      failHint: 'Wire Users through your load balancers to at least one Server node.',
    },
    {
      id: 'direct-edge-queue-database',
      label: 'Query log lands in the database',
      points: 8,
      check: { type: 'direct-edge', from: 'queue', to: 'database' },
      why: 'The query-log ingestion pipeline needs somewhere durable to land, feeding the offline job that recomputes trending suggestions.',
      failHint: 'Connect the Queue node directly to the Database node.',
    },
    {
      id: 'cache-hit-ratio',
      label: 'Cache hit ratio >= 95%',
      points: 18,
      check: { type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0.95 },
      why: 'Because suggestions are precomputed rather than ranked live, this workload is uniquely cache-friendly — a deliberate contrast with the web-crawler dossier\'s dedup cache and the flash-sale dossier\'s live-counter cache, both of which are structurally low-hit-ratio by design. Setting this too low here misses the whole point of precomputation.',
      failHint: 'Raise the cache\'s hit ratio to at least 95% — this is the one dossier in the set where a very high hit ratio is exactly correct.',
    },
    {
      id: 'sim-p99',
      label: 'p99 latency <= 100ms',
      points: 18,
      check: { type: 'sim', metric: 'p99Ms', op: 'lte', value: 100 },
      why: 'This is the tightest latency bar in the whole question set — every keystroke has to feel instant, so the binding design constraint is latency headroom at every hop, not just aggregate throughput capacity.',
      failHint: 'Keep utilization low across every node on the read path (load balancers, servers, cache) — even 60-70% utilization can push p99 over this budget.',
    },
    {
      id: 'sim-availability',
      label: 'Availability >= 99.5%',
      points: 8,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.995 },
      why: 'At this scale, suggestion requests should essentially always succeed — a missed autocomplete request is a small but constant papercut across hundreds of millions of users.',
      failHint: 'Check for overloaded nodes — a saturated load balancer or server tier is the usual culprit at this rps.',
    },
    {
      id: 'sim-cost',
      label: 'Cost <= $48,000/month',
      points: 8,
      check: { type: 'sim', metric: 'costPerMonth', op: 'lte', value: 48_000 },
      why: 'Precomputation keeps this design cheap despite the huge read volume — most of the cost should be the app-server and load-balancer fleet needed for latency headroom, not an expensive database.',
      failHint: 'Trim over-provisioned database shards or queue workers — the tiny write volume here doesn\'t need much of either.',
    },
  ],
  solution: {
    nodes: [
      { id: 'users-1', kind: 'users', label: 'Users', config: { users: TARGET_USERS } },
      { id: 'lb-1', kind: 'loadbalancer', label: 'Load Balancer 1', config: { algorithm: 'least-connections' } },
      { id: 'lb-2', kind: 'loadbalancer', label: 'Load Balancer 2', config: { algorithm: 'least-connections' } },
      { id: 'lb-3', kind: 'loadbalancer', label: 'Load Balancer 3', config: { algorithm: 'least-connections' } },
      { id: 'lb-4', kind: 'loadbalancer', label: 'Load Balancer 4', config: { algorithm: 'least-connections' } },
      { id: 'lb-5', kind: 'loadbalancer', label: 'Load Balancer 5', config: { algorithm: 'least-connections' } },
      { id: 'lb-6', kind: 'loadbalancer', label: 'Load Balancer 6', config: { algorithm: 'least-connections' } },
      { id: 'server-1', kind: 'server', label: 'App Servers', config: { instances: 450, rpsPerInstance: 3_000 } },
      { id: 'cache-1', kind: 'cache', label: 'Prefix Suggestion Cache', config: { hitRatio: 0.97, capacityRps: 3_000_000 } },
      { id: 'queue-1', kind: 'queue', label: 'Query-Log Queue', config: { workers: 50, jobsPerWorkerRps: 2_000 } },
      { id: 'database-1', kind: 'database', label: 'Suggestion Index / Trending DB', config: { shards: 3, readReplicas: 1, maxConnections: 3_000 } },
    ],
    edges: [
      { id: 'e-users-lb1', source: 'users-1', target: 'lb-1' },
      { id: 'e-users-lb2', source: 'users-1', target: 'lb-2' },
      { id: 'e-users-lb3', source: 'users-1', target: 'lb-3' },
      { id: 'e-users-lb4', source: 'users-1', target: 'lb-4' },
      { id: 'e-users-lb5', source: 'users-1', target: 'lb-5' },
      { id: 'e-users-lb6', source: 'users-1', target: 'lb-6' },
      { id: 'e-lb1-server', source: 'lb-1', target: 'server-1' },
      { id: 'e-lb2-server', source: 'lb-2', target: 'server-1' },
      { id: 'e-lb3-server', source: 'lb-3', target: 'server-1' },
      { id: 'e-lb4-server', source: 'lb-4', target: 'server-1' },
      { id: 'e-lb5-server', source: 'lb-5', target: 'server-1' },
      { id: 'e-lb6-server', source: 'lb-6', target: 'server-1' },
      { id: 'e-server-cache', source: 'server-1', target: 'cache-1' },
      { id: 'e-server-queue', source: 'server-1', target: 'queue-1' },
      { id: 'e-cache-database', source: 'cache-1', target: 'database-1' },
      { id: 'e-queue-database', source: 'queue-1', target: 'database-1' },
    ],
    positions: {
      'users-1': { x: 20, y: 360 },
      'lb-1': { x: 260, y: 40 },
      'lb-2': { x: 260, y: 160 },
      'lb-3': { x: 260, y: 280 },
      'lb-4': { x: 260, y: 400 },
      'lb-5': { x: 260, y: 520 },
      'lb-6': { x: 260, y: 640 },
      'server-1': { x: 500, y: 340 },
      'cache-1': { x: 720, y: 220 },
      'queue-1': { x: 720, y: 460 },
      'database-1': { x: 940, y: 340 },
    },
    writeup: `**Requirements.** Return top-K completions per keystroke within a very
tight latency budget, informed by query popularity — without ranking live on
every request.

**Capacity estimate.** At this dossier's scale, offered load is 303,000 rps —
300,000 read (suggestion lookups) and a tiny 3,000 rps write trickle
("log this completed search"). Unlike almost every other design in this
set, the binding constraint is **latency, not raw throughput headroom**: p99
must stay under 100ms, the tightest bar in the whole question set.

**Design decisions.** The defining trick is **precomputation**: at this
request volume you cannot afford to rank candidates live on every keystroke,
so an offline, queue-fed pipeline periodically rebuilds a small,
denormalized "top-K suggestions per prefix" structure that the online path
only ever *reads*. That's what makes a 97% cache hit ratio legitimate here —
a deliberate contrast with the web-crawler dossier's dedup cache and the
flash-sale dossier's live-counter cache, both of which are *structurally*
low-hit-ratio by design; recognizing which kind of cache you're building is
the key judgment call in this problem. The write path is really a
logging/telemetry pipeline, not a user-facing write — it flows through its
own small queue into the suggestion-index database, entirely decoupled from
the read path's latency requirements.

**Bottleneck walk.** Because p99, not throughput, is the binding constraint,
this design spends its budget on **latency headroom at every hop** rather
than raw capacity: 6 load balancers (well past the "3+" a naive throughput
calculation would suggest) keep each node under 20% utilization, the
app-server fleet runs at ~22%, the cache at ~10%, and the tiny query-log
queue and 3-shard database both stay comfortably under 40%. Every one of
those numbers looks over-provisioned by throughput standards — and that's
exactly the point: at a 100ms p99 budget, queueing delay from a
70%-utilized node would already blow it, long before that node is anywhere
near actually overloaded.

Trending/personalization (recent spikes, per-user history) pulls the real
system toward a hybrid — a mostly-static base index plus a fast-refreshing
"trending now" overlay — a common, unmodeled follow-up. An optional CDN in
front of the load balancers can shave a little more edge latency for a
handful of extremely hot, near-universal prefixes ("a", "the", "how"), but
given this engine's linear served-RPS CDN pricing, it's a real cost/latency
trade-off to discuss, not a free win — which is why it's left out of the
core graph here.`,
    keyInsights: [
      'Precomputation is the whole trick — rank offline, serve reads from a cache, never rank live on a keystroke.',
      'A very high cache hit ratio is *correct* here, unlike the web-crawler or flash-sale dossiers where a high hit ratio would be a design smell.',
      'The "log this search" write path is a low-urgency telemetry pipeline, decoupled from the latency-critical read path.',
      'Latency, not throughput headroom, is the binding constraint — spend budget on keeping every hop\'s utilization low, not just on clearing capacity.',
      'A CDN could shave a little edge latency for hot prefixes, but its linear served-RPS cost makes it a real trade-off, not a reflexive add.',
    ],
    sources: [
      { label: 'Grokking the System Design Interview — Typeahead Suggestion lesson', url: 'https://www.grokkingsystemdesign.com/curriculum' },
      { label: 'HelloInterview — System Design in a Hurry', url: 'https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction' },
    ],
  },
};
