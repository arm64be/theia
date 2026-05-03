# Changelog

All notable changes to the theia-panel and supporting code are recorded here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dates use ISO 8601.

## [Unreleased]

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

[Unreleased]: https://github.com/arm64be/theia/compare/19b71cc...dev
