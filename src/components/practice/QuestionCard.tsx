import Link from 'next/link';
import { Circle, CircleCheck, CircleDot } from 'lucide-react';

import type { Difficulty, Question } from '../../lib/practice/types';
import type { QuestionProgress } from '../../lib/practice/progress';
import { alphaVar } from '../lab/format';

const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  easy: 'var(--health-ok)',
  medium: 'var(--health-warn)',
  hard: 'var(--health-overloaded)',
};

const STATUS_META = {
  todo: { Icon: Circle, color: 'var(--muted)', label: 'Todo' },
  attempted: { Icon: CircleDot, color: 'var(--health-warn)', label: 'Attempted' },
  solved: { Icon: CircleCheck, color: 'var(--health-ok)', label: 'Solved' },
} as const;

/**
 * One row in the landing page's LeetCode-style Questions list
 * (SPEC-PRACTICE.md §7): status icon, title, difficulty chip, tags, best
 * score. Also reused as-is for a more compact list anywhere else a question
 * needs a one-line summary.
 */
export default function QuestionCard({ question, progress }: { question: Question; progress: QuestionProgress }) {
  const status = STATUS_META[progress.status];

  return (
    <Link
      href={`/practice/${question.id}`}
      className="glass-panel group flex items-center gap-4 rounded-xl border border-panel-border px-4 py-3 transition-colors duration-150 hover:border-accent/50 hover:bg-[var(--hover-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
    >
      <status.Icon
        size={18}
        className="shrink-0"
        style={{ color: status.color }}
        aria-label={status.label}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground group-hover:text-accent">
            {question.title}
          </span>
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ borderColor: alphaVar(DIFFICULTY_COLOR[question.difficulty], 55), color: DIFFICULTY_COLOR[question.difficulty] }}
          >
            {question.difficulty}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {question.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full px-2 py-0.5 text-[10px] text-muted"
              style={{ background: 'var(--chip-bg)' }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {progress.bestScore > 0 ? `${progress.bestScore}/100` : '—'}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted">best score</div>
      </div>
    </Link>
  );
}
