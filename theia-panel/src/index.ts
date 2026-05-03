import * as THREE from "three";
import { loadGraph } from "./data/load";
import type { TheiaGraph } from "./data/types";
import { createScene } from "./scene/Scene";
import { createNodes, type NodeLayer } from "./scene/Nodes";
import { createEdges } from "./scene/Edges";
import { createPost } from "./scene/Post";
import { createSimulation } from "./physics/Simulation";
import { createPicker } from "./scene/Picker";
import { computeEdgeChain } from "./scene/chain";
import { createTooltip } from "./ui/Tooltip";
import { createFilterBar } from "./ui/FilterBar";
import { createSearchBar } from "./ui/SearchBar";
import { createSidePanel } from "./ui/SidePanel";
import { readTheme, applyTheme, onThemeMessage, FONT_STACK } from "./ui/Theme";
import type { ThemeTokens } from "./ui/Theme";
import { hashN11 } from "./util/hash";

export interface PanelOptions {
  edgeKinds?: TheiaGraph["edges"][number]["kind"][];
}

export interface Controller {
  destroy(): void;
  on(event: "node-click", handler: (nodeId: string) => void): void;
  on(event: "node-hover", handler: (nodeId: string | null) => void): void;
  reload(graphUrl?: string): Promise<void>;
}

const VALID_KINDS: TheiaGraph["edges"][number]["kind"][] = [
  "memory-share",
  "cross-search",
  "tool-overlap",
  "subagent",
  "cron-chain",
];

const DEFAULT_KINDS: TheiaGraph["edges"][number]["kind"][] = VALID_KINDS;

const STORAGE_KEY = "theia-constellation-filter";
const ONBOARDING_STORAGE_KEY = "theia-first-load-onboarding-complete";
const PHYSICS_SNAPSHOT_KEY_PREFIX = "theia-physics-snapshot:";
const ONBOARDING_ROTATION_RADIANS = Math.PI * 1.15;
const ONBOARDING_BLINK_MS = 3200;
const ONBOARDING_LINK_UP_MS = 700;
const PHYSICS_SNAPSHOT_INTERVAL_MS = 5000;
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

type PhysicsSnapshotNode = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
};

function physicsSnapshotKey(graphUrl: string): string {
  return `${PHYSICS_SNAPSHOT_KEY_PREFIX}${graphUrl}`;
}

type PhysicsSnapshot = {
  nodes: Map<string, PhysicsSnapshotNode>;
  camera: ReturnType<ReturnType<typeof createScene>["getCameraState"]> | null;
};

function loadFilterState(): {
  kinds: Set<TheiaGraph["edges"][number]["kind"]>;
  model: string | null;
  searchFocus: boolean;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const parsedKinds = Array.isArray(parsed?.kinds)
      ? parsed.kinds.filter(
          (k: unknown): k is TheiaGraph["edges"][number]["kind"] =>
            (VALID_KINDS as readonly unknown[]).includes(k),
        )
      : DEFAULT_KINDS;
    return {
      kinds: new Set(parsedKinds.length > 0 ? parsedKinds : DEFAULT_KINDS),
      model: typeof parsed?.model === "string" ? parsed.model : null,
      searchFocus: parsed?.searchFocus === true,
    };
  } catch {
    return null;
  }
}

