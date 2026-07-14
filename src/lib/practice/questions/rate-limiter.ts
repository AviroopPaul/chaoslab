// Research-driven authoring pass — see docs/research/common-questions.md §2
// (API Rate Limiter) for the dossier this question is built from.

import type { Question } from '../types';

const TARGET_USERS = 10_000_000;

export const rateLimiter: Question = {
  id: 'rate-limiter',
  title: 'Design an API Rate Limiter',
  difficulty: 'easy',
  tags: ['admission control', 'shedding', 'distributed counters'],
  statement: `Design a rate limiter that sits in front of a large API platform and caps
per-client (or global) request throughput, **shedding excess traffic before
it can overload backend services** — without adding meaningful latency to
admitted requests, and while staying consistent across many stateless
gateway instances.

**Functional requirements**

- Admit requests up to a configured throughput ceiling; reject (not error)
  anything above it.
- Protect every downstream tier at once, not just the app servers.
- Stay cheap and fast in the common case — the limiter should rarely be the
  thing actually doing the shedding at normal load.

Occasional bursts up to 2x steady-state traffic must be shed cleanly rather
than cause a backend meltdown.`,
  scale: `- Platform serving **200,000 rps** of steady-state API traffic
- **~4:1 read:write** (mostly GETs)
- Availability budget: **99.5%**
- p99 latency budget: **200ms**
- Cost budget: **$15,000/month**`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: 0.02,
    readWriteRatio: 0.8,
  },
  budgets: {
    availability: 0.995,
    p99Ms: 200,
    costPerMonth: 15_000,
  },
  hints: [
    'A rate limiter is a stateless admission gate, not a queue — it decides pass/shed at the door instantly, it doesn\'t slow down what it admits.',
    'Place the limiter before the load balancer, not after — that protects every downstream tier at once (including the LB itself), rather than only the app servers.',
    'Size the limit above your sustained load, not at the bleeding edge — a well-sized limiter should rarely be the thing actually doing the shedding at normal traffic.',
    'A single load balancer is hard-capped at 200,000 rps in this simulator — at this scale you need more than one.',
    'This is still a real backend behind the gate: the write path needs enough database shards to keep up on its own, independent of the limiter.',
    'Server cost here is a flat $80/month per instance regardless of rpsPerInstance — fewer, beefier instances cost less than many small ones for the same total throughput, since rpsPerInstance is effectively free capacity in this simulator.',
  ],
  rubric: [
    {
      id: 'has-ratelimiter',
      label: 'Has a rate limiter',
      points: 8,
      check: { type: 'has-kind', kind: 'ratelimiter', min: 1 },
      why: 'The whole point of this problem is a dedicated admission-control component in front of the platform.',
      failHint: 'Add a Rate Limiter node in front of your load balancer.',
    },
    {
      id: 'has-lb-2',
      label: 'At least 2 load balancers',
      points: 10,
      check: { type: 'has-kind', kind: 'loadbalancer', min: 2 },
      why: 'A single load balancer node is hard-capped at 200,000 rps in this engine — right at (or below) this platform\'s steady-state load, so one alone would already be maxed out before any burst.',
      failHint: 'Add a second Load Balancer node so the fleet\'s combined capacity clears 200,000 rps with headroom.',
    },
    {
      id: 'direct-edge-rl-lb',
      label: 'Rate limiter precedes the load balancer',
      points: 10,
      check: { type: 'direct-edge', from: 'ratelimiter', to: 'loadbalancer' },
      why: 'Admission control belongs before the fleet, not after — a limiter placed behind the load balancer protects the app servers but leaves the load balancer itself exposed to the exact burst you\'re trying to shed.',
      failHint: 'Wire the Rate Limiter node directly to a Load Balancer node, in that order.',
    },
    {
      id: 'config-limit-headroom',
      label: 'Limit sized as a safety net above sustained load',
      points: 12,
      check: { type: 'config', kind: 'ratelimiter', key: 'limitRps', op: 'gte', value: 205_000 },
      why: 'Set the limit comfortably above steady-state (200,000 rps here), not at the bleeding edge. Sized this way, the limiter stays dormant in the common case and only sheds during a real burst — and that shed traffic is deliberately excluded from the availability metric\'s denominator, since a policy-driven rejection isn\'t a reliability failure the way a dropped/errored request is.',
      failHint: 'Raise limitRps on the Rate Limiter node to comfortably clear 200,000 rps (a safety-net margin above sustained load, not a tight ceiling).',
    },
    {
      id: 'config-db-shards',
      label: 'Database sharded for the write path',
      points: 10,
      check: { type: 'config', kind: 'database', key: 'shards', op: 'gte', value: 15 },
      why: 'A rate limiter alone doesn\'t make the backend infinitely scalable — the write path (new resource creation, ~40,000 rps at target load) still needs enough database shards to clear it on its own.',
      failHint: 'Increase the Database node\'s shard count so write capacity (shards x 4,000 rps) comfortably clears the write-side load — and raise maxConnections too, since the connection pool (maxConnections x 1000/12ms) caps combined throughput independent of shard count and silently overrides extra shards otherwise.',
    },
    {
      id: 'not-kind-queue',
      label: 'No queue bolted onto the limiter',
      points: 8,
      check: { type: 'not-kind', kind: 'queue' },
      why: 'A rate limiter is a fast, stateless, in-memory admission gate — not a full backend service with its own asynchronous processing pipeline. This workload has no async work to defer, so a queue here would be unjustified complexity, not a reliability improvement.',
      failHint: 'Remove the Queue node — this design doesn\'t need asynchronous processing anywhere in the path.',
    },
    {
      id: 'sim-availability',
      label: 'Availability >= 99.5%',
      points: 14,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.995 },
      why: 'At steady-state (this question\'s target load) a well-sized limiter shouldn\'t be shedding anything yet — availability here is a measure of whether the rest of the fleet can actually keep up.',
      failHint: 'Check for overloaded nodes downstream of the limiter — the gate isn\'t the whole story.',
    },
    {
      id: 'sim-p99',
      label: 'p99 latency <= 200ms',
      points: 14,
      check: { type: 'sim', metric: 'p99Ms', op: 'lte', value: 200 },
      why: 'An admission gate should add effectively zero latency to what it lets through — if p99 is blowing the budget, the problem is downstream capacity, not the limiter itself.',
      failHint: 'A saturated node past the limiter inflates p99 the most — check per-node utilization and add capacity (or raise rps/instance) there.',
    },
    {
      id: 'sim-cost',
      label: 'Cost <= $15,000/month',
      points: 14,
      check: { type: 'sim', metric: 'costPerMonth', op: 'lte', value: 15_000 },
      why: 'A stateless gate plus a straightforward read/write backend should be efficient — the limiter itself costs almost nothing; the fleet behind it is where cost lives.',
      failHint: 'Trim over-provisioned capacity (fewer database shards or a smaller server fleet) once latency and availability are already comfortably met.',
    },
  ],
  solution: {
    nodes: [
      { id: 'users-1', kind: 'users', label: 'Users', config: { users: TARGET_USERS } },
      { id: 'rl-1', kind: 'ratelimiter', label: 'Rate Limiter', config: { limitRps: 220_000 } },
      { id: 'lb-1', kind: 'loadbalancer', label: 'Load Balancer 1', config: { algorithm: 'least-connections' } },
      { id: 'lb-2', kind: 'loadbalancer', label: 'Load Balancer 2', config: { algorithm: 'least-connections' } },
      { id: 'server-1', kind: 'server', label: 'App Servers', config: { instances: 60, rpsPerInstance: 10_000 } },
      { id: 'cache-1', kind: 'cache', label: 'Cache', config: { hitRatio: 0.85, capacityRps: 500_000 } },
      { id: 'database-1', kind: 'database', label: 'Database', config: { shards: 20, readReplicas: 0, maxConnections: 3_200 } },
    ],
    edges: [
      { id: 'e-users-rl', source: 'users-1', target: 'rl-1' },
      { id: 'e-rl-lb1', source: 'rl-1', target: 'lb-1' },
      { id: 'e-rl-lb2', source: 'rl-1', target: 'lb-2' },
      { id: 'e-lb1-server', source: 'lb-1', target: 'server-1' },
      { id: 'e-lb2-server', source: 'lb-2', target: 'server-1' },
      { id: 'e-server-cache', source: 'server-1', target: 'cache-1' },
      { id: 'e-server-database', source: 'server-1', target: 'database-1' },
      { id: 'e-cache-database', source: 'cache-1', target: 'database-1' },
    ],
    positions: {
      'users-1': { x: 40, y: 260 },
      'rl-1': { x: 260, y: 260 },
      'lb-1': { x: 480, y: 160 },
      'lb-2': { x: 480, y: 360 },
      'server-1': { x: 700, y: 260 },
      'cache-1': { x: 920, y: 160 },
      'database-1': { x: 1140, y: 260 },
    },
    writeup: `**Requirements.** Cap per-client/global throughput and shed excess traffic
before it overloads anything downstream — without slowing down admitted
requests, and while keeping every gateway instance's counters in sync (a
consistency detail this simulator abstracts away; it models the resulting
*capacity and shedding behavior*, not the counter-synchronization mechanism a
real implementation would need, e.g. a shared Redis cluster running a
sliding-window or token-bucket algorithm).

**Capacity estimate.** 10M users at 0.02 rps/user and an 80/20 read/write
split gives 200,000 rps steady-state (160,000 read / 40,000 write). A single
load balancer node is hard-capped at 200,000 rps in this engine — right at
this platform's steady-state, so it would already be maxed out before any
burst. Two load balancers behind the limiter split that load comfortably.

**Design decisions.** The rate limiter sits *first*, before the load
balancer — that's what protects every downstream tier at once (including the
load balancer itself), instead of only shielding the app servers while
leaving the LB exposed. It's sized to 220,000 rps: comfortably above the
200,000 rps sustained load, so at steady-state it stays dormant and simply
passes everything through — a limiter that's constantly shedding legitimate
traffic at normal load is mis-sized, not doing its job. During a real burst
(say 2x traffic), it would shed the excess cleanly at the edge; that shed
traffic is a deliberate policy decision, not an error, and this simulator's
availability metric is built to reflect that distinction — shed requests are
excluded from its denominator entirely. There's no queue anywhere in this
graph: a rate limiter is a fast, stateless, in-memory gate, not a service
with its own asynchronous backend.

**Bottleneck walk.** At target load, both load balancers run at 50%
utilization, the app-server fleet at ~33% (60 instances, 10,000 rps/instance
— sized for latency headroom, not because the raw throughput demands it),
the cache at ~53%, and the database at 63% write-utilization (the binding
constraint: 40,000 write rps against a 20-shard, 64,000 rps write ceiling —
read capacity is comfortably higher and never the bottleneck here). Nothing
crosses 70%, which is exactly the point: a rate limiter is a safety net, and
the fleet behind it should already be sized to handle steady-state on its
own merits.

A real system would likely layer a coarse edge/IP-based limiter with a
stricter per-API-key limiter closer to the service — this dossier uses one
limiter for clarity, but that's a natural, common follow-up.`,
    keyInsights: [
      'A rate limiter is a stateless admission gate, not a queue — it decides pass/shed instantly, it never backs up.',
      'Placing the limiter before the load balancer protects every downstream tier at once, not just the app servers.',
      'Size the limit above sustained load, not at the edge — a well-sized limiter should rarely be the one doing the shedding.',
      'Shed traffic is deliberately excluded from the availability calculation — it\'s a policy decision, not a reliability failure.',
      'The limiter doesn\'t make the backend infinitely scalable on its own — the write path still needs its own database sharding story.',
    ],
    sources: [
      { label: 'Alex Xu — System Design Interview Vol. 1, ch. 4 ("Design A Rate Limiter")', url: 'https://www.amazon.com/dp/B08CMF2CQF' },
      { label: 'HelloInterview — Problem Breakdowns', url: 'https://www.hellointerview.com/learn/system-design/problem-breakdowns/overview' },
    ],
  },
};
