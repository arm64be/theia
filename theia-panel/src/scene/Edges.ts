import * as THREE from "three";
import type { TheiaGraph } from "../data/types";
import { PALETTE, SIZES } from "../aesthetic";

type GraphEdge = TheiaGraph["edges"][number];

const VERT = `
attribute vec2 aStart;
attribute vec2 aEnd;
attribute float aOpacity;
attribute float aPhase;
varying float vOpacity;
varying float vPhase;
varying vec2 vUV;
uniform float uLineWidth;
void main() {
  vOpacity = aOpacity;
  vPhase = aPhase;
  vUV = uv;

  vec2 dir = aEnd - aStart;
  float len = length(dir);
  vec2 tangent = normalize(dir);
  vec2 normal = vec2(-tangent.y, tangent.x);

  // position is a unit quad: x in [0,1], y in [0,1]
  vec2 local = position.xy;
  local.y = (local.y - 0.5) * uLineWidth;
  local.x = local.x * len;

  vec2 world = aStart + tangent * local.x + normal * local.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, -0.01, 1.0);
}
`;

const FRAG = `
varying float vOpacity;
varying float vPhase;
varying vec2 vUV;
uniform vec3 color;
uniform float uTime;
void main() {
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0 + vPhase);
  float alpha = vOpacity * pulse;
  // Soft antialiased edge fade
  float dist = abs(vUV.y - 0.5);
  float edgeFade = 1.0 - smoothstep(0.30, 0.50, dist);
  alpha *= edgeFade;
  gl_FragColor = vec4(color, alpha);
}
`;

const PALETTE_MAP: Record<GraphEdge["kind"], number> = {
  "memory-share": PALETTE.edgeMemory,
  "cross-search": PALETTE.edgeSearch,
  "tool-overlap": PALETTE.edgeOverlap,
};

export interface EdgeLayer {
  group: THREE.Group;
  rebuild(
    graph: TheiaGraph,
    enabledKinds: Set<GraphEdge["kind"]>,
    nodeIndex: Map<string, number>,
  ): void;
  updatePositions(nodePositions: Float32Array): void;
  setHoverNode(nodeId: string | null): void;
  setTime(t: number): void;
  dispose(): void;
}

