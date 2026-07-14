import { ChevronRight } from 'lucide-react';

import type { Difficulty, Question } from '../../lib/practice/types';
import ComponentDatasheet from '../lab/ComponentDatasheet';
import { alphaVar, formatCompact, formatCurrency, formatMs, formatPercent } from '../lab/format';
import Markdown from './Markdown';

const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  easy: 'var(--health-ok)',
  medium: 'var(--health-warn)',
  hard: 'var(--health-overloaded)',
};

/** Problem tab (SPEC-PRACTICE.md §8): title/difficulty/tags, statement, scale, budget chips. */
export default function ProblemPanel({ question }: { question: Question }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[16px] font-semibold text-foreground">{question.title}</h1>
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{
              borderColor: alphaVar(DIFFICULTY_COLOR[question.difficulty], 55),
              color: DIFFICULTY_COLOR[question.difficulty],
            }}
          >
            {question.difficulty}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {question.tags.map((tag) => (
            <span key={tag} className="rounded-full px-2 py-0.5 text-[10px] text-muted" style={{ background: 'var(--chip-bg)' }}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      <Markdown text={question.statement} />

      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--panel-border)' }}>
        <Markdown text={question.scale} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border p-2" style={{ borderColor: 'var(--panel-border)' }}>
          <div className="font-mono text-[13px] font-semibold text-foreground">{formatPercent(question.budgets.availability)}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">availability</div>
        </div>
        <div className="rounded-lg border p-2" style={{ borderColor: 'var(--panel-border)' }}>
          <div className="font-mono text-[13px] font-semibold text-foreground">{formatMs(question.budgets.p99Ms)}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">p99 budget</div>
        </div>
        <div className="rounded-lg border p-2" style={{ borderColor: 'var(--panel-border)' }}>
          <div className="font-mono text-[13px] font-semibold text-foreground">{formatCurrency(question.budgets.costPerMonth)}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">cost budget</div>
        </div>
      </div>

      <p className="text-[11px] text-muted">
        Graded at <span className="font-mono text-accent">{formatCompact(question.targetLoad.users)}</span> users.
      </p>

      {/* Fairness-fix #1: every capacity/cost fact the rubric and sim rely on,
       * written down in plain English instead of requiring reverse-engineering
       * the sim engine. Collapsed by default so it doesn't crowd the statement. */}
      <details className="group rounded-lg border" style={{ borderColor: 'var(--panel-border)' }}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight size={13} className="shrink-0 text-muted transition-transform duration-150 group-open:rotate-90" />
          📋 Component datasheet
        </summary>
        <div className="border-t px-3 py-3" style={{ borderColor: 'var(--panel-border)' }}>
          <ComponentDatasheet />
        </div>
      </details>
    </div>
  );
}
