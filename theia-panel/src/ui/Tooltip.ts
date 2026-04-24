import type { TheiaGraph } from "../data/types";
import type { ThemeTokens } from "./Theme";
import { themeBgAlpha } from "./Theme";

export function createTooltip(
  container: HTMLElement,
  initialTheme: ThemeTokens,
) {
  let theme = initialTheme;
  const el = document.createElement("div");

  function applyContainerStyle() {
    el.style.cssText = `
      position: absolute; pointer-events: none;
      padding: 8px 12px; background: ${themeBgAlpha(theme, 0.92)};
      border: 1px solid #${theme.border}; border-radius: var(--theia-radius, 6px);
      font: 12px/1.4 var(--theia-font, ui-monospace, monospace); color: #${theme.fg};
      transform: translate(8px, 8px); opacity: 0; transition: opacity 120ms;
      max-width: 280px;
    `;
  }
  applyContainerStyle();
  container.appendChild(el);

  function show(node: TheiaGraph["nodes"][number], x: number, y: number) {
    el.innerHTML = `
      <div style="font-weight:600;color:#${theme.accent}">${escape(node.title)}</div>
      <div style="opacity:0.7;color:#${theme.fg2}">${node.id}</div>
      <div style="margin-top:4px">${new Date(node.started_at).toLocaleString()}</div>
      <div>${Math.round(node.duration_sec)}s · ${node.tool_count} tools</div>
    `;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.opacity = "1";
  }

  function hide() {
    el.style.opacity = "0";
  }
  function updateTheme(newTheme: ThemeTokens) {
    theme = newTheme;
    const wasVisible = el.style.opacity === "1";
    applyContainerStyle();
    if (wasVisible) el.style.opacity = "1";
  }
  function dispose() {
    container.removeChild(el);
  }

  return { show, hide, updateTheme, dispose };
}

function escape(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}
