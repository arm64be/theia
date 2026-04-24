import type { TheiaGraph } from "../data/types";
import type { ThemeTokens } from "./Theme";
import { themeBgAlpha } from "./Theme";
import { escape, truncate } from "./utils";

const SUMMARY_MAX_CHARS = 280;

function renderSummaryBlock(
  node: TheiaGraph["nodes"][number],
  theme: ThemeTokens,
): string {
  if (node.summary) {
    return `<div style="margin-top:10px;padding:10px;background:rgba(255,196,119,0.08);border-left:2px solid #${theme.accent};color:#${theme.fg};font-size:12px;line-height:1.5">${escape(node.summary)}</div>`;
  }
  if (node.initial_prompt) {
    return `<div style="margin-top:10px;padding:10px;background:rgba(102,217,239,0.06);border-left:2px solid #66d9ef;color:#${theme.fg2};font-size:12px;line-height:1.5"><div style="opacity:0.6;font-size:10px;letter-spacing:0.5px;margin-bottom:4px">INITIAL PROMPT</div>${escape(truncate(node.initial_prompt, SUMMARY_MAX_CHARS))}</div>`;
  }
  if (node.preview) {
    return `<div style="margin-top:10px;padding:10px;background:rgba(102,217,239,0.06);border-left:2px solid #66d9ef;color:#${theme.fg2};font-size:12px;line-height:1.5"><div style="opacity:0.6;font-size:10px;letter-spacing:0.5px;margin-bottom:4px">PREVIEW</div>${escape(truncate(node.preview, SUMMARY_MAX_CHARS))}</div>`;
  }
  return "";
}

export function createSidePanel(
  container: HTMLElement,
  initialTheme: ThemeTokens,
) {
  let theme = initialTheme;
  const el = document.createElement("aside");
  let currentId: string | null = null;

  function applyPanelStyle() {
    el.style.cssText = `
      position: absolute; top: 0; right: 0; bottom: 0; width: min(420px, 45vw);
      background: ${themeBgAlpha(theme, 0.95)}; border-left: 1px solid #${theme.border};
      color: #${theme.fg}; font: 13px/1.5 'Mondwest', var(--theia-font, ui-monospace, monospace);
      transform: translateX(${currentId ? "0" : "100%"}); transition: transform 220ms ease-out;
      padding: 20px 22px; overflow-y: auto; overscroll-behavior: contain;
      box-sizing: border-box;
    `;
  }
  applyPanelStyle();
  container.appendChild(el);

  let lastNode: TheiaGraph["nodes"][number] | null = null;
  let lastEdges: TheiaGraph["edges"] = [];

  function show(
    node: TheiaGraph["nodes"][number],
    relatedEdges: TheiaGraph["edges"],
  ) {
    currentId = node.id;
    lastNode = node;
    lastEdges = relatedEdges;
    renderContent();
    el.style.transform = "translateX(0)";
  }

  function renderContent() {
    if (!lastNode) return;
    const node = lastNode;
    const relatedEdges = lastEdges;

    const headerSummary = renderSummaryBlock(node, theme);

    el.innerHTML = `
      <button aria-label="close" id="sv-close"
        style="position:absolute;top:10px;right:14px;background:none;border:none;color:#${theme.fg};font-size:18px;cursor:pointer">×</button>
      <h3 style="margin:0 0 2px;color:#${theme.accent};font-size:16px">${escape(node.title || node.id)}</h3>
      <div style="opacity:0.55;color:#${theme.fg2};margin-bottom:2px;font-size:11px">${node.id}</div>
      ${headerSummary}
      <dl style="margin:14px 0 0;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px">
        <dt style="opacity:0.6;color:#${theme.fg2}">Started</dt><dd style="margin:0">${new Date(node.started_at).toLocaleString()}</dd>
        <dt style="opacity:0.6;color:#${theme.fg2}">Duration</dt><dd style="margin:0">${Math.round(node.duration_sec)}s</dd>
        <dt style="opacity:0.6;color:#${theme.fg2}">Model</dt><dd style="margin:0">${escape(node.model ?? "-")}</dd>
        <dt style="opacity:0.6;color:#${theme.fg2}">Tools</dt><dd style="margin:0">${node.tool_count}</dd>
        <dt style="opacity:0.6;color:#${theme.fg2}">Messages</dt><dd style="margin:0">${node.message_count ?? "-"}</dd>
      </dl>
      <h4 style="margin:20px 0 8px;font-size:11px;letter-spacing:0.6px;opacity:0.7;text-transform:uppercase">Connections</h4>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${relatedEdges.length === 0 ? '<div style="opacity:0.4;font-size:12px">No connections</div>' : relatedEdges.map((e) => renderEdge(node, e, theme)).join("")}
      </div>
    `;
    (el.querySelector("#sv-close") as HTMLButtonElement).onclick = hide;
  }

  function hide() {
    currentId = null;
    el.style.transform = "translateX(100%)";
  }

  function currentNodeId() {
    return currentId;
  }
  function updateTheme(newTheme: ThemeTokens) {
    theme = newTheme;
    applyPanelStyle();
    if (currentId && lastNode) {
      renderContent();
    }
  }
  function dispose() {
    container.removeChild(el);
  }

  return { show, hide, currentNodeId, updateTheme, dispose };
}

