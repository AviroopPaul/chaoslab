'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Download, Info, Trash2, Upload } from 'lucide-react';

import { PRESETS } from '../../lib/sim/presets';
import { useLabStore } from '../../store/useLabStore';
import ThemeToggle from '../ThemeToggle';
import UserLoadSlider from './UserLoadSlider';

export default function Toolbar() {
  const loadPreset = useLabStore((s) => s.loadPreset);
  const clear = useLabStore((s) => s.clear);
  const exportJson = useLabStore((s) => s.exportJson);
  const importJson = useLabStore((s) => s.importJson);
  const explanationPresetId = useLabStore((s) => s.explanationPresetId);
  const openExplanation = useLabStore((s) => s.openExplanation);
  const currentPreset = PRESETS.find((p) => p.id === explanationPresetId);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState(false);

  // SPEC-PRACTICE.md §7: `/lab/backend?preset=<id>` loads that preset (with
  // its explanation panel open, via loadPreset's own auto-open logic) so the
  // landing page's Templates cards can deep-link straight into a scenario.
  // Read directly off `window.location.search` (rather than the
  // `useSearchParams` hook) since this whole subtree is only ever mounted
  // client-side via a `next/dynamic({ ssr: false })` boundary already.
  useEffect(() => {
    const presetId = new URLSearchParams(window.location.search).get('preset');
    if (presetId && PRESETS.some((p) => p.id === presetId)) {
      loadPreset(presetId);
    }
    // Intentionally run once on mount only — this is a one-shot deep link,
    // not a live binding to the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <UserLoadSlider />
        <div className="mx-1 h-8 w-px shrink-0" style={{ background: 'var(--panel-border)' }} />
        <ThemeToggle />
      </div>
    </header>
  );
}
