# Changelog

All notable changes to the theia-panel and supporting code are recorded here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dates use ISO 8601.

## [Unreleased]

## [0.2.0] - 2026-05-04

Layout, view-control, and onboarding-polish window. Adds three
bottom-right controls (Optimize layout, Home, Jump-to-node), reworks
the onboarding reveal so it no longer stutters, retunes node colors
to a stellar classification ramp, and fixes several camera issues.

### Added
- **Optimize layout button.** Bottom-right control that re-converges
  the force simulation in place. The worker handler (`relayout`) tunes
  the existing forces — boosts cluster pull, mildly lifts many-body
  repulsion (scaled by active node count: ~-0.046 at N=100, ~-0.07 at
  N=1000, capped at -0.075), and softens the anchor pull from 0.14 to
  0.06 — then bumps alpha to 1.0. Nodes redistribute toward better
  spacing and tighter neighbor groups without re-randomizing.
  *(`physics/SimulationWorker.ts` `applyRelayout`, `physics/Simulation.ts`
  strength setters on `forceAnchor`/`forceCluster`,
  `state/simulation.ts` `optimize()`, `ui/Overlays.ts`
  `createControlsOverlay`.)*
- **Home button (⌂).** Animates the camera back to the initial fitted
  view — origin target, default zoom 0.5, front-on rotation — over
  700 ms with the same cubic easing as `focusOn`. Backed by a new
  `ctx.resetView()` on `SceneContext`. *(`scene/Scene.ts` `resetView`,
  `ui/Overlays.ts`.)*
- **Jump-to-node toggle (◎).** Default on. Gates camera focus on
  every selection path: search-result picks, side-panel navigation,
  and direct 3D clicks. Off keeps the camera put while still
  selecting + opening the side panel. In-memory only (no
  persistence). *(`index.ts` gating around the three `focusOn`
  callsites; `ui/Overlays.ts` `applyJumpState`.)*
- **OFGKM stellar-classification node color gradient.** Replaces the
  prior B/A/F intermediate stops with the textbook OFGKM stops
  (Blue / White / Yellow / Orange / Red) plus a dark-red final stop
  for the oldest origin nodes. Date → spectral class mapping reads
  more cleanly. *(`scene/Nodes.ts`.)*
- **Progressive zoom-out during onboarding.** Camera widens as more
  nodes appear so the constellation stays fully visible through the
  reveal. Pairs with the slower onboarding cadence and reduced
  supernova burst. *(`state/onboarding.ts`.)*
- **Slow easeQuadInOut warmup before main onboarding reveal.** The
  first dozen-or-so nodes ease in on a wider curve before the bulk
  reveal kicks in, so the opening doesn't feel abrupt.
  *(`state/onboarding.ts`.)*
- **Adaptive pop duration from spawn interval.** The per-node pop
  scales its duration to the current spawn interval, so cadence and
  pop length stay coherent as group rates change.
  *(`state/onboarding.ts`.)*

### Changed
- **Onboarding reveal rewritten around per-node wall-clock easing.**
  Drops the group-warmup + supernova-burst layering in favor of a
  single per-node ease-in driven by wall-clock time. Adds piecewise
  reveal cadence — first ~16 nodes at the original pace, then t²
  ramp — and a 24 s cap. The previous design scheduled large groups
  per frame and stuttered on the heaviest reveals.
  *(`state/onboarding.ts`.)*
- **Chain overlay moved to bottom-center, restyled to match the
  search bar.** Same border / background-alpha / blur tokens as the
  search input, lower z-conflict with the filter dropdown.
  *(`ui/Overlays.ts` `createChainOverlay`.)*
- **Onboarding extracted to `state/onboarding.ts`.** Pulls the
  reveal/zoom/burst logic out of `index.ts` into a focused module
  with `createOnboarding`, `hasCompletedOnboarding`, and an
  `OnboardingController` interface. Pure restructuring; no behavior
  change in that commit. *(`state/onboarding.ts`, `index.ts`.)*
- **Search dropdown perf: pre-lowercased fields, capped visible
  results, delegated listeners.** Pre-lowercases title/id/preview/
  summary/initial-prompt once at construction; the matching path now
  does a single lowercased query + `.includes()` instead of five
  `.toLowerCase()` calls per node per keystroke. Visible dropdown
  capped at 50 entries — match cache still tracks the full set for
  the search-focus filter. *(`ui/SearchBar.ts`.)*
- **Optimize-layout-button styling for `createControlsOverlay`.**
  The standalone optimize overlay was replaced by a unified flex bar
  hosting all three controls, so they share alignment, gap, and
  hover treatment. *(`ui/Overlays.ts`.)*

### Fixed
- **Camera near/far adapted to orbit radius.** Far-side nodes used
  to clip when zoomed in; close ones clipped when zoomed out. Near
  is now `radius * 0.01` (min 0.01) and far is `radius +
  SCENE_EXTENT`, recomputed inside `updateCamera()`. *(`scene/Scene.ts`.)*
- **Rotation clipping, slow pan, inverted W/S keys.** Several
  camera-control issues bundled — rotation no longer clamps mid-
  motion, pan speed is corrected, and the WASD bindings match
  on-screen orientation. *(`scene/KeyboardNav.ts`, `scene/Scene.ts`.)*
