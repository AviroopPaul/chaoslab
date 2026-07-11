'use client';

import { useCallback, useEffect, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Copy, Info, Trash2 } from 'lucide-react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';

import { CATALOG } from '../../lib/sim/catalog';
import type { ComponentKind } from '../../lib/sim/types';
import {
  COMPONENT_NODE_TYPE,
  FLOW_EDGE_TYPE,
  useLabStore,
  type LabEdge,
  type LabNode,
  type LabNodeData,
} from '../../store/useLabStore';
import { getTheme, subscribeTheme } from '../theme';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import FlowEdge from './edges/FlowEdge';
import ComponentNode from './nodes/ComponentNode';

/** Which element the open context menu is anchored to, plus its screen position. */
type ContextMenuState =
  | { kind: 'node'; nodeId: string; x: number; y: number }
  | { kind: 'edge'; edgeId: string; x: number; y: number };

/** HTML5 DnD MIME type used by the palette to hand off a dragged kind. */
export const DND_MIME = 'application/chaoslab-kind';

// Defined once at module scope — recreating these per-render triggers a
// React Flow warning and unnecessary node/edge remounts.
const nodeTypes: NodeTypes = { [COMPONENT_NODE_TYPE]: ComponentNode };
const edgeTypes: EdgeTypes = { [FLOW_EDGE_TYPE]: FlowEdge };

export default function Canvas() {
  const nodes = useLabStore((s) => s.nodes);
  const edges = useLabStore((s) => s.edges);
  const onNodesChange = useLabStore((s) => s.onNodesChange);
  const onEdgesChange = useLabStore((s) => s.onEdgesChange);
  const onConnect = useLabStore((s) => s.onConnect);
  const addNode = useLabStore((s) => s.addNode);
  const selectNode = useLabStore((s) => s.selectNode);
  const duplicateNode = useLabStore((s) => s.duplicateNode);
  const deleteSelection = useLabStore((s) => s.deleteSelection);
  const deleteEdge = useLabStore((s) => s.deleteEdge);
  const fitViewNonce = useLabStore((s) => s.fitViewNonce);

  const { screenToFlowPosition, fitView } = useReactFlow();

  // Right-click context menu (QA defect 3). Screen-fixed coordinates come
  // straight off the triggering MouseEvent; closed on pane click, Escape,
  // and any pan/zoom (`onMove`) so it never gets left floating over a graph
  // that's since scrolled out from under it.
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [contextMenu, closeContextMenu]);

  // React Flow's own stylesheet ships a `.dark` class that swaps a handful of
  // *unstyled* defaults we don't otherwise override (the live connection-line
  // color while dragging a new edge, the drag-selection box) — everything
  // else (nodes/edges/MiniMap/Controls) already has explicit theme-aware
  // styling above and beyond RF's defaults. Track theme so that class can
  // follow the toggle without a remount.
  const [theme, setThemeState] = useState(getTheme);
  useEffect(() => subscribeTheme(() => setThemeState(getTheme())), []);

  // QA defect 3: after a preset load / JSON import / localStorage hydrate
  // wholesale-replaces the graph, re-fit the viewport so the whole graph is
  // visible (the plain `fitView` prop below only runs once on initial mount).
  useEffect(() => {
    if (fitViewNonce === 0) return;
    const raf = requestAnimationFrame(() => {
      fitView({ padding: 0.15, duration: 400 });
    });
    return () => cancelAnimationFrame(raf);
  }, [fitViewNonce, fitView]);

  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes(DND_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      const kind = event.dataTransfer.getData(DND_MIME) as ComponentKind;
      if (!kind || !CATALOG[kind]) return;
      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(kind, position);
    },
    [addNode, screenToFlowPosition],
  );

  const onNodeContextMenu = useCallback((event: ReactMouseEvent, node: LabNode) => {
    event.preventDefault();
    setContextMenu({ kind: 'node', nodeId: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const onEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: LabEdge) => {
    event.preventDefault();
    setContextMenu({ kind: 'edge', edgeId: edge.id, x: event.clientX, y: event.clientY });
  }, []);

  let menuItems: ContextMenuItem[] = [];
  if (contextMenu?.kind === 'node') {
    const { nodeId } = contextMenu;
    const node = nodes.find((n) => n.id === nodeId) ?? null;
    const isUsers = node?.data.simNode.kind === 'users';
    menuItems = [
      {
        key: 'info',
        label: 'Info',
        icon: Info,
        onSelect: () => selectNode(nodeId),
      },
      {
        key: 'duplicate',
        label: 'Duplicate',
        icon: Copy,
        disabled: isUsers,
        disabledReason: 'Only one Users node is allowed',
        onSelect: () => duplicateNode(nodeId),
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onSelect: () => {
          selectNode(nodeId);
          deleteSelection();
        },
      },
    ];
  } else if (contextMenu?.kind === 'edge') {
    const { edgeId } = contextMenu;
    menuItems = [
      {
        key: 'delete-connection',
        label: 'Delete connection',
        icon: Trash2,
        danger: true,
        onSelect: () => deleteEdge(edgeId),
      },
    ];
  }

  return (
    <div className="chaos-canvas h-full w-full">
      <ReactFlow
        className={`chaos-flow ${theme === 'dark' ? 'dark' : ''}`}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={(_, node) => selectNode(node.id)}
        onPaneClick={() => {
          selectNode(null);
          closeContextMenu();
        }}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={(event) => event.preventDefault()}
        onMove={closeContextMenu}
        elementsSelectable
        edgesFocusable
        deleteKeyCode={['Delete', 'Backspace']}
        fitView
        fitViewOptions={{ padding: 0.35, maxZoom: 1.1 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: FLOW_EDGE_TYPE }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--canvas-dot)" />
        <MiniMap
          pannable
          zoomable
          className="chaos-minimap"
          maskColor="var(--minimap-mask)"
          nodeColor={(n) => CATALOG[(n.data as LabNodeData).simNode.kind]?.accent ?? 'var(--health-idle)'}
        />
        <Controls className="chaos-controls" showInteractive={false} />
      </ReactFlow>
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={menuItems} onClose={closeContextMenu} />}
    </div>
  );
}