export function createEdges(): EdgeLayer {
  const group = new THREE.Group();
  const materials = new Map<GraphEdge["kind"], THREE.ShaderMaterial>();
  let meshesByKind = new Map<
    GraphEdge["kind"],
    {
      mesh: THREE.InstancedMesh;
      edgeList: GraphEdge[];
      validIndices: number[];
      startAttr: THREE.InstancedBufferAttribute;
      endAttr: THREE.InstancedBufferAttribute;
      opacityAttr: THREE.InstancedBufferAttribute;
    }
  >();
  let currentNodeIndex: Map<string, number> | null = null;

  // Base geometry: a unit quad
  const baseGeometry = new THREE.PlaneGeometry(1, 1);

  function rebuild(
    graph: TheiaGraph,
    enabledKinds: Set<GraphEdge["kind"]>,
    nodeIndex: Map<string, number>,
  ) {
    currentNodeIndex = nodeIndex;
    // Clear existing
    for (const { mesh } of meshesByKind.values()) {
      group.remove(mesh);
      mesh.geometry.dispose();
    }
    meshesByKind.clear();

    for (const kind of enabledKinds) {
      const edges = graph.edges.filter((e) => e.kind === kind);
      if (edges.length === 0) continue;

      const validIndices: number[] = [];
      const starts: number[] = [];
      const ends: number[] = [];
      const opacities: number[] = [];
      const phases: number[] = [];

      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        const si = nodeIndex.get(e.source);
        const ti = nodeIndex.get(e.target);
        if (si === undefined || ti === undefined) continue;
        const s = graph.nodes[si]!;
        const t = graph.nodes[ti]!;
        starts.push(s.position.x, s.position.y);
        ends.push(t.position.x, t.position.y);
        const baseOpacity = (SIZES.edgeOpacityByKind as Record<string, number>)[kind] ?? SIZES.edgeOpacity;
        opacities.push(baseOpacity);
        phases.push(((i * 137.5) % 1000) / 1000 * Math.PI * 2);
        validIndices.push(i);
      }

      if (validIndices.length === 0) continue;

      const geometry = new THREE.InstancedBufferGeometry();
      geometry.index = baseGeometry.index!;
      geometry.attributes.position = baseGeometry.attributes.position as THREE.BufferAttribute;
      geometry.attributes.uv = baseGeometry.attributes.uv as THREE.BufferAttribute;

      const startAttr = new THREE.InstancedBufferAttribute(new Float32Array(starts), 2);
      const endAttr = new THREE.InstancedBufferAttribute(new Float32Array(ends), 2);
      const opacityAttr = new THREE.InstancedBufferAttribute(new Float32Array(opacities), 1);
      const phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(phases), 1);

      geometry.setAttribute("aStart", startAttr);
      geometry.setAttribute("aEnd", endAttr);
      geometry.setAttribute("aOpacity", opacityAttr);
      geometry.setAttribute("aPhase", phaseAttr);

      let mat = materials.get(kind);
      if (!mat) {
        const c = new THREE.Color(PALETTE_MAP[kind]);
        mat = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          uniforms: {
            color: { value: c },
            uTime: { value: 0 },
            uLineWidth: { value: 0.018 },
          },
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        materials.set(kind, mat);
      }

      const mesh = new THREE.InstancedMesh(geometry, mat, validIndices.length);
      group.add(mesh);
      meshesByKind.set(kind, { mesh, edgeList: edges, validIndices, startAttr, endAttr, opacityAttr });
    }
  }

  function updatePositions(nodePositions: Float32Array) {
    if (!currentNodeIndex) return;
    for (const { mesh, edgeList, validIndices, startAttr, endAttr } of meshesByKind.values()) {
      for (let j = 0; j < validIndices.length; j++) {
        const i = validIndices[j]!;
        const e = edgeList[i]!;
        const si = currentNodeIndex.get(e.source);
        const ti = currentNodeIndex.get(e.target);
        if (si === undefined || ti === undefined) continue;
        const sx = nodePositions[si * 2 + 0]!;
        const sy = nodePositions[si * 2 + 1]!;
        const tx = nodePositions[ti * 2 + 0]!;
        const ty = nodePositions[ti * 2 + 1]!;
        startAttr.setXY(j, sx, sy);
        endAttr.setXY(j, tx, ty);
      }
      startAttr.needsUpdate = true;
      endAttr.needsUpdate = true;
    }
  }

  function setHoverNode(nodeId: string | null) {
    for (const [kind, { mesh, edgeList, validIndices, opacityAttr }] of meshesByKind.entries()) {
      const baseOpacity = (SIZES.edgeOpacityByKind as Record<string, number>)[kind] ?? SIZES.edgeOpacity;
      for (let j = 0; j < validIndices.length; j++) {
        const i = validIndices[j]!;
        const e = edgeList[i]!;
        const dim = nodeId !== null && e.source !== nodeId && e.target !== nodeId;
        const opacity = dim ? 0.08 : baseOpacity;
        opacityAttr.setX(j, opacity);
      }
      opacityAttr.needsUpdate = true;
    }
  }

  function setTime(t: number) {
    for (const mat of materials.values()) {
      (mat.uniforms.uTime as { value: number }).value = t;
    }
  }

  function dispose() {
    for (const { mesh } of meshesByKind.values()) {
      mesh.geometry.dispose();
    }
    materials.forEach((m) => m.dispose());
    baseGeometry.dispose();
  }

  return { group, rebuild, updatePositions, setHoverNode, setTime, dispose };
}
