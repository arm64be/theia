import * as THREE from "three";
import { loadGraph } from "./data/load";
import type { TheiaGraph } from "./data/types";
import { createScene } from "./scene/Scene";
import { createNodes, type NodeLayer } from "./scene/Nodes";
import { createEdges } from "./scene/Edges";
import { createPost } from "./scene/Post";
import { createSimulation } from "./physics/Simulation";
import { createPicker } from "./scene/Picker";
import { createTooltip } from "./ui/Tooltip";
import { createFilterBar } from "./ui/FilterBar";
import { createSearchBar } from "./ui/SearchBar";
import { createSidePanel } from "./ui/SidePanel";
import { readTheme, applyTheme, onThemeMessage, FONT_STACK } from "./ui/Theme";
import type { ThemeTokens } from "./ui/Theme";

export interface PanelOptions {
  edgeKinds?: TheiaGraph["edges"][number]["kind"][];
}

export interface Controller {
  destroy(): void;
  on(event: "node-click", handler: (nodeId: string) => void): void;
  on(event: "node-hover", handler: (nodeId: string | null) => void): void;
  reload(graphUrl?: string): Promise<void>;
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
  // Read and apply theme from query params (or use defaults)
  const theme: ThemeTokens = readTheme();
  applyTheme(theme);

  element.style.position ||= "relative";
  element.style.overflow = "hidden";

  const ctx = createScene(element);
  ctx.setZoom(0.5);

  const edges = createEdges();
  // Edges are rendered into a separate scene so the post-processing pipeline
  // can apply bloom to them independently of the nodes.
  const edgesScene = new THREE.Scene();
  edgesScene.add(edges.group);

  const post = createPost(ctx.renderer, ctx.scene, ctx.camera, element);
  const originalResize = ctx.resize;
  ctx.resize = () => {
    originalResize();
    post.resize();
  };

  let kinds = new Set(options.edgeKinds ?? DEFAULT_KINDS);
  let modelFilter: string | null = null;
  let focusEnabled = false;

  // Mutable graph-specific state — closures capture the binding, not the value
  let currentGraph: TheiaGraph;
  let nodes: NodeLayer;
  let nodeIndex = new Map<string, number>();
  let nodePositions = new Float32Array(0);
  let simNodes: ReturnType<typeof createSimulation>["nodes"] = [];
  let simulation: ReturnType<typeof createSimulation>["simulation"];
  let picker: ReturnType<typeof createPicker>;
  let searchBar: ReturnType<typeof createSearchBar>;
  let selectedIdx: number | null = null;

  const tooltip = createTooltip(element, theme);
  function clearSelected() {
    if (selectedIdx !== null) {
      nodes.setSelected(selectedIdx, false);
      nodes.setHighlight(selectedIdx, false);
      selectedIdx = null;
    }
  }

  function select(idx: number) {
    clearSelected();
    selectedIdx = idx;
    nodes.setSelected(idx, true);
    nodes.setHighlight(idx, false);
  }

  const sidePanel = createSidePanel(element, theme, {
    onNavigate: (targetId) => {
      const idx = nodeIndex.get(targetId);
      if (idx === undefined || !visibleNodeIds.has(targetId)) return;
      const sn = simNodes[idx];
      if (!sn) return;
      select(idx);
      ctx.focusOn(sn.x, sn.y, 1.5);
      const n = currentGraph.nodes[idx]!;
      const related = currentGraph.edges.filter(
        (e) => (e.source === n.id || e.target === n.id) && kinds.has(e.kind),
      );
      sidePanel.show(n, related);
      applyFocusModeIfEnabled(n.id);
      emit("node-click", targetId);
    },
    onClose: () => {
      clearSelected();
      nodes.flush();
    },
    onFocusToggle: (enabled) => {
      focusEnabled = enabled;
      if (!focusEnabled) {
        updateVisibility();
      } else {
        const id = sidePanel.currentNodeId();
        if (id) applyFocusModeIfEnabled(id);
      }
    },
  });

  let lastMouse = { x: 0, y: 0 };
  let lastWheelAt = 0;

  const isInteracting = () =>
    isMouseDown || performance.now() - lastWheelAt < 200;

