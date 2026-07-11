'use client';

import type { DragEvent } from 'react';
import { useReactFlow } from '@xyflow/react';

import { CATALOG } from '../../lib/sim/catalog';
import type { ComponentKind } from '../../lib/sim/types';
import { useLabStore } from '../../store/useLabStore';
import { DND_MIME } from './Canvas';
import { iconFor } from './nodes/iconMap';

/** Palette card order — mirrors the SPEC.md §3 catalog table. */
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

export default function Palette() {
  const nodes = useLabStore((s) => s.nodes);
  const addNode = useLabStore((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();
  const hasUsers = nodes.some((n) => n.data.simNode.kind === 'users');

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
    <aside className="chaos-palette glass-panel flex w-[240px] shrink-0 flex-col gap-1.5 overflow-y-auto p-3">
      <h2 className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
        Components
      </h2>
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
            className={`chaos-palette-card group flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all duration-150 ${
              disabled
                ? 'cursor-not-allowed opacity-40'
                : 'cursor-grab hover:-translate-y-0.5 hover:border-accent/50 active:cursor-grabbing'
            }`}
            style={{ borderColor: 'var(--panel-border)', background: 'var(--chip-bg)' }}
          >
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ background: `${entry.accent}1a`, color: entry.accent }}
            >
              <icon.Icon size={15} strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                {entry.name}
                {disabled && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[9px] font-normal uppercase tracking-wide text-muted"
                    style={{ background: 'var(--chip-bg-strong)' }}
                  >
                    on canvas
                  </span>
                )}
              </span>
              <span className="truncate text-[11px] text-muted">{entry.description}</span>
            </span>
          </button>
        );
      })}
    </aside>
  );
}
