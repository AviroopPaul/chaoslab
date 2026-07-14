// Sourced from docs/research/common-questions.md §4 "Chat System". Tuned
// against the real engine (src/lib/sim/engine.ts) — see the temporary
// tuning test used during authoring; the config below is what actually
// clears its own rubric at 100/100 and simulates HEALTHY at targetLoad.

import type { Question } from '../types';

const TARGET_USERS = 100_000_000;
const RPS_PER_USER = 0.0005; // 100M * 0.0005 = 50,000 rps offered

export const chatSystem: Question = {
  id: 'chat-system',
  title: 'Design a Chat System (WhatsApp-style)',
  difficulty: 'medium',
  tags: ['async writes', 'sharding', 'caching'],
  statement: `Design a messaging backend in the shape of WhatsApp/Messenger/Slack:
support 1:1 and group conversations, sending messages, and fetching/syncing
conversation history.

**Functional requirements**

- \`POST /messages\` — send a message into a conversation.
- \`GET /conversations/:id/messages\` — fetch/sync recent history for a conversation.
- Fetch/sync traffic somewhat exceeds sends — people re-open chats and scroll
  back far more often than they type.

**Scope note**

This simulator has no WebSocket/long-poll/real-time push semantics, so
push-delivery, presence, and typing indicators are explicitly **out of
scope**. Model only the send (write) and fetch/sync (read) HTTP-shaped API
traffic — treat every request as if it hit a normal request/response
endpoint, not a persistent socket.`,
  scale: `- **100M DAU**, ~40 messages sent+received per user per day
- **~70% reads / 30% writes** — fetch/sync somewhat exceeds sends
- Target load: **50,000 rps** (35,000 read / 15,000 write)
- Availability budget: **99%**
- p99 latency budget: **280ms**
- Cost budget: **$22,000/month**`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: RPS_PER_USER,
    readWriteRatio: 0.7,
  },
  budgets: {
    availability: 0.99,
    p99Ms: 280,
    costPerMonth: 22_000,
  },
  hints: [
    'A sent message does not need to be durably written to the database before you tell the client "sent" — an async queue in front of the message store improves perceived send latency a lot.',
    'Shard the message store by conversation_id, not user_id — that keeps both participants\' full history on one shard for a fast single-shard fetch. Sharding by user_id would scatter a group chat across many shards.',
    'Fetch/sync ("catch up on my open conversations") is comparatively read-heavy — a cache in front of the message store absorbs most of that without ever touching the database.',
    'A durable queue (Kafka-class), not an in-memory buffer, is what actually protects you here — a crash before drain would otherwise lose messages that the client already thinks were "sent".',
    'Group-chat fan-out is structurally a pub/sub problem (one send, many recipients) — worth naming as a follow-up even though the core design here uses plain queue mode for 1:1-shaped traffic.',
    'Size the message queue for drain, not just enqueue: workers x jobsPerWorkerRps needs real margin above the ~15,000 rps write volume at target load, or the backlog grows silently even while sends still look "accepted".',
  ],
  rubric: [
    {
      id: 'has-queue',
      label: 'Has a queue for message persistence',
      points: 8,
      check: { type: 'has-kind', kind: 'queue', min: 1 },
      why: 'Persisting a sent message asynchronously via a durable queue improves perceived send latency — the client can be told "sent" once the message is durably enqueued, not once the database write completes.',
      failHint: 'Add a Queue node between your app servers and the database for the write path.',
    },
    {
      id: 'path-users-server',
      label: 'Traffic reaches an app server',
      points: 8,
      check: { type: 'path', from: 'users', to: 'server' },
      why: 'Every request needs to actually reach application logic — a dangling users node defeats the whole design.',
      failHint: 'Wire the Users node through to at least one Server node (directly or via a load balancer).',
    },
    {
      id: 'edge-server-queue',
      label: 'Server writes go to the queue, not straight to the DB',
      points: 10,
      check: { type: 'direct-edge', from: 'server', to: 'queue' },
      why: 'Modeling chat as purely synchronous — writing straight to the database — ties send-path p99 directly to database write latency. An async queue in front of persistence decouples the two.',
      failHint: 'Connect your Server node directly to a Queue node so writes are enqueued asynchronously.',
    },
    {
      id: 'edge-queue-database',
      label: 'Queue durably feeds the database',
      points: 10,
      check: { type: 'direct-edge', from: 'queue', to: 'database' },
      why: 'The queue only buys you anything if what it drains lands durably in the message store — a queue with nowhere to go is a dead end, not a persistence strategy.',
      failHint: 'Connect your Queue node to a Database node so drained messages are durably persisted.',
    },
    {
      id: 'cache-hit-ratio',
      label: 'Cache hit ratio >= 85%',
      points: 10,
      check: { type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0.85 },
      why: 'The sync/fetch pattern ("catch up on my open conversations") is comparatively read-heavy — a well-tuned cache absorbs the overwhelming majority of that traffic before it ever reaches the database.',
      failHint: 'Add a Cache node in front of the database (for reads) and raise its hit ratio to at least 85%.',
    },
    {
      id: 'db-shards',
      label: 'Message store is sharded (>= 4 shards)',
      points: 8,
      check: { type: 'config', kind: 'database', key: 'shards', op: 'gte', value: 4 },
      why: 'A single unsharded database cannot survive 100M DAU worth of conversation history — sharding by conversation_id (not user_id) keeps a group chat\'s full history colocated while still spreading load.',
      failHint: 'Increase the database\'s shard count — a single shard cannot carry this write volume. Also raise maxConnections: the connection pool (maxConnections x 1000/12ms) caps combined throughput regardless of shard count, so a too-small pool silently defeats extra shards.',
    },
    {
      id: 'config-queue-workers',
      label: 'Queue sized to drain the write volume',
      points: 8,
      check: { type: 'config', kind: 'queue', key: 'workers', op: 'gte', value: 180 },
      why: 'A message send only "counts" once it drains off the queue, not just once it\'s enqueued — the write side offers ~15,000 rps at target load, so drain rate (workers x jobsPerWorkerRps) needs real margin above that, not just enough to clear it exactly.',
      failHint: 'Raise the Queue node\'s worker count (or jobsPerWorkerRps) so drain rate comfortably clears the ~15,000 rps write volume with margin — an under-provisioned queue backlog is silent, growing send delay.',
    },
    {
      id: 'sim-availability',
      label: `Availability >= ${(0.99 * 100).toFixed(0)}%`,
      points: 14,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.99 },
      why: 'Message delivery is the entire product here — a chat backend that silently drops sends or fetches is not a usable chat backend.',
      failHint: 'Something in the path is dropping requests — check for overloaded nodes in the Results tab and add capacity there.',
    },
    {
      id: 'sim-p99',
      label: 'p99 latency <= 280ms',
      points: 14,
      check: { type: 'sim', metric: 'p99Ms', op: 'lte', value: 280 },
      why: 'A slow send/fetch feels broken even when it eventually succeeds — the async queue keeps this bounded even under write load, but a saturated app-server tier will still blow the budget.',
      failHint: 'A saturated node inflates p99 the most — check per-node utilization and add capacity (or autoscale headroom) to the hottest one, most likely the app server tier.',
    },
    {
      id: 'sim-cost',
      label: 'Cost <= $22,000/month',
      points: 4,
      check: { type: 'sim', metric: 'costPerMonth', op: 'lte', value: 22_000 },
      why: 'Chat at this scale is a well-understood shape — the architecture should be sized efficiently, not thrown at with unlimited hardware.',
      failHint: 'Trim over-provisioned capacity (fewer max instances/queue workers) once availability and latency are already comfortably met.',
    },
    {
      id: 'sim-no-overload',
      label: 'No node is overloaded',
      points: 6,
      check: { type: 'sim', metric: 'no-overloaded-nodes', op: 'eq', value: true },
      why: 'An "overloaded" or "down" node is actively dropping requests right now — an undrained queue backlog in particular is silent message-delivery delay, not a free buffer.',
      failHint: 'Find the red/orange node in the canvas and give it more capacity.',
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
        config: {
          rpsPerInstance: 1500,
          autoscale: 'on',
          minInstances: 60,
          maxInstances: 200,
          targetUtilization: 0.4,
        },
      },
      { id: 'cache-1', kind: 'cache', label: 'Conversation Cache', config: { hitRatio: 0.9, capacityRps: 300_000 } },
      { id: 'queue-1', kind: 'queue', label: 'Message Queue', config: { workers: 230, jobsPerWorkerRps: 100, mode: 'queue' } },
      { id: 'database-1', kind: 'database', label: 'Message Store', config: { shards: 6, readReplicas: 1, maxConnections: 1500 } },
    ],
    edges: [
      { id: 'e-users-lb', source: 'users-1', target: 'lb-1' },
      { id: 'e-lb-server', source: 'lb-1', target: 'server-1' },
      { id: 'e-server-cache', source: 'server-1', target: 'cache-1' },
      { id: 'e-server-queue', source: 'server-1', target: 'queue-1' },
      { id: 'e-cache-database', source: 'cache-1', target: 'database-1' },
      { id: 'e-queue-database', source: 'queue-1', target: 'database-1' },
    ],
    positions: {
      'users-1': { x: 60, y: 220 },
      'lb-1': { x: 280, y: 220 },
      'server-1': { x: 500, y: 220 },
      'cache-1': { x: 720, y: 100 },
      'queue-1': { x: 720, y: 340 },
      'database-1': { x: 940, y: 220 },
    },
    writeup: `The defining shape here is **read the recent, write async**: fetch/sync
traffic is comparatively read-heavy (a cache soaks up most of it), while a
send only needs to be durably *enqueued*, not durably *written*, before the
client hears "sent".

**Capacity estimation.** 100M DAU generating ~40 messages sent+received/day
works out to roughly 50,000 rps at peak, split ~70/30 read/write. An
autoscaled app-server fleet behind a single load balancer (well under its
200,000 rps cap at this scale) handles routing; a low autoscaler target
utilization (0.4) buys the headroom needed to keep p99 inside budget even
though app-server latency is the single biggest contributor to the
end-to-end number.

**Design decisions.** Reads go through a cache tuned for a ~90% hit ratio —
"which conversations are currently open" is a very repeat-friendly access
pattern. Writes go to a queue, not straight to the database: this both
improves perceived send latency and means a slow database write never
blocks the client. The queue drains into a message store **sharded by
conversation_id** (not user_id) — this keeps both participants' full history
on one shard for a fast single-shard fetch; sharding by user_id would
instead scatter a group conversation across many shards and force a fan-in
read on every fetch.

**Bottleneck walk.** At target load the app-server tier sits around 40%
utilization (the deliberate low autoscaler target), the queue drains at
~65% of its 23,000 rps capacity, and the sharded database sits comfortably
under both its read and write ceilings. Nothing crosses 70% utilization,
which is exactly why p99 stays inside the 280ms budget despite every hop
adding queueing latency on top of base latency.`,
    keyInsights: [
      'Persisting a sent message asynchronously via a durable queue improves perceived send latency — the client hears "sent" once the message is durably enqueued, not once the database write completes.',
      'Shard the message store by conversation_id, not user_id — this keeps both participants\' full history colocated for a fast single-shard fetch.',
      'The queue must be a durable, replicated log (Kafka-class), not an in-memory buffer — a crash before drain would otherwise lose messages the client already believes were sent.',
      'A cache absorbs the read-heavy "catch up on my open conversations" pattern — fetch/sync traffic is comparatively read-heavy relative to sends.',
      'Group-chat fan-out is structurally a pub/sub problem (one send, many recipients) — toggling the queue to pubsub mode with subscriberCount = group size is the natural extension, even though this core design uses plain queue mode.',
    ],
    sources: [
      { label: "Alex Xu, System Design Interview Vol. 1, ch. 12 — Design A Chat System", url: 'https://www.amazon.com/dp/B08CMF2CQF' },
      { label: 'Blind — master list of system design interview questions', url: 'https://www.teamblind.com/post/master-list-of-all-system-design-interview-questions-w34wkv2r' },
    ],
  },
};