  function computeVisibleNodeIds(
    graph: TheiaGraph,
    enabledKinds: Set<string>,
    modelFilter?: string | null,
  ): Set<string> {
    const kindVisible = new Set<string>();
    if (enabledKinds.has("subagent")) {
      for (const node of graph.nodes) {
        kindVisible.add(node.id);
      }
    } else {
      const subagentIds = new Set<string>();
      const hasNonSubagentConnection = new Map<string, boolean>();
      for (const node of graph.nodes) {
        if (node.parent_id) {
          subagentIds.add(node.id);
        } else {
          hasNonSubagentConnection.set(node.id, true);
        }
      }
      for (const edge of graph.edges) {
        if (edge.kind === "subagent") continue;
        if (!enabledKinds.has(edge.kind)) continue;
        if (!subagentIds.has(edge.source)) {
          hasNonSubagentConnection.set(edge.source, true);
        }
        if (!subagentIds.has(edge.target)) {
          hasNonSubagentConnection.set(edge.target, true);
        }
      }
      for (const node of graph.nodes) {
        if (hasNonSubagentConnection.get(node.id)) {
          kindVisible.add(node.id);
        }
      }
    }
    if (modelFilter) {
      const modelMatch = new Set<string>();
      for (const node of graph.nodes) {
        if (node.model === modelFilter && kindVisible.has(node.id)) {
          modelMatch.add(node.id);
        }
      }
      return modelMatch;
    }
    return kindVisible;
  }

  let visibleNodeIds = new Set<string>();

  function updateVisibility() {
    visibleNodeIds = computeVisibleNodeIds(currentGraph, kinds, modelFilter);
    for (let i = 0; i < currentGraph.nodes.length; i++) {
      nodes.setVisible(i, visibleNodeIds.has(currentGraph.nodes[i]!.id));
    }
    nodes.flush();

    // Preserve current positions when reinitializing simulation with filtered edges
    const oldPositions = new Map<string, { x: number; y: number; z: number }>();
    for (const sn of simNodes) {
      oldPositions.set(sn.id, { x: sn.x, y: sn.y, z: sn.z });
    }
    simulation.stop();
    const simResult = createSimulation(currentGraph, kinds);
    simulation = simResult.simulation;
    simNodes = simResult.nodes;
    simulation.stop();
    for (const sn of simNodes) {
      const old = oldPositions.get(sn.id);
      if (old) {
        sn.x = old.x;
        sn.y = old.y;
        sn.z = old.z;
      }
    }
    // Start at equilibrium to prevent jittery readjustment
    simulation.alpha(simulation.alphaTarget());

    const filteredNodeIndex = new Map<string, number>();
    for (const [id, idx] of nodeIndex) {
      if (visibleNodeIds.has(id)) {
        filteredNodeIndex.set(id, idx);
      }
    }
    edges.rebuild(currentGraph, kinds, filteredNodeIndex, nodePositions);
  }

  function applyFocusModeIfEnabled(selectedNodeId: string) {
    if (!focusEnabled) return;
    const neighbors = new Set<string>();
    neighbors.add(selectedNodeId);
    for (const edge of currentGraph.edges) {
      if (!kinds.has(edge.kind)) continue;
      if (edge.source === selectedNodeId) {
        neighbors.add(edge.target);
      } else if (edge.target === selectedNodeId) {
        neighbors.add(edge.source);
      }
    }
    for (let i = 0; i < currentGraph.nodes.length; i++) {
      const id = currentGraph.nodes[i]!.id;
      nodes.setVisible(i, visibleNodeIds.has(id) && neighbors.has(id));
    }
    nodes.flush();
    const filteredNodeIndex = new Map<string, number>();
    for (const [id, idx] of nodeIndex) {
      if (neighbors.has(id) && visibleNodeIds.has(id)) {
        filteredNodeIndex.set(id, idx);
      }
    }
    edges.rebuild(currentGraph, kinds, filteredNodeIndex, nodePositions);
  }

