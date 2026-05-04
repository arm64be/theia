import * as THREE from "three";
import type { TheiaGraph } from "../data/types";
import { PALETTE, SIZES } from "../aesthetic";
import { hash01 } from "../util/hash";

type GraphEdge = TheiaGraph["edges"][number];

const VERT = `
attribute float aOpacity;
attribute float aPhase;
attribute float aReveal;
attribute float aTint;
varying float vOpacity;
varying float vPhase;
varying float vReveal;
varying float vTint;
void main() {
  vOpacity = aOpacity;
  vPhase = aPhase;
  vReveal = aReveal;
  vTint = aTint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
varying float vOpacity;
varying float vPhase;
varying float vReveal;
varying float vTint;
uniform vec3 color;
uniform float uTime;
void main() {
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0 + vPhase);
  float alpha = vOpacity * vReveal * pulse;
  gl_FragColor = vec4(color * vTint, alpha);
}
`;

// Per-edge brightness modulation based on node metadata.
// - subagent: brighter at the root (low parent depth), darker for deeper edges
// - cron-chain: brighter for newer edges (later in sequence), darker for older
const SUBAGENT_DEPTH_FALLOFF = 0.18;
const SUBAGENT_TINT_FLOOR = 0.35;
const CRON_TINT_FLOOR = 0.35;

