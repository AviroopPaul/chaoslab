'use client';

import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';

import { useLabStore } from '../../store/useLabStore';
import Canvas from './Canvas';
import './lab.css';
import MetricsBar from './MetricsBar';
import Palette from './Palette';
import ExplanationPanel from './panels/ExplanationPanel';
import Inspector from './panels/Inspector';
import Toolbar from './Toolbar';

function PlaygroundBody() {
  const hydrate = useLabStore((s) => s.hydrate);
  const selectedNodeId = useLabStore((s) => s.selectedNodeId);
  const nodes = useLabStore((s) => s.nodes);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  return (
    <div className="chaos-lab flex h-screen w-screen flex-col overflow-hidden">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <Palette />
        <main className="relative min-w-0 flex-1">
          <Canvas />
        </main>
        {selectedNode && <Inspector node={selectedNode} />}
      </div>
      <ExplanationPanel />
      <MetricsBar />
    </div>
  );
}

/**
 * Full playground shell for /lab/backend (SPEC.md §7): top toolbar, left
 * palette rail, center React Flow canvas, right inspector (slides in on
 * selection), bottom metrics bar. `ReactFlowProvider` lives here so every
 * descendant (Canvas, Palette's click-to-add) can call `useReactFlow()`.
 *
 * This whole subtree is loaded via `next/dynamic` with `ssr: false` from the
 * route's page.tsx — React Flow measures DOM nodes on mount and must not run
 * during server rendering.
 */
export default function PlaygroundShell() {
  return (
    <ReactFlowProvider>
      <PlaygroundBody />
    </ReactFlowProvider>
  );
}
