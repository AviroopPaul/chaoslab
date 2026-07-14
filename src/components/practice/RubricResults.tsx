import { CheckCircle2, XCircle } from 'lucide-react';

import type { GradeReport, Question } from '../../lib/practice/types';
import { alphaVar, formatCurrency, formatMs, formatPercent } from '../lab/format';

/**
 * Results tab (SPEC-PRACTICE.md §8): big score, Accepted/"Not yet" banner,
 * rubric list grouped pass/fail (each with why/failHint), and a sim summary
 * at target load vs. budgets.
 */
export default function RubricResults({ report, budgets }: { report: GradeReport; budgets: Question['budgets'] }) {
  const passedItems = report.items.filter((r) => r.passed);
  const failedItems = report.items.filter((r) => !r.passed);
  const verdictColor = report.accepted ? 'var(--health-ok)' : 'var(--health-warn)';
  // Fairness-fix #2: only surface the bottleneck summary when it's actually
  // explaining a failure — a sim-type rubric check (availability/p99/cost/
  // healthy/no-overload) failed, not just a structural/config item.
  const failedSimCheck = failedItems.some((r) => r.item.check.type === 'sim');

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex items-center justify-between rounded-xl border p-4"
        style={{ borderColor: alphaVar(verdictColor, 55), background: alphaVar(verdictColor, 14) }}
      >
        <div>
          <div className="font-mono text-3xl font-bold tabular-nums" style={{ color: verdictColor }}>
            {report.score}
            <span className="text-base font-normal text-muted">/100</span>
          </div>
          <div className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: verdictColor }}>
            {report.accepted ? 'Accepted' : 'Not yet'}
          </div>
        </div>
        {report.accepted ? (
          <CheckCircle2 size={32} style={{ color: verdictColor }} />
        ) : (
          <XCircle size={32} style={{ color: verdictColor }} />
        )}
      </div>

      {failedSimCheck && report.bottleneckSummary && (
        <div
          className="rounded-lg border p-3"
          style={{ borderColor: alphaVar('var(--health-overloaded)', 40), background: alphaVar('var(--health-overloaded)', 10) }}
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--health-overloaded)' }}>
            What&apos;s actually melting
          </div>
          <p className="mt-1 text-[12px] leading-snug text-foreground">{report.bottleneckSummary}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <SimStat
          label="Availability"
          value={formatPercent(report.sim.totals.availability)}
          ok={report.sim.totals.availability >= budgets.availability}
        />
        <SimStat label="p99" value={formatMs(report.sim.totals.p99Ms)} ok={report.sim.totals.p99Ms <= budgets.p99Ms} />
        <SimStat
          label="Cost"
          value={formatCurrency(report.sim.totals.costPerMonth)}
          ok={report.sim.totals.costPerMonth <= budgets.costPerMonth}
        />
      </div>

      {failedItems.length > 0 && (
        <RubricGroup title="Failing" items={failedItems} passed={false} />
      )}
      {passedItems.length > 0 && (
        <RubricGroup title="Passing" items={passedItems} passed />
      )}
    </div>
  );
}

function SimStat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  const color = ok ? 'var(--health-ok)' : 'var(--health-overloaded)';
  return (
    <div className="rounded-lg border p-2" style={{ borderColor: alphaVar(color, 40) }}>
      <div className="font-mono text-[13px] font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function RubricGroup({
  title,
  items,
  passed,
}: {
  title: string;
  items: GradeReport['items'];
  passed: boolean;
}) {
  const color = passed ? 'var(--health-ok)' : 'var(--health-overloaded)';
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {items.map(({ item, passed: itemPassed }) => (
        <div key={item.id} className="rounded-lg border p-3" style={{ borderColor: alphaVar(color, 30) }}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              {itemPassed ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--health-ok)' }} />
              ) : (
                <XCircle size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--health-overloaded)' }} />
              )}
              <span className="text-[12px] font-medium text-foreground">{item.label}</span>
            </div>
            <span className="shrink-0 font-mono text-[11px] text-muted">{item.points} pts</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-muted">{item.why}</p>
          {!itemPassed && <p className="mt-1 text-[11px] leading-snug text-health-warn">{item.failHint}</p>}
        </div>
      ))}
    </div>
  );
}
