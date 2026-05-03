import type { TheiaGraph } from "../data/types";
import type { NodeLayer } from "../scene/Nodes";
import type { EdgeLayer } from "../scene/Edges";
import type { SceneContext } from "../scene/Scene";
import type { SimulationState } from "./simulation";
import { createOnboardingOverlay } from "../ui/Overlays";

const ONBOARDING_STORAGE_KEY = "theia-first-load-onboarding-complete";
const ONBOARDING_ROTATION_RADIANS = Math.PI * 1.15;
const ONBOARDING_BLINK_MS = 3200;
const ONBOARDING_LINK_UP_MS = 700;
// Camera zoom progressively retreats across the reveal so the user can
// watch the constellation expand into view. Driven by raw time progress
// (not reveal fraction) so the zoom-out feels steady regardless of how
// the supernova-then-easeOutQuad reveal lands nodes.
const ONBOARDING_START_ZOOM = 0.72;
const ONBOARDING_END_ZOOM = 0.32;

// Onboarding duration scales gently with node count, capped so the
// first-load reveal stays in roughly the 5-22s range. Previously this
// was `ceil(N/3) * 1000`, which produced ~9 minutes for a 1.6k-node
// graph. Keep deterministic so the overlay percentage stays meaningful.
const ONBOARDING_MIN_DURATION_MS = 5000;
const ONBOARDING_MAX_DURATION_MS = 22000;
const ONBOARDING_MS_PER_NODE = 9;
function onboardingDurationMs(nodeCount: number): number {
  const raw = ONBOARDING_MIN_DURATION_MS + nodeCount * ONBOARDING_MS_PER_NODE;
  return Math.min(
    ONBOARDING_MAX_DURATION_MS,
    Math.max(ONBOARDING_MIN_DURATION_MS, raw),
  );
}

// Reveal progression: a "supernova" front-loads the first quarter of
// the constellation in the opening burst, then easeOutQuad eases the
// rest in across the remaining duration.
const SUPERNOVA_DURATION_FRAC = 0.18;
const SUPERNOVA_NODE_FRAC = 1 / 4;
function onboardingRevealFraction(rawProgress: number): number {
  if (rawProgress <= 0) return 0;
  if (rawProgress >= 1) return 1;
  if (rawProgress < SUPERNOVA_DURATION_FRAC) {
    // Linear ramp through the supernova window — the per-node popScale
    // animation supplies the explosive visual on top of this.
    return (rawProgress / SUPERNOVA_DURATION_FRAC) * SUPERNOVA_NODE_FRAC;
  }
  const t =
    (rawProgress - SUPERNOVA_DURATION_FRAC) / (1 - SUPERNOVA_DURATION_FRAC);
  // easeOutQuad: 1 - (1-t)²
  const easedRemaining = 1 - (1 - t) * (1 - t);
  return SUPERNOVA_NODE_FRAC + easedRemaining * (1 - SUPERNOVA_NODE_FRAC);
}

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

