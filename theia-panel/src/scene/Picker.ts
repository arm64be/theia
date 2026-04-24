import * as THREE from "three";
import type { NodeLayer } from "./Nodes";

export function createPicker(
  container: HTMLElement,
  camera: THREE.Camera,
  nodes: NodeLayer,
  nodePositions: Float32Array,
) {
  const ndc = new THREE.Vector2();
  const pos = new THREE.Vector3();
  let hovered: number | null = null;
  const listeners: Array<(i: number | null) => void> = [];

  function onMove(evt: MouseEvent) {
    const rect = container.getBoundingClientRect();
    ndc.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;

    let bestIdx: number | null = null;
    let bestDist = Infinity;
    const threshold = 0.04; // NDC units (~2% of viewport half-axis)
    const thresholdSq = threshold * threshold;

    for (let i = 0; i < nodes.count; i++) {
      const x = nodePositions[i * 3 + 0];
      const y = nodePositions[i * 3 + 1];
      const z = nodePositions[i * 3 + 2];
      if (x === undefined || y === undefined || z === undefined) continue;
      pos.set(x, y, z);
      pos.project(camera);

      const dx = pos.x - ndc.x;
      const dy = pos.y - ndc.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDist && distSq < thresholdSq) {
        bestDist = distSq;
        bestIdx = i;
      }
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
    dispose() {
      container.removeEventListener("mousemove", onMove);
    },
  };
}
