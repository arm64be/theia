import * as THREE from "three";
import { loadGraph } from "./data/load";
import type { TheiaGraph } from "./data/types";
import { createScene } from "./scene/Scene";
import { createNodes, type NodeLayer } from "./scene/Nodes";
import { createEdges, type EdgeLayer } from "./scene/Edges";
import { createPost } from "./scene/Post";
import { createSimulation, type PhysicsNode, type PhysicsLink } from "./physics/Simulation";
import type { Simulation } from "d3-force-3d";
import { createPicker } from "./scene/Picker";
import { createTooltip } from "./ui/Tooltip";
import { createFilterBar } from "./ui/FilterBar";
import { createSidePanel } from "./ui/SidePanel";

export interface PanelOptions {
  edgeKinds?: TheiaGraph["edges"][number]["kind"][];
  pollIntervalMs?: number;
}

export interface Controller {
  destroy(): void;
  on(event: "node-click", handler: (nodeId: string) => void): void;
  on(event: "node-hover", handler: (nodeId: string | null) => void): void;
  on(event: "poll-error", handler: (error: unknown) => void): void;
  startPolling(intervalMs?: number): void;
  stopPolling(): void;
}

const DEFAULT_KINDS: TheiaGraph["edges"][number]["kind"][] = [
  "memory-share",
  "cross-search",
];

interface GraphState {
  graph: TheiaGraph;
  nodes: NodeLayer;
  edges: EdgeLayer;
  simulation: Simulation<PhysicsNode, PhysicsLink>;
  simNodes: PhysicsNode[];
  nodePositions: Float32Array;
  nodeIndex: Map<string, number>;
  kinds: Set<TheiaGraph["edges"][number]["kind"]>;
  picker: ReturnType<typeof createPicker>;
}

