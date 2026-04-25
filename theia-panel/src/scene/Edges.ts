import * as THREE from "three";
import type { TheiaGraph } from "../data/types";
import { PALETTE, SIZES } from "../aesthetic";
import { hash01 } from "../util/hash";

type GraphEdge = TheiaGraph["edges"][number];

const VERT = `
attribute float aOpacity;
attribute float aPhase;
varying float vOpacity;
varying float vPhase;
void main() {
  vOpacity = aOpacity;
  vPhase = aPhase;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
varying float vOpacity;
varying float vPhase;
uniform vec3 color;
uniform float uTime;
void main() {
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0 + vPhase);
  float alpha = vOpacity * pulse;
  gl_FragColor = vec4(color, alpha);
}
`;

const PALETTE_MAP: Record<GraphEdge["kind"], number> = {
  "memory-share": PALETTE.edgeMemory,
  "cross-search": PALETTE.edgeSearch,
  "tool-overlap": PALETTE.edgeOverlap,
  subagent: PALETTE.edgeSubagent,
  "cron-chain": PALETTE.edgeCronChain,
};

export interface EdgeLayer {
  group: THREE.Group;
  rebuild(
    graph: TheiaGraph,
    enabledKinds: Set<GraphEdge["kind"]>,
    nodeIndex: Map<string, number>,
    nodePositions?: Float32Array,
  ): void;
  updatePositions(nodePositions: Float32Array): void;
  setHoverNode(nodeId: string | null): void;
  setTime(t: number): void;
  dispose(): void;
}

export function createEdges(): EdgeLayer {
  const group = new THREE.Group();
  const materials = new Map<GraphEdge["kind"], THREE.ShaderMaterial>();
  let lineSegmentsByKind = new Map<
    GraphEdge["kind"],
    { line: THREE.LineSegments; edgeList: GraphEdge[]; validIndices: number[] }
  >();
  let currentNodeIndex: Map<string, number> | null = null;

  function rebuild(
    graph: TheiaGraph,
    enabledKinds: Set<GraphEdge["kind"]>,
    nodeIndex: Map<string, number>,
    nodePositions?: Float32Array,
  ) {
    currentNodeIndex = nodeIndex;
    // Clear existing
    for (const { line } of lineSegmentsByKind.values()) {
      group.remove(line);
      line.geometry.dispose();
    }
    lineSegmentsByKind.clear();

    for (const kind of enabledKinds) {
      const edgesRaw = graph.edges.filter((e) => e.kind === kind);
      if (edgesRaw.length === 0) continue;
      // Deduplicate: only one edge per (source, target) pair, keep highest weight
      const seen = new Map<string, GraphEdge>();
      for (const e of edgesRaw) {
        const key =
          e.source < e.target
            ? `${e.source}|${e.target}`
            : `${e.target}|${e.source}`;
        const existing = seen.get(key);
        if (!existing || e.weight > existing.weight) {
          seen.set(key, e);
        }
      }
      const edges = Array.from(seen.values());
      const positions = new Float32Array(edges.length * 6);
      const opacities = new Float32Array(edges.length * 2);
      const phases = new Float32Array(edges.length * 2);
      const validIndices: number[] = [];
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        const si = nodeIndex.get(e.source);
        const ti = nodeIndex.get(e.target);
        if (si === undefined || ti === undefined) continue;
        const s = graph.nodes[si]!;
        const t = graph.nodes[ti]!;
        positions[i * 6 + 0] = s.position.x;
        positions[i * 6 + 1] = s.position.y;
        positions[i * 6 + 2] = nodePositions
          ? (nodePositions[si * 3 + 2] ?? 0)
          : 0;
        positions[i * 6 + 3] = t.position.x;
        positions[i * 6 + 4] = t.position.y;
        positions[i * 6 + 5] = nodePositions
          ? (nodePositions[ti * 3 + 2] ?? 0)
          : 0;
        const baseOpacity =
          (SIZES.edgeOpacityByKind as Record<string, number>)[kind] ??
          SIZES.edgeOpacity;
        opacities[i * 2 + 0] = baseOpacity;
        opacities[i * 2 + 1] = baseOpacity;
        const phase =
          hash01(e.source + "|" + e.target + "|" + e.kind) * Math.PI * 2;
        phases[i * 2 + 0] = phase;
        phases[i * 2 + 1] = phase;
        validIndices.push(i);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "aOpacity",
        new THREE.BufferAttribute(opacities, 1),
      );
      geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
      let mat = materials.get(kind);
      if (!mat) {
        const c = new THREE.Color(PALETTE_MAP[kind]);
        mat = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          uniforms: { color: { value: c }, uTime: { value: 0 } },
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        materials.set(kind, mat);
      }
      const line = new THREE.LineSegments(geometry, mat);
      group.add(line);
      lineSegmentsByKind.set(kind, { line, edgeList: edges, validIndices });
    }
  }

  function updatePositions(nodePositions: Float32Array) {
    if (!currentNodeIndex) return;
    for (const {
      line,
      edgeList,
      validIndices,
    } of lineSegmentsByKind.values()) {
      const posAttr = line.geometry.getAttribute("position") as
        | THREE.BufferAttribute
        | undefined;
      if (!posAttr) continue;
      for (const i of validIndices) {
        const e = edgeList[i]!;
        const si = currentNodeIndex.get(e.source);
        const ti = currentNodeIndex.get(e.target);
        if (si === undefined || ti === undefined) continue;
        const sx = nodePositions[si * 3 + 0]!;
        const sy = nodePositions[si * 3 + 1]!;
        const sz = nodePositions[si * 3 + 2]!;
        const tx = nodePositions[ti * 3 + 0]!;
        const ty = nodePositions[ti * 3 + 1]!;
        const tz = nodePositions[ti * 3 + 2]!;
        posAttr.setXYZ(i * 2 + 0, sx, sy, sz);
        posAttr.setXYZ(i * 2 + 1, tx, ty, tz);
      }
      posAttr.needsUpdate = true;
    }
  }

  function setHoverNode(nodeId: string | null) {
    for (const [
      kind,
      { line, edgeList, validIndices },
    ] of lineSegmentsByKind.entries()) {
      const geo = line.geometry;
      const attr = geo.getAttribute("aOpacity") as
        | THREE.BufferAttribute
        | undefined;
      if (!attr) continue;
      const baseOpacity =
        (SIZES.edgeOpacityByKind as Record<string, number>)[kind] ??
        SIZES.edgeOpacity;
      for (const i of validIndices) {
        const e = edgeList[i]!;
        const dim =
          nodeId !== null && e.source !== nodeId && e.target !== nodeId;
        const opacity = dim ? 0.08 : baseOpacity;
        attr.setX(i * 2 + 0, opacity);
        attr.setX(i * 2 + 1, opacity);
      }
      attr.needsUpdate = true;
    }
  }

  function setTime(t: number) {
    for (const mat of materials.values()) {
      (mat.uniforms.uTime as { value: number }).value = t;
    }
  }

  function dispose() {
    for (const { line } of lineSegmentsByKind.values()) {
      line.geometry.dispose();
    }
    materials.forEach((m) => m.dispose());
  }

  return { group, rebuild, updatePositions, setHoverNode, setTime, dispose };
}