- **Jump-to-node toggle now affects direct 3D clicks.** The first
  cut only gated `focusOn` on search results and side-panel
  navigation; direct clicks never called `focusOn` at all, making
  the toggle look broken from the user's most common interaction
  path. *(`index.ts` `runTapSelection`.)*
- **Onboarding stutter on heavy reveals.** Throttles the worker
  rebuild on incremental reveals, skips no-op (already-settled)
  nodes, marks newly added nodes visible immediately while only
  deferring the heavy rebuild, and snaps `popScale` to 1 on the
  reveal frame so the first frame doesn't hide the node behind a
  zero-scale matrix. *(`state/onboarding.ts`.)*
- **Visible first-node pop, quadratic group rate, 24 s cap.**
  Resolves a regression where the very first reveal frame hid the
  hero node, plus tunes the group rate to a quadratic curve and
  caps total reveal time at 24 s on large graphs.
  *(`state/onboarding.ts`.)*
- **Supernova burst tuning.** 10 % of revealed nodes burst in one
  frame, the remainder ease in on `easeInOutCubic`, balancing
  visual punch against the stutter the all-burst version produced.
  *(`state/onboarding.ts`.)*
- **`ruff format` on `theia_core/detect/topology.py`.** Unblocks the
  release workflow's lint step.

## [0.1.0] - 2026-05-03

First tagged release. Pulls together the chain-isolation, keyboard-nav,
touch-tap, perf, and module-split work landed during the recent feature
window.

### Added
- **Edge-click chain isolation.** Click any visible edge to isolate the full
  connected chain (depth ≥ 1) over currently-enabled edge kinds. A floating
  chip at top center shows `chain · {kind} · N nodes, M edges`; **Esc**, the
  ✕ button, clicking empty space, or changing edge-kind filters clears it.
  Pure-BFS is unit-tested headlessly (`scene/chain.test.ts`, 8 cases).
  *(`scene/Edges.ts` `pickAt`, `scene/chain.ts`, `ui/Overlays.ts`
  `createChainOverlay`, integration in `index.ts`.)*
- **Keyboard navigation for the 3D camera.** WASD pans (screen-relative),
  arrow keys orbit (yaw/pitch), Space zooms in, Ctrl zooms out, Shift held
  triples the speed. Frame-rate-independent integration on the existing
  render tick; ignores key events while text inputs are focused; clears
  pressed-state on `window blur` to prevent stuck keys.
  *(`scene/KeyboardNav.ts`.)*
- **Touch tap-to-select.** Single-finger tap (no drag, < 500 ms) picks
  nodes and edges via the same `runTapSelection` path as mouse click.
  `preventDefault` on a recognized tap suppresses the synthetic mouse
  chain so selection doesn't fire twice.
- **Depth-based edge tint for subagent trees + cron chains.** Visual depth
  cue for hierarchical edges. *(Authored separately, included for context.)*
- **Per-node topology metadata + orphan/component filters.** New filter-bar
  toggles `Hide orphans` and `Component focus`. *(Authored separately.)*
- **Edge hover highlight + dim non-related nodes on hover/select.** Hovering
  a node dims edges and nodes outside its 1-hop neighborhood; hovering an
  edge highlights it. *(Authored separately.)*
- **Stellar age coloring for nodes + search-select dimming.** Nodes are
  tinted by recency on a B/A/F/G/K/M-class color ramp; search-select dims
  non-matches. *(Authored separately.)*

### Changed
- **`index.ts` split into focused modules.** Reduced from 1,573 → ~1,200
  lines by extracting:
  - `state/filterState.ts` (119 lines) — `VALID_KINDS`, `DEFAULT_KINDS`,
    `STORAGE_KEY`, `loadFilterState`, `saveFilterState`,
    `computeVisibleNodeIds`. Pure functions.
  - `state/physicsSnapshot.ts` (144 lines) — `createPhysicsSnapshotIO()`
    factory owns the throttle state; caller passes graphUrl, simNodes, and
    a camera-state getter.
  - `ui/Overlays.ts` (124 lines) — `createLoadingOverlay`,
    `createChainOverlay`, `createOnboardingOverlay`. The container element
    (and theme for the chain chip) become explicit parameters.
  - `state/simulation.ts` (331 lines) — simulation orchestration extracted
    out of `mount()`. *(Authored separately as `d6d3def`.)*

  Pure restructuring; no behavior change. Typecheck, all tests, and
  format-check stayed green at every step.
- **Simulation moved to a Web Worker.** Physics now runs off the main
  thread, freeing render budget for the camera tick and shaders.
  *(Authored separately as `8f3c550`.)*
- **Picker hover raycast throttled to ~50 ms (≈20 fps).** Below the
  perceptual hover-feedback threshold and matches the threejs-interaction
  skill convention. With a few thousand nodes the per-move raycast adds
  up; this is cheap insurance.
- **Shader twinkle/dim moved into the node shader; idle physics gate; DPR
  cap; force rewrites.** Several rendering perf improvements bundled.
  *(Authored separately as `9c467d8`.)*

### Fixed
- *(none in this window)*

### Notes
- Several entries under **Added** and **Changed** are marked *(Authored
  separately)* — these landed during the same window through other PRs and
  are listed here for completeness; see `git log` for primary authorship.

[Unreleased]: https://github.com/arm64be/theia/compare/v0.2.0...dev
[0.2.0]: https://github.com/arm64be/theia/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/arm64be/theia/compare/19b71cc...v0.1.0
