import * as THREE from "three";
import type { TheiaGraph } from "../data/types";
import { PALETTE } from "../aesthetic";

const NODE_GLOW_TEXTURE = makeGlowTexture();

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export interface NodeLayer {
  mesh: THREE.InstancedMesh;
  count: number;
  setPosition(i: number, x: number, y: number): void;
  setHighlight(i: number, on: boolean): void;
  flush(): void;
  dispose(): void;
}

export function createNodes(graph: TheiaGraph): NodeLayer {
  const n = graph.nodes.length;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    map: NODE_GLOW_TEXTURE,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  const dummy = new THREE.Object3D();
  const baseColor = new THREE.Color(PALETTE.nodeBase);

  for (let i = 0; i < n; i++) {
    const node = graph.nodes[i]!;
    const size = 0.04 + Math.log1p(node.tool_count) * 0.01;
    dummy.position.set(node.position.x, node.position.y, 0);
    dummy.scale.set(size, size, size);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, baseColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor!.needsUpdate = true;

  return {
    mesh,
    count: n,
    setPosition(i, x, y) {
      mesh.getMatrixAt(i, dummy.matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      dummy.position.set(x, y, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    },
    setHighlight(i, on) {
      const c = on ? new THREE.Color(PALETTE.nodeHighlight) : baseColor;
      mesh.setColorAt(i, c);
    },
    flush() {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
