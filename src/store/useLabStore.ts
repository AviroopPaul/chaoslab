import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import { create } from 'zustand';

import { CATALOG } from '../lib/sim/catalog';
import { solve } from '../lib/sim/engine';
import { PRESETS } from '../lib/sim/presets';
import type {
  ComponentKind,
  GlobalConfig,
  NodeConfig,
  SimEdge,
  SimGraph,
  SimNode,
  SimResult,
} from '../lib/sim/types';
import { QUESTIONS } from '../lib/practice/questions';

/** RF node type string rendered by the single generic `ComponentNode`. */
export const COMPONENT_NODE_TYPE = 'component';
/** RF edge type string rendered by the single generic `FlowEdge`. */
export const FLOW_EDGE_TYPE = 'flow';

export type LabNodeData = { simNode: SimNode };
export type LabNode = Node<LabNodeData>;
export type LabEdge = Edge;

/** Sandbox mode's single autosave slot. */
const STORAGE_KEY = 'chaoslab.backend.v1';
/** Practice mode (SPEC-PRACTICE.md §8): one autosave slot per question id, so
 * switching questions (or bouncing back to the sandbox) never clobbers a
 * different attempt. */
function practiceStorageKey(questionId: string): string {
  return `chaoslab.practice.graph.${questionId}`;
}
const SOLVE_DEBOUNCE_MS = 60;
const SAVE_DEBOUNCE_MS = 500;

interface PersistedGraph {
  version: 1;
  nodes: { id: string; kind: ComponentKind; label: string; config: NodeConfig; position: { x: number; y: number } }[];
  edges: { id: string; source: string; target: string }[];
  global: GlobalConfig;
}

function idleResult(): SimResult {
  return {
    nodes: {},
    edges: {},
    totals: {
      offeredRps: 0,
      servedRps: 0,
      availability: 0,
      p50Ms: 0,
      p99Ms: 0,
      costPerMonth: 0,
      verdict: 'healthy',
      bottlenecks: [],
      graphWarnings: [],
    },
  };
}

function toSimGraph(nodes: LabNode[], edges: LabEdge[], global: GlobalConfig): SimGraph {
  const simNodes: SimNode[] = nodes.map((n) => n.data.simNode);
  const simEdges: SimEdge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
  return { nodes: simNodes, edges: simEdges, global };
}

