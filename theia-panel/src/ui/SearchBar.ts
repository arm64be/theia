import type { TheiaGraph } from "../data/types";
import { escape } from "./utils";

export interface SearchResult {
  node: TheiaGraph["nodes"][number];
  index: number;
}

export function createSearchBar(
  container: HTMLElement,
  graph: TheiaGraph,
  onFocus: (result: SearchResult) => void,
) {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    z-index: 10; font: 13px/1.4 ui-monospace, monospace;
    color: #cfd6e4; width: min(320px, 50vw);
  `;

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search sessions…";
  input.style.cssText = `
    width: 100%; box-sizing: border-box;
    padding: 8px 12px; background: rgba(10,12,20,0.85);
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    color: #cfd6e4; font: inherit; outline: none;
    backdrop-filter: blur(4px);
  `;
  input.addEventListener("focus", () => {
    input.style.borderColor = "rgba(255,196,119,0.5)";
  });

  const dropdown = document.createElement("div");
  dropdown.style.cssText = `
    position: absolute; top: calc(100% + 6px); left: 0; right: 0;
    background: rgba(10,12,20,0.95); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px; overflow: hidden; display: none;
    backdrop-filter: blur(6px); max-height: 240px; overflow-y: auto;
  `;

  let clickingDropdown = false;
  dropdown.addEventListener("mousedown", () => {
    clickingDropdown = true;
  });
  input.addEventListener("blur", () => {
    input.style.borderColor = "rgba(255,255,255,0.15)";
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
        <div style="font-weight:600;color:#ffc477">${escape(r.node.title)}</div>
        <div style="opacity:0.6;font-size:11px">${escape(r.node.id)} · ${Math.round(r.node.duration_sec)}s</div>
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

  function dispose() {
    container.removeChild(wrapper);
  }

  return { dispose, input };
}
