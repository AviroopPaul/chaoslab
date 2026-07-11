import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import styles from "./landing.module.css";

export interface ModuleCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  status: "live" | "soon";
}

/**
 * One module tile in the landing grid (SPEC.md §8). Live modules are a
 * focusable link with an accent border and hover lift; disabled modules are
 * present but visually muted, with a "Coming soon" chip and no link.
 */
export default function ModuleCard({
  title,
  description,
  icon: Icon,
  href,
  status,
}: ModuleCardProps) {
  const isLive = status === "live" && Boolean(href);

  const body = (
    <div
      className={`glass-panel relative flex h-full flex-col gap-4 rounded-xl border p-6 ${
        isLive
          ? `${styles.card} border-accent/30 hover:border-accent/70 hover:bg-[var(--hover-tint)]`
          : "border-panel-border opacity-55"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            isLive ? "bg-accent/15 text-accent" : "bg-[var(--chip-bg)] text-muted"
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        {isLive ? (
          <span className="rounded-full border border-health-ok/40 bg-health-ok/10 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-health-ok uppercase">
            Live
          </span>
        ) : (
          <span className="rounded-full border border-panel-border bg-[var(--chip-bg)] px-2.5 py-1 text-[10px] font-medium tracking-wide text-muted uppercase">
            Coming soon
          </span>
        )}
      </div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{description}</p>
    </div>
  );

  if (isLive && href) {
    return (
      <Link
        href={href}
        className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="h-full cursor-not-allowed" aria-disabled="true">
      {body}
    </div>
  );
}
