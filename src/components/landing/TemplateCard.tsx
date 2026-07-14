import Link from 'next/link';

import type { Preset } from '../../lib/sim/presets';
import styles from './landing.module.css';

/**
 * One card in the landing page's Templates section (SPEC-PRACTICE.md §7):
 * name, tagline (from the preset's own explanation, if it has one), and a
 * short description — links straight into the lab with that preset loaded
 * and its explanation panel open (`/lab/backend?preset=<id>`, read by
 * Toolbar on mount).
 */
export default function TemplateCard({ preset }: { preset: Preset }) {
  return (
    <Link
      href={`/lab/backend?preset=${preset.id}`}
      className={`glass-panel group flex h-full flex-col gap-2 rounded-xl border border-panel-border p-5 transition-colors duration-150 hover:border-accent/50 hover:bg-[var(--hover-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong ${styles.card}`}
    >
      <h3 className="text-[14px] font-semibold text-foreground group-hover:text-accent">{preset.name}</h3>
      {preset.explanation?.tagline && (
        <p className="text-[11px] leading-snug text-accent">{preset.explanation.tagline}</p>
      )}
      <p className="text-[12px] leading-relaxed text-muted">{preset.description}</p>
    </Link>
  );
}
