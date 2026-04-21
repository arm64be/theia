import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  type Simulation,
} from "d3-force-3d";
import type { TheiaGraph } from "../data/types";

interface PhysicsNode {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  anchorX: number;
  anchorY: number;
  degree: number;
}

interface PhysicsLink {
  source: string;
  target: string;
  weight: number;
  kind: string;
}

/** Custom force: pulls each node toward its semantic anchor. */
function forceAnchor(strength = 0.15) {
  let nodes: PhysicsNode[] = [];
  function force(alpha: number) {
    for (const n of nodes) {
      n.vx = (n.vx ?? 0) + (n.anchorX - n.x) * strength * alpha;
      n.vy = (n.vy ?? 0) + (n.anchorY - n.y) * strength * alpha;
    }
  }
  force.initialize = (n: PhysicsNode[]) => {
    nodes = n;
  };
  return force;
}

/**
 * Custom force: extra repulsion between leaf-like nodes (degree <= 2)
 * so they spread out within their branch area instead of clumping.
 */
function forceLeafSpread(strength = -0.06, degreeThreshold = 2) {
  let nodes: PhysicsNode[] = [];
  function force(alpha: number) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!;
      if (a.degree > degreeThreshold) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]!;
        if (b.degree > degreeThreshold) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = dx * dx + dy * dy;
        if (distSq === 0) continue;
        const dist = Math.sqrt(distSq);
        const f = (strength * alpha) / dist;
        a.vx = (a.vx ?? 0) + dx * f;
        a.vy = (a.vy ?? 0) + dy * f;
        b.vx = (b.vx ?? 0) - dx * f;
        b.vy = (b.vy ?? 0) - dy * f;
      }
    }
  }
  force.initialize = (n: PhysicsNode[]) => {
    nodes = n;
  };
  return force;
}

export function createSimulation(graph: TheiaGraph) {
  const spread = 1.5;

  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const safeEdges = graph.edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  // Compute degree centrality
  const degreeMap = new Map<string, number>();
  for (const n of graph.nodes) degreeMap.set(n.id, 0);
  for (const e of safeEdges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
  }

  const nodes: PhysicsNode[] = graph.nodes.map((n) => ({
    id: n.id,
    x: n.position.x * spread,
    y: n.position.y * spread,
    anchorX: n.position.x * spread,
    anchorY: n.position.y * spread,
    degree: degreeMap.get(n.id) ?? 0,
  }));

  const links: PhysicsLink[] = safeEdges.map((e) => ({
    source: e.source,
    target: e.target,
    weight: e.weight,
    kind: e.kind,
  }));

  // Per-kind link strengths and distances
  // Strong + short = tight clusters (memory-share, cross-search)
  // Weak + long = loose tree branches spanning clusters (tool-overlap)
  const kindStrength: Record<string, number> = {
    "cross-search": 0.22,
    "memory-share": 0.25,
    "tool-overlap": 0.015,
  };
  const kindDistance: Record<string, number> = {
    "cross-search": 1.0,
    "memory-share": 0.5,
    "tool-overlap": 5.0,
  };

  const linkForce = forceLink<PhysicsNode, PhysicsLink>(links)
    .id((n) => n.id)
    .strength((l) => kindStrength[l.kind] ?? 0.05)
    .distance((l) => kindDistance[l.kind] ?? 1.5);

  const sim: Simulation<PhysicsNode, PhysicsLink> = forceSimulation(nodes, 2)
    .force("link", linkForce)
    .force("charge", forceManyBody<PhysicsNode>().strength(-0.12))
    .force("leafSpread", forceLeafSpread(-0.04))
    .force("anchor", forceAnchor(0.15))
    .force("center", forceCenter(0, 0))
    .alphaDecay(0.02)
    .alphaTarget(0.015);

  return { simulation: sim, nodes };
}
