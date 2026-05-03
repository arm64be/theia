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
// (not reveal fraction) so the zoom-out feels steady regardless of the
// reveal cadence.
const ONBOARDING_START_ZOOM = 0.72;
const ONBOARDING_END_ZOOM = 0.32;

// Onboarding duration scales gently with node count, capped so the
// first-load reveal stays in roughly the 5-24s range. Previously this
// was `ceil(N/3) * 1000`, which produced ~9 minutes for a 1.6k-node
// graph. Keep deterministic so the overlay percentage stays meaningful.
const ONBOARDING_MIN_DURATION_MS = 5000;
const ONBOARDING_MAX_DURATION_MS = 24000;
const ONBOARDING_MS_PER_NODE = 9;
function onboardingDurationMs(nodeCount: number): number {
  const raw = ONBOARDING_MIN_DURATION_MS + nodeCount * ONBOARDING_MS_PER_NODE;
  return Math.min(
    ONBOARDING_MAX_DURATION_MS,
    Math.max(ONBOARDING_MIN_DURATION_MS, raw),
  );
}

function easeQuadInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// Group reveal rate: quadratic easeIn (`t²`). Linear was too dense
// at frame 1 ("much at once"); easeInOutCubic was the opposite —
// `cubic(0.1) ≈ 0.004` left the first ~2s essentially empty before
// flooding the worker mid-reveal. Quadratic gives the gradual ramp
// the user wants (1, then 2, then 4…) while still completing on
// schedule.
function onboardingRevealFraction(rawProgress: number): number {
  if (rawProgress <= 0) return 0;
  if (rawProgress >= 1) return 1;
  return rawProgress * rawProgress;
}

