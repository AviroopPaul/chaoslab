'use client';

import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Right-click context menu for canvas nodes/edges (defect 3). Positioned at
 * the cursor via fixed coordinates, clamped to stay on-screen. Closing is
 * driven by the caller (Canvas.tsx already tears this down on pane click,
 * Escape, scroll and zoom) — this component only handles Escape/outside
 * clicks that happen *while the menu itself* has focus, plus clamping.
 */

export interface ContextMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  disabledReason?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 180;
const ITEM_HEIGHT = 32;
const MENU_PADDING = 8;

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  // Clamp so the menu never renders partly off-screen near the right/bottom
  // edge of the viewport.
  const estimatedHeight = items.length * ITEM_HEIGHT + MENU_PADDING * 2;
  const left = typeof window === 'undefined' ? x : Math.min(x, window.innerWidth - MENU_WIDTH - 8);
  const top = typeof window === 'undefined' ? y : Math.min(y, window.innerHeight - estimatedHeight - 8);

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      className="chaos-context-menu glass-panel"
      style={{ left, top, width: MENU_WIDTH }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          title={item.disabled ? item.disabledReason : undefined}
          className={`chaos-context-menu-item ${item.danger ? 'chaos-context-menu-item-danger' : ''}`}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
        >
          <item.icon size={13} strokeWidth={2.25} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
