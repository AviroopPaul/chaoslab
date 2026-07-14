// Sourced from docs/research/common-questions.md §5 "Video Streaming". Tuned
// against the real engine (src/lib/sim/engine.ts) — see the temporary
// tuning test used during authoring; the config below is what actually
// clears its own rubric at 100/100 and simulates HEALTHY at targetLoad.

import type { Question } from '../types';

const TARGET_USERS = 30_000_000;
const RPS_PER_USER = 0.02; // 30M * 0.02 = 600,000 rps offered

export const videoStreaming: Question = {
  id: 'video-streaming',
  title: 'Design a Video Streaming Platform',
  difficulty: 'hard',
  tags: ['CDN economics', 'async pipeline', 'fan-out'],
  statement: `Design a video platform in the shape of YouTube/Netflix: users
upload videos (which must be transcoded into multiple resolutions before
being watchable), browse metadata, and stream video.

**Functional requirements**

- \`POST /videos\` — upload a video for processing.
- \`GET /videos/:id\` — fetch metadata (views/likes/comments).
- \`GET /videos/:id/stream\` — stream the video bytes.
- View traffic vastly exceeds uploads.

**Scope note**

The actual video-byte delivery path is dominated by CDN capacity, not
app-server logic — model it as a **direct CDN-to-origin-storage lane that
bypasses the app tier entirely**. Video bytes should never consume API-server
capacity.`,
  scale: `- **200M DAU**
- **~98% reads / 2% writes** — views vastly exceed uploads
- Target load: **600,000 rps offered**, split by this simulator's users
  fan-out into a 300,000 rps video-byte lane and a 300,000 rps
  metadata/control-plane lane
- Availability budget: **99%**
- p99 latency budget: **250ms** (metadata calls, not the video stream itself)
- Cost budget: **$230,000/month** (CDN's linear served-RPS cost dominates —
  expected for a video platform, not a design flaw)`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: RPS_PER_USER,
    readWriteRatio: 0.98,
  },
  budgets: {
    availability: 0.99,
    p99Ms: 250,
    costPerMonth: 230_000,
  },
  hints: [
    'Video bytes and control-plane metadata are fundamentally different traffic classes — route video straight from Users to a CDN in front of origin storage, never through the app-server tier.',
    'Upload processing (transcoding into multiple resolutions) is asynchronous and queue-driven — the upload "succeeds" once durably enqueued, not once every rendition finishes encoding.',
    'This engine charges CDN cost on *served* RPS at $0.5/rps/month — a high hit ratio matters, but the traffic volume itself is what dominates the bill, and that is expected, not a design flaw.',
    'A single load balancer\'s 200,000 rps cap is below this metadata lane\'s 300,000 rps target — you need at least two.',
    'Metadata (view counts, comments) is cache-friendly and read-heavy, but the write side there is dominated by async transcoding-completion events, not direct user writes.',
  ],
  rubric: [
    {
      id: 'edge-users-cdn',
      label: 'Users connect directly to a CDN',
      points: 14,
      check: { type: 'direct-edge', from: 'users', to: 'cdn' },
      why: 'Video bytes should bypass the app-server tier entirely — routing them through a CDN straight to origin storage keeps the API-server fleet sized for control-plane traffic only, not for serving petabytes of video.',
      failHint: 'Add a CDN node with a direct edge from Users — do not route video traffic through your app servers.',
    },
    {
      id: 'edge-cdn-storage',
      label: 'CDN feeds origin storage',
      points: 10,
      check: { type: 'direct-edge', from: 'cdn', to: 'storage' },
      why: 'CDN misses (and uploads) still need somewhere durable to land — a CDN with nothing behind it drops that traffic.',
      failHint: 'Connect your CDN node to a Storage node for cache misses and origin fetches.',
    },
    {
      id: 'has-ratelimiter',
      label: 'Metadata lane is protected by a rate limiter',
      points: 8,
      check: { type: 'has-kind', kind: 'ratelimiter', min: 1 },
      why: 'The control-plane lane needs a safety net sized above sustained demand, independent of the CDN lane, so a spike in metadata calls cannot cascade into the app-server tier.',
      failHint: 'Add a Rate Limiter node in front of the metadata/control-plane load balancer.',
    },
    {
      id: 'lb-count',
      label: 'At least 2 load balancers on the metadata lane',
      points: 10,
      check: { type: 'has-kind', kind: 'loadbalancer', min: 2 },
      why: 'A single load balancer node caps out at 200,000 rps — the metadata lane alone offers 300,000 rps at this scale, so a single LB is a guaranteed bottleneck.',
      failHint: 'Add a second Load Balancer node — one is not enough for this lane\'s throughput.',
    },
    {
      id: 'edge-server-queue',
      label: 'Uploads go through an async transcoding queue',
      points: 12,
      check: { type: 'direct-edge', from: 'server', to: 'queue' },
      why: 'Transcoding a video into multiple resolutions can take minutes — the upload response cannot block on that. A queue lets "upload accepted" return immediately while transcoding happens asynchronously.',
      failHint: 'Connect your Server node to a Queue node so uploads are processed asynchronously.',
    },
    {
      id: 'cdn-hit-ratio',
      label: 'CDN hit ratio >= 90%',
      points: 10,
      check: { type: 'config', kind: 'cdn', key: 'hitRatio', op: 'gte', value: 0.9 },
      why: 'CDN hit ratio is existential at this scale — with this engine\'s linear served-RPS cost model, a lower hit ratio doesn\'t just add latency, it raises the served-throughput cost line directly.',
      failHint: 'Raise the CDN hit ratio to at least 90% in the inspector panel.',
    },
    {
      id: 'db-shards',
      label: 'Metadata store is sharded (>= 2 shards)',
      points: 8,
      check: { type: 'config', kind: 'database', key: 'shards', op: 'gte', value: 2 },
      why: 'The metadata store is fed by both cache-miss reads and transcoding-completion writes — a single shard is a single point of contention at 200M DAU scale.',
      failHint: 'Increase the metadata database\'s shard count — and raise maxConnections alongside it, since the connection pool (maxConnections x 1000/12ms) caps combined throughput independent of shard count and can silently cancel out extra shards.',
    },
    {
      id: 'sim-availability',
      label: `Availability >= ${(0.99 * 100).toFixed(0)}%`,
      points: 12,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.99 },
      why: 'A video platform where the metadata/control-plane lane drops requests looks broken even if the video itself keeps streaming.',
      failHint: 'Check the Results tab for overloaded nodes on the metadata lane and add capacity there.',
    },
    {
      id: 'sim-no-overload',
      label: 'No node is overloaded',
      points: 8,
      check: { type: 'sim', metric: 'no-overloaded-nodes', op: 'eq', value: true },
      why: 'An overloaded node is actively dropping requests right now, whether that\'s the CDN, a load balancer, or the app-server tier.',
      failHint: 'Find the red/orange node in the canvas and give it more capacity.',
    },
    {
      id: 'sim-cost',
      label: 'Cost <= $230,000/month',
      points: 8,
      check: { type: 'sim', metric: 'costPerMonth', op: 'lte', value: 230_000 },
      why: 'CDN cost dominates this budget by design at video-streaming scale — but the rest of the graph (servers, queue, database) should still be sized efficiently on top of that.',
      failHint: 'Trim over-provisioned app-server/queue capacity — the CDN line item is expected to dominate, the rest should not add much on top.',
    },
  ],
  solution: {
    nodes: [
      { id: 'users-1', kind: 'users', label: 'Users', config: { users: TARGET_USERS } },
      { id: 'cdn-1', kind: 'cdn', label: 'Video CDN', config: { hitRatio: 0.95, capacityRps: 10_000_000 } },
      { id: 'storage-1', kind: 'storage', label: 'Origin Storage', config: {} },
      { id: 'rl-1', kind: 'ratelimiter', label: 'Rate Limiter', config: { limitRps: 340_000 } },
      { id: 'lb-1', kind: 'loadbalancer', label: 'Load Balancer 1', config: { algorithm: 'least-connections' } },
      { id: 'lb-2', kind: 'loadbalancer', label: 'Load Balancer 2', config: { algorithm: 'least-connections' } },
      {
        id: 'server-1',
        kind: 'server',
        label: 'App Servers',
        config: {
          rpsPerInstance: 1000,
          autoscale: 'on',
          minInstances: 400,
          maxInstances: 700,
          targetUtilization: 0.4,
        },
      },
      { id: 'cache-1', kind: 'cache', label: 'Metadata Cache', config: { hitRatio: 0.9, capacityRps: 500_000 } },
      { id: 'queue-1', kind: 'queue', label: 'Transcoding Queue', config: { workers: 100, jobsPerWorkerRps: 100, mode: 'queue' } },
      { id: 'database-1', kind: 'database', label: 'Metadata DB', config: { shards: 3, readReplicas: 1, maxConnections: 800 } },
    ],
    edges: [
      { id: 'e-users-cdn', source: 'users-1', target: 'cdn-1' },
      { id: 'e-users-rl', source: 'users-1', target: 'rl-1' },
      { id: 'e-cdn-storage', source: 'cdn-1', target: 'storage-1' },
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
      'cdn-1': { x: 280, y: 100 },
      'storage-1': { x: 500, y: 100 },
      'rl-1': { x: 280, y: 420 },
      'lb-1': { x: 500, y: 340 },
      'lb-2': { x: 500, y: 500 },
      'server-1': { x: 720, y: 420 },
      'cache-1': { x: 940, y: 320 },
      'queue-1': { x: 940, y: 520 },
      'database-1': { x: 1160, y: 420 },
    },
    writeup: `The signature decision here is the same one ChaosLab's own Netflix
preset makes: **video bytes and control-plane metadata are different
traffic classes**, so they get different lanes. Video streams go
\`Users -> CDN -> Storage\`, bypassing the app-server tier entirely — an
app server should never spend a single cycle serving video bytes.

**Capacity estimation.** 30M users at 0.02 rps/user offers 600,000 rps
total; this engine's users-node fan-out splits that evenly into a 300,000
rps video lane and a 300,000 rps metadata lane. The CDN's capacity (10M rps)
is nowhere near the bottleneck — its *cost*, not its capacity, is the real
constraint, since this engine bills CDN at $0.5 per served rps/month.

**Design decisions.** The metadata lane looks like a standard read-heavy
API: a rate limiter as a safety net, two load balancers (a single LB's
200,000 rps cap is below this lane's 300,000 rps offered load), an
autoscaled app-server fleet at a low (0.4) target utilization for latency
headroom, a metadata cache, and a transcoding queue that lets uploads return
immediately instead of blocking on minutes of encoding work. The metadata
database is fed by both cache-miss reads and transcoding-completion writes
from the queue.

**Bottleneck walk.** At target load the CDN sits at ~3% utilization (it is
essentially never capacity-constrained) while contributing the overwhelming
majority of the ~$212k/month cost — exactly the trade-off this dossier
calls out explicitly. On the metadata lane, the rate limiter runs near its
configured ceiling by design (a safety net, not a bottleneck), the two load
balancers split load evenly, and the app-server/cache/queue/database tier
all stay under 60% utilization, which is what keeps p99 comfortably inside
the 250ms budget despite five hops of queueing latency stacking up.`,
    keyInsights: [
      'Video bytes should bypass the app-server tier entirely via a direct users -> CDN -> storage lane — never route them through application logic.',
      'Upload processing (transcoding) is asynchronous and queue-driven — "upload accepted" happens the instant it\'s durably enqueued, not once every resolution finishes encoding.',
      'CDN cost in this engine scales linearly with served RPS, not configured size — at streaming scale this dominates the budget by design, a real trade-off to discuss rather than a red flag.',
      'A single load balancer\'s fixed 200,000 rps cap is the first thing to give out at this scale on the metadata lane — at least two are required.',
      'Metadata (views/likes/comments) is cache-friendly and read-heavy, but its write side is dominated by async transcoding-completion events, not direct user writes.',
    ],
    sources: [
      { label: 'Netflix TechBlog — Content Distribution through Open Connect', url: 'https://blog.apnic.net/2018/06/20/netflix-content-distribution-through-open-connect/' },
      { label: 'Netflix TechBlog — Announcing EVCache', url: 'https://netflixtechblog.com/announcing-evcache-distributed-in-memory-datastore-for-cloud-c26a698c27f7' },
    ],
  },
};
