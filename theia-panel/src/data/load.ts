import type { TheiaGraph } from "./types";

export async function loadGraph(url: string): Promise<TheiaGraph> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
  const graph = (await res.json()) as TheiaGraph;
  if (!graph.meta || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("graph.json missing required top-level fields");
  }
  return graph;
}
