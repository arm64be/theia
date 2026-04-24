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
) {
  let theme = initialTheme;

  const wrapper = document.createElement("div");
  const input = document.createElement("input");
  const dropdown = document.createElement("div");

  function applyWrapperStyle() {
    wrapper.style.cssText = `
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      z-index: 10; font: 13px/1.4 var(--theia-font, ui-monospace, monospace);
      color: #${theme.fg}; width: min(320px, 50vw);
    `;
  }

  function applyInputStyle() {
    input.style.cssText = `
      width: 100%; box-sizing: border-box;
      padding: 8px 12px; background: ${themeBgAlpha(theme, 0.85)};
      border: 1px solid #${theme.border}; border-radius: var(--theia-radius, 6px);
      color: #${theme.fg}; font: inherit; outline: none;
      backdrop-filter: blur(4px);
    `;
  }

  function applyDropdownStyle() {
    dropdown.style.cssText = `
      position: absolute; top: calc(100% + 6px); left: 0; right: 0;
      background: ${themeBgAlpha(theme, 0.95)}; border: 1px solid #${theme.border};
      border-radius: var(--theia-radius, 6px); overflow: hidden; display: none;
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
      normalize(node.title).includes(q) ||
      normalize(node.id).includes(q) ||
      (node.summary && normalize(node.summary).includes(q)) ||
      (node.initial_prompt && normalize(node.initial_prompt).includes(q))
    );
  }

  function render(query: string) {
    if (!query.trim()) {
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
      return;
    }
    const resultByIndex = new Map<number, SearchResult>();
    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i]!;
      if (matches(node, query)) {
        resultByIndex.set(i, { node, index: i });
      }
    }
    const results = Array.from(resultByIndex.values());
    if (results.length === 0) {
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
      return;
    }
    dropdown.innerHTML = results
      .map(
        (r) => `
      <div class="search-item" data-index="${r.index}" style="
        padding: 8px 12px; cursor: pointer;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        transition: background 100ms;
      ">
        <div style="font-weight:600;color:#${theme.accent}">${escape(r.node.title)}</div>
        <div style="opacity:0.6;font-size:11px">${escape(r.node.id)} \u00b7 ${Math.round(r.node.duration_sec)}s</div>
      </div>
    `,
      )
      .join("");
    for (const el of dropdown.querySelectorAll(".search-item")) {
      const item = el as HTMLElement;
      item.addEventListener("mouseenter", () => {
        item.style.background = "rgba(255,255,255,0.06)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "transparent";
      });
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const idx = Number(item.dataset.index);
        const result = resultByIndex.get(idx);
        if (result) {
          onFocus(result);
          input.value = "";
          dropdown.style.display = "none";
        }
      });
    }
    dropdown.style.display = "block";
  }

  input.addEventListener("input", () => render(input.value));

  const list = {
    hide() {
      dropdown.style.display = "none";
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
