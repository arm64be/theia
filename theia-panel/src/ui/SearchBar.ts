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

  let currentResults: SearchResult[] = [];
  let selectedIndex = -1;

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
      display: none;
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
    if (input.value.trim()) render(input.value);
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
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
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

    for (const el of dropdown.querySelectorAll<HTMLElement>(".search-item")) {
      el.addEventListener("mouseenter", () => {
        const ri = Number(el.dataset.resultIndex);
        select(ri);
      });
      el.addEventListener("mouseleave", () => {
        el.style.background = "transparent";
      });
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const ri = Number(el.dataset.resultIndex);
        commit(ri);
      });
    }
  }

  input.addEventListener("input", () => render(input.value));

  input.addEventListener("keydown", (e) => {
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
    } else if (e.key === "Escape") {
      hide();
      input.blur();
    }
  });

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