export function hasCompletedOnboarding(): boolean {
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

// Heavy rebuild throttle. Each rebuild iterates all nodes
// (setNodeVisibilityFromState), regenerates the entire edges geometry
// (rebuildVisibleEdges), and asks the worker to recreate the
// d3-force-3d simulation for the new active set. With reveals crossing
// integer boundaries multiple times per frame at 60Hz, an un-throttled
// version would fire this on essentially every frame.
const HEAVY_REBUILD_INTERVAL_MS = 150;

export interface OnboardingDeps {
  element: HTMLElement;
  /** Lazy accessor — graph reference changes on setupGraph. */
  graph: () => TheiaGraph;
  /** Lazy accessor — NodeLayer is recreated on setupGraph. */
  nodes: () => NodeLayer;
  edges: EdgeLayer;
  ctx: SceneContext;
  simState: () => SimulationState;
  /** Lazy accessor — nodePositions buffer is recreated on setupGraph. */
  nodePositions: () => Float32Array;
  setNodeVisibilityFromState(): void;
  rebuildVisibleEdges(): void;
  activeVisibleNodeIds(): Set<string>;
  edgeKey(edge: TheiaGraph["edges"][number]): string;
  savePhysicsSnapshot(): void;
}

export interface OnboardingController {
  /** Start onboarding for the current graph. */
  begin(): void;
  /** True if onboarding state exists (running OR still blinking). */
  isActive(): boolean;
  /** True after the final reveal — blink phase may still be running. */
  isComplete(): boolean;
  /** Set of node ids that have been revealed so far. Empty when inactive. */
  revealedNodeIds(): Set<string>;
  /** Per-frame update: reveal nodes, drive camera rotation, throttle rebuilds. */
  update(now: number): void;
  /** Per-frame camera-zoom adjustment — pulls back as the reveal progresses. */
  updateCamera(now: number): void;
  /** Disable auto-zoom and capture user's chosen zoom (called from input handlers). */
  onUserZoomChanged(zoom: number): void;
  /** Forcibly tear down — used on graph reload. */
  cancel(): void;
}

interface OnboardingStateInternal {
  startedAt: number;
  durationMs: number;
  order: number[];
  rankByIndex: Map<number, number>;
  revealedNodeIds: Set<string>;
  revealStartedAtByIndex: Map<number, number>;
  linkStartedAtByKey: Map<string, number>;
  lastRevealedCount: number;
  lastHeavyRebuildAt: number;
  lastEase: number;
  cameraZoom: number;
  cameraAutoZoomEnabled: boolean;
  complete: boolean;
  overlay: { update(progress: number): void; remove(): void };
}

const EMPTY_REVEALED = new Set<string>();

export function createOnboarding(deps: OnboardingDeps): OnboardingController {
  let state: OnboardingStateInternal | null = null;

  function begin() {
    const g = deps.graph();
    const order = g.nodes
      .map((node, index) => ({ index, time: Date.parse(node.started_at) }))
      .sort((a, b) => {
        const at = Number.isFinite(a.time) ? a.time : Number.POSITIVE_INFINITY;
        const bt = Number.isFinite(b.time) ? b.time : Number.POSITIVE_INFINITY;
        return at - bt || a.index - b.index;
      })
      .map(({ index }) => index);
    state = {
      startedAt: performance.now(),
      durationMs: onboardingDurationMs(g.nodes.length),
      order,
      rankByIndex: new Map(order.map((index, rank) => [index, rank])),
      revealedNodeIds: new Set(),
      revealStartedAtByIndex: new Map(),
      linkStartedAtByKey: new Map(),
      lastRevealedCount: 0,
      lastHeavyRebuildAt: 0,
      lastEase: 0,
      cameraZoom: ONBOARDING_START_ZOOM,
      cameraAutoZoomEnabled: true,
      complete: false,
      overlay: createOnboardingOverlay(deps.element),
    };
    deps.ctx.setZoom(ONBOARDING_START_ZOOM);
    const nodes = deps.nodes();
    for (let i = 0; i < g.nodes.length; i++) {
      nodes.setRevealScale(i, 0);
      nodes.setBrightness(i, 0);
    }
    deps.setNodeVisibilityFromState();
    deps.rebuildVisibleEdges();
    deps.simState().replaceActive({
      activeIds: deps.activeVisibleNodeIds(),
      animateNew: true,
    });
  }

  function updateOnboardingLinks(now: number) {
    const graph = deps.graph();
    if (!state) {
      deps.edges.setConnectionProgress(null);
      return;
    }
    for (const edge of graph.edges) {
      if (
        state.revealedNodeIds.has(edge.source) &&
        state.revealedNodeIds.has(edge.target)
      ) {
        const key = deps.edgeKey(edge);
        if (!state.linkStartedAtByKey.has(key)) {
          state.linkStartedAtByKey.set(key, now);
        }
      }
    }
    deps.edges.setConnectionProgress((edge) => {
      const startedAt = state?.linkStartedAtByKey.get(deps.edgeKey(edge));
      if (startedAt === undefined) return 0;
      return easeQuadInOut(
        Math.min(1, (now - startedAt) / ONBOARDING_LINK_UP_MS),
      );
    });
  }

  function update(now: number) {
    if (!state) return;
    const graph = deps.graph();
    const nodes = deps.nodes();
    const raw = Math.min(1, (now - state.startedAt) / state.durationMs);
    // Camera rotation rides the smooth in-out curve; reveal rides the
    // supernova-then-easeOutQuad curve. Decoupled so the camera doesn't
    // lurch at the supernova→quad seam.
    const eased = easeQuadInOut(raw);
    const revealFloat = onboardingRevealFraction(raw) * state.order.length;
    const revealCount = Math.min(state.order.length, Math.ceil(revealFloat));

    for (let rank = state.lastRevealedCount; rank < revealCount; rank++) {
      const idx = state.order[rank]!;
      state.revealedNodeIds.add(graph.nodes[idx]!.id);
      state.revealStartedAtByIndex.set(idx, now);
    }

    for (const idx of state.order) {
      const rank = state.rankByIndex.get(idx)!;
      const localProgress = Math.max(0, Math.min(1, revealFloat - rank));
      nodes.setRevealScale(idx, popScale(localProgress));
      const revealedAt = state.revealStartedAtByIndex.get(idx);
      const blinkProgress =
        revealedAt === undefined
          ? 0
          : Math.min(1, (now - revealedAt) / ONBOARDING_BLINK_MS);
      nodes.setBrightness(idx, revealBrightness(blinkProgress));
    }
    updateOnboardingLinks(now);

    const rotationDelta =
      (eased - state.lastEase) * ONBOARDING_ROTATION_RADIANS;
    if (rotationDelta !== 0) {
      const cam = deps.ctx.getCameraState();
      deps.ctx.setCameraState({ ...cam, theta: cam.theta + rotationDelta });
    }

    // Throttle the heavy rebuild path; always force one final rebuild
    // when the last node has been revealed so the simulation gets the
    // full active set before settling.
    const sawNewReveals = revealCount !== state.lastRevealedCount;
    state.lastRevealedCount = revealCount;
    const finalReveal = revealCount === state.order.length;
    if (
      sawNewReveals &&
      (finalReveal ||
        now - state.lastHeavyRebuildAt > HEAVY_REBUILD_INTERVAL_MS)
    ) {
      state.lastHeavyRebuildAt = now;
      deps.setNodeVisibilityFromState();
      deps.rebuildVisibleEdges();
      deps.simState().replaceActive({
        activeIds: deps.activeVisibleNodeIds(),
        animateNew: true,
      });
    }
    state.lastEase = eased;
    state.overlay.update(eased);

    if (raw >= 1 && !state.complete) {
      for (const idx of state.order) {
        state.revealedNodeIds.add(graph.nodes[idx]!.id);
        nodes.setRevealScale(idx, 1);
        if (!state.revealStartedAtByIndex.has(idx)) {
          state.revealStartedAtByIndex.set(idx, now);
        }
      }
      state.complete = true;
      markOnboardingComplete();
      state.overlay.remove();
      deps.setNodeVisibilityFromState();
      deps.rebuildVisibleEdges();
      updateOnboardingLinks(now);
      deps.savePhysicsSnapshot();
    }

    if (state.complete) {
      let allBlinkDone = true;
      for (const idx of state.order) {
        const revealedAt = state.revealStartedAtByIndex.get(idx) ?? now;
        const blinkProgress = Math.min(
          1,
          (now - revealedAt) / ONBOARDING_BLINK_MS,
        );
        nodes.setBrightness(idx, revealBrightness(blinkProgress));
        allBlinkDone &&= blinkProgress >= 1;
      }
      if (allBlinkDone) {
        for (const idx of state.order) {
          nodes.setBrightness(idx, 1);
        }
        state = null;
        deps.edges.setConnectionProgress(null);
      }
    }
  }

  function updateCamera(now: number) {
    if (!state || state.complete || !state.cameraAutoZoomEnabled) return;
    // Time-progressive zoom-out: as the reveal proceeds, the camera
    // pulls back so each newly-revealed node lands inside an
    // ever-widening field of view. easeOutQuad means most of the
    // pull-back happens in the first half — by the time the easeOutQuad
    // reveal phase is filling in the long tail of nodes, the camera is
    // already most of the way out and changes slowly, so the user
    // perceives the constellation expanding into a stable wide shot.
    const raw = Math.min(1, (now - state.startedAt) / state.durationMs);
    const t = 1 - (1 - raw) * (1 - raw); // easeOutQuad
    const targetZoom =
      ONBOARDING_START_ZOOM + (ONBOARDING_END_ZOOM - ONBOARDING_START_ZOOM) * t;
    state.cameraZoom += (targetZoom - state.cameraZoom) * 0.08;
    deps.ctx.setZoom(state.cameraZoom);
  }

  return {
    begin,
    isActive: () => state !== null,
    isComplete: () => state?.complete === true,
    revealedNodeIds: () => state?.revealedNodeIds ?? EMPTY_REVEALED,
    update,
    updateCamera,
    onUserZoomChanged(zoom: number) {
      if (!state) return;
      state.cameraAutoZoomEnabled = false;
      state.cameraZoom = zoom;
    },
    cancel() {
      state?.overlay.remove();
      state = null;
    },
  };
}
