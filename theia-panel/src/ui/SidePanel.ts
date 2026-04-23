import type { TheiaGraph } from "../data/types";
import { escape, truncate } from "./utils";

export function createSidePanel(container: HTMLElement) {
  const el = document.createElement("aside");
  el.style.cssText = `
    position: absolute; top: 0; right: 0; bottom: 0; width: min(420px, 45vw);
    background: rgba(10,12,20,0.95); border-left: 1px solid rgba(255,255,255,0.1);
    color: #cfd6e4; font: 13px/1.5 ui-monospace, monospace;
    transform: translateX(100%); transition: transform 220ms ease-out;
    padding: 20px 22px; overflow-y: auto; overscroll-behavior: contain;
    box-sizing: border-box;
  `;
  container.appendChild(el);

  let currentId: string | null = null;

  function show(
    node: TheiaGraph["nodes"][number],
    relatedEdges: TheiaGraph["edges"],
  ) {
    currentId = node.id;

    const headerSummary = node.summary
      ? `<div style="margin-top:10px;padding:10px;background:rgba(255,196,119,0.08);border-left:2px solid #ffc477;border-radius:0 4px 4px 0;color:#e8dcc8;font-size:12px;line-height:1.5">${escape(node.summary)}</div>`
      : node.initial_prompt
        ? `<div style="margin-top:10px;padding:10px;background:rgba(102,217,239,0.06);border-left:2px solid #66d9ef;border-radius:0 4px 4px 0;color:#b8d4e3;font-size:12px;line-height:1.5"><div style="opacity:0.6;font-size:10px;letter-spacing:0.5px;margin-bottom:4px">INITIAL PROMPT</div>${escape(truncate(node.initial_prompt, 280))}</div>`
        : "";

    el.innerHTML = `
      <button aria-label="close" id="sv-close"
        style="position:absolute;top:10px;right:14px;background:none;border:none;color:#cfd6e4;font-size:18px;cursor:pointer">×</button>
      <h3 style="margin:0 0 2px;color:#ffc477;font-size:16px">${escape(node.title)}</h3>
      <div style="opacity:0.55;margin-bottom:2px;font-size:11px">${node.id}</div>
      ${headerSummary}
      <dl style="margin:14px 0 0;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px">
        <dt style="opacity:0.6">Started</dt><dd style="margin:0">${new Date(node.started_at).toLocaleString()}</dd>
        <dt style="opacity:0.6">Duration</dt><dd style="margin:0">${Math.round(node.duration_sec)}s</dd>
        <dt style="opacity:0.6">Model</dt><dd style="margin:0">${escape(node.model ?? "-")}</dd>
        <dt style="opacity:0.6">Tools</dt><dd style="margin:0">${node.tool_count}</dd>
        <dt style="opacity:0.6">Messages</dt><dd style="margin:0">${node.message_count ?? "-"}</dd>
      </dl>
      <h4 style="margin:20px 0 8px;font-size:11px;letter-spacing:0.6px;opacity:0.7;text-transform:uppercase">Connections</h4>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${relatedEdges.length === 0 ? '<div style="opacity:0.4;font-size:12px">No connections</div>' : relatedEdges.map((e) => renderEdge(node, e)).join("")}
      </div>
    `;
    (el.querySelector("#sv-close") as HTMLButtonElement).onclick = hide;
    el.style.transform = "translateX(0)";
  }

  function hide() {
    currentId = null;
    el.style.transform = "translateX(100%)";
  }

  function currentNodeId() {
    return currentId;
  }

  function dispose() {
    container.removeChild(el);
  }

  return { show, hide, currentNodeId, dispose };
}

function renderEdge(
  node: TheiaGraph["nodes"][number],
  e: TheiaGraph["edges"][number],
): string {
  const isSource = e.source === node.id;
  const otherId = isSource ? e.target : e.source;
  const direction = isSource ? "→" : "←";
  const evidence = e.evidence ?? {};

  let detail = "";
  if (e.kind === "memory-share") {
    const memId = (evidence as Record<string, unknown>).memory_id;
    const salience = (evidence as Record<string, unknown>).salience;
    const readCount = (evidence as Record<string, unknown>).read_count;
    detail = `<div style="margin-top:4px;opacity:0.75;font-size:11px">
      memory: <span style="color:#ffc477">${escape(String(memId ?? "?"))}</span>
      ${salience !== undefined ? `· salience ${Number(salience).toFixed(2)}` : ""}
      ${readCount !== undefined ? `· reads ${readCount}` : ""}
    </div>`;
  } else if (e.kind === "cross-search") {
    const query = (evidence as Record<string, unknown>).query;
    const hitRank = (evidence as Record<string, unknown>).hit_rank;
    const hits = (evidence as Record<string, unknown>).hits;
    detail = `<div style="margin-top:4px;opacity:0.75;font-size:11px">
      query: <span style="color:#66d9ef">${escape(String(query ?? "?"))}</span>
      ${hitRank !== undefined ? `· rank #${hitRank}` : ""}
      ${hits !== undefined ? `· ${hits} hit${Number(hits) === 1 ? "" : "s"}` : ""}
    </div>`;
  } else if (e.kind === "tool-overlap") {
    const sharedTools = (evidence as Record<string, unknown>).shared_tools;
    const jaccard = (evidence as Record<string, unknown>).jaccard;
    const skillName = (evidence as Record<string, unknown>).skill_name;
    const linkType = (evidence as Record<string, unknown>).link_type;
    const webKey = (evidence as Record<string, unknown>).web_key;
    if (sharedTools && Array.isArray(sharedTools)) {
      detail = `<div style="margin-top:4px;opacity:0.75;font-size:11px">
        shared: ${sharedTools.map((t: string) => `<span style="color:#b089ff">${escape(t)}</span>`).join(" ")}
        ${jaccard !== undefined ? `· jaccard ${Number(jaccard).toFixed(2)}` : ""}
      </div>`;
    } else if (skillName) {
      detail = `<div style="margin-top:4px;opacity:0.75;font-size:11px">
        skill: <span style="color:#b089ff">${escape(String(skillName))}</span>
        ${linkType ? `· ${escape(String(linkType))}` : ""}
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
  const color = kindColor[e.kind] ?? "#cfd6e4";

  return `
    <div style="padding:10px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid rgba(255,255,255,0.05)">
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
