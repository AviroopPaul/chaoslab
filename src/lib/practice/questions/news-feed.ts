// Research-driven authoring pass — see docs/research/common-questions.md §3
// (News Feed / Social Feed) for the dossier this question is built from.

import type { Question } from '../types';

const TARGET_USERS = 20_000_000;

export const newsFeed: Question = {
  id: 'news-feed',
  title: 'Design a News Feed',
  difficulty: 'medium',
  tags: ['caching', 'fan-out', 'sharding', 'async'],
  statement: `Design a social feed (Instagram/Facebook-style): users post text/photo/video
updates and see a ranked, near-real-time feed of updates from people they
follow.

**Functional requirements**

- Create a post (text, photo, or video).
- Fetch a user's home feed.
- Like/comment on a post.
- Publishing must never block on delivering the post to every follower.

Media (photos/videos) is a completely different traffic class from the API
calls that create posts and fetch feeds — treat it that way.`,
  scale: `- **20M concurrent users**, **~95:5 read:write** (feed scrolling and profile views vastly outnumber posts/likes)
- **1,000,000 rps** offered load, split across a media-delivery lane and a main API lane
- Availability budget: **99%**
- p99 latency budget: **400ms**
- Cost budget: **$380,000/month** (CDN egress dominates this — expected for a media-heavy platform)`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: 0.05,
    readWriteRatio: 0.95,
  },
  budgets: {
    availability: 0.99,
    p99Ms: 400,
    costPerMonth: 380_000,
  },
  hints: [
    'Split traffic into two lanes at the very top: media (photos/videos) should never touch your app servers at all — route it through a CDN straight to object storage.',
    'A news feed is fundamentally a read-amplification problem: every cache layer exists purely to keep reads off the database.',
    'Publishing should never block on fanning a post out to every follower\'s feed — that fan-out belongs on a queue, asynchronous to the post-creation request.',
    'Don\'t collapse the durable social-graph/post store and the queue-fed, precomputed feed store into one database — they\'re sized and scaled independently.',
    'A single load balancer node caps out at 200,000 rps in this simulator — at this scale you\'ll need several.',
    'This engine charges CDN cost based on rps actually served, not just rps that misses the cache — at media-serving scale, that line item is expected to dominate your budget.',
  ],
  rubric: [
    {
      id: 'has-cdn',
      label: 'Has a CDN for media',
      points: 8,
      check: { type: 'has-kind', kind: 'cdn', min: 1 },
      why: 'Photo/video reads should bypass the app tier entirely — a CDN absorbs that traffic class before it can ever compete with API traffic for capacity.',
      failHint: 'Add a CDN node fed directly from Users, separate from the main API path.',
    },
    {
      id: 'has-lb-3',
      label: 'At least 3 load balancers',
      points: 10,
      check: { type: 'has-kind', kind: 'loadbalancer', min: 3 },
      why: 'A single load balancer node is hard-capped at 200,000 rps in this engine — the main API lane alone offers far more than that, so one (or even two) would already be overloaded.',
      failHint: 'Add more Load Balancer nodes until their combined capacity clears the main API lane\'s offered load with headroom.',
    },
    {
      id: 'has-database-2',
      label: 'At least 2 distinct databases',
      points: 10,
      check: { type: 'has-kind', kind: 'database', min: 2 },
      why: 'The durable social-graph/post store and the queue-fed, precomputed feed store are different traffic classes with different scaling needs — collapsing them into one database understates the fan-out problem.',
      failHint: 'Add a second Database node — one for the social graph/post store, one as the feed store the queue writes into.',
    },
    {
      id: 'path-users-queue',
      label: 'The write path reaches an async queue',
      points: 10,
      check: { type: 'path', from: 'users', to: 'queue' },
      why: 'Publishing a post must never block on delivering it to every follower — fan-out into precomputed per-user feeds happens asynchronously via a queue, not synchronously on the request path.',
      failHint: 'Wire your app server\'s write path through a Queue node before it reaches the feed-store database.',
    },
    {
      id: 'direct-edge-queue-database',
      label: 'The queue writes into the feed store',
      points: 12,
      check: { type: 'direct-edge', from: 'queue', to: 'database' },
      why: 'The queue is what actually performs the fan-out write into each follower\'s precomputed feed — without this edge, the async pipeline has nowhere to land.',
      failHint: 'Connect the Queue node directly to a Database node (the feed store).',
    },
    {
      id: 'cache-hit-ratio',
      label: 'Cache hit ratio >= 95%',
      points: 12,
      check: { type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0.95 },
      why: 'A news feed is a read-amplification problem — the object/feed cache is what keeps the vast majority of reads off the social-graph database. Any erosion in hit ratio multiplies straight through to database load.',
      failHint: 'Raise the cache\'s hit ratio to at least 95% — this workload is read-heavy enough to justify it.',
    },
    {
      id: 'config-queue-workers',
      label: 'Queue sized for fan-out volume',
      points: 10,
      check: { type: 'config', kind: 'queue', key: 'workers', op: 'gte', value: 300 },
      why: 'The queue has to drain the write volume from every post being fanned out to followers\' feeds — under-provisioning worker count means a growing, undelivered backlog.',
      failHint: 'Raise the Queue node\'s worker count so drain rate (workers x jobs/worker) comfortably clears the write-side fan-out load.',
    },
    {
      id: 'sim-availability',
      label: 'Availability >= 99%',
      points: 10,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.99 },
      why: 'At this scale, a healthy feed platform means almost every request — post, fetch, like — actually succeeds, even with a huge fan-out pipeline running underneath it.',
      failHint: 'Check for overloaded nodes — a saturated load balancer, server tier, or database shard is dropping requests somewhere.',
    },
    {
      id: 'sim-p99',
      label: 'p99 latency <= 400ms',
      points: 10,
      check: { type: 'sim', metric: 'p99Ms', op: 'lte', value: 400 },
      why: 'Feed-read latency is what users actually feel while scrolling — the async fan-out pipeline is explicitly allowed to lag behind, but the read path itself needs to stay fast.',
      failHint: 'Look for a hot node on the read path (cache, database, or app-server tier) and add capacity or headroom there.',
    },
    {
      id: 'sim-cost',
      label: 'Cost <= $380,000/month',
      points: 8,
      check: { type: 'sim', metric: 'costPerMonth', op: 'lte', value: 380_000 },
      why: 'CDN cost in this engine scales linearly with served throughput, not configured size — at social-media media-serving scale this genuinely dominates the budget, mirroring how CDN/egress dominates real infrastructure spend for image/video-heavy platforms. That\'s expected here, not a red flag.',
      failHint: 'The CDN line item is mostly fixed by served traffic — look at over-provisioned server instances, queue workers, or database shards instead.',
    },
  ],
  solution: {
    nodes: [
      { id: 'users-1', kind: 'users', label: 'Users', config: { users: TARGET_USERS } },
      { id: 'cdn-1', kind: 'cdn', label: 'Media CDN', config: { hitRatio: 0.93, capacityRps: 5_000_000 } },
      { id: 'storage-1', kind: 'storage', label: 'Media Storage', config: {} },
      { id: 'rl-1', kind: 'ratelimiter', label: 'Rate Limiter', config: { limitRps: 550_000 } },
      { id: 'lb-1', kind: 'loadbalancer', label: 'Load Balancer 1', config: { algorithm: 'least-connections' } },
      { id: 'lb-2', kind: 'loadbalancer', label: 'Load Balancer 2', config: { algorithm: 'least-connections' } },
      { id: 'lb-3', kind: 'loadbalancer', label: 'Load Balancer 3', config: { algorithm: 'least-connections' } },
      { id: 'lb-4', kind: 'loadbalancer', label: 'Load Balancer 4', config: { algorithm: 'least-connections' } },
      {
        id: 'server-1',
        kind: 'server',
        label: 'App Servers',
        config: { autoscale: 'on', minInstances: 250, maxInstances: 450, targetUtilization: 0.6, rpsPerInstance: 2_000 },
      },
      { id: 'cache-1', kind: 'cache', label: 'Feed/Object Cache', config: { hitRatio: 0.99, capacityRps: 800_000 } },
      { id: 'queue-1', kind: 'queue', label: 'Fan-out Queue', config: { workers: 400, jobsPerWorkerRps: 130, mode: 'queue' } },
      { id: 'database-1', kind: 'database', label: 'Social Graph / Post Store', config: { shards: 2, readReplicas: 0, maxConnections: 800 } },
      { id: 'database-2', kind: 'database', label: 'Feed Store', config: { shards: 10, readReplicas: 1, maxConnections: 2_500 } },
    ],
    edges: [
      { id: 'e-users-cdn', source: 'users-1', target: 'cdn-1' },
      { id: 'e-users-rl', source: 'users-1', target: 'rl-1' },
      { id: 'e-cdn-storage', source: 'cdn-1', target: 'storage-1' },
      { id: 'e-rl-lb1', source: 'rl-1', target: 'lb-1' },
      { id: 'e-rl-lb2', source: 'rl-1', target: 'lb-2' },
      { id: 'e-rl-lb3', source: 'rl-1', target: 'lb-3' },
      { id: 'e-rl-lb4', source: 'rl-1', target: 'lb-4' },
      { id: 'e-lb1-server', source: 'lb-1', target: 'server-1' },
      { id: 'e-lb2-server', source: 'lb-2', target: 'server-1' },
      { id: 'e-lb3-server', source: 'lb-3', target: 'server-1' },
      { id: 'e-lb4-server', source: 'lb-4', target: 'server-1' },
      { id: 'e-server-cache', source: 'server-1', target: 'cache-1' },
      { id: 'e-server-queue', source: 'server-1', target: 'queue-1' },
      { id: 'e-queue-database2', source: 'queue-1', target: 'database-2' },
      { id: 'e-cache-database1', source: 'cache-1', target: 'database-1' },
    ],
    positions: {
      'users-1': { x: 20, y: 340 },
      'cdn-1': { x: 240, y: 120 },
      'storage-1': { x: 460, y: 120 },
      'rl-1': { x: 240, y: 460 },
      'lb-1': { x: 460, y: 300 },
      'lb-2': { x: 460, y: 400 },
      'lb-3': { x: 460, y: 500 },
      'lb-4': { x: 460, y: 600 },
      'server-1': { x: 700, y: 450 },
      'cache-1': { x: 920, y: 340 },
      'queue-1': { x: 920, y: 560 },
      'database-1': { x: 1140, y: 340 },
      'database-2': { x: 1140, y: 560 },
    },
    writeup: `**Requirements.** Create post, fetch home feed, like/comment — with the
platform staying healthy at scale and publishing never blocking on
delivering a post to every follower.

**Capacity estimate.** 20M users at 0.05 rps/user with a 95:5 read:write
split gives 1,000,000 rps offered. This simulator's \`users\` node fans out
evenly across its outgoing edges — a structural limitation, not a design
choice — so splitting traffic into a media lane and a main API lane means
each lane gets exactly 500,000 rps of the same 95:5 mix, rather than the
real ~95/5 media-dominant skew. Size the input for double the desired
per-lane load to compensate, which is exactly what this graph's \`users\`
config does.

**Design decisions.** The media lane bypasses the app tier completely: a CDN
in front of object storage handles photo/video reads directly, since routing
video bytes through app servers would massively over-provision a tier for
work it should never see. The main API lane runs behind a rate limiter (a
safety net above its 500,000 rps lane) and **4** load balancers — a single
LB's 200,000 rps cap means at least 3 are structurally required at this
scale, and a 4th keeps per-node utilization comfortable rather than
borderline. An autoscaled server fleet reads through a cache (Memcached-style,
sitting in front of the social-graph/post store) and writes through a queue:
publishing a post enqueues the fan-out work and returns immediately, rather
than blocking on writing to every follower's feed synchronously. The queue
drains into a **separate, independently-scaled feed store** — collapsing it
into the same database as the social graph would understate the fan-out
problem and couple two very different traffic classes together.

**Bottleneck walk.** At target load, each load balancer runs at ~62%
utilization, the autoscaled server fleet settles at its ~60% target (417
instances), the cache absorbs 99% of reads (leaving the social-graph
database at under 30% read utilization), and the queue/feed-store pair both
run at ~55-65% — comfortably clear of their ceilings. The CDN's own
utilization is trivially low (its capacity dwarfs demand), but its **cost**
is a different story: this engine charges CDN cost on served throughput,
not configured size, so at 500,000 rps served, the media lane alone costs
roughly $250k/month — the dominant line item in this design's ~$306k total,
exactly mirroring how CDN/egress dominates real infrastructure spend for a
media-heavy platform. That's an expected trade-off to name out loud in an
interview, not a design flaw to fix.

Sharding the post/graph store lets any app server route directly to the
right shard (Instagram famously encodes the shard id inside the photo id
itself) — as much about avoiding a coordination bottleneck as raw capacity.
Celebrity/huge-follower-count accounts, which need a different, pull-based
read path in the real system, are a well-known follow-up this simplified
graph doesn't model.`,
    keyInsights: [
      'A news feed is a read-amplification problem — CDN and cache exist purely to keep reads off the database; any erosion in hit ratio multiplies straight through.',
      'Publishing never blocks on fan-out — writes go through a queue, which is exactly why celebrity accounts need a different pull-based read path in the real system.',
      'Keep the durable social-graph/post store and the queue-fed feed store as separate, independently-scaled databases.',
      'A single load balancer\'s 200,000 rps cap is the first thing to give out at this scale — this dossier needs several.',
      'CDN cost scales with served throughput in this engine, not configured size — at media-serving scale it dominates the budget by design.',
    ],
    sources: [
      { label: 'Alex Xu — System Design Interview Vol. 1, ch. 11 ("Design A News Feed System")', url: 'https://www.amazon.com/dp/B08CMF2CQF' },
      { label: 'HelloInterview — Problem Breakdowns (Instagram, FB News Feed)', url: 'https://www.hellointerview.com/learn/system-design/problem-breakdowns/overview' },
      { label: 'Grokking the System Design Interview curriculum', url: 'https://www.grokkingsystemdesign.com/curriculum' },
    ],
  },
};
