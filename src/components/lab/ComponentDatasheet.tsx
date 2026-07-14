import { CATALOG } from '../../lib/sim/catalog';
import { DATASHEET_BEHAVIOR_NOTES, DATASHEET_ROWS } from '../../lib/practice/datasheet';
import { iconFor } from './nodes/iconMap';

/**
 * The component datasheet's table body — shared by the practice Problem
 * tab's collapsible section and the PaletteBar's "ⓘ" popover (fairness-fix
 * #1: this is the one place every capacity/cost fact that used to require
 * reverse-engineering the sim engine gets written down in plain English).
 * Pure presentational, no collapse/overlay chrome of its own so both call
 * sites can wrap it however fits their layout.
 */
export default function ComponentDatasheet() {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--panel-border)' }}>
        <table className="w-full min-w-[420px] border-collapse text-left text-[11px]">
          <thead>
            <tr style={{ background: 'var(--chip-bg)' }}>
              <th className="px-2.5 py-2 font-semibold text-muted">Component</th>
              <th className="px-2.5 py-2 font-semibold text-muted">Capacity</th>
              <th className="px-2.5 py-2 font-semibold text-muted">Cost</th>
            </tr>
          </thead>
          <tbody>
            {DATASHEET_ROWS.map((row, i) => {
              const entry = CATALOG[row.kind];
              const icon = { Icon: iconFor(entry.icon) };
              return (
                <tr
                  key={row.kind}
                  style={{ borderTop: i === 0 ? undefined : '1px solid var(--panel-border)' }}
                >
                  <td className="whitespace-nowrap px-2.5 py-2 align-top">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      <span
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                        style={{ background: `${entry.accent}1a`, color: entry.accent }}
                      >
                        <icon.Icon size={10} strokeWidth={2} />
                      </span>
                      {row.name}
                    </span>
                  </td>
                  <td className="px-2.5 py-2 align-top leading-snug text-muted">{row.capacity}</td>
                  <td className="px-2.5 py-2 align-top leading-snug text-muted">{row.cost}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-1.5">
        {DATASHEET_BEHAVIOR_NOTES.map((note, i) => (
          <p key={i} className="text-[11px] leading-snug text-muted">
            <span className="font-semibold text-foreground">Note — </span>
            {note}
          </p>
        ))}
      </div>
    </div>
  );
}
