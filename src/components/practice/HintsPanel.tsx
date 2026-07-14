'use client';

import { useState } from 'react';
import { Eye, Lock } from 'lucide-react';

/** Hints tab (SPEC-PRACTICE.md §8): progressive, revealed one at a time. */
export default function HintsPanel({ hints }: { hints: string[] }) {
  const [revealed, setRevealed] = useState(0);

  if (hints.length === 0) {
    return <p className="text-[12px] text-muted">No hints for this question.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {hints.map((hint, i) => {
        const isRevealed = i < revealed;
        const isNext = i === revealed;
        return (
          <div
            key={i}
            className="rounded-lg border p-3 text-[12px] leading-relaxed"
            style={{ borderColor: 'var(--panel-border)' }}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Hint {i + 1}</span>
              {!isRevealed && (
                <button
                  type="button"
                  disabled={!isNext}
                  onClick={() => setRevealed(i + 1)}
                  className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted transition-colors duration-150 enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ borderColor: 'var(--panel-border)' }}
                >
                  {isNext ? <Eye size={11} /> : <Lock size={11} />}
                  Reveal
                </button>
              )}
            </div>
            {isRevealed ? (
              <p className="text-foreground/90">{hint}</p>
            ) : (
              <p aria-hidden className="select-none text-foreground/40 blur-[3px]">
                {hint}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
