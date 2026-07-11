'use client';

import { Cpu, Trash2, X } from 'lucide-react';

import { CATALOG, type FieldDef } from '../../../lib/sim/catalog';
import type { ComponentKind, NodeConfig } from '../../../lib/sim/types';
import { useLabStore, type LabNode } from '../../../store/useLabStore';
import { alphaVar, formatCompact, formatCurrency, formatMs, formatUtilization, healthVar } from '../format';

/** Big min/max ratio -> render a log-scale slider instead of a linear one. */
function isLogScaleField(field: FieldDef): boolean {
  const min = field.min ?? 0;
  const max = field.max ?? 0;
  if (max <= 0) return false;
  const effectiveMin = Math.max(min, 1);
  return max / effectiveMin >= 100;
}

/**
 * Conditional field visibility (Task C.3) — the catalog's field list is
 * rendered generically (SPEC.md §7), but a few "dependent" knobs are only
 * meaningful once their own toggle is switched on. Keyed by (kind, fieldKey)
 * rather than baked into catalog.ts so the catalog stays purely descriptive.
 */
const FIELD_VISIBILITY: Partial<Record<ComponentKind, Partial<Record<string, (config: NodeConfig) => boolean>>>> = {
  server: {
    minInstances: (config) => config.autoscale === 'on',
    maxInstances: (config) => config.autoscale === 'on',
    targetUtilization: (config) => config.autoscale === 'on',
    maxRetries: (config) => config.retriesEnabled === 'on',
    circuitThreshold: (config) => config.circuitBreaker === 'on',
  },
  queue: {
    subscriberCount: (config) => config.mode === 'pubsub',
  },
};

function isFieldVisible(kind: ComponentKind, field: FieldDef, config: NodeConfig): boolean {
  const rule = FIELD_VISIBILITY[kind]?.[field.key];
  return rule ? rule(config) : true;
}

function MetricRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums text-foreground" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}

