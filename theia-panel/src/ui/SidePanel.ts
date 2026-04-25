import type { TheiaGraph } from "../data/types";
import type { ThemeTokens } from "./Theme";
import { themeBgAlpha } from "./Theme";
import { escape, truncate } from "./utils";

const SUMMARY_MAX_CHARS = 280;

/** Approximate the dashboard's `bg-card` pattern: blend midground into bg at 4%. */
function cardBg(t: ThemeTokens): string {
  const parse = (hex: string): [number, number, number] => {
    const h = hex.replace(/^#/, "");
    return [
      parseInt(h.slice(0, 2), 16) || 0,
      parseInt(h.slice(2, 4), 16) || 0,
      parseInt(h.slice(4, 6), 16) || 0,
    ];
  };
  const [mr, mg, mb] = parse(t.midground);
  const [br, bg, bb] = parse(t.bg);
  const mix = (a: number, b: number, p: number) =>
    Math.round(a * p + b * (1 - p));
  return `rgb(${mix(mr, br, 0.04)},${mix(mg, bg, 0.04)},${mix(mb, bb, 0.04)})`;
}

/** Shared style for edge detail attribute lines. */
function detailAttrStyle(t: ThemeTokens): string {
  return `margin-top:6px;opacity:0.7;font-size:11px;color:#${t.fg2};line-height:1.5`;
}

function renderSummaryBlock(
  node: TheiaGraph["nodes"][number],
  theme: ThemeTokens,
): string {
  if (node.summary) {
    return `<div style="margin-top:10px;padding:10px;background:${cardBg(theme)};border-left:2px solid #${theme.accent};color:#${theme.fg};font-size:12px;line-height:1.5">${escape(node.summary)}</div>`;
  }
  if (node.initial_prompt) {
    return `<div style="margin-top:10px;padding:10px;background:${cardBg(theme)};border-left:2px solid #${theme.accent};color:#${theme.fg2};font-size:12px;line-height:1.5"><div style="opacity:0.6;font-size:10px;letter-spacing:0.5px;margin-bottom:4px">INITIAL PROMPT</div>${escape(truncate(node.initial_prompt, SUMMARY_MAX_CHARS))}</div>`;
  }
  if (node.preview) {
    return `<div style="margin-top:10px;padding:10px;background:${cardBg(theme)};border-left:2px solid #${theme.accent};color:#${theme.fg2};font-size:12px;line-height:1.5"><div style="opacity:0.6;font-size:10px;letter-spacing:0.5px;margin-bottom:4px">PREVIEW</div>${escape(truncate(node.preview, SUMMARY_MAX_CHARS))}</div>`;
  }
  return "";
}

export function createSidePanel(
  container: HTMLElement,
  initialTheme: ThemeTokens,
  onNavigate?: (nodeId: string) => void,
) {
  let theme = initialTheme;
  const el = document.createElement("aside");
  let currentId: string | null = null;

  function applyPanelStyle() {
    el.style.cssText = `
      position: absolute; top: 0; right: 0; bottom: 0; width: min(420px, 45vw);
      background: ${themeBgAlpha(theme, 0.95)}; border-left: 1px solid #${theme.border};
      color: #${theme.fg}; font: 13px/1.6 var(--theia-font, system-ui, -apple-system, sans-serif);
      transform: translateX(${currentId ? "0" : "100%"}); transition: transform 220ms ease-out;
      padding: 20px 22px; overflow-y: auto; overscroll-behavior: contain;
      box-sizing: border-box; outline: none;
    `;
  }
  applyPanelStyle();
  el.tabIndex = -1;
  container.appendChild(el);

  const focusStyle = document.createElement("style");
  focusStyle.textContent = `aside:focus-visible { outline: 1px solid #${theme.accent} !important; }`;
  document.head.appendChild(focusStyle);

  let lastNode: TheiaGraph["nodes"][number] | null = null;
  let lastEdges: TheiaGraph["edges"] = [];

  function scrollTop() {
    requestAnimationFrame(() => {
      el.scrollTop = 0;
    });
  }

  function show(
    node: TheiaGraph["nodes"][number],
    relatedEdges: TheiaGraph["edges"],
  ) {
    currentId = node.id;
    lastNode = node;
    lastEdges = relatedEdges;
    renderContent();
    el.style.transform = "translateX(0)";
    el.focus({ preventScroll: true });
    scrollTop();
  }

  function handleNavClick(targetId: string) {
    if (onNavigate) {
      onNavigate(targetId);
    }
  }

  function onNavKeyDown(e: KeyboardEvent, targetId: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleNavClick(targetId);
    }
  }

  function renderContent() {
    if (!lastNode) return;
    const node = lastNode;
    const relatedEdges = lastEdges;

    const headerSummary = renderSummaryBlock(node, theme);

    const dtStyle = `opacity:0.6;color:#${theme.fg2};letter-spacing:0.04em;text-transform:uppercase;font-size:10px`;

    el.innerHTML = `
      <button aria-label="close" id="sv-close"
        style="position:absolute;top:10px;right:14px;background:none;border:none;color:#${theme.fg2};font-size:16px;cursor:pointer;opacity:0.5">×</button>
      <h3 style="margin:0 30px 2px 0;color:#${theme.accent};font-size:15px;letter-spacing:0.02em">${escape(node.title || node.id)}</h3>
      <div style="opacity:0.5;color:#${theme.fg2};margin-bottom:2px;font-size:11px">${node.id}</div>
      ${headerSummary}
      <dl style="margin:14px 0 0;display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px">
        <dt style="${dtStyle}">Started</dt><dd style="margin:0">${new Date(node.started_at).toLocaleString()}</dd>
        <dt style="${dtStyle}">Duration</dt><dd style="margin:0">${Math.round(node.duration_sec)}s</dd>
        <dt style="${dtStyle}">Model</dt><dd style="margin:0">${escape(node.model ?? "-")}</dd>
        <dt style="${dtStyle}">Tools</dt><dd style="margin:0">${node.tool_count}</dd>
        <dt style="${dtStyle}">Messages</dt><dd style="margin:0">${node.message_count ?? "-"}</dd>
      </dl>
      <div style="margin:20px 0 0;border-top:1px solid #${theme.border}"></div>
      <h4 style="margin:10px 0 8px;font-size:10px;letter-spacing:0.12em;opacity:0.5;text-transform:uppercase">Connections</h4>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${relatedEdges.length === 0 ? '<div style="opacity:0.5;font-size:11px">No connections</div>' : relatedEdges.map((e) => renderEdge(node, e, theme, !!onNavigate)).join("")}
      </div>
    `;
    (el.querySelector("#sv-close") as HTMLButtonElement).onclick = hide;
  }

  el.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement).closest("[data-navigate-to]");
    if (link) {
      const targetId = (link as HTMLElement).dataset.navigateTo!;
      handleNavClick(targetId);
    }
  });

  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hide();
      return;
    }
    const link = (e.target as HTMLElement).closest("[data-navigate-to]");
    if (link) {
      const targetId = (link as HTMLElement).dataset.navigateTo!;
      onNavKeyDown(e, targetId);
    }
  });

  el.addEventListener("focusin", (e) => {
    const link = (e.target as HTMLElement).closest("[data-navigate-to]");
    if (link) {
      (link as HTMLElement).style.outline = "1px solid";
      (link as HTMLElement).style.outlineColor = `#${theme.accent}`;
    }
  });

  el.addEventListener("focusout", (e) => {
    const link = (e.target as HTMLElement).closest("[data-navigate-to]");
    if (link) {
      (link as HTMLElement).style.outline = "none";
    }
  });

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
  hasNav: boolean,
): string {
  const isSource = e.source === node.id;
  const otherId = isSource ? e.target : e.source;
  const direction = isSource ? "\u2192" : "\u2190";
  const ev = (e.evidence ?? {}) as Record<string, unknown>;
  const color = `#${theme.accent}`;

  let detail = "";
  if (e.kind === "memory-share") {
    const memId = ev.memory_id;
    const salience = ev.salience;
    const readCount = ev.read_count;
    detail = `<div style="${detailAttrStyle(theme)}">
      memory: <span style="color:#${theme.accent}">${escape(String(memId ?? "?"))}</span>
      ${salience !== undefined ? `\u00b7 salience ${Number(salience).toFixed(2)}` : ""}
      ${readCount !== undefined ? `\u00b7 reads ${readCount}` : ""}
    </div>`;
  } else if (e.kind === "cross-search") {
    const query = ev.query;
    const hitRank = ev.hit_rank;
    const hits = ev.hits;
    detail = `<div style="${detailAttrStyle(theme)}">
      query: <span style="color:#${theme.accent}">${escape(String(query ?? "?"))}</span>
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
      detail = `<div style="${detailAttrStyle(theme)}">
        shared: ${sharedTools.map((t: string) => `<span style="color:#${theme.accent}">${escape(t)}</span>`).join(" ")}
        ${jaccard !== undefined ? `\u00b7 jaccard ${Number(jaccard).toFixed(2)}` : ""}
      </div>`;
    } else if (skillName) {
      detail = `<div style="${detailAttrStyle(theme)}">
        skill: <span style="color:#${theme.accent}">${escape(String(skillName))}</span>
        ${linkType ? `\u00b7 ${escape(String(linkType))}` : ""}
      </div>`;
    } else if (webKey) {
      detail = `<div style="${detailAttrStyle(theme)}">
        web: <span style="color:#${theme.accent}">${escape(String(webKey))}</span>
      </div>`;
    }
  } else if (e.kind === "subagent") {
    const isChild = node.id === e.target;
    const label = isChild ? "parent" : "child";
    const displayId = isChild ? e.source : ev.child_session_id;
    detail = `<div style="${detailAttrStyle(theme)}">
      ${label}: <span style="color:#${theme.accent}">${escape(String(displayId ?? "?"))}</span>
    </div>`;
  }

  return `
    <div style="padding:12px;background:${cardBg(theme)};border:1px solid #${theme.border}">
      <div style="display:flex;align-items:center;gap:8px;font-size:11px">
        <span style="width:7px;height:7px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
        <span style="border:1px solid #${theme.border};padding:1px 7px;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#${theme.fg2};line-height:1.4">${e.kind}</span>
        <span style="opacity:0.35">${direction}</span>
        <span ${hasNav ? `data-navigate-to="${escape(otherId)}" tabindex="0" role="link"` : ""}
          style="cursor:${hasNav ? "pointer" : "default"};border-bottom:1px dashed rgba(255,255,255,0.2);${hasNav ? "outline:none" : ""};opacity:0.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px"
          ${hasNav ? `title="Navigate to session"` : ""}>${escape(otherId)}</span>
        <span style="margin-left:auto;opacity:0.35;font-size:10px;letter-spacing:0.04em" title="Edge weight">w=${e.weight.toFixed(2)}</span>
      </div>
      ${detail}
    </div>
  `;
}
