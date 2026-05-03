import type { TheiaGraph } from "../data/types";
import type { ThemeTokens } from "./Theme";
import { themeBgAlpha, FONT_STACK } from "./Theme";
import { escape } from "./utils";

let searchBarStylesInjected = false;

function injectSearchBarStyles(): void {
  if (searchBarStylesInjected) return;
  searchBarStylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .tp-search-bar {
      transition: right 100ms ease-out, width 100ms ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
      .tp-search-bar {
        transition: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

export interface SearchResult {
  node: TheiaGraph["nodes"][number];
  index: number;
}

export function createSearchBar(
  container: HTMLElement,
  graph: TheiaGraph,
  onFocus: (result: SearchResult) => void,
  initialTheme: ThemeTokens,
  isVisible?: (node: TheiaGraph["nodes"][number]) => boolean,
) {
  let theme = initialTheme;

  const wrapper = document.createElement("div");
  wrapper.dataset.uiOverlay = "";
  wrapper.classList.add("tp-search-bar");
  const input = document.createElement("input");
  const dropdown = document.createElement("div");

  let currentResults: SearchResult[] = [];
  let selectedIndex = -1;
  let panelOpen = false;
  let matchedCacheQuery = "";
  let matchedCacheIds: Set<string> | null = null;

  // Pre-lowercase every searchable field once at construction. The hot
  // path used to call .toLowerCase() five times per node per keystroke
  // (~8k allocations + GC churn at 1.6k nodes); now it does a single
  // lowercased query + plain `.includes()` against the cache.
  const lcTitle = new Array<string>(graph.nodes.length);
  const lcId = new Array<string>(graph.nodes.length);
  const lcPreview = new Array<string>(graph.nodes.length);
  const lcSummary = new Array<string>(graph.nodes.length);
  const lcInitialPrompt = new Array<string>(graph.nodes.length);
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i]!;
    lcTitle[i] = (node.title ?? "").toLowerCase();
    lcId[i] = node.id.toLowerCase();
    lcPreview[i] = (node.preview ?? "").toLowerCase();
    lcSummary[i] = (node.summary ?? "").toLowerCase();
    lcInitialPrompt[i] = (node.initial_prompt ?? "").toLowerCase();
  }

  // Cap the rendered dropdown — short queries can match hundreds of
  // nodes, and rendering them all (with per-item event listeners and
  // innerHTML rewrites) is what the user perceives as input lag. The
  // matchedCacheIds set still tracks the FULL match list for the
  // search-focus filter; only the visible UI is capped.
  const MAX_VISIBLE_RESULTS = 50;

  function applyWrapperStyle() {
    wrapper.style.cssText = `
      position: absolute; top: 12px; right: calc((100% - min(320px, 50vw)) / 2); transform: none;
      z-index: 12;
      font: 13px/1.4 var(--theia-font, ${FONT_STACK});
      color: #${theme.fg}; width: min(320px, 50vw);
    `;
  }

  function applyInputStyle() {
    input.style.cssText = `
      width: 100%; box-sizing: border-box;
      padding: 8px 12px; background: ${themeBgAlpha(theme, 0.85)};
      border: 1px solid #${theme.border};
      color: #${theme.fg}; font: inherit; outline: none;
      backdrop-filter: blur(4px);
    `;
  }

  function applyDropdownStyle() {
    dropdown.style.cssText = `
      position: absolute; top: calc(100% + 6px); left: 0; right: 0;
      background: ${themeBgAlpha(theme, 0.95)}; border: 1px solid #${theme.border};
      display: none;
      backdrop-filter: blur(6px); max-height: 240px; overflow-y: auto;
    `;
  }

  applyWrapperStyle();
  applyInputStyle();
  applyDropdownStyle();
  injectSearchBarStyles();

  input.type = "text";
  input.placeholder = "Search sessions\u2026";
  input.addEventListener("focus", () => {
    input.style.borderColor = `#${theme.accent}`;
  });

  let clickingDropdown = false;
  dropdown.addEventListener("mousedown", () => {
    clickingDropdown = true;
  });
  input.addEventListener("blur", () => {
    input.style.borderColor = `#${theme.border}`;
    if (!clickingDropdown) hide();
    clickingDropdown = false;
  });

  wrapper.append(input, dropdown);
  container.appendChild(wrapper);

  function select(index: number) {
    const items = dropdown.querySelectorAll<HTMLElement>(".search-item");
    for (let i = 0; i < items.length; i++) {
      items[i]!.style.background =
        i === index ? "rgba(255,255,255,0.1)" : "transparent";
    }
    selectedIndex = index;
    if (index >= 0 && items[index]) {
      items[index]!.scrollIntoView({ block: "nearest" });
    }
  }

  function commit(index: number) {
    const result = currentResults[index];
    if (result) {
      onFocus(result);
      input.value = "";
      currentResults = [];
      selectedIndex = -1;
      dropdown.style.display = "none";
    }
  }

  function hide() {
    dropdown.style.display = "none";
    currentResults = [];
    selectedIndex = -1;
  }

  function matchesIndex(i: number, lcQuery: string): boolean {
    return (
      lcTitle[i]!.includes(lcQuery) ||
      lcId[i]!.includes(lcQuery) ||
      lcPreview[i]!.includes(lcQuery) ||
      lcSummary[i]!.includes(lcQuery) ||
      lcInitialPrompt[i]!.includes(lcQuery)
    );
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function render(query: string) {
    if (!query.trim()) {
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
      currentResults = [];
      selectedIndex = -1;
      matchedCacheQuery = "";
      matchedCacheIds = new Set();
      return;
    }
    const lcQuery = query.toLowerCase();
    const matchedIds = new Set<string>();
    const visibleResults: SearchResult[] = [];
    for (let i = 0; i < graph.nodes.length; i++) {
      if (!matchesIndex(i, lcQuery)) continue;
      const node = graph.nodes[i]!;
      matchedIds.add(node.id);
      if (visibleResults.length < MAX_VISIBLE_RESULTS) {
        if (!isVisible || isVisible(node)) {
          visibleResults.push({ node, index: i });
        }
      }
    }
    matchedCacheQuery = query.trim();
    matchedCacheIds = matchedIds;
    currentResults = visibleResults;
    if (currentResults.length === 0) {
      dropdown.innerHTML = `<div style="padding:12px;opacity:0.4;font-size:12px;text-align:center;color:#${theme.fg2}">No results found</div>`;
      dropdown.style.display = "block";
      selectedIndex = -1;
      return;
    }
    dropdown.innerHTML =
      `<div style="padding:6px 12px;font-size:10px;opacity:0.5;letter-spacing:0.5px">${currentResults.length} result${currentResults.length === 1 ? "" : "s"}</div>` +
      currentResults
        .map(
          (r, ri) => `
      <div class="search-item" data-result-index="${ri}" style="
        padding: 8px 12px; cursor: pointer;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        transition: background 100ms;
      ">
        <div style="font-weight:600;color:#${theme.accent}">${escape(r.node.title || r.node.id)}</div>
        <div style="opacity:0.6;font-size:11px">${escape(r.node.id)} \u00b7 ${Math.round(r.node.duration_sec)}s</div>
        ${r.node.preview ? `<div style="opacity:0.5;font-size:10px;margin-top:2px">${escape(r.node.preview)}</div>` : ""}
      </div>
    `,
        )
        .join("");
    dropdown.style.display = "block";
    selectedIndex = -1;
    // Per-item listeners are attached once at construction via event
    // delegation (see below) — re-rendering the dropdown HTML on every
    // keystroke used to attach 3 listeners per result, which was a
    // measurable chunk of input-lag time at 50+ results.
  }

  function findItemRowFromEvent(e: Event): HTMLElement | null {
    let el = e.target as HTMLElement | null;
    while (el && el !== dropdown) {
      if (el.classList?.contains("search-item")) return el;
      el = el.parentElement;
    }
    return null;
  }
  dropdown.addEventListener("mouseover", (e) => {
    const el = findItemRowFromEvent(e);
    if (!el) return;
    const ri = Number(el.dataset.resultIndex);
    if (Number.isFinite(ri)) select(ri);
  });
  dropdown.addEventListener("mousedown", (e) => {
    const el = findItemRowFromEvent(e);
    if (!el) return;
    e.preventDefault();
    const ri = Number(el.dataset.resultIndex);
    if (Number.isFinite(ri)) commit(ri);
  });

  input.addEventListener("input", () => {
    selectedIndex = -1;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => render(input.value), 80);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hide();
      input.blur();
      return;
    }
    if (dropdown.style.display === "none") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      select(Math.min(selectedIndex + 1, currentResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      select(Math.max(selectedIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(selectedIndex >= 0 ? selectedIndex : 0);
    }
  });

  function setPanelOpen(open: boolean) {
    panelOpen = open;
    wrapper.hidden = panelOpen;
    if (!panelOpen) applyWrapperStyle();
  }

  function updateTheme(newTheme: ThemeTokens) {
    theme = newTheme;
    applyWrapperStyle();
    applyInputStyle();
    applyDropdownStyle();
  }

  function dispose() {
    if (debounceTimer) clearTimeout(debounceTimer);
    container.removeChild(wrapper);
  }

  function getMatchedNodeIds(query: string): Set<string> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return new Set();
    if (matchedCacheIds && matchedCacheQuery === normalizedQuery) {
      return new Set(matchedCacheIds);
    }
    const ids = new Set<string>();
    const lcQuery = normalizedQuery.toLowerCase();
    for (let i = 0; i < graph.nodes.length; i++) {
      if (matchesIndex(i, lcQuery)) {
        ids.add(graph.nodes[i]!.id);
      }
    }
    matchedCacheQuery = normalizedQuery;
    matchedCacheIds = ids;
    return ids;
  }

  return { updateTheme, setPanelOpen, dispose, input, getMatchedNodeIds };
}
