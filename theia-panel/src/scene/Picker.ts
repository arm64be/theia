import * as THREE from "three";
import type { NodeLayer } from "./Nodes";
import type { TheiaGraph } from "../data/types";

type GraphEdge = TheiaGraph["edges"][number];

export interface PickerOptions {
  maxDistance?: number; // world units — nodes farther than this are ignored
  sizeScale?: number; // multiplier for projected node radius
  shouldBlock?: () => boolean;
  isVisible?: (i: number) => boolean;
  // Edge picking — pickable when no node is under the cursor
  getEdges?: () => Array<{
    edge: GraphEdge;
    sourceIdx: number;
    targetIdx: number;
  }>;
  edgeNdcThreshold?: number; // NDC distance within which an edge counts as hit
}

export function createPicker(
  container: HTMLElement,
  camera: THREE.Camera,
  nodes: NodeLayer,
  nodePositions: Float32Array,
  options: PickerOptions = {},
) {
  const ndc = new THREE.Vector2();
  const pos = new THREE.Vector3();
  const cameraPos = new THREE.Vector3();
  const sProj = new THREE.Vector3();
  const tProj = new THREE.Vector3();
  let hovered: number | null = null;
  let hoveredEdge: GraphEdge | null = null;
  const listeners: Array<(i: number | null) => void> = [];
  const edgeListeners: Array<(edge: GraphEdge | null) => void> = [];
  const {
    maxDistance = 30,
    sizeScale = 1.1,
    shouldBlock,
    isVisible,
    getEdges,
    edgeNdcThreshold = 0.012,
  } = options;

  function pickNDC(
    ndcX: number,
    ndcY: number,
    radiusScale: number,
  ): number | null {
    let bestIdx: number | null = null;
    let bestScore = Infinity;

    camera.getWorldPosition(cameraPos);

    for (let i = 0; i < nodes.count; i++) {
      if (isVisible && !isVisible(i)) continue;
      const x = nodePositions[i * 3 + 0];
      const y = nodePositions[i * 3 + 1];
      const z = nodePositions[i * 3 + 2];
      if (x === undefined || y === undefined || z === undefined) continue;
      pos.set(x, y, z);

      const worldDist = cameraPos.distanceTo(pos);
      if (worldDist > maxDistance) continue;

      pos.project(camera);

      const dx = pos.x - ndcX;
      const dy = pos.y - ndcY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const projectedRadius =
        (0.025 * sizeScale * radiusScale) / (worldDist * 0.2 + 0.1);

      if (dist < projectedRadius) {
        const score = dist / Math.max(projectedRadius, 0.001);
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
    }
    return bestIdx;
  }

  function pickEdgeNDC(ndcX: number, ndcY: number): GraphEdge | null {
    if (!getEdges) return null;
    const edges = getEdges();
    if (edges.length === 0) return null;
    let bestEdge: GraphEdge | null = null;
    let bestDist = edgeNdcThreshold;
    for (const { edge, sourceIdx, targetIdx } of edges) {
      const sx = nodePositions[sourceIdx * 3 + 0];
      const sy = nodePositions[sourceIdx * 3 + 1];
      const sz = nodePositions[sourceIdx * 3 + 2];
      const tx = nodePositions[targetIdx * 3 + 0];
      const ty = nodePositions[targetIdx * 3 + 1];
      const tz = nodePositions[targetIdx * 3 + 2];
      if (
        sx === undefined ||
        sy === undefined ||
        sz === undefined ||
        tx === undefined ||
        ty === undefined ||
        tz === undefined
      ) {
        continue;
      }
      sProj.set(sx, sy, sz).project(camera);
      tProj.set(tx, ty, tz).project(camera);
      // Only consider edges in front of the camera plane
      if (sProj.z > 1 || tProj.z > 1 || sProj.z < -1 || tProj.z < -1) continue;
      const dx = tProj.x - sProj.x;
      const dy = tProj.y - sProj.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-10) continue;
      const px = ndcX - sProj.x;
      const py = ndcY - sProj.y;
      const tParam = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const cx = sProj.x + tParam * dx;
      const cy = sProj.y + tParam * dy;
      const ddx = ndcX - cx;
      const ddy = ndcY - cy;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dist < bestDist) {
        bestDist = dist;
        bestEdge = edge;
      }
    }
    return bestEdge;
  }

  function onMove(evt: MouseEvent) {
    if (shouldBlock?.()) return;
    if ((evt.target as HTMLElement).closest("[data-ui-overlay]")) return;

    const rect = container.getBoundingClientRect();
    ndc.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;

    const bestIdx = pickNDC(ndc.x, ndc.y, 1.0);

    // Sticky hover for nodes: only transition node-hover → null, never A→B
    if (hovered !== null && bestIdx !== null && bestIdx !== hovered) {
      return;
    }

    if (bestIdx !== hovered) {
      hovered = bestIdx;
      listeners.forEach((fn) => fn(bestIdx));
    }

    // Edge hover only fires when no node is under the cursor — nodes win.
    const nextEdge = bestIdx === null ? pickEdgeNDC(ndc.x, ndc.y) : null;
    if (nextEdge !== hoveredEdge) {
      hoveredEdge = nextEdge;
      edgeListeners.forEach((fn) => fn(nextEdge));
    }
  }

  container.addEventListener("mousemove", onMove);

  return {
    onHover(fn: (i: number | null) => void) {
      listeners.push(fn);
    },
    onHoverEdge(fn: (edge: GraphEdge | null) => void) {
      edgeListeners.push(fn);
    },
    currentHovered() {
      return hovered;
    },
    currentHoveredEdge() {
      return hoveredEdge;
    },
    /**
     * Perform a one-off pick at screen coordinates.
     * @param clientX — mouse X in viewport pixels
     * @param clientY — mouse Y in viewport pixels
     * @param radiusScale — multiplier on the base projected radius (e.g. 0.35 for a tighter click target)
     */
    pickAt(clientX: number, clientY: number, radiusScale = 1.0): number | null {
      const rect = container.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      return pickNDC(ndcX, ndcY, radiusScale);
    },
    dispose() {
      container.removeEventListener("mousemove", onMove);
    },
  };
}
