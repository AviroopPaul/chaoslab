// Sourced from docs/research/common-questions.md §7 "Flash-Sale / Ticket
// Booking". Tuned against the real engine (src/lib/sim/engine.ts) — see the
// temporary tuning test used during authoring; the config below is what
// actually clears its own rubric at 100/100 and simulates HEALTHY at
// targetLoad.

import type { Question } from '../types';

const TARGET_USERS = 3_500_000;
const RPS_PER_USER = 0.1; // 3.5M * 0.1 = 350,000 rps offered

export const flashSale: Question = {
  id: 'flash-sale',
  title: 'Design a Flash-Sale / Ticket Booking System',
  difficulty: 'hard',
  tags: ['admission control', 'write serialization', 'inventory'],
  statement: `Design a high-demand ticket/inventory sale system (a popular
concert on-sale, or a flash deal): thousands of users compete for a strictly
limited number of items simultaneously.

**Functional requirements**

- \`GET /event/:id\` — browse event/venue metadata.
- \`POST /reserve\` — attempt to purchase a seat/item.
- The system must **never oversell** — each seat/item is sold exactly once.
- It must give fast, honest feedback (booked or sold-out) even under a
  massive instantaneous burst.

A burst of **2M concurrent users** attempts to buy from **50,000 available
seats** within the first minute of an on-sale.`,
  scale: `- Burst load: **350,000 rps** total
- **40% reads / 60% writes** — purchase attempts, not browsing, dominate
- Availability budget: **98%** (deliberate shedding at the edge is expected
  and correct here — not a failure)
- p99 latency budget: **1000ms** (booking confirmation can be slower than a
  typical read)
- Cost budget: **$88,000/month** (a deliberately burst-provisioned cost —
  it should scale down between sales)`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: RPS_PER_USER,
    readWriteRatio: 0.4,
  },
  budgets: {
    availability: 0.98,
    p99Ms: 1000,
    costPerMonth: 88_000,
  },
  hints: [
    'A flash sale is an admission-control + serialization problem, not a caching problem — you cannot cache your way out of "don\'t oversell the last 5 seats."',
    'A rate limiter sized deliberately below the raw burst is a virtual waiting room, not a bug — shedding excess demand at the edge is a feature that protects checkout and gives honest, fast feedback.',
    '"Seats remaining" is a poor cache candidate because it changes on every write — cache the largely-static event/venue metadata instead, not the live count.',
    'The seat/inventory decrement must be atomic and serialized per item — a reservation queue (or DB row-level locking) is what actually prevents overselling, not the shard count alone.',
    'Sharding inventory by event_id confines one event\'s write storm to its own shard, but a single mega-event can still saturate that one shard — the queue is what protects the database in that worst case.',
    'A single load balancer node caps out at 200,000 rps in this simulator — if your waiting room admits ~250,000 rps, one load balancer alone is already a guaranteed bottleneck; you need at least 2 to clear the admitted traffic with any headroom.',
  ],
  rubric: [
    {
      id: 'has-ratelimiter',
      label: 'Has a rate limiter (the waiting room)',
      points: 10,
      check: { type: 'has-kind', kind: 'ratelimiter', min: 1 },
      why: 'The rate limiter here is a deliberate virtual waiting room: shedding excess demand at the edge protects checkout and gives users fast, honest feedback instead of long hangs or timeouts.',
      failHint: 'Add a Rate Limiter node in front of your load balancer/servers to act as a waiting room.',
    },
    {
      id: 'ratelimiter-below-burst',
      label: 'Waiting room is sized below the raw burst',
      points: 12,
      check: { type: 'config', kind: 'ratelimiter', key: 'limitRps', op: 'lte', value: 300_000 },
      why: 'Sizing the limiter deliberately below the 350,000 rps raw burst is what makes it a feature, not an accidental bottleneck — demonstrating deliberate shedding, not an under-provisioned system.',
      failHint: 'Lower the rate limiter\'s limit below the raw burst rps — it should shed excess deliberately, not try to admit everything.',
    },
    {
      id: 'edge-rl-lb',
      label: 'Rate limiter precedes the checkout fleet',
      points: 8,
      check: { type: 'direct-edge', from: 'ratelimiter', to: 'loadbalancer' },
      why: 'Admission control has to happen before the fleet, not after — a limiter placed anywhere else does not protect checkout from the burst. Note also: a single load balancer node caps out at 200,000 rps in this simulator, so admitting up to ~250,000 rps past the waiting room means you need at least 2 load balancer nodes downstream, not just the right wiring order.',
      failHint: 'Wire the Rate Limiter directly into your Load Balancer node(s) — and make sure there are at least 2 of them, since one alone caps at 200,000 rps, below the ~250,000 rps you\'re deliberately admitting.',
    },
    {
      id: 'edge-server-queue',
      label: 'Purchase attempts are serialized through a queue',
      points: 10,
      check: { type: 'direct-edge', from: 'server', to: 'queue' },
      why: 'The seat/inventory decrement must be atomic and serialized per item — parallel, unsynchronized writes straight to the database are exactly how systems oversell.',
      failHint: 'Connect your Server node to a Queue node so purchase attempts are serialized before touching inventory.',
    },
    {
      id: 'edge-queue-database',
      label: 'Queue feeds the inventory database',
      points: 8,
      check: { type: 'direct-edge', from: 'queue', to: 'database' },
      why: 'The serialization queue only protects inventory if it actually drains into the durable inventory/orders store.',
      failHint: 'Connect your Queue node to a Database node.',
    },
    {
      id: 'cache-not-overconfident',
      label: 'Cache hit ratio stays modest (<= 85%)',
      points: 8,
      check: { type: 'config', kind: 'cache', key: 'hitRatio', op: 'lte', value: 0.85 },
      why: '"Seats remaining" is a poor cache candidate — it changes on every write. A deliberately modest hit ratio here signals the cache is for static event/venue metadata, not the live, constantly-changing seat count.',
      failHint: 'Lower the cache hit ratio — an unrealistically high hit ratio here suggests you\'re caching the live seat count, which risks overselling from stale reads.',
    },
    {
      id: 'db-sharded',
      label: 'Inventory database is sharded (>= 30 shards)',
      points: 10,
      check: { type: 'config', kind: 'database', key: 'shards', op: 'gte', value: 30 },
      why: 'Sharding inventory by event_id confines one popular event\'s write storm to its own shard — necessary but not sufficient, since the reservation queue is what protects against a single mega-event.',
      failHint: 'Increase the database\'s shard count — a single/small-shard-count inventory store cannot survive this write burst. Also raise maxConnections: the connection pool (maxConnections x 1000/12ms) caps combined throughput regardless of shard count, and the default pool is nowhere near enough at this scale.',
    },
    {
      id: 'sim-availability',
      label: `Availability >= ${(0.98 * 100).toFixed(0)}% (shedding, not dropping)`,
      points: 14,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.98 },
      why: 'Shed traffic (the waiting room politely turning people away) is deliberately excluded from this calculation — what matters is that everything actually admitted past the waiting room gets served, not errored.',
      failHint: 'Availability here should hold even under a burst — if it\'s low, something past the rate limiter is dropping (not shedding) requests. Check for overloaded nodes.',
    },
    {
      id: 'sim-no-overload',
      label: 'No node is overloaded',
      points: 14,
      check: { type: 'sim', metric: 'no-overloaded-nodes', op: 'eq', value: true },
      why: 'The rate limiter is supposed to run hot (it\'s a deliberate ceiling) — but nothing downstream of it should be overloaded, since that would mean admitted, "safe" traffic is still failing.',
      failHint: 'Find the red/orange node downstream of the rate limiter and give it more capacity — the limiter itself running hot is expected and fine.',
    },
    {
      id: 'sim-cost',
      label: 'Cost <= $88,000/month',
      points: 6,
      check: { type: 'sim', metric: 'costPerMonth', op: 'lte', value: 88_000 },
      why: 'This is explicitly a burst-provisioned cost — the design should clear the burst without wildly over-spending, since it should scale back down between sales.',
      failHint: 'Trim capacity that isn\'t needed to clear the burst comfortably — this budget is generous but not unlimited.',
    },
  ],
  solution: {
    nodes: [
      { id: 'users-1', kind: 'users', label: 'Users (Burst)', config: { users: TARGET_USERS } },
      { id: 'rl-1', kind: 'ratelimiter', label: 'Waiting Room', config: { limitRps: 250_000 } },
      { id: 'lb-1', kind: 'loadbalancer', label: 'Load Balancer 1', config: { algorithm: 'least-connections' } },
      { id: 'lb-2', kind: 'loadbalancer', label: 'Load Balancer 2', config: { algorithm: 'least-connections' } },
      { id: 'lb-3', kind: 'loadbalancer', label: 'Load Balancer 3', config: { algorithm: 'least-connections' } },
      { id: 'server-1', kind: 'server', label: 'Checkout Servers', config: { instances: 460, rpsPerInstance: 1000 } },
      { id: 'cache-1', kind: 'cache', label: 'Event/Venue Cache', config: { hitRatio: 0.7, capacityRps: 300_000 } },
      { id: 'queue-1', kind: 'queue', label: 'Reservation Queue', config: { workers: 520, jobsPerWorkerRps: 500, mode: 'queue' } },
      { id: 'database-1', kind: 'database', label: 'Inventory/Orders DB', config: { shards: 68, readReplicas: 0, maxConnections: 10_000 } },
    ],
    edges: [
      { id: 'e-users-rl', source: 'users-1', target: 'rl-1' },
      { id: 'e-rl-lb1', source: 'rl-1', target: 'lb-1' },
      { id: 'e-rl-lb2', source: 'rl-1', target: 'lb-2' },
      { id: 'e-rl-lb3', source: 'rl-1', target: 'lb-3' },
      { id: 'e-lb1-server', source: 'lb-1', target: 'server-1' },
      { id: 'e-lb2-server', source: 'lb-2', target: 'server-1' },
      { id: 'e-lb3-server', source: 'lb-3', target: 'server-1' },
      { id: 'e-server-cache', source: 'server-1', target: 'cache-1' },
      { id: 'e-server-queue', source: 'server-1', target: 'queue-1' },
      { id: 'e-cache-database', source: 'cache-1', target: 'database-1' },
      { id: 'e-queue-database', source: 'queue-1', target: 'database-1' },
    ],
    positions: {
      'users-1': { x: 60, y: 300 },
      'rl-1': { x: 280, y: 300 },
      'lb-1': { x: 500, y: 140 },
      'lb-2': { x: 500, y: 300 },
      'lb-3': { x: 500, y: 460 },
      'server-1': { x: 720, y: 300 },
      'cache-1': { x: 940, y: 160 },
      'queue-1': { x: 940, y: 440 },
      'database-1': { x: 1160, y: 300 },
    },
    writeup: `A flash sale is fundamentally an **admission-control + serialization**
problem, not a caching problem — you cannot cache your way out of "don't
oversell the last 5 seats."

**Capacity estimation.** The burst offers 350,000 rps at 40:60 read:write.
A waiting room (rate limiter) admits only 250,000 rps — deliberately below
the raw burst — shedding the other 100,000 rps cleanly at the edge. That
shed traffic is a policy decision, not a reliability failure, which is why
it's excluded from the availability calculation's denominator.

**Design decisions.** Three load balancers split the admitted 250,000 rps
across a checkout fleet sized to clear it with headroom. Reads (event/venue
browsing) go through a cache tuned to a deliberately **modest** 0.7 hit
ratio — this is metadata, not the live seat count, which would be a poor
(and dangerous) cache candidate. Writes (purchase attempts) are serialized
through a reservation queue before ever touching the database — this is
the actual mechanism that prevents overselling, not the database alone.
Inventory is sharded by event_id (68 shards here) so one popular event's
write storm doesn't take down every other sale running concurrently.

**Bottleneck walk.** The rate limiter runs pinned at its configured ceiling
by design — that's a feature, not a bottleneck. Downstream, load balancers
sit near 42% utilization, the checkout fleet at ~54%, the reservation queue
at ~56% of its drain rate, and the sharded database at ~55% write
utilization — nothing crosses 70%, which is exactly why availability holds
at 100% for everything that makes it past the waiting room, and why p99
stays comfortably inside the generous 1000ms booking-confirmation budget.`,
    keyInsights: [
      'A flash sale is an admission-control + serialization problem — caching cannot prevent overselling the last few items.',
      'The rate limiter is a deliberate virtual waiting room: shedding excess demand at the edge protects checkout and gives fast, honest feedback instead of long hangs.',
      '"Seats remaining" is a poor cache candidate because it changes on every write — cache only the static event/venue metadata, never the live count.',
      'The seat/inventory decrement must be atomic and serialized (a reservation queue or DB row locking) — parallel unsynchronized writes are exactly how systems oversell.',
      'Sharding inventory by event_id confines one event\'s write storm to its own shard, but the reservation queue — not shard count alone — is what protects against a single mega-event saturating its shard.',
    ],
    sources: [
      { label: 'HelloInterview — Problem breakdowns (Ticketmaster)', url: 'https://www.hellointerview.com/learn/system-design/problem-breakdowns/overview' },
    ],
  },
};
