import type { TheiaGraph } from "../data/types";
import type { NodeLayer } from "../scene/Nodes";
import type { EdgeLayer } from "../scene/Edges";
import type { PhysicsSnapshotNode } from "./physicsSnapshot";
import type { createSimulation } from "../physics/Simulation";
import SimulationWorker from "../physics/SimulationWorker?worker";
import type {
  SeedNode,
  SnapshotPayloadNode,
  WorkerInMsg,
  WorkerOutMsg,
} from "../physics/SimulationWorker";

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
  isOnboarding: () => boolean;
  nodes: NodeLayer;
  edges: EdgeLayer;
  /** Shared with NodeLayer — sim writes node-space positions here each tick. */
  nodePositions: Float32Array;
}

export interface SimulationState {
  tick(): void;
  wakePhysics(): void;
  /**
   * Re-seed positions to anchors (with jitter) and re-run the simulation
   * from alpha=1.0. Lets the user escape the layout produced by the
   * initial seed without rebuilding the worker or graph.
   */
  optimize(): void;
  replaceActive(opts: ReplaceActiveOpts): void;
  syncRenderedPositionsFromSimulation(): void;
  primeOnce(): void;
  getNodePosition(idx: number): { x: number; y: number; z: number } | null;
  /**
   * Synchronous view of the simulation's last-known node states, in
   * graph-node order. Built from cached worker positions/velocities;
   * may lag by up to one tick relative to the worker. Used by snapshot
   * save (`physicsSnapshotIO.save(...)`).
   */
  getSimNodes(): SimNodes;
  dispose(): void;
}

// Settled-physics gate (main side): the worker also has its own gate
// that suppresses position posts when the layout has converged. The
// main-side gate stops re-flushing meshes when both `lastSimPositions`
// has stopped changing AND the local lerp has caught up.
const SETTLED_THRESHOLD = 30;
const SETTLE_EPSILON_SQ = 1e-6;

const ONBOARDING_SMOOTHING = 0.14;
const NORMAL_SMOOTHING = 0.34;

