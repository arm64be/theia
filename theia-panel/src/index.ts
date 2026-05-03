import * as THREE from "three";
import { loadGraph } from "./data/load";
import type { TheiaGraph } from "./data/types";
import { createScene } from "./scene/Scene";
import { createNodes, type NodeLayer } from "./scene/Nodes";
import { createEdges } from "./scene/Edges";
import { createPost } from "./scene/Post";
import { createPicker } from "./scene/Picker";
import {
  createSimulationState,
  type SimulationState,
} from "./state/simulation";
import { createKeyboardNav } from "./scene/KeyboardNav";
import { computeEdgeChain } from "./scene/chain";
import { createTooltip } from "./ui/Tooltip";
import { createFilterBar } from "./ui/FilterBar";
import { createSearchBar } from "./ui/SearchBar";
import { createSidePanel } from "./ui/SidePanel";
import { readTheme, applyTheme, onThemeMessage } from "./ui/Theme";
import type { ThemeTokens } from "./ui/Theme";
import {
  createLoadingOverlay,
  createChainOverlay,
  createOnboardingOverlay,
} from "./ui/Overlays";
import {
  VALID_KINDS,
  DEFAULT_KINDS,
  loadFilterState,
  saveFilterState,
  computeVisibleNodeIds,
} from "./state/filterState";
import { createPhysicsSnapshotIO } from "./state/physicsSnapshot";

export interface PanelOptions {
  edgeKinds?: TheiaGraph["edges"][number]["kind"][];
}

export interface Controller {
  destroy(): void;
  on(event: "node-click", handler: (nodeId: string) => void): void;
  on(event: "node-hover", handler: (nodeId: string | null) => void): void;
  reload(graphUrl?: string): Promise<void>;
}

const ONBOARDING_STORAGE_KEY = "theia-first-load-onboarding-complete";
const ONBOARDING_ROTATION_RADIANS = Math.PI * 1.15;
const ONBOARDING_BLINK_MS = 3200;
const ONBOARDING_LINK_UP_MS = 700;
const ONBOARDING_BASE_ZOOM = 0.72;
const ONBOARDING_MIN_ZOOM = 0.42;
const ONBOARDING_NEAR_DISTANCE = 3.2;
const ONBOARDING_SAFE_DISTANCE = 5.6;

function easeQuadInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function popScale(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const eased = easeQuadInOut(t);
  return 1 + 0.28 * Math.sin(Math.PI * eased);
}

function revealBrightness(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const eased = easeQuadInOut(t);
  return 1 + 0.5 * Math.sin(Math.PI * eased);
}

const edgeKeyCache = new WeakMap<TheiaGraph["edges"][number], string>();
function edgeKey(edge: TheiaGraph["edges"][number]): string {
  let key = edgeKeyCache.get(edge);
  if (key !== undefined) return key;
  key =
    edge.source < edge.target
      ? `${edge.source}|${edge.target}|${edge.kind}`
      : `${edge.target}|${edge.source}|${edge.kind}`;
  edgeKeyCache.set(edge, key);
  return key;
}

function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

