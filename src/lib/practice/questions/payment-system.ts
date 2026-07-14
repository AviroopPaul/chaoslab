// Sourced from docs/research/common-questions.md §12 "Payment Processing
// System". Tuned against the real engine (src/lib/sim/engine.ts) — see the
// temporary tuning test used during authoring; the config below is what
// actually clears its own rubric at 100/100 and simulates HEALTHY at
// targetLoad.

import type { Question } from '../types';

const TARGET_USERS = 2_000_000;
const RPS_PER_USER = 0.01; // 2M * 0.01 = 20,000 rps offered

export const paymentSystem: Question = {
  id: 'payment-system',
  title: 'Design a Payment Processing System',
  difficulty: 'hard',
  tags: ['idempotency', 'consistency', 'ledger design'],
  statement: `Design a payment processing backend: charge a card, debit a
wallet, or transfer funds between accounts, integrating with external
payment providers (card networks, banks).

**Functional requirements**

- \`POST /charge\` — charge a card/wallet, carrying a client-generated
  idempotency key.
- \`GET /balance\`, \`GET /transactions\` — balance checks, transaction
  history, receipts.
- Guarantee **exactly-once** semantics (no double charges, no lost
  payments) even under client or network retries.
- Maintain a durable, auditable double-entry ledger, reconciling
  asynchronously with providers via webhooks.`,
  scale: `- **50M DAU**, ~230 tps average, designed for a **10x peak**
  (Black-Friday-class) of ~2,300 tps
- **85% reads / 15% writes** — balance checks/history/receipts numerically
  dominate actual money-movement writes
- Target load: **20,000 rps** total
- Availability budget: **99.9%** — the strictest in this whole set; money
  can't be "mostly available"
- p99 latency budget: **250ms** (user-facing charge confirmation)
- Cost budget: **$8,000/month** — a deliberately modest scale reflecting a
  "correctness over raw throughput" framing`,
  targetLoad: {
    users: TARGET_USERS,
    rpsPerUser: RPS_PER_USER,
    readWriteRatio: 0.85,
  },
  budgets: {
    availability: 0.999,
    p99Ms: 250,
    costPerMonth: 8_000,
  },
  hints: [
    'Idempotency is the single most important correctness property here — every payment request carries a client-generated idempotency key, checked (via a fast cache) before any ledger write, so retries never cause a double charge.',
    'The ledger should be double-entry (every money movement is a debit+credit pair) — this is the one component in the whole design that should be graded more on consistency/durability posture than on raw throughput headroom.',
    'Settlement with external providers is asynchronous — tell the user "payment accepted" the instant your own ledger write succeeds, then reconcile via a queue and the provider\'s webhook afterward. Blocking on an external round-trip is an availability risk you don\'t need to take.',
    'Retry storms are a first-class failure mode: a client or flaky network retries an already-successful charge. This is why the database connection pool should be sized well above the bare Little\'s-Law minimum, and why a circuit breaker (fail fast instead of retry-amplifying) belongs on the server.',
    'Read traffic (balance checks, history, receipts) is a different, far higher-volume, far more cache-friendly traffic class than the actual money-movement writes — don\'t let read-path caching reasoning leak into how you reason about the strongly-consistent write path.',
  ],
  rubric: [
    {
      id: 'has-ratelimiter',
      label: 'Has a velocity/fraud rate limiter',
      points: 8,
      check: { type: 'has-kind', kind: 'ratelimiter', min: 1 },
      why: 'A per-account transaction-velocity/fraud safety net protects the system independent of overall load — a modest limiter relative to load, not a primary defense.',
      failHint: 'Add a Rate Limiter node in front of the load balancer as a velocity/fraud safety net.',
    },
    {
      id: 'edge-server-cache',
      label: 'Idempotency-key dedup check sits before the ledger write',
      points: 12,
      check: { type: 'direct-edge', from: 'server', to: 'cache' },
      why: 'Idempotency is the single most important correctness property in this whole domain: every payment request must be checked against a dedup cache *before* any ledger write, so retries — from the client or your own retrying servers — never cause a double charge.',
      failHint: 'Connect your Server node to a Cache node for the idempotency-key dedup check on the write path.',
    },
    {
      id: 'edge-server-queue',
      label: 'Settlement is async, not inline with the ledger write',
      points: 8,
      check: { type: 'direct-edge', from: 'server', to: 'queue' },
      why: 'Settlement with external providers is inherently asynchronous — tell the user "payment accepted" the instant your own ledger write succeeds, then reconcile via the provider\'s webhook afterward through a queue, rather than blocking the user-facing response on an external round-trip.',
      failHint: 'Connect your Server node to a Queue node for async settlement/reconciliation.',
    },
    {
      id: 'edge-queue-database',
      label: 'Queue feeds the durable ledger',
      points: 8,
      check: { type: 'direct-edge', from: 'queue', to: 'database' },
      why: 'Settlement/reconciliation events need to land durably in the double-entry ledger — the system of record for every money movement.',
      failHint: 'Connect your Queue node to a Database node.',
    },
    {
      id: 'db-read-replica',
      label: 'Ledger has at least one read replica',
      points: 8,
      check: { type: 'config', kind: 'database', key: 'readReplicas', op: 'gte', value: 1 },
      why: 'The ledger is the one component here that should be graded more on durability/read-scaling posture than on raw throughput headroom — a read replica keeps balance/history reads from contending with money-movement writes.',
      failHint: 'Add at least one read replica to the ledger database.',
    },
    {
      id: 'db-shards',
      label: 'Ledger is sharded (>= 2 shards)',
      points: 6,
      check: { type: 'config', kind: 'database', key: 'shards', op: 'gte', value: 2 },
      why: 'Even at this deliberately modest scale, a single-shard ledger is a single point of contention for every money-movement write in the system.',
      failHint: 'Increase the ledger database\'s shard count to at least 2 — and check maxConnections too, since the connection pool (maxConnections x 1000/12ms) caps combined throughput independent of shard count.',
    },
    {
      id: 'db-pool-headroom',
      label: 'Connection pool is generously over-provisioned (>= 1,500)',
      points: 12,
      check: { type: 'config', kind: 'database', key: 'maxConnections', op: 'gte', value: 1_500 },
      why: 'Retry storms are a first-class failure mode in payments: a client or flaky network retries an already-successful charge, and idempotent-but-retried requests still consume connections. Sizing the pool at the bare average-load minimum ignores exactly the burst/retry-storm case where things are already going wrong — reward headroom here, don\'t penalize it.',
      failHint: 'Raise the database\'s max connections well above the bare minimum needed for average load — payment systems see retry amplification precisely when things are already going wrong.',
    },
    {
      id: 'server-circuit-breaker',
      label: 'Circuit breaker is on',
      points: 10,
      check: { type: 'config', kind: 'server', key: 'circuitBreaker', op: 'eq', value: 'on' },
      why: 'Retry storms amplify load onto an already-struggling downstream dependency. A circuit breaker fails fast instead of piling on, which matters more in payments than almost anywhere else — a struggling provider or ledger shouldn\'t be made worse by blind retries.',
      failHint: 'Turn the app server\'s circuit breaker on — fail fast against a struggling downstream instead of retry-amplifying it.',
    },
    {
      id: 'sim-availability',
      label: `Availability >= ${(0.999 * 100).toFixed(1)}%`,
      points: 18,
      check: { type: 'sim', metric: 'availability', op: 'gte', value: 0.999 },
      why: 'This is the strictest availability bar in this whole question set — money can\'t be "mostly available." Every dropped request here is a payment that silently failed.',
      failHint: 'Check for overloaded nodes anywhere on the path — at this budget, even a small amount of dropped traffic fails this check.',
    },
    {
      id: 'sim-p99',
      label: 'p99 latency <= 250ms',
      points: 10,
      check: { type: 'sim', metric: 'p99Ms', op: 'lte', value: 250 },
      why: 'A slow charge-confirmation response feels broken to a user even when the payment eventually succeeds correctly.',
      failHint: 'Lower autoscaler target utilization or add capacity to whichever node has the highest utilization.',
    },
  ],
  solution: {
    nodes: [
      { id: 'users-1', kind: 'users', label: 'Users', config: { users: TARGET_USERS } },
      { id: 'rl-1', kind: 'ratelimiter', label: 'Velocity/Fraud Limiter', config: { limitRps: 19_000 } },
      { id: 'lb-1', kind: 'loadbalancer', label: 'Load Balancer', config: { algorithm: 'round-robin' } },
      {
        id: 'server-1',
        kind: 'server',
        label: 'Payment Servers',
        config: {
          rpsPerInstance: 1000,
          autoscale: 'on',
          minInstances: 30,
          maxInstances: 100,
          targetUtilization: 0.45,
          circuitBreaker: 'on',
        },
      },
      { id: 'cache-1', kind: 'cache', label: 'Idempotency Cache', config: { hitRatio: 0.8, capacityRps: 300_000 } },
      { id: 'queue-1', kind: 'queue', label: 'Settlement Queue', config: { workers: 50, jobsPerWorkerRps: 100, mode: 'queue' } },
      { id: 'database-1', kind: 'database', label: 'Ledger', config: { shards: 2, readReplicas: 1, maxConnections: 2_000 } },
    ],
    edges: [
      { id: 'e-users-rl', source: 'users-1', target: 'rl-1' },
      { id: 'e-rl-lb', source: 'rl-1', target: 'lb-1' },
      { id: 'e-lb-server', source: 'lb-1', target: 'server-1' },
      { id: 'e-server-cache', source: 'server-1', target: 'cache-1' },
      { id: 'e-server-queue', source: 'server-1', target: 'queue-1' },
      { id: 'e-cache-database', source: 'cache-1', target: 'database-1' },
      { id: 'e-queue-database', source: 'queue-1', target: 'database-1' },
    ],
    positions: {
      'users-1': { x: 60, y: 220 },
      'rl-1': { x: 280, y: 220 },
      'lb-1': { x: 500, y: 220 },
      'server-1': { x: 720, y: 220 },
      'cache-1': { x: 940, y: 100 },
      'queue-1': { x: 940, y: 340 },
      'database-1': { x: 1160, y: 220 },
    },
    writeup: `Payments is the one dossier in this whole set graded **more on
correctness posture than on raw throughput** — the design should favor
more shards/connections/replicas than strictly required by load, not fewer.

**Capacity estimation.** 50M DAU at ~230 tps average, designed for a 10x
Black-Friday-class peak, targets 20,000 rps total at an 85:15 read:write
split. That's a deliberately modest absolute scale — the difficulty here is
consistency, not throughput.

**Design decisions.** A velocity/fraud rate limiter sits in front of the
fleet as a safety net, sized just above sustained load. Every payment
request hits an **idempotency-key dedup cache before the ledger write** —
this is the single most important correctness property in the whole
design, since it's what makes client and server retries safe rather than
double-charging. The ledger write itself never blocks on the external
provider: settlement/reconciliation flows through an async queue, so
"payment accepted" only depends on your own ledger write succeeding. The
double-entry ledger is sharded and replicated, and its **connection pool is
deliberately over-provisioned well beyond the bare Little's-Law minimum** —
retry storms consume connections even when they correctly resolve to a
no-op, and that's exactly the case this headroom protects against. The
payment server's circuit breaker is on, so a struggling downstream
dependency gets failed fast instead of retry-amplified into a worse outage.

**Bottleneck walk.** At target load the app-server tier sits at ~44%
utilization, the idempotency cache barely registers, the settlement queue
drains at ~57% of its rate, and the ledger sits at ~36% write utilization
with a connection pool sized at roughly 4x the bare combined read+write
capacity — nowhere close to being the binding constraint. Every node stays
comfortably under 60%, which is exactly why availability holds at the
strictest bar in this whole set and p99 clears the 250ms charge-
confirmation budget with real margin.`,
    keyInsights: [
      'Idempotency is the single most important correctness property — every payment request is checked against a dedup cache before any ledger write, so retries never cause a double charge.',
      'The ledger should be double-entry and is the one component here to grade more on consistency/durability posture than on raw throughput headroom.',
      'Settlement with external providers is asynchronous — "payment accepted" depends only on your own ledger write succeeding, never on blocking for an external round-trip.',
      'Retry storms are a first-class failure mode: size the database connection pool well above the bare Little\'s-Law minimum, since idempotent-but-retried requests still consume connections and capacity.',
      'Read traffic (balance/history/receipts) is a different, far more cache-friendly traffic class than money-movement writes — don\'t let read-path caching reasoning leak into the strongly-consistent write path.',
    ],
    sources: [
      { label: 'Alex Xu, System Design Interview Vol. 2, ch. 11 — Payment System', url: 'https://www.amazon.com/dp/1736049119' },
      { label: 'Alex Xu, System Design Interview Vol. 2, ch. 12 — Digital Wallet', url: 'https://www.amazon.com/dp/1736049119' },
    ],
  },
};
