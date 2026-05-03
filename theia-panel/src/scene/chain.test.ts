import { describe, it, expect } from "vitest";
import { computeEdgeChain } from "./chain";
import type { TheiaGraph } from "../data/types";

type EdgeKind = TheiaGraph["edges"][number]["kind"];
type GraphEdge = TheiaGraph["edges"][number];
type GraphNode = TheiaGraph["nodes"][number];

const ALL_KINDS: Set<EdgeKind> = new Set([
  "memory-share",
  "cross-search",
  "tool-overlap",
  "subagent",
  "cron-chain",
]);

function node(id: string): GraphNode {
  return {
    id,
    title: id,
    started_at: "2026-04-20T00:00:00Z",
    duration_sec: 0,
    tool_count: 0,
    position: { x: 0, y: 0 },
  };
}

function edge(
  source: string,
  target: string,
  kind: EdgeKind = "memory-share",
): GraphEdge {
  return { source, target, kind, weight: 1 };
}

function graph(nodes: string[], edges: GraphEdge[]): TheiaGraph {
  return {
    meta: {
      generated_at: "2026-04-20T00:00:00Z",
      source_count: nodes.length,
      projection: "pca",
    },
    nodes: nodes.map(node),
    edges,
  };
}

function visible(g: TheiaGraph): Set<string> {
  return new Set(g.nodes.map((n) => n.id));
}

describe("computeEdgeChain", () => {
  it("returns just the two endpoints for an isolated edge", () => {
    const g = graph(["a", "b"], [edge("a", "b")]);
    const chain = computeEdgeChain(g, ["a", "b"], ALL_KINDS, visible(g));
    expect([...chain.nodes].sort()).toEqual(["a", "b"]);
    expect(chain.edgeCount).toBe(1);
  });

  it("walks a linear chain past depth 1 from a single seed", () => {
    // a — b — c — d  (BFS from b should reach a, c, d)
    const g = graph(
      ["a", "b", "c", "d"],
      [edge("a", "b"), edge("b", "c"), edge("c", "d")],
    );
    const chain = computeEdgeChain(g, ["b", "c"], ALL_KINDS, visible(g));
    expect([...chain.nodes].sort()).toEqual(["a", "b", "c", "d"]);
    expect(chain.edgeCount).toBe(3);
  });

  it("isolates the seed component when multiple components exist", () => {
    // component 1: a—b—c    component 2: x—y
    const g = graph(
      ["a", "b", "c", "x", "y"],
      [edge("a", "b"), edge("b", "c"), edge("x", "y")],
    );
    const chain = computeEdgeChain(g, ["a", "b"], ALL_KINDS, visible(g));
    expect([...chain.nodes].sort()).toEqual(["a", "b", "c"]);
    expect(chain.edgeCount).toBe(2);
  });

  it("does not traverse through edges of disabled kinds", () => {
    // a —[memory]— b —[subagent]— c —[memory]— d
    // With subagent disabled, BFS from a—b should NOT reach c or d.
    const g = graph(
      ["a", "b", "c", "d"],
      [
        edge("a", "b", "memory-share"),
        edge("b", "c", "subagent"),
        edge("c", "d", "memory-share"),
      ],
    );
    const enabled: Set<EdgeKind> = new Set(["memory-share"]);
    const chain = computeEdgeChain(g, ["a", "b"], enabled, visible(g));
    expect([...chain.nodes].sort()).toEqual(["a", "b"]);
    expect(chain.edgeCount).toBe(1);
  });

  it("does not traverse through hidden nodes", () => {
    // a — b — c — d, but b is filtered out of visibleNodeIds.
    // Seed at c should reach c and d, but not a (b blocks the path).
    const g = graph(
      ["a", "b", "c", "d"],
      [edge("a", "b"), edge("b", "c"), edge("c", "d")],
    );
    const visibleSet = new Set(["a", "c", "d"]);
    const chain = computeEdgeChain(g, ["c", "d"], ALL_KINDS, visibleSet);
    expect([...chain.nodes].sort()).toEqual(["c", "d"]);
    expect(chain.edgeCount).toBe(1);
  });

  it("handles cycles without infinite-looping", () => {
    // Triangle a—b—c—a, plus a tail c—d.
    const g = graph(
      ["a", "b", "c", "d"],
      [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("c", "d")],
    );
    const chain = computeEdgeChain(g, ["a", "b"], ALL_KINDS, visible(g));
    expect([...chain.nodes].sort()).toEqual(["a", "b", "c", "d"]);
    expect(chain.edgeCount).toBe(4);
  });

  it("returns an empty chain when no seed is visible", () => {
    const g = graph(["a", "b"], [edge("a", "b")]);
    const chain = computeEdgeChain(g, ["a", "b"], ALL_KINDS, new Set());
    expect(chain.nodes.size).toBe(0);
    expect(chain.edgeCount).toBe(0);
  });

  it("counts deduplicated parallel edges between the same pair", () => {
    // Two edges of different kinds between a—b should both count
    // (the chain BFS doesn't dedupe; it reflects the underlying edge list).
    const g = graph(
      ["a", "b"],
      [edge("a", "b", "memory-share"), edge("a", "b", "cross-search")],
    );
    const chain = computeEdgeChain(g, ["a"], ALL_KINDS, visible(g));
    expect([...chain.nodes].sort()).toEqual(["a", "b"]);
    expect(chain.edgeCount).toBe(2);
  });
});