  function setupGraph(g: TheiaGraph) {
    simulation?.stop();

    if (nodes) {
      ctx.scene.remove(nodes.mesh);
      nodes.dispose();
    }

    currentGraph = g;
    nodePositions = new Float32Array(g.nodes.length * 3);
    nodes = createNodes(g, nodePositions);
    ctx.scene.add(nodes.mesh);

    const simResult = createSimulation(g, kinds);
    simulation = simResult.simulation;
    simNodes = simResult.nodes;
    simulation.stop();

    nodeIndex = new Map(g.nodes.map((n, i) => [n.id, i]));

    // Pre-warm simulation so edge z-positions are 3D on first build
    simulation.tick(1);
    for (let i = 0; i < simNodes.length; i++) {
      const sn = simNodes[i]!;
      nodes.setPosition(i, sn.x, sn.y, sn.z);
    }
    nodes.flush();

    visibleNodeIds = computeVisibleNodeIds(g, kinds, modelFilter);
    for (let i = 0; i < g.nodes.length; i++) {
      nodes.setVisible(i, visibleNodeIds.has(g.nodes[i]!.id));
    }
    nodes.flush();

    const filteredNodeIndex = new Map<string, number>();
    for (const [id, idx] of nodeIndex) {
      if (visibleNodeIds.has(id)) {
        filteredNodeIndex.set(id, idx);
      }
    }
    edges.rebuild(g, kinds, filteredNodeIndex, nodePositions);
    post.resize();

    picker?.dispose();
    picker = createPicker(element, ctx.camera, nodes, nodePositions, {
      shouldBlock: isInteracting,
      isVisible: (i) => visibleNodeIds.has(currentGraph.nodes[i]!.id),
    });
    picker.onHover((idx) => {
      const nodeId = idx === null ? null : currentGraph.nodes[idx]!.id;
      element.style.cursor = idx === null ? "" : "pointer";
      edges.setHoverNode(nodeId);
      for (let i = 0; i < nodes.count; i++) {
        if (i === idx) {
          nodes.setHighlight(i, true);
        } else if (i !== selectedIdx) {
          nodes.setHighlight(i, false);
        }
      }
      if (idx !== null) {
        tooltip.show(currentGraph.nodes[idx]!, lastMouse.x, lastMouse.y);
      } else {
        tooltip.hide();
      }
      nodes.flush();
      emit("node-hover", idx === null ? null : currentGraph.nodes[idx]!.id);
    });

    searchBar?.dispose();
    searchBar = createSearchBar(
      element,
      currentGraph,
      (result) => {
        const idx = nodeIndex.get(result.node.id);
        if (idx !== undefined && visibleNodeIds.has(result.node.id)) {
          const sn = simNodes[idx]!;
          ctx.focusOn(sn.x, sn.y, 1.5);
        }
        const related = currentGraph.edges.filter(
          (e) =>
            (e.source === result.node.id || e.target === result.node.id) &&
            kinds.has(e.kind),
        );
        sidePanel.show(result.node, related);
      },
      theme,
      (node) => visibleNodeIds.has(node.id),
    );
  }

  function createLoadingOverlay(text: string): { remove(): void } {
    const el = document.createElement("div");
    el.style.cssText = `
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(7,8,13,0.8); color: rgba(255,255,255,0.6);
      font: 13px/1.4 var(--theia-font, ${FONT_STACK});
      letter-spacing: 0.05em; z-index: 20; transition: opacity 300ms;
    `;
    el.textContent = text;
    element.appendChild(el);
    return {
      remove() {
        el.style.opacity = "0";
        setTimeout(() => {
          try {
            element.removeChild(el);
          } catch {
            /* container may have been destroyed during load */
          }
        }, 300);
      },
    };
  }

  const loading = createLoadingOverlay("Loading constellation\u2026");
  let initialGraph: TheiaGraph;
  try {
    initialGraph = await loadGraph(graphUrl);
  } catch (err) {
    loading.remove();
    throw err;
  }
  loading.remove();
  setupGraph(initialGraph);

