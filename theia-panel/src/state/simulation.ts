import { createSimulation } from "../physics/Simulation";
import type { TheiaGraph } from "../data/types";
import type { NodeLayer } from "../scene/Nodes";
import type { EdgeLayer } from "../scene/Edges";
import { hashN11 } from "../util/hash";
import type { PhysicsSnapshotNode } from "./physicsSnapshot";

type SimNodes = ReturnType<typeof createSimulation>["nodes"];

export interface ReplaceActiveOpts {
  activeIds: Set<string> | null;
  animateNew?: boolean;
  preserveExisting?: boolean;
  seedPositions?: Map<string, PhysicsSnapshotNode>;
}

export interface SimulationStateDeps {
  graph: TheiaGraph;
  kinds: Set<string>;
  /** True while onboarding is running (affects sim profile + lerp smoothing). */
  isOnboarding: () => boolean;
  /** Called once each tick after positions advance — caller flushes meshes. */
  nodes: NodeLayer;
  edges: EdgeLayer;
  /** Shared with NodeLayer — sim writes node-space positions here each tick. */
  nodePositions: Float32Array;
}

export interface SimulationState {
  /** Advance the sim, lerp toward sim positions, flush meshes. No-op once settled. */
  tick(): void;
  /** Reset settle gate + bump alpha so filter/visibility changes re-equilibrate. */
  wakePhysics(): void;
  /** Rebuild simulation for a new active set (filters, focus, snapshot restore). */
  replaceActive(opts: ReplaceActiveOpts): void;
  /** Force renderedPositions/meshes to sim positions immediately (post-restore). */
  syncRenderedPositionsFromSimulation(): void;
  /** Run a single internal sim tick — used to settle initial layout before display. */
  primeOnce(): void;
  /** Read the current sim position of node by index (for camera focus, etc). */
  getNodePosition(idx: number): { x: number; y: number; z: number } | null;
  /** Snapshot input for physicsSnapshotIO.save. */
  getSimNodes(): SimNodes;
  dispose(): void;
}

// Settled-physics gate: skip the per-frame sim/lerp/edge-rewrite when the
// layout has stabilised. The lerp drives matrix uploads and a full
// edge-position attribute rewrite every frame; with 1.6k nodes that's
// most of the per-frame cost once the simulation has converged.
const SETTLED_THRESHOLD = 30;
// Threshold ≈ 0.001² in world units — well below visible motion at any
// reasonable zoom, since node sizes top out at 0.18 (see Nodes.ts).
const SETTLE_EPSILON_SQ = 1e-6;
// Energy injected on wake so filter/visibility changes actually produce
// a visible re-equilibration. Without this, alpha sits at alphaTarget
// (0.012, see Simulation.ts) which makes wake invisible — sub-pixel
// motion that re-settles within a few ticks.
const WAKE_ALPHA = 0.18;

const ONBOARDING_SMOOTHING = 0.14;
const NORMAL_SMOOTHING = 0.34;

