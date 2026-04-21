import type { TheiaGraph } from "../data/types";

export function createFilterBar(
  container: HTMLElement,
  initial: Set<TheiaGraph["edges"][number]["kind"]>,
  onChange: (kinds: Set<TheiaGraph["edges"][number]["kind"]>) => void,
) {
  const bar = document.createElement("div");
  bar.style.cssText = `
    position: absolute; top: 12px; left: 12px;
    display: flex; gap: 12px;
    padding: 8px 12px; background: rgba(10,12,20,0.7);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
    font: 12px/1.4 ui-monospace, monospace; color: #cfd6e4;
    user-select: none;
  `;
  const kinds: TheiaGraph["edges"][number]["kind"][] = ["memory-share", "cross-search", "tool-overlap"];
  const state = new Set(initial);

  for (const kind of kinds) {
    const label = document.createElement("label");
    label.style.cssText = "display:flex;gap:6px;align-items:center;cursor:pointer";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.has(kind);
    cb.onchange = () => {
      if (cb.checked) state.add(kind);
      else state.delete(kind);
      onChange(new Set(state));
    };
    label.append(cb, document.createTextNode(kind));
    bar.append(label);
  }

  container.appendChild(bar);
  return { dispose: () => container.removeChild(bar) };
}
