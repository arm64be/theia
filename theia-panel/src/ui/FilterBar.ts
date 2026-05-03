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

export interface FilterBarOptions {
  initialModel?: string | null;
  onSearchToggle?: () => void;
  onFocusToggle?: (enabled: boolean) => void;
  initialFocusEnabled?: boolean;
  onSearchFocusToggle?: (enabled: boolean) => void;
  initialSearchFocusEnabled?: boolean;
  onHideOrphansToggle?: (enabled: boolean) => void;
  initialHideOrphansEnabled?: boolean;
  onComponentFocusToggle?: (enabled: boolean) => void;
  initialComponentFocusEnabled?: boolean;
}

export function createFilterBar(
  container: HTMLElement,
  initial: Set<TheiaGraph["edges"][number]["kind"]>,
  graph: TheiaGraph,
  onChange: (state: FilterState) => void,
  initialTheme: ThemeTokens,
  options: FilterBarOptions = {},
) {
  const {
    initialModel,
    onSearchToggle,
    onFocusToggle,
    initialFocusEnabled,
    onSearchFocusToggle,
    initialSearchFocusEnabled,
    onHideOrphansToggle,
    initialHideOrphansEnabled,
    onComponentFocusToggle,
    initialComponentFocusEnabled,
  } = options;
  let theme = initialTheme;
  const bar = document.createElement("div");
  bar.dataset.uiOverlay = "";
  const content = document.createElement("div");
  const toggles: Array<HTMLButtonElement & { _applyStyle: () => void }> = [];
  let select: HTMLSelectElement | null = null;
  let dropdownOpen = false;
  let showSearchToggle = false;
  let focusEnabled = initialFocusEnabled ?? false;
  let searchFocusEnabled = initialSearchFocusEnabled ?? false;
  let hideOrphansEnabled = initialHideOrphansEnabled ?? false;
  let componentFocusEnabled = initialComponentFocusEnabled ?? false;

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
        const el = child as HTMLElement;
        if (el.dataset.focusToggle === "true") continue;
        const kind = el.dataset.kind;
        el.style.cssText = `
          display: flex; gap: 10px; align-items: center; cursor: pointer;
          transition: color 100ms;
          color: ${kind && state.has(kind as TheiaGraph["edges"][number]["kind"]) ? `#${theme.fg}` : `#${theme.fg2}`};
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

    label.dataset.kind = kind;
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
    document.removeEventListener("pointerdown", onDocumentClick);
    applyBarStyle();
  }

  btn.onclick = () => {
    dropdownOpen = !dropdownOpen;
    if (dropdownOpen) {
      document.addEventListener("pointerdown", onDocumentClick);
    } else {
      document.removeEventListener("pointerdown", onDocumentClick);
    }
    applyBarStyle();
  };

  searchToggle.onclick = () => onSearchToggle?.();

  function onDocumentClick(e: PointerEvent) {
    if (!bar.contains(e.target as Node)) {
      closeDropdown();
    }
  }

  let currentGraph = graph;

  function rebuildModelSelect() {
    if (select) select.remove();
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

  let focusToggleEl: HTMLLabelElement | null = null;
  let focusCb: HTMLInputElement | null = null;
  let searchFocusToggleEl: HTMLLabelElement | null = null;
  let searchFocusCb: HTMLInputElement | null = null;
  let hideOrphansToggleEl: HTMLLabelElement | null = null;
  let hideOrphansCb: HTMLInputElement | null = null;
  let componentFocusToggleEl: HTMLLabelElement | null = null;
  let componentFocusCb: HTMLInputElement | null = null;

  function applyFocusToggleStyle() {
    if (!focusToggleEl || !focusCb) return;
    focusToggleEl.style.cssText = `
      display: flex; gap: 10px; align-items: center; cursor: pointer;
      letter-spacing: 0.05em;
      color: ${focusEnabled ? `#${theme.fg}` : `#${theme.fg2}`};
      margin-top: 8px; padding-top: 8px;
      border-top: 1px solid #${theme.border};
    `;
    focusCb.style.cssText = `
      appearance: none; width: 14px; height: 14px; margin: 0; flex-shrink: 0;
      border: 1px solid #${theme.border};
      border-radius: ${theme.radius};
      background: ${focusEnabled ? `#${theme.accent}` : `#${theme.bg}`};
      cursor: pointer; transition: background .15s, border-color .15s;
    `;
    focusToggleEl.style.color = focusEnabled ? `#${theme.fg}` : `#${theme.fg2}`;
  }

  function applySearchFocusToggleStyle() {
    if (!searchFocusToggleEl || !searchFocusCb) return;
    searchFocusToggleEl.style.color = searchFocusEnabled
      ? `#${theme.fg}`
      : `#${theme.fg2}`;
    searchFocusCb.style.borderColor = `#${theme.border}`;
    searchFocusCb.style.borderRadius = theme.radius;
    searchFocusCb.style.background = searchFocusEnabled
      ? `#${theme.accent}`
      : `#${theme.bg}`;
  }

  function applyPlainCheckboxStyle(
    label: HTMLLabelElement | null,
    cb: HTMLInputElement | null,
    enabled: boolean,
  ) {
    if (!label || !cb) return;
    label.style.color = enabled ? `#${theme.fg}` : `#${theme.fg2}`;
    cb.style.borderColor = `#${theme.border}`;
    cb.style.borderRadius = theme.radius;
    cb.style.background = enabled ? `#${theme.accent}` : `#${theme.bg}`;
  }

  function applyHideOrphansToggleStyle() {
    applyPlainCheckboxStyle(
      hideOrphansToggleEl,
      hideOrphansCb,
      hideOrphansEnabled,
    );
  }

  function applyComponentFocusToggleStyle() {
    applyPlainCheckboxStyle(
      componentFocusToggleEl,
      componentFocusCb,
      componentFocusEnabled,
    );
  }

  function initFocusToggle() {
    focusToggleEl = document.createElement("label");
    focusToggleEl.dataset.focusToggle = "true";
    focusCb = document.createElement("input");
    focusCb.type = "checkbox";
    focusCb.checked = focusEnabled;
    focusCb.onchange = () => {
      focusEnabled = focusCb!.checked;
      applyFocusToggleStyle();
      onFocusToggle?.(focusEnabled);
    };
    focusToggleEl.append(
      focusCb,
      document.createTextNode("Focus on connected nodes"),
    );
    applyFocusToggleStyle();
    content.append(focusToggleEl);
  }

  function initSearchFocusToggle() {
    searchFocusToggleEl = document.createElement("label");
    searchFocusToggleEl.style.cssText = `
      display: flex; gap: 10px; align-items: center; cursor: pointer;
      letter-spacing: 0.05em;
    `;
    searchFocusCb = document.createElement("input");
    searchFocusCb.type = "checkbox";
    searchFocusCb.checked = searchFocusEnabled;
    searchFocusCb.style.cssText = `
      appearance: none; width: 14px; height: 14px; margin: 0; flex-shrink: 0;
      border: 1px solid;
      cursor: pointer; transition: background .15s, border-color .15s;
    `;
    searchFocusCb.onchange = () => {
      searchFocusEnabled = searchFocusCb!.checked;
      applySearchFocusToggleStyle();
      onSearchFocusToggle?.(searchFocusEnabled);
    };
    searchFocusToggleEl.append(
      searchFocusCb,
      document.createTextNode("Focus on search"),
    );
    applySearchFocusToggleStyle();
    content.append(searchFocusToggleEl);
  }

  function initHideOrphansToggle() {
    hideOrphansToggleEl = document.createElement("label");
    hideOrphansToggleEl.style.cssText = `
      display: flex; gap: 10px; align-items: center; cursor: pointer;
      letter-spacing: 0.05em;
    `;
    hideOrphansCb = document.createElement("input");
    hideOrphansCb.type = "checkbox";
    hideOrphansCb.checked = hideOrphansEnabled;
    hideOrphansCb.style.cssText = `
      appearance: none; width: 14px; height: 14px; margin: 0; flex-shrink: 0;
      border: 1px solid;
      cursor: pointer; transition: background .15s, border-color .15s;
    `;
    hideOrphansCb.onchange = () => {
      hideOrphansEnabled = hideOrphansCb!.checked;
      applyHideOrphansToggleStyle();
      onHideOrphansToggle?.(hideOrphansEnabled);
    };
    hideOrphansToggleEl.append(
      hideOrphansCb,
      document.createTextNode("Hide orphans"),
    );
    applyHideOrphansToggleStyle();
    content.append(hideOrphansToggleEl);
  }

  function initComponentFocusToggle() {
    componentFocusToggleEl = document.createElement("label");
    componentFocusToggleEl.style.cssText = `
      display: flex; gap: 10px; align-items: center; cursor: pointer;
      letter-spacing: 0.05em;
    `;
    componentFocusCb = document.createElement("input");
    componentFocusCb.type = "checkbox";
    componentFocusCb.checked = componentFocusEnabled;
    componentFocusCb.style.cssText = `
      appearance: none; width: 14px; height: 14px; margin: 0; flex-shrink: 0;
      border: 1px solid;
      cursor: pointer; transition: background .15s, border-color .15s;
    `;
    componentFocusCb.onchange = () => {
      componentFocusEnabled = componentFocusCb!.checked;
      applyComponentFocusToggleStyle();
      onComponentFocusToggle?.(componentFocusEnabled);
    };
    componentFocusToggleEl.append(
      componentFocusCb,
      document.createTextNode("Focus on component"),
    );
    applyComponentFocusToggleStyle();
    content.append(componentFocusToggleEl);
  }

  applyBarStyle();
  dropdown.appendChild(content);
  bar.append(btn, searchToggle, dropdown);
  rebuildModelSelect();
  initFocusToggle();
  if (onSearchFocusToggle) initSearchFocusToggle();
  if (onHideOrphansToggle) initHideOrphansToggle();
  if (onComponentFocusToggle) initComponentFocusToggle();
  container.appendChild(bar);

  function setSearchToggleVisible(visible: boolean) {
    showSearchToggle = visible;
    applyBarStyle();
  }

  function updateGraph(newGraph: TheiaGraph) {
    currentGraph = newGraph;
    rebuildModelSelect();
  }

  function setFocusEnabled(enabled: boolean) {
    focusEnabled = enabled;
    if (focusCb) {
      focusCb.checked = enabled;
    }
    applyFocusToggleStyle();
  }

  function setSearchFocusEnabled(enabled: boolean) {
    searchFocusEnabled = enabled;
    if (searchFocusCb) {
      searchFocusCb.checked = enabled;
    }
    applySearchFocusToggleStyle();
  }

  function setHideOrphansEnabled(enabled: boolean) {
    hideOrphansEnabled = enabled;
    if (hideOrphansCb) {
      hideOrphansCb.checked = enabled;
    }
    applyHideOrphansToggleStyle();
  }

  function setComponentFocusEnabled(enabled: boolean) {
    componentFocusEnabled = enabled;
    if (componentFocusCb) {
      componentFocusCb.checked = enabled;
    }
    applyComponentFocusToggleStyle();
  }

  function updateTheme(newTheme: ThemeTokens) {
    theme = newTheme;
    applyBarStyle();
    for (const t of toggles) t._applyStyle();
    applySelectStyle();
    applyFocusToggleStyle();
    applySearchFocusToggleStyle();
    applyHideOrphansToggleStyle();
    applyComponentFocusToggleStyle();
  }

  return {
    updateTheme,
    updateGraph,
    setSearchToggleVisible,
    setFocusEnabled,
    setSearchFocusEnabled,
    setHideOrphansEnabled,
    setComponentFocusEnabled,
    dispose: () => {
      document.removeEventListener("pointerdown", onDocumentClick);
      container.removeChild(bar);
    },
  };
}
