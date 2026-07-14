'use client';

import { ExternalLink, Lock, MapPinned } from 'lucide-react';

import type { Question } from '../../lib/practice/types';
import { alphaVar } from '../lab/format';
import Markdown from './Markdown';

/**
 * Solution tab (SPEC-PRACTICE.md §8) — LOCKED until accepted or the user
 * gives up. Unlocked, it shows the writeup/insights/sources plus a
 * "Load optimal solution onto canvas" button.
 */
export default function SolutionView({
  question,
  unlocked,
  onGiveUp,
  onLoadSolution,
}: {
  question: Question;
  unlocked: boolean;
  onGiveUp: () => void;
  onLoadSolution: () => void;
}) {
  if (!unlocked) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border p-6 text-center" style={{ borderColor: 'var(--panel-border)' }}>
        <Lock size={22} className="text-muted" />
        <p className="text-[12px] leading-relaxed text-muted">
          The optimal solution unlocks once you&apos;re Accepted — or you can give up and reveal it now.
        </p>
        <button
          type="button"
          onClick={onGiveUp}
          className="rounded-md border px-3 py-1.5 text-[12px] font-medium text-health-warn transition-colors duration-150 hover:brightness-125"
          style={{ borderColor: alphaVar('var(--health-warn)', 55), background: alphaVar('var(--health-warn)', 14) }}
        >
          Give up &amp; reveal
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onLoadSolution}
        className="flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-[12px] font-medium text-accent transition-colors duration-150 hover:brightness-125"
        style={{ borderColor: alphaVar('var(--accent)', 55), background: alphaVar('var(--accent)', 14) }}
      >
        <MapPinned size={14} /> Load optimal solution onto canvas
      </button>

      <Markdown text={question.solution.writeup} />

      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Key insights</h3>
        <ul className="flex flex-col gap-1.5 text-[12px] leading-snug text-foreground/90">
          {question.solution.keyInsights.map((insight) => (
            <li key={insight} className="flex gap-1.5">
              <span className="mt-[2px] text-accent">•</span>
              <span>{insight}</span>
            </li>
          ))}
        </ul>
      </div>

      {question.solution.sources && question.solution.sources.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: 'var(--panel-border)' }}>
          {question.solution.sources.map((source) => (
            <a
              key={`${source.label}-${source.url}`}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-muted transition-colors duration-150 hover:text-accent"
            >
              <ExternalLink size={10} className="shrink-0" />
              <span className="truncate">{source.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