// Per-node entry animation. Driven by wall-clock since each node was
// revealed (not by the group rate), so individual nodes animate
// independently regardless of how many siblings reveal alongside.
//
// Curve mirrors the original (pre-extraction) implementation: snap
// to scale=1 instantly on the reveal frame, then a sin overshoot up
// to ~1.28 and back to 1. This is the key fix for "the first node
// doesn't appear" — earlier ease-from-zero curves spent ~150ms at
// near-zero scale before becoming visible, so the user couldn't see
// the lone node that t² spawns at frame 2. Snap-to-1 makes it
// visible *on its reveal frame*, the bounce keeps it satisfying.
const POP_DURATION_MS = 600;
function popScale(now: number, revealedAt: number | undefined): number {
  if (revealedAt === undefined) return 0;
  const raw = (now - revealedAt) / POP_DURATION_MS;
  if (raw < 0) return 0;
  if (raw >= 1) return 1;
  // At raw=0: easeQuadInOut(0)=0 → sin(0)=0 → returns 1. Instant pop.
  const eased = easeQuadInOut(raw);
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
// (rebuildVisibleEdges), and — most expensive — asks the worker to
// recreate the d3-force-3d simulation for the new active set. The
// worker rebuild blocks its own thread for tens of ms at 1.6k nodes,
// pausing position updates and causing visible stutter. 400ms (was
// 150ms) is still well below human reveal-cadence perception while
// cutting rebuild frequency to 2.5/sec.
const HEAVY_REBUILD_INTERVAL_MS = 400;
// Don't rebuild for tiny reveal increments — wait until enough new
// nodes have appeared to be worth a worker resync. Without this, the
// long tail of one-node-per-frame reveals would still trigger a
// rebuild every 400ms with only 1-2 new nodes each time.
function minRebuildDelta(total: number): number {
  return Math.max(20, Math.floor(total * 0.02));
}

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
  revealedNodeIds: Set<string>;
  revealStartedAtByIndex: Map<number, number>;
  linkStartedAtByKey: Map<string, number>;
  lastRevealedCount: number;
  lastHeavyRebuildAt: number;
  lastRebuiltRevealCount: number;
  // Smallest rank whose reveal+blink animation is still in progress.
  // Ranks below this are settled at scale=1, brightness=1; ranks above
  // revealCount aren't yet revealed. Per-frame work only touches the
  // active range, not all N nodes.
  blinkMinRank: number;
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
      revealedNodeIds: new Set(),
      revealStartedAtByIndex: new Map(),
      linkStartedAtByKey: new Map(),
      lastRevealedCount: 0,
      lastHeavyRebuildAt: 0,
      lastRebuiltRevealCount: 0,
      blinkMinRank: 0,
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
    // Camera rotation rides easeQuadInOut; group reveal rate is
    // quadratic (per-node easeOutCubic handles individual entry).
    // Decoupled so camera motion stays smooth as nodes appear.
    const eased = easeQuadInOut(raw);
    const revealFloat = onboardingRevealFraction(raw) * state.order.length;
    const revealCount = Math.min(state.order.length, Math.ceil(revealFloat));

    for (let rank = state.lastRevealedCount; rank < revealCount; rank++) {
      const idx = state.order[rank]!;
      state.revealedNodeIds.add(graph.nodes[idx]!.id);
      state.revealStartedAtByIndex.set(idx, now);
    }

    // Advance blinkMinRank past any rank that has fully settled.
    // Settling them once (scale=1, brightness=1) and skipping in
    // future frames is the big per-frame win — at 1.6k nodes the old
    // loop touched every node every frame.
    while (state.blinkMinRank < revealCount) {
      const idx = state.order[state.blinkMinRank]!;
      const revealedAt = state.revealStartedAtByIndex.get(idx)!;
      if (now - revealedAt < ONBOARDING_BLINK_MS) break;
      nodes.setRevealScale(idx, 1);
      nodes.setBrightness(idx, 1);
      state.blinkMinRank++;
    }
    // Active animation range — only nodes still popping or blinking.
    // Both popScale and brightness are driven by wall-clock since each
    // node was revealed, so per-node animations are independent of the
    // group reveal rate.
    for (let rank = state.blinkMinRank; rank < revealCount; rank++) {
      const idx = state.order[rank]!;
      const revealedAt = state.revealStartedAtByIndex.get(idx)!;
      nodes.setRevealScale(idx, popScale(now, revealedAt));
      const blinkProgress = Math.min(
        1,
        (now - revealedAt) / ONBOARDING_BLINK_MS,
      );
      nodes.setBrightness(idx, revealBrightness(blinkProgress));
    }
    updateOnboardingLinks(now);

    const rotationDelta =
      (eased - state.lastEase) * ONBOARDING_ROTATION_RADIANS;
    if (rotationDelta !== 0) {
      const cam = deps.ctx.getCameraState();
      deps.ctx.setCameraState({ ...cam, theta: cam.theta + rotationDelta });
    }

    const sawNewReveals = revealCount !== state.lastRevealedCount;
    state.lastRevealedCount = revealCount;
    const finalReveal = revealCount === state.order.length;
    const newSinceRebuild = revealCount - state.lastRebuiltRevealCount;
    const enoughNewToRebuild =
      newSinceRebuild >= minRebuildDelta(state.order.length);

    // Make newly revealed nodes visible immediately so they don't wait
    // for the heavy rebuild throttle — that caused "plops" where 20-30
    // nodes appeared at once after a black-screen delay.
    if (sawNewReveals) {
      deps.setNodeVisibilityFromState();
    }

    // Throttle the heavy rebuild path (edges + worker simulation);
    // always force one final rebuild when the last node is revealed.
    if (
      sawNewReveals &&
      (finalReveal ||
        (enoughNewToRebuild &&
          now - state.lastHeavyRebuildAt > HEAVY_REBUILD_INTERVAL_MS))
    ) {
      state.lastHeavyRebuildAt = now;
      state.lastRebuiltRevealCount = revealCount;
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
      // Same active-range trick: settle finished ranks once, only
      // animate the still-blinking tail.
      while (state.blinkMinRank < state.order.length) {
        const idx = state.order[state.blinkMinRank]!;
        const revealedAt = state.revealStartedAtByIndex.get(idx) ?? now;
        if (now - revealedAt < ONBOARDING_BLINK_MS) break;
        nodes.setBrightness(idx, 1);
        state.blinkMinRank++;
      }
      for (let rank = state.blinkMinRank; rank < state.order.length; rank++) {
        const idx = state.order[rank]!;
        const revealedAt = state.revealStartedAtByIndex.get(idx) ?? now;
        const blinkProgress = Math.min(
          1,
          (now - revealedAt) / ONBOARDING_BLINK_MS,
        );
        nodes.setBrightness(idx, revealBrightness(blinkProgress));
      }
      if (state.blinkMinRank >= state.order.length) {
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
