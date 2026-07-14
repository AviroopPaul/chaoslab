'use client';

import { useEffect, useState } from 'react';

import { QUESTIONS } from '../../lib/practice/questions';
import { getProgress, type QuestionProgress } from '../../lib/practice/progress';
import QuestionCard from '../practice/QuestionCard';

const EMPTY_PROGRESS: QuestionProgress = { status: 'todo', bestScore: 0, lastGraph: null, solutionViewed: false };

/**
 * Landing page's LeetCode-style Questions list (SPEC-PRACTICE.md §7) — a
 * client component because per-question progress lives in localStorage.
 * Server-rendered with everything defaulted to "todo" (identical to what a
 * first-time visitor's localStorage would produce anyway), then hydrated
 * with real progress right after mount — no loading flash, no mismatch.
 */
export default function QuestionsList() {
  const [progress, setProgress] = useState<Record<string, QuestionProgress>>({});

  useEffect(() => {
    const map: Record<string, QuestionProgress> = {};
    for (const q of QUESTIONS) map[q.id] = getProgress(q.id);
    // Deliberate one-shot hydration pattern, not the "derive state during
    // render" anti-pattern the rule normally guards against: the server (and
    // the client's first paint, before this effect runs) can only ever
    // render the "todo" default since localStorage isn't available yet — so
    // rendering that default first and patching in the real progress right
    // after mount is what avoids a hydration mismatch, not what causes one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(map);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {QUESTIONS.map((question) => (
        <QuestionCard key={question.id} question={question} progress={progress[question.id] ?? EMPTY_PROGRESS} />
      ))}
    </div>
  );
}
