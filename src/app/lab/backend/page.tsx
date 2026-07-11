'use client';

import dynamic from 'next/dynamic';

// React Flow measures real DOM on mount and must never run during SSR/RSC
// prerendering — load the whole playground client-side only.
const PlaygroundShell = dynamic(() => import('../../../components/lab/PlaygroundShell'), {
  ssr: false,
  loading: () => (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-2 text-center">
      <p className="text-lg text-foreground">Loading the lab…</p>
    </main>
  ),
});

export default function BackendLabPage() {
  return <PlaygroundShell />;
}
