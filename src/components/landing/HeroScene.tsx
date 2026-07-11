"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { getTheme, subscribeTheme, type Theme } from "../theme";

/**
 * The Three.js hero accent (SPEC.md §8): a slowly rotating cluster of small
 * glowing nodes connected by thin lines, evocative of a distributed system.
 * Cheap on purpose — ~40 points, ~80 line segments, unlit materials, no
 * postprocessing. Imported by Hero3D.tsx via next/dynamic with ssr:false.
 *
 * Colors can't flow through CSS custom properties here — these are Three.js
 * materials, not DOM elements — so `NodeCluster` reads `data-theme` directly
 * via the shared theme module and imperatively updates each material's
 * `.color`/`.opacity` on toggle (no remount, no dropped frames).
 */

const NODE_COUNT = 40;
const RADIUS = 2.35;
const NEIGHBORS_PER_NODE = 2;

const HERO_THEME_COLORS: Record<Theme, { line: string; lineOpacity: number; point: string; pointOpacity: number }> = {
  // Bright cyan glow, evocative on a near-black canvas.
  dark: { line: "#22d3ee", lineOpacity: 0.18, point: "#67e8f9", pointOpacity: 0.9 },
  // Deeper teal/slate — same family, darkened so it still reads against a
  // light background instead of washing out (SPEC: "deeper teal/slate on
  // light"). Slightly higher opacity to compensate for the lower-contrast
  // dark-on-light relationship vs. dark theme's light-on-dark one.
  light: { line: "#0e7490", lineOpacity: 0.28, point: "#155e75", pointOpacity: 0.85 },
};

function fibonacciSpherePoints(count: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2; // 1 .. -1
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;
    points.push(new THREE.Vector3(x * radius, y * radius, z * radius));
  }
  return points;
}

/** Connect each node to its `neighborsPerNode` nearest neighbors, deduped. */
function buildEdges(
  points: THREE.Vector3[],
  neighborsPerNode: number,
): [number, number][] {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const nearest = points
      .map((p, j) => ({ j, d: i === j ? Infinity : points[i].distanceTo(p) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, neighborsPerNode);
    for (const { j } of nearest) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(i < j ? [i, j] : [j, i]);
      }
    }
  }
  return edges;
}

function useReducedMotionRef() {
  const ref = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      ref.current = mq.matches;
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return ref;
}

function NodeCluster() {
  const groupRef = useRef<THREE.Group>(null);
  const lineMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const pointsMaterialRef = useRef<THREE.PointsMaterial>(null);
  const reducedMotionRef = useReducedMotionRef();

  // Apply the current theme's colors immediately on mount, then again on
  // every toggle — `subscribeTheme` fires for either ThemeToggle instance
  // (lab Toolbar or landing header) since both just flip the same
  // `data-theme` attribute. `useLayoutEffect` (not `useEffect`) so the real
  // color is set before r3f's own rAF loop renders its first frame — this
  // component only ever mounts client-side (ssr:false), so there's no
  // hydration-mismatch downside to running synchronously post-commit.
  useLayoutEffect(() => {
    const applyTheme = () => {
      const colors = HERO_THEME_COLORS[getTheme()];
      const lineMat = lineMaterialRef.current;
      const pointsMat = pointsMaterialRef.current;
      if (lineMat) {
        lineMat.color.set(colors.line);
        lineMat.opacity = colors.lineOpacity;
      }
      if (pointsMat) {
        pointsMat.color.set(colors.point);
        pointsMat.opacity = colors.pointOpacity;
      }
    };
    applyTheme();
    return subscribeTheme(applyTheme);
  }, []);

  const points = useMemo(() => fibonacciSpherePoints(NODE_COUNT, RADIUS), []);
  const edges = useMemo(
    () => buildEdges(points, NEIGHBORS_PER_NODE),
    [points],
  );

  const pointsGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    });
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, [points]);

  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(edges.length * 2 * 3);
    edges.forEach(([a, b], i) => {
      const pa = points[a];
      const pb = points[b];
      positions[i * 6 + 0] = pa.x;
      positions[i * 6 + 1] = pa.y;
      positions[i * 6 + 2] = pa.z;
      positions[i * 6 + 3] = pb.x;
      positions[i * 6 + 4] = pb.y;
      positions[i * 6 + 5] = pb.z;
    });
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, [edges, points]);

  useEffect(() => {
    return () => {
      pointsGeometry.dispose();
      lineGeometry.dispose();
    };
  }, [pointsGeometry, lineGeometry]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group || reducedMotionRef.current) return;
    group.rotation.y += delta * 0.06;
    group.rotation.x = Math.sin(state.clock.elapsedTime * 0.15) * 0.08;
    group.position.y = Math.sin(state.clock.elapsedTime * 0.4) * 0.08;
  });

  return (
    <group ref={groupRef}>
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial ref={lineMaterialRef} transparent />
      </lineSegments>
      <points geometry={pointsGeometry}>
        <pointsMaterial ref={pointsMaterialRef} size={0.07} sizeAttenuation transparent />
      </points>
    </group>
  );
}

export default function HeroScene() {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 0, 6.2], fov: 42 }}
      frameloop="always"
      style={{ pointerEvents: "none" }}
    >
      <NodeCluster />
    </Canvas>
  );
}