function makeId(kind: ComponentKind): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${kind}-${random}`;
}

function makeLabNode(kind: ComponentKind, position: { x: number; y: number }, id?: string): LabNode {
  const entry = CATALOG[kind];
  const simNode: SimNode = {
    id: id ?? makeId(kind),
    kind,
    label: entry.name,
    config: { ...entry.defaultConfig },
  };
  return {
    id: simNode.id,
    type: COMPONENT_NODE_TYPE,
    position,
    data: { simNode },
  };
}

function buildFromPreset(presetId: string): {
  nodes: LabNode[];
  edges: LabEdge[];
  global: GlobalConfig;
} | null {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  const { nodes, edges, positions, global } = preset.build();
  const labNodes: LabNode[] = nodes.map((simNode) => ({
    id: simNode.id,
    type: COMPONENT_NODE_TYPE,
    position: positions[simNode.id] ?? { x: 0, y: 0 },
    data: { simNode },
  }));
  const labEdges: LabEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: FLOW_EDGE_TYPE,
  }));
  return { nodes: labNodes, edges: labEdges, global };
}

const DEFAULT_GLOBAL: GlobalConfig = {
  users: 100,
  rpsPerUser: 0.1,
  readWriteRatio: 0.9,
};

let solveTimer: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export interface LabState {
  nodes: LabNode[];
  edges: LabEdge[];
  global: GlobalConfig;
  result: SimResult;
  selectedNodeId: string | null;
  hydrated: boolean;
  /** Bumped whenever the whole graph was just replaced wholesale (preset
   * load, JSON import, localStorage hydrate) so Canvas knows to re-fit the
   * viewport — consumed via a `useEffect` keyed on this value, not read
   * per-render. */
  fitViewNonce: number;

  // preset explanation panel (additive) — id of the preset the graph was
  // last loaded from (survives the panel being dismissed, so the Toolbar's
  // "About this preset" button can reopen it) plus whether it's showing.
  explanationPresetId: string | null;
  explanationOpen: boolean;
  openExplanation: () => void;
  closeExplanation: () => void;

  // React Flow wiring
  onNodesChange: OnNodesChange<LabNode>;
  onEdgesChange: OnEdgesChange<LabEdge>;
  onConnect: OnConnect;

  // graph mutation actions
  addNode: (kind: ComponentKind, position: { x: number; y: number }) => void;
  updateNodeConfig: (nodeId: string, patch: Partial<NodeConfig>, opts?: { immediate?: boolean }) => void;
  updateNodeLabel: (nodeId: string, label: string) => void;
  deleteSelection: () => void;
  selectNode: (nodeId: string | null) => void;
  /** Clone a node (same kind + config) offset +40/+40, with a fresh id and a
   * "<label> copy" label (context-menu Duplicate — defect 3). No-op for the
   * `users` node, which the canvas only ever allows one of. */
  duplicateNode: (nodeId: string) => void;
  /** Remove a single edge by id (context-menu / hover-× delete — defect 2). */
  deleteEdge: (edgeId: string) => void;

  // global config
  setUsers: (users: number) => void;
  setGlobalConfig: (patch: Partial<GlobalConfig>) => void;

  // scenario management
  loadPreset: (presetId: string) => void;
  importJson: (json: string) => boolean;
  exportJson: () => string;
  clear: () => void;

  // persistence
  hydrate: () => void;

  // practice mode (SPEC-PRACTICE.md §8, additive) — reuses this same store
  // (and every canvas component) rather than forking a parallel one.
  // `mode`/`activeQuestionId` decide which localStorage slot autosave targets.
  mode: 'sandbox' | 'practice';
  activeQuestionId: string | null;
  /** Load (or start fresh for) a question's attempt; switches autosave to its own key. */
  enterPractice: (questionId: string) => void;
  /** Return to sandbox mode, restoring the sandbox's own autosaved graph. */
  exitPractice: () => void;

  // internal: force an immediate re-solve (exposed for tests / debug)
  resolveNow: () => void;
}

function toLabGraph(parsed: PersistedGraph): { nodes: LabNode[]; edges: LabEdge[]; global: GlobalConfig } {
  const nodes: LabNode[] = parsed.nodes.map((n) => ({
    id: n.id,
    type: COMPONENT_NODE_TYPE,
    position: n.position,
    data: { simNode: { id: n.id, kind: n.kind, label: n.label, config: n.config } },
  }));
  const edges: LabEdge[] = parsed.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: FLOW_EDGE_TYPE,
  }));
  return { nodes, edges, global: parsed.global };
}

function readPersisted(storageKey: string): PersistedGraph | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedGraph;
  } catch {
    return null;
  }
}

function persist(nodes: LabNode[], edges: LabEdge[], global: GlobalConfig, storageKey: string) {
  if (typeof window === 'undefined') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const payload: PersistedGraph = {
      version: 1,
      nodes: nodes.map((n) => ({
        id: n.data.simNode.id,
        kind: n.data.simNode.kind,
        label: n.data.simNode.label,
        config: n.data.simNode.config,
        position: n.position,
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      global,
    };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // localStorage can throw (quota, private mode) — autosave is best-effort.
    }
  }, SAVE_DEBOUNCE_MS);
}

export const useLabStore = create<LabState>((set, get) => {
  function recompute(immediate: boolean) {
    const run = () => {
      const { nodes, edges, global } = get();
      const result = solve(toSimGraph(nodes, edges, global));
      set({ result });
    };
    if (immediate) {
      if (solveTimer) {
        clearTimeout(solveTimer);
        solveTimer = null;
      }
      run();
      return;
    }
    if (solveTimer) clearTimeout(solveTimer);
    solveTimer = setTimeout(run, SOLVE_DEBOUNCE_MS);
  }

  function afterMutation(immediate: boolean) {
    recompute(immediate);
    const { nodes, edges, global, mode, activeQuestionId } = get();
    const storageKey = mode === 'practice' && activeQuestionId ? practiceStorageKey(activeQuestionId) : STORAGE_KEY;
    persist(nodes, edges, global, storageKey);
  }

  /** Shared by hydrate() and exitPractice() — load the sandbox's own
   * autosaved graph, falling back to the Hello World preset if there is
   * none (or it fails to parse). */
  function loadSandboxGraph() {
    const parsed = readPersisted(STORAGE_KEY);
    if (!parsed) {
      get().loadPreset('hello-world');
      return;
    }
    try {
      const { nodes, edges, global } = toLabGraph(parsed);
      set((state) => ({ nodes, edges, global, selectedNodeId: null, fitViewNonce: state.fitViewNonce + 1 }));
      recompute(true);
    } catch {
      get().loadPreset('hello-world');
    }
  }

  return {
    nodes: [],
    edges: [],
    global: DEFAULT_GLOBAL,
    result: idleResult(),
    selectedNodeId: null,
    hydrated: false,
    fitViewNonce: 0,
    explanationPresetId: null,
    explanationOpen: false,
    mode: 'sandbox',
    activeQuestionId: null,

    openExplanation: () => set({ explanationOpen: true }),
    closeExplanation: () => set({ explanationOpen: false }),

    onNodesChange: (changes) => {
      set({ nodes: applyNodeChanges(changes, get().nodes) });
      afterMutation(false);
    },

    onEdgesChange: (changes) => {
      set({ edges: applyEdgeChanges(changes, get().edges) });
      afterMutation(true);
    },

    onConnect: (connection: Connection) => {
      set({
        edges: addEdge({ ...connection, type: FLOW_EDGE_TYPE }, get().edges),
      });
      afterMutation(true);
    },

    addNode: (kind, position) => {
      const node = makeLabNode(kind, position);
      set({ nodes: [...get().nodes, node] });
      afterMutation(true);
    },

    updateNodeConfig: (nodeId, patch, opts) => {
      set({
        nodes: get().nodes.map((n) =>
          n.id === nodeId
            ? { ...n, data: { simNode: { ...n.data.simNode, config: { ...n.data.simNode.config, ...patch } } } }
            : n,
        ),
      });
      afterMutation(opts?.immediate ?? false);
    },

    updateNodeLabel: (nodeId, label) => {
      set({
        nodes: get().nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { simNode: { ...n.data.simNode, label } } } : n,
        ),
      });
      afterMutation(false);
    },

    deleteSelection: () => {
      const { nodes, edges, selectedNodeId } = get();
      const idsToRemove = new Set(
        nodes.filter((n) => n.selected || n.id === selectedNodeId).map((n) => n.id),
      );
      const remainingNodes = nodes.filter((n) => !idsToRemove.has(n.id));
      const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));
      const remainingEdges = edges.filter(
        (e) =>
          !selectedEdgeIds.has(e.id) && !idsToRemove.has(e.source) && !idsToRemove.has(e.target),
      );
      set({
        nodes: remainingNodes,
        edges: remainingEdges,
        selectedNodeId: idsToRemove.has(selectedNodeId ?? '') ? null : selectedNodeId,
      });
      afterMutation(true);
    },

    selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

    duplicateNode: (nodeId) => {
      const { nodes } = get();
      const original = nodes.find((n) => n.id === nodeId);
      // Only one `users` node is ever allowed on the canvas — the context
      // menu already disables Duplicate for it, this is just a backstop.
      if (!original || original.data.simNode.kind === 'users') return;
      const newId = makeId(original.data.simNode.kind);
      const clone: LabNode = {
        id: newId,
        type: COMPONENT_NODE_TYPE,
        position: { x: original.position.x + 40, y: original.position.y + 40 },
        data: {
          simNode: {
            id: newId,
            kind: original.data.simNode.kind,
            label: `${original.data.simNode.label} copy`,
            config: { ...original.data.simNode.config },
          },
        },
      };
      set({ nodes: [...nodes, clone], selectedNodeId: newId });
      afterMutation(true);
    },

    deleteEdge: (edgeId) => {
      set({ edges: get().edges.filter((e) => e.id !== edgeId) });
      afterMutation(true);
    },

    setUsers: (users) => {
      const global = { ...get().global, users };
      const nodes = get().nodes.map((n) =>
        n.data.simNode.kind === 'users'
          ? { ...n, data: { simNode: { ...n.data.simNode, config: { ...n.data.simNode.config, users } } } }
          : n,
      );
      set({ global, nodes });
      afterMutation(false);
    },

    setGlobalConfig: (patch) => {
      set({ global: { ...get().global, ...patch } });
      afterMutation(false);
    },

    loadPreset: (presetId) => {
      const built = buildFromPreset(presetId);
      if (!built) return;
      const preset = PRESETS.find((p) => p.id === presetId);
      set((state) => ({
        nodes: built.nodes,
        edges: built.edges,
        global: built.global,
        selectedNodeId: null,
        fitViewNonce: state.fitViewNonce + 1,
        explanationPresetId: presetId,
        // Auto-open only if this preset actually has explanation content —
        // otherwise leave any existing panel state alone rather than forcing
        // it closed (there isn't one to show either way).
        explanationOpen: Boolean(preset?.explanation),
      }));
      afterMutation(true);
    },

    importJson: (json) => {
      try {
        const parsed = JSON.parse(json) as PersistedGraph;
        if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges) || !parsed.global) {
          return false;
        }
        const nodes: LabNode[] = parsed.nodes.map((n) => ({
          id: n.id,
          type: COMPONENT_NODE_TYPE,
          position: n.position,
          data: { simNode: { id: n.id, kind: n.kind, label: n.label, config: n.config } },
        }));
        const edges: LabEdge[] = parsed.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: FLOW_EDGE_TYPE,
        }));
        set((state) => ({
          nodes,
          edges,
          global: parsed.global,
          selectedNodeId: null,
          fitViewNonce: state.fitViewNonce + 1,
        }));
        afterMutation(true);
        return true;
      } catch {
        return false;
      }
    },

    exportJson: () => {
      const { nodes, edges, global } = get();
      const payload: PersistedGraph = {
        version: 1,
        nodes: nodes.map((n) => ({
          id: n.data.simNode.id,
          kind: n.data.simNode.kind,
          label: n.data.simNode.label,
          config: n.data.simNode.config,
          position: n.position,
        })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
        global,
      };
      return JSON.stringify(payload, null, 2);
    },

    clear: () => {
      set({ nodes: [], edges: [], selectedNodeId: null });
      afterMutation(true);
    },

    hydrate: () => {
      if (get().hydrated) return;
      // Always the sandbox entrypoint (/lab/backend) — reassert sandbox mode
      // in case a previous practice session (in this same tab) left `mode`
      // pointed at a question.
      set({ hydrated: true, mode: 'sandbox', activeQuestionId: null });
      loadSandboxGraph();
    },

    enterPractice: (questionId) => {
      set({ mode: 'practice', activeQuestionId: questionId, selectedNodeId: null });
      const saved = readPersisted(practiceStorageKey(questionId));
      if (saved) {
        const { nodes, edges, global } = toLabGraph(saved);
        set((state) => ({ nodes, edges, global, fitViewNonce: state.fitViewNonce + 1 }));
        recompute(true);
        return;
      }
      // No saved attempt yet (SPEC-PRACTICE.md §8): start with ONLY a Users
      // node, defaulted to the question's target load so the canvas opens at
      // the scale it'll actually be graded at.
      const question = QUESTIONS.find((q) => q.id === questionId);
      const global = question?.targetLoad ?? DEFAULT_GLOBAL;
      const usersNode = makeLabNode('users', { x: 240, y: 220 });
      usersNode.data.simNode.config = { ...usersNode.data.simNode.config, users: global.users };
      set((state) => ({ nodes: [usersNode], edges: [], global, fitViewNonce: state.fitViewNonce + 1 }));
      afterMutation(true);
    },

    exitPractice: () => {
      set({ mode: 'sandbox', activeQuestionId: null, selectedNodeId: null });
      loadSandboxGraph();
    },

    resolveNow: () => recompute(true),
  };
});
