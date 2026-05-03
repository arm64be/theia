import type { TheiaGraph } from "../data/types";

type GraphEdge = TheiaGraph["edges"][number];

export interface EdgeChain {
  nodes: Set<string>;
  edgeCount: number;
}

/**
 * Undirected BFS over edges of `enabledKinds`, restricted to `visibleNodeIds`.
 * Returns the connected component containing `seedIds`, plus the edge count
 * fully contained within that component (used for the chain overlay label).
 *
 * Pure: no DOM, no THREE, no closure over module state.
 */
export function computeEdgeChain(
  graph: TheiaGraph,
  seedIds: Iterable<string>,
  enabledKinds: Set<GraphEdge["kind"]>,
  visibleNodeIds: ReadonlySet<string>,
): EdgeChain {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!enabledKinds.has(edge.kind)) continue;
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
      continue;
    }
    let aList = adjacency.get(edge.source);
    if (!aList) {
      aList = [];
      adjacency.set(edge.source, aList);
    }
    aList.push(edge.target);
    let bList = adjacency.get(edge.target);
    if (!bList) {
      bList = [];
      adjacency.set(edge.target, bList);
    }
    bList.push(edge.source);
  }

  const visited = new Set<string>();
  const queue: string[] = [];
  for (const id of seedIds) {
    if (visibleNodeIds.has(id) && !visited.has(id)) {
      visited.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const neighbors = adjacency.get(id);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }

  let edgeCount = 0;
  for (const edge of graph.edges) {
    if (!enabledKinds.has(edge.kind)) continue;
    if (visited.has(edge.source) && visited.has(edge.target)) edgeCount++;
  }
  return { nodes: visited, edgeCount };
}
