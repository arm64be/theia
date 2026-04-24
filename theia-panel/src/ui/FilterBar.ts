import type { TheiaGraph } from "../data/types";
import type { ThemeTokens } from "./Theme";
import { themeBgAlpha } from "./Theme";

function createToggle(
  checked: boolean,
  theme: ThemeTokens,
  onToggle: (next: boolean) => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.role = "switch";
  btn.setAttribute("aria-checked", String(checked));

  const thumb = document.createElement("span");

  function applyToggleStyle() {
    const on = btn.getAttribute("aria-checked") === "true";
    btn.style.cssText = `
      position: relative; display: inline-flex; align-items: center;
      width: 36px; height: 20px; flex-shrink: 0; cursor: pointer;
      border: 1px solid ${on ? `rgba(255,255,255,0.3)` : `#${theme.border}`};
      background: ${on ? `rgba(255,255,255,0.15)` : `#${theme.bg}`};
      transition: background 150ms, border-color 150ms;
      padding: 0; outline: none;
    `;
    thumb.style.cssText = `
      pointer-events: none; display: block;
      width: 14px; height: 14px;
      background: ${on ? `#${theme.fg}` : `#${theme.fg2}`};
      transform: translateX(${on ? "16px" : "2px"});
      transition: transform 150ms, background 150ms;
    `;
  }

  btn.appendChild(thumb);
  applyToggleStyle();

  btn.onclick = () => {
    const next = btn.getAttribute("aria-checked") !== "true";
    btn.setAttribute("aria-checked", String(next));
    onToggle(next);
    applyToggleStyle();
  };

  return Object.assign(btn, { _applyStyle: applyToggleStyle });
}

export interface FilterState {
  kinds: Set<TheiaGraph["edges"][number]["kind"]>;
  model: string | null;
}

export function createFilterBar(
  container: HTMLElement,
  initial: Set<TheiaGraph["edges"][number]["kind"]>,
  graph: TheiaGraph,
  onChange: (state: FilterState) => void,
  initialTheme: ThemeTokens,
) {
  let theme = initialTheme;
  const bar = document.createElement("div");
  const toggles: Array<HTMLButtonElement & { _applyStyle: () => void }> = [];
  let select: HTMLSelectElement | null = null;
  let separator: HTMLSpanElement | null = null;

  function applyBarStyle() {
    bar.style.cssText = `
      position: absolute; top: 12px; left: 12px;
      display: flex; gap: 14px; align-items: center;
      padding: 6px 14px; background: ${themeBgAlpha(theme, 0.85)};
      border: 1px solid #${theme.border};
      font: 10px/1.4 'Mondwest', var(--theia-font, ui-monospace, monospace);
      letter-spacing: 0.1em; color: #${theme.fg}; text-transform: uppercase;
      user-select: none; backdrop-filter: blur(6px); pointer-events: none;
    `;
  }
  applyBarStyle();

  const kinds: TheiaGraph["edges"][number]["kind"][] = [
    "memory-share",
    "cross-search",
    "tool-overlap",
    "subagent",
  ];
  const state = new Set(initial);
  let selectedModel: string | null = null;

  function emitChange() {
    onChange({ kinds: new Set(state), model: selectedModel });
  }

  for (const kind of kinds) {
    const label = document.createElement("label");
    label.style.cssText = `
      display: flex; gap: 8px; align-items: center; cursor: pointer;
      transition: color 150ms; pointer-events: auto;
      color: ${state.has(kind) ? `#${theme.fg}` : `#${theme.fg2}`};
    `;
    label.onmouseenter = () => {
      label.style.color = `#${theme.accent}`;
    };
    label.onmouseleave = () => {
      const on = toggle.getAttribute("aria-checked") === "true";
      label.style.color = on ? `#${theme.fg}` : `#${theme.fg2}`;
    };

    const toggle = createToggle(state.has(kind), theme, (next) => {
      if (next) state.add(kind);
      else state.delete(kind);
      label.style.color = next ? `#${theme.fg}` : `#${theme.fg2}`;
      emitChange();
    });
    toggles.push(toggle as HTMLButtonElement & { _applyStyle: () => void });

    label.append(toggle, document.createTextNode(kind));
    bar.append(label);
  }

  let currentGraph = graph;

  function rebuildModelSelect() {
    if (separator) separator.remove();
    if (select) select.remove();
    separator = null;
    select = null;

    const models = new Set<string>();
    for (const node of currentGraph.nodes) {
      if (node.model) models.add(node.model);
    }
    if (selectedModel && !models.has(selectedModel)) {
      selectedModel = null;
      emitChange();
    }
    if (models.size <= 1) return;

    separator = document.createElement("span");
    separator.style.cssText = `width:1px;height:16px;background:#${theme.border};pointer-events:auto`;
    bar.append(separator);

    select = document.createElement("select");
    applySelectStyle();

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All Models";
    select.append(allOption);

    for (const m of Array.from(models).sort()) {
      const option = document.createElement("option");
      option.value = m;
      option.textContent = m;
      select.append(option);
    }

    if (selectedModel) select.value = selectedModel;

    select.onchange = () => {
      selectedModel = select!.value || null;
      emitChange();
    };

    bar.append(select);
  }

  function applySelectStyle() {
    if (!select) return;
    select.style.cssText = `
      pointer-events: auto; background: transparent;
      border: 1px solid #${theme.border}; color: #${theme.fg};
      font: 10px/1.4 'Mondwest', var(--theia-font, ui-monospace, monospace);
      padding: 2px 4px; cursor: pointer;
      letter-spacing: 0.05em; text-transform: uppercase;
    `;
    select.onfocus = () => {
      select!.style.borderColor = `#${theme.accent}`;
    };
    select.onblur = () => {
      select!.style.borderColor = `#${theme.border}`;
    };
  }

  rebuildModelSelect();
  container.appendChild(bar);

  function updateGraph(newGraph: TheiaGraph) {
    currentGraph = newGraph;
    rebuildModelSelect();
  }

  function updateTheme(newTheme: ThemeTokens) {
    theme = newTheme;
    applyBarStyle();
    for (const t of toggles) t._applyStyle();
    applySelectStyle();
  }

  return {
    updateTheme,
    updateGraph,
    dispose: () => container.removeChild(bar),
  };
}
