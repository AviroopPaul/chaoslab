import { CATALOG } from './catalog';
import type { GlobalConfig, SimEdge, SimNode } from './types';

/**
 * Educational side-panel content for a preset (additive — optional so the
 * shape change never breaks a preset that doesn't have one yet). Surfaced by
 * the UI as a dismissible glass card when the preset loads (see
 * `components/lab/panels/ExplanationPanel.tsx`).
 */
export interface PresetExplanation {
  /** One line shown directly under the preset name. */
  tagline: string;
  /** 4-6 sentence educational paragraph on the pattern this preset teaches. */
  why: string;
  /** 2-4 one-line experiments the user can try by nudging a knob or the load slider. */
  tryThis: string[];
  /** What the simulation model can't express about the real system — keeps the teaching honest. */
  simplifications?: string;
  /** Citations for real-world architecture facts referenced in `why`. */
  sources?: { label: string; url: string }[];
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  explanation?: PresetExplanation;
  build: () => {
    nodes: SimNode[];
    edges: SimEdge[];
    positions: Record<string, { x: number; y: number }>;
    global: GlobalConfig;
  };
}

/**
 * Six hand-laid-out scenarios (four from SPEC.md §6 plus two real-world
 * case studies), left-to-right traffic flow, ~220px horizontal spacing,
 * parallel tiers stacked vertically. Each preset is tuned against the real
 * `solve()` engine (see engine.test.ts) rather than picked arbitrarily —
 * "Planet Scale" in particular is deliberately balanced to land just inside
 * "healthy" at 100M users and melt down at 500M; "Netflix-Style Streaming"
 * and "Instagram-Style Social Feed" are tuned the same way (see their
 * `explanation.why`/`simplifications` for the real-world sources and the
 * engine limitations that shaped their numbers).
 */
