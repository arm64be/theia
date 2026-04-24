import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  type Simulation,
} from "d3-force-3d";
import type { TheiaGraph } from "../data/types";
import { hashN11 } from "../util/hash";

interface PhysicsNode {
  id: string;
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  radius: number;
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
      n.vz = (n.vz ?? 0) + (n.anchorZ - n.z) * strength * alpha;
    }
  }
  force.initialize = (n: PhysicsNode[]) => {
    nodes = n;
  };
  return force;
}

/**
 * Custom force: mild attraction toward the centroid of each node's
 * immediate neighbors. Keeps clusters coherent without exploding.
 */
function forceCluster(links: PhysicsLink[], strength = 0.03) {
  let nodes: PhysicsNode[] = [];
  function force(alpha: number) {
    const adj = new Map<string, Set<string>>();
    const nodeMap = new Map<string, PhysicsNode>();
    for (const n of nodes) {
      adj.set(n.id, new Set());
      nodeMap.set(n.id, n);
    }
    for (const l of links) {
      adj.get(l.source)?.add(l.target);
      adj.get(l.target)?.add(l.source);
    }

    for (const n of nodes) {
      const neighbors = adj.get(n.id);
      if (!neighbors || neighbors.size === 0) continue;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let count = 0;
      for (const nid of neighbors) {
        const neighbor = nodeMap.get(nid);
        if (neighbor) {
          cx += neighbor.x;
          cy += neighbor.y;
          cz += neighbor.z;
          count++;
        }
      }
      if (count > 0) {
        cx /= count;
        cy /= count;
        cz /= count;
        n.vx = (n.vx ?? 0) + (cx - n.x) * strength * alpha;
        n.vy = (n.vy ?? 0) + (cy - n.y) * strength * alpha;
        n.vz = (n.vz ?? 0) + (cz - n.z) * strength * alpha;
      }
    }
  }
  force.initialize = (n: PhysicsNode[]) => {
    nodes = n;
  };
  return force;
}

/** Custom 3D collision force. */
function forceCollide(strength = 0.5) {
  let nodes: PhysicsNode[] = [];
  function force(alpha: number) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const minDist = a.radius + b.radius + 0.02;
        if (dist > 0 && dist < minDist) {
          const overlap = minDist - dist;
          const fx = (dx / dist) * overlap * strength * alpha;
          const fy = (dy / dist) * overlap * strength * alpha;
          const fz = (dz / dist) * overlap * strength * alpha;
          a.vx = (a.vx ?? 0) + fx;
          a.vy = (a.vy ?? 0) + fy;
          a.vz = (a.vz ?? 0) + fz;
          b.vx = (b.vx ?? 0) - fx;
          b.vy = (b.vy ?? 0) - fy;
          b.vz = (b.vz ?? 0) - fz;
        }
      }
    }
  }
  force.initialize = (n: PhysicsNode[]) => {
    nodes = n;
  };
  return force;
}

export function createSimulation(graph: TheiaGraph) {
  const spread = 1.8;

  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const safeEdges = graph.edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  // Compute node radii based on degree centrality
  const degreeMap = new Map<string, number>();
  for (const n of graph.nodes) degreeMap.set(n.id, 0);
  for (const e of safeEdges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
  }

  const nodes: PhysicsNode[] = graph.nodes.map((n) => {
    const degree = degreeMap.get(n.id) ?? 0;
    // Larger radius for visibility: base 0.08, up to 0.18 for hubs
    const radius = 0.08 + Math.min(0.1, degree * 0.008);
    const zSpread = 1.5;
    const z = hashN11(n.id) * zSpread;
    return {
      id: n.id,
      x: n.position.x * spread,
      y: n.position.y * spread,
      z,
      anchorX: n.position.x * spread,
      anchorY: n.position.y * spread,
      anchorZ: z,
      radius,
    };
  });

  const links: PhysicsLink[] = safeEdges.map((e) => ({
    source: e.source,
    target: e.target,
    weight: e.weight,
    kind: e.kind,
  }));

  // Sane link parameters: tight clusters for semantic edges,
  // loose branches for tool-overlap
  const kindStrength: Record<string, number> = {
    "cross-search": 0.25,
    "memory-share": 0.3,
    "tool-overlap": 0.04,
  };
  const kindDistance: Record<string, number> = {
    "cross-search": 1.2,
    "memory-share": 0.9,
    "tool-overlap": 2.2,
  };

  const linkForce = forceLink<PhysicsNode, PhysicsLink>(links)
    .id((n) => n.id)
    .strength((l) => kindStrength[l.kind] ?? 0.08)
    .distance((l) => kindDistance[l.kind] ?? 1.5);

  const sim: Simulation<PhysicsNode, PhysicsLink> = forceSimulation(nodes, 3)
    .force("link", linkForce)
    .force("charge", forceManyBody<PhysicsNode>().strength(-0.06))
    .force("collide", forceCollide(0.6))
    .force("cluster", forceCluster(links, 0.04))
    .force("anchor", forceAnchor(0.18))
    .force("center", forceCenter(0, 0, 0))
    .alphaDecay(0.025)
    .alphaTarget(0.015);

  return { simulation: sim, nodes };
}
