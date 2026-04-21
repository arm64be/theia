import * as THREE from "three";
import type { TheiaGraph } from "../data/types";
import { PALETTE, SIZES } from "../aesthetic";

type GraphEdge = TheiaGraph["edges"][number];

const VERT = `
attribute float aOpacity;
varying float vOpacity;
void main() {
  vOpacity = aOpacity;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
varying float vOpacity;
uniform vec3 color;
void main() {
  gl_FragColor = vec4(color, vOpacity);
}
`;

const PALETTE_MAP: Record<GraphEdge["kind"], number> = {
  "memory-share": PALETTE.edgeMemory,
  "cross-search": PALETTE.edgeSearch,
  "tool-overlap": PALETTE.edgeOverlap,
};

export interface EdgeLayer {
  group: THREE.Group;
  rebuild(graph: TheiaGraph, enabledKinds: Set<GraphEdge["kind"]>, nodeIndex: Map<string, number>): void;
  setHoverNode(nodeId: string | null): void;
  dispose(): void;
}

export function createEdges(): EdgeLayer {
  const group = new THREE.Group();
  const materials = new Map<GraphEdge["kind"], THREE.ShaderMaterial>();
  let lineSegmentsByKind = new Map<GraphEdge["kind"], { line: THREE.LineSegments; edgeList: GraphEdge[] }>();

  function rebuild(graph: TheiaGraph, enabledKinds: Set<GraphEdge["kind"]>, nodeIndex: Map<string, number>) {
    // Clear existing
    for (const { line } of lineSegmentsByKind.values()) {
      group.remove(line);
      line.geometry.dispose();
    }
    lineSegmentsByKind.clear();

    for (const kind of enabledKinds) {
      const edges = graph.edges.filter((e) => e.kind === kind);
      if (edges.length === 0) continue;
      const positions = new Float32Array(edges.length * 6);
      const opacities = new Float32Array(edges.length * 2);
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        const si = nodeIndex.get(e.source);
        const ti = nodeIndex.get(e.target);
        if (si === undefined || ti === undefined) continue;
        const s = graph.nodes[si]!;
        const t = graph.nodes[ti]!;
        positions[i * 6 + 0] = s.position.x;
        positions[i * 6 + 1] = s.position.y;
        positions[i * 6 + 2] = 0;
        positions[i * 6 + 3] = t.position.x;
        positions[i * 6 + 4] = t.position.y;
        positions[i * 6 + 5] = 0;
        opacities[i * 2 + 0] = SIZES.edgeOpacity;
        opacities[i * 2 + 1] = SIZES.edgeOpacity;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("aOpacity", new THREE.BufferAttribute(opacities, 1));
      let mat = materials.get(kind);
      if (!mat) {
        const c = new THREE.Color(PALETTE_MAP[kind]);
        mat = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          uniforms: { color: { value: c } },
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        materials.set(kind, mat);
      }
      const line = new THREE.LineSegments(geometry, mat);
      group.add(line);
      lineSegmentsByKind.set(kind, { line, edgeList: edges });
    }
  }

  function setHoverNode(nodeId: string | null) {
    for (const { line, edgeList } of lineSegmentsByKind.values()) {
      const geo = line.geometry;
      const attr = geo.getAttribute("aOpacity") as THREE.BufferAttribute | undefined;
      if (!attr) continue;
      for (let i = 0; i < edgeList.length; i++) {
        const e = edgeList[i]!;
        const dim = nodeId !== null && e.source !== nodeId && e.target !== nodeId;
        const opacity = dim ? 0.08 : SIZES.edgeOpacity;
        attr.setX(i * 2 + 0, opacity);
        attr.setX(i * 2 + 1, opacity);
      }
      attr.needsUpdate = true;
    }
  }

  function dispose() {
    for (const { line } of lineSegmentsByKind.values()) {
      line.geometry.dispose();
    }
    materials.forEach((m) => m.dispose());
  }

  return { group, rebuild, setHoverNode, dispose };
}