export async function mount(
  element: HTMLElement,
  graphUrl: string,
  options: PanelOptions = {},
): Promise<Controller> {
  element.style.position ||= "relative";
  element.style.overflow = "hidden";

  const ctx = createScene(element);
  ctx.setZoom(0.5);

  const post = createPost(ctx.renderer, ctx.scene, ctx.camera, element);
  const originalResize = ctx.resize;
  ctx.resize = () => {
    originalResize();
    post.resize();
  };

  const edgesScene = new THREE.Scene();
  const edges = createEdges();
  edgesScene.add(edges.group);

  const tooltip = createTooltip(element);
  const sidePanel = createSidePanel(element);

  // Mutable graph state — replaced on reload
  let state: GraphState | null = null;
  let disposed = false;

  function tick() {
    if (disposed || !state) return;
    state.simulation.tick(1);
    for (let i = 0; i < state.simNodes.length; i++) {
      const sn = state.simNodes[i]!;
      state.nodes.setPosition(i, sn.x, sn.y);
      state.nodePositions[i * 2 + 0] = sn.x;
      state.nodePositions[i * 2 + 1] = sn.y;
    }
    state.nodes.flush();
    state.edges.updatePositions(state.nodePositions);
  }

  function frame() {
    if (disposed) return;
    tick();
    const t = performance.now() / 1000;
    if (state) {
      state.nodes.setTime(t);
      state.edges.setTime(t);
    }
    post.renderEdges(edgesScene, ctx.camera);
    post.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Mouse / interaction state
  let lastMouse = { x: 0, y: 0 };
  let isMouseDown = false;
  let hasDragged = false;
  let mouseDownPos = { x: 0, y: 0 };

  function onMouseMove(e: MouseEvent) {
    const r = element.getBoundingClientRect();
    lastMouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPickerHover(idx: number | null) {
    if (!state) return;
    const nodeId = idx === null ? null : state.graph.nodes[idx]!.id;
    state.edges.setHoverNode(nodeId);
    if (idx === null) {
      tooltip.hide();
    } else {
      state.nodes.setHighlight(idx, true);
      state.nodes.flush();
      tooltip.show(state.graph.nodes[idx]!, lastMouse.x, lastMouse.y);
    }
    for (let i = 0; i < state.nodes.count; i++) {
      if (i !== idx) state.nodes.setHighlight(i, false);
    }
    state.nodes.flush();
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    isMouseDown = true;
    hasDragged = false;
    mouseDownPos = { x: e.clientX, y: e.clientY };
  }

  function onMouseMoveDrag(e: MouseEvent) {
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
  }

  function onMouseUp() {
    if (isMouseDown && !hasDragged && state) {
      const idx = state.picker.currentHovered();
      if (idx !== null) {
        const n = state.graph.nodes[idx]!;
        const related = state.graph.edges.filter(
          (e) => e.source === n.id || e.target === n.id,
        );
        sidePanel.show(n, related);
        emit("node-click", n.id);
      }
    }
    isMouseDown = false;
    hasDragged = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1.1 : 0.9;
    ctx.setZoom(ctx.getZoom() * delta);
  }

  element.addEventListener("mousemove", onMouseMove);
  element.addEventListener("mousedown", onMouseDown);
  element.addEventListener("mousemove", onMouseMoveDrag);
  element.addEventListener("mouseup", onMouseUp);
  element.addEventListener("wheel", onWheel, { passive: false });

  // Filter bar — persists across graph reloads
  let kinds = new Set(options.edgeKinds ?? DEFAULT_KINDS);
  const filterBar = createFilterBar(element, kinds, (newKinds) => {
    kinds = newKinds;
    if (state) {
      state.kinds = kinds;
      state.edges.rebuild(state.graph, state.kinds, state.nodeIndex);
    }
  });

  // Event listeners
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {
    "node-click": [],
    "node-hover": [],
    "poll-error": [],
  };
  function emit(event: string, ...args: unknown[]) {
    (listeners[event] ?? []).forEach((fn) => fn(...args));
  }

  function onPickerHoverEmit(idx: number | null) {
    if (!state) return;
    emit("node-hover", idx === null ? null : state.graph.nodes[idx]!.id);
  }

  // -------- graph lifecycle --------

  function buildNodeIndex(graph: TheiaGraph): Map<string, number> {
    return new Map(graph.nodes.map((n, i) => [n.id, i]));
  }

  function initGraph(graph: TheiaGraph) {
    const nodeIndex = buildNodeIndex(graph);
    const nodes = createNodes(graph);
    ctx.scene.add(nodes.mesh);
    edges.rebuild(graph, kinds, nodeIndex);

    const { simulation, nodes: simNodes } = createSimulation(graph);
    simulation.stop();
    const nodePositions = new Float32Array(simNodes.length * 2);

    const picker = createPicker(element, ctx.camera, nodes);
    picker.onHover(onPickerHover);
    picker.onHover(onPickerHoverEmit);

    state = {
      graph,
      nodes,
      edges,
      simulation,
      simNodes,
      nodePositions,
      nodeIndex,
      kinds,
      picker,
    };
  }

  function updateGraph(newGraph: TheiaGraph) {
    if (!state) {
      initGraph(newGraph);
      return;
    }

    // Preserve existing simulation positions
    const oldPosMap = new Map<
      string,
      { x: number; y: number; vx?: number; vy?: number }
    >();
    for (const sn of state.simNodes) {
      oldPosMap.set(sn.id, { x: sn.x, y: sn.y, vx: sn.vx, vy: sn.vy });
    }

    // Tear down old graph objects
    state.simulation.stop();
    ctx.scene.remove(state.nodes.mesh);
    state.nodes.dispose();
    state.picker.dispose();

    // Build new state
    const nodeIndex = buildNodeIndex(newGraph);
    const nodes = createNodes(newGraph);
    ctx.scene.add(nodes.mesh);
    edges.rebuild(newGraph, kinds, nodeIndex);

    const { simulation, nodes: simNodes } = createSimulation(newGraph);
    simulation.stop();
    const nodePositions = new Float32Array(simNodes.length * 2);

    // Restore positions for existing nodes so they don't jump
    for (const sn of simNodes) {
      const old = oldPosMap.get(sn.id);
      if (old) {
        sn.x = old.x;
        sn.y = old.y;
        sn.vx = old.vx ?? 0;
        sn.vy = old.vy ?? 0;
      }
    }

    const picker = createPicker(element, ctx.camera, nodes);
    picker.onHover(onPickerHover);
    picker.onHover(onPickerHoverEmit);

    state = {
      graph: newGraph,
      nodes,
      edges,
      simulation,
      simNodes,
      nodePositions,
      nodeIndex,
      kinds,
      picker,
    };
  }

  // -------- polling --------

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastGeneratedAt: string | null = null;

  async function checkForUpdate() {
    if (disposed) return;
    try {
      const res = await fetch(graphUrl + "?t=" + Date.now());
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const graph = (await res.json()) as TheiaGraph;
      if (
        typeof graph.meta?.generated_at === "string" &&
        graph.meta.generated_at !== lastGeneratedAt
      ) {
        lastGeneratedAt = graph.meta.generated_at;
        updateGraph(graph);
      }
    } catch (err) {
      console.warn("[theia] poll error:", err);
      emit("poll-error", err);
    }
  }

  function startPolling(intervalMs = 5000) {
    stopPolling();
    pollTimer = setInterval(checkForUpdate, intervalMs);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // -------- bootstrap --------

  const initialGraph = await loadGraph(graphUrl);
  lastGeneratedAt = initialGraph.meta.generated_at;
  initGraph(initialGraph);

  if (options.pollIntervalMs && options.pollIntervalMs > 0) {
    startPolling(options.pollIntervalMs);
  }

  return {
    destroy() {
      disposed = true;
      stopPolling();
      if (state) {
        state.simulation.stop();
        state.nodes.dispose();
        state.picker.dispose();
      }
      edges.dispose();
      post.edgesTarget.dispose();
      post.preBloomTarget.dispose();
      post.sceneTarget.dispose();
      post.composer.dispose();
      ctx.dispose();
      tooltip.dispose();
      sidePanel.dispose();
      filterBar.dispose();
      element.removeEventListener("mousemove", onMouseMove);
      element.removeEventListener("mousedown", onMouseDown);
      element.removeEventListener("mousemove", onMouseMoveDrag);
      element.removeEventListener("mouseup", onMouseUp);
      element.removeEventListener("wheel", onWheel);
    },
    on(event, handler) {
      (listeners[event] ??= []).push(handler as never);
    },
    startPolling,
    stopPolling,
  };
}
