import * as THREE from "three";
import { loadGraph } from "./data/load";
import type { TheiaGraph } from "./data/types";
import { createScene } from "./scene/Scene";
import { createNodes } from "./scene/Nodes";
import { createEdges } from "./scene/Edges";
import { createPost } from "./scene/Post";
import { createSimulation } from "./physics/Simulation";
import { createPicker } from "./scene/Picker";
import { createTooltip } from "./ui/Tooltip";
import { createFilterBar } from "./ui/FilterBar";
import { createSidePanel } from "./ui/SidePanel";

export interface PanelOptions {
  edgeKinds?: TheiaGraph["edges"][number]["kind"][];
}

export interface Controller {
  destroy(): void;
  on(event: "node-click", handler: (nodeId: string) => void): void;
  on(event: "node-hover", handler: (nodeId: string | null) => void): void;
}

const DEFAULT_KINDS: TheiaGraph["edges"][number]["kind"][] = [
  "memory-share",
  "cross-search",
];

export async function mount(
  element: HTMLElement,
  graphUrl: string,
  options: PanelOptions = {},
): Promise<Controller> {
  const graph: TheiaGraph = await loadGraph(graphUrl);

  element.style.position ||= "relative";
  element.style.overflow = "hidden";
  const ctx = createScene(element);
  ctx.setZoom(0.5);
  const nodes = createNodes(graph);
  const edges = createEdges();
  const post = createPost(ctx.renderer, ctx.scene, ctx.camera, element);
  const originalResize = ctx.resize;
  ctx.resize = () => {
    originalResize();
    post.resize();
  };
  const nodeIndex = new Map(graph.nodes.map((n, i) => [n.id, i]));
  let kinds = new Set(options.edgeKinds ?? DEFAULT_KINDS);

  const edgesScene = new THREE.Scene();
  edgesScene.add(edges.group);
  edges.rebuild(graph, kinds, nodeIndex);
  ctx.scene.add(nodes.mesh);

  const { simulation, nodes: simNodes } = createSimulation(graph);
  simulation.stop();

  const nodePositions = new Float32Array(simNodes.length * 2);

  function tick() {
    simulation.tick(1);
    for (let i = 0; i < simNodes.length; i++) {
      const sn = simNodes[i]!;
      nodes.setPosition(i, sn.x, sn.y);
      nodePositions[i * 2 + 0] = sn.x;
      nodePositions[i * 2 + 1] = sn.y;
    }
    nodes.flush();
    edges.updatePositions(nodePositions);
  }

  let disposed = false;
  function frame() {
    if (disposed) return;
    tick();
    const t = performance.now() / 1000;
    nodes.setTime(t);
    edges.setTime(t);
    post.setTime(t);
    post.renderEdges(edgesScene, ctx.camera);
    post.composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Tooltip + hover
  const tooltip = createTooltip(element);
  const picker = createPicker(element, ctx.camera, nodes);
  let lastMouse = { x: 0, y: 0 };
  element.addEventListener("mousemove", (e) => {
    const r = element.getBoundingClientRect();
    lastMouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  picker.onHover((idx) => {
    const nodeId = idx === null ? null : graph.nodes[idx]!.id;
    edges.setHoverNode(nodeId);
    if (idx === null) {
      tooltip.hide();
    } else {
      nodes.setHighlight(idx, true);
      nodes.flush();
      tooltip.show(graph.nodes[idx]!, lastMouse.x, lastMouse.y);
    }
    for (let i = 0; i < nodes.count; i++) {
      if (i !== idx) nodes.setHighlight(i, false);
    }
    nodes.flush();
  });

  // Click / drag handling
  const sidePanel = createSidePanel(element);
  let isMouseDown = false;
  let hasDragged = false;
  let mouseDownPos = { x: 0, y: 0 };

  element.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // only left click
    isMouseDown = true;
    hasDragged = false;
    mouseDownPos = { x: e.clientX, y: e.clientY };
  });

  element.addEventListener("mousemove", (e) => {
    if (!isMouseDown) return;
    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasDragged = true;
    }
    if (hasDragged) {
      const rect = element.getBoundingClientRect();
      const worldW = ctx.camera.right - ctx.camera.left;
      const worldH = ctx.camera.top - ctx.camera.bottom;
      const panX = -(dx / rect.width) * worldW;
      const panY = (dy / rect.height) * worldH;
      ctx.pan(panX, panY);
      mouseDownPos = { x: e.clientX, y: e.clientY };
    }
  });

  element.addEventListener("mouseup", () => {
    if (isMouseDown && !hasDragged) {
      const idx = picker.currentHovered();
      if (idx !== null) {
        const n = graph.nodes[idx]!;
        const related = graph.edges.filter(
          (e) => e.source === n.id || e.target === n.id,
        );
        sidePanel.show(n, related);
        emit("node-click", n.id);
      }
    }
    isMouseDown = false;
    hasDragged = false;
  });

  // Wheel zoom
  element.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.1 : 0.9;
      ctx.setZoom(ctx.getZoom() * delta);
    },
    { passive: false },
  );

  // Filter bar
  const filterBar = createFilterBar(element, kinds, (newKinds) => {
    kinds = newKinds;
    edges.rebuild(graph, kinds, nodeIndex);
  });

  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {
    "node-click": [],
    "node-hover": [],
  };
  function emit(event: string, ...args: unknown[]) {
    (listeners[event] ?? []).forEach((fn) => fn(...args));
  }

  picker.onHover((idx) => {
    emit("node-hover", idx === null ? null : graph.nodes[idx]!.id);
  });

  return {
    destroy() {
      disposed = true;
      simulation.stop();
      nodes.dispose();
      edges.dispose();
      post.edgesTarget.dispose();
      post.composer.dispose();
      ctx.dispose();
      tooltip.dispose();
      picker.dispose();
      sidePanel.dispose();
      filterBar.dispose();
    },
    on(event, handler) {
      (listeners[event] ??= []).push(handler as never);
    },
  };
}
