'use client';

import Link from 'next/link';
import { useRef, useState, type ChangeEvent } from 'react';
import { Download, Info, Minus, Plus, Trash2, Upload } from 'lucide-react';

import { PRESETS } from '../../lib/sim/presets';
import { useLabStore } from '../../store/useLabStore';
import ThemeToggle from '../ThemeToggle';
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

export default function Toolbar() {
  const users = useLabStore((s) => s.global.users);
  const setUsers = useLabStore((s) => s.setUsers);
  const loadPreset = useLabStore((s) => s.loadPreset);
  const clear = useLabStore((s) => s.clear);
  const exportJson = useLabStore((s) => s.exportJson);
  const importJson = useLabStore((s) => s.importJson);
  const explanationPresetId = useLabStore((s) => s.explanationPresetId);
  const openExplanation = useLabStore((s) => s.openExplanation);
  const currentPreset = PRESETS.find((p) => p.id === explanationPresetId);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState(false);

  const sliderValue = Math.log10(Math.max(users, USERS_MIN));

  function nudge(factor: number) {
    const next = Math.round(Math.min(USERS_MAX, Math.max(USERS_MIN, users * factor)));
    setUsers(next);
  }

  function handleExport() {
    const json = exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chaoslab-backend.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      setImportError(!importJson(text));
    });
  }

  return (
    <header className="chaos-toolbar glass-panel flex h-16 shrink-0 items-center justify-between gap-4 px-4">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex flex-col leading-tight transition-opacity duration-150 hover:opacity-80">
          <span className="text-sm font-semibold tracking-tight text-foreground">ChaosLab</span>
          <span className="text-[11px] text-accent">Backend Basics</span>
        </Link>

        <div className="mx-1 h-8 w-px" style={{ background: 'var(--panel-border)' }} />

        <select
          className="chaos-select rounded-md border bg-transparent px-2 py-1.5 text-[12px] text-foreground outline-none"
          style={{ borderColor: 'var(--panel-border)' }}
          onChange={(e) => {
            if (e.target.value) loadPreset(e.target.value);
          }}
          defaultValue=""
        >
          <option value="" disabled className="bg-background">
            Load preset…
          </option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id} className="bg-background">
              {p.name}
            </option>
          ))}
        </select>

        {currentPreset?.explanation && (
          <button
            type="button"
            onClick={openExplanation}
            className="chaos-toolbar-btn flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
            style={{ borderColor: 'var(--panel-border)' }}
          >
            <Info size={13} /> About this preset
          </button>
        )}

        <button
          type="button"
          onClick={clear}
          className="chaos-toolbar-btn flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
          style={{ borderColor: 'var(--panel-border)' }}
        >
          <Trash2 size={13} /> Clear
        </button>

        <button
          type="button"
          onClick={handleExport}
          className="chaos-toolbar-btn flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] text-muted transition-colors duration-150 hover:text-foreground"
          style={{ borderColor: 'var(--panel-border)' }}
        >
          <Download size={13} /> Export
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="chaos-toolbar-btn flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors duration-150 hover:text-foreground"
          style={{
            borderColor: importError ? 'var(--health-overloaded)' : 'var(--panel-border)',
            color: importError ? 'var(--health-overloaded)' : 'var(--muted)',
          }}
        >
          <Upload size={13} /> Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={handleImportFile}
        />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
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

        <div className="mx-1 h-8 w-px shrink-0" style={{ background: 'var(--panel-border)' }} />
        <ThemeToggle />
      </div>
    </header>
  );
}
