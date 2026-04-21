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
 * Custom force: pushes low-degree nodes outward and pulls high-degree nodes
 * toward the center. Creates a natural hub-spoke / branch structure.
 */
function forceRadialDegree(
  maxRadius: number,
  strength = 0.12,
  minRadius = 0.3,
) {
  let nodes: PhysicsNode[] = [];
  function force(alpha: number) {
    for (const n of nodes) {
      const r = Math.sqrt(n.x * n.x + n.y * n.y);
      if (r === 0) continue;

      // Target radius: high degree -> small radius (center), low degree -> large radius (periphery)
      // Use log scale so the drop-off isn't too extreme
      const targetR =
        minRadius +
        (maxRadius - minRadius) /
          (1 + 0.6 * Math.log1p(n.degree));

      const delta = targetR - r;
      const f = delta * strength * alpha;
      const nx = n.x / r;
      const ny = n.y / r;
      n.vx = (n.vx ?? 0) + nx * f;
      n.vy = (n.vy ?? 0) + ny * f;
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
  // Weak + long = loose connections spanning clusters (tool-overlap)
  const kindStrength: Record<string, number> = {
    "cross-search": 0.25,
    "memory-share": 0.10,
    "tool-overlap": 0.04,
  };
  const kindDistance: Record<string, number> = {
    "cross-search": 1.0,
    "memory-share": 0.8,
    "tool-overlap": 2.5,
  };

  const linkForce = forceLink<PhysicsNode, PhysicsLink>(links)
    .id((n) => n.id)
    .strength((l) => kindStrength[l.kind] ?? 0.05)
    .distance((l) => kindDistance[l.kind] ?? 1.5);

  const sim: Simulation<PhysicsNode, PhysicsLink> = forceSimulation(nodes, 2)
    .force("link", linkForce)
    .force("charge", forceManyBody<PhysicsNode>().strength(-0.08))
    .force("anchor", forceAnchor(0.25))
    .force("radial", forceRadialDegree(6.0, 0.10))
    .force("center", forceCenter(0, 0))
    .alphaDecay(0.02)
    .alphaTarget(0.015);

  return { simulation: sim, nodes };
}
