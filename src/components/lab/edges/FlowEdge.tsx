'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

import type { Health } from '../../../lib/sim/types';
import { alphaVar } from '../format';
import { useLabStore, type LabEdge } from '../../../store/useLabStore';
import { particleClock } from './particleClock';

/**
 * Custom "live wire" edge (SPEC.md §7). A bezier path whose width/color
 * react to live sim results, plus a handful of particle dots that travel
 * source -> target.
 *
 * Particle *count* is not decided locally — each edge registers its desired
 * count (derived from rps) with the shared `particleClock`, which enforces a
 * GLOBAL ~400 particle budget across every edge on the canvas and only tells
 * this component to re-render when its own allocated count actually changes
 * (see particleClock.ts for the renormalization/prioritization logic). On
 * small graphs the budget is never hit and every edge just gets its desired
 * count, same as before.
 *
 * Perf: the actual per-frame animation work happens in a callback registered
 * with the single shared `particleClock`, which mutates `<circle>` cx/cy/
 * opacity attributes directly via refs (no React re-render per frame).
 *
 * Critically, that callback never calls `getPointAtLength()` during
 * animation. Profiling the unfixed version under Planet Scale (606 edges)
 * showed `Layout` eating ~85% of every frame — `getPointAtLength()` forces a
 * synchronous layout, and calling it once per particle per frame across
 * hundreds of edges is textbook layout thrashing, independent of the global
 * particle budget. Instead, whenever this edge's path geometry changes (on
 * mount / node drag — NOT every animation frame) we sample a fixed number of
 * points along the curve once and cache them; the animation loop then just
 * linearly interpolates between two cached samples, which is pure
 * arithmetic with zero DOM reads.
 */

const MAX_PARTICLES = 10;
const TRAVERSAL_MS = 1500;
const DROP_FADE_START = 0.7;
/** Cached samples per edge path — plenty for a smooth-looking bezier curve. */
const PATH_SAMPLE_COUNT = 24;

function strokeWidthFor(rps: number): number {
  if (rps <= 0) return 1.5;
  const scaled = 1.5 + (Math.log10(rps + 1) / 6) * 2.5;
  return Math.min(4, Math.max(1.5, scaled));
}

/**
 * Themed edge stroke colors. Neutral (no traffic / idle) strokes are tinted
 * off `--foreground` — light and near-white on the dark theme's near-black
 * canvas, dark and low-alpha on the light theme's off-white canvas — so they
 * stay faint-but-visible against either background without a dedicated
 * pair of vars. Health-tinted strokes ride the same `--health-*` tokens the
 * rest of the app uses, alpha-blended via `alphaVar()` (`color-mix()`) —
 * see format.ts for why this replaced the previous "var() + hex suffix"
 * trick, which produced an invalid `stroke` value and made every edge
 * invisible (this was defect 1: only the particle dots ever rendered).
 */
function edgeStrokeColor(health: Health, active: boolean): string {
  if (!active) return alphaVar('var(--foreground)', 12);
  switch (health) {
    case 'idle':
      return alphaVar('var(--foreground)', 16);
    case 'ok':
      return alphaVar('var(--health-ok)', 40);
    case 'warn':
      return alphaVar('var(--health-warn)', 50);
    case 'hot':
      return alphaVar('var(--health-hot)', 60);
    case 'overloaded':
      return alphaVar('var(--health-overloaded)', 70);
    case 'down':
      return alphaVar('var(--health-down)', 80);
    default:
      return alphaVar('var(--foreground)', 16);
  }
}

