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
 *
 * Adjacency is resolved once per simulation in initialize(), not per
 * tick. Links and node identities don't change between ticks for a
 * given simulation; rebuilding the adjacency map every tick was pure
 * GC churn at 1.6k nodes (thousands of Map/Set allocations per tick).
 */
function forceCluster(links: PhysicsLink[], strength = 0.03) {
  let nodes: PhysicsNode[] = [];
  let neighborIdx: Int32Array[] = [];
  function force(alpha: number) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const idx = neighborIdx[i]!;
      const count = idx.length;
      if (count === 0) continue;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let k = 0; k < count; k++) {
        const neighbor = nodes[idx[k]!]!;
        cx += neighbor.x;
        cy += neighbor.y;
        cz += neighbor.z;
      }
      cx /= count;
      cy /= count;
      cz /= count;
      n.vx = (n.vx ?? 0) + (cx - n.x) * strength * alpha;
      n.vy = (n.vy ?? 0) + (cy - n.y) * strength * alpha;
      n.vz = (n.vz ?? 0) + (cz - n.z) * strength * alpha;
    }
  }
  force.initialize = (n: PhysicsNode[]) => {
    nodes = n;
    const idxById = new Map<string, number>();
    for (let i = 0; i < n.length; i++) idxById.set(n[i]!.id, i);
    const tmp: number[][] = n.map(() => []);
    for (const l of links) {
      const si = idxById.get(l.source);
      const ti = idxById.get(l.target);
      if (si === undefined || ti === undefined) continue;
      tmp[si]!.push(ti);
      tmp[ti]!.push(si);
    }
    neighborIdx = tmp.map((a) => Int32Array.from(a));
  };
  return force;
}

/**
 * Custom 3D collision force, spatial-hashed.
 *
 * The previous O(N²) all-pairs check did ~1.28M pair tests per tick at
 * 1.6k nodes — the dominant cost in the entire simulation. Now we bin
 * nodes into a uniform cubic grid sized to the maximum collision
 * distance, so each node only checks its own cell + 26 neighbors.
 * Average candidate set drops from N to a small constant (proportional
 * to local density), giving ~O(N) per tick at typical layouts.
 */
function forceCollide(strength = 0.5) {
  let nodes: PhysicsNode[] = [];
  let cellSize = 0.4;
  const grid = new Map<number, number[]>();
  // Pack 3 signed ints into a single key. ±2¹⁰ cells per axis covers
  // layouts spanning a few world units at our scale.
  const key3 = (cx: number, cy: number, cz: number) =>
    ((cx + 1024) << 20) | ((cy + 1024) << 10) | (cz + 1024);
  function force(alpha: number) {
    grid.clear();
    const inv = 1 / cellSize;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const k = key3(
        Math.floor(n.x * inv),
        Math.floor(n.y * inv),
        Math.floor(n.z * inv),
      );
      const bucket = grid.get(k);
      if (bucket) bucket.push(i);
      else grid.set(k, [i]);
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!;
      const cx = Math.floor(a.x * inv);
      const cy = Math.floor(a.y * inv);
      const cz = Math.floor(a.z * inv);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = grid.get(key3(cx + dx, cy + dy, cz + dz));
            if (!bucket) continue;
            for (let bi = 0; bi < bucket.length; bi++) {
              const j = bucket[bi]!;
              if (j <= i) continue;
              const b = nodes[j]!;
              const ddx = a.x - b.x;
              const ddy = a.y - b.y;
              const ddz = a.z - b.z;
              const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
              const minDist = a.radius + b.radius + 0.02;
              if (distSq > 0 && distSq < minDist * minDist) {
                const dist = Math.sqrt(distSq);
                const overlap = minDist - dist;
                const fx = (ddx / dist) * overlap * strength * alpha;
                const fy = (ddy / dist) * overlap * strength * alpha;
                const fz = (ddz / dist) * overlap * strength * alpha;
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
      }
    }
  }
  force.initialize = (n: PhysicsNode[]) => {
    nodes = n;
    let maxR = 0;
    for (const node of n) if (node.radius > maxR) maxR = node.radius;
    cellSize = Math.max(0.05, maxR * 2 + 0.02);
  };
  return force;
}

export function createSimulation(
  graph: TheiaGraph,
  enabledKinds?: Set<string>,
  profile: "normal" | "onboarding" = "normal",
) {
  const spread = 1.8;
  const isOnboarding = profile === "onboarding";

  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const safeEdges = graph.edges.filter(
    (e) =>
      nodeIds.has(e.source) &&
      nodeIds.has(e.target) &&
      (!enabledKinds || enabledKinds.has(e.kind)),
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
  // loose branches for tool-overlap. Onboarding uses softer forces because
  // nodes are being introduced into a changing partial graph.
  const kindStrength: Record<string, number> = {
    "cross-search": isOnboarding ? 0.12 : 0.2,
    "memory-share": isOnboarding ? 0.14 : 0.24,
    "tool-overlap": isOnboarding ? 0.025 : 0.04,
    "cron-chain": isOnboarding ? 0.08 : 0.12,
  };
  const kindDistance: Record<string, number> = {
    "cross-search": 1.25,
    "memory-share": 1.0,
    "tool-overlap": 2.1,
    "cron-chain": 1.6,
  };

  const linkForce = forceLink<PhysicsNode, PhysicsLink>(links)
    .id((n) => n.id)
    .strength((l) => kindStrength[l.kind] ?? 0.08)
    .distance((l) => kindDistance[l.kind] ?? 1.5);

  const sim: Simulation<PhysicsNode, PhysicsLink> = forceSimulation(nodes, 3)
    .force("link", linkForce)
    .force(
      "charge",
      forceManyBody<PhysicsNode>().strength(isOnboarding ? -0.025 : -0.045),
    )
    .force("collide", forceCollide(isOnboarding ? 0.35 : 0.5))
    .force("cluster", forceCluster(links, isOnboarding ? 0.018 : 0.032))
    .force("anchor", forceAnchor(isOnboarding ? 0.07 : 0.14))
    .velocityDecay(isOnboarding ? 0.68 : 0.5)
    .alphaDecay(isOnboarding ? 0.04 : 0.03)
    .alphaTarget(isOnboarding ? 0.004 : 0.012);

  if (!isOnboarding) {
    sim.force("center", forceCenter(0, 0, 0));
  }

  return { simulation: sim, nodes };
}
