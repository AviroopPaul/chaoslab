/**
 * Single shared rAF driver for every edge's particle animation, plus a
 * GLOBAL particle budget allocator (SPEC.md §7: "cap total particles ~400
 * globally; degrade gracefully").
 *
 * Two independent concerns live here:
 *
 * 1. Allocation — how many particles each edge is *allowed* to render.
 *    Every `FlowEdge` registers its desired count (derived from rps, same
 *    `particleCountFor` formula as before, 0..10 per edge) and is notified
 *    only when its *allocated* count changes. With small graphs the global
 *    total sits comfortably under the budget and every edge just gets its
 *    desired count. Once the total crosses the budget (e.g. Planet Scale's
 *    606 edges), every edge's share is scaled down proportionally to its
 *    desired count (itself ~log10(rps)-weighted) so high-traffic edges keep
 *    the most particles and very-low-rps edges are allowed to drop to 0.
 *    Recomputation is batched onto a microtask so a burst of synchronous
 *    register/update calls (loading a several-hundred-edge preset) collapses
 *    into a single renormalization pass — not per-frame React work.
 *
 * 2. Animation — exactly ONE requestAnimationFrame loop for the whole
 *    canvas. Each `FlowEdge` subscribes a plain callback that mutates its
 *    own `<circle>` DOM nodes directly via refs — no React state, no
 *    re-render, just attribute writes on already-mounted SVG elements. When
 *    the total allocated particle count is large (> 250), the loop only
 *    invokes tick callbacks on every other frame — `getPointAtLength` per
 *    particle per frame is itself real work at hundreds of particles, and
 *    halving the sample rate is an easy, visually-minor way to buy back
 *    headroom.
 *
 * The loop starts lazily on first animation subscriber and stops when the
 * last one unsubscribes (idle canvas = zero background work).
 */
type Tick = (elapsedMs: number) => void;

/** SPEC.md §7: "cap total particles ~400 globally; degrade gracefully". */
const GLOBAL_PARTICLE_BUDGET = 400;
/** Above this many live particles, halve the animation sample rate. */
const FRAME_SKIP_PARTICLE_THRESHOLD = 250;
const MAX_PARTICLES_PER_EDGE = 10;

export function particleCountFor(rps: number): number {
  if (rps <= 0) return 0;
  return Math.max(0, Math.min(MAX_PARTICLES_PER_EDGE, Math.round(2 * Math.log10(rps + 1))));
}

interface EdgeEntry {
  rps: number;
  desired: number;
  allocated: number;
  onAllocationChange: (count: number) => void;
}

class ParticleClock {
  private edges = new Map<string, EdgeEntry>();
  private tickSubscribers = new Map<string, Tick>();
  private rafId: number | null = null;
  private startTime = 0;
  private frameCount = 0;
  private renormalizeScheduled = false;
  private totalAllocated = 0;

  /**
   * Register an edge's desired particle share with the global allocator.
   * Returns an unregister function. `onAllocationChange` fires (only) when
   * this edge's *allocated* count actually changes — not every frame.
   */
  registerEdge(id: string, rps: number, onAllocationChange: (count: number) => void): () => void {
    this.edges.set(id, { rps, desired: particleCountFor(rps), allocated: 0, onAllocationChange });
    this.scheduleRenormalize();
    return () => {
      const entry = this.edges.get(id);
      if (entry) this.totalAllocated -= entry.allocated;
      this.edges.delete(id);
      this.tickSubscribers.delete(id);
      this.scheduleRenormalize();
    };
  }

  /** Update an already-registered edge's rps (cheap no-op if unchanged). */
  updateEdgeRps(id: string, rps: number): void {
    const entry = this.edges.get(id);
    if (!entry) return;
    const desired = particleCountFor(rps);
    if (entry.rps === rps && entry.desired === desired) return;
    entry.rps = rps;
    entry.desired = desired;
    this.scheduleRenormalize();
  }

  /** Per-frame animation subscription for an edge currently allocated > 0 particles. */
  subscribeTick(id: string, cb: Tick): () => void {
    this.tickSubscribers.set(id, cb);
    this.ensureRunning();
    return () => {
      this.tickSubscribers.delete(id);
    };
  }

  private scheduleRenormalize() {
    if (this.renormalizeScheduled) return;
    this.renormalizeScheduled = true;
    queueMicrotask(() => this.renormalize());
  }

  private renormalize() {
    this.renormalizeScheduled = false;
    const entries = Array.from(this.edges.entries());
    const totalDesired = entries.reduce((sum, [, e]) => sum + e.desired, 0);

    let allocation: Map<string, number>;

    if (totalDesired <= GLOBAL_PARTICLE_BUDGET) {
      // Under budget: honor desired counts, with a floor of 1 particle for
      // any edge carrying real traffic so low-rps edges stay visibly "alive"
      // even if their raw formula would round down to 0.
      allocation = new Map(
        entries.map(([id, e]) => [id, e.rps > 0 ? Math.max(1, e.desired) : 0]),
      );
    } else {
      // Over budget: scale every edge's share proportionally to its desired
      // count (weighted by ~log10(rps)) so high-traffic edges keep the most
      // particles. No floor guarantee here — with hundreds of edges it's
      // correct for the lowest-traffic ones to legitimately drop to 0.
      const scale = GLOBAL_PARTICLE_BUDGET / totalDesired;
      const scaled = entries.map(([id, e]) => {
        const exact = e.desired * scale;
        const floor = Math.floor(exact);
        return { id, floor, frac: exact - floor, desired: e.desired };
      });
      const used = scaled.reduce((sum, s) => sum + s.floor, 0);
      let remaining = GLOBAL_PARTICLE_BUDGET - used;
      // Distribute leftover budget to the highest-traffic, highest-remainder
      // edges first (prioritize visually important edges).
      scaled.sort((a, b) => b.frac - a.frac || b.desired - a.desired);
      for (const s of scaled) {
        if (remaining <= 0) break;
        s.floor += 1;
        remaining -= 1;
      }
      allocation = new Map(scaled.map((s) => [s.id, s.floor]));
    }

    for (const [id, entry] of entries) {
      const next = allocation.get(id) ?? 0;
      if (next !== entry.allocated) {
        this.totalAllocated += next - entry.allocated;
        entry.allocated = next;
        entry.onAllocationChange(next);
      }
    }
  }

  private ensureRunning() {
    if (this.rafId !== null) return;
    this.startTime = performance.now();
    const loop = (now: number) => {
      const elapsed = now - this.startTime;
      this.frameCount++;
      const skipFrame =
        this.totalAllocated > FRAME_SKIP_PARTICLE_THRESHOLD && this.frameCount % 2 === 0;
      if (!skipFrame) {
        this.tickSubscribers.forEach((cb) => cb(elapsed));
      }
      if (this.tickSubscribers.size === 0) {
        this.rafId = null;
        return;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }
}

/** Module-level singleton — one per browser tab, shared by all FlowEdges. */
export const particleClock = new ParticleClock();
