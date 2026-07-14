'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Zap } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { CATALOG } from '../../../lib/sim/catalog';
import type { ComponentKind, Health, NodeConfig, NodeMetrics } from '../../../lib/sim/types';
import { useLabStore, type LabNode } from '../../../store/useLabStore';
import { alphaVar, formatCompact, formatUtilization, healthVar } from '../format';
import { iconFor } from './iconMap';

/**
 * Small config badges per kind (SPEC.md §7: "4 shards, ...").
 * The server's horizontal-scale story used to live here too (a static `×N` /
 * `⚡×N` text badge) but is now a live "replica set" visualization — see
 * `ReplicaStack` / `PodGrid` below — so `server` is intentionally absent
 * from this switch and falls through to the empty default.
 */
function configBadges(kind: ComponentKind, config: NodeConfig): string[] {
  switch (kind) {
    case 'database': {
      const shards = config.shards ?? 1;
      const badges = [`${shards} shard${shards === 1 ? '' : 's'}`];
      const replicas = config.readReplicas ?? 0;
      if (replicas > 0) badges.push(`${replicas} replica${replicas === 1 ? '' : 's'}`);
      return badges;
    }
    case 'cache':
    case 'cdn':
      return [`${Math.round((config.hitRatio ?? 0) * 100)}% hit`];
    case 'ratelimiter':
      return [`${formatCompact(config.limitRps ?? 0)} limit`];
    case 'loadbalancer':
      return [config.algorithm === 'least-connections' ? 'least-conn' : 'round-robin'];
    case 'queue':
      return [`${config.workers ?? 0} workers`];
    default:
      return [];
  }
}

/** Effective (live) horizontal-scale count for a server node (Task C.4 note
 * still applies: while autoscaling is on, the configured `instances` field
 * is just a starting point the autoscaler immediately overrides). Falls
 * back to the static `config.instances` otherwise. */
function effectiveServerInstances(config: NodeConfig, metrics?: NodeMetrics): number {
  const raw =
    config.autoscale === 'on' ? metrics?.effectiveInstances ?? config.instances ?? 1 : config.instances ?? 1;
  return Math.max(1, Math.round(raw));
}

/** 2 instances -> 1 shadow layer, 3-9 -> 2, 10+ -> 3, else (1 instance) -> 0. */
function shadowLayerCount(instances: number): number {
  if (instances >= 10) return 3;
  if (instances >= 3) return 2;
  if (instances === 2) return 1;
  return 0;
}

const POD_GRID_SLOTS = 16;
const POD_SQUARE_SLOTS = POD_GRID_SLOTS - 1; // last slot reserved for the "+N" chip once we overflow

/**
 * Smoothly animates a discrete unit count (pod squares) across renders.
 * Growth is applied immediately, computed during render (the React-blessed
 * "adjusting state when a prop changes" pattern — comparing `target` against
 * a mirrored `priorTarget` state and updating both in the same pass — rather
 * than a `useEffect` calling `setState` in its body, which cascades an extra
 * render for no benefit here). Freshly-mounted squares play their "pop in"
 * keyframe on their own since it's a first paint. Shrinkage is deferred by
 * one CSS transition duration so the outgoing squares can play a "shrink
 * out" keyframe (toggled via `chaos-pod-exiting`) before actually leaving
 * the DOM — that delay genuinely needs an effect (it's a subscription to a
 * timer), so only the timeout's callback calls `setState`.
 */
function useAnimatedCount(target: number, exitMs = 180) {
  const [priorTarget, setPriorTarget] = useState(target);
  const [display, setDisplay] = useState(target);
  const [shrinkingFrom, setShrinkingFrom] = useState<number | null>(null);

  if (target !== priorTarget) {
    setPriorTarget(target);
    if (target > display) {
      setDisplay(target);
      setShrinkingFrom(null);
    } else {
      setShrinkingFrom(target);
    }
  }

  useEffect(() => {
    if (shrinkingFrom === null) return;
    const timer = setTimeout(() => {
      setDisplay(shrinkingFrom);
      setShrinkingFrom(null);
    }, exitMs);
    return () => clearTimeout(timer);
  }, [shrinkingFrom, exitMs]);

  return { display, shrinkingFrom };
}

