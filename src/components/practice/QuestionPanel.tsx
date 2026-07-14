'use client';

import { ChevronLeft, ChevronRight, Lightbulb, ListChecks, MapPinned, ScrollText } from 'lucide-react';

import type { GradeReport, Question } from '../../lib/practice/types';
import HintsPanel from './HintsPanel';
import ProblemPanel from './ProblemPanel';
import RubricResults from './RubricResults';
import SolutionView from './SolutionView';

export type QuestionTab = 'problem' | 'hints' | 'results' | 'solution';

const TABS: { id: QuestionTab; label: string; Icon: typeof ScrollText }[] = [
  { id: 'problem', label: 'Problem', Icon: ScrollText },
  { id: 'hints', label: 'Hints', Icon: Lightbulb },
  { id: 'results', label: 'Results', Icon: ListChecks },
  { id: 'solution', label: 'Solution', Icon: MapPinned },
];

/**
 * Left panel of the practice workspace (SPEC-PRACTICE.md §8): tabbed
 * Problem/Hints/Results/Solution. `activeTab` is lifted to the parent so
 * Submit can force-switch to Results.
 *
 * Collapsible (product-owner layout change, frees canvas width): a single
 * `<aside>` animates its width between the full 420px panel and a ~44px
 * icon-only rail, so the width change transitions smoothly and the canvas
 * (a flex sibling) reflows continuously rather than jump-cutting. `collapsed`
 * / `onCollapsedChange` are lifted to the parent, which persists the state to
 * localStorage and force-expands on Submit.
 */
export default function QuestionPanel({
  question,
  report,
  solutionUnlocked,
  activeTab,
  onTabChange,
  onGiveUp,
  onLoadSolution,
  collapsed,
  onCollapsedChange,
}: {
  question: Question;
  report: GradeReport | null;
  solutionUnlocked: boolean;
  activeTab: QuestionTab;
  onTabChange: (tab: QuestionTab) => void;
  onGiveUp: () => void;
  onLoadSolution: () => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  /** Rail icon click: jump straight to that tab and expand in one action. */
  function openTab(tab: QuestionTab) {
    onTabChange(tab);
    onCollapsedChange(false);
  }

  return (
    <aside
      className={`chaos-inspector chaos-question-panel glass-panel flex shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-in-out ${
        collapsed ? 'w-11' : 'w-[420px]'
      }`}
      aria-label="Question panel"
    >
      {collapsed ? (
        <div className="flex h-full flex-col items-center gap-1 overflow-hidden py-3">
          <button
            type="button"
            onClick={() => onCollapsedChange(false)}
            aria-label="Expand question panel"
            title="Expand panel"
            className="chaos-rail-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:text-foreground"
          >
            <ChevronRight size={16} />
          </button>

          <div className="my-1.5 h-px w-6 shrink-0" style={{ background: 'var(--panel-border)' }} />

          <div className="flex flex-col gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => openTab(tab.id)}
                aria-label={`Expand to ${tab.label}`}
                title={tab.label}
                className={`chaos-rail-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ${
                  activeTab === tab.id ? 'bg-accent/15 text-accent' : 'text-muted hover:text-foreground'
                }`}
              >
                <tab.Icon size={15} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center border-b" style={{ borderColor: 'var(--panel-border)' }}>
            <div className="flex min-w-0 flex-1">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] font-medium transition-colors duration-150 ${
                    activeTab === tab.id ? 'border-b-2 border-accent text-accent' : 'border-b-2 border-transparent text-muted hover:text-foreground'
                  }`}
                >
                  <tab.Icon size={13} />
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onCollapsedChange(true)}
              aria-label="Collapse question panel"
              title="Collapse panel"
              className="chaos-rail-btn flex h-9 w-9 shrink-0 items-center justify-center text-muted transition-colors duration-150 hover:text-foreground"
            >
              <ChevronLeft size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {activeTab === 'problem' && <ProblemPanel question={question} />}
            {activeTab === 'hints' && <HintsPanel hints={question.hints} />}
            {activeTab === 'results' &&
              (report ? (
                <RubricResults report={report} budgets={question.budgets} />
              ) : (
                <p className="text-[12px] text-muted">Hit Submit to grade your design against the rubric.</p>
              ))}
            {activeTab === 'solution' && (
              <SolutionView question={question} unlocked={solutionUnlocked} onGiveUp={onGiveUp} onLoadSolution={onLoadSolution} />
            )}
          </div>
        </>
      )}
    </aside>
  );
}