export const PRESETS: Preset[] = [
  {
    id: 'hello-world',
    name: 'Hello World',
    description:
      'The simplest possible backend: users hit a single server, which talks to a single database. A calm 100 users keeps everything comfortably healthy.',
    explanation: {
      tagline: 'The baseline request path — one server, one database, nowhere to hide.',
      why:
        "Every backend, no matter how elaborate, is this shape underneath: a request comes in, a server does some work, a database remembers the result. There's no cache to absorb reads, no load balancer to spread the work, and no redundancy — so this graph's capacity is exactly one server's rps-per-instance and nothing more. That's precisely the point: before reaching for a cache or a fleet of servers, you should be able to say what problem those things are solving. At 100 users this is trivially healthy; the interesting part is watching where it stops being healthy, and why that number is what it is. Every other preset in this lab is this same shape with more load-bearing furniture bolted on.",
      tryThis: [
        "Crank USER LOAD up past ~2,500 users and watch the server tip into 'hot' before the database ever breaks a sweat",
        'Turn on autoscaling on the server (min/max instances) and watch it add capacity automatically as load climbs',
        'Add a second server and a load balancer in front of both — see how far that alone gets you',
      ],
      simplifications:
        'A single dependency chain with no redundancy is a worst-case strawman, not a recommended shape — real single-server backends usually still sit behind at least a reverse proxy.',
    },
    build: () => {
      const users: SimNode = {
        id: 'users-1',
        kind: 'users',
        label: CATALOG.users.name,
        config: { ...CATALOG.users.defaultConfig, users: 100 },
      };
      const server: SimNode = {
        id: 'server-1',
        kind: 'server',
        label: CATALOG.server.name,
        config: { ...CATALOG.server.defaultConfig },
      };
      const database: SimNode = {
        id: 'database-1',
        kind: 'database',
        label: CATALOG.database.name,
        config: { ...CATALOG.database.defaultConfig },
      };

      const nodes: SimNode[] = [users, server, database];
      const edges: SimEdge[] = [
        { id: 'e-users-server', source: users.id, target: server.id },
        { id: 'e-server-database', source: server.id, target: database.id },
      ];
      const positions: Record<string, { x: number; y: number }> = {
        [users.id]: { x: 80, y: 200 },
        [server.id]: { x: 300, y: 200 },
        [database.id]: { x: 520, y: 200 },
      };
      const global: GlobalConfig = {
        users: 100,
        rpsPerUser: 0.1,
        readWriteRatio: 0.9,
      };

      return { nodes, edges, positions, global };
    },
  },

  {
    id: 'classic-3-tier',
    name: 'Classic 3-Tier',
    description:
      'Users hit a load balancer that spreads work across three app servers, a cache soaks up repeat reads, and a single database backs it all. The bread-and-butter architecture — comfortable at 10k users.',
    explanation: {
      tagline: 'Horizontal scaling behind a load balancer — the bread-and-butter production layout.',
      why:
        "This is the shape most production backends actually have: a load balancer in front so no single server is a bottleneck or a single point of failure, several identical app servers behind it, and a cache sitting between the servers and the database so repeat reads never touch disk. Horizontal scaling (more servers) is usually cheaper and safer than vertical scaling (a bigger server) — you can add or remove instances without downtime, and losing one instance doesn't take the whole tier down. The cache is doing real work here too: it's the first lever to reach for once the database starts to strain, because it's far cheaper to serve a hot read from memory than to run it through a full query. Still, everything funnels into one database with no replicas or shards, so that's where this design will eventually hit its ceiling.",
      tryThis: [
        'Push USER LOAD past ~25k and watch the graph slip from healthy into degraded',
        "Drop the cache's hit ratio and watch how much extra load lands on the database",
        "Delete one of the three servers and see the load balancer reroute — then check whether the survivors can absorb the difference",
      ],
      simplifications:
        'No read replicas, CDN, or geographic distribution yet — those show up in "Read-Heavy at Scale". Single database means writes and reads share the exact same ceiling.',
    },
    build: () => {
      const users: SimNode = {
        id: 'users-1',
        kind: 'users',
        label: CATALOG.users.name,
        config: { ...CATALOG.users.defaultConfig, users: 10_000 },
      };
      const lb: SimNode = {
        id: 'lb-1',
        kind: 'loadbalancer',
        label: CATALOG.loadbalancer.name,
        config: { ...CATALOG.loadbalancer.defaultConfig },
      };
      const servers: SimNode[] = [0, 1, 2].map((i) => ({
        id: `server-${i + 1}`,
        kind: 'server',
        label: `${CATALOG.server.name} ${i + 1}`,
        config: { instances: 2, rpsPerInstance: 500 },
      }));
      const cache: SimNode = {
        id: 'cache-1',
        kind: 'cache',
        label: CATALOG.cache.name,
        config: { ...CATALOG.cache.defaultConfig },
      };
      const database: SimNode = {
        id: 'database-1',
        kind: 'database',
        label: CATALOG.database.name,
        config: { ...CATALOG.database.defaultConfig },
      };

      const nodes: SimNode[] = [users, lb, ...servers, cache, database];
      const edges: SimEdge[] = [
        { id: 'e-users-lb', source: users.id, target: lb.id },
        ...servers.map((s, i) => ({ id: `e-lb-server-${i + 1}`, source: lb.id, target: s.id })),
        // Reads route through the cache; writes have no queue here, so each
        // server also gets a direct edge to the database (routeFromServer
        // sends writes to a queue if one exists, else straight to the DB —
        // cache is a read-only path, never a write target).
        ...servers.map((s, i) => ({ id: `e-server-${i + 1}-cache`, source: s.id, target: cache.id })),
        ...servers.map((s, i) => ({ id: `e-server-${i + 1}-database`, source: s.id, target: database.id })),
        { id: 'e-cache-database', source: cache.id, target: database.id },
      ];

      const positions: Record<string, { x: number; y: number }> = {
        [users.id]: { x: 80, y: 260 },
        [lb.id]: { x: 300, y: 260 },
        [servers[0].id]: { x: 520, y: 80 },
        [servers[1].id]: { x: 520, y: 260 },
        [servers[2].id]: { x: 520, y: 440 },
        [cache.id]: { x: 740, y: 260 },
        [database.id]: { x: 960, y: 260 },
      };

      const global: GlobalConfig = {
        users: 10_000,
        rpsPerUser: 0.1,
        readWriteRatio: 0.9,
      };

      return { nodes, edges, positions, global };
    },
  },

  {
    id: 'read-heavy-at-scale',
    name: 'Read-Heavy at Scale',
    description:
      'A CDN and a hot cache soak up almost every read before it reaches eight app servers and a modestly-sharded database. Comfortably healthy at its default 1M users — crank the USER LOAD slider up from there and watch the write path (database shards) start to strain first.',
    explanation: {
      tagline: 'CDN + cache absorb reads before database shards ever see them.',
      why:
        "Most real-world backends are read-heavy — a 90/10 or 95/5 read/write split is typical — which means the single highest-leverage thing you can do is stop reads from reaching the database at all. A CDN absorbs the outermost, most-cacheable layer (edge-cacheable content close to the user); a hot in-memory cache behind it mops up almost everything else. What's left over is a much smaller trickle that the app servers and database actually have to do real work for. Read replicas add read capacity but do nothing for writes — every replica still has to receive and apply every write from its primary — so replicas alone don't help a write-heavy workload. Sharding is the other lever: splitting the dataset across independent databases multiplies both read AND write capacity, at the cost of query complexity. This preset's database is deliberately the tighter of the two ceilings — writes have no cache to hide behind.",
      tryThis: [
        'Drop the cache hit ratio from 95% down toward 70% and watch database utilization jump even though nothing else changed',
        'Add 2 more database shards and see write capacity scale up almost linearly',
        'Push USER LOAD toward 5M and see whether the CDN, the cache, or the database shards give out first',
      ],
      simplifications:
        'Assumes a uniform read distribution across keys — real workloads have "hot key" skew where a handful of records get disproportionate traffic no matter how high the aggregate hit ratio is.',
    },
    build: () => {
      const users: SimNode = {
        id: 'users-1',
        kind: 'users',
        label: CATALOG.users.name,
        config: { ...CATALOG.users.defaultConfig, users: 1_000_000 },
      };
      const cdn: SimNode = {
        id: 'cdn-1',
        kind: 'cdn',
        label: CATALOG.cdn.name,
        config: { ...CATALOG.cdn.defaultConfig },
      };
      const lb: SimNode = {
        id: 'lb-1',
        kind: 'loadbalancer',
        label: CATALOG.loadbalancer.name,
        config: { ...CATALOG.loadbalancer.defaultConfig },
      };
      const servers: SimNode[] = Array.from({ length: 8 }, (_, i) => ({
        id: `server-${i + 1}`,
        kind: 'server' as const,
        label: `${CATALOG.server.name} ${i + 1}`,
        // At 1M users the CDN (90% hit) + cache (95% hit) leave only ~19k rps
        // reaching this tier; 8 x 16 instances gives ~64k rps of headroom
        // (~30% utilization) so per-hop latency stays low and the preset
        // lands solidly "healthy" rather than skirting its own queueing cliff.
        config: { instances: 16, rpsPerInstance: 500 },
      }));
      const cache: SimNode = {
        id: 'cache-1',
        kind: 'cache',
        label: CATALOG.cache.name,
        config: { hitRatio: 0.95 },
      };
      const database: SimNode = {
        id: 'database-1',
        kind: 'database',
        label: CATALOG.database.name,
        // Write capacity (4k rps/shard, replicas don't help writes) is the
        // real bottleneck at this scale: writes alone are ~10k rps, so 2
        // shards (8k rps cap) overloaded and dropped requests. 4 shards
        // (16k rps cap, ~62% utilized) keeps it healthy with real headroom
        // to crank load before it becomes the bottleneck again.
        // maxConnections raised above the default (400) — the connection
        // pool knob is a NEW constraint (Little's Law: maxConnections x
        // 1000/baseLatencyMs) that the default wasn't sized for at 4 shards
        // x 3x read fan-out (112k rps combined capacity needs >=1344
        // connections just to avoid being pool-bound before disk/CPU).
        config: { shards: 4, readReplicas: 2, maxConnections: 3000 },
      };

      const nodes: SimNode[] = [users, cdn, lb, ...servers, cache, database];
      const edges: SimEdge[] = [
        { id: 'e-users-cdn', source: users.id, target: cdn.id },
        { id: 'e-cdn-lb', source: cdn.id, target: lb.id },
        ...servers.map((s, i) => ({ id: `e-lb-server-${i + 1}`, source: lb.id, target: s.id })),
        ...servers.map((s, i) => ({ id: `e-server-${i + 1}-cache`, source: s.id, target: cache.id })),
        ...servers.map((s, i) => ({ id: `e-server-${i + 1}-database`, source: s.id, target: database.id })),
        { id: 'e-cache-database', source: cache.id, target: database.id },
      ];

      const positions: Record<string, { x: number; y: number }> = {
        [users.id]: { x: 80, y: 300 },
        [cdn.id]: { x: 300, y: 300 },
        [lb.id]: { x: 520, y: 300 },
        [cache.id]: { x: 960, y: 160 },
        [database.id]: { x: 1180, y: 300 },
      };
      // 8 servers stacked in a single column between the LB and the cache/DB tier.
      servers.forEach((s, i) => {
        positions[s.id] = { x: 740, y: 60 + i * 90 };
      });

      const global: GlobalConfig = {
        users: 1_000_000,
        rpsPerUser: 0.1,
        readWriteRatio: 0.9,
      };

      return { nodes, edges, positions, global };
    },
  },

  {
    id: 'netflix-streaming',
    name: 'Netflix-Style Streaming',
    description:
      'Two lanes from Users: tiny, cache-heavy API calls through Zuul and an autoscaled Playback tier, and massive video-byte traffic straight from the Open Connect CDN to S3 — the CDN bypasses the app tier entirely. Healthy at its default load; melts down once the fleet is cranked past what a single ELB/LB tier was ever sized for.',
    explanation: {
      tagline: 'Tiny metadata calls and massive video bytes take two completely different paths.',
      why:
        "Netflix separates two very different kinds of traffic: tiny, latency-sensitive API calls (play, pause, \"what's next\") and massive video-byte delivery. The huge majority of traffic is video, served straight from Open Connect — CDN appliances Netflix embeds directly inside ISP networks — so the API/control-plane tier barely sees it at all. The API path is cache-heavy: EVCache sits in front of Cassandra (chosen for availability over strict consistency) with a hit ratio so high that Cassandra rarely sees a live read. Play/pause/scroll telemetry is fired asynchronously into a Kafka-based pipeline (Keystone) rather than written synchronously, so a slow analytics write never blocks a playback request. Historically, Hystrix circuit breakers kept one slow microservice dependency from cascading into a full outage — flip the breaker on this build's Playback tier and starve its cache to see that mechanism in action: it trades raw throughput (some requests get shed) for a system that stays up instead of melting down.",
      tryThis: [
        "Drop Open Connect's hit ratio toward 0 and watch S3 Origin — a fixed-capacity node — take the overflow",
        "Drop EVCache's hit ratio to 0 and watch Cassandra go from barely-touched to overloaded",
        "Starve EVCache's own capacity (its capacityRps knob) with the circuit breaker OFF on Playback Microservices, then flip the breaker ON — availability recovers because the breaker starts shedding instead of piling on",
        'Push USER LOAD to 3-5x default and watch AWS ELB — a hard-capped tier in this model — become the whole system\'s ceiling',
      ],
      simplifications:
        "Users fan out evenly across every outgoing edge in this engine, so the Users→CDN and Users→ELB edges split the load exactly 50/50 here rather than the real ~95/5 video-dominant skew — a structural limitation of this simulator, not a design choice. A single load-balancer node is hard-capped at 200k rps in this model (mirroring a single physical scaling unit), which is the actual reason this preset's default load is far below Netflix's real subscriber count. Zuul is modeled as a rate limiter, and the whole Eureka/Ribbon/Hystrix microservice mesh collapses into one autoscaled server tier; there's no multi-region modeling.",
      sources: [
        { label: 'Netflix TechBlog — Announcing Zuul', url: 'https://netflixtechblog.com/announcing-zuul-edge-service-in-the-cloud-ab3af5be08ee' },
        { label: 'Netflix TechBlog — Open Sourcing Zuul 2', url: 'https://netflixtechblog.com/open-sourcing-zuul-2-82ea476cb2b3' },
        { label: 'Netflix TechBlog — Announcing EVCache', url: 'https://netflixtechblog.com/announcing-evcache-distributed-in-memory-datastore-for-cloud-c26a698c27f7' },
        { label: 'APNIC — Netflix Content Distribution through Open Connect', url: 'https://blog.apnic.net/2018/06/20/netflix-content-distribution-through-open-connect/' },
        { label: 'Netflix TechBlog — Keystone Real-time Stream Processing', url: 'https://netflixtechblog.com/keystone-real-time-stream-processing-platform-a3ee651812a' },
      ],
    },
    build: () => {
      const users: SimNode = {
        id: 'users-1',
        kind: 'users',
        label: CATALOG.users.name,
        config: { ...CATALOG.users.defaultConfig, users: 75_000_000 },
      };

      // --- API path: Users -> ELB -> Zuul -> Playback microservices -> (EVCache -> Cassandra) + (Kafka -> Cassandra)
      const elb: SimNode = {
        id: 'elb-1',
        kind: 'loadbalancer',
        label: 'AWS ELB',
        config: { algorithm: 'round-robin' },
      };
      const zuul: SimNode = {
        id: 'zuul-1',
        kind: 'ratelimiter',
        label: 'Zuul API Gateway',
        // High limit — mostly a safety net; the ELB's own fixed 200k rps
        // ceiling is what actually binds at this scale, not this limiter.
        config: { limitRps: 500_000 },
      };
      const playback: SimNode = {
        id: 'playback-1',
        kind: 'server',
        label: 'Playback Microservices',
        // Autoscaled 200..2000 instances; targetUtilization 0.5 (not the
        // catalog default 0.7) keeps steady-state per-hop latency low enough
        // for the preset to clear the "healthy" p99-vs-ideal bar at default
        // load rather than sitting right at the edge of "degraded".
        config: {
          instances: 200,
          rpsPerInstance: 500,
          autoscale: 'on',
          minInstances: 200,
          maxInstances: 2000,
          targetUtilization: 0.5,
        },
      };
      const evcache: SimNode = {
        id: 'evcache-1',
        kind: 'cache',
        label: 'EVCache',
        config: { hitRatio: 0.99, capacityRps: 2_000_000 },
      };
      const kafka: SimNode = {
        id: 'kafka-1',
        kind: 'queue',
        label: 'Kafka (Keystone)',
        config: { workers: 200, jobsPerWorkerRps: 50 },
      };
      const cassandra: SimNode = {
        id: 'cassandra-1',
        kind: 'database',
        label: 'Cassandra',
        // Deliberately NOT the 24-shard figure real Cassandra clusters run —
        // sized down so the "drop EVCache's hit ratio" tryThis experiment
        // actually pushes this node past its capacity instead of coasting;
        // 24 shards would absorb that whole experiment without blinking.
        config: { shards: 4, readReplicas: 2, maxConnections: 2000 },
      };

      // --- Video-bytes path: Users -> Open Connect CDN -> S3 Origin
      const cdn: SimNode = {
        id: 'cdn-1',
        kind: 'cdn',
        label: 'Open Connect CDN',
        config: { hitRatio: 0.96, capacityRps: 20_000_000 },
      };
      const s3: SimNode = {
        id: 's3-1',
        kind: 'storage',
        label: 'S3 Origin',
        config: {},
      };

      const nodes: SimNode[] = [users, elb, zuul, playback, evcache, kafka, cassandra, cdn, s3];
      const edges: SimEdge[] = [
        { id: 'e-users-elb', source: users.id, target: elb.id },
        // The signature edge: video bytes bypass the app tier entirely.
        { id: 'e-users-cdn', source: users.id, target: cdn.id },
        { id: 'e-elb-zuul', source: elb.id, target: zuul.id },
        { id: 'e-zuul-playback', source: zuul.id, target: playback.id },
        { id: 'e-playback-evcache', source: playback.id, target: evcache.id },
        { id: 'e-playback-kafka', source: playback.id, target: kafka.id },
        { id: 'e-evcache-cassandra', source: evcache.id, target: cassandra.id },
        { id: 'e-kafka-cassandra', source: kafka.id, target: cassandra.id },
        { id: 'e-cdn-s3', source: cdn.id, target: s3.id },
      ];

      // Two visually distinct horizontal lanes: API/control-plane on top,
      // video-bytes delivery along the bottom, Users anchored in between.
      const positions: Record<string, { x: number; y: number }> = {
        [users.id]: { x: 40, y: 280 },
        [elb.id]: { x: 280, y: 120 },
        [zuul.id]: { x: 500, y: 120 },
        [playback.id]: { x: 720, y: 120 },
        [evcache.id]: { x: 960, y: 40 },
        [kafka.id]: { x: 960, y: 200 },
        [cassandra.id]: { x: 1200, y: 120 },
        [cdn.id]: { x: 280, y: 460 },
        [s3.id]: { x: 520, y: 460 },
      };

      const global: GlobalConfig = {
        users: 75_000_000,
        // Tuned (not the ~0.05 ballpark from first principles) so that the
        // API branch — half of total offered load, since this engine splits
        // a node's outgoing edges evenly rather than by real-world weight —
        // sits comfortably under the ELB's fixed 200k rps ceiling by default.
        rpsPerUser: 0.003,
        readWriteRatio: 0.98,
      };

      return { nodes, edges, positions, global };
    },
  },

  {
    id: 'instagram-feed',
    name: 'Instagram-Style Social Feed',
    description:
      'Media reads bypass the app tier via a CDN straight to Haystack photo storage, while the main path (LB → rate limiter → Django fleet → Memcached → sharded Postgres) handles everything else, with Celery/RabbitMQ fanning writes out to a Cassandra feed store asynchronously. Healthy at default load; the fixed-capacity Load Balancer is the first thing to give out as load climbs.',
    explanation: {
      tagline: 'A social feed is a read-amplification problem — cache misses hit the database, not the network.',
      why:
        "A social feed's defining trait is that the social graph gets read far more than it's written — Meta's TAO paper describes reads outnumbering writes by roughly 500:1, and Facebook's memcache fleet famously sees around 30 GETs for every SET. That means every layer in this diagram — the CDN in front of media, Memcached in front of Postgres — exists purely to keep reads off the database, and a single point of hit-ratio erosion multiplies straight through to database load. Instagram's own sharded Postgres famously encodes the shard ID directly inside its 64-bit photo IDs, so any application server can route a request to the right shard without a directory lookup — sharding here isn't just about capacity, it's about avoiding a coordination bottleneck. Publishing a photo never blocks on delivering it to followers: fan-out into precomputed feeds happens asynchronously through a queue (modeled here as Celery/RabbitMQ feeding a separate Cassandra feed store), which is also exactly why celebrity accounts with huge follower counts need a different, pull-based path in the real system.",
      tryThis: [
        "Drop Memcached's hit ratio from 99% to 95% and watch Postgres's load jump 5x even though nothing else changed",
        'Cut Celery/RabbitMQ\'s worker count (e.g. 240 → 30) to starve the queue, then flip retries OFF on the Django fleet — availability improves, because retries were amplifying reads to Memcached too, not just the stuck writes',
        'Push USER LOAD to 3-5x default and watch the Load Balancer — a fixed-capacity tier in this model — become the whole system\'s ceiling',
      ],
      simplifications:
        "TAO's graph-aware semantics are approximated here as a plain cache; the real push-vs-pull hybrid fan-out for celebrity/high-follower accounts isn't modeled — everything fans out the same way. Users fan out evenly across the CDN and Load Balancer edges in this engine (a structural limitation, not a design choice), and a single load-balancer node is hard-capped at 200k rps, which is why this preset's default load sits well below Instagram's real user count.",
      sources: [
        { label: 'Instagram Engineering — Sharding & IDs at Instagram', url: 'https://instagram-engineering.com/sharding-ids-at-instagram-1cf5a71e5a5c' },
        { label: 'TAO: Facebook\'s Distributed Data Store for the Social Graph (USENIX ATC \'13)', url: 'https://www.usenix.org/system/files/conference/atc13/atc13-bronson.pdf' },
        { label: 'Scaling Memcache at Facebook (NSDI \'13)', url: 'https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala' },
        { label: 'Finding a needle in Haystack: Facebook\'s photo storage (OSDI \'10)', url: 'https://www.usenix.org/conference/osdi10/finding-needle-haystack-facebooks-photo-storage' },
        { label: 'HighScalability — Instagram Architecture', url: 'https://highscalability.com/instagram-architecture-14-million-users-terabytes-of-photos/' },
      ],
    },
    build: () => {
      const users: SimNode = {
        id: 'users-1',
        kind: 'users',
        label: CATALOG.users.name,
        config: { ...CATALOG.users.defaultConfig, users: 150_000_000 },
      };

      // --- Media path: Users -> Instagram CDN -> Haystack photo store
      const cdn: SimNode = {
        id: 'cdn-1',
        kind: 'cdn',
        label: 'Instagram CDN',
        config: { hitRatio: 0.93, capacityRps: 10_000_000 },
      };
      const haystack: SimNode = {
        id: 'haystack-1',
        kind: 'storage',
        label: 'Haystack Photo Store',
        config: {},
      };

      // --- Main path: Users -> LB -> Edge Rate Limiter -> Django Fleet -> Memcached -> Sharded Postgres
      const lb: SimNode = {
        id: 'lb-1',
        kind: 'loadbalancer',
        label: 'Load Balancer',
        config: { algorithm: 'round-robin' },
      };
      const edgeRl: SimNode = {
        id: 'edge-rl-1',
        kind: 'ratelimiter',
        label: 'Edge Rate Limiter',
        config: { limitRps: 300_000 },
      };
      const django: SimNode = {
        id: 'django-1',
        kind: 'server',
        label: 'Django Fleet',
        config: {
          instances: 100,
          rpsPerInstance: 500,
          autoscale: 'on',
          minInstances: 100,
          maxInstances: 1000,
          targetUtilization: 0.5,
          retriesEnabled: 'on',
          maxRetries: 2,
        },
      };
      const memcached: SimNode = {
        id: 'memcached-1',
        kind: 'cache',
        label: 'Memcached Tier',
        config: { hitRatio: 0.99, capacityRps: 1_500_000 },
      };
      const postgres: SimNode = {
        id: 'postgres-1',
        kind: 'database',
        label: 'Sharded PostgreSQL',
        // maxConnections raised above what 16 shards' combined read+write
        // capacity would otherwise pool-bind at (Little's Law) — the shard
        // count itself, not the pool, is meant to be the interesting knob.
        config: { shards: 16, readReplicas: 2, maxConnections: 6_000 },
      };

      // --- Async fan-out: Django -> Celery/RabbitMQ -> Cassandra feed store
      const celery: SimNode = {
        id: 'celery-1',
        kind: 'queue',
        label: 'Celery/RabbitMQ',
        config: { workers: 240, jobsPerWorkerRps: 50, mode: 'queue' },
      };
      const cassandraFeed: SimNode = {
        id: 'cassandra-feed-1',
        kind: 'database',
        label: 'Cassandra Feed Store',
        config: { shards: 12, readReplicas: 2, maxConnections: 5_000 },
      };

      const nodes: SimNode[] = [users, cdn, haystack, lb, edgeRl, django, memcached, postgres, celery, cassandraFeed];
      const edges: SimEdge[] = [
        // The signature edge: media reads bypass the app tier entirely.
        { id: 'e-users-cdn', source: users.id, target: cdn.id },
        { id: 'e-cdn-haystack', source: cdn.id, target: haystack.id },
        { id: 'e-users-lb', source: users.id, target: lb.id },
        { id: 'e-lb-edgerl', source: lb.id, target: edgeRl.id },
        { id: 'e-edgerl-django', source: edgeRl.id, target: django.id },
        { id: 'e-django-memcached', source: django.id, target: memcached.id },
        { id: 'e-memcached-postgres', source: memcached.id, target: postgres.id },
        { id: 'e-django-celery', source: django.id, target: celery.id },
        { id: 'e-celery-cassandra', source: celery.id, target: cassandraFeed.id },
      ];

      // Two lanes: media delivery along the top, the main read/write path
      // (plus its async feed-fanout branch) along the bottom.
      const positions: Record<string, { x: number; y: number }> = {
        [users.id]: { x: 40, y: 300 },
        [cdn.id]: { x: 280, y: 100 },
        [haystack.id]: { x: 520, y: 100 },
        [lb.id]: { x: 280, y: 460 },
        [edgeRl.id]: { x: 500, y: 460 },
        [django.id]: { x: 720, y: 460 },
        [memcached.id]: { x: 960, y: 360 },
        [postgres.id]: { x: 1200, y: 360 },
        [celery.id]: { x: 960, y: 580 },
        [cassandraFeed.id]: { x: 1200, y: 580 },
      };

      const global: GlobalConfig = {
        users: 150_000_000,
        // Tuned so the LB branch — half of total offered load, since this
        // engine splits Users' outgoing edges evenly — sits comfortably
        // under the load balancer's fixed 200k rps ceiling by default.
        rpsPerUser: 0.0016,
        readWriteRatio: 0.95,
      };

      return { nodes, edges, positions, global };
    },
  },

  {
    id: 'planet-scale',
    name: 'Planet Scale',
    description:
      'CDN, a rate limiter, twin load balancers, 200 app servers, a shared cache, a write-behind queue, and a 64-shard database. Barely healthy at 100M users on this build — crank to 500M and watch the CDN (fixed 5M rps ceiling) take the whole system down with it.',
    explanation: {
      tagline: 'Every lever at once — and it still barely holds at 100M users.',
      why:
        "This is every technique from the other three presets stacked together: an edge CDN, a rate limiter as a safety valve, two load balancers spreading load across 200 app servers, a shared cache, a write-behind queue so writes don't block on the database, and 64 database shards. At internet scale, no single technique is enough — you need all of them working together, and even then the system is running close to its ceiling rather than comfortably under it. The rate limiter here is mostly dormant (its limit sits above the CDN's own ceiling), which is itself a lesson: a safety valve you size correctly should rarely be the thing doing the shedding in practice. The queue decouples the write path so a burst doesn't directly overload the database, at the cost of eventual (not immediate) consistency. Notice that this design is tuned to be barely healthy, not comfortably healthy — at true planet scale, headroom is expensive, and every one of these tiers is pulling its weight.",
      tryThis: [
        "Push USER LOAD to 500M and watch the CDN's fixed rps ceiling take the whole system down with it",
        'Turn the rate limiter off entirely and check whether availability changes at all at the default 100M users',
        "Halve the queue's worker count and watch the write-behind backlog grow even while the database itself stays calm",
      ],
      simplifications:
        'A single global CDN and cache tier stand in for what would really be a multi-region, multi-PoP edge network with regional failover — this model has no concept of geography or cross-region latency.',
    },
    build: () => {
      const users: SimNode = {
        id: 'users-1',
        kind: 'users',
        label: CATALOG.users.name,
        config: { ...CATALOG.users.defaultConfig, users: 100_000_000 },
      };
      const cdn: SimNode = {
        id: 'cdn-1',
        kind: 'cdn',
        label: CATALOG.cdn.name,
        config: { hitRatio: 0.9 },
      };
      const ratelimiter: SimNode = {
        id: 'ratelimiter-1',
        kind: 'ratelimiter',
        label: CATALOG.ratelimiter.name,
        // Sized above the CDN's own 5M rps ceiling — at this scale the CDN
        // itself is the binding constraint, so the limiter mostly acts as a
        // safety net rather than the thing doing the shedding.
        config: { limitRps: 6_000_000 },
      };
      const lbCount = 2;
      const loadbalancers: SimNode[] = Array.from({ length: lbCount }, (_, i) => ({
        id: `lb-${i + 1}`,
        kind: 'loadbalancer' as const,
        label: `${CATALOG.loadbalancer.name} ${i + 1}`,
        config: { algorithm: 'least-connections' as const },
      }));
      const serverCount = 200;
      const servers: SimNode[] = Array.from({ length: serverCount }, (_, i) => ({
        id: `server-${i + 1}`,
        kind: 'server' as const,
        label: `Server ${i + 1}`,
        config: { instances: 1, rpsPerInstance: 2600 },
      }));
      const cache: SimNode = {
        id: 'cache-1',
        kind: 'cache',
        label: CATALOG.cache.name,
        config: { hitRatio: 0.8 },
      };
      const queue: SimNode = {
        id: 'queue-1',
        kind: 'queue',
        label: CATALOG.queue.name,
        config: { workers: 40, jobsPerWorkerRps: 5000 },
      };
      const database: SimNode = {
        id: 'database-1',
        kind: 'database',
        label: CATALOG.database.name,
        // Same connection-pool retune as Read-Heavy: 64 shards need >=9216
        // connections (Little's Law) to keep the pool from binding before
        // disk/CPU capacity does.
        config: { shards: 64, readReplicas: 0, maxConnections: 20_000 },
      };

      const nodes: SimNode[] = [users, cdn, ratelimiter, ...loadbalancers, ...servers, cache, queue, database];

      const serversPerLb = serverCount / lbCount;
      const edges: SimEdge[] = [
        { id: 'e-users-cdn', source: users.id, target: cdn.id },
        { id: 'e-cdn-ratelimiter', source: cdn.id, target: ratelimiter.id },
        ...loadbalancers.map((lb, i) => ({ id: `e-ratelimiter-lb-${i + 1}`, source: ratelimiter.id, target: lb.id })),
        ...servers.map((s, i) => {
          const lb = loadbalancers[Math.floor(i / serversPerLb)];
          return { id: `e-lb-server-${i + 1}`, source: lb.id, target: s.id };
        }),
        ...servers.map((s, i) => ({ id: `e-server-${i + 1}-cache`, source: s.id, target: cache.id })),
        ...servers.map((s, i) => ({ id: `e-server-${i + 1}-queue`, source: s.id, target: queue.id })),
        { id: 'e-cache-database', source: cache.id, target: database.id },
        { id: 'e-queue-database', source: queue.id, target: database.id },
      ];

      const positions: Record<string, { x: number; y: number }> = {
        [users.id]: { x: 40, y: 460 },
        [cdn.id]: { x: 260, y: 460 },
        [ratelimiter.id]: { x: 480, y: 460 },
        [cache.id]: { x: 2420, y: 300 },
        [queue.id]: { x: 2420, y: 780 },
        [database.id]: { x: 2660, y: 540 },
      };
      loadbalancers.forEach((lb, i) => {
        positions[lb.id] = { x: 700, y: i === 0 ? 230 : 690 };
      });
      const cols = 10;
      servers.forEach((s, i) => {
        const band = Math.floor(i / serversPerLb); // 0 or 1
        const within = i % serversPerLb;
        const col = within % cols;
        const row = Math.floor(within / cols);
        positions[s.id] = {
          x: 940 + col * 130,
          y: (band === 0 ? 60 : 620) + row * 55,
        };
      });

      const global: GlobalConfig = {
        users: 100_000_000,
        rpsPerUser: 0.02,
        readWriteRatio: 0.95,
      };

      return { nodes, edges, positions, global };
    },
  },
];