function markOnboardingComplete(): void {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
  } catch {
    /* quota exceeded, ignore */
  }
}

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
  // Run the post-processing resize after the base scene resize. Must
  // use ctx.onResize — replacing ctx.resize from outside would not
  // affect the internal ResizeObserver, leaving post render-targets at
  // the wrong size when the container resizes (causing blur during
  // fullscreen toggle in particular). See Scene.ts for the rationale.
  ctx.onResize(() => post.resize());

  let kinds = new Set(options.edgeKinds ?? DEFAULT_KINDS);
  let modelFilter: string | null = null;
  const saved = loadFilterState();
  if (saved) {
    kinds = saved.kinds;
    modelFilter = saved.model;
  }
  let focusEnabled = false;
  let searchFocusEnabled = saved?.searchFocus ?? false;
  let hideOrphansEnabled = saved?.hideOrphans ?? false;
  let componentFocusEnabled = saved?.componentFocus ?? false;
  let focusFilter: Set<string> | null = null;
  let componentFilter: Set<string> | null = null;
  let chainFilter: Set<string> | null = null;
  let chainEdge: TheiaGraph["edges"][number] | null = null;
  let chainOverlay: {
    update(nodeCount: number, edgeCount: number, label: string): void;
    remove(): void;
  } | null = null;
  let onboarding: {
    startedAt: number;
    durationMs: number;
    order: number[];
    rankByIndex: Map<number, number>;
    revealedNodeIds: Set<string>;
    revealStartedAtByIndex: Map<number, number>;
    linkStartedAtByKey: Map<string, number>;
    lastRevealedCount: number;
    lastEase: number;
    cameraZoom: number;
    cameraAutoZoomEnabled: boolean;
    complete: boolean;
    overlay: { update(progress: number): void; remove(): void };
  } | null = null;
  let searchFocusMatchKey = "";
  let searchInputController: AbortController | null = null;
  let searchFocusTimer: ReturnType<typeof setTimeout> | null = null;

  // Mutable graph-specific state — closures capture the binding, not the value
  let currentGraph: TheiaGraph;
  let nodes: NodeLayer;
  let nodeIndex = new Map<string, number>();
  let nodePositions = new Float32Array(0);
  let simState: SimulationState;
  let picker: ReturnType<typeof createPicker>;
  const keyboardNav = createKeyboardNav(ctx);
  let searchBar: ReturnType<typeof createSearchBar>;
  let selectedIdx: number | null = null;
  let currentGraphUrl = graphUrl;
  const physicsSnapshotIO = createPhysicsSnapshotIO();

  function canSavePhysicsSnapshot(): boolean {
    if (!currentGraph || !hasCompletedOnboarding()) return false;
    if (onboarding && !onboarding.complete) return false;
    return true;
  }

  function savePhysicsSnapshot() {
    if (!canSavePhysicsSnapshot()) return;
    physicsSnapshotIO.save(
      currentGraphUrl,
      simState.getSimNodes(),
      ctx.getCameraState(),
    );
  }

  function maybeSavePhysicsSnapshot(now: number) {
    physicsSnapshotIO.maybeSave(
      now,
      currentGraphUrl,
      simState.getSimNodes(),
      () => ctx.getCameraState(),
      canSavePhysicsSnapshot(),
    );
  }

  const tooltip = createTooltip(element, theme);

  function selectedNodeId(): string | null {
    return selectedIdx === null ? null : currentGraph.nodes[selectedIdx]!.id;
  }

  function relatedNodeIds(nodeId: string): Set<string> {
    const related = new Set<string>([nodeId]);
    for (const edge of currentGraph.edges) {
      if (!kinds.has(edge.kind)) continue;
      if (edge.source === nodeId) related.add(edge.target);
      else if (edge.target === nodeId) related.add(edge.source);
    }
    return related;
  }

  function applyDimAround(nodeId: string | null) {
    if (nodeId === null) {
      for (let i = 0; i < nodes.count; i++) nodes.setDim(i, false);
      nodes.flush();
      return;
    }
    const related = relatedNodeIds(nodeId);
    for (let i = 0; i < nodes.count; i++) {
      nodes.setDim(i, !related.has(currentGraph.nodes[i]!.id));
    }
    nodes.flush();
  }

  function clearSelected() {
    if (selectedIdx !== null) {
      nodes.setSelected(selectedIdx, false);
      nodes.setHighlight(selectedIdx, false);
      selectedIdx = null;
    }
    edges.setHoverNode(null);
    applyDimAround(null);
  }

  function select(idx: number) {
    clearSelected();
    selectedIdx = idx;
    nodes.setSelected(idx, true);
    nodes.setHighlight(idx, false);
    edges.setHoverNode(currentGraph.nodes[idx]!.id);
    if (!focusEnabled) applyDimAround(currentGraph.nodes[idx]!.id);
  }

  function enterPanelMode(
    node: TheiaGraph["nodes"][number],
    related: TheiaGraph["edges"],
  ) {
    sidePanel.show(node, related);
    searchBar.setPanelOpen(true);
    filterBar.setSearchToggleVisible(true);
  }

  function onFocusToggle(enabled: boolean) {
    focusEnabled = enabled;
    if (!focusEnabled) {
      focusFilter = null;
      updateVisibility();
    } else {
      const id = sidePanel.currentNodeId();
      if (id) applyFocusModeIfEnabled(id);
    }
  }

  function onSearchFocusToggle(enabled: boolean) {
    searchFocusEnabled = enabled;
    saveFilterState(
      kinds,
      modelFilter,
      searchFocusEnabled,
      hideOrphansEnabled,
      componentFocusEnabled,
    );
    const searchMatchesChanged = updateVisibility();
    const id = sidePanel.currentNodeId();
    if (id && searchMatchesChanged) applyFocusModeIfEnabled(id);
  }

  function onHideOrphansToggle(enabled: boolean) {
    hideOrphansEnabled = enabled;
    saveFilterState(
      kinds,
      modelFilter,
      searchFocusEnabled,
      hideOrphansEnabled,
      componentFocusEnabled,
    );
    // Hiding/un-hiding orphans changes the visible-edge subgraph, so the chain
    // filter (depth-N from a clicked edge) may now reference hidden nodes.
    clearChainSelection();
    updateVisibility();
    const id = sidePanel.currentNodeId();
    if (id) applyFocusModeIfEnabled(id);
  }

  function onComponentFocusToggle(enabled: boolean) {
    componentFocusEnabled = enabled;
    saveFilterState(
      kinds,
      modelFilter,
      searchFocusEnabled,
      hideOrphansEnabled,
      componentFocusEnabled,
    );
    if (!componentFocusEnabled) {
      componentFilter = null;
      setNodeVisibilityFromState();
      rebuildVisibleEdges();
    } else {
      const id = sidePanel.currentNodeId();
      if (id) applyFocusModeIfEnabled(id);
    }
  }

  const sidePanel = createSidePanel(element, theme, {
    onNavigate: (targetId) => {
      const idx = nodeIndex.get(targetId);
      if (idx === undefined || !activeVisibleNodeIds().has(targetId)) return;
      const sn = simState.getNodePosition(idx);
      if (!sn) return;
      select(idx);
      ctx.focusOn(sn.x, sn.y, 1.5);
      const n = currentGraph.nodes[idx]!;
      const related = currentGraph.edges.filter(
        (e) => (e.source === n.id || e.target === n.id) && kinds.has(e.kind),
      );
      enterPanelMode(n, related);
      applyFocusModeIfEnabled(n.id);
      emit("node-click", targetId);
    },
    onClose: () => {
      if (focusEnabled) {
        onFocusToggle(false);
        filterBar.setFocusEnabled(false);
      }
      clearSelected();
      searchBar.setPanelOpen(false);
      filterBar.setSearchToggleVisible(false);
      nodes.flush();
    },
  });

  let lastMouse = { x: 0, y: 0 };
  let lastWheelAt = 0;

  const isInteracting = () =>
    isMouseDown || performance.now() - lastWheelAt < 200;

  let visibleNodeIds = new Set<string>();

  function activeVisibleNodeIds(): Set<string> {
    let ids = visibleNodeIds;
    // chainFilter (depth-N isolation from a clicked edge) takes precedence
    // over the depth-1 focusFilter; the two are conceptually different modes.
    if (chainFilter) {
      ids = new Set([...ids].filter((id) => chainFilter!.has(id)));
    } else if (focusFilter) {
      ids = new Set([...ids].filter((id) => focusFilter!.has(id)));
    }
    if (componentFilter) {
      ids = new Set([...ids].filter((id) => componentFilter!.has(id)));
    }
    if (onboarding) {
      ids = new Set(
        [...ids].filter((id) => onboarding!.revealedNodeIds.has(id)),
      );
    }
    return ids;
  }

  function updateVisibility(): boolean {
    visibleNodeIds = computeVisibleNodeIds(
      currentGraph,
      kinds,
      modelFilter,
      hideOrphansEnabled,
    );
    let searchMatchesChanged = false;
    if (searchFocusEnabled && searchBar) {
      const query = searchBar.input.value.trim();
      if (query) {
        const matchedIds = searchBar.getMatchedNodeIds(query);
        const nextMatchKey = Array.from(matchedIds).sort().join("\0");
        searchMatchesChanged = nextMatchKey !== searchFocusMatchKey;
        searchFocusMatchKey = nextMatchKey;
        if (matchedIds.size > 0) {
          const filtered = new Set<string>();
          for (const id of visibleNodeIds) {
            if (matchedIds.has(id)) filtered.add(id);
          }
          visibleNodeIds = filtered;
        }
      } else if (searchFocusMatchKey) {
        searchMatchesChanged = true;
        searchFocusMatchKey = "";
      }
    } else if (searchFocusMatchKey) {
      searchMatchesChanged = true;
      searchFocusMatchKey = "";
    }
    setNodeVisibilityFromState();

    // Start at equilibrium to prevent jittery readjustment.
    simState.replaceActive({
      activeIds: onboarding ? activeVisibleNodeIds() : null,
    });

    rebuildVisibleEdges();
    return searchMatchesChanged;
  }

  function rebuildVisibleEdges() {
    const activeIds = activeVisibleNodeIds();
    const filteredNodeIndex = new Map<string, number>();
    for (const [id, idx] of nodeIndex) {
      if (activeIds.has(id)) {
        filteredNodeIndex.set(id, idx);
      }
    }
    edges.rebuild(currentGraph, kinds, filteredNodeIndex, nodePositions);
  }

  function setNodeVisibilityFromState() {
    const activeIds = activeVisibleNodeIds();
    for (let i = 0; i < currentGraph.nodes.length; i++) {
      nodes.setVisible(i, activeIds.has(currentGraph.nodes[i]!.id));
    }
    nodes.flush();
    // Filter/focus toggles change the active set without going through
    // replaceActive; wake physics so the layout can re-equilibrate for
    // the new visible node set. The gate will re-arm after the
    // simulation re-settles.
    simState.wakePhysics();
  }

  const EDGE_KIND_LABELS: Record<TheiaGraph["edges"][number]["kind"], string> =
    {
      "memory-share": "memory share",
      "cross-search": "cross-search",
      "tool-overlap": "tool overlap",
      subagent: "subagent",
      "cron-chain": "cron chain",
    };

  function applyChainSelection(edge: TheiaGraph["edges"][number]) {
    const { nodes: chainNodes, edgeCount } = computeEdgeChain(
      currentGraph,
      [edge.source, edge.target],
      kinds,
      visibleNodeIds,
    );
    if (chainNodes.size === 0) return;
    chainEdge = edge;
    chainFilter = chainNodes;
    // Drop any stale 1-hop focus filter — focusFilter is bound to a selected
    // node, and chain mode has no selected node. Leaving it would resurface
    // a stale neighbor set when the chain is cleared.
    focusFilter = null;
    setNodeVisibilityFromState();
    rebuildVisibleEdges();
    showChainOverlay(chainNodes.size, edgeCount, EDGE_KIND_LABELS[edge.kind]);
  }

  function clearChainSelection() {
    if (!chainFilter && !chainEdge && !chainOverlay) return;
    chainFilter = null;
    chainEdge = null;
    chainOverlay?.remove();
    chainOverlay = null;
    setNodeVisibilityFromState();
    rebuildVisibleEdges();
  }

  function showChainOverlay(
    nodeCount: number,
    edgeCount: number,
    kindLabel: string,
  ) {
    if (!chainOverlay)
      chainOverlay = createChainOverlay(element, theme, () =>
        clearChainSelection(),
      );
    chainOverlay.update(nodeCount, edgeCount, kindLabel);
  }

  function applyFocusModeIfEnabled(selectedNodeId: string) {
    let touched = false;
    if (focusEnabled) {
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
      focusFilter = neighbors;
      touched = true;
    } else if (focusFilter) {
      focusFilter = null;
      touched = true;
    }

    if (componentFocusEnabled) {
      const selected = currentGraph.nodes.find((n) => n.id === selectedNodeId);
      const cid = selected?.metadata?.component_id;
      if (cid !== undefined && cid !== null) {
        const sameComponent = new Set<string>();
        for (const node of currentGraph.nodes) {
          if (node.metadata?.component_id === cid) sameComponent.add(node.id);
        }
        componentFilter = sameComponent;
      } else {
        // Selected node has no labeled component (small fragment) — don't
        // collapse the canvas to a single point; just clear the filter.
        componentFilter = null;
      }
      touched = true;
    } else if (componentFilter) {
      componentFilter = null;
      touched = true;
    }

    if (touched) {
      setNodeVisibilityFromState();
      rebuildVisibleEdges();
    }
  }

  function shouldRunOnboarding(g: TheiaGraph): boolean {
    return g.nodes.length > 0 && !hasCompletedOnboarding();
  }

  function beginOnboarding(g: TheiaGraph) {
    const order = g.nodes
      .map((node, index) => ({ index, time: Date.parse(node.started_at) }))
      .sort((a, b) => {
        const at = Number.isFinite(a.time) ? a.time : Number.POSITIVE_INFINITY;
        const bt = Number.isFinite(b.time) ? b.time : Number.POSITIVE_INFINITY;
        return at - bt || a.index - b.index;
      })
      .map(({ index }) => index);
    onboarding = {
      startedAt: performance.now(),
      durationMs: Math.max(1, Math.ceil(g.nodes.length / 3)) * 1000,
      order,
      rankByIndex: new Map(order.map((index, rank) => [index, rank])),
      revealedNodeIds: new Set(),
      revealStartedAtByIndex: new Map(),
      linkStartedAtByKey: new Map(),
      lastRevealedCount: 0,
      lastEase: 0,
      cameraZoom: ONBOARDING_BASE_ZOOM,
      cameraAutoZoomEnabled: true,
      complete: false,
      overlay: createOnboardingOverlay(element),
    };
    ctx.setZoom(ONBOARDING_BASE_ZOOM);
    for (let i = 0; i < g.nodes.length; i++) {
      nodes.setRevealScale(i, 0);
      nodes.setBrightness(i, 0);
    }
    setNodeVisibilityFromState();
    rebuildVisibleEdges();
    simState.replaceActive({
      activeIds: activeVisibleNodeIds(),
      animateNew: true,
    });
  }

  function updateOnboardingLinks(now: number) {
    if (!onboarding) {
      edges.setConnectionProgress(null);
      return;
    }
    for (const edge of currentGraph.edges) {
      if (
        onboarding.revealedNodeIds.has(edge.source) &&
        onboarding.revealedNodeIds.has(edge.target)
      ) {
        const key = edgeKey(edge);
        if (!onboarding.linkStartedAtByKey.has(key)) {
          onboarding.linkStartedAtByKey.set(key, now);
        }
      }
    }
    edges.setConnectionProgress((edge) => {
      const startedAt = onboarding?.linkStartedAtByKey.get(edgeKey(edge));
      if (startedAt === undefined) return 0;
      return easeQuadInOut(
        Math.min(1, (now - startedAt) / ONBOARDING_LINK_UP_MS),
      );
    });
  }

  function updateOnboarding(now: number) {
    if (!onboarding) return;
    const raw = Math.min(
      1,
      (now - onboarding.startedAt) / onboarding.durationMs,
    );
    const eased = easeQuadInOut(raw);
    const revealFloat = eased * onboarding.order.length;
    const revealCount = Math.min(
      onboarding.order.length,
      Math.ceil(revealFloat),
    );

    for (let rank = onboarding.lastRevealedCount; rank < revealCount; rank++) {
      const idx = onboarding.order[rank]!;
      onboarding.revealedNodeIds.add(currentGraph.nodes[idx]!.id);
      onboarding.revealStartedAtByIndex.set(idx, now);
    }

    for (const idx of onboarding.order) {
      const rank = onboarding.rankByIndex.get(idx)!;
      const localProgress = Math.max(0, Math.min(1, revealFloat - rank));
      nodes.setRevealScale(idx, popScale(localProgress));
      const revealedAt = onboarding.revealStartedAtByIndex.get(idx);
      const blinkProgress =
        revealedAt === undefined
          ? 0
          : Math.min(1, (now - revealedAt) / ONBOARDING_BLINK_MS);
      nodes.setBrightness(idx, revealBrightness(blinkProgress));
    }
    updateOnboardingLinks(now);

    const rotationDelta =
      (eased - onboarding.lastEase) * ONBOARDING_ROTATION_RADIANS;
    if (rotationDelta !== 0) {
      const state = ctx.getCameraState();
      ctx.setCameraState({ ...state, theta: state.theta + rotationDelta });
    }

    if (revealCount !== onboarding.lastRevealedCount) {
      onboarding.lastRevealedCount = revealCount;
      setNodeVisibilityFromState();
      rebuildVisibleEdges();
      simState.replaceActive({
      activeIds: activeVisibleNodeIds(),
      animateNew: true,
    });
    }
    onboarding.lastEase = eased;
    onboarding.overlay.update(eased);

    if (raw >= 1 && !onboarding.complete) {
      for (const idx of onboarding.order) {
        onboarding.revealedNodeIds.add(currentGraph.nodes[idx]!.id);
        nodes.setRevealScale(idx, 1);
        if (!onboarding.revealStartedAtByIndex.has(idx)) {
          onboarding.revealStartedAtByIndex.set(idx, now);
        }
      }
      onboarding.complete = true;
      markOnboardingComplete();
      onboarding.overlay.remove();
      setNodeVisibilityFromState();
      rebuildVisibleEdges();
      updateOnboardingLinks(now);
      savePhysicsSnapshot();
    }

    if (onboarding.complete) {
      let allBlinkDone = true;
      for (const idx of onboarding.order) {
        const revealedAt = onboarding.revealStartedAtByIndex.get(idx) ?? now;
        const blinkProgress = Math.min(
          1,
          (now - revealedAt) / ONBOARDING_BLINK_MS,
        );
        nodes.setBrightness(idx, revealBrightness(blinkProgress));
        allBlinkDone &&= blinkProgress >= 1;
      }
      if (allBlinkDone) {
        for (const idx of onboarding.order) {
          nodes.setBrightness(idx, 1);
        }
        onboarding = null;
        edges.setConnectionProgress(null);
      }
    }
  }

  function updateOnboardingCamera() {
    if (!onboarding || onboarding.complete || !onboarding.cameraAutoZoomEnabled)
      return;
    let nearest = Number.POSITIVE_INFINITY;
    for (const idx of onboarding.order) {
      if (!onboarding.revealedNodeIds.has(currentGraph.nodes[idx]!.id)) {
        continue;
      }
      // nodePositions tracks the same per-frame smoothed values that the
      // simulation tick writes; reading from there avoids reaching into
      // the simulation module's private renderedPositions buffer.
      const dx = nodePositions[idx * 3]! - ctx.camera.position.x;
      const dy = nodePositions[idx * 3 + 1]! - ctx.camera.position.y;
      const dz = nodePositions[idx * 3 + 2]! - ctx.camera.position.z;
      nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    if (!Number.isFinite(nearest)) return;

    const crowding = Math.max(
      0,
      Math.min(
        1,
        (ONBOARDING_SAFE_DISTANCE - nearest) /
          (ONBOARDING_SAFE_DISTANCE - ONBOARDING_NEAR_DISTANCE),
      ),
    );
    const targetZoom =
      ONBOARDING_BASE_ZOOM -
      (ONBOARDING_BASE_ZOOM - ONBOARDING_MIN_ZOOM) * easeQuadInOut(crowding);
    onboarding.cameraZoom += (targetZoom - onboarding.cameraZoom) * 0.08;
    ctx.setZoom(onboarding.cameraZoom);
  }

  function setupGraph(g: TheiaGraph) {
    simState?.dispose();
    onboarding?.overlay.remove();
    onboarding = null;
    // Clear any chain isolation from a prior graph: edge identity is
    // graph-scoped, so the previous selection is meaningless once we reload.
    clearChainSelection();

    if (nodes) {
      ctx.scene.remove(nodes.mesh);
      nodes.dispose();
    }

    currentGraph = g;
    nodePositions = new Float32Array(g.nodes.length * 3);
    nodes = createNodes(g, nodePositions);
    ctx.scene.add(nodes.mesh);

    nodeIndex = new Map(g.nodes.map((n, i) => [n.id, i]));
    simState = createSimulationState({
      graph: g,
      kinds,
      isOnboarding: () => Boolean(onboarding && !onboarding.complete),
      nodes,
      edges,
      nodePositions,
    });

    if (hasCompletedOnboarding()) {
      const snapshot = physicsSnapshotIO.load(currentGraphUrl);
      simState.replaceActive({
        activeIds: null,
        animateNew: true,
        preserveExisting: false,
        seedPositions: snapshot.nodes,
      });
      simState.syncRenderedPositionsFromSimulation();
      if (snapshot.camera) {
        ctx.setCameraState(snapshot.camera);
      }
    } else {
      simState.replaceActive({ activeIds: null });
      simState.primeOnce();
      simState.syncRenderedPositionsFromSimulation();
    }

    visibleNodeIds = computeVisibleNodeIds(
      g,
      kinds,
      modelFilter,
      hideOrphansEnabled,
    );
    setNodeVisibilityFromState();
    rebuildVisibleEdges();
    post.resize();

    picker?.dispose();
    picker = createPicker(element, ctx.camera, nodes, nodePositions, {
      shouldBlock: isInteracting,
      isVisible: (i) => {
        if (!activeVisibleNodeIds().has(currentGraph.nodes[i]!.id))
          return false;
        if (focusFilter && !focusFilter.has(currentGraph.nodes[i]!.id))
          return false;
        return true;
      },
      getEdges: () => edges.visibleEdges(),
    });
    picker.onHover((idx) => {
      const nodeId = idx === null ? null : currentGraph.nodes[idx]!.id;
      element.style.cursor = idx === null ? "" : "pointer";
      const focusId = nodeId ?? selectedNodeId();
      edges.setHoverNode(focusId);
      for (let i = 0; i < nodes.count; i++) {
        if (i === idx) {
          nodes.setHighlight(i, true);
        } else if (i !== selectedIdx) {
          nodes.setHighlight(i, false);
        }
      }
      if (focusEnabled) {
        applyDimAround(null);
      } else {
        applyDimAround(focusId);
      }
      if (idx !== null) {
        tooltip.show(currentGraph.nodes[idx]!, lastMouse.x, lastMouse.y);
      } else {
        tooltip.hide();
      }
      nodes.flush();
      emit("node-hover", idx === null ? null : currentGraph.nodes[idx]!.id);
    });
    picker.onHoverEdge((edge) => {
      edges.setHoverEdge(edge);
      if (edge !== null) {
        element.style.cursor = "pointer";
      } else if (picker.currentHovered() === null) {
        element.style.cursor = "";
      }
    });

    searchInputController?.abort();
    searchInputController = null;
    if (searchFocusTimer) clearTimeout(searchFocusTimer);
    searchFocusTimer = null;
    searchBar?.dispose();
    searchBar = createSearchBar(
      element,
      currentGraph,
      (result) => {
        const idx = nodeIndex.get(result.node.id);
        if (idx !== undefined && activeVisibleNodeIds().has(result.node.id)) {
          const sn = simState.getNodePosition(idx);
          if (sn) ctx.focusOn(sn.x, sn.y, 1.5);
          select(idx);
        }
        const related = currentGraph.edges.filter(
          (e) =>
            (e.source === result.node.id || e.target === result.node.id) &&
            kinds.has(e.kind),
        );
        enterPanelMode(result.node, related);
        applyFocusModeIfEnabled(result.node.id);
      },
      theme,
      (node) => activeVisibleNodeIds().has(node.id),
    );
    searchInputController = new AbortController();
    searchBar.input.addEventListener(
      "input",
      () => {
        if (searchFocusEnabled) {
          if (searchFocusTimer) clearTimeout(searchFocusTimer);
          searchFocusTimer = setTimeout(() => {
            searchFocusTimer = null;
            const searchMatchesChanged = updateVisibility();
            const id = sidePanel.currentNodeId();
            if (id && searchMatchesChanged) applyFocusModeIfEnabled(id);
          }, 120);
        }
      },
      { signal: searchInputController.signal },
    );
  }

  const loading = createLoadingOverlay(element, "Loading constellation\u2026");
  let initialGraph: TheiaGraph;
  try {
    initialGraph = await loadGraph(graphUrl);
  } catch (err) {
    loading.remove();
    throw err;
  }
  loading.remove();
  setupGraph(initialGraph);
  if (shouldRunOnboarding(initialGraph)) {
    beginOnboarding(initialGraph);
  }

  let disposed = false;
  function frame() {
    if (disposed) return;
    const now = performance.now();
    updateOnboarding(now);
    keyboardNav.tick(now);
    simState.tick();
    maybeSavePhysicsSnapshot(now);
    updateOnboardingCamera();
    const t = now / 1000;
    nodes.setTime(t);
    edges.setTime(t);
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

  function resetDrag() {
    isMouseDown = false;
    hasDragged = false;
    dragMode = null;
  }

  element.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest("[data-ui-overlay]")) return;
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

  function runTapSelection(clientX: number, clientY: number) {
    const idx = picker.pickAt(clientX, clientY, 1.0);
    if (idx !== null) {
      select(idx);
      const n = currentGraph.nodes[idx]!;
      const related = currentGraph.edges.filter(
        (e) => (e.source === n.id || e.target === n.id) && kinds.has(e.kind),
      );
      enterPanelMode(n, related);
      applyFocusModeIfEnabled(n.id);
      emit("node-click", n.id);
      return;
    }
    const pickedEdge = edges.pickAt(ctx.camera, element, clientX, clientY);
    if (pickedEdge && kinds.has(pickedEdge.kind)) {
      clearSelected();
      sidePanel.hide();
      applyChainSelection(pickedEdge);
    } else {
      clearChainSelection();
      clearSelected();
      sidePanel.hide();
    }
  }

  element.addEventListener("mouseup", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("aside") || target.closest("[data-ui-overlay]")) {
      resetDrag();
      return;
    }
    if (isMouseDown && !hasDragged && performance.now() - lastWheelAt >= 200) {
      runTapSelection(e.clientX, e.clientY);
    }
    resetDrag();
  });

  // Catch mouseup outside the element/viewport to prevent stuck drag states
  window.addEventListener("mouseup", resetDrag);

  // Touch tap-to-select. We do not synthesize pan/orbit from touch — that's
  // a future enhancement. preventDefault on a recognized tap suppresses the
  // synthetic mouse event chain so we don't double-select.
  let touchStartPos: { x: number; y: number } | null = null;
  let touchStartAt = 0;
  const TAP_MAX_MOVE_PX = 10;
  const TAP_MAX_DURATION_MS = 500;

  element.addEventListener(
    "touchstart",
    (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("aside") || target.closest("[data-ui-overlay]")) {
        touchStartPos = null;
        return;
      }
      if (e.touches.length !== 1) {
        touchStartPos = null;
        return;
      }
      const t = e.touches[0]!;
      touchStartPos = { x: t.clientX, y: t.clientY };
      touchStartAt = performance.now();
    },
    { passive: true },
  );

  element.addEventListener("touchmove", (e) => {
    if (!touchStartPos || e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const dx = t.clientX - touchStartPos.x;
    const dy = t.clientY - touchStartPos.y;
    if (Math.abs(dx) > TAP_MAX_MOVE_PX || Math.abs(dy) > TAP_MAX_MOVE_PX) {
      touchStartPos = null;
    }
  });

  element.addEventListener("touchend", (e) => {
    if (!touchStartPos) return;
    const elapsed = performance.now() - touchStartAt;
    const startPos = touchStartPos;
    touchStartPos = null;
    if (elapsed > TAP_MAX_DURATION_MS) return;
    // Suppress synthetic mouse events so the mouseup handler doesn't re-run
    // the same selection a moment later.
    e.preventDefault();
    runTapSelection(startPos.x, startPos.y);
  });

  element.addEventListener("touchcancel", () => {
    touchStartPos = null;
  });

  element.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && chainFilter) {
      clearChainSelection();
    }
  };
  window.addEventListener("keydown", onKeyDown);

  // Wheel zoom — let overlay UI (side panel, filter bar, search bar) scroll naturally
  element.addEventListener(
    "wheel",
    (e) => {
      if ((e.target as HTMLElement).closest("[data-ui-overlay]")) return;
      lastWheelAt = performance.now();
      if (onboarding) {
        onboarding.cameraAutoZoomEnabled = false;
        onboarding.cameraZoom = ctx.getZoom();
      }
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
      saveFilterState(
        kinds,
        modelFilter,
        searchFocusEnabled,
        hideOrphansEnabled,
        componentFocusEnabled,
      );
      focusFilter = null;
      // Filter changes can invalidate the chain (an edge kind we traversed
      // through may now be hidden); drop the chain rather than recompute it.
      clearChainSelection();
      updateVisibility();
      const id = sidePanel.currentNodeId();
      if (id) applyFocusModeIfEnabled(id);
    },
    theme,
    {
      initialModel: modelFilter,
      onSearchToggle: () => {
        sidePanel.hide();
        searchBar.input.focus();
      },
      onFocusToggle,
      initialFocusEnabled: focusEnabled,
      onSearchFocusToggle,
      initialSearchFocusEnabled: searchFocusEnabled,
      onHideOrphansToggle,
      initialHideOrphansEnabled: hideOrphansEnabled,
      onComponentFocusToggle,
      initialComponentFocusEnabled: componentFocusEnabled,
    },
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
      savePhysicsSnapshot();
      onboarding?.overlay.remove();
      window.removeEventListener("mouseup", resetDrag);
      window.removeEventListener("keydown", onKeyDown);
      chainOverlay?.remove();
      chainOverlay = null;
      searchInputController?.abort();
      if (searchFocusTimer) clearTimeout(searchFocusTimer);
      stopThemeListener();
      simState.dispose();
      nodes.dispose();
      edges.dispose();
      post.edgesTarget.dispose();
      post.preBloomTarget.dispose();
      post.sceneTarget.dispose();
      post.composer.dispose();
      ctx.dispose();
      tooltip.dispose();
      picker.dispose();
      keyboardNav.dispose();
      sidePanel.dispose();
      filterBar.dispose();
      searchBar.dispose();
    },
    on(event, handler) {
      (listeners[event] ??= []).push(handler as never);
    },
    async reload(url?: string) {
      const targetUrl = url ?? graphUrl;
      currentGraphUrl = targetUrl;

      const loading = createLoadingOverlay(element, "Reloading\u2026");
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
          enterPanelMode(n, related);
          applyFocusModeIfEnabled(n.id);
        }
      }
    },
  };
}