/** Stacked-card depth effect behind the node card — pure CSS, absolutely
 * positioned siblings that never contribute to the flex/auto layout size RF
 * measures, so they can't perturb handle positions or the node's bounding
 * box used for edges/minimap/selection. */
function ReplicaStack({ instances }: { instances: number }) {
  const layers = shadowLayerCount(instances);
  const [priorLayers, setPriorLayers] = useState(layers);
  const [enteringIndex, setEnteringIndex] = useState<number | null>(null);

  if (layers !== priorLayers) {
    setPriorLayers(layers);
    setEnteringIndex(layers > priorLayers ? layers : null);
  }

  useEffect(() => {
    if (enteringIndex === null) return;
    const timer = setTimeout(() => setEnteringIndex(null), 260);
    return () => clearTimeout(timer);
  }, [enteringIndex]);

  if (layers === 0) return null;

  return (
    <>
      {Array.from({ length: layers }, (_, i) => i + 1).map((n) => (
        <div
          key={n}
          className={`chaos-shadow-card chaos-shadow-card-${n} ${n === enteringIndex ? 'chaos-shadow-card-enter' : ''}`}
        />
      ))}
    </>
  );
}

/** Compact GKE-pod-style grid: one small rounded square per instance, tinted
 * by the node's health color, capped at 16 slots (15 squares + overflow
 * chip). Lives below the metrics row, inside the card. */
function PodGrid({ instances, color, autoscaleOn, pinned }: { instances: number; color: string; autoscaleOn: boolean; pinned: boolean }) {
  const { display, shrinkingFrom } = useAnimatedCount(instances);
  const overflowing = display > POD_GRID_SLOTS;
  const squareCount = overflowing ? POD_SQUARE_SLOTS : display;
  const overflow = overflowing ? display - POD_SQUARE_SLOTS : 0;

  // Stagger newly-mounted squares' entrance keyframe by ~20ms each. Squares
  // that already existed before this render don't replay their animation on
  // mount anyway (same DOM node, same React key), so the delay only ever
  // visibly affects the newly-added tail. `priorSquareCount` mirrors the
  // previous render's count (updated in-render, the same pattern used by
  // `useAnimatedCount` above) purely so this component can compute "how
  // many squares are new" without reading a ref during render.
  const [priorSquareCount, setPriorSquareCount] = useState(squareCount);
  if (squareCount !== priorSquareCount) {
    setPriorSquareCount(squareCount);
  }

  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <div className="chaos-pod-grid" role="img" aria-label={`${display} instance${display === 1 ? '' : 's'}`}>
        {Array.from({ length: squareCount }, (_, i) => (
          <span
            key={`pod-${i}`}
            className={`chaos-pod ${shrinkingFrom !== null && i >= shrinkingFrom ? 'chaos-pod-exiting' : ''}`}
            style={{ background: color, animationDelay: `${Math.max(0, i - priorSquareCount) * 20}ms` }}
          />
        ))}
        {overflow > 0 && (
          <span className="chaos-pod-chip" title={`${display} instances total`}>
            +{formatCompact(overflow)}
          </span>
        )}
      </div>
      {autoscaleOn && (
        <span
          className="flex shrink-0 items-center gap-0.5 text-[9px] font-medium"
          style={{ color: pinned ? 'var(--health-warn)' : 'var(--muted)' }}
          title={pinned ? 'Autoscaler pinned at max instances' : 'Autoscaling on'}
        >
          <Zap size={9} strokeWidth={2.5} />
          auto
        </span>
      )}
    </div>
  );
}

