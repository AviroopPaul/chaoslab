import type { ComponentKind, Health } from '../../lib/sim/types';

/**
 * Small formatting + lookup helpers shared across the playground UI
 * (palette badges, node cards, inspector, toolbar, metrics bar). Kept
 * dependency-free (no React) so it's trivially unit-testable / reusable.
 */

/** `12400` -> `"12.4k"`, `1234567` -> `"1.2M"`, `842` -> `"842"`. */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

/** `2_400_000` -> `"2.4M users"`. */
export function formatUsers(n: number): string {
  return `${formatCompact(n)} users`;
}

/** `12400` -> `"$12.4k/mo"`, `80` -> `"$80/mo"`. */
export function formatCurrency(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0/mo';
  if (n >= 1000) return `$${formatCompact(n)}/mo`;
  return `$${Math.round(n)}/mo`;
}

/** `1.4` -> `"1.4ms"`, `142.9` -> `"143ms"`. */
export function formatMs(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0ms';
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)}ms`;
}

/** Precise percent for metrics bar / inspector: `0.9987` -> `"99.9%"`. */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction === 0) return '0%';
  const decimals = fraction > 0 && fraction < 1 ? 1 : 0;
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Compact integer percent for the tight node card: `0.451` -> `"45%"`. */
export function formatPercentInt(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0%';
  return `${Math.round(fraction * 100)}%`;
}

/**
 * Node/inspector utilization display. `utilization` is unbounded (0..∞ — a
 * server at 20x its capacity reports 20, not a clamped 100%), so a melting
 * node used to show absurd strings like "6667%"/"10000%". Past 10x capacity,
 * switch to a compact "×N" multiplier instead of a percent (QA defect 6).
 */
export function formatUtilization(utilization: number): string {
  if (!Number.isFinite(utilization)) return '0%';
  if (utilization > 10) return `×${Math.round(utilization)}`;
  return formatPercentInt(utilization);
}

const HEALTH_VARS: Record<Health, string> = {
  idle: 'var(--health-idle)',
  ok: 'var(--health-ok)',
  warn: 'var(--health-warn)',
  hot: 'var(--health-hot)',
  overloaded: 'var(--health-overloaded)',
  down: 'var(--health-down)',
};

/** CSS custom-property reference for a health state, for inline styles. */
export function healthVar(health: Health): string {
  return HEALTH_VARS[health];
}

/**
 * Alpha-blended color for a CSS custom property, for inline styles or
 * template-literal CSS values (glows, tinted chip backgrounds, faint
 * borders, etc).
 *
 * This replaces a former "var() + hex suffix" trick (`` `${'var(--x)'}66` ``)
 * that shipped in a recent theming pass and was the root cause of a
 * regression where edge strokes, health-ring glows, and several chip/border
 * tints silently stopped rendering. `var(--x)` substitution is a raw token
 * splice, not a function call, so appending hex digits after it doesn't
 * concatenate into an 8-digit hex color — it produces a syntactically
 * invalid value (e.g. `var(--health-ok)66`) that the browser drops, leaving
 * the property at its initial value (`stroke: none`, no box-shadow, etc). It
 * also only ever had a chance of working when the referenced var was itself
 * a bare `#rrggbb` hex literal, which broke the instant any var held an
 * `rgba()` value instead (as several surface/shadow tokens already do).
 *
 * `color-mix()` evaluates at used-value time against whatever the var
 * currently resolves to (hex or rgba()), so it works uniformly for every
 * token and transparently follows theme switches / future token changes.
 */
export function alphaVar(cssVar: string, percent: number): string {
  return `color-mix(in srgb, ${cssVar} ${percent}%, transparent)`;
}

/** Bottleneck-node-kind -> plain-English fix suggestion for the metrics bar. */
export const BOTTLENECK_SUGGESTIONS: Record<ComponentKind, string> = {
  users: 'Traffic source — pull back the USER LOAD slider to relieve pressure.',
  cdn: 'Raise the CDN hit ratio, or add another edge PoP in front of it.',
  loadbalancer: 'Scale out the load balancer tier.',
  ratelimiter: 'Raise the limit, or shed more aggressively upstream at the edge.',
  server: 'Add instances, or put a load balancer in front to spread the load.',
  cache: 'Raise cache capacity or hit ratio, or add a CDN in front of it.',
  database: 'Add a cache, read replicas, or shards.',
  queue: 'Add workers to raise the drain rate.',
  storage: 'Shard or replicate storage, or front it with a CDN.',
};
