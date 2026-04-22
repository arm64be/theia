import * as THREE from "three";
import type { NodeLayer } from "./Nodes";

export function createPicker(
  container: HTMLElement,
  camera: THREE.Camera,
  nodes: NodeLayer,
) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered: number | null = null;
  const listeners: Array<(i: number | null) => void> = [];

  function onMove(evt: MouseEvent) {
    const rect = container.getBoundingClientRect();
    ndc.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(nodes.mesh, false);
    const idx = hits.length > 0 ? (hits[0]!.instanceId ?? null) : null;
    if (idx !== hovered) {
      hovered = idx;
      listeners.forEach((fn) => fn(idx));
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
