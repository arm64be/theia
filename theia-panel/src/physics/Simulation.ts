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

export function createSimulation(graph: TheiaGraph) {
  // Moderate spread so clusters have breathing room but stay grouped
  const spread = 1.5;

  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  // Runtime safety: drop edges that reference missing nodes
  const safeEdges = graph.edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  const nodes: PhysicsNode[] = graph.nodes.map((n) => ({
    id: n.id,
    x: n.position.x * spread,
    y: n.position.y * spread,
    anchorX: n.position.x * spread,
    anchorY: n.position.y * spread,
  }));
  const links: PhysicsLink[] = safeEdges.map((e) => ({
    source: e.source,
    target: e.target,
    weight: e.weight,
    kind: e.kind,
  }));

  // Per-kind link strengths
  const kindStrength: Record<string, number> = {
    "cross-search": 0.25,
    "memory-share": 0.08,
    "tool-overlap": 0.12,
  };

  const linkForce = forceLink<PhysicsNode, PhysicsLink>(links)
    .id((n) => n.id)
    .strength((l) => kindStrength[l.kind] ?? 0.05);

  const sim: Simulation<PhysicsNode, PhysicsLink> = forceSimulation(nodes, 2)
    .force("link", linkForce)
    .force("charge", forceManyBody<PhysicsNode>().strength(-0.06))
    .force("anchor", forceAnchor(0.35))
    .force("center", forceCenter(0, 0))
    .alphaDecay(0.03)
    .alphaTarget(0.02); // subtle ambient breathing motion

  return { simulation: sim, nodes };
}
