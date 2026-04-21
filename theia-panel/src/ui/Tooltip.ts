import type { TheiaGraph } from "../data/types";

export function createTooltip(container: HTMLElement) {
  const el = document.createElement("div");
  el.style.cssText = `
    position: absolute; pointer-events: none;
    padding: 8px 12px; background: rgba(10,12,20,0.9);
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    font: 12px/1.4 ui-monospace, monospace; color: #cfd6e4;
    transform: translate(8px, 8px); opacity: 0; transition: opacity 120ms;
    max-width: 280px;
  `;
  container.appendChild(el);

  function show(node: TheiaGraph["nodes"][number], x: number, y: number) {
    el.innerHTML = `
      <div style="font-weight:600;color:#ffc477">${escape(node.title)}</div>
      <div style="opacity:0.7">${node.id}</div>
      <div style="margin-top:4px">${new Date(node.started_at).toLocaleString()}</div>
      <div>${Math.round(node.duration_sec)}s · ${node.tool_count} tools</div>
    `;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.opacity = "1";
  }

  function hide() { el.style.opacity = "0"; }
  function dispose() { container.removeChild(el); }

  return { show, hide, dispose };
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
