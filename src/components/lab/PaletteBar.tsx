'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import { BookOpen, X } from 'lucide-react';

import { CATALOG } from '../../lib/sim/catalog';
import type { ComponentKind } from '../../lib/sim/types';
import { useLabStore } from '../../store/useLabStore';
import { DND_MIME } from './Canvas';
import ComponentDatasheet from './ComponentDatasheet';
import { iconFor } from './nodes/iconMap';

/** Palette chip order — mirrors the SPEC.md §3 catalog table. */
const PALETTE_ORDER: ComponentKind[] = [
  'users',
  'cdn',
  'loadbalancer',
  'ratelimiter',
  'server',
  'cache',
  'database',
  'queue',
  'storage',
];

/** Approx node footprint (rounded up from ComponentNode's 180px card). */
const NODE_FOOTPRINT_W = 200;
const NODE_FOOTPRINT_H = 100;
const SPIRAL_STEP = 40;
const MAX_SPIRAL_ITERATIONS = 50;

/** Two top-left-anchored ~200x100 boxes are considered "occluding" if they overlap. */
function boxesOverlap(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < NODE_FOOTPRINT_W && Math.abs(a.y - b.y) < NODE_FOOTPRINT_H;
}

/**
 * Click-to-add used to always drop new nodes at the exact pane center,
 * stacking them directly on top of anything already there (QA defect 2).
 * Starting from that same center point, step diagonally right-down in fixed
 * increments until the candidate spot clears every existing node's
 * footprint — bounded so a pathologically dense canvas still terminates and
 * just places the node anyway rather than looping forever.
 */
function findFreeSpot(
  start: { x: number; y: number },
  existing: { x: number; y: number }[],
): { x: number; y: number } {
  let candidate = start;
  for (let i = 0; i < MAX_SPIRAL_ITERATIONS; i++) {
    if (!existing.some((pos) => boxesOverlap(candidate, pos))) return candidate;
    candidate = { x: start.x + i * SPIRAL_STEP, y: start.y + i * SPIRAL_STEP };
  }
  return candidate;
}

/**
 * Horizontal component strip rendered directly under the top toolbar, on
 * both /lab/backend and /practice/[id] (product-owner layout change: frees
 * the ~240px left rail this used to occupy — see the removed `Palette.tsx`).
 * Same dnd payload + click-to-add store action as the old rail, just laid
 * out as a single scrollable row of compact chips instead of stacked cards.
 */
export default function PaletteBar() {
  const nodes = useLabStore((s) => s.nodes);
  const addNode = useLabStore((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();
  const hasUsers = nodes.some((n) => n.data.simNode.kind === 'users');

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [datasheetOpen, setDatasheetOpen] = useState(false);

  // Dismiss the datasheet popover on Escape — available in both sandbox and
  // practice, so this can't rely on any practice-specific modal machinery.
  useEffect(() => {
    if (!datasheetOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setDatasheetOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [datasheetOpen]);

  // Fade edges only render while there's actually more content to scroll to
  // in that direction — tracked from real scroll geometry rather than a
  // static always-on mask, so the strip reads as flat (no dead-looking
  // fade) whenever every chip already fits.
  const updateFade = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateFade();
    el.addEventListener('scroll', updateFade, { passive: true });
    const resizeObserver = new ResizeObserver(updateFade);
    resizeObserver.observe(el);
    window.addEventListener('resize', updateFade);
    return () => {
      el.removeEventListener('scroll', updateFade);
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateFade);
    };
  }, [updateFade]);

  function addAtCenter(kind: ComponentKind) {
    const pane = document.querySelector('.react-flow__pane');
    const rect = pane?.getBoundingClientRect();
    const center = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const flowCenter = screenToFlowPosition(center);
    const position = findFreeSpot(
      flowCenter,
      nodes.map((n) => n.position),
    );
    addNode(kind, position);
  }

  function onDragStart(event: DragEvent, kind: ComponentKind) {
    event.dataTransfer.setData(DND_MIME, kind);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div className="chaos-palette-bar glass-panel relative flex h-14 w-full shrink-0 items-center gap-3 px-3">
      <span className="shrink-0 pl-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
        Components
      </span>
      <div className="h-8 w-px shrink-0" style={{ background: 'var(--panel-border)' }} />

      <div className="relative min-w-0 flex-1">
        {canScrollLeft && <div className="chaos-palette-fade chaos-palette-fade-left" aria-hidden="true" />}
        <div ref={scrollerRef} className="chaos-palette-scroller flex min-w-0 items-center gap-2 overflow-x-auto py-2">
          {PALETTE_ORDER.map((kind) => {
            const entry = CATALOG[kind];
            // See ComponentNode.tsx for why this is wrapped in an object instead
            // of a bare `const Icon = iconFor(...)` binding.
            const icon = { Icon: iconFor(entry.icon) };
            const disabled = kind === 'users' && hasUsers;
            return (
              <button
                key={kind}
                type="button"
                draggable={!disabled}
                onDragStart={(e) => !disabled && onDragStart(e, kind)}
                onClick={() => !disabled && addAtCenter(kind)}
                disabled={disabled}
                title={entry.description}
                className={`chaos-palette-chip group flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all duration-150 ${
                  disabled
                    ? 'cursor-not-allowed opacity-40'
                    : 'cursor-grab hover:-translate-y-0.5 hover:border-accent/50 active:cursor-grabbing'
                }`}
                style={{ borderColor: 'var(--panel-border)', background: 'var(--chip-bg)' }}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                  style={{ background: `${entry.accent}1a`, color: entry.accent }}
                >
                  <icon.Icon size={12} strokeWidth={2} />
                </span>
                <span className="text-foreground">{entry.name}</span>
                {disabled && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[9px] font-normal uppercase tracking-wide text-muted"
                    style={{ background: 'var(--chip-bg-strong)' }}
                  >
                    on canvas
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {canScrollRight && <div className="chaos-palette-fade chaos-palette-fade-right" aria-hidden="true" />}
      </div>

      <div className="h-8 w-px shrink-0" style={{ background: 'var(--panel-border)' }} />
      <button
        type="button"
        onClick={() => setDatasheetOpen(true)}
        title="Component datasheet"
        aria-label="Open component datasheet"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-accent/10 hover:text-accent"
      >
        <BookOpen size={16} />
      </button>

      {datasheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6 pt-20"
          style={{ background: 'color-mix(in srgb, #000 45%, transparent)' }}
          onClick={() => setDatasheetOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Component datasheet"
            className="glass-panel w-full max-w-2xl rounded-xl border p-4 shadow-2xl"
            style={{ borderColor: 'var(--panel-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-foreground">📋 Component datasheet</h2>
              <button
                type="button"
                onClick={() => setDatasheetOpen(false)}
                aria-label="Close component datasheet"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:text-foreground"
              >
                <X size={15} />
              </button>
            </div>
            <ComponentDatasheet />
          </div>
        </div>
      )}
    </div>
  );
}
