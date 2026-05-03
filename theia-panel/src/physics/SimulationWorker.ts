/// <reference lib="webworker" />
/**
 * Physics simulation worker. Runs the d3-force-3d simulation off the
 * main thread so render frames don't stall during the convergence
 * period.
 *
 * Protocol (see state/simulation.ts for the main-thread side):
 *   main → worker:
 *     init           — build simulation for the supplied graph
 *     replaceActive  — rebuild simulation for a new active node set
 *     wake           — bump alpha + start posting again
 *     dispose        — stop simulation, exit
 *
 *   worker → main:
 *     positions      — buffer of [x0,y0,z0, x1,y1,z1, ...] for each
 *                      node, indexed by graph node order
 *     snapshot       — full {id, x, y, z, vx, vy, vz} array on demand
 *
 * The worker self-throttles: ticks at ~60Hz internally (setTimeout
 * loop), but stops posting once it detects the layout has settled.
 * Wake messages restart posting. Main thread keeps rendering at full
 * refresh rate independent of the worker; positions arrive
 * asynchronously and are interpolated via a lerp on the main side.
 */

import { createSimulation } from "./Simulation";
import { hashN11 } from "../util/hash";
import type { TheiaGraph } from "../data/types";

type SimNodes = ReturnType<typeof createSimulation>["nodes"];

export type SnapshotPayloadNode = {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
};

export type SeedNode = {
  id: string;
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
};

export type WorkerInMsg =
  | {
      type: "init";
      graph: TheiaGraph;
      kinds: string[];
      isOnboarding: boolean;
      seedNodes?: SeedNode[];
      animateNew?: boolean;
    }
  | {
      type: "replaceActive";
      activeIds: string[] | null;
      animateNew: boolean;
      preserveExisting: boolean;
      seedNodes?: SeedNode[];
      isOnboarding: boolean;
    }
  | { type: "wake" }
  | { type: "relayout" }
  | { type: "snapshotRequest"; requestId: number }
  | { type: "dispose" };

export type WorkerOutMsg =
  | {
      type: "positions";
      buffer: ArrayBuffer; // Float32Array of length n*3, x/y/z per node in graph order
      settled: boolean;
    }
  | {
      type: "ready";
      // Sent once after init completes — main thread treats this as a
      // signal that subsequent position messages can be expected.
    }
  | {
      type: "snapshot";
      requestId: number;
      nodes: SnapshotPayloadNode[];
    };

const TICK_INTERVAL_MS = 1000 / 60;

// Settled-physics gate (worker side): stop posting positions when the
// per-tick max squared displacement is below threshold for N consecutive
// ticks. Wake messages reset the counter.
const SETTLED_THRESHOLD = 30;
const SETTLE_EPSILON_SQ = 1e-6;
const WAKE_ALPHA = 0.18;

let graph: TheiaGraph | null = null;
let nodeIndexById = new Map<string, number>();
let simNodes: SimNodes = [];
let simulation: ReturnType<typeof createSimulation>["simulation"] | null = null;
let kinds = new Set<string>();
let onboarding = false;
let settledTicks = 0;
let lastPositions: Float32Array | null = null; // n*3
let tickHandle: ReturnType<typeof setTimeout> | null = null;
let disposed = false;

function simulationGraphFor(activeIds: Set<string> | null): TheiaGraph {
  if (!graph) throw new Error("worker not initialized");
  if (!activeIds) return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => activeIds.has(node.id)),
    edges: graph.edges.filter(
      (edge) => activeIds.has(edge.source) && activeIds.has(edge.target),
    ),
  };
}

function applyReplaceActive(opts: {
  activeIds: string[] | null;
  animateNew: boolean;
  preserveExisting: boolean;
  seedNodes?: SeedNode[];
  isOnboarding: boolean;
}) {
  if (!graph) return;
  const activeIdSet = opts.activeIds ? new Set(opts.activeIds) : null;
  onboarding = opts.isOnboarding;

  const oldPositions = new Map<
    string,
    {
      x: number;
      y: number;
      z: number;
      vx?: number;
      vy?: number;
      vz?: number;
    }
  >();
  if (opts.preserveExisting) {
    for (const sn of simNodes) {
      if (sn) {
        oldPositions.set(sn.id, {
          x: sn.x,
          y: sn.y,
          z: sn.z,
          vx: sn.vx,
          vy: sn.vy,
          vz: sn.vz,
        });
      }
    }
  }
  const seedById = new Map<string, SeedNode>();
  for (const seed of opts.seedNodes ?? []) seedById.set(seed.id, seed);

  simulation?.stop();
  const simResult = createSimulation(
    simulationGraphFor(activeIdSet),
    kinds,
    opts.isOnboarding ? "onboarding" : "normal",
  );
  simulation = simResult.simulation;
  simulation.stop();

  const nextNodes = new Array(graph.nodes.length) as SimNodes;
  for (const sn of simResult.nodes) {
    const idx = nodeIndexById.get(sn.id);
    if (idx === undefined) continue;
    const old = opts.preserveExisting ? oldPositions.get(sn.id) : undefined;
    const seed = seedById.get(sn.id);
    if (old || seed) {
      const source = old ?? seed!;
      sn.x = source.x;
      sn.y = source.y;
      sn.z = source.z;
      sn.vx = source.vx ?? 0;
      sn.vy = source.vy ?? 0;
      sn.vz = source.vz ?? 0;
    } else if (opts.animateNew) {
      const jitter = 0.08;
      sn.x = sn.anchorX * 0.55 + hashN11(`${sn.id}:x`) * jitter;
      sn.y = sn.anchorY * 0.55 + hashN11(`${sn.id}:y`) * jitter;
      sn.z = sn.anchorZ * 0.55 + hashN11(`${sn.id}:z`) * jitter;
      sn.vx = (sn.anchorX - sn.x) * 0.006;
      sn.vy = (sn.anchorY - sn.y) * 0.006;
      sn.vz = (sn.anchorZ - sn.z) * 0.006;
    }
    nextNodes[idx] = sn;
  }
  simNodes = nextNodes;
  simulation.alpha(opts.animateNew ? 0.22 : simulation.alphaTarget());
  settledTicks = 0;
  scheduleTick();
}

