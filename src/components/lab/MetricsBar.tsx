'use client';

import { AlertTriangle, CheckCircle2, Flame } from 'lucide-react';

import { useLabStore } from '../../store/useLabStore';
import { BOTTLENECK_SUGGESTIONS, formatCompact, formatCurrency, formatMs, formatPercent } from './format';

const VERDICT_META = {
  healthy: { label: 'HEALTHY', color: 'var(--health-ok)', Icon: CheckCircle2, pulse: false },
  degraded: { label: 'DEGRADED', color: 'var(--health-warn)', Icon: AlertTriangle, pulse: false },
  meltdown: { label: 'MELTDOWN', color: 'var(--health-down)', Icon: Flame, pulse: true },
} as const;

function Metric({
  label,
  value,
  valueColor,
  big,
}: {
  label: string;
  value: string;
  valueColor?: string;
  big?: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <span
        className={`font-mono tabular-nums ${big ? 'text-base font-semibold' : 'text-[13px]'}`}
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

export default function MetricsBar() {
  const totals = useLabStore((s) => s.result.totals);
  const nodes = useLabStore((s) => s.nodes);

  const verdict = VERDICT_META[totals.verdict];
  const bottleneckId = totals.bottlenecks[0];
  const bottleneckNode = nodes.find((n) => n.id === bottleneckId)?.data.simNode;
  const suggestion = bottleneckNode ? BOTTLENECK_SUGGESTIONS[bottleneckNode.kind] : null;

  return (
    <footer className="chaos-metrics glass-panel flex h-14 shrink-0 items-center gap-6 overflow-x-auto px-4 text-[12px]">
      <Metric label="Offered" value={`${formatCompact(totals.offeredRps)} rps`} />
      <Metric label="Served" value={`${formatCompact(totals.servedRps)} rps`} />
      <Metric label="Availability" value={formatPercent(totals.availability)} valueColor={verdict.color} big />
      <Metric label="p50" value={formatMs(totals.p50Ms)} />
      <Metric label="p99" value={formatMs(totals.p99Ms)} />
      <Metric label="Cost" value={formatCurrency(totals.costPerMonth)} />

      <div className="h-8 w-px shrink-0" style={{ background: 'var(--panel-border)' }} />

      <span
        className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold tracking-wide ${
          verdict.pulse ? 'chaos-verdict-pulse' : ''
        }`}
        style={{ borderColor: `${verdict.color}66`, color: verdict.color, background: `${verdict.color}14` }}
      >
        <verdict.Icon size={13} />
        {verdict.label}
      </span>

      {bottleneckNode && suggestion ? (
        <span className="min-w-0 truncate text-muted">
          <span className="text-foreground">Bottleneck: {bottleneckNode.label}</span> — {suggestion}
        </span>
      ) : totals.graphWarnings.length > 0 ? (
        <span className="min-w-0 truncate text-health-warn">{totals.graphWarnings[0]}</span>
      ) : null}
    </footer>
  );
}
