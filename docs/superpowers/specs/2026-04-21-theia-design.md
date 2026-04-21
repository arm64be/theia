# theia — Design Spec

**Date:** 2026-04-21
**Authors:** zeke, arm64be (aka NOUS), with Claude
**Hackathon deadline:** 2026-05-02
**Status:** Design — awaiting review

---

## 1. What this is

**theia** is a visual companion to the Hermes agentic-workflow system. It turns a collection of Hermes agent sessions into a **semantic constellation**: each session is a node positioned in 2D space by meaning (sessions about similar things sit near each other), with typed edges connecting sessions that actually share state — memories, cross-session searches, tool usage.

The primary goal is **presentation at the hackathon**. A secondary goal is that the visual genuinely supports **post-hoc exploration** of what an agent fleet has been doing. Live monitoring is a future-work story, not MVP.

### Goal priority (locked)

| Priority | Role | Meaning |
|---|---|---|
| **D** | Primary | Demo / showcase piece — the visual is the point. Optimized for a 3-minute live narration. |
| **C** | Advertised | Post-hoc exploration — the visual plausibly helps you notice patterns across sessions. |
| **B** | Aspirational | Live ops — sessions update in real time. Future work, explicitly **out of scope** for MVP. |

Design decisions resolve toward D first, then C; B is only considered when it's free.

---

## 2. Architecture

```
 Hermes session JSONs
       │
       ▼
┌─────────────────┐       CLI build step
│  theia-core   │    python -m theia_core \
│  (Python)       │      <sessions_dir> \
│  parse · detect │      -o graph.json
│  · featurize    │
│  · project 2D   │
└─────────────────┘
       │
       ▼
   graph.json  ───── static asset
       │
       ▼
┌────────────────────┐
│   theia-panel    │   fetch('/graph.json')
│   (TypeScript)     │   → three.js + d3-force-3d
│   render · physics │   → mount(el, graphUrl)
│   · interactions   │
└────────────────────┘
       │
       ▼
 Hermes dashboard panel
```

Two independent packages with the `graph.json` shape as the only contract between them. Either half can be rewritten without touching the other.

### Why this shape

- **Python for ingest/transform:** fastest development path, best ML library ecosystem (scikit-learn, umap-learn, numpy) for projection. No runtime Python in the browser — it's a build step, not a live service.
- **Static `graph.json`:** zero runtime infrastructure (no server, no DB, no auth). Trivially debuggable — open the file. Fast to iterate: re-run the Python CLI, reload the panel.
- **TypeScript + three.js for viz:** native fit with the Hermes dashboard (already TS). three.js is the right tool for the "constellation" aesthetic and keeps the 3D door open without a rewrite.
- **No WASM, no WGPU:** evaluated and rejected for this scope. WGPU adds 2–4 days of plumbing for zero visible gain at 20–200 nodes. WASM was considered for the ingest layer, but Python beats it on dev speed and the ML ecosystem for projection. If a live-ops iteration ever needs in-dashboard compute, Python can move behind a small HTTP endpoint or be reimplemented as a Rust/WASM module then.

### Integration with Hermes dashboard

