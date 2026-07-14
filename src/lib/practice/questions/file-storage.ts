// Research-driven authoring pass — see docs/research/common-questions.md §8
// (File Storage / Cloud Drive) for the dossier this question is built from.
// One deliberate extension beyond the base dossier: a CDN-fronted public
// share-link/thumbnail download lane (mirroring the CDN-bypass pattern used
// in the news-feed and video-streaming dossiers), since a real Dropbox/Drive
// serves public links and previews at the edge rather than through the app
// tier — see the writeup's "Simplifications" note for the cost trade-off
// this adds relative to the base dossier's non-CDN numbers.

import type { Question } from '../types';

const TARGET_USERS = 16_000_000;

export const fileStorage: Question = {
  id: 'file-storage',
  title: 'Design a Cloud File Storage (Dropbox-style)',
  difficulty: 'medium',
  tags: ['object storage', 'chunking/dedup', 'async processing'],
  statement: `Design a cloud file storage/sync service (Dropbox/Google Drive-class):
upload, download, and list files and folders; sync changes across a user's
devices; support large files via chunking and dedup identical content;
share files/folders with permissions.

**Functional requirements**

- Upload and download files; list files/folders.
- Chunk large files and dedup identical content across users.
- Serve publicly shared links/previews without routing that traffic through
  your app tier at all.
- Process uploads (hashing, virus-scan, thumbnailing) asynchronously — the
  client shouldn't block on all of that finishing.`,
  scale: `- **50M DAU**
- **~80:20 read:write** — downloads/listings vs. uploads/modifications
- **160,000 rps** offered load, split across a public-download (CDN) lane and a main API lane
- Availability budget: **99%**
- p99 latency budget: **300ms**
- Cost budget: **$75,000/month** (the public-download CDN lane dominates this — expected)`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: 0.01,
    readWriteRatio: 0.8,
  },
  budgets: {
    availability: 0.99,
    p99Ms: 300,
    costPerMonth: 75_000,
  },
  hints: [
    'Split the control plane (metadata, permissions — small, cacheable) from the data plane (file bytes — huge, rarely re-read) — they belong on completely different tiers.',
    'Public share-link downloads and thumbnails shouldn\'t route through your app servers at all — put a CDN in front of object storage for that traffic.',
    'Upload processing (hashing, virus-scan, thumbnailing) is asynchronous — the client\'s "upload complete" shouldn\'t block on all of that finishing. That work belongs on a queue that lands in object storage once done.',
    'Content-addressable, chunked storage (hash each chunk, store once, reference many times) gives free dedup across users — but this simulator only models the throughput/cost side of that, not the data-modeling details.',
    'A modest fraction of "normal" reads through your app servers are actually raw file-byte reads that should go straight to object storage, not through the cache/database.',
  ],
  rubric: [
    {
      id: 'has-cdn',
      label: 'Has a CDN for public downloads',
      points: 8,
      check: { type: 'has-kind', kind: 'cdn', min: 1 },
      why: 'Public share-link downloads and thumbnails are a different traffic class from authenticated API calls — a CDN keeps that volume off the app tier entirely.',
      failHint: 'Add a CDN node fed directly from Users, separate from the main API path.',
    },
    {
      id: 'path-users-server',
      label: 'Main API traffic reaches an app server',
      points: 8,
      check: { type: 'path', from: 'users', to: 'server' },
      why: 'Authenticated operations (upload, list, share) still need to reach application logic through the main API lane, independent of the CDN\'s public-download lane.',
      failHint: 'Wire Users through a load balancer to at least one Server node, separate from the CDN lane.',
    },
    {
      id: 'has-queue',
      label: 'Has an upload-processing queue',
      points: 8,
      check: { type: 'has-kind', kind: 'queue', min: 1 },
      why: 'Hashing, virus-scanning, dedup-checking, and thumbnailing a large upload takes real time — the client\'s "upload complete" shouldn\'t block on all of it finishing synchronously.',
      failHint: 'Add a Queue node for asynchronous upload processing.',
    },
    {
      id: 'has-database',
      label: 'Has a metadata database',
      points: 6,
      check: { type: 'has-kind', kind: 'database', min: 1 },
      why: 'File/folder metadata and permissions need a durable, queryable home, kept separate from the actual file bytes.',
      failHint: 'Add a Database node for file/folder metadata and permissions.',
    },
    {
      id: 'direct-edge-cdn-storage',
      label: 'The CDN feeds object storage directly',
      points: 14,
      check: { type: 'direct-edge', from: 'cdn', to: 'storage' },
      why: 'Public downloads and thumbnails should go straight from the edge to object storage — routing this lane through the app tier would defeat the entire point of fronting it with a CDN.',
      failHint: 'Connect the CDN node directly to an Object Storage node.',
    },
    {
      id: 'direct-edge-queue-storage',
      label: 'The upload-processing queue lands in object storage',
      points: 14,
      check: { type: 'direct-edge', from: 'queue', to: 'storage' },
      why: 'Once hashing/virus-scan/thumbnailing finishes, the processed upload needs to actually land in durable object storage — without this edge, the async pipeline has nowhere to commit its work.',
      failHint: 'Connect the Queue node directly to an Object Storage node.',
    },
    {
      id: 'cache-hit-ratio',
      label: 'Metadata cache hit ratio >= 80%',
      points: 10,
      check: { type: 'config', kind: 'cache', key: 'hitRatio', op: 'gte', value: 0.8 },
      why: 'File/folder metadata and permissions are read far more often than they change — a cache in front of the metadata database absorbs the bulk of listing/browsing traffic.',
      failHint: 'Raise the metadata cache\'s hit ratio to at least 80%.',
    },
    {
      id: 'sim-availability',
      label: 'Availability >= 99%',
      points: 10,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.99 },
      why: 'Uploads, downloads, and listings should all succeed the vast majority of the time, even with an async processing pipeline running underneath.',
      failHint: 'Check for overloaded nodes — a saturated app-server tier or under-provisioned queue/database is the usual culprit.',
    },
    {
      id: 'sim-p99',
      label: 'p99 latency <= 300ms',
      points: 10,
      check: { type: 'sim', metric: 'p99Ms', op: 'lte', value: 300 },
      why: 'Listing and metadata calls are the latency-sensitive part of this system — chunk/upload processing is allowed to lag behind on its own queue, but the interactive path needs to stay responsive.',
      failHint: 'Look for a hot node on the interactive path (app server, cache, or metadata database) and add capacity there.',
    },
    {
      id: 'sim-cost',
      label: 'Cost <= $75,000/month',
      points: 12,
      check: { type: 'sim', metric: 'costPerMonth', op: 'lte', value: 75_000 },
      why: 'This engine charges CDN cost on served throughput — at this scale, the public-download lane is expected to be the dominant cost line, similar to the news-feed and video-streaming dossiers.',
      failHint: 'The CDN line item is mostly fixed by served traffic — look at over-provisioned app-server instances or database shards instead.',
    },
  ],
  solution: {
    nodes: [
      { id: 'users-1', kind: 'users', label: 'Users', config: { users: TARGET_USERS } },
      { id: 'cdn-1', kind: 'cdn', label: 'Public Download CDN', config: { hitRatio: 0.9, capacityRps: 5_000_000 } },
      { id: 'storage-1', kind: 'storage', label: 'Object Storage', config: {} },
      { id: 'lb-1', kind: 'loadbalancer', label: 'Load Balancer', config: { algorithm: 'round-robin' } },
      { id: 'server-1', kind: 'server', label: 'App Servers', config: { instances: 120, rpsPerInstance: 2_000 } },
      { id: 'cache-1', kind: 'cache', label: 'Metadata Cache', config: { hitRatio: 0.85, capacityRps: 300_000 } },
      { id: 'database-1', kind: 'database', label: 'Metadata DB', config: { shards: 2, readReplicas: 1, maxConnections: 600 } },
      { id: 'queue-1', kind: 'queue', label: 'Upload Processing Queue', config: { workers: 250, jobsPerWorkerRps: 200 } },
    ],
    edges: [
      { id: 'e-users-cdn', source: 'users-1', target: 'cdn-1' },
      { id: 'e-users-lb', source: 'users-1', target: 'lb-1' },
      { id: 'e-cdn-storage', source: 'cdn-1', target: 'storage-1' },
      { id: 'e-lb-server', source: 'lb-1', target: 'server-1' },
      { id: 'e-server-cache', source: 'server-1', target: 'cache-1' },
      { id: 'e-server-storage', source: 'server-1', target: 'storage-1' },
      { id: 'e-server-queue', source: 'server-1', target: 'queue-1' },
      { id: 'e-cache-database', source: 'cache-1', target: 'database-1' },
      { id: 'e-queue-storage', source: 'queue-1', target: 'storage-1' },
    ],
    positions: {
      'users-1': { x: 20, y: 300 },
      'cdn-1': { x: 260, y: 100 },
      'lb-1': { x: 260, y: 420 },
      'server-1': { x: 500, y: 420 },
      'cache-1': { x: 720, y: 300 },
      'database-1': { x: 940, y: 300 },
      'queue-1': { x: 720, y: 540 },
      'storage-1': { x: 940, y: 540 },
    },
    writeup: `**Requirements.** Upload/download/list files and folders, chunk and dedup
large files, share with permissions, sync across devices — with public
share-link downloads never touching the app tier.

**Capacity estimate.** 50M DAU with an 80:20 read:write split targets 80,000
rps of main API traffic. This simulator's \`users\` node fans out evenly
across its outgoing edges, so splitting traffic into a public-download CDN
lane and a main API lane means each lane gets exactly half of whatever total
load is configured — a structural limitation, not a design choice (the same
caveat the news-feed and video-streaming dossiers call out). Sizing the
input for double the desired per-lane load (160,000 rps total) gets each
lane the correct 80,000 rps.

**Design decisions.** The **control plane** (metadata, permissions — small,
latency-sensitive, cacheable) is split from the **data plane** (file bytes —
huge, infrequently re-read, durable): public share-link downloads and
thumbnails go straight from a CDN to object storage, mirroring exactly how a
real Dropbox/Drive serves those without spending app-server capacity on them.
This maps directly onto this engine's built-in rule that a slice of a
server's own read traffic auto-routes to object storage too (raw file-byte
reads that happen to arrive through the authenticated API), which is why the
app server has its own direct edge to storage in addition to the CDN lane.
Upload processing — hashing, virus-scan, dedup-check, thumbnailing — runs
async on a queue that commits the finished result to object storage, so a
client's "upload complete" doesn't block on any of that finishing. Metadata
is sharded by \`user_id\`, keeping one user's whole file tree on a single
shard for a fast "list my files" — at the cost of a hot-shard risk for a
small number of very heavy users, the classic sharding-key trade-off.

**Bottleneck walk.** At target load, the CDN lane serves 80,000 rps at a 90%
hit ratio (miss traffic plus writes falling through to storage), the main
API lane's load balancer runs at 40%, the app-server fleet at ~33%, the
metadata cache at ~19%, the metadata database at ~27% read-utilization, and
the upload queue at ~32% (250 workers x 200 jobs/worker/rps = 50,000 rps of
drain against a 16,000 rps write load — well past the 1.2x rule of thumb).
Object storage itself sits under 45% utilization even after absorbing CDN
misses, direct static-asset reads, and processed uploads all at once. As in
the news-feed/video-streaming dossiers, the CDN is this design's dominant
cost line (roughly $40k of the ~$61k total) purely because this engine
charges CDN cost on served throughput — an expected trade-off for a
storage/download-heavy product, not a sign of an inefficient design.

Multi-device sync conflict resolution (a per-file/per-user version vector or
logical clock) is a data-modeling problem this simulator can't express —
named here as an explicit simplification, not a rubric requirement.`,
    keyInsights: [
      'Split the control plane (cacheable metadata) from the data plane (durable file bytes) — they scale completely differently.',
      'Public share-link downloads bypass the app tier entirely via a CDN straight to object storage, the same pattern as the news-feed/video-streaming dossiers.',
      'Upload processing (hashing, virus-scan, thumbnailing) is async — the queue commits the finished result to storage, decoupled from "upload complete".',
      'Shard metadata by user_id for fast "list my files" reads, at the cost of hot-shard risk for a small number of very heavy users.',
      'CDN cost scales with served throughput in this engine — at download-heavy scale it dominates the budget by design, not by accident.',
    ],
    sources: [
      { label: 'Alex Xu — System Design Interview Vol. 2, ch. 9 ("S3-like Object Storage")', url: 'https://www.amazon.com/dp/1736049119' },
      { label: 'HelloInterview — Problem Breakdowns (Dropbox)', url: 'https://www.hellointerview.com/learn/system-design/problem-breakdowns/overview' },
      { label: 'Grokking the System Design Interview curriculum', url: 'https://www.grokkingsystemdesign.com/curriculum' },
    ],
  },
};
