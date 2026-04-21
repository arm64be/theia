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
  const nodes: PhysicsNode[] = graph.nodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    anchorX: n.position.x,
    anchorY: n.position.y,
  }));
  const links: PhysicsLink[] = graph.edges.map((e) => ({
    source: e.source,
    target: e.target,
    weight: e.weight,
  }));

  const sim: Simulation<PhysicsNode, PhysicsLink> = forceSimulation(nodes, 2)
    .force(
      "link",
      forceLink<PhysicsNode, PhysicsLink>(links)
        .id((n) => n.id)
        .strength(0.05),
    )
    .force("charge", forceManyBody<PhysicsNode>().strength(-0.02))
    .force("anchor", forceAnchor(0.25))
    .force("center", forceCenter(0, 0))
    .alphaDecay(0.03)
    .alphaTarget(0.02); // keep a low-level breathing motion

  return { simulation: sim, nodes };
}
