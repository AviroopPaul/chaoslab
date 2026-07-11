# ChaosLab — System Design Visualizer (MVP Spec)

A visual playground where you build a backend architecture on a whiteboard canvas, crank users from 10 to 100M+, and watch the system hold up or melt down in real time.

**Stack:** Next.js 15 (App Router, TypeScript), Tailwind CSS v4, `@xyflow/react` (React Flow 12) for the canvas, `zustand` for state, `lucide-react` for icons, `three` + `@react-three/fiber` + `@react-three/drei` ONLY on the landing page hero. Client-side only — no API routes, no DB. Deployed to Vercel.

**Routes:**
- `/` — landing page: hero + module cards. Module "Backend Basics" is live → `/lab/backend`. Modules "Frontend Delivery", "LLM Inference", "Realtime & Streaming" are visually present but disabled ("Coming soon").
- `/lab/backend` — the playground (full-viewport canvas + panels).

---

## 1. Directory layout (all agents follow this exactly)

```
src/
  app/
    layout.tsx, page.tsx (landing), globals.css
    lab/backend/page.tsx        // playground shell (client component)
  lib/sim/
    types.ts                    // ALL shared types (§2) — single source of truth
    catalog.ts                  // component catalog: defaults, limits, costs (§3)
    engine.ts                   // pure solver: SimGraph -> SimResult (§4)
    presets.ts                  // preset scenarios (§6)
  store/
    useLabStore.ts              // zustand: nodes, edges, config, results, persistence (§5)
  components/
    landing/                    // Hero3D.tsx, ModuleCard.tsx, ...
    lab/                        // Canvas.tsx, nodes/, edges/, panels/, Toolbar.tsx, ...
```

## 2. Shared types — `src/lib/sim/types.ts`

This file is written FIRST and is the contract between the engine and the UI. Verbatim:

```ts
export type ComponentKind =
  | 'users' | 'cdn' | 'loadbalancer' | 'ratelimiter' | 'server'
  | 'cache' | 'database' | 'queue' | 'storage';

export interface NodeConfig {
  // users
  users?: number;                 // set by the global load slider on the users node
  // server
  instances?: number;             // horizontal scale, 1..10000
  rpsPerInstance?: number;
  // loadbalancer
  algorithm?: 'round-robin' | 'least-connections';
  // ratelimiter
  limitRps?: number;
  // cache / cdn
  hitRatio?: number;              // 0..1
  // database
  readReplicas?: number;          // 0..15
  shards?: number;                // 1..64
  // queue
  workers?: number;
  jobsPerWorkerRps?: number;
}

export interface SimNode {
  id: string;
  kind: ComponentKind;
  label: string;
  config: NodeConfig;
}

export interface SimEdge { id: string; source: string; target: string; }

export interface GlobalConfig {
  users: number;                  // 10 .. 500_000_000 (log slider)
  rpsPerUser: number;             // default 0.1
  readWriteRatio: number;         // fraction of reads, default 0.9
}

export interface SimGraph { nodes: SimNode[]; edges: SimEdge[]; global: GlobalConfig; }

export type Health = 'idle' | 'ok' | 'warn' | 'hot' | 'overloaded' | 'down';

export interface NodeMetrics {
  nodeId: string;
  inRps: number;                  // offered load
  servedRps: number;
  droppedRps: number;             // errors due to overload
  shedRps: number;                // deliberately rejected (rate limiter) — not an error
  utilization: number;            // 0..∞ (>1 = overloaded)
  latencyMs: number;              // effective per-hop latency incl. queueing
  health: Health;
  costPerMonth: number;
  warnings: string[];             // e.g. "No downstream server connected"
}

export interface EdgeMetrics {
  edgeId: string;
  rps: number;
  droppedShare: number;           // 0..1 fraction of this edge's traffic that will fail downstream
}

export interface SimResult {
  nodes: Record<string, NodeMetrics>;
  edges: Record<string, EdgeMetrics>;
  totals: {
    offeredRps: number;
    servedRps: number;
    availability: number;         // servedRps / (offered - shed), 0..1
    p50Ms: number;
    p99Ms: number;
    costPerMonth: number;
    verdict: 'healthy' | 'degraded' | 'meltdown';
    bottlenecks: string[];        // node ids sorted by utilization desc, util > 0.9
    graphWarnings: string[];      // structural problems
  };
}
```

## 3. Component catalog — `src/lib/sim/catalog.ts`

Per kind: display name, lucide icon name, accent color, description (1 line, educational), default config, config field definitions (for the inspector panel to render generically: key, label, type `number|percent|select`, min/max/step, options), base latency ms, capacity model, cost model. Values:

| kind | base latency | capacity | default config | cost/mo |
|---|---|---|---|---|
| users | — | ∞ | users: 100 | 0 |
| cdn | 5ms | 5M rps flat | hitRatio 0.90 | $0.02 per 1M served req/mo... simplify: 200 + servedRps×0.5 |
| loadbalancer | 2ms | 200k rps | round-robin | $150 |
| ratelimiter | 1ms | 1M rps | limitRps 10000 | $50 |
| server | 30ms | instances × rpsPerInstance (default 500) | instances 1 | $80 × instances |
| cache | 2ms | 300k rps | hitRatio 0.80 | $120 |
| database | 12ms | writes: 4k rps × shards; reads: 8k rps × shards × (1 + readReplicas) | shards 1, replicas 0 | $250 × shards × (1 + replicas) |
| queue | 4ms enqueue | 500k rps enqueue; drain = workers × jobsPerWorkerRps (default 10 × 50) | workers 10 | $60 + 40 × workers |
| storage | 25ms | 100k rps | — | $100 |

Educational descriptions matter — every component should teach ("Caches absorb repeated reads; hit ratio determines how much DB traffic they soak up").

## 4. Simulation engine — `src/lib/sim/engine.ts`

Pure function `solve(graph: SimGraph): SimResult`. No React. Deterministic. Must handle ANY graph the user draws without crashing (cycles, disconnected nodes, missing users node, fan-in/fan-out).

**Traffic model.** Offered load = `users × rpsPerUser`. Reads = `× readWriteRatio`, writes = remainder. Traffic flows as `{ read: number, write: number }` tuples along directed edges from the users node.