The Hermes dashboard is TypeScript-based and can load arbitrary TS modules (and, separately, WASM, though we're not using that). `theia-panel` exports:

```ts
export function mount(
  element: HTMLElement,
  graphUrl: string,
  options?: PanelOptions
): Promise<Controller>;
```

The host dashboard creates a container element, calls `mount`, and gets back a `Controller` with `destroy()`, `refresh()`, and event subscriptions. Exact plugin/slot surface in the Hermes dashboard is TBD — confirm during build-out.

---

## 3. Data contract: `graph.json`

This is the contract between `theia-core` (Python, emits) and `theia-panel` (TS, consumes). Both sides validate against it.

> **Note:** Field names below are provisional and will be validated against a real Hermes session JSON sample. Expect minor field renames and possibly one or two new edge-detection signals once we see the real data. The shape itself (nodes with position + features, typed weighted edges) will not change.

```jsonc
{
  "meta": {
    "generated_at": "2026-04-21T15:30:00Z",
    "source_count": 23,
    "projection": "pca",          // "pca" | "umap" | "tool-vector"
    "feature_dim": 64
  },
  "nodes": [
    {
      "id": "sess_abc123",
      "title": "refactor auth middleware",      // derived: task title or first user msg
      "started_at": "2026-04-18T09:14:00Z",
      "duration_sec": 3421,
      "tool_count": 42,
      "message_count": 187,
      "model": "claude-opus-4-7",
      "position": { "x": 0.34, "y": -0.71 },   // precomputed 2D projection, normalized to unit disk (x² + y² ≤ 1)
      "features": null                          // optional raw feature vector for debug
    }
  ],
  "edges": [
    {
      "source": "sess_abc123",
      "target": "sess_def456",
      "kind": "memory-share",                   // see Edge kinds below
      "weight": 0.87,                           // 0..1, drives visual prominence
      "evidence": {                             // small payload for hover/debug; kind-specific
        "memory_id": "mem_789",
        "read_count": 3
      }
    }
  ]
}
```

### Edge kinds

| `kind` | Meaning | Direction | Evidence payload |
|---|---|---|---|
| `memory-share` | Session A wrote a memory that session B later read | A → B | `{ memory_id, read_count, salience }` |
| `cross-search` | Session B performed a search whose hits include artifacts from session A | A → B | `{ query, hit_rank }` |
| `tool-overlap` | Sessions used substantially the same set of tools (Jaccard ≥ threshold) | undirected | `{ jaccard, shared_tools }` |

`memory-share` and `cross-search` are the interesting signals. `tool-overlap` is noisy and is toggled **off by default** in the UI — it's available for the demo moment where we illustrate it.

### Semantic position

Precomputed by `theia-core`:

1. Build a feature vector per session from `{tool-usage histogram, top keywords from user messages, memory-read/write tags}`.
2. Project to 2D with PCA (default) or UMAP (fallback if clusters look mushy).
3. Normalize to the unit disk (x² + y² ≤ 1) so the panel can scale without surprises.

No external embedding APIs in MVP. If Hermes already exposes session embeddings, `theia-core` can consume those as an alternative feature source (feature flag).

---

## 4. `theia-core` (Python)

### Responsibilities

- Walk a directory of Hermes session JSONs.
- Parse each into an internal `Session` struct.
- Detect edges by scanning for cross-session signals (memory IDs, search hits, tool sets).
- Build a feature vector per session.
- Run 2D projection.
- Emit `graph.json`.

### CLI

```
python -m theia_core <sessions_dir> \
    -o graph.json \
    [--projection pca|umap|tool-vector] \
    [--tool-overlap-threshold 0.4] \
    [--include-features]
```

Deterministic: same inputs → same `graph.json`. Random seeds fixed where any stochastic step exists (UMAP).

### Module layout

```
theia_core/
  __main__.py              # CLI entrypoint
  ingest.py                # JSON → Session
  detect/
    memory_share.py        # memory writes/reads → edges
    cross_search.py        # search-hit citations → edges
    tool_overlap.py        # tool-set Jaccard → edges
  features.py              # Session → feature vector
  project.py               # features → 2D position (pca / umap)
  emit.py                  # Graph → graph.json (JSON schema validated)
  schemas/
    graph.schema.json      # JSON Schema for validation
```

### Testing

- Unit tests for each edge detector against hand-crafted fixture sessions.
- A golden fixture: 3–5 synthetic Hermes sessions with known cross-references, asserted against an expected `graph.json`.
- Schema-validate the emitted `graph.json` on every run.

---

## 5. `theia-panel` (TypeScript)

### Responsibilities

- Fetch `graph.json`.
- Render the constellation in a WebGL scene.
- Run force-directed physics with soft anchoring to `position.x/y`.
- Handle hover / click / filter interactions.
- Provide a `mount()` / `destroy()` lifecycle for the host dashboard.

### Public API

```ts
export interface PanelOptions {
  edgeKinds?: Array<'memory-share' | 'cross-search' | 'tool-overlap'>;  // defaults: first two
  bloom?: boolean;                                                       // default true
  dim3?: boolean;                                                        // default false (2D)
}

export interface Controller {
  destroy(): void;
  refresh(): Promise<void>;
  on(event: 'node-click', handler: (id: string) => void): void;
  on(event: 'node-hover', handler: (id: string | null) => void): void;
}

export function mount(
  element: HTMLElement,
  graphUrl: string,
  options?: PanelOptions
): Promise<Controller>;
```

### Rendering pipeline

- **Scene:** three.js `Scene` with an `OrthographicCamera` for MVP 2D (slight angle for subtle depth). Swap to `PerspectiveCamera` for the 3D stretch — no structural change.
- **Nodes:** instanced mesh of glowing circles (sprite with shader-based radial glow). Size = f(`tool_count`). Color = base palette; hue-shifted per cluster.
- **Edges:** `LineSegments` with per-edge color by `kind` (memory = warm, search = cool, overlap = muted). Thin, slightly animated (pulse travels along edges every few seconds).
- **Post-processing:** `EffectComposer` chain — bloom pass (UnrealBloom) + optional film grain. This is where "chic hacker" comes from.
- **Physics:** `d3-force-3d` with `forceLink` for edges, `forceManyBody` for repulsion, and a custom `forceAnchor` that pulls each node toward its `position.x/y` with tunable strength. Alpha decays quickly so the graph settles — then idles with a gentle breathing perturbation for ambient motion.

### Interactions (MVP)

- **Hover node:** highlight node, fade non-incident edges, show tooltip with title / started_at / duration / tool_count.
- **Click node:** open side panel with full session summary + tool trace.
- **Filter bar:** checkboxes for each edge kind. Toggling redraws edges in place.
- **(Optional) search box:** filter nodes by title substring — stretch if time.

### Module layout

```
theia-panel/
  src/
    index.ts               # mount() / Controller
    scene/
      Scene.ts             # three.js scene wiring
      Nodes.ts             # instanced-mesh node layer
      Edges.ts             # edge layer (line segments + shaders)
      Post.ts              # EffectComposer + bloom
    physics/
      Simulation.ts        # d3-force-3d wrapper w/ anchor force
    ui/
      SidePanel.ts         # session detail panel — vanilla TS (no React, keeps dep footprint small)
      FilterBar.ts
      Tooltip.ts
    data/
      load.ts              # fetch + schema-validate graph.json
      types.ts             # Graph/Node/Edge TS types (generated from JSON Schema)
  package.json
  tsconfig.json
  vite.config.ts
```

### Testing

- Smoke test: mount against a fixture `graph.json`, assert the canvas renders N nodes and M edges.
- Interaction tests: hover/click produce expected events.
- Visual regression is **out of scope** — manual eyeballing is fine for hackathon.

---

## 6. Aesthetic direction

- **Palette:** dark background (near-black with subtle hue, not pure #000), node glow in muted warm tones, edge colors per kind (warm amber for memory, cool cyan for search, muted violet for overlap).
- **Motion:** nodes settle into position with ease-out physics. Once settled, a gentle continuous perturbation gives "breathing". Edge pulses travel along lines every few seconds to indicate they're live.
- **Typography:** monospace labels, low weight, glow-on-hover only. Avoid on-node labels by default to keep the constellation clean.
- **Post-processing:** bloom is the defining effect. Tune threshold and radius on day 4, lock on day 8. Optional subtle film grain to break WebGL sterility.

Lock aesthetic decisions by **day 4** (2026-04-24). Do not revisit after **day 8** (2026-04-28) except for show-stopping issues.

---

## 7. Demo narrative (3 minutes, rehearsed)

1. **Reveal (~20s)** — empty dark screen, sessions fade in as glowing points, drift into semantic positions, edges fade up. Hook.
2. **Cluster moment (~40s)** — "these four sessions all pulled from the same memory pool" — click or hover a cluster, its edges light up, tooltips read.
3. **Edge-kind reveal (~40s)** — toggle `memory-share` → `cross-search` → `tool-overlap` one at a time, narrate what each reveals about how the agents talk to each other.
4. **Detail panel (~40s)** — click one node, side panel opens with session summary + tool trace.
5. **Future tease (~20s)** — "in next iteration, this updates live as my agents run — the constellation grows in real time."

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Real Hermes JSON doesn't expose memory reads cleanly, breaking `memory-share` detection | Look at a real sample **before** finalizing `theia-core`. Spec patched in place if field names differ. |
| 20 nodes looks sparse on screen | Include sub-session events (key tool calls, notable memories) as secondary faint nodes; or generate more sessions before demo. |
| PCA/UMAP produces mushy clusters | Try all three projection modes (`pca`, `umap`, `tool-vector`); ship whichever reads best by eye. Stochastic seeds fixed. |
| Aesthetic polish takes longer than budgeted | Day 4 lock on palette/motion/bloom; day 8 freeze. No aesthetic touches after that. |
| Hermes dashboard plugin surface not confirmed | Worst case, ship standalone at a URL; dashboard links to it. Confirm plugin API by day 3. |
| Build/bundle friction with three.js + Vite + Hermes dashboard | Standard integration. Budget 0.5 day for integration on day 9. |

---

## 9. Out of scope (explicit non-goals)

- Live updates / streaming new sessions
- Editing sessions or memories from the panel
- 3D rendering in MVP (stretch only)
- Authentication, multi-user, or any backend state
- Rust/WASM/WGPU in MVP
- Session replay / conversation playback
- Search across all session content (beyond optional title filter)

---

## 10. Stretch goals (in order of attempt, only if time)

1. **3D mode.** `dim3: true` option — unclamp z, switch to `PerspectiveCamera`, slow camera orbit. z-axis encodes time started. Near-free given the stack.
2. **Search bar.** Title substring filter dims non-matching nodes.
3. **Timeline scrubber.** "Play back" the constellation as it grew over time — nodes appear at `started_at`, edges form as memories propagate.
4. **Detail-panel replay.** Step through a session's tool calls inside the side panel.
5. **Live poll.** Periodic fetch of `graph.json`; diff and animate new nodes/edges in. First real step toward the B aspiration.

---

## 11. Milestones

| Day | Date | Milestone |
|---|---|---|
| 1 | 2026-04-21 | Spec approved. Sample Hermes JSON in hand. Repo scaffolded. |
| 2 | 2026-04-22 | `theia-core` ingest + memory-share detection + golden fixture test passing. |
| 3 | 2026-04-23 | `theia-core` cross-search + tool-overlap + PCA projection. Emits valid `graph.json`. |
| 4 | 2026-04-24 | `theia-panel` scaffolded. Nodes + edges rendering from fixture. Aesthetic direction locked. |
| 5 | 2026-04-25 | Physics + semantic anchoring. Bloom pass wired. |
| 6 | 2026-04-26 | Hover/click/tooltip/filter-bar. |
| 7 | 2026-04-27 | Side panel with session details. End-to-end demo playable. |
| 8 | 2026-04-28 | Aesthetic freeze. One stretch goal attempted (3D most likely). |
| 9 | 2026-04-29 | Integration into Hermes dashboard. |
| 10 | 2026-04-30 | Polish pass. Demo rehearsal. Fix anything embarrassing. |
| 11 | 2026-05-01 | Buffer / final rehearsal. |
| — | 2026-05-02 | Hackathon deadline. |

---

## 12. Team

Two devs, both using AI assistants. No half of the codebase is formally "owned" — either dev touches either package. Branch prefixes (§13.2) indicate the *area* being touched, not the author. Pair on the seam (`graph.json` contract, dashboard integration, demo prep).

---

## 13. Collaboration: repo, branching, CI/CD

### 13.1 Repo layout — single monorepo

```
hermes-hackathon-theia/
  theia-core/           # Python package
  theia-panel/          # TypeScript package
  examples/
    sessions/             # sample Hermes session JSONs (real or anonymized)
    graph.json            # canonical output, regenerated by CI
  schemas/
    graph.schema.json     # source of truth for the core↔panel contract
  docs/
    superpowers/specs/
  .github/workflows/
  .pre-commit-config.yaml
```

Monorepo because the contract is tight and the team is small — no cost-benefit case for split repos on an 11-day project.

### 13.2 Branching — trunk-based, short-lived

- `main` is always **demo-runnable**. Do not push broken commits.
- Feature branches, named by the area being touched:
  - `core/<slug>` — changes under `theia-core/`
  - `panel/<slug>` — changes under `theia-panel/`
  - `joint/<slug>` — anything that crosses the seam (schema, dashboard integration, demo prep)
  The prefix drives CI path filtering.
- **Same-day PR lifecycle.** No branches live overnight except emergencies. Hackathon budget.
- Squash-merge via PR. Review from the other dev is "nice to have", not blocking.
- No release branches. No long-lived develop/staging. Tag `v1.0.0-demo` on 2026-05-02.

### 13.3 CI (GitHub Actions)

Four workflows, path-filtered:

| Workflow | Triggers on | Runs |
|---|---|---|
| `core.yml` | `theia-core/**`, `schemas/**` | `pytest`, `ruff check`, `ruff format --check`, `mypy` |
| `panel.yml` | `theia-panel/**`, `schemas/**` | `tsc --noEmit`, `vitest`, `vite build` |
| `contract.yml` | **any** change to `theia-core`, `theia-panel`, `schemas`, or `examples` | Regenerate `examples/graph.json` using current core → validate against `schemas/graph.schema.json` → load in a headless panel smoke-test |
| `preview.yml` | PRs touching `theia-panel/**` or `joint/**` | Build panel with Vite, deploy preview to Vercel/Netlify, post URL on PR |

`contract.yml` is the **guardrail that catches cross-seam breakage.** If core silently changes the shape, contract fails → a `joint/*` PR updates the schema + regenerates TS types deliberately.

`preview.yml` is essential because aesthetic decisions need visual feedback, not prose descriptions.

### 13.4 Schema is the source of truth

- Python `emit.py` validates every `graph.json` against `schemas/graph.schema.json` before writing.
- TS types are **generated** from the schema at build time via `json-schema-to-typescript` (no manual sync; types and schema cannot drift).
- Changing the schema is **always** a `joint/*` PR by convention — signals "both devs check this".

### 13.5 Committed fixtures

- `examples/sessions/*.json` — small set of sanitized real Hermes sessions (seeded day 1).
- `examples/graph.json` — canonical output, regenerated by `contract.yml` on merge to main. Committed so panel development works without Python installed.

### 13.6 Pre-commit hooks

`pre-commit` tool with:
- `ruff format` + `ruff check --fix` on Python
- `prettier --write` on TS/JS/JSON/MD
- `jsonschema` validation on `examples/**/*.json` against the relevant schemas

Install once per dev: `pre-commit install`.

### 13.7 Release

None. Tag `v1.0.0-demo` at the deadline. If we ship post-hackathon, that's a new conversation.