function renderEdge(
  node: TheiaGraph["nodes"][number],
  e: TheiaGraph["edges"][number],
  theme: ThemeTokens,
): string {
  const isSource = e.source === node.id;
  const otherId = isSource ? e.target : e.source;
  const direction = isSource ? "\u2192" : "\u2190";
  const ev = (e.evidence ?? {}) as Record<string, unknown>;

  let detail = "";
  if (e.kind === "memory-share") {
    const memId = ev.memory_id;
    const salience = ev.salience;
    const readCount = ev.read_count;
    detail = `<div style="margin-top:4px;opacity:0.75;font-size:11px">
      memory: <span style="color:#${theme.accent}">${escape(String(memId ?? "?"))}</span>
      ${salience !== undefined ? `\u00b7 salience ${Number(salience).toFixed(2)}` : ""}
      ${readCount !== undefined ? `\u00b7 reads ${readCount}` : ""}
    </div>`;
  } else if (e.kind === "cross-search") {
    const query = ev.query;
    const hitRank = ev.hit_rank;
    const hits = ev.hits;
    detail = `<div style="margin-top:4px;opacity:0.75;font-size:11px">
      query: <span style="color:#66d9ef">${escape(String(query ?? "?"))}</span>
      ${hitRank !== undefined ? `\u00b7 rank #${hitRank}` : ""}
      ${hits !== undefined ? `\u00b7 ${hits} hit${Number(hits) === 1 ? "" : "s"}` : ""}
    </div>`;
  } else if (e.kind === "tool-overlap") {
    const sharedTools = ev.shared_tools;
    const jaccard = ev.jaccard;
    const skillName = ev.skill_name;
    const linkType = ev.link_type;
    const webKey = ev.web_key;
    if (sharedTools && Array.isArray(sharedTools)) {
      detail = `<div style="margin-top:4px;opacity:0.75;font-size:11px">
        shared: ${sharedTools.map((t: string) => `<span style="color:#b089ff">${escape(t)}</span>`).join(" ")}
        ${jaccard !== undefined ? `\u00b7 jaccard ${Number(jaccard).toFixed(2)}` : ""}
      </div>`;
    } else if (skillName) {
      detail = `<div style="margin-top:4px;opacity:0.75;font-size:11px">
        skill: <span style="color:#b089ff">${escape(String(skillName))}</span>
        ${linkType ? `\u00b7 ${escape(String(linkType))}` : ""}
      </div>`;
    } else if (webKey) {
      detail = `<div style="margin-top:4px;opacity:0.75;font-size:11px">
        web: <span style="color:#b089ff">${escape(String(webKey))}</span>
      </div>`;
    }
  }

  const kindColor: Record<string, string> = {
    "memory-share": "#ffb366",
    "cross-search": "#66d9ef",
    "tool-overlap": "#b089ff",
  };
  const color = kindColor[e.kind] ?? `#${theme.fg}`;

  return `
    <div style="padding:10px;background:rgba(255,255,255,0.03);border:1px solid #${theme.border}">
      <div style="display:flex;align-items:center;gap:8px;font-size:12px">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
        <span style="font-weight:600">${e.kind}</span>
        <span style="opacity:0.6">${direction}</span>
        <span>${escape(otherId)}</span>
        <span style="margin-left:auto;opacity:0.5;font-size:11px">w=${e.weight.toFixed(2)}</span>
      </div>
      ${detail}
    </div>
  `;
}
