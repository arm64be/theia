import type { TheiaGraph } from "../data/types";

export const VALID_KINDS: TheiaGraph["edges"][number]["kind"][] = [
  "memory-share",
  "cross-search",
  "tool-overlap",
  "subagent",
  "cron-chain",
];

export const DEFAULT_KINDS: TheiaGraph["edges"][number]["kind"][] = VALID_KINDS;

export const STORAGE_KEY = "theia-constellation-filter";

export function loadFilterState(): {
  kinds: Set<TheiaGraph["edges"][number]["kind"]>;
  model: string | null;
  searchFocus: boolean;
  hideOrphans: boolean;
  componentFocus: boolean;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const parsedKinds = Array.isArray(parsed?.kinds)
      ? parsed.kinds.filter(
          (k: unknown): k is TheiaGraph["edges"][number]["kind"] =>
            (VALID_KINDS as readonly unknown[]).includes(k),
        )
      : DEFAULT_KINDS;
    return {
      kinds: new Set(parsedKinds.length > 0 ? parsedKinds : DEFAULT_KINDS),
      model: typeof parsed?.model === "string" ? parsed.model : null,
      searchFocus: parsed?.searchFocus === true,
      hideOrphans: parsed?.hideOrphans === true,
      componentFocus: parsed?.componentFocus === true,
    };
  } catch {
    return null;
  }
}

export function saveFilterState(
  kinds: Set<string>,
  model: string | null,
  searchFocus: boolean,
  hideOrphans: boolean,
  componentFocus: boolean,
): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        kinds: Array.from(kinds),
        model,
        searchFocus,
        hideOrphans,
        componentFocus,
      }),
    );
  } catch {
    /* quota exceeded, ignore */
  }
}

export function computeVisibleNodeIds(
  graph: TheiaGraph,
  enabledKinds: Set<string>,
  modelFilter?: string | null,
  hideOrphans = false,
): Set<string> {
  const kindVisible = new Set<string>();
  if (enabledKinds.has("subagent")) {
    for (const node of graph.nodes) {
      kindVisible.add(node.id);
    }
  } else {
    const subagentIds = new Set<string>();
    const hasNonSubagentConnection = new Map<string, boolean>();
    for (const node of graph.nodes) {
      if (node.parent_id) {
        subagentIds.add(node.id);
      } else {
        hasNonSubagentConnection.set(node.id, true);
      }
    }
    for (const edge of graph.edges) {
      if (edge.kind === "subagent") continue;
      if (!enabledKinds.has(edge.kind)) continue;
      if (!subagentIds.has(edge.source)) {
        hasNonSubagentConnection.set(edge.source, true);
      }
      if (!subagentIds.has(edge.target)) {
        hasNonSubagentConnection.set(edge.target, true);
      }
    }
    for (const node of graph.nodes) {
      if (hasNonSubagentConnection.get(node.id)) {
        kindVisible.add(node.id);
      }
    }
  }
  if (hideOrphans) {
    for (const node of graph.nodes) {
      if (node.metadata?.is_orphan) kindVisible.delete(node.id);
    }
  }
  if (modelFilter) {
    const modelMatch = new Set<string>();
    for (const node of graph.nodes) {
      if (node.model === modelFilter && kindVisible.has(node.id)) {
        modelMatch.add(node.id);
      }
    }
    return modelMatch;
  }
  return kindVisible;
}
