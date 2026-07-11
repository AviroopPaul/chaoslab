'use client';

import { ExternalLink, X } from 'lucide-react';

import { PRESETS } from '../../../lib/sim/presets';
import { useLabStore } from '../../../store/useLabStore';

/**
 * Dismissible glass card surfaced when a preset with `explanation` content
 * loads (Task C.1). Anchored bottom-right, floating above the metrics bar —
 * `fixed` positioning keeps it in place regardless of where it's mounted in
 * the tree. The Toolbar's "About this preset" button reopens it via
 * `openExplanation()` after a dismiss, keyed off the same
 * `explanationPresetId` this panel reads.
 */
export default function ExplanationPanel() {
  const explanationPresetId = useLabStore((s) => s.explanationPresetId);
  const explanationOpen = useLabStore((s) => s.explanationOpen);
  const closeExplanation = useLabStore((s) => s.closeExplanation);

  const preset = PRESETS.find((p) => p.id === explanationPresetId);
  if (!explanationOpen || !preset?.explanation) return null;

  const { explanation } = preset;

  return (
    <aside
      className="chaos-explanation glass-panel fixed bottom-20 right-4 z-40 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-xl p-4 shadow-2xl"
      style={{
        // Near-opaque override of the shared `.glass-panel` background (which
        // defaults to --panel-bg at 0.72 alpha) so canvas nodes and the React
        // Flow MiniMap no longer bleed through the panel's text. Scoped to
        // this component via inline style rather than editing the shared
        // utility class, which other glass panels (toolbar/inspector/palette)
        // still rely on at the lower alpha. --explanation-bg/-border are
        // themed (dark near-black glass / light near-white glass).
        backgroundColor: 'var(--explanation-bg)',
        borderColor: 'var(--explanation-border)',
        // Bounded so the panel never grows into the 64px toolbar (+16px
        // margin) above it, regardless of viewport height. The bottom edge
        // is already clear of the 56px MetricsBar via the `bottom-20` (80px)
        // anchor, so only the top needs an explicit cap here.
        maxHeight: 'calc(100vh - 10rem)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-foreground">{preset.name}</h2>
          <p className="text-[12px] leading-snug text-accent">{explanation.tagline}</p>
        </div>
        <button
          type="button"
          onClick={closeExplanation}
          aria-label="Close preset explanation"
          className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted transition-colors duration-150 hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      <p className="text-[12px] leading-relaxed text-foreground/90">{explanation.why}</p>

      {explanation.tryThis.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Try this</h3>
          <ul className="flex flex-col gap-1.5 text-[12px] leading-snug text-foreground/90">
            {explanation.tryThis.map((line) => (
              <li key={line} className="flex gap-1.5">
                <span className="mt-[2px] text-accent">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {explanation.simplifications && (
        <p className="text-[11px] leading-snug text-muted">{explanation.simplifications}</p>
      )}

      {explanation.sources && explanation.sources.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: 'var(--panel-border)' }}>
          {explanation.sources.map((source) => (
            <a
              key={source.url}
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
    </aside>
  );
}
