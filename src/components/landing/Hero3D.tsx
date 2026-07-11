"use client";

import dynamic from "next/dynamic";

import styles from "./landing.module.css";

/**
 * Wraps the react-three-fiber hero accent. `ssr:false` is only legal inside
 * a Client Component (this file), so the actual <Canvas> lives in a
 * separately dynamically-imported module (HeroScene.tsx). While that chunk
 * loads — and on the server, where it never renders — a static CSS glow
 * stands in so there's no layout jank or blank flash.
 */
const HeroScene = dynamic(() => import("./HeroScene"), {
  ssr: false,
  loading: () => <HeroFallback />,
});

function HeroFallback() {
  return (
    <div
      className={`${styles.fallbackGlow} h-full w-full rounded-full`}
      style={{
        // color-mix() (not the invalid "var() + hex suffix" trick — see
        // globals.css) yields a valid alpha color automatically per theme —
        // cyan glow in dark, deeper teal in light.
        background:
          "radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--accent-strong) 16%, transparent), color-mix(in srgb, var(--accent) 5%, transparent) 45%, transparent 70%)",
      }}
    />
  );
}

export default function Hero3D() {
  return (
    <div
      className="pointer-events-none hidden h-[420px] w-full select-none md:block lg:h-[480px]"
      aria-hidden="true"
    >
      <HeroScene />
    </div>
  );
}