export default function ComponentNode({ id, data, selected }: NodeProps<LabNode>) {
  const { simNode } = data;
  const entry = CATALOG[simNode.kind];
  const metrics = useLabStore((s) => s.result.nodes[id]);
  // Wrapped in an object so the JSX tag below is a member expression
  // (`icon.Icon`) rather than a bare identifier bound from a call — avoids
  // react-hooks/static-components flagging a dynamic icon lookup as
  // "creating a component during render" (it isn't; lucide icons are
  // stable module-scope exports, just selected by name here).
  const icon = { Icon: iconFor(entry.icon) };

  const health: Health = metrics?.health ?? 'idle';
  const color = healthVar(health);
  const badges = configBadges(simNode.kind, simNode.config);
  const warnings = metrics?.warnings ?? [];

  const isServer = simNode.kind === 'server';
  const serverInstances = isServer ? effectiveServerInstances(simNode.config, metrics) : 1;
  const autoscaleOn = isServer && simNode.config.autoscale === 'on';
  const pinnedAtMax =
    autoscaleOn && simNode.config.maxInstances !== undefined && serverInstances >= simNode.config.maxInstances;

  // Task C.4 — live status badges layered on top of the static config
  // badges: an amber "retries" badge while retry amplification is actually
  // adding demand downstream, and a red "breaker open" badge while the
  // circuit breaker is actively shedding traffic rather than forwarding it.
  const isRetrying = simNode.kind === 'server' && (metrics?.retriedRps ?? 0) > 1e-9;
  const isBreakerOpen =
    simNode.kind === 'server' && simNode.config.circuitBreaker === 'on' && (metrics?.shedRps ?? 0) > 1e-9;

  return (
    <div className="chaos-node-stack">
      {isServer && <ReplicaStack instances={serverInstances} />}
      <div
        className={`chaos-node glass-panel relative flex w-[180px] flex-col rounded-xl px-3 py-2.5 transition-shadow duration-150 ${
          health === 'down' ? 'chaos-node-pulse' : ''
        }`}
        style={{
          borderColor: selected ? 'var(--accent-strong)' : color,
          boxShadow: selected
            ? 'var(--node-select-shadow)'
            : `0 0 0 1px ${alphaVar(color, 33)}, 0 0 10px ${alphaVar(color, 15)}`,
        }}
      >
        {simNode.kind !== 'users' && (
          <Handle type="target" position={Position.Left} className="chaos-handle" />
        )}
        <Handle type="source" position={Position.Right} className="chaos-handle" />

        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: `${entry.accent}1a`, color: entry.accent }}
          >
            <icon.Icon size={16} strokeWidth={2} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium leading-tight text-foreground">{simNode.label}</span>
            {/* Fairness-fix #6: a custom-labeled node ("Redirect Cache") should
             * still self-identify its underlying kind on canvas, without a
             * hidden-knowledge trip to the inspector — only rendered when the
             * label actually diverges from the catalog name, so the common
             * case (label === kind name) stays exactly as compact as before. */}
            {simNode.label !== entry.name && (
              <span className="truncate text-[8px] font-semibold uppercase leading-tight tracking-wider text-muted">
                {entry.name}
              </span>
            )}
          </span>
          {warnings.length > 0 && (
            <span
              title={warnings.join('\n')}
              className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center text-health-warn"
            >
              <AlertTriangle size={13} strokeWidth={2.25} />
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between font-mono text-[11px] tabular-nums text-muted">
          <span>{formatCompact(metrics?.inRps ?? 0)} rps</span>
          <span>{formatUtilization(metrics?.utilization ?? 0)}</span>
          <span>{Math.round(metrics?.latencyMs ?? 0)}ms</span>
        </div>

        {isServer && <PodGrid instances={serverInstances} color={color} autoscaleOn={autoscaleOn} pinned={pinnedAtMax} />}

        {(badges.length > 0 || isRetrying || isBreakerOpen) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {badges.map((b) => (
              <span
                key={b}
                className="rounded-full px-1.5 py-0.5 text-[10px] text-muted"
                style={{ background: 'var(--chip-bg)' }}
              >
                {b}
              </span>
            ))}
            {isRetrying && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: alphaVar('var(--health-warn)', 14), color: 'var(--health-warn)' }}
              >
                ↻ retries
              </span>
            )}
            {isBreakerOpen && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: alphaVar('var(--health-overloaded)', 14), color: 'var(--health-overloaded)' }}
              >
                ⛔ breaker open
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