function Field({
  field,
  config,
  onChange,
}: {
  field: FieldDef;
  config: NodeConfig;
  onChange: (key: keyof NodeConfig, value: number | string) => void;
}) {
  const raw = config[field.key];

  if (field.type === 'select') {
    const value = (raw as string | undefined) ?? field.options?.[0] ?? '';
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-foreground">{field.label}</span>
        <div className="chaos-segmented flex overflow-hidden rounded-md border" style={{ borderColor: 'var(--panel-border)' }}>
          {field.options?.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(field.key, opt)}
              className={`flex-1 px-2 py-1.5 text-[11px] transition-colors duration-150 ${
                value === opt ? 'bg-accent/20 text-accent' : 'text-muted hover:text-foreground'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        {field.help && <p className="text-[10px] leading-snug text-muted">{field.help}</p>}
      </div>
    );
  }

  if (field.type === 'percent') {
    const value = typeof raw === 'number' ? raw : 0;
    const pct = Math.round(value * 100);
    const step = Math.max(1, Math.round((field.step ?? 0.01) * 100));
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-foreground">{field.label}</span>
          <span className="font-mono text-[12px] tabular-nums text-accent">{pct}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={step}
          value={pct}
          onChange={(e) => onChange(field.key, Number(e.target.value) / 100)}
          className="chaos-range w-full"
        />
        {field.help && <p className="text-[10px] leading-snug text-muted">{field.help}</p>}
      </div>
    );
  }

  // number field
  const min = field.min ?? 0;
  const max = field.max ?? 100;
  const value = typeof raw === 'number' ? raw : min;

  if (isLogScaleField(field)) {
    const logMin = Math.log10(Math.max(min, 1));
    const logMax = Math.log10(Math.max(max, logMin + 1));
    const sliderVal = Math.log10(Math.max(value, 1));
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-foreground">{field.label}</span>
          <span className="font-mono text-[12px] tabular-nums text-accent">{formatCompact(value)}</span>
        </div>
        <input
          type="range"
          min={logMin}
          max={logMax}
          step={0.001}
          value={sliderVal}
          onChange={(e) => {
            const next = Math.round(10 ** Number(e.target.value));
            onChange(field.key, Math.min(max, Math.max(min, next)));
          }}
          className="chaos-range w-full"
        />
        {field.help && <p className="text-[10px] leading-snug text-muted">{field.help}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-foreground">{field.label}</span>
        <span className="font-mono text-[12px] tabular-nums text-accent">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={field.step ?? 1}
        value={value}
        onChange={(e) => onChange(field.key, Number(e.target.value))}
        className="chaos-range w-full"
      />
      {field.help && <p className="text-[10px] leading-snug text-muted">{field.help}</p>}
    </div>
  );
}

export default function Inspector({ node }: { node: LabNode }) {
  const selectNode = useLabStore((s) => s.selectNode);
  const updateNodeConfig = useLabStore((s) => s.updateNodeConfig);
  const setUsers = useLabStore((s) => s.setUsers);
  const deleteSelection = useLabStore((s) => s.deleteSelection);
  const metrics = useLabStore((s) => s.result.nodes[node.id]);

  const { simNode } = node.data;
  const entry = CATALOG[simNode.kind];
  const health = metrics?.health ?? 'idle';

  // Autoscaler status line (Task: replica-set visualization §5) — only
  // meaningful for a server with autoscaling on and a resolved instance
  // count from the sim. Amber once the autoscaler is pinned at the
  // configured ceiling (traffic beyond what maxInstances can serve gets
  // dropped, so this is a meaningful "you're at the wall" signal).
  const autoscalerInfo =
    simNode.kind === 'server' && simNode.config.autoscale === 'on' && metrics?.effectiveInstances !== undefined
      ? {
          effective: metrics.effectiveInstances,
          max: simNode.config.maxInstances ?? metrics.effectiveInstances,
          pinned:
            simNode.config.maxInstances !== undefined && metrics.effectiveInstances >= simNode.config.maxInstances,
        }
      : null;

  function setField(key: keyof NodeConfig, value: number | string) {
    // The users node's `users` field is normally driven by the global slider
    // in the toolbar — route edits through setUsers so global config and
    // the node's own config stay in sync instead of drifting apart.
    if (simNode.kind === 'users' && key === 'users' && typeof value === 'number') {
      setUsers(value);
      return;
    }
    updateNodeConfig(node.id, { [key]: value } as Partial<NodeConfig>);
  }

  return (
    <aside className="chaos-inspector glass-panel flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">{simNode.label}</h2>
          <p className="text-[11px] uppercase tracking-wider text-muted">{entry.name}</p>
        </div>
        <button
          type="button"
          onClick={() => selectNode(null)}
          aria-label="Close inspector"
          className="rounded-md p-1 text-muted transition-colors duration-150 hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      <p className="text-[12px] leading-relaxed text-muted">{entry.description}</p>

      {entry.hardware && (
        <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
          <Cpu size={11} className="shrink-0 opacity-70" />
          <span className="truncate">{entry.hardware}</span>
        </p>
      )}

      <div
        className="chaos-metrics-grid grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border p-3 text-[11px]"
        style={{ borderColor: 'var(--panel-border)' }}
      >
        <MetricRow label="Health" value={health} valueColor={healthVar(health)} />
        <MetricRow label="In" value={`${formatCompact(metrics?.inRps ?? 0)} rps`} />
        <MetricRow label="Served" value={`${formatCompact(metrics?.servedRps ?? 0)} rps`} />
        <MetricRow label="Dropped" value={`${formatCompact(metrics?.droppedRps ?? 0)} rps`} />
        <MetricRow label="Shed" value={`${formatCompact(metrics?.shedRps ?? 0)} rps`} />
        <MetricRow label="Utilization" value={formatUtilization(metrics?.utilization ?? 0)} />
        <MetricRow label="Latency" value={formatMs(metrics?.latencyMs ?? 0)} />
        <MetricRow label="Cost" value={formatCurrency(metrics?.costPerMonth ?? 0)} />
      </div>

      {autoscalerInfo && (
        <p
          className="rounded-lg border px-3 py-2 font-mono text-[11px]"
          style={{
            borderColor: autoscalerInfo.pinned ? alphaVar('var(--health-warn)', 35) : 'var(--panel-border)',
            background: autoscalerInfo.pinned ? alphaVar('var(--health-warn)', 6) : 'transparent',
            color: autoscalerInfo.pinned ? 'var(--health-warn)' : 'var(--muted)',
          }}
        >
          Autoscaler: {formatCompact(autoscalerInfo.effective)} of {formatCompact(autoscalerInfo.max)} max instances
        </p>
      )}

      {metrics && metrics.warnings.length > 0 && (
        <ul
          className="chaos-warnings flex flex-col gap-1 rounded-lg border px-3 py-2 text-[11px] text-health-warn"
          style={{ borderColor: alphaVar('var(--health-warn)', 35), background: alphaVar('var(--health-warn)', 6) }}
        >
          {metrics.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {entry.fields.length > 0 && (
        <div className="flex flex-col gap-4">
          {entry.fields
            .filter((field) => isFieldVisible(simNode.kind, field, simNode.config))
            .map((field) => (
              <Field key={field.key} field={field} config={simNode.config} onChange={setField} />
            ))}
        </div>
      )}

      <button
        type="button"
        onClick={deleteSelection}
        className="chaos-delete-btn mt-auto flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-[12px] font-medium transition-colors duration-150 hover:brightness-125"
        style={{
          borderColor: alphaVar('var(--health-overloaded)', 40),
          color: 'var(--health-overloaded)',
          background: alphaVar('var(--health-overloaded)', 8),
        }}
      >
        <Trash2 size={14} /> Delete node
      </button>
    </aside>
  );
}
