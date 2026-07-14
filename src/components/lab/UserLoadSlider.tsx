'use client';

import { Minus, Plus } from 'lucide-react';

import { useLabStore } from '../../store/useLabStore';
import { formatCompact } from './format';

const USERS_MIN = 10;
const USERS_MAX = 500_000_000;
const LOG_MIN = Math.log10(USERS_MIN);
const LOG_MAX = Math.log10(USERS_MAX);
const STOPS = [10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 500_000_000];
// The slider's underlying range still runs all the way to 500M (USERS_MAX),
// but labeling every stop crams "100M" and "500M" into the same few pixels
// at the right edge and they render as mashed-together text (QA defect 4).
// Drop the trailing label — the "+" nudge button and the live readout still
// make it obvious the range goes past 100M.
const LABELED_STOPS = STOPS.filter((stop) => stop <= 100_000_000);

function stopLabel(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}k`;
  return `${n}`;
}

/**
 * The hero USER LOAD control (SPEC.md §7) — factored out of the sandbox
 * Toolbar so the practice workspace header can reuse the exact same slider
 * (SPEC-PRACTICE.md §8: "the user-load slider REMAINS usable for
 * experimentation") without forking its markup/behavior.
 */
export default function UserLoadSlider() {
  const users = useLabStore((s) => s.global.users);
  const setUsers = useLabStore((s) => s.setUsers);

  const sliderValue = Math.log10(Math.max(users, USERS_MIN));

  function nudge(factor: number) {
    const next = Math.round(Math.min(USERS_MAX, Math.max(USERS_MIN, users * factor)));
    setUsers(next);
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="hidden whitespace-nowrap text-[11px] uppercase tracking-wider text-muted sm:inline">
        User load
      </span>
      <button
        type="button"
        onClick={() => nudge(1 / 1.5)}
        aria-label="Decrease users"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-muted transition-colors duration-150 hover:text-foreground"
        style={{ borderColor: 'var(--panel-border)' }}
      >
        <Minus size={12} />
      </button>

      <div className="chaos-slider relative w-56 pt-1 sm:w-64">
        <input
          type="range"
          min={LOG_MIN}
          max={LOG_MAX}
          step={0.001}
          value={sliderValue}
          onChange={(e) => setUsers(Math.round(10 ** Number(e.target.value)))}
          className="chaos-range w-full"
          aria-label="Users"
        />
        <div className="relative mt-1 h-3 text-[9px] text-muted">
          {LABELED_STOPS.map((stop) => (
            <span
              key={stop}
              className="absolute -translate-x-1/2 tabular-nums"
              style={{ left: `${((Math.log10(stop) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100}%` }}
            >
              {stopLabel(stop)}
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => nudge(1.5)}
        aria-label="Increase users"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-muted transition-colors duration-150 hover:text-foreground"
        style={{ borderColor: 'var(--panel-border)' }}
      >
        <Plus size={12} />
      </button>

      <span className="chaos-users-readout min-w-[7ch] text-right font-mono text-lg font-semibold tabular-nums text-accent">
        {formatCompact(users)}
      </span>
      <span className="hidden text-[11px] text-muted sm:inline">users</span>
    </div>
  );
}
