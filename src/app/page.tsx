import Link from "next/link";
import {
  ArrowRight,
  Cable,
  ChevronDown,
  MousePointerClick,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import Hero3D from "@/components/landing/Hero3D";
import QuestionsList from "@/components/landing/QuestionsList";
import TemplateCard from "@/components/landing/TemplateCard";
import styles from "@/components/landing/landing.module.css";
import ThemeToggle from "@/components/ThemeToggle";
import { PRESETS } from "@/lib/sim/presets";

/**
 * Landing page (SPEC-PRACTICE.md §7). Server Component — the only
 * client-side work (the r3f hero, the Questions list's localStorage read,
 * and the lab's own `ssr:false` dynamic import) is pushed down into their
 * own small client components so this file stays a plain, fast-loading
 * shell.
 *
 * Practice-first layout: Questions (primary) -> Templates -> Sandbox, with
 * the not-yet-built modules demoted to a single muted footnote line. The old
 * 4-tile Modules grid (ModuleCard) is retired by this restructure.
 */

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
              Pick a classic system design question, build your answer on a
              visual canvas, and get graded by a rubric evaluated against a
              live simulation — LeetCode for system design.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <a
                href="#questions"
                className={`${styles.ctaButton} inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
              >
                Start practicing
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <a
                href="#templates"
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-3 text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Browse templates
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>

          <Hero3D />
        </div>
      </section>

      {/* Questions — primary, LeetCode-style list */}
      <section id="questions" className="scroll-mt-8 px-6 pb-20 lg:px-12">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">
            Questions
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Classic system design questions, graded by a rubric evaluated
            against your architecture and a live simulation at real-world
            scale.
          </p>
          <div className="mt-8">
            <QuestionsList />
          </div>
        </div>
      </section>

      {/* Templates */}
      <section id="templates" className="scroll-mt-8 px-6 pb-20 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">
            Templates
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Hand-tuned reference architectures — open one straight in the lab
            with its reasoning already explained.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {PRESETS.map((preset) => (
              <TemplateCard key={preset.id} preset={preset} />
            ))}
          </div>
        </div>
      </section>

      {/* Sandbox */}
      <section className="px-6 pb-20 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <Link
            href="/lab/backend"
            className={`glass-panel group flex items-center justify-between gap-4 rounded-xl border border-accent/30 p-6 transition-colors duration-150 hover:border-accent/70 hover:bg-[var(--hover-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong ${styles.card}`}
          >
            <div>
              <h3 className="text-lg font-semibold text-foreground group-hover:text-accent">
                Sandbox
              </h3>
              <p className="mt-1 text-sm text-muted">
                Free play — blank canvas, no rubric, no grading.
              </p>
            </div>
            <ArrowRight className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          </Link>
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
        <p className="mt-1 text-xs text-muted/70">
          More arenas coming: Frontend Delivery · LLM Inference · Realtime &amp; Streaming
        </p>
      </footer>
    </main>
  );
}
