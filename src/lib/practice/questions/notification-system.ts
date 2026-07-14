// Research-driven authoring pass — see docs/research/common-questions.md §6
// (Notification System) for the dossier this question is built from.

import type { Question } from '../types';

const TARGET_USERS = 5_000_000;

export const notificationSystem: Question = {
  id: 'notification-system',
  title: 'Design a Notification System',
  difficulty: 'medium',
  tags: ['pub/sub', 'fan-out', 'multi-channel delivery'],
  statement: `Design a notification system that delivers events ("someone liked your
post", "your order shipped") across multiple channels — push, email, SMS —
to potentially millions of recipients, **without blocking the triggering
request on slow third-party providers** (APNs/FCM/Twilio/SES), and without
spamming users with duplicate or excessive notifications.

**Functional requirements**

- Accept a trigger event and fan it out to every channel a user has enabled.
- Serve the in-app notification inbox (fetch a user's recent notifications).
- Never let a slow/unavailable third-party provider block the triggering
  request or take down the whole system.

This is a **write-dominated** problem, unlike most feed/cache-heavy designs —
trigger events vastly outnumber inbox reads.`,
  scale: `- **500M registered users**
- **~3:7 read:write** — trigger events dominate inbox-fetch traffic
- **50,000 rps** total
- Availability budget: **99%**
- p99 latency budget: **300ms**
- Cost budget: **$90,000/month** (the pub/sub worker fan-out cost dominates — expected)`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: 0.01,
    readWriteRatio: 0.3,
  },
  budgets: {
    availability: 0.99,
    p99Ms: 300,
    costPerMonth: 90_000,
  },
  hints: [
    'One triggering event has to reach multiple independent consumers — one per channel (push/email/SMS). That\'s a pub/sub fan-out, not a plain work queue.',
    'In plain queue mode, work gets load-split across consumers — only one channel would ever see any given message. Pub/sub mode gives every subscriber its own full copy of the stream.',
    'Every subscriber adds its own full drain burden — size workers for event rate x subscriber count, not just the raw event rate.',
    'Never call third-party providers (APNs/FCM/Twilio) synchronously from the request path — dispatch async so a slow provider can\'t block or take down the trigger endpoint.',
    'Keep a separate table/database for delivery status — otherwise there\'s no way to tell whether a notification actually landed.',
    'The delivery-status database absorbs the full pub/sub-multiplied write volume (event rate x subscriber count, ~105,000 rps here) — a single shard cannot carry that; size it with double-digit shards, well beyond what the raw trigger-event rate alone would suggest.',
  ],
  rubric: [
    {
      id: 'has-queue',
      label: 'Has a queue',
      points: 10,
      check: { type: 'has-kind', kind: 'queue', min: 1 },
      why: 'Async dispatch is what keeps a slow third-party provider from ever blocking the triggering request.',
      failHint: 'Add a Queue node between your app servers and the delivery-status database.',
    },
    {
      id: 'config-pubsub-mode',
      label: 'Queue runs in pub/sub mode',
      points: 15,
      check: { type: 'config', kind: 'queue', key: 'mode', op: 'eq', value: 'pubsub' },
      why: 'One triggering event must reach multiple independent consumers — push, email, SMS — each needing its own full copy of the stream. Plain queue mode load-splits work across consumers, so only one channel would ever see any given message; pub/sub is the correct shape for this fan-out.',
      failHint: 'Set the Queue node\'s mode to "pubsub" in the inspector panel.',
    },
    {
      id: 'config-subscriber-count',
      label: 'At least 3 subscribers (one per channel)',
      points: 15,
      check: { type: 'config', kind: 'queue', key: 'subscriberCount', op: 'gte', value: 3 },
      why: 'Push, email, and SMS are three independent channels, each needing its own full copy of every event — modeling fewer than 3 subscribers understates the real fan-out this system has to deliver.',
      failHint: 'Raise the Queue node\'s subscriberCount to at least 3 (one per delivery channel).',
    },
    {
      id: 'direct-edge-server-queue',
      label: 'Writes go through the queue, not straight to a database',
      points: 10,
      check: { type: 'direct-edge', from: 'server', to: 'queue' },
      why: 'Provider unavailability must never block the triggering request — trigger events are dispatched asynchronously through the queue rather than calling APNs/FCM/Twilio (or writing straight to a database) synchronously from the API server.',
      failHint: 'Connect your app server\'s write path to the Queue node, not directly to a database.',
    },
    {
      id: 'direct-edge-queue-database',
      label: 'Queue feeds a delivery-status database',
      points: 10,
      check: { type: 'direct-edge', from: 'queue', to: 'database' },
      why: 'Without a durable delivery-status record, there\'s no way to tell whether a notification actually landed on any given channel.',
      failHint: 'Connect the Queue node directly to a Database node for delivery-status tracking.',
    },
    {
      id: 'config-queue-workers',
      label: 'Worker pool sized for fan-out demand',
      points: 10,
      check: { type: 'config', kind: 'queue', key: 'workers', op: 'gte', value: 1_000 },
      why: 'Every subscriber adds its own full drain burden in pub/sub mode — workers must be sized for event rate x subscriber count, not just the raw trigger-event rate. Under-provisioning here is the classic pub/sub trap.',
      failHint: 'Raise the Queue node\'s worker count — pub/sub mode multiplies total consumption work by subscriberCount.',
    },
    {
      id: 'sim-availability',
      label: 'Availability >= 99%',
      points: 10,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.99 },
      why: 'Even in a write-dominated, fan-out-heavy system, the vast majority of trigger events and inbox reads should succeed.',
      failHint: 'Check for an overloaded node — a saturated server tier or an under-provisioned queue/database is the usual culprit.',
    },
    {
      id: 'sim-p99',
      label: 'p99 latency <= 300ms',
      points: 10,
      check: { type: 'sim', metric: 'p99Ms', op: 'lte', value: 300 },
      why: 'The synchronous part of this system (accepting a trigger, serving the inbox) needs to stay fast even while the async fan-out pipeline does the heavy lifting behind it.',
      failHint: 'Look for a hot node on the synchronous path (app server, cache, or inbox database) and add capacity or headroom there.',
    },
    {
      id: 'sim-cost',
      label: 'Cost <= $90,000/month',
      points: 10,
      check: { type: 'sim', metric: 'costPerMonth', op: 'lte', value: 90_000 },
      why: 'The pub/sub worker fleet\'s fan-out-driven cost is expected to dominate this budget — that\'s the honest cost of reliably reaching every channel, not a sign of an inefficient design.',
      failHint: 'If cost is over budget, look first at over-provisioned database shards or app-server instances — the pub/sub worker count is doing necessary work here.',
    },
  ],
  solution: {
    nodes: [
      { id: 'users-1', kind: 'users', label: 'Users', config: { users: TARGET_USERS } },
      { id: 'lb-1', kind: 'loadbalancer', label: 'Load Balancer', config: { algorithm: 'round-robin' } },
      { id: 'server-1', kind: 'server', label: 'App Servers', config: { instances: 75, rpsPerInstance: 1_500 } },
      { id: 'cache-1', kind: 'cache', label: 'Inbox / Dedup Cache', config: { hitRatio: 0.9, capacityRps: 300_000 } },
      { id: 'database-1', kind: 'database', label: 'Prefs / Log DB', config: { shards: 1, readReplicas: 0, maxConnections: 400 } },
      { id: 'queue-1', kind: 'queue', label: 'Notification Fan-out (pub/sub)', config: { workers: 1_600, jobsPerWorkerRps: 130, mode: 'pubsub', subscriberCount: 3 } },
      { id: 'database-2', kind: 'database', label: 'Delivery Status DB', config: { shards: 18, readReplicas: 0, maxConnections: 2_200 } },
    ],
    edges: [
      { id: 'e-users-lb', source: 'users-1', target: 'lb-1' },
      { id: 'e-lb-server', source: 'lb-1', target: 'server-1' },
      { id: 'e-server-cache', source: 'server-1', target: 'cache-1' },
      { id: 'e-cache-database1', source: 'cache-1', target: 'database-1' },
      { id: 'e-server-queue', source: 'server-1', target: 'queue-1' },
      { id: 'e-queue-database2', source: 'queue-1', target: 'database-2' },
    ],
    positions: {
      'users-1': { x: 40, y: 260 },
      'lb-1': { x: 260, y: 260 },
      'server-1': { x: 480, y: 260 },
      'cache-1': { x: 700, y: 120 },
      'database-1': { x: 920, y: 120 },
      'queue-1': { x: 700, y: 400 },
      'database-2': { x: 920, y: 400 },
    },
    writeup: `**Requirements.** Fan a trigger event out across push/email/SMS to
potentially millions of recipients, serve the in-app inbox, and never let a
slow third-party provider block the triggering request.

**Capacity estimate.** At this dossier's scale, offered load is 50,000 rps
with a 3:7 read:write split — 15,000 rps of inbox fetches and 35,000 rps of
trigger events. That inversion (writes dominating reads) is the opposite
emphasis from most cache-heavy staples, and it shapes the whole design.

**Design decisions.** The read side is unremarkable: a load balancer, an
autoscalable-in-spirit app-server tier, and a cache in front of a small
prefs/log database absorb inbox reads and recent-send dedup checks. The
*write* side is where the interesting decision lives — **pub/sub, not plain
queue mode, is the correct shape** for the fan-out, because one triggering
event has to reach multiple *independent* consumers (one per channel), each
needing its own full copy of the stream. Plain queue mode load-splits work
across consumers instead of duplicating it, so only one channel would ever
see any given message — a silent under-delivery bug that's easy to miss in
an interview. Because every subscriber adds its own full drain burden,
workers have to be sized for **event rate x subscriber count** (35,000 rps x
3 channels = 105,000 rps of real consumption work), not the raw 35,000 rps
trigger rate — a classic under-provisioning trap this design deliberately
avoids. Delivery status gets its own, separately-sharded database, distinct
from the small prefs/log store, so there's an actual record of whether a
notification landed on each channel.

**Bottleneck walk.** At target load, the app-server tier runs at ~44%
utilization, the pub/sub queue at ~50% (1,600 workers x 130 jobs/worker/rps
= 208,000 rps of drain capacity against 105,000 rps of real demand — just
over the "1.2x write rps x subscriberCount" rule of thumb with real margin),
and the delivery-status database at ~57% write-utilization across 18 shards.
The pub/sub worker fleet is by far the largest cost line (roughly $64k of
this design's ~$75k total) — an expected, not accidental, consequence of
fan-out: reliably reaching three channels for every event costs
proportionally more than reaching one.

Per-user/per-notification-type dedup and rate limiting (don't send 50 "someone
liked your post" pings in 10 seconds) belongs in the fast cache layer with
short TTLs, not the durable log — and priority tiers (critical security
alerts vs. marketing blasts) argue for separate topics with independent
worker pools in a real system, a natural follow-up this simplified graph
doesn't model.`,
    keyInsights: [
      'Pub/sub, not plain queue mode, is the correct shape whenever one event must reach multiple independent consumers.',
      'Every subscriber adds its own full drain burden — size workers for event rate x subscriber count, not just raw event rate.',
      'Never call third-party providers synchronously from the API server — async dispatch is what keeps a slow provider from taking down the trigger path.',
      'Give delivery status its own database — without it, there\'s no way to tell whether a notification actually landed.',
      'This is a write-dominated problem, the opposite emphasis from most cache-heavy system-design staples.',
    ],
    sources: [
      { label: 'Alex Xu — System Design Interview Vol. 1, ch. 10 ("Design A Notification System")', url: 'https://www.amazon.com/dp/B08CMF2CQF' },
      { label: 'Grokking the System Design Interview Vol. II — Distributed Notification Service', url: 'https://www.designgurus.io/course/grokking-system-design-interview-ii' },
    ],
  },
};
