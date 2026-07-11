import {
  Database,
  Globe,
  Gauge,
  HardDrive,
  ListOrdered,
  Server,
  Shuffle,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Maps catalog `icon` names (SPEC.md §3, `CatalogEntry.icon`) to their
 * lucide-react component. Explicit map instead of `import *` so unused
 * icons stay tree-shakeable and typos fail obviously (fallback below).
 */
export const ICONS: Record<string, LucideIcon> = {
  Users,
  Globe,
  Shuffle,
  Gauge,
  Server,
  Zap,
  Database,
  ListOrdered,
  HardDrive,
};

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Server;
}
