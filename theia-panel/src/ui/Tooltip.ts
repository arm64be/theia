import type { TheiaGraph } from "../data/types";
import type { ThemeTokens } from "./Theme";
import { themeBgAlpha } from "./Theme";
import { escape, truncate } from "./utils";

const TOOLTIP_MAX_CHARS = 180;

function renderSummaryBlock(
  node: TheiaGraph["nodes"][number],
  theme: ThemeTokens,
): string {
  if (node.summary) {
    return `<div style="margin-top:6px;padding:6px 8px;background:rgba(255,196,119,0.07);border-left:2px solid #${theme.accent};color:#${theme.fg};font-size:11px;line-height:1.45">${escape(truncate(node.summary, TOOLTIP_MAX_CHARS))}</div>`;
  }
  if (node.initial_prompt) {
    return `<div style="margin-top:6px;padding:6px 8px;background:rgba(102,217,239,0.06);border-left:2px solid #66d9ef;color:#${theme.fg2};font-size:11px;line-height:1.45"><div style="opacity:0.5;font-size:9px;letter-spacing:0.5px;margin-bottom:2px">PROMPT</div>${escape(truncate(node.initial_prompt, TOOLTIP_MAX_CHARS))}</div>`;
  }
  if (node.preview) {
    return `<div style="margin-top:6px;padding:6px 8px;background:rgba(102,217,239,0.06);border-left:2px solid #66d9ef;color:#${theme.fg2};font-size:11px;line-height:1.45"><div style="opacity:0.5;font-size:9px;letter-spacing:0.5px;margin-bottom:2px">PREVIEW</div>${escape(truncate(node.preview, TOOLTIP_MAX_CHARS))}</div>`;
  }
  return "";
}

export function createTooltip(
  container: HTMLElement,
  initialTheme: ThemeTokens,
) {
  let theme = initialTheme;
  const el = document.createElement("div");

  function applyContainerStyle() {
    el.style.cssText = `
      position: absolute; pointer-events: none;
      padding: 10px 14px; background: ${themeBgAlpha(theme, 0.92)};
      border: 1px solid #${theme.border};
      font: 12px/1.4 'Mondwest', var(--theia-font, ui-monospace, monospace); color: #${theme.fg};
      transform: translate(10px, 10px); opacity: 0; transition: opacity 120ms;
      max-width: 320px; backdrop-filter: blur(4px);
    `;
  }
  applyContainerStyle();
  container.appendChild(el);

  function show(node: TheiaGraph["nodes"][number], x: number, y: number) {
    const identity = renderSummaryBlock(node, theme);

    el.innerHTML = `
      <div style="font-weight:600;color:#${theme.accent};font-size:13px">${escape(node.title || node.id)}</div>
      <div style="opacity:0.65;color:#${theme.fg2};font-size:11px">${node.id}</div>
      <div style="margin-top:4px;opacity:0.8">${new Date(node.started_at).toLocaleString()}</div>
      <div style="opacity:0.6">${Math.round(node.duration_sec)}s · ${node.tool_count} tools · ${node.message_count ?? "?"} msgs</div>
      ${identity}
    `;
    const tooltipOffset = 10;
    el.style.left = `${Math.min(x, container.clientWidth - el.offsetWidth - tooltipOffset)}px`;
    el.style.top = `${Math.min(y, container.clientHeight - el.offsetHeight - tooltipOffset)}px`;
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