function scheduleTick() {
  if (disposed) return;
  if (tickHandle !== null) return;
  tickHandle = setTimeout(runTick, TICK_INTERVAL_MS);
}

function runTick() {
  tickHandle = null;
  if (disposed || !simulation || !graph) return;

  // Even when settled we still need to listen for wake; just skip the
  // sim+post cycle. Re-arm cheaply so we wake quickly on incoming
  // messages.
  if (settledTicks >= SETTLED_THRESHOLD) {
    return;
  }

  simulation.tick(1);

  const n = graph.nodes.length;
  if (!lastPositions || lastPositions.length !== n * 3) {
    lastPositions = new Float32Array(n * 3);
  }
  const out = new Float32Array(n * 3);
  let maxDeltaSq = 0;
  for (let i = 0; i < n; i++) {
    const sn = simNodes[i];
    if (!sn) {
      out[i * 3 + 0] = lastPositions[i * 3 + 0]!;
      out[i * 3 + 1] = lastPositions[i * 3 + 1]!;
      out[i * 3 + 2] = lastPositions[i * 3 + 2]!;
      continue;
    }
    const dx = sn.x - lastPositions[i * 3 + 0]!;
    const dy = sn.y - lastPositions[i * 3 + 1]!;
    const dz = sn.z - lastPositions[i * 3 + 2]!;
    const deltaSq = dx * dx + dy * dy + dz * dz;
    if (deltaSq > maxDeltaSq) maxDeltaSq = deltaSq;
    out[i * 3 + 0] = sn.x;
    out[i * 3 + 1] = sn.y;
    out[i * 3 + 2] = sn.z;
  }
  lastPositions.set(out);

  if (maxDeltaSq < SETTLE_EPSILON_SQ) settledTicks++;
  else settledTicks = 0;

  const buffer = out.buffer;
  const msg: WorkerOutMsg = {
    type: "positions",
    buffer,
    settled: settledTicks >= SETTLED_THRESHOLD,
  };
  (self as unknown as Worker).postMessage(msg, [buffer]);

  scheduleTick();
}

function applyWake() {
  settledTicks = 0;
  if (simulation && simulation.alpha() < WAKE_ALPHA) {
    simulation.alpha(WAKE_ALPHA);
  }
  scheduleTick();
}

// Re-seed every active simNode back to its anchor (with deterministic
// per-node jitter) and bump alpha to 1.0 so the simulation converges
// from a perturbed start. The default layout otherwise stays close to
// whatever local minimum the first run found; this gives the user a way
// to trigger a fresh convergence pass.
function applyRelayout() {
  if (!simulation) return;
  const jitter = 0.35;
  for (const sn of simNodes) {
    if (!sn) continue;
    sn.x = sn.anchorX + hashN11(`${sn.id}:relayout-x`) * jitter;
    sn.y = sn.anchorY + hashN11(`${sn.id}:relayout-y`) * jitter;
    sn.z = sn.anchorZ + hashN11(`${sn.id}:relayout-z`) * jitter;
    sn.vx = 0;
    sn.vy = 0;
    sn.vz = 0;
  }
  simulation.alpha(1.0);
  settledTicks = 0;
  scheduleTick();
}

function applySnapshot(requestId: number) {
  const nodes: SnapshotPayloadNode[] = [];
  for (const sn of simNodes) {
    if (!sn) continue;
    nodes.push({
      id: sn.id,
      x: sn.x,
      y: sn.y,
      z: sn.z,
      vx: sn.vx ?? 0,
      vy: sn.vy ?? 0,
      vz: sn.vz ?? 0,
    });
  }
  const msg: WorkerOutMsg = { type: "snapshot", requestId, nodes };
  (self as unknown as Worker).postMessage(msg);
}

self.addEventListener("message", (e: MessageEvent<WorkerInMsg>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      graph = msg.graph;
      kinds = new Set(msg.kinds);
      onboarding = msg.isOnboarding;
      nodeIndexById = new Map(graph.nodes.map((n, i) => [n.id, i]));
      lastPositions = new Float32Array(graph.nodes.length * 3);
      applyReplaceActive({
        activeIds: null,
        animateNew: msg.animateNew ?? false,
        preserveExisting: false,
        seedNodes: msg.seedNodes,
        isOnboarding: msg.isOnboarding,
      });
      const ready: WorkerOutMsg = { type: "ready" };
      (self as unknown as Worker).postMessage(ready);
      return;
    }
    case "replaceActive":
      applyReplaceActive(msg);
      return;
    case "wake":
      applyWake();
      return;
    case "relayout":
      applyRelayout();
      return;
    case "snapshotRequest":
      applySnapshot(msg.requestId);
      return;
    case "dispose":
      disposed = true;
      simulation?.stop();
      if (tickHandle !== null) {
        clearTimeout(tickHandle);
        tickHandle = null;
      }
      return;
  }
});