  function tick() {
    simulation.tick(1);
    for (let i = 0; i < simNodes.length; i++) {
      const sn = simNodes[i]!;
      nodes.setPosition(i, sn.x, sn.y, sn.z);
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
    nodes.setCameraPosition(ctx.camera.position);
    post.renderEdges(edgesScene, ctx.camera);
    post.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  element.addEventListener("mousemove", (e) => {
    const r = element.getBoundingClientRect();
    lastMouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  });

  // Click / drag handling
  let isMouseDown = false;
  let hasDragged = false;
  let mouseDownPos = { x: 0, y: 0 };
  let dragMode: "rotate" | "pan" | null = null;

  element.addEventListener("mousedown", (e) => {
    if (e.button === 0) dragMode = "rotate";
    else if (e.button === 2) dragMode = "pan";
    else return;
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
      if (dragMode === "rotate") {
        ctx.rotate(dx, dy);
      } else if (dragMode === "pan") {
        ctx.pan(dx, dy);
      }
      mouseDownPos = { x: e.clientX, y: e.clientY };
    }
  });

  element.addEventListener("mouseup", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("aside")) return;
    if (isMouseDown && !hasDragged && performance.now() - lastWheelAt >= 200) {
      const idx = picker.pickAt(e.clientX, e.clientY, 1.0);
      if (idx !== null) {
        select(idx);
        const n = currentGraph.nodes[idx]!;
        const related = currentGraph.edges.filter(
          (e) => (e.source === n.id || e.target === n.id) && kinds.has(e.kind),
        );
        sidePanel.show(n, related);
        applyFocusModeIfEnabled(n.id);
        emit("node-click", n.id);
      } else {
        clearSelected();
        sidePanel.hide();
      }
    }
    isMouseDown = false;
    hasDragged = false;
    dragMode = null;
  });

  element.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  // Wheel zoom
  element.addEventListener(
    "wheel",
    (e) => {
      lastWheelAt = performance.now();
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.1 : 0.9;
      ctx.setZoom(ctx.getZoom() * delta);
    },
    { passive: false },
  );

  // Filter bar
  const filterBar = createFilterBar(
    element,
    kinds,
    initialGraph,
    (state) => {
      kinds = state.kinds;
      modelFilter = state.model;
      updateVisibility();
      const id = sidePanel.currentNodeId();
      if (id) applyFocusModeIfEnabled(id);
    },
    theme,
  );

  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {
    "node-click": [],
    "node-hover": [],
  };
  function emit(event: string, ...args: unknown[]) {
    (listeners[event] ?? []).forEach((fn) => fn(...args));
  }

  // Listen for live theme updates from the dashboard host
  const stopThemeListener = onThemeMessage((newTheme) => {
    applyTheme(newTheme);
    tooltip.updateTheme(newTheme);
    sidePanel.updateTheme(newTheme);
    filterBar.updateTheme(newTheme);
    searchBar.updateTheme(newTheme);
  });

  return {
    destroy() {
      disposed = true;
      stopThemeListener();
      simulation.stop();
      nodes.dispose();
      edges.dispose();
      post.edgesTarget.dispose();
      post.preBloomTarget.dispose();
      post.sceneTarget.dispose();
      post.composer.dispose();
      ctx.dispose();
      tooltip.dispose();
      picker.dispose();
      sidePanel.dispose();
      filterBar.dispose();
      searchBar.dispose();
    },
    on(event, handler) {
      (listeners[event] ??= []).push(handler as never);
    },
    async reload(url?: string) {
      const targetUrl = url ?? graphUrl;

      const loading = createLoadingOverlay("Reloading\u2026");
      let newGraph: TheiaGraph;
      try {
        newGraph = await loadGraph(targetUrl);
      } finally {
        loading.remove();
      }

      const cameraState = ctx.getCameraState();
      const selectedId = sidePanel.currentNodeId();

      setupGraph(newGraph);
      filterBar.updateGraph(newGraph);

      ctx.setCameraState(cameraState);
      clearSelected();
      if (selectedId !== null) {
        const idx = nodeIndex.get(selectedId);
        if (idx !== undefined) {
          selectedIdx = idx;
          nodes.setSelected(idx, true);
          const n = currentGraph.nodes[idx]!;
          const related = currentGraph.edges.filter(
            (e) =>
              (e.source === n.id || e.target === n.id) && kinds.has(e.kind),
          );
          sidePanel.show(n, related);
          applyFocusModeIfEnabled(n.id);
        }
      }
    },
  };
}
