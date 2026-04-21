import type { TheiaGraph } from "../data/types";

export function createSidePanel(container: HTMLElement) {
  const el = document.createElement("aside");
  el.style.cssText = `
    position: absolute; top: 0; right: 0; bottom: 0; width: min(380px, 40vw);
    background: rgba(10,12,20,0.92); border-left: 1px solid rgba(255,255,255,0.1);
    color: #cfd6e4; font: 13px/1.5 ui-monospace, monospace;
    transform: translateX(100%); transition: transform 200ms ease-out;
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
    el.innerHTML = `
      <button aria-label="close" id="sv-close"
        style="position:absolute;top:10px;right:14px;background:none;border:none;color:#cfd6e4;font-size:18px;cursor:pointer">×</button>
      <h3 style="margin:0 0 4px;color:#ffc477;font-size:15px">${escape(node.title)}</h3>
      <div style="opacity:0.6;margin-bottom:14px">${node.id}</div>
      <dl style="margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 10px">
        <dt style="opacity:0.6">Started</dt><dd style="margin:0">${new Date(node.started_at).toLocaleString()}</dd>
        <dt style="opacity:0.6">Duration</dt><dd style="margin:0">${Math.round(node.duration_sec)}s</dd>
        <dt style="opacity:0.6">Model</dt><dd style="margin:0">${escape(node.model ?? "-")}</dd>
        <dt style="opacity:0.6">Tools</dt><dd style="margin:0">${node.tool_count}</dd>
        <dt style="opacity:0.6">Messages</dt><dd style="margin:0">${node.message_count ?? "-"}</dd>
      </dl>
      <h4 style="margin:18px 0 6px;font-size:12px;letter-spacing:0.5px;opacity:0.7">CONNECTIONS</h4>
      <ul style="margin:0;padding-left:18px">
        ${relatedEdges.map((e) => `<li>${e.kind} ${e.source === node.id ? "→" : "←"} ${escape(e.source === node.id ? e.target : e.source)} (w=${e.weight.toFixed(2)})</li>`).join("")}
      </ul>
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

function escape(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}
