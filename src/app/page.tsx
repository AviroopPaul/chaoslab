import Link from "next/link";
import {
  ArrowRight,
  Brain,
  Cable,
  ChevronDown,
  Globe,
  MousePointerClick,
  Radio,
  Server,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import Hero3D from "@/components/landing/Hero3D";
import ModuleCard from "@/components/landing/ModuleCard";
import styles from "@/components/landing/landing.module.css";
import ThemeToggle from "@/components/ThemeToggle";

/**
 * Landing page (SPEC.md §8). Server Component — the only client-side work
 * (the r3f hero and its ssr:false dynamic import) is pushed down into
 * Hero3D.tsx so this file stays a plain, fast-loading shell.
 */

interface ModuleDef {
  title: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  status: "live" | "soon";
}

const MODULES: ModuleDef[] = [
  {
    title: "Backend Basics",
    description:
      "Servers, load balancers, caches, shards — the classic scaling story.",
    icon: Server,
    href: "/lab/backend",
    status: "live",
  },
  {
    title: "Frontend Delivery",
    description:
      "CDNs, edge caching, and asset delivery — where the last mile gets fast or falls apart.",
    icon: Globe,
    status: "soon",
  },
  {
    title: "LLM Inference",
    description:
      "Batching, KV caches, and GPU queues — the economics of serving a model at scale.",
    icon: Brain,
    status: "soon",
  },
  {
    title: "Realtime & Streaming",
    description:
      "WebSockets, pub/sub, and backpressure — keeping a firehose of live events under control.",
    icon: Radio,
    status: "soon",
  },
];

interface StepDef {
  icon: LucideIcon;
  title: string;
  description: string;
}

const STEPS: StepDef[] = [
  {
    icon: MousePointerClick,
    title: "Drag components",
    description: "Pull servers, caches, queues and more onto the canvas.",
  },
  {
    icon: Cable,
    title: "Wire them up",
    description: "Connect nodes to shape how traffic actually flows.",
  },
  {
    icon: SlidersHorizontal,
    title: "Crank the load",
    description:
      "Slide users from 10 to 500 million and watch it hold — or melt.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Slim nav row — brand + theme toggle, top-right corner */}
      <header className="flex items-center justify-between px-6 py-5 lg:px-12">
        <span className="text-sm font-semibold tracking-tight text-foreground">
          ChaosLab
        </span>
        <ThemeToggle />
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden px-6 pt-8 pb-20 sm:pt-12 lg:px-12">
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
          <div className="flex flex-col items-start gap-6 text-left">
            <h1 className="bg-gradient-to-r from-foreground to-accent-strong bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl">
              ChaosLab
            </h1>
            <p className="text-xl font-medium text-foreground sm:text-2xl">
              Build a system. Break it. Learn why.
            </p>
            <p className="max-w-md text-base text-muted">
              A visual playground for system design — drag in servers, caches
              and shards, crank the users to 100 million, and watch what
              breaks.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link
                href="/lab/backend"
                className={`${styles.ctaButton} inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
              >
                Open the lab
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <a
                href="#modules"
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-3 text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Browse modules
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>

          <Hero3D />
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="scroll-mt-8 px-6 pb-20 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">
            Modules
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Each module is a self-contained simulator for one corner of
            system design.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {MODULES.map((mod) => (
              <ModuleCard key={mod.title} {...mod} />
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 pb-20 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">
            How it works
          </h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="glass-panel flex flex-col gap-3 rounded-xl border border-panel-border p-6"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                    {i + 1}
                  </span>
                  <step.icon className="h-5 w-5 text-accent" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  {step.title}
                </h3>
                <p className="text-sm text-muted">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-panel-border px-6 py-8 text-center lg:px-12">
        <p className="text-sm text-muted">
          ChaosLab — learn system design by breaking things.
        </p>
      </footer>
    </main>
  );
}