**Propagation.** Process nodes in topological order starting from users nodes (Kahn's algorithm; if a cycle exists, break it by ignoring back-edges and emit a graph warning "Cycle detected — back edge ignored"). Each node:
1. Sum incoming read/write rps from processed in-edges.
2. Apply node behavior:
   - **cdn/cache:** `hitRatio` share of READS is absorbed (served locally); misses + all writes pass through. A cache with no downstream still serves hits; misses become drops with warning.
   - **ratelimiter:** passes `min(in, limitRps)`; excess is `shedRps` (counted as shed, not error).
   - **loadbalancer:** splits outgoing traffic across downstream edges — equally for round-robin; proportionally to downstream *remaining capacity* for least-connections.
   - **server:** capacity = instances × rpsPerInstance. `served = min(in, capacity)`, rest dropped. Passes served traffic downstream. If a server has multiple downstream targets of DIFFERENT kinds (e.g. cache and db and queue), the flow is sequential per-request in spirit — model as: reads go to cache-path if a cache is downstream else to db-path; writes go to queue if a queue is downstream (async write-behind, reduces sync write load to db by the queue's absorbed share) else to db. Storage receives 10% of reads (static assets) if connected. Keep this routing heuristic in ONE well-commented function `routeFromServer()`.
   - **database:** reads capacity and writes capacity computed separately (see catalog); utilization = max(readUtil, writeUtil).
   - **queue:** enqueue nearly always succeeds up to enqueue capacity; if drain rate < enqueue rate, utilization climbs and health degrades (backlog), but requests aren't dropped until 2× drain.
3. **Queueing latency (M/M/1 flavored):** `ρ = min(util, 0.999)`; `latency = base × (1 + ρ² / (1 − ρ))`, capped at 20× base. If util > 1: latency pinned at cap and `dropped = in − capacity`.
4. **Health:** idle (in≈0), ok (<0.7), warn (0.7–0.9), hot (0.9–1.0), overloaded (>1), down (util > 1.5 → serves only 50% of capacity — meltdown feedback).

**End-to-end latency.** Expected latency along the request path from users, weighting branches by traffic share and cache hits by hit ratio (hit = short path, miss = full path). p50 = that expectation; p99 = p50 × (2 + 6 × maxPathUtilization²) — a simple, believable spread that explodes as the system saturates.

**Totals & verdict.** availability = served/(offered−shed). verdict: healthy ≥ 0.995 avail and p99 < 8× ideal; meltdown < 0.9 avail; else degraded. Bottlenecks = nodes with util > 0.9 sorted desc.

**Structural warnings:** no users node; users not connected to anything; server with no path from users; cache with no downstream DB (miss traffic dropped); LB with no downstream servers, etc.

**Unit sanity:** ship `engine.test.ts` (vitest) covering: single server happy path, overload drops, cache absorption math, LB split, replica/shard scaling, rate limiter shedding, cycle safety.

## 5. Store & persistence — `src/store/useLabStore.ts`

Zustand store owning: React Flow `nodes`/`edges` (RF types with `data.simNode`), `global` config, latest `SimResult`, selected node id, and actions (addNode from palette drop, updateNodeConfig, deleteSelection, setUsers, loadPreset, importJson/exportJson, clear). Re-solve synchronously on every mutation (engine is O(V+E), cheap) — debounce 60ms for slider drags. Autosave graph to `localStorage['chaoslab.backend.v1']` (debounced 500ms), hydrate on mount.

## 6. Presets — `src/lib/sim/presets.ts`

Four presets with tidy hand-laid-out positions:
1. **Hello World** — Users → Server → Database (100 users; healthy).
2. **Classic 3-Tier** — Users → LB → 3 servers → cache → DB (10k users).
3. **Read-Heavy at Scale** — Users → CDN → LB → 8 servers → cache(0.95) → DB(2 shards, 3 replicas) (1M users).
4. **Planet Scale** — CDN → LB → 200 servers → cache → sharded DB(16×) + queue write-behind + rate limiter (100M users; still barely healthy — cranking to 500M melts it).

## 7. Playground UI — `/lab/backend`

Layout: left palette rail (fixed ~240px), center canvas (React Flow, dotted background, minimap, zoom controls), right inspector panel (slides in when a node is selected), top toolbar, bottom metrics bar.

- **Palette:** one card per catalog kind (icon, name, one-line description) — drag onto canvas to add (React Flow `onDrop` + `screenToFlowPosition`). Also click-to-add.
- **Custom node (one generic `ComponentNode` for all kinds):** rounded card, kind icon in accent color, label, health ring/border (gray idle, green ok, amber warn, orange hot, red overloaded, pulsing red down), compact live metrics (in rps formatted like `12.4k`, util %, latency), tiny badges for scale config (e.g. `×8` instances, `4 shards`). Handles: left target, right source. Node warnings show a small ⚠ with tooltip.
- **Custom edge (`FlowEdge`):** bezier path; animated **particle dots** flowing source→target via SVG `<circle>` on `animateMotion` or a rAF-driven offset — particle count/speed scale with `log10(rps)` (0 particles when idle, ~2 at 10rps, ~6 at 10k, ~10 max), color green normally, amber when downstream is hot, red particles (a share of them) when `droppedShare > 0`. Edge stroke width also scales slightly with rps. This is the "live wire" — it must feel alive but stay at 60fps (cap total particles ~400 globally; degrade gracefully).
- **Toolbar (top):** preset picker, module name, undo-lite (clear), export/import JSON, share-nothing. Right side: the **USER LOAD slider** — log scale 10 → 500M with labeled stops (10, 100, 1k, 10k, 100k, 1M, 10M, 100M, 500M), big readable current value, and a subtle "+/-" nudge. This is the hero control — make it prominent.
- **Metrics bar (bottom):** offered vs served RPS, availability % (big, color-coded), p50/p99, monthly cost, verdict chip (HEALTHY / DEGRADED / MELTDOWN with color + icon), bottleneck callout ("Bottleneck: Database — add shards or replicas"). Suggestions come from a tiny rules map keyed by bottleneck kind (server→"add instances or a load balancer", database→"add a cache, replicas, or shards", cache→"raise capacity", etc.).
- **Inspector (right):** rendered generically from catalog field definitions — sliders/selects for the selected node's config, node metrics detail, educational description, delete button.
- Delete: select + `Backspace`/`Delete`. Multi-select box supported by RF defaults.

**Aesthetic:** dark engineering-lab theme (near-black `#0a0e14` canvas, subtle dot grid, one electric accent — cyan/teal, amber+red reserved for stress), Inter or Geist font, glassy panels (subtle blur, 1px borders at 10% white). Must look premium, not like a default RF demo.

## 8. Landing page `/`

Dark, same theme. Hero: title "ChaosLab", tagline "Build a system. Break it. Learn why.", a Three.js accent (react-three-fiber Canvas: slowly rotating wireframe icosahedron / node-graph particles, cheap on GPU, `dynamic(() => …, { ssr: false })`). CTA "Open the lab". Below: 4 module cards (icon, name, blurb, live/coming-soon state; live card links to `/lab/backend`). Footer one-liner. No scroll-jank, works on mobile.

## 9. Non-goals (MVP)

No auth, no server persistence, no WebRTC/realtime, no multi-module engines, no request tracing UI, no mobile-optimized canvas (desktop-first; landing is responsive).
