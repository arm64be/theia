import type { CameraState } from "../scene/Scene";
import type { createSimulation } from "../physics/Simulation";

const PHYSICS_SNAPSHOT_KEY_PREFIX = "theia-physics-snapshot:";
const PHYSICS_SNAPSHOT_INTERVAL_MS = 5000;

export type PhysicsSnapshotNode = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
};

export type PhysicsSnapshot = {
  nodes: Map<string, PhysicsSnapshotNode>;
  camera: CameraState | null;
};

type SimNodes = ReturnType<typeof createSimulation>["nodes"];

function physicsSnapshotKey(graphUrl: string): string {
  return `${PHYSICS_SNAPSHOT_KEY_PREFIX}${graphUrl}`;
}

function loadPhysicsSnapshot(graphUrl: string): PhysicsSnapshot {
  try {
    const raw = localStorage.getItem(physicsSnapshotKey(graphUrl));
    if (!raw) return { nodes: new Map(), camera: null };
    const parsed = JSON.parse(raw);
    const nodesById = parsed?.nodes;
    if (!nodesById || typeof nodesById !== "object") {
      return { nodes: new Map(), camera: null };
    }
    const snapshot = new Map<string, PhysicsSnapshotNode>();
    for (const [id, value] of Object.entries(nodesById)) {
      if (!value || typeof value !== "object") continue;
      const node = value as Record<string, unknown>;
      const x = Number(node.x);
      const y = Number(node.y);
      const z = Number(node.z);
      const vx = Number(node.vx ?? 0);
      const vy = Number(node.vy ?? 0);
      const vz = Number(node.vz ?? 0);
      if ([x, y, z, vx, vy, vz].every(Number.isFinite)) {
        snapshot.set(id, { x, y, z, vx, vy, vz });
      }
    }
    const cameraRaw = parsed?.camera;
    const targetRaw = cameraRaw?.target;
    const camera =
      cameraRaw &&
      targetRaw &&
      [
        targetRaw.x,
        targetRaw.y,
        targetRaw.z,
        cameraRaw.theta,
        cameraRaw.phi,
        cameraRaw.zoom,
      ]
        .map(Number)
        .every(Number.isFinite)
        ? {
            target: {
              x: Number(targetRaw.x),
              y: Number(targetRaw.y),
              z: Number(targetRaw.z),
            },
            theta: Number(cameraRaw.theta),
            phi: Number(cameraRaw.phi),
            zoom: Number(cameraRaw.zoom),
          }
        : null;
    return { nodes: snapshot, camera };
  } catch {
    return { nodes: new Map(), camera: null };
  }
}

function savePhysicsSnapshot(
  graphUrl: string,
  simNodes: SimNodes,
  cameraState: CameraState,
): void {
  const nodesById: Record<string, PhysicsSnapshotNode> = {};
  for (const sn of simNodes) {
    if (!sn) continue;
    nodesById[sn.id] = {
      x: sn.x,
      y: sn.y,
      z: sn.z,
      vx: sn.vx ?? 0,
      vy: sn.vy ?? 0,
      vz: sn.vz ?? 0,
    };
  }
  try {
    localStorage.setItem(
      physicsSnapshotKey(graphUrl),
      JSON.stringify({
        version: 1,
        saved_at: Date.now(),
        nodes: nodesById,
        camera: cameraState,
      }),
    );
  } catch {
    /* quota exceeded, ignore */
  }
}

export interface PhysicsSnapshotIO {
  load(graphUrl: string): PhysicsSnapshot;
  save(graphUrl: string, simNodes: SimNodes, cameraState: CameraState): void;
  maybeSave(
    now: number,
    graphUrl: string,
    simNodes: SimNodes,
    getCameraState: () => CameraState,
    canSave: boolean,
  ): void;
}

export function createPhysicsSnapshotIO(
  intervalMs: number = PHYSICS_SNAPSHOT_INTERVAL_MS,
): PhysicsSnapshotIO {
  let lastSavedAt = 0;
  return {
    load(graphUrl) {
      return loadPhysicsSnapshot(graphUrl);
    },
    save(graphUrl, simNodes, cameraState) {
      savePhysicsSnapshot(graphUrl, simNodes, cameraState);
    },
    maybeSave(now, graphUrl, simNodes, getCameraState, canSave) {
      if (!canSave) return;
      if (now - lastSavedAt < intervalMs) return;
      lastSavedAt = now;
      savePhysicsSnapshot(graphUrl, simNodes, getCameraState());
    },
  };
}
