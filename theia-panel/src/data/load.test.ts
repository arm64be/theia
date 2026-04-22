import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGraph } from "./load";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadGraph", () => {
  it("parses a valid graph.json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          meta: {
            generated_at: "2026-04-21T00:00:00Z",
            source_count: 1,
            projection: "pca",
          },
          nodes: [
            {
              id: "a",
              title: "A",
              started_at: "2026-04-20T00:00:00Z",
              duration_sec: 0,
              tool_count: 0,
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        }),
      }),
    );

    const g = await loadGraph("/graph.json");
    expect(g.nodes).toHaveLength(1);
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );
    await expect(loadGraph("/missing")).rejects.toThrow(/404/);
  });
});