export function createSimulationState(
  deps: SimulationStateDeps,
): SimulationState {
  const { graph, kinds, isOnboarding, nodes, edges, nodePositions } = deps;
  const n = graph.nodes.length;

  // Two parallel buffers per node:
  //   targetPositions  — last positions received from the worker (the
  //                      simulation's current truth)
  //   renderedPositions — the per-frame lerped values written into
  //                       nodePositions (= NodeLayer's instanceMatrix)
  // The lerp on the main thread provides visual smoothing between
  // worker tick boundaries (worker ticks at 60Hz; main thread renders
  // at display refresh, often higher).
  const targetPositions = new Float32Array(n * 3);
  const renderedPositions = new Float32Array(n * 3);

  // Velocity cache, written from worker snapshot responses; used only
  // for snapshot save. Out-of-date between snapshot requests, but the
  // snapshot save path is the only sync consumer and a slightly stale
  // velocity is fine (worker is the source of truth on the next save).
  const cachedVelocities = new Float32Array(n * 3);

  // Optimistic mirror of simNodes (id + last-known x/y/z/vx/vy/vz).
  // `getSimNodes()` returns this for the snapshot save path.
  const simNodesMirror: SimNodes = graph.nodes.map((node) => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    // anchorX/anchorY/anchorZ/radius are required by the type; the
    // worker is the authoritative owner of these and main-side never
    // reads them. Fill with the same expressions the worker will use
    // (see physics/Simulation.ts) so the mirror is structurally
    // identical even before the first message round-trip.
    anchorX: node.position.x,
    anchorY: node.position.y,
    anchorZ: 0,
    radius: 0.08,
  }));

  // Seed renderedPositions/targetPositions/nodePositions from the
  // graph's static anchor positions so the very first frames have
  // something to draw before the worker reports back.
  for (let i = 0; i < n; i++) {
    const node = graph.nodes[i]!;
    targetPositions[i * 3 + 0] = node.position.x;
    targetPositions[i * 3 + 1] = node.position.y;
    targetPositions[i * 3 + 2] = 0;
    renderedPositions[i * 3 + 0] = node.position.x;
    renderedPositions[i * 3 + 1] = node.position.y;
    renderedPositions[i * 3 + 2] = 0;
  }

  let settledFrames = 0;
  let workerReady = false;
  let pendingSnapshotRequest: {
    id: number;
    resolve: (nodes: SnapshotPayloadNode[]) => void;
  } | null = null;
  let snapshotRequestSeq = 0;

  const worker = new SimulationWorker();
  function send(msg: WorkerInMsg, transfer?: Transferable[]) {
    worker.postMessage(msg, transfer ?? []);
  }

  worker.addEventListener("message", (e: MessageEvent<WorkerOutMsg>) => {
    const msg = e.data;
    if (msg.type === "ready") {
      workerReady = true;
      return;
    }
    if (msg.type === "positions") {
      const incoming = new Float32Array(msg.buffer);
      // Length should match n*3; if it doesn't (graph swap mid-flight),
      // ignore the stale message.
      if (incoming.length === targetPositions.length) {
        targetPositions.set(incoming);
        // Mirror x/y/z onto simNodesMirror so getSimNodes is current.
        for (let i = 0; i < n; i++) {
          const sn = simNodesMirror[i]!;
          sn.x = incoming[i * 3 + 0]!;
          sn.y = incoming[i * 3 + 1]!;
          sn.z = incoming[i * 3 + 2]!;
        }
        // Restart the main-side gate when worker reports motion.
        if (!msg.settled) settledFrames = 0;
      }
      return;
    }
    if (msg.type === "snapshot") {
      // Update velocity cache + mirror, then resolve any pending
      // request. Snapshot save is sync via getSimNodes(), but the
      // explicit request path lets the IO layer pull a fresh copy
      // (e.g. just before navigating away).
      for (const sn of msg.nodes) {
        const idx = idxById.get(sn.id);
        if (idx === undefined) continue;
        cachedVelocities[idx * 3 + 0] = sn.vx;
        cachedVelocities[idx * 3 + 1] = sn.vy;
        cachedVelocities[idx * 3 + 2] = sn.vz;
        const mirror = simNodesMirror[idx]!;
        mirror.x = sn.x;
        mirror.y = sn.y;
        mirror.z = sn.z;
        mirror.vx = sn.vx;
        mirror.vy = sn.vy;
        mirror.vz = sn.vz;
      }
      if (
        pendingSnapshotRequest &&
        pendingSnapshotRequest.id === msg.requestId
      ) {
        pendingSnapshotRequest.resolve(msg.nodes);
        pendingSnapshotRequest = null;
      }
    }
  });

  const idxById = new Map<string, number>(
    graph.nodes.map((node, i) => [node.id, i]),
  );

  function seedNodesFromMap(
    seedPositions?: Map<string, PhysicsSnapshotNode>,
  ): SeedNode[] | undefined {
    if (!seedPositions || seedPositions.size === 0) return undefined;
    const seeds: SeedNode[] = [];
    for (const [id, p] of seedPositions) {
      seeds.push({
        id,
        x: p.x,
        y: p.y,
        z: p.z,
        vx: p.vx,
        vy: p.vy,
        vz: p.vz,
      });
    }
    return seeds;
  }

  // Init the worker with the graph + initial active set (null = full).
  send({
    type: "init",
    graph,
    kinds: Array.from(kinds),
    isOnboarding: isOnboarding(),
  });

  function tick() {
    if (settledFrames >= SETTLED_THRESHOLD) return;
    // Lerp renderedPositions toward targetPositions; write into
    // nodePositions (the buffer NodeLayer reads) and into the matrix.
    const smoothing = isOnboarding() ? ONBOARDING_SMOOTHING : NORMAL_SMOOTHING;
    let maxDeltaSq = 0;
    for (let i = 0; i < n; i++) {
      const px = renderedPositions[i * 3 + 0]!;
      const py = renderedPositions[i * 3 + 1]!;
      const pz = renderedPositions[i * 3 + 2]!;
      const tx = targetPositions[i * 3 + 0]!;
      const ty = targetPositions[i * 3 + 1]!;
      const tz = targetPositions[i * 3 + 2]!;
      const dx = (tx - px) * smoothing;
      const dy = (ty - py) * smoothing;
      const dz = (tz - pz) * smoothing;
      const x = px + dx;
      const y = py + dy;
      const z = pz + dz;
      const deltaSq = dx * dx + dy * dy + dz * dz;
      if (deltaSq > maxDeltaSq) maxDeltaSq = deltaSq;
      renderedPositions[i * 3 + 0] = x;
      renderedPositions[i * 3 + 1] = y;
      renderedPositions[i * 3 + 2] = z;
      nodes.setPosition(i, x, y, z);
    }
    nodes.flush();
    edges.updatePositions(nodePositions);
    if (maxDeltaSq < SETTLE_EPSILON_SQ) settledFrames++;
    else settledFrames = 0;
  }

  function wakePhysics() {
    settledFrames = 0;
    send({ type: "wake" });
  }

  function optimize() {
    settledFrames = 0;
    send({ type: "relayout" });
  }

  function replaceActive(opts: ReplaceActiveOpts) {
    const seedNodes = seedNodesFromMap(opts.seedPositions);
    send({
      type: "replaceActive",
      activeIds: opts.activeIds ? Array.from(opts.activeIds) : null,
      animateNew: opts.animateNew ?? false,
      preserveExisting: opts.preserveExisting ?? true,
      seedNodes,
      isOnboarding: isOnboarding(),
    });
    settledFrames = 0;
  }

  function syncRenderedPositionsFromSimulation() {
    // Snap the local rendered buffer to whatever target positions we
    // currently know about. Used after snapshot restore / setupGraph
    // to avoid an interpolated transition on first display.
    for (let i = 0; i < n; i++) {
      const tx = targetPositions[i * 3 + 0]!;
      const ty = targetPositions[i * 3 + 1]!;
      const tz = targetPositions[i * 3 + 2]!;
      renderedPositions[i * 3 + 0] = tx;
      renderedPositions[i * 3 + 1] = ty;
      renderedPositions[i * 3 + 2] = tz;
      nodes.setPosition(i, tx, ty, tz);
    }
    nodes.flush();
    edges.updatePositions(nodePositions);
    settledFrames = 0;
  }

  function primeOnce() {
    // No-op on the main side; the worker will produce position updates
    // on its own schedule. Kept for API parity with the previous
    // in-process implementation, where setupGraph used it to bake one
    // tick of layout before the first display.
    void workerReady;
  }

  function getNodePosition(idx: number) {
    if (idx < 0 || idx >= n) return null;
    return {
      x: targetPositions[idx * 3 + 0]!,
      y: targetPositions[idx * 3 + 1]!,
      z: targetPositions[idx * 3 + 2]!,
    };
  }

  function getSimNodes(): SimNodes {
    // Request a fresh snapshot in the background so the next save call
    // sees updated velocities. Returns the mirror synchronously — its
    // x/y/z are always current (updated on every positions message);
    // vx/vy/vz lag until the snapshot response arrives.
    snapshotRequestSeq++;
    const id = snapshotRequestSeq;
    pendingSnapshotRequest = {
      id,
      resolve: () => {
        /* mirror is updated in-place by the message handler */
      },
    };
    send({ type: "snapshotRequest", requestId: id });
    return simNodesMirror;
  }

  function dispose() {
    send({ type: "dispose" });
    worker.terminate();
  }

  return {
    tick,
    wakePhysics,
    optimize,
    replaceActive,
    syncRenderedPositionsFromSimulation,
    primeOnce,
    getNodePosition,
    getSimNodes,
    dispose,
  };
}
