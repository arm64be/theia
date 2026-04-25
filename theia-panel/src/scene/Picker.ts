import * as THREE from "three";
import type { NodeLayer } from "./Nodes";

export interface PickerOptions {
  maxDistance?: number; // world units — nodes farther than this are ignored
  sizeScale?: number; // multiplier for projected node radius
  shouldBlock?: () => boolean;
  isVisible?: (i: number) => boolean;
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
  let hovered: number | null = null;
  const listeners: Array<(i: number | null) => void> = [];
  const { maxDistance = 30, sizeScale = 1.1, shouldBlock, isVisible } = options;

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

  function onMove(evt: MouseEvent) {
    if (shouldBlock?.()) return;
    if ((evt.target as HTMLElement).closest("[data-ui-overlay]")) return;

    const rect = container.getBoundingClientRect();
    ndc.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;

    const bestIdx = pickNDC(ndc.x, ndc.y, 1.0);

    // Sticky hover: only transition from hovered→null, never hoveredA→hoveredB
    if (hovered !== null && bestIdx !== null && bestIdx !== hovered) {
      return;
    }

    if (bestIdx !== hovered) {
      hovered = bestIdx;
      listeners.forEach((fn) => fn(bestIdx));
    }
  }

  container.addEventListener("mousemove", onMove);

  return {
    onHover(fn: (i: number | null) => void) {
      listeners.push(fn);
    },
    currentHovered() {
      return hovered;
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
