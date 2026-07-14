'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';

import { QUESTIONS } from '../../lib/practice/questions';

// React Flow measures real DOM on mount and must never run during SSR/RSC
// prerendering — load the whole practice workspace client-side only, same
// as the sandbox playground (components/lab/PlaygroundShell.tsx).
const PracticeWorkspace = dynamic(() => import('./PracticeWorkspace'), {
  ssr: false,
  loading: () => (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-2 text-center">
      <p className="text-lg text-foreground">Loading the question…</p>
    </main>
  ),
});

/** Client-side lookup + not-found handling for `/practice/[id]` (SPEC-PRACTICE.md §8). */
export default function PracticeRoute({ questionId }: { questionId: string }) {
  const question = QUESTIONS.find((q) => q.id === questionId);

  if (!question) {
    return (
      <main className="flex h-screen w-screen flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg text-foreground">Question not found.</p>
        <Link href="/" className="text-sm text-accent hover:underline">
          Back to ChaosLab
        </Link>
      </main>
    );
  }

  return <PracticeWorkspace question={question} />;
}