function saveFilterState(
  kinds: Set<string>,
  model: string | null,
  searchFocus: boolean,
): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ kinds: Array.from(kinds), model, searchFocus }),
    );
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
  let focusFilter: Set<string> | null = null;
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
  let simNodes: ReturnType<typeof createSimulation>["nodes"] = [];
  let simulation: ReturnType<typeof createSimulation>["simulation"];
  let renderedPositions = new Float32Array(0);
  let picker: ReturnType<typeof createPicker>;
  let searchBar: ReturnType<typeof createSearchBar>;
  let selectedIdx: number | null = null;
  let currentGraphUrl = graphUrl;
  let lastPhysicsSnapshotAt = 0;

  function simulationGraphFor(activeIds: Set<string> | null): TheiaGraph {
    if (!activeIds) return currentGraph;
    return {
      ...currentGraph,
      nodes: currentGraph.nodes.filter((node) => activeIds.has(node.id)),
      edges: currentGraph.edges.filter(
        (edge) => activeIds.has(edge.source) && activeIds.has(edge.target),
      ),
    };
  }

  function replaceSimulation(
    activeIds: Set<string> | null,
    animateNew = false,
    preserveExisting = true,
    seedPositions = new Map<string, PhysicsSnapshotNode>(),
  ) {
    const oldPositions = new Map<
      string,
      { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number }
    >();
    for (const sn of simNodes) {
      if (sn) {
        oldPositions.set(sn.id, {
          x: sn.x,
          y: sn.y,
          z: sn.z,
          vx: sn.vx,
          vy: sn.vy,
          vz: sn.vz,
        });
      }
    }

    simulation?.stop();
    const simResult = createSimulation(
      simulationGraphFor(activeIds),
      kinds,
      onboarding && !onboarding.complete ? "onboarding" : "normal",
    );
    simulation = simResult.simulation;
    simulation.stop();

    const nextNodes = new Array(currentGraph.nodes.length) as typeof simNodes;
    for (const sn of simResult.nodes) {
      const idx = nodeIndex.get(sn.id);
      if (idx === undefined) continue;
      const old = preserveExisting ? oldPositions.get(sn.id) : undefined;
      const seed = seedPositions.get(sn.id);
      if (old || seed) {
        const source = old ?? seed!;
        sn.x = source.x;
        sn.y = source.y;
        sn.z = source.z;
        sn.vx = source.vx ?? 0;
        sn.vy = source.vy ?? 0;
        sn.vz = source.vz ?? 0;
      } else if (animateNew) {
        const jitter = 0.08;
        sn.x = sn.anchorX * 0.55 + hashN11(`${sn.id}:x`) * jitter;
        sn.y = sn.anchorY * 0.55 + hashN11(`${sn.id}:y`) * jitter;
        sn.z = sn.anchorZ * 0.55 + hashN11(`${sn.id}:z`) * jitter;
        sn.vx = (sn.anchorX - sn.x) * 0.006;
        sn.vy = (sn.anchorY - sn.y) * 0.006;
        sn.vz = (sn.anchorZ - sn.z) * 0.006;
        renderedPositions[idx * 3] = sn.x;
        renderedPositions[idx * 3 + 1] = sn.y;
        renderedPositions[idx * 3 + 2] = sn.z;
        nodes?.setPosition(idx, sn.x, sn.y, sn.z);
      }
      nextNodes[idx] = sn;
    }
    simNodes = nextNodes;
    simulation.alpha(animateNew ? 0.22 : simulation.alphaTarget());
  }

  function syncRenderedPositionsFromSimulation() {
    for (let i = 0; i < simNodes.length; i++) {
      const sn = simNodes[i];
      if (!sn) continue;
      renderedPositions[i * 3] = sn.x;
      renderedPositions[i * 3 + 1] = sn.y;
      renderedPositions[i * 3 + 2] = sn.z;
      nodes.setPosition(i, sn.x, sn.y, sn.z);
    }
    nodes.flush();
    edges.updatePositions(nodePositions);
  }

  function loadPhysicsSnapshot(): PhysicsSnapshot {
    try {
      const raw = localStorage.getItem(physicsSnapshotKey(currentGraphUrl));
      if (!raw) return { nodes: new Map(), camera: null };
      const parsed = JSON.parse(raw);
      const nodesById = parsed?.nodes;
      if (!nodesById || typeof nodesById !== "object") {
        return { nodes: new Map(), camera: null };
      }
      const snapshot = new Map<string, PhysicsSnapshotNode>();
      for (const [id, value] of Object.entries(nodesById)) {
        if (!value || typeof value !== "object") continue;
        const node = value as Record<string, unknown>;
        const x = Number(node.x);
        const y = Number(node.y);
        const z = Number(node.z);
        const vx = Number(node.vx ?? 0);
        const vy = Number(node.vy ?? 0);
        const vz = Number(node.vz ?? 0);
        if ([x, y, z, vx, vy, vz].every(Number.isFinite)) {
          snapshot.set(id, { x, y, z, vx, vy, vz });
        }
      }
      const cameraRaw = parsed?.camera;
      const targetRaw = cameraRaw?.target;
      const camera =
        cameraRaw &&
        targetRaw &&
        [
          targetRaw.x,
          targetRaw.y,
          targetRaw.z,
          cameraRaw.theta,
          cameraRaw.phi,
          cameraRaw.zoom,
        ]
          .map(Number)
          .every(Number.isFinite)
          ? {
              target: {
                x: Number(targetRaw.x),
                y: Number(targetRaw.y),
                z: Number(targetRaw.z),
              },
              theta: Number(cameraRaw.theta),
              phi: Number(cameraRaw.phi),
              zoom: Number(cameraRaw.zoom),
            }
          : null;
      return { nodes: snapshot, camera };
    } catch {
      return { nodes: new Map(), camera: null };
    }
  }

  function savePhysicsSnapshot() {
    if (!currentGraph || !hasCompletedOnboarding()) return;
    if (onboarding && !onboarding.complete) return;
    const nodesById: Record<string, PhysicsSnapshotNode> = {};
    for (const sn of simNodes) {
      if (!sn) continue;
      nodesById[sn.id] = {
        x: sn.x,
        y: sn.y,
        z: sn.z,
        vx: sn.vx ?? 0,
        vy: sn.vy ?? 0,
        vz: sn.vz ?? 0,
      };
    }
    try {
      localStorage.setItem(
        physicsSnapshotKey(currentGraphUrl),
        JSON.stringify({
          version: 1,
          saved_at: Date.now(),
          nodes: nodesById,
          camera: ctx.getCameraState(),
        }),
      );
    } catch {
      /* quota exceeded, ignore */
    }
  }

  function maybeSavePhysicsSnapshot(now: number) {
    if (now - lastPhysicsSnapshotAt < PHYSICS_SNAPSHOT_INTERVAL_MS) return;
    lastPhysicsSnapshotAt = now;
    savePhysicsSnapshot();
  }

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
    saveFilterState(kinds, modelFilter, searchFocusEnabled);
    const searchMatchesChanged = updateVisibility();
    const id = sidePanel.currentNodeId();
    if (id && searchMatchesChanged) applyFocusModeIfEnabled(id);
  }

  const sidePanel = createSidePanel(element, theme, {
    onNavigate: (targetId) => {
      const idx = nodeIndex.get(targetId);
      if (idx === undefined || !activeVisibleNodeIds().has(targetId)) return;
      const sn = simNodes[idx];
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

  function activeVisibleNodeIds(): Set<string> {
    let ids = visibleNodeIds;
    // chainFilter (depth-N isolation from a clicked edge) takes precedence
    // over the depth-1 focusFilter; the two are conceptually different modes.
    if (chainFilter) {
      ids = new Set([...ids].filter((id) => chainFilter!.has(id)));
    } else if (focusFilter) {
      ids = new Set([...ids].filter((id) => focusFilter!.has(id)));
    }
    if (onboarding) {
      ids = new Set(
        [...ids].filter((id) => onboarding!.revealedNodeIds.has(id)),
      );
    }
    return ids;
  }

  function updateVisibility(): boolean {
    visibleNodeIds = computeVisibleNodeIds(currentGraph, kinds, modelFilter);
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
    replaceSimulation(onboarding ? activeVisibleNodeIds() : null);

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
      chainOverlay = createChainOverlay(() => clearChainSelection());
    chainOverlay.update(nodeCount, edgeCount, kindLabel);
  }

  function applyFocusModeIfEnabled(selectedNodeId: string) {
    if (!focusEnabled) {
      focusFilter = null;
      return;
    }
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
    setNodeVisibilityFromState();
    rebuildVisibleEdges();
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
      overlay: createOnboardingOverlay(),
    };
    ctx.setZoom(ONBOARDING_BASE_ZOOM);
    for (let i = 0; i < g.nodes.length; i++) {
      nodes.setRevealScale(i, 0);
      nodes.setBrightness(i, 0);
    }
    setNodeVisibilityFromState();
    rebuildVisibleEdges();
    replaceSimulation(activeVisibleNodeIds(), true);
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
      replaceSimulation(activeVisibleNodeIds(), true);
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
      const dx = renderedPositions[idx * 3]! - ctx.camera.position.x;
      const dy = renderedPositions[idx * 3 + 1]! - ctx.camera.position.y;
      const dz = renderedPositions[idx * 3 + 2]! - ctx.camera.position.z;
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
    simulation?.stop();
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
    renderedPositions = new Float32Array(g.nodes.length * 3);
    nodes = createNodes(g, nodePositions);
    ctx.scene.add(nodes.mesh);

    nodeIndex = new Map(g.nodes.map((n, i) => [n.id, i]));

    if (hasCompletedOnboarding()) {
      const snapshot = loadPhysicsSnapshot();
      replaceSimulation(null, true, false, snapshot.nodes);
      syncRenderedPositionsFromSimulation();
      if (snapshot.camera) {
        ctx.setCameraState(snapshot.camera);
      }
    } else {
      replaceSimulation(null);
      simulation.tick(1);
      syncRenderedPositionsFromSimulation();
    }

    visibleNodeIds = computeVisibleNodeIds(g, kinds, modelFilter);
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
          const sn = simNodes[idx];
          if (sn) ctx.focusOn(sn.x, sn.y, 1.5);
        }
        const related = currentGraph.edges.filter(
          (e) =>
            (e.source === result.node.id || e.target === result.node.id) &&
            kinds.has(e.kind),
        );
        enterPanelMode(result.node, related);
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

  function createChainOverlay(onClear: () => void): {
    update(nodeCount: number, edgeCount: number, label: string): void;
    remove(): void;
  } {
    const el = document.createElement("div");
    el.setAttribute("data-ui-overlay", "true");
    el.style.cssText = `
      position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 10px;
      padding: 6px 10px 6px 12px; border: 1px solid #${theme.border};
      background: rgba(7,8,13,0.78); color: #${theme.fg};
      font: 11px/1.2 var(--theia-font, ${FONT_STACK}); letter-spacing: 0.08em;
      text-transform: uppercase; border-radius: ${theme.radius};
      z-index: 13; cursor: default; backdrop-filter: blur(4px);
    `;
    const label = document.createElement("span");
    el.appendChild(label);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "✕";
    btn.setAttribute("aria-label", "Clear chain selection");
    btn.style.cssText = `
      appearance: none; border: 0; background: transparent; cursor: pointer;
      color: #${theme.fg2}; font: inherit; padding: 0 2px; line-height: 1;
    `;
    btn.onmouseenter = () => {
      btn.style.color = `#${theme.accent}`;
    };
    btn.onmouseleave = () => {
      btn.style.color = `#${theme.fg2}`;
    };
    btn.onclick = (e) => {
      e.stopPropagation();
      onClear();
    };
    el.appendChild(btn);
    element.appendChild(el);
    return {
      update(nodeCount, edgeCount, kindLabel) {
        label.textContent = `chain · ${kindLabel} · ${nodeCount} node${nodeCount === 1 ? "" : "s"}, ${edgeCount} edge${edgeCount === 1 ? "" : "s"}`;
      },
      remove() {
        try {
          element.removeChild(el);
        } catch {
          /* container may have been destroyed */
        }
      },
    };
  }

  function createOnboardingOverlay(): {
    update(progress: number): void;
    remove(): void;
  } {
    const el = document.createElement("div");
    el.setAttribute("data-ui-overlay", "true");
    el.style.cssText = `
      position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%);
      color: rgba(255,255,255,0.58); font: 11px/1.2 var(--theia-font, ${FONT_STACK});
      letter-spacing: 0.18em; text-transform: uppercase; z-index: 12;
      pointer-events: none; text-align: center; transition: opacity 450ms;
    `;
    element.appendChild(el);
    return {
      update(progress) {
        const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
        el.textContent = `CREATING THE UNIVERSE - ${pct}%`;
      },
      remove() {
        el.style.opacity = "0";
        setTimeout(() => {
          try {
            element.removeChild(el);
          } catch {
            /* container may have been destroyed */
          }
        }, 450);
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
  if (shouldRunOnboarding(initialGraph)) {
    beginOnboarding(initialGraph);
  }

  function tick() {
    simulation.tick(1);
    const smoothing = onboarding ? 0.14 : 0.34;
    for (let i = 0; i < simNodes.length; i++) {
      const sn = simNodes[i];
      if (!sn) continue;
      const px = renderedPositions[i * 3]!;
      const py = renderedPositions[i * 3 + 1]!;
      const pz = renderedPositions[i * 3 + 2]!;
      const x = px + (sn.x - px) * smoothing;
      const y = py + (sn.y - py) * smoothing;
      const z = pz + (sn.z - pz) * smoothing;
      renderedPositions[i * 3] = x;
      renderedPositions[i * 3 + 1] = y;
      renderedPositions[i * 3 + 2] = z;
      nodes.setPosition(i, x, y, z);
    }
    nodes.flush();
    edges.updatePositions(nodePositions);
  }

  let disposed = false;
  function frame() {
    if (disposed) return;
    const now = performance.now();
    updateOnboarding(now);
    tick();
    maybeSavePhysicsSnapshot(now);
    updateOnboardingCamera();
    const t = now / 1000;
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

  element.addEventListener("mouseup", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("aside") || target.closest("[data-ui-overlay]")) {
      resetDrag();
      return;
    }
    if (isMouseDown && !hasDragged && performance.now() - lastWheelAt >= 200) {
      const idx = picker.pickAt(e.clientX, e.clientY, 1.0);
      if (idx !== null) {
        select(idx);
        const n = currentGraph.nodes[idx]!;
        const related = currentGraph.edges.filter(
          (e) => (e.source === n.id || e.target === n.id) && kinds.has(e.kind),
        );
        enterPanelMode(n, related);
        applyFocusModeIfEnabled(n.id);
        emit("node-click", n.id);
      } else {
        const pickedEdge = edges.pickAt(
          ctx.camera,
          element,
          e.clientX,
          e.clientY,
        );
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
    }
    resetDrag();
  });

  // Catch mouseup outside the element/viewport to prevent stuck drag states
  window.addEventListener("mouseup", resetDrag);

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
      saveFilterState(kinds, modelFilter, searchFocusEnabled);
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
      currentGraphUrl = targetUrl;

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
          enterPanelMode(n, related);
          applyFocusModeIfEnabled(n.id);
        }
      }
    },
  };
}
