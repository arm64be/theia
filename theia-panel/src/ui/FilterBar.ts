import type { TheiaGraph } from "../data/types";
import type { ThemeTokens } from "./Theme";
import { themeBgAlpha } from "./Theme";

export function createFilterBar(
  container: HTMLElement,
  initial: Set<TheiaGraph["edges"][number]["kind"]>,
  onChange: (kinds: Set<TheiaGraph["edges"][number]["kind"]>) => void,
  theme: ThemeTokens,
) {
  const bar = document.createElement("div");
  bar.style.cssText = `
    position: absolute; top: 12px; left: 12px;
    display: flex; gap: 12px;
    padding: 8px 12px; background: ${themeBgAlpha(theme, 0.75)};
    border: 1px solid #${theme.border}; border-radius: var(--theia-radius, 6px);
    font: 12px/1.4 var(--theia-font, ui-monospace, monospace); color: #${theme.fg};
    user-select: none;
  `;
  const kinds: TheiaGraph["edges"][number]["kind"][] = [
    "memory-share",
    "cross-search",
    "tool-overlap",
  ];
  const state = new Set(initial);

  for (const kind of kinds) {
    const label = document.createElement("label");
    label.style.cssText =
      "display:flex;gap:6px;align-items:center;cursor:pointer";
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