function computeEdgeTints(graph: TheiaGraph): (edge: GraphEdge) => number {
  // Cron-chain rank-by-time within each sequence.
  // Older runs sit at the low end (rank 0); newer runs are higher.
  const cronRank = new Map<string, number>();
  const cronMaxRank = new Map<number, number>();
  const cronGroups = new Map<number, Array<TheiaGraph["nodes"][number]>>();
  for (const node of graph.nodes) {
    const seq = node.metadata?.cron_sequence_id;
    if (seq === null || seq === undefined) continue;
    let group = cronGroups.get(seq);
    if (!group) {
      group = [];
      cronGroups.set(seq, group);
    }
    group.push(node);
  }
  for (const [seq, group] of cronGroups) {
    group.sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
    for (let i = 0; i < group.length; i++) {
      cronRank.set(group[i]!.id, i);
    }
    cronMaxRank.set(seq, Math.max(1, group.length - 1));
  }

  // Precompute lookups: hierarchy_depth and cron_sequence_id by node id.
  const depthById = new Map<string, number>();
  const seqById = new Map<string, number>();
  for (const node of graph.nodes) {
    const d = node.metadata?.hierarchy_depth;
    if (typeof d === "number") depthById.set(node.id, d);
    const s = node.metadata?.cron_sequence_id;
    if (typeof s === "number") seqById.set(node.id, s);
  }

  return (edge: GraphEdge) => {
    if (edge.kind === "subagent") {
      // Use the parent's depth (= shallower endpoint) so the root's outgoing
      // edges are the brightest, and edges deeper in the tree dim out.
      const ds = depthById.get(edge.source);
      const dt = depthById.get(edge.target);
      if (ds === undefined && dt === undefined) return 1.0;
      const parentDepth = Math.min(ds ?? Infinity, dt ?? Infinity);
      return Math.max(
        SUBAGENT_TINT_FLOOR,
        1.0 - parentDepth * SUBAGENT_DEPTH_FALLOFF,
      );
    }
    if (edge.kind === "cron-chain") {
      // The "newer" endpoint of a cron-chain edge drives the tint: edges
      // between recent runs glow, edges between old runs fade.
      const seq = seqById.get(edge.target) ?? seqById.get(edge.source);
      if (seq === undefined) return 1.0;
      const rs = cronRank.get(edge.source) ?? 0;
      const rt = cronRank.get(edge.target) ?? 0;
      const newerRank = Math.max(rs, rt);
      const maxRank = cronMaxRank.get(seq) ?? 1;
      const t = newerRank / maxRank;
      return CRON_TINT_FLOOR + (1.0 - CRON_TINT_FLOOR) * t;
    }
    return 1.0;
  };
}

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
  setHoverEdge(edge: GraphEdge | null): void;
  setConnectionProgress(
    getProgress: ((edge: GraphEdge) => number) | null,
  ): void;
  setTime(t: number): void;
  pickAt(
    camera: THREE.Camera,
    container: HTMLElement,
    clientX: number,
    clientY: number,
    tolerancePx?: number,
  ): GraphEdge | null;
  visibleEdges(): Array<{
    edge: GraphEdge;
    sourceIdx: number;
    targetIdx: number;
  }>;
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
  let getConnectionProgress: ((edge: GraphEdge) => number) | null = null;
  let hoverNodeId: string | null = null;
  let hoverEdge: GraphEdge | null = null;
  const HOVER_EDGE_OPACITY = 1.0;

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

    const tintFor = computeEdgeTints(graph);

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
      const reveals = new Float32Array(edges.length * 2);
      const tints = new Float32Array(edges.length * 2);
      const validIndices: number[] = [];
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        const si = nodeIndex.get(e.source);
        const ti = nodeIndex.get(e.target);
        if (si === undefined || ti === undefined) continue;
        const s = graph.nodes[si]!;
        const t = graph.nodes[ti]!;
        // Read live positions from `nodePositions` for x/y too — not just z.
        // `node.position` is the raw dataset anchor; the simulation places
        // nodes at `position * spread` (Simulation.ts) plus whatever physics
        // shifts them, so anchors don't match the rendered layout. The
        // original code only got away with reading anchors here because
        // tick() ran every frame and `updatePositions` immediately
        // overwrote these values; the idle-tick gate exposed the latent
        // mismatch as edges snapping to ~origin after a rebuild.
        positions[i * 6 + 0] = nodePositions
          ? (nodePositions[si * 3 + 0] ?? s.position.x)
          : s.position.x;
        positions[i * 6 + 1] = nodePositions
          ? (nodePositions[si * 3 + 1] ?? s.position.y)
          : s.position.y;
        positions[i * 6 + 2] = nodePositions
          ? (nodePositions[si * 3 + 2] ?? 0)
          : 0;
        positions[i * 6 + 3] = nodePositions
          ? (nodePositions[ti * 3 + 0] ?? t.position.x)
          : t.position.x;
        positions[i * 6 + 4] = nodePositions
          ? (nodePositions[ti * 3 + 1] ?? t.position.y)
          : t.position.y;
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
        const reveal = getConnectionProgress?.(e) ?? 1;
        reveals[i * 2 + 0] = reveal;
        reveals[i * 2 + 1] = reveal;
        const tint = tintFor(e);
        tints[i * 2 + 0] = tint;
        tints[i * 2 + 1] = tint;
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
      geometry.setAttribute("aReveal", new THREE.BufferAttribute(reveals, 1));
      geometry.setAttribute("aTint", new THREE.BufferAttribute(tints, 1));
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
        const progress = Math.max(
          0,
          Math.min(1, getConnectionProgress?.(e) ?? 1),
        );
        posAttr.setXYZ(i * 2 + 0, sx, sy, sz);
        posAttr.setXYZ(
          i * 2 + 1,
          sx + (tx - sx) * progress,
          sy + (ty - sy) * progress,
          sz + (tz - sz) * progress,
        );
      }
      posAttr.needsUpdate = true;
    }
  }

  function refreshOpacities() {
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
        let opacity: number;
        if (hoverEdge !== null && e === hoverEdge) {
          opacity = HOVER_EDGE_OPACITY;
        } else {
          const dim =
            hoverNodeId !== null &&
            e.source !== hoverNodeId &&
            e.target !== hoverNodeId;
          opacity = dim ? 0.08 : baseOpacity;
        }
        attr.setX(i * 2 + 0, opacity);
        attr.setX(i * 2 + 1, opacity);
      }
      attr.needsUpdate = true;
    }
  }

  function setHoverNode(nodeId: string | null) {
    hoverNodeId = nodeId;
    refreshOpacities();
  }

  function setHoverEdge(edge: GraphEdge | null) {
    hoverEdge = edge;
    refreshOpacities();
  }

  function visibleEdges() {
    if (!currentNodeIndex) return [];
    const out: Array<{
      edge: GraphEdge;
      sourceIdx: number;
      targetIdx: number;
    }> = [];
    for (const { edgeList, validIndices } of lineSegmentsByKind.values()) {
      for (const i of validIndices) {
        const e = edgeList[i]!;
        const sourceIdx = currentNodeIndex.get(e.source);
        const targetIdx = currentNodeIndex.get(e.target);
        if (sourceIdx === undefined || targetIdx === undefined) continue;
        out.push({ edge: e, sourceIdx, targetIdx });
      }
    }
    return out;
  }

  function setConnectionProgress(
    getProgress: ((edge: GraphEdge) => number) | null,
  ) {
    getConnectionProgress = getProgress;
    for (const {
      line,
      edgeList,
      validIndices,
    } of lineSegmentsByKind.values()) {
      const attr = line.geometry.getAttribute("aReveal") as
        | THREE.BufferAttribute
        | undefined;
      if (!attr) continue;
      for (const i of validIndices) {
        const reveal = Math.max(
          0,
          Math.min(1, getConnectionProgress?.(edgeList[i]!) ?? 1),
        );
        attr.setX(i * 2 + 0, reveal);
        attr.setX(i * 2 + 1, reveal);
      }
      attr.needsUpdate = true;
    }
  }

  function setTime(t: number) {
    for (const mat of materials.values()) {
      (mat.uniforms.uTime as { value: number }).value = t;
    }
  }

  const _pickA = new THREE.Vector3();
  const _pickB = new THREE.Vector3();
  function pickAt(
    camera: THREE.Camera,
    container: HTMLElement,
    clientX: number,
    clientY: number,
    tolerancePx = 6,
  ): GraphEdge | null {
    const rect = container.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let best: GraphEdge | null = null;
    let bestDist2 = tolerancePx * tolerancePx;

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
        _pickA.set(
          posAttr.getX(i * 2 + 0),
          posAttr.getY(i * 2 + 0),
          posAttr.getZ(i * 2 + 0),
        );
        _pickB.set(
          posAttr.getX(i * 2 + 1),
          posAttr.getY(i * 2 + 1),
          posAttr.getZ(i * 2 + 1),
        );
        _pickA.project(camera);
        _pickB.project(camera);
        // Reject if both endpoints behind the near plane
        if (_pickA.z > 1 && _pickB.z > 1) continue;
        const ax = (_pickA.x * 0.5 + 0.5) * rect.width;
        const ay = (1 - (_pickA.y * 0.5 + 0.5)) * rect.height;
        const bx = (_pickB.x * 0.5 + 0.5) * rect.width;
        const by = (1 - (_pickB.y * 0.5 + 0.5)) * rect.height;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = 0;
        if (len2 > 0) {
          t = ((mx - ax) * dx + (my - ay) * dy) / len2;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
        }
        const px = ax + t * dx;
        const py = ay + t * dy;
        const ex = mx - px;
        const ey = my - py;
        const dist2 = ex * ex + ey * ey;
        if (dist2 < bestDist2) {
          bestDist2 = dist2;
          best = edgeList[i] ?? null;
        }
      }
    }
    return best;
  }

  function dispose() {
    for (const { line } of lineSegmentsByKind.values()) {
      line.geometry.dispose();
    }
    materials.forEach((m) => m.dispose());
  }

  return {
    group,
    rebuild,
    updatePositions,
    setHoverNode,
    setHoverEdge,
    visibleEdges,
    setConnectionProgress,
    setTime,
    pickAt,
    dispose,
  };
}