export default function FlowEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  target,
  selected,
}: EdgeProps<LabEdge>) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const geometryRef = useRef<{ length: number; samples: Float32Array } | null>(null);
  const circleRefs = useRef<(SVGCircleElement | null)[]>([]);
  const [count, setCount] = useState(0);
  const [hovered, setHovered] = useState(false);

  const rps = useLabStore((s) => s.result.edges[id]?.rps ?? 0);
  const droppedShare = useLabStore((s) => s.result.edges[id]?.droppedShare ?? 0);
  const targetHealth = useLabStore((s) => s.result.nodes[target]?.health ?? 'idle');
  const deleteEdge = useLabStore((s) => s.deleteEdge);

  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const active = rps > 0;
  const redCount = Math.min(count, Math.round(droppedShare * count));
  const width = strokeWidthFor(rps);
  const isHot = targetHealth === 'hot' || targetHealth === 'warn';
  const strokeColor = selected ? 'var(--accent-strong)' : edgeStrokeColor(targetHealth, active);

  // Stable per-particle phase offsets so particles don't bunch up.
  const phases = useMemo(
    () => Array.from({ length: MAX_PARTICLES }, (_, i) => i / MAX_PARTICLES),
    [],
  );

  // Register this edge's desired particle share with the shared global
  // budget allocator once on mount; `setCount` only fires when the *global*
  // renormalization actually changes this edge's allocation, not per frame.
  useEffect(() => {
    return particleClock.registerEdge(id, rps, setCount);
    // Deliberately only re-run on `id` change — rps updates flow through the
    // effect below instead, so a rps-only change doesn't tear down and
    // re-register (which would reset this edge's allocated count to 0 for a
    // tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    particleClock.updateEdgeRps(id, rps);
  }, [id, rps]);

  // Sample the path geometry once per path change (mount / node drag) rather
  // than querying it every animation frame — see the perf note above.
  useEffect(() => {
    const pathEl = pathRef.current;
    if (!pathEl) {
      geometryRef.current = null;
      return;
    }
    const length = pathEl.getTotalLength();
    const samples = new Float32Array(PATH_SAMPLE_COUNT * 2);
    for (let i = 0; i < PATH_SAMPLE_COUNT; i++) {
      const point = pathEl.getPointAtLength((i / (PATH_SAMPLE_COUNT - 1)) * length);
      samples[i * 2] = point.x;
      samples[i * 2 + 1] = point.y;
    }
    geometryRef.current = { length, samples };
  }, [path]);

  useEffect(() => {
    if (count === 0) return undefined;
    const unsubscribe = particleClock.subscribeTick(id, (elapsed) => {
      const geometry = geometryRef.current;
      if (!geometry || !geometry.length) return;
      const { samples } = geometry;
      for (let i = 0; i < count; i++) {
        const circle = circleRefs.current[i];
        if (!circle) continue;
        const t = (((elapsed / TRAVERSAL_MS + phases[i]) % 1) + 1) % 1;
        // Interpolate between two precomputed samples — pure arithmetic,
        // no getPointAtLength() (and therefore no forced layout) per frame.
        const idx = t * (PATH_SAMPLE_COUNT - 1);
        const i0 = Math.floor(idx);
        const i1 = Math.min(i0 + 1, PATH_SAMPLE_COUNT - 1);
        const frac = idx - i0;
        const x = samples[i0 * 2] + (samples[i1 * 2] - samples[i0 * 2]) * frac;
        const y = samples[i0 * 2 + 1] + (samples[i1 * 2 + 1] - samples[i0 * 2 + 1]) * frac;
        circle.setAttribute('cx', String(x));
        circle.setAttribute('cy', String(y));
        const dropped = i < redCount;
        const opacity = dropped && t > DROP_FADE_START ? Math.max(0, 1 - (t - DROP_FADE_START) / (1 - DROP_FADE_START)) : 1;
        circle.setAttribute('opacity', String(opacity));
      }
    });
    return unsubscribe;
  }, [id, count, redCount, phases]);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={20}
        className={targetHealth === 'down' && active ? 'edge-pulse-down' : undefined}
        style={{
          stroke: strokeColor,
          strokeWidth: selected ? width + 1 : width,
          transition: 'stroke 200ms ease, stroke-width 200ms ease',
        }}
      />
      {/* Invisible twin path used purely as a geometry reference for
          getTotalLength/getPointAtLength — BaseEdge's own <path> isn't ref-able
          since it's rendered by a plain function component. */}
      <path ref={pathRef} d={path} fill="none" stroke="none" />
      {/* Wide, invisible hover-detection strip (defect 2). BaseEdge's own
          20px interaction path (above) already makes the whole bezier
          clickable for selection, but it doesn't expose hover state to us —
          this sibling path, drawn on top, exists purely so we know when to
          show the delete affordance below. Clicks still bubble to the shared
          edge wrapper exactly like clicks on BaseEdge's path do, so edge
          selection/deletion behavior is unaffected. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {count > 0 && (
        <g>
          {Array.from({ length: count }).map((_, i) => (
            <circle
              key={i}
              ref={(el) => {
                circleRefs.current[i] = el;
              }}
              r={selected ? 3 : 2.5}
              fill={i < redCount ? 'var(--health-overloaded)' : isHot ? 'var(--health-warn)' : 'var(--health-ok)'}
              style={{ filter: 'drop-shadow(0 0 2px currentColor)' }}
            />
          ))}
        </g>
      )}
      {(hovered || selected) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan chaos-edge-delete"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <button
              type="button"
              className="chaos-edge-delete-btn"
              title="Delete connection"
              aria-label="Delete connection"
              onClick={(event) => {
                event.stopPropagation();
                deleteEdge(id);
              }}
            >
              <X size={10} strokeWidth={3} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
