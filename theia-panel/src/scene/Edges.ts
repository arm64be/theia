import * as THREE from "three";
import type { TheiaGraph } from "../data/types";

type GraphEdge = TheiaGraph["edges"][number];

const COLORS: Record<GraphEdge["kind"], number> = {
  "memory-share": 0xffb366,
  "cross-search": 0x66d9ef,
  "tool-overlap": 0xb089ff,
};

export interface EdgeLayer {
  group: THREE.Group;
  rebuild(graph: TheiaGraph, enabledKinds: Set<GraphEdge["kind"]>, nodeIndex: Map<string, number>): void;
  updatePositions(positions: Float32Array): void;
  dispose(): void;
}

export function createEdges(): EdgeLayer {
  const group = new THREE.Group();
  const materials = new Map<GraphEdge["kind"], THREE.LineBasicMaterial>();
  let lineSegmentsByKind = new Map<GraphEdge["kind"], { line: THREE.LineSegments; edgeIdx: number[] }>();

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
      const edgeIdx: number[] = [];
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
        edgeIdx.push(i);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      let mat = materials.get(kind);
      if (!mat) {
        mat = new THREE.LineBasicMaterial({
          color: COLORS[kind],
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        materials.set(kind, mat);
      }
      const line = new THREE.LineSegments(geometry, mat);
      group.add(line);
      lineSegmentsByKind.set(kind, { line, edgeIdx });
    }
  }

  function updatePositions(nodePositions: Float32Array) {
    // nodePositions is (n, 2). Recompute edge segment positions from current node positions.
    // For now this is called externally with the node-index map; simpler to rebuild().
    // Kept as a hook; used when physics updates nodes each tick.
  }

  function dispose() {
    for (const { line } of lineSegmentsByKind.values()) {
      line.geometry.dispose();
    }
    materials.forEach((m) => m.dispose());
  }

  return { group, rebuild, updatePositions, dispose };
}
