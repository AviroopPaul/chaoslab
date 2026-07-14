'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';

import { evaluate } from '../../lib/practice/grader';
import { getProgress, markSolutionViewed, recordAttempt, type QuestionProgress } from '../../lib/practice/progress';
import type { Difficulty, GradeReport, Question } from '../../lib/practice/types';
import type { SimGraph } from '../../lib/sim/types';
import { useLabStore } from '../../store/useLabStore';
import Canvas from '../lab/Canvas';
import { alphaVar, formatCompact } from '../lab/format';
import '../lab/lab.css';
import MetricsBar from '../lab/MetricsBar';
import PaletteBar from '../lab/PaletteBar';
import Inspector from '../lab/panels/Inspector';
import ThemeToggle from '../ThemeToggle';
import UserLoadSlider from '../lab/UserLoadSlider';
import QuestionPanel, { type QuestionTab } from './QuestionPanel';

/** Collapsed state of the left Question panel persists across visits (and
 * across questions — it's a workspace layout preference, not per-question
 * progress) in this single localStorage key. */
const QUESTION_PANEL_COLLAPSED_KEY = 'chaoslab.practice.questionPanelCollapsed';

function readPanelCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(QUESTION_PANEL_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writePanelCollapsed(collapsed: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUESTION_PANEL_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // best-effort — a private-mode/quota failure just means it won't persist.
  }
}

const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  easy: 'var(--health-ok)',
  medium: 'var(--health-warn)',
  hard: 'var(--health-overloaded)',
};

function PracticeBody({ question }: { question: Question }) {
  const enterPractice = useLabStore((s) => s.enterPractice);
  const exportJson = useLabStore((s) => s.exportJson);
  const importJson = useLabStore((s) => s.importJson);
  const selectedNodeId = useLabStore((s) => s.selectedNodeId);
  const nodes = useLabStore((s) => s.nodes);

  const [activeTab, setActiveTab] = useState<QuestionTab>('problem');
  const [report, setReport] = useState<GradeReport | null>(null);
  const [progress, setProgress] = useState<QuestionProgress>(() => getProgress(question.id));
  const [panelCollapsed, setPanelCollapsedState] = useState<boolean>(readPanelCollapsed);

  function setPanelCollapsed(collapsed: boolean) {
    setPanelCollapsedState(collapsed);
    writePanelCollapsed(collapsed);
  }

  // A pure mount effect — PracticeWorkspace below remounts this whole
  // component (via `key={question.id}`) whenever the question changes, so
  // there's no "reset state on prop change" logic needed here; local state
  // (activeTab/report/progress) is already fresh from its initializers.
  useEffect(() => {
    enterPractice(question.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const solutionUnlocked = Boolean(report?.accepted) || progress.solutionViewed;

  function handleSubmit() {
    const currentGraph = JSON.parse(exportJson()) as SimGraph;
    const result = evaluate(question, currentGraph);
    setReport(result);
    setProgress(recordAttempt(question.id, currentGraph, result.score, result.accepted));
    setActiveTab('results');
    // If the panel was collapsed to a rail, Submit should still surface the
    // Results tab rather than leave the user staring at icons.
    if (panelCollapsed) setPanelCollapsed(false);
  }

  function handleGiveUp() {
    const confirmed = window.confirm(
      'Give up and reveal the optimal solution? You can still submit afterwards, but this attempt is flagged as solution-viewed.',
    );
    if (!confirmed) return;
    setProgress(markSolutionViewed(question.id));
    setActiveTab('solution');
  }

  function handleLoadSolution() {
    // Snapshot the user's own attempt into progress before overwriting the
    // canvas, so it isn't silently lost (SPEC-PRACTICE.md §8).
    const currentGraph = JSON.parse(exportJson()) as SimGraph;
    setProgress(recordAttempt(question.id, currentGraph, report?.score ?? 0, report?.accepted ?? false));

    const payload = {
      version: 1 as const,
      nodes: question.solution.nodes.map((n) => ({
        ...n,
        position: question.solution.positions[n.id] ?? { x: 0, y: 0 },
      })),
      edges: question.solution.edges,
      global: question.targetLoad,
    };
    importJson(JSON.stringify(payload));
  }

  return (
    <div className="chaos-lab flex h-screen w-screen flex-col overflow-hidden">
      <header className="chaos-toolbar glass-panel flex h-16 shrink-0 items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex flex-col leading-tight transition-opacity duration-150 hover:opacity-80">
            <span className="text-sm font-semibold tracking-tight text-foreground">ChaosLab</span>
            <span className="text-[11px] text-accent">Practice</span>
          </Link>
          <div className="mx-1 h-8 w-px shrink-0" style={{ background: 'var(--panel-border)' }} />
          <span className="truncate text-[13px] font-medium text-foreground">{question.title}</span>
          <span
            className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ borderColor: alphaVar(DIFFICULTY_COLOR[question.difficulty], 55), color: DIFFICULTY_COLOR[question.difficulty] }}
          >
            {question.difficulty}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          <span className="hidden shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] text-muted sm:inline" style={{ background: 'var(--chip-bg)' }}>
            Graded at {formatCompact(question.targetLoad.users)} users
          </span>
          <UserLoadSlider />
          <div className="mx-1 h-8 w-px shrink-0" style={{ background: 'var(--panel-border)' }} />
          <button
            type="button"
            onClick={handleSubmit}
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-[12px] font-semibold text-background transition-opacity duration-150 hover:opacity-90"
          >
            Submit
          </button>
          <div className="mx-1 h-8 w-px shrink-0" style={{ background: 'var(--panel-border)' }} />
          <ThemeToggle />
        </div>
      </header>

      <PaletteBar />

      <div className="flex min-h-0 flex-1">
        <QuestionPanel
          question={question}
          report={report}
          solutionUnlocked={solutionUnlocked}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onGiveUp={handleGiveUp}
          onLoadSolution={handleLoadSolution}
          collapsed={panelCollapsed}
          onCollapsedChange={setPanelCollapsed}
        />
        <main className="relative min-w-0 flex-1">
          <Canvas />
        </main>
        {selectedNode && <Inspector node={selectedNode} />}
      </div>
      <MetricsBar />
    </div>
  );
}

/**
 * Full practice question workspace (SPEC-PRACTICE.md §8) — reuses the exact
 * same Canvas/PaletteBar/Inspector/MetricsBar components as the sandbox
 * playground (via the shared `useLabStore`), just with a practice-specific
 * header + collapsible left QuestionPanel in place of the sandbox Toolbar.
 * Layout is toolbar row, PaletteBar strip row, then [QuestionPanel | canvas]
 * — same top-strip layout as the sandbox. Loaded via
 * `next/dynamic({ ssr: false })` from the route's page.tsx for the same
 * reason PlaygroundShell is — React Flow measures real DOM on mount.
 */
export default function PracticeWorkspace({ question }: { question: Question }) {
  return (
    <ReactFlowProvider>
      {/* `key` forces a full remount on question change, so PracticeBody's
       * local state (activeTab/report/progress) never needs a manual reset
       * effect — see the comment on its mount effect. */}
      <PracticeBody key={question.id} question={question} />
    </ReactFlowProvider>
  );
}
