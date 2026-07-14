// Sourced from docs/research/common-questions.md §11 "Ride-Hailing Trip
// API". Tuned against the real engine (src/lib/sim/engine.ts) — see the
// temporary tuning test used during authoring; the config below is what
// actually clears its own rubric at 100/100 and simulates HEALTHY at
// targetLoad.

import type { Question } from '../types';

const TARGET_USERS = 15_000_000;
const RPS_PER_USER = 0.01; // 15M * 0.01 = 150,000 rps offered

export const rideHailing: Question = {
  id: 'ride-hailing',
  title: 'Design a Ride-Hailing Trip Service',
  difficulty: 'hard',
  tags: ['write-heavy telemetry', 'durable ledger', 'sharding'],
  statement: `Design the trip-lifecycle backend for a ride-hailing app:
riders request trips, a (black-box) matching service assigns a nearby
driver, the app tracks trip state via frequent location/status pings from
the driver, and payment settles at trip completion.

**Scope note**

The geospatial matching/indexing core of this problem (finding the nearest
available driver) is a quad-tree/geohash/H3 indexing problem this simulator
cannot express — treat "match rider to driver" as an **opaque downstream
call**, out of scope. This design covers only the trip-lifecycle state
machine and ledger: request, track, complete, pay.

**Functional requirements**

- \`POST /trips\` — request a trip (matching itself is opaque/out of scope).
- \`POST /trips/:id/ping\` — continuous driver location/status pings during
  an active trip.
- \`GET /trips/:id\` — rider-facing trip status/ETA lookup.
- \`POST /trips/:id/complete\` — settle payment at trip completion.`,
  scale: `- **30M DAU** (riders + drivers combined)
- **~30% reads / 70% writes** — continuous GPS/status pings from active
  trips dominate traffic volume, the opposite emphasis from most staple
  system-design questions
- Target load: **150,000 rps** sustained average
- Availability budget: **99%**
- p99 latency budget: **300ms** (status lookups)
- Cost budget: **$110,000/month** (queue worker fleet and DB shard count
  are both driven up by the write-heavy ping volume — a direct, expected
  consequence)`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: RPS_PER_USER,
    readWriteRatio: 0.3,
  },
  budgets: {
    availability: 0.99,
    p99Ms: 300,
    costPerMonth: 110_000,
  },
  hints: [
    'This problem is write-dominated (continuous location pings and state transitions) — the opposite emphasis from most read-heavy staples. Reflexively reaching for a big read cache without first sizing the write/ping path misses the actual bottleneck.',
    'Size the queue and database for pings-per-trip-per-second, not "number of trips" — the ping rate is 10-50x higher than a naive trip-count estimate. Queue drain rate is workers x jobsPerWorkerRps — raising jobsPerWorkerRps (not just worker count) is the second lever if the default (50) leaves you short.',
    'A per-client rate limiter on the ping endpoint protects the backend from a single misbehaving/chatty client app, independent of overall system load.',
    'Split "give me the current trip status" (cache-served, high volume, loose consistency OK) from "the durable trip/payment ledger" (queue-then-database, strict consistency) — hot ephemeral state vs. durable record of truth.',
    'Writing every single location ping synchronously to the durable ledger massively overloads it — pings should flow through the cache and an async queue, with only trip start/end and payment needing strong durability.',
  ],
  rubric: [
    {
      id: 'lb-count',
      label: 'At least 2 load balancers',
      points: 10,
      check: { type: 'has-kind', kind: 'loadbalancer', min: 2 },
      why: 'A single load balancer node caps out at 200,000 rps — comfortably above this system\'s own load, but redundancy against a single point of failure still matters at 30M DAU scale.',
      failHint: 'Add a second Load Balancer node.',
    },
    {
      id: 'has-ratelimiter',
      label: 'Has a per-client ping rate limiter',
      points: 8,
      check: { type: 'has-kind', kind: 'ratelimiter', min: 1 },
      why: 'A per-client rate limiter on location pings protects the backend from a single misbehaving/chatty client app, independent of overall system load.',
      failHint: 'Add a Rate Limiter node in front of the load balancers to cap per-client ping rate.',
    },
    {
      id: 'edge-server-queue',
      label: 'Pings/writes flow through an async queue',
      points: 10,
      check: { type: 'direct-edge', from: 'server', to: 'queue' },
      why: 'Writing every single location ping synchronously to the durable ledger would massively overload it — pings should flow through an async queue, with only trip start/end/payment needing strong, immediate durability.',
      failHint: 'Connect your Server node to a Queue node so ping/state-transition writes are async.',
    },
    {
      id: 'edge-queue-database',
      label: 'Queue durably feeds the trip/payment ledger',
      points: 10,
      check: { type: 'direct-edge', from: 'queue', to: 'database' },
      why: 'The trip/payment ledger needs the strongest durability guarantees in this system — sitting behind the async queue as the durable system of record, not written directly from every ping.',
      failHint: 'Connect your Queue node to a Database node.',
    },
    {
      id: 'cache-hit-ratio',
      label: 'Cache hit ratio >= 90%',
      points: 10,
      check: { type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0.9 },
      why: '"Current trip status" is hot, ephemeral, high-volume, and tolerant of loose consistency — a well-tuned cache absorbs almost all of that without ever touching the ledger.',
      failHint: 'Add a Cache node for trip-status reads and raise its hit ratio to at least 90%.',
    },
    {
      id: 'db-shards',
      label: 'Ledger is sharded for the write volume (>= 30 shards)',
      points: 10,
      check: { type: 'config', kind: 'database', key: 'shards', op: 'gte', value: 30 },
      why: 'The ping/write volume, not the trip count, is what drives sharding here — a common under-provisioning trap is sizing for "number of trips" instead of the much higher ping rate.',
      failHint: 'Increase the ledger database\'s shard count — size it for continuous ping/write volume, not just trip count. Also raise maxConnections: the connection pool (maxConnections x 1000/12ms) caps combined throughput independent of shard count and will silently cap you well below what the shards alone would allow.',
    },
    {
      id: 'queue-worker-capacity',
      label: 'Queue has meaningful worker capacity (>= 500 workers)',
      points: 6,
      check: { type: 'config', kind: 'queue', key: 'workers', op: 'gte', value: 500 },
      why: 'The event/ping stream is continuous and high-volume — the queue needs enough worker capacity to keep the backlog from silently growing, which would show up as delayed trip-state updates.',
      failHint: 'Increase the queue\'s worker count — and raise jobsPerWorkerRps too if it\'s still at or near the default (50). Drain rate is workers x jobsPerWorkerRps, so 500+ workers at the default per-worker rate alone won\'t clear this ping volume; jobsPerWorkerRps is the second lever, not just worker count.',
    },
    {
      id: 'sim-availability',
      label: `Availability >= ${(0.99 * 100).toFixed(0)}%`,
      points: 12,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.99 },
      why: 'Dropped pings mean stale trip state and broken ETAs — the write-heavy path here has to hold up nearly as reliably as any read-heavy staple question.',
      failHint: 'Check for overloaded nodes on the write path — under-sizing the queue or ledger for ping volume is the most common cause.',
    },
    {
      id: 'sim-p99',
      label: 'p99 latency <= 300ms',
      points: 12,
      check: { type: 'sim', metric: 'p99Ms', op: 'lte', value: 300 },
      why: 'Rider-facing trip-status lookups need to feel responsive — a saturated app-server or ledger tier will blow this budget even if nothing is actually dropping requests.',
      failHint: 'Lower autoscaler target utilization or add capacity to whichever node has the highest utilization.',
    },
    {
      id: 'sim-no-overload',
      label: 'No node is overloaded',
      points: 12,
      check: { type: 'sim', metric: 'no-overloaded-nodes', op: 'eq', value: true },
      why: 'An overloaded node on the write path silently loses or delays trip-state updates — exactly the failure mode this write-dominated design has to guard against first.',
      failHint: 'Find the red/orange node in the canvas and give it more capacity.',
    },
  ],
  solution: {
    nodes: [
      { id: 'users-1', kind: 'users', label: 'Riders + Drivers', config: { users: TARGET_USERS } },
      { id: 'rl-1', kind: 'ratelimiter', label: 'Ping Rate Limiter', config: { limitRps: 140_000 } },
      { id: 'lb-1', kind: 'loadbalancer', label: 'Load Balancer 1', config: { algorithm: 'least-connections' } },
      { id: 'lb-2', kind: 'loadbalancer', label: 'Load Balancer 2', config: { algorithm: 'least-connections' } },
      {
        id: 'server-1',
        kind: 'server',
        label: 'App Servers',
        config: {
          rpsPerInstance: 1000,
          autoscale: 'on',
          minInstances: 210,
          maxInstances: 400,
          targetUtilization: 0.42,
        },
      },
      { id: 'cache-1', kind: 'cache', label: 'Trip State Cache', config: { hitRatio: 0.95, capacityRps: 300_000 } },
      { id: 'queue-1', kind: 'queue', label: 'Ping/Event Queue', config: { workers: 700, jobsPerWorkerRps: 300, mode: 'queue' } },
      { id: 'database-1', kind: 'database', label: 'Trip/Payment Ledger', config: { shards: 48, readReplicas: 1, maxConnections: 12_500 } },
    ],
    edges: [
      { id: 'e-users-rl', source: 'users-1', target: 'rl-1' },
      { id: 'e-rl-lb1', source: 'rl-1', target: 'lb-1' },
      { id: 'e-rl-lb2', source: 'rl-1', target: 'lb-2' },
      { id: 'e-lb1-server', source: 'lb-1', target: 'server-1' },
      { id: 'e-lb2-server', source: 'lb-2', target: 'server-1' },
      { id: 'e-server-cache', source: 'server-1', target: 'cache-1' },
      { id: 'e-server-queue', source: 'server-1', target: 'queue-1' },
      { id: 'e-cache-database', source: 'cache-1', target: 'database-1' },
      { id: 'e-queue-database', source: 'queue-1', target: 'database-1' },
    ],
    positions: {
      'users-1': { x: 60, y: 260 },
      'rl-1': { x: 280, y: 260 },
      'lb-1': { x: 500, y: 140 },
      'lb-2': { x: 500, y: 380 },
      'server-1': { x: 720, y: 260 },
      'cache-1': { x: 940, y: 120 },
      'queue-1': { x: 940, y: 400 },
      'database-1': { x: 1160, y: 260 },
    },
    writeup: `Unlike almost every other staple system-design question, this one is
**dominated by write traffic**: continuous location pings and state
transitions from active trips vastly outnumber rider-facing reads. Sizing
the read cache generously while under-sizing the write path is the single
most common mistake here.

**Capacity estimation.** 30M DAU (riders + drivers) at a sustained 150,000
rps, 30:70 read:write, means ~105,000 rps of writes — pings and state
transitions — need a queue and ledger sized for continuous throughput, not
for "number of active trips," which would be 10-50x too low an estimate.

**Design decisions.** A per-client rate limiter caps ping rate independent
of overall load, protecting the backend from a single buggy/chatty client.
Two load balancers front an autoscaled app-server fleet at a low (0.42)
target utilization for latency headroom. Reads ("what's my trip status
right now") go through a cache tuned to a 95% hit ratio — hot, ephemeral,
loosely-consistent state. Writes go through an async queue before landing
in the trip/payment ledger — the one place in this whole design where
"eventually consistent, just cache it" reasoning breaks down, since money
and legally-relevant trip records need the strongest durability guarantee
in the graph. The matching algorithm itself (nearest available driver) is
explicitly treated as an opaque downstream call — a geospatial-indexing
problem out of scope for this capacity model.

**Bottleneck walk.** At target load the app-server tier sits at ~42%
utilization (by autoscaler design), the ping/event queue drains at ~47% of
its rate, and the 48-shard ledger sits at ~51% write utilization with
enough connection-pool headroom that it isn't the binding constraint.
Nothing crosses 55%, which is what keeps p99 comfortably inside the 300ms
budget for rider-facing status lookups despite the write-heavy background
load constantly flowing through the same servers.`,
    keyInsights: [
      'This problem is dominated by write traffic (location pings, state transitions) — the opposite emphasis from most read-heavy staple questions.',
      'The matching algorithm (nearest available driver) is a geospatial-indexing problem out of scope for this capacity model — treat "match rider to driver" as an opaque downstream call.',
      'Size the queue and ledger for pings-per-trip-per-second, not trip count — the ping rate is 10-50x higher than a naive trip-count estimate.',
      'A per-client rate limiter on pings protects the backend from a single misbehaving client app, independent of overall system load.',
      'Split hot, ephemeral trip-status reads (cache-served, loose consistency OK) from the durable trip/payment ledger (queue-then-database, strict consistency) — the one place here where "just cache it" reasoning breaks down.',
    ],
    sources: [
      { label: 'Grokking the System Design Interview curriculum', url: 'https://www.grokkingsystemdesign.com/curriculum' },
      { label: 'HelloInterview — System Design in a Hurry', url: 'https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction' },
    ],
  },
};
