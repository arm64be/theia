import type { TheiaGraph } from "../data/types";
import type { ThemeTokens } from "./Theme";
import { themeBgAlpha } from "./Theme";
import { escape } from "./utils";

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
  const input = document.createElement("input");
  const dropdown = document.createElement("div");

  function applyWrapperStyle() {
    wrapper.style.cssText = `
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      z-index: 10; font: 13px/1.4 'Mondwest', var(--theia-font, ui-monospace, monospace);
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
      overflow: hidden; display: none;
      backdrop-filter: blur(6px); max-height: 240px; overflow-y: auto;
    `;
  }

  applyWrapperStyle();
  applyInputStyle();
  applyDropdownStyle();

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
    if (!clickingDropdown) list.hide();
    clickingDropdown = false;
  });

  wrapper.append(input, dropdown);
  container.appendChild(wrapper);

  function normalize(s: string) {
    return s.toLowerCase();
  }

  function matches(node: TheiaGraph["nodes"][number], query: string) {
    const q = normalize(query);
    return (
      normalize(node.title || "").includes(q) ||
      normalize(node.id).includes(q) ||
      (node.preview && normalize(node.preview).includes(q)) ||
      (node.summary && normalize(node.summary).includes(q)) ||
      (node.initial_prompt && normalize(node.initial_prompt).includes(q))
    );
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedIndex = -1;
  let currentResults: SearchResult[] = [];

  function render(query: string) {
    if (!query.trim()) {
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
      currentResults = [];
      selectedIndex = -1;
      return;
    }
    const resultByIndex = new Map<number, SearchResult>();
    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i]!;
      if (isVisible && !isVisible(node)) continue;
      if (matches(node, query)) {
        resultByIndex.set(i, { node, index: i });
      }
    }
    currentResults = Array.from(resultByIndex.values());
    if (currentResults.length === 0) {
      dropdown.innerHTML = `<div style="padding:12px;opacity:0.4;font-size:12px;text-align:center;color:#${theme.fg2}">No results found</div>`;
      dropdown.style.display = "block";
      selectedIndex = -1;
      return;
    }
    selectedIndex = Math.min(selectedIndex, currentResults.length - 1);
    dropdown.innerHTML = currentResults
      .map(
        (r, ri) => `
      <div class="search-item" data-result-index="${ri}" style="
        padding: 8px 12px; cursor: pointer;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        background: ${ri === selectedIndex ? "rgba(255,255,255,0.08)" : "transparent"};
        transition: background 100ms;
      ">
        <div style="font-weight:600;color:#${theme.accent}">${escape(r.node.title || r.node.id)}</div>
        <div style="opacity:0.6;font-size:11px">${escape(r.node.id)} \u00b7 ${Math.round(r.node.duration_sec)}s</div>
        ${r.node.preview ? `<div style="opacity:0.5;font-size:10px;margin-top:2px">${escape(r.node.preview)}</div>` : ""}
      </div>
    `,
      )
      .join("");
    for (const el of dropdown.querySelectorAll(".search-item")) {
      const item = el as HTMLElement;
      item.addEventListener("mouseenter", () => {
        const ri = Number(item.dataset.resultIndex);
        selectedIndex = ri;
        highlightSelected();
      });
      item.addEventListener("mouseleave", () => {
        selectedIndex = -1;
        highlightSelected();
      });
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const ri = Number(item.dataset.resultIndex);
        const result = currentResults[ri];
        if (result) {
          focusResult(result);
        }
      });
    }
    dropdown.style.display = "block";
  }

  function focusResult(result: SearchResult) {
    onFocus(result);
    input.value = "";
    dropdown.style.display = "none";
    currentResults = [];
    selectedIndex = -1;
  }

  function highlightSelected() {
    for (let ri = 0; ri < dropdown.children.length; ri++) {
      const child = dropdown.children[ri] as HTMLElement | null;
      if (child) {
        child.style.background =
          ri === selectedIndex ? "rgba(255,255,255,0.08)" : "transparent";
      }
    }
  }

  input.addEventListener("input", () => {
    selectedIndex = -1;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => render(input.value), 80);
  });

  input.addEventListener("keydown", (e) => {
    if (currentResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1);
      highlightSelected();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      highlightSelected();
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      focusResult(currentResults[selectedIndex]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      dropdown.style.display = "none";
      currentResults = [];
      selectedIndex = -1;
      input.blur();
    }
  });

  const list = {
    hide() {
      dropdown.style.display = "none";
      currentResults = [];
      selectedIndex = -1;
    },
  };

  function updateTheme(newTheme: ThemeTokens) {
    theme = newTheme;
    applyWrapperStyle();
    applyInputStyle();
    applyDropdownStyle();
  }

  function dispose() {
    container.removeChild(wrapper);
  }

  return { updateTheme, dispose, input };
}
