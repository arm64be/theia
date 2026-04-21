import * as THREE from "three";
import type { TheiaGraph } from "../data/types";
import { PALETTE } from "../aesthetic";

const NODE_GLOW_TEXTURE = makeGlowTexture();

function makeGlowTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.05, // small soft core instead of sharp point
    size / 2,
    size / 2,
    size / 2,
  );
  // Soft, semi-transparent center — no hard white square
  g.addColorStop(0, "rgba(255,255,255,0.45)");
  g.addColorStop(0.25, "rgba(255,255,255,0.35)");
  g.addColorStop(0.6, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Simple string hash to a number in [0, 1). */
function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/** Derive a slight tint from the model name, keeping the base amber feel. */
function modelTintColor(model: string | undefined): THREE.Color {
  const base = new THREE.Color(PALETTE.nodeBase);
  if (!model) return base;
  const hash = hashString(model);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  // Shift hue +/- 25 degrees for visible but tasteful model distinction
  hsl.h = (hsl.h + (hash - 0.5) * 0.14 + 1) % 1;
  // Vary saturation and lightness subtly
  hsl.s = Math.min(1, Math.max(0.3, hsl.s + (hash - 0.5) * 0.2));
  hsl.l = Math.min(0.85, Math.max(0.25, hsl.l + (hash - 0.5) * 0.15));
  const c = new THREE.Color();
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return c;
}

export interface NodeLayer {
  mesh: THREE.InstancedMesh;
  count: number;
  setPosition(i: number, x: number, y: number): void;
  setHighlight(i: number, on: boolean): void;
  setTime(t: number): void;
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
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  const dummy = new THREE.Object3D();
  const highlightColor = new THREE.Color(PALETTE.nodeHighlight);

  // Precompute per-node size, color, and wave offset for spatial twinkling
  const nodeSizes = new Float32Array(n);
  const nodeColors: THREE.Color[] = new Array(n);
  const nodeWaveOffsets = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const node = graph.nodes[i]!;
    const turns = node.message_count ?? node.tool_count;
    nodeSizes[i] = Math.min(0.18, 0.05 + Math.log1p(turns) * 0.014);
    nodeColors[i] = modelTintColor(node.model);
    // Spatial wave: coherent ripple across the constellation
    nodeWaveOffsets[i] = node.position.x * 2.0 + node.position.y * 1.5;
  }

  for (let i = 0; i < n; i++) {
    const node = graph.nodes[i]!;
    dummy.position.set(node.position.x, node.position.y, 0);
    const sz = nodeSizes[i]!;
    dummy.scale.set(sz, sz, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, nodeColors[i]!);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor!.needsUpdate = true;

  const highlighted = new Set<number>();

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
      if (on) highlighted.add(i);
      else highlighted.delete(i);
    },
    setTime(t: number) {
      const colorAttr = mesh.instanceColor!;
      for (let i = 0; i < n; i++) {
        if (highlighted.has(i)) {
          colorAttr.setXYZ(i, highlightColor.r, highlightColor.g, highlightColor.b);
          continue;
        }
        const tint = nodeColors[i]!;
        // Gentle wavy blink: slow traveling wave across the constellation
        const twinkle = 1.0 + 0.12 * Math.sin(t * 1.5 + nodeWaveOffsets[i]!);
        colorAttr.setXYZ(
          i,
          Math.min(1, tint.r * twinkle),
          Math.min(1, tint.g * twinkle),
          Math.min(1, tint.b * twinkle),
        );
      }
      colorAttr.needsUpdate = true;
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
