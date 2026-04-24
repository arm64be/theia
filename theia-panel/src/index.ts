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
import { readTheme, applyTheme, onThemeMessage } from "./ui/Theme";
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

  // Mutable graph-specific state — closures capture the binding, not the value
  let currentGraph: TheiaGraph;
  let nodes: NodeLayer;
  let nodeIndex = new Map<string, number>();
  let nodePositions = new Float32Array(0);
  let simNodes: ReturnType<typeof createSimulation>["nodes"] = [];
  let simulation: ReturnType<typeof createSimulation>["simulation"];
  let picker: ReturnType<typeof createPicker>;
  let searchBar: ReturnType<typeof createSearchBar>;

  const tooltip = createTooltip(element, theme);
  const sidePanel = createSidePanel(element, theme);

  let lastMouse = { x: 0, y: 0 };
  let lastWheelAt = 0;

  const isInteracting = () =>
    isMouseDown || performance.now() - lastWheelAt < 200;

  function setupGraph(g: TheiaGraph) {
    simulation?.stop();

    if (nodes) {
      ctx.scene.remove(nodes.mesh);
      nodes.dispose();
    }

    currentGraph = g;
    nodes = createNodes(g);
    ctx.scene.add(nodes.mesh);

    const simResult = createSimulation(g);
    simulation = simResult.simulation;
    simNodes = simResult.nodes;
    simulation.stop();

    nodePositions = new Float32Array(simNodes.length * 3);
    nodeIndex = new Map(g.nodes.map((n, i) => [n.id, i]));

    // Pre-warm simulation so edge z-positions are 3D on first build
    simulation.tick(1);
    for (let i = 0; i < simNodes.length; i++) {
      const sn = simNodes[i]!;
      nodes.setPosition(i, sn.x, sn.y, sn.z);
      nodePositions[i * 3 + 0] = sn.x;
      nodePositions[i * 3 + 1] = sn.y;
      nodePositions[i * 3 + 2] = sn.z;
    }
    nodes.flush();

    edges.rebuild(g, kinds, nodeIndex, nodePositions);
    post.resize();

    picker?.dispose();
    picker = createPicker(element, ctx.camera, nodes, nodePositions, {
      shouldBlock: isInteracting,
    });
    picker.onHover((idx) => {
      const nodeId = idx === null ? null : currentGraph.nodes[idx]!.id;
      edges.setHoverNode(nodeId);
      if (idx === null) {
        tooltip.hide();
      } else {
        nodes.setHighlight(idx, true);
        nodes.flush();
        tooltip.show(currentGraph.nodes[idx]!, lastMouse.x, lastMouse.y);
      }
      for (let i = 0; i < nodes.count; i++) {
        if (i !== idx) nodes.setHighlight(i, false);
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
        if (idx !== undefined) {
          const sn = simNodes[idx]!;
          ctx.focusOn(sn.x, sn.y, 1.5);
        }
        const related = currentGraph.edges.filter(
          (e) => e.source === result.node.id || e.target === result.node.id,
        );
        sidePanel.show(result.node, related);
      },
      theme,
    );
  }

  const initialGraph = await loadGraph(graphUrl);
  setupGraph(initialGraph);

  function tick() {
    simulation.tick(1);
    for (let i = 0; i < simNodes.length; i++) {
      const sn = simNodes[i]!;
      nodes.setPosition(i, sn.x, sn.y, sn.z);
      nodePositions[i * 3 + 0] = sn.x;
      nodePositions[i * 3 + 1] = sn.y;
      nodePositions[i * 3 + 2] = sn.z;
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
    if (isMouseDown && !hasDragged && performance.now() - lastWheelAt >= 200) {
      const idx = picker.pickAt(e.clientX, e.clientY, 0.35);
      if (idx !== null) {
        const n = currentGraph.nodes[idx]!;
        const related = currentGraph.edges.filter(
          (e) => e.source === n.id || e.target === n.id,
        );
        sidePanel.show(n, related);
        emit("node-click", n.id);
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
    (newKinds) => {
      kinds = newKinds;
      edges.rebuild(currentGraph, kinds, nodeIndex, nodePositions);
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
      const newGraph = await loadGraph(targetUrl);

      const cameraState = ctx.getCameraState();
      const selectedId = sidePanel.currentNodeId();

      setupGraph(newGraph);

      ctx.setCameraState(cameraState);
      if (selectedId !== null) {
        const idx = nodeIndex.get(selectedId);
        if (idx !== undefined) {
          const n = currentGraph.nodes[idx]!;
          const related = currentGraph.edges.filter(
            (e) => e.source === n.id || e.target === n.id,
          );
          sidePanel.show(n, related);
        }
      }
    },
  };
}
