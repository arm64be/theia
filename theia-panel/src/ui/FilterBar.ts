import type { TheiaGraph } from "../data/types";
import type { ThemeTokens } from "./Theme";
import { themeBgAlpha, FONT_STACK } from "./Theme";

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
      transition: background 100ms, border-color 100ms;
      padding: 0; outline: none;
    `;
    thumb.style.cssText = `
      pointer-events: none; display: block;
      width: 14px; height: 14px;
      background: ${on ? `#${theme.fg}` : `#${theme.fg2}`};
      transform: translateX(${on ? "16px" : "2px"});
      transition: transform 100ms, background 100ms;
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
  initialModel?: string | null,
  onSearchToggle?: () => void,
) {
  let theme = initialTheme;
  const bar = document.createElement("div");
  bar.dataset.uiOverlay = "";
  const content = document.createElement("div");
  const toggles: Array<HTMLButtonElement & { _applyStyle: () => void }> = [];
  let select: HTMLSelectElement | null = null;
  let separator: HTMLSpanElement | null = null;
  let dropdownOpen = false;
  let showSearchToggle = false;

  const btn = document.createElement("button");
  btn.textContent = "Filters";

  const searchToggle = document.createElement("button");
  searchToggle.textContent = "\u2315";

  const dropdown = document.createElement("div");

  function applyBarStyle() {
    bar.style.cssText = `
      position: absolute; top: 12px; left: 12px; z-index: 13;
      display: flex; flex-direction: row; align-items: stretch;
    `;
    const bgAlpha = dropdownOpen ? 0.95 : 0.85;
    const borderColor = dropdownOpen ? theme.accent : theme.border;
    btn.style.cssText = `
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px;
      background: ${themeBgAlpha(theme, bgAlpha)};
      border: 1px solid #${borderColor};
      color: #${theme.fg};
      font: 10px/1.4 var(--theia-font, ${FONT_STACK});
      letter-spacing: 0.05em;
      cursor: pointer;
      user-select: none;
      backdrop-filter: blur(6px);
      text-transform: uppercase;
      transition: background 100ms, border-color 100ms;
    `;
    searchToggle.style.cssText = `
      display: ${showSearchToggle ? "inline-flex" : "none"};
      align-items: center; justify-content: center;
      width: 28px;
      margin-left: 4px;
      padding: 6px 0;
      background: ${themeBgAlpha(theme, 0.85)};
      border: 1px solid #${theme.border};
      color: #${theme.fg};
      font: 10px/1.4 var(--theia-font, ${FONT_STACK});
      cursor: pointer;
      user-select: none;
      outline: none;
      backdrop-filter: blur(6px);
      transition: background 100ms, border-color 100ms;
    `;
    dropdown.style.cssText = `
      position: absolute; top: calc(100% + 4px); left: 0;
      background: ${themeBgAlpha(theme, 0.95)};
      border: 1px solid #${theme.border};
      backdrop-filter: blur(6px);
      padding: 10px 14px;
      min-width: 190px;
      display: ${dropdownOpen ? "block" : "none"};
    `;
    content.style.cssText = `
      display: flex; flex-direction: column; gap: 8px;
      font: 10px/1.4 var(--theia-font, ${FONT_STACK});
      letter-spacing: 0.05em;
      color: #${theme.fg};
    `;
    for (const child of content.children) {
      if (child.tagName === "LABEL") {
        (child as HTMLElement).style.cssText = `
          display: flex; gap: 10px; align-items: center; cursor: pointer;
          transition: color 100ms;
        `;
      }
    }
  }

  const kinds: TheiaGraph["edges"][number]["kind"][] = [
    "memory-share",
    "cross-search",
    "tool-overlap",
    "subagent",
    "cron-chain",
  ];
  const kindLabels = {
    "memory-share": "Memory Share",
    "cross-search": "Cross Search",
    "tool-overlap": "Tool Overlap",
    subagent: "Subagent",
    "cron-chain": "Cron Chain",
  } satisfies Record<TheiaGraph["edges"][number]["kind"], string>;
  const state = new Set(initial);
  let selectedModel: string | null = initialModel ?? null;

  function emitChange() {
    onChange({ kinds: new Set(state), model: selectedModel });
  }

  for (const kind of kinds) {
    const label = document.createElement("label");
    label.style.cssText = `
      display: flex; gap: 10px; align-items: center; cursor: pointer;
      transition: color 100ms;
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

    label.append(toggle, document.createTextNode(kindLabels[kind] ?? kind));
    content.append(label);
  }

  function closeDropdown() {
    if (!dropdownOpen) return;
    dropdownOpen = false;
    applyBarStyle();
  }

  btn.onclick = () => {
    dropdownOpen = !dropdownOpen;
    applyBarStyle();
  };

  searchToggle.onclick = () => onSearchToggle?.();

  function onDocumentClick(e: MouseEvent) {
    if (dropdownOpen && !bar.contains(e.target as Node)) {
      closeDropdown();
    }
  }
  document.addEventListener("click", onDocumentClick);

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

    content.append(select);
  }

  function applySelectStyle() {
    if (!select) return;
    select.style.cssText = `
      pointer-events: auto; background: transparent;
      border: 1px solid #${theme.border}; color: #${theme.fg};
      font: 10px/1.4 var(--theia-font, ${FONT_STACK});
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

  applyBarStyle();
  dropdown.appendChild(content);
  bar.append(btn, searchToggle, dropdown);
  rebuildModelSelect();
  container.appendChild(bar);

  function setSearchToggleVisible(visible: boolean) {
    showSearchToggle = visible;
    applyBarStyle();
  }

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
    setSearchToggleVisible,
    dispose: () => {
      document.removeEventListener("click", onDocumentClick);
      container.removeChild(bar);
    },
  };
}