export function createSimulationState(
  deps: SimulationStateDeps,
): SimulationState {
  const { graph, kinds, isOnboarding, nodes, edges, nodePositions } = deps;
  const renderedPositions = new Float32Array(graph.nodes.length * 3);
  const nodeIndex = new Map<string, number>(
    graph.nodes.map((n, i) => [n.id, i]),
  );

  let simNodes: SimNodes = [];
  let simulation: ReturnType<typeof createSimulation>["simulation"];
  let settledFrames = 0;

  function simulationGraphFor(activeIds: Set<string> | null): TheiaGraph {
    if (!activeIds) return graph;
    return {
      ...graph,
      nodes: graph.nodes.filter((node) => activeIds.has(node.id)),
      edges: graph.edges.filter(
        (edge) => activeIds.has(edge.source) && activeIds.has(edge.target),
      ),
    };
  }

  function replaceActive(opts: ReplaceActiveOpts) {
    const {
      activeIds,
      animateNew = false,
      preserveExisting = true,
      seedPositions = new Map<string, PhysicsSnapshotNode>(),
    } = opts;

    const oldPositions = new Map<
      string,
      { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number }
    >();
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

    simulation?.stop();
    const simResult = createSimulation(
      simulationGraphFor(activeIds),
      kinds,
      isOnboarding() ? "onboarding" : "normal",
    );
    simulation = simResult.simulation;
    simulation.stop();

    const nextNodes = new Array(graph.nodes.length) as SimNodes;
    for (const sn of simResult.nodes) {
      const idx = nodeIndex.get(sn.id);
      if (idx === undefined) continue;
      const old = preserveExisting ? oldPositions.get(sn.id) : undefined;
      const seed = seedPositions.get(sn.id);
      if (old || seed) {
        const source = old ?? seed!;
        sn.x = source.x;
        sn.y = source.y;
        sn.z = source.z;
        sn.vx = source.vx ?? 0;
        sn.vy = source.vy ?? 0;
        sn.vz = source.vz ?? 0;
      } else if (animateNew) {
        const jitter = 0.08;
        sn.x = sn.anchorX * 0.55 + hashN11(`${sn.id}:x`) * jitter;
        sn.y = sn.anchorY * 0.55 + hashN11(`${sn.id}:y`) * jitter;
        sn.z = sn.anchorZ * 0.55 + hashN11(`${sn.id}:z`) * jitter;
        sn.vx = (sn.anchorX - sn.x) * 0.006;
        sn.vy = (sn.anchorY - sn.y) * 0.006;
        sn.vz = (sn.anchorZ - sn.z) * 0.006;
        renderedPositions[idx * 3] = sn.x;
        renderedPositions[idx * 3 + 1] = sn.y;
        renderedPositions[idx * 3 + 2] = sn.z;
        nodes.setPosition(idx, sn.x, sn.y, sn.z);
      }
      nextNodes[idx] = sn;
    }
    simNodes = nextNodes;
    simulation.alpha(animateNew ? 0.22 : simulation.alphaTarget());
    wakePhysics();
  }

  function wakePhysics() {
    settledFrames = 0;
    if (simulation && simulation.alpha() < WAKE_ALPHA) {
      simulation.alpha(WAKE_ALPHA);
    }
  }

  function syncRenderedPositionsFromSimulation() {
    wakePhysics();
    for (let i = 0; i < simNodes.length; i++) {
      const sn = simNodes[i];
      if (!sn) continue;
      renderedPositions[i * 3] = sn.x;
      renderedPositions[i * 3 + 1] = sn.y;
      renderedPositions[i * 3 + 2] = sn.z;
      nodes.setPosition(i, sn.x, sn.y, sn.z);
    }
    nodes.flush();
    edges.updatePositions(nodePositions);
  }

  function tick() {
    if (settledFrames >= SETTLED_THRESHOLD) return;
    simulation.tick(1);
    const smoothing = isOnboarding() ? ONBOARDING_SMOOTHING : NORMAL_SMOOTHING;
    let maxDeltaSq = 0;
    for (let i = 0; i < simNodes.length; i++) {
      const sn = simNodes[i];
      if (!sn) continue;
      const px = renderedPositions[i * 3]!;
      const py = renderedPositions[i * 3 + 1]!;
      const pz = renderedPositions[i * 3 + 2]!;
      const dx = (sn.x - px) * smoothing;
      const dy = (sn.y - py) * smoothing;
      const dz = (sn.z - pz) * smoothing;
      const x = px + dx;
      const y = py + dy;
      const z = pz + dz;
      const deltaSq = dx * dx + dy * dy + dz * dz;
      if (deltaSq > maxDeltaSq) maxDeltaSq = deltaSq;
      renderedPositions[i * 3] = x;
      renderedPositions[i * 3 + 1] = y;
      renderedPositions[i * 3 + 2] = z;
      nodes.setPosition(i, x, y, z);
    }
    nodes.flush();
    edges.updatePositions(nodePositions);
    if (maxDeltaSq < SETTLE_EPSILON_SQ) settledFrames++;
    else settledFrames = 0;
  }

  function primeOnce() {
    simulation.tick(1);
  }

  function getNodePosition(idx: number) {
    const sn = simNodes[idx];
    if (!sn) return null;
    return { x: sn.x, y: sn.y, z: sn.z };
  }

  function dispose() {
    simulation?.stop();
  }

  return {
    tick,
    wakePhysics,
    replaceActive,
    syncRenderedPositionsFromSimulation,
    primeOnce,
    getNodePosition,
    getSimNodes: () => simNodes,
    dispose,
  };
}

