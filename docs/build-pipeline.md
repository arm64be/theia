# theia Build Pipeline

End-to-end reference for how theia turns raw session archives into the 3D
constellation rendered in Hermes. Use this doc to onboard, to trace failures,
or to reason about CI changes.

## 1. Overview

```
  sessions/               theia-core                    graph.json            theia-panel
  ========                ==========                    ==========            ===========
  *.json / *.jsonl  -->   ingest  -->  detect  -->      nodes[]        -->   mount()  -->  render
                          features     (3 edge          edges[]              (loadGraph,   (three.js
                          project      detectors)       meta{}                scene,        + d3-force-3d)
                          emit                                                simulation)
                          |
                          +-> schema validation against schemas/graph.schema.json
```

Both halves are coupled only through `schemas/graph.schema.json`. Anything
that passes schema validation is a legal `graph.json`.

## 2. `theia-core` build

Single CLI entrypoint, implemented in `theia_core/__main__.py`:

```bash
python -m theia_core examples/sessions -o examples/graph.json \
    [--projection {pca,umap,tool-vector}] \
    [--include-features] \
    [--disable-tool-overlap]
```

Defaults: `--projection umap`, tool-overlap enabled, features omitted.

Stages run in order:

| Stage      | Module                       | Output                                                                 |
|------------|------------------------------|------------------------------------------------------------------------|
| ingest     | `theia_core/ingest.py`       | `list[Session]` parsed from `session_*.json`, `session_cron_*.json`, `*.jsonl`, and hand-crafted fixture JSON. `request_dump_*` is skipped. |
| detect     | `theia_core/detect/`         | `list[Edge]` from three detectors: `memory_share` (shared memory writes), `cross_search` (session_search hits across sessions), `tool_overlap` (shared skills, web_search queries, web_extract URLs). `--disable-tool-overlap` drops the last one. |
| features   | `theia_core/features.py`     | `(matrix, feature_names)` — L2-normalized rows over a tool-count + memory-touched vocabulary. |
| project    | `theia_core/project.py`      | `(n, 2)` positions normalized to the unit disk. PCA, UMAP (falls back to PCA for <5 sessions), or `tool-vector` (top-2-variance features). |
| emit       | `theia_core/emit.py`         | `graph.json` with `meta`, `nodes`, `edges`. Validates with `jsonschema` against `schemas/graph.schema.json` before writing; validation failure raises and nothing is written. `--include-features` inlines each node's feature vector. |

The CLI prints `wrote <path> — N nodes, M edges` on success and exits 0.

## 3. `theia-panel` dev

```bash
cd theia-panel
npm install
npm run dev      # -> vite dev server at http://localhost:5173
```

During `vite` serve, `vite.config.ts` sets `publicDir: "../examples"`, so the
repo's committed `examples/graph.json` is served at `/graph.json`. `index.html`
calls `mount(document.getElementById("app"), "/graph.json")`. Editing
`examples/graph.json` (or re-running `theia-core` against the fixtures) is the
way to preview new data in dev.

`examples/graph.json` is the source of truth for dev and for the contract
workflow.

## 4. `theia-panel` library build

```bash
cd theia-panel
npm run build    # tsc --noEmit && vite build
```

Produces `dist/theia-panel.js` as an ES module (`lib.formats: ["es"]`, entry
`src/index.ts`, name `theia`). The library build does **not** bundle
`graph.json`; the host supplies a URL at mount time. Externals declared in
`rollupOptions.external`: `three`, `d3-force-3d`. The host must provide them
via import map or bundler resolution.

For the mount surface (`mount`, `Controller`, events, lifecycle, CSP notes),
see [`integration.md`](./integration.md).

## 5. CI workflows

All workflows live under `.github/workflows/`. Vercel preview deploys were
removed; deployment now happens inside the Hermes dashboard.

| Workflow       | Triggers (paths)                                                                 | What it runs                                                                                                        | PR job name |
|----------------|----------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|-------------|
| `contract.yml` | push to `main` / PR touching `theia-core/**`, `theia-panel/**`, `schemas/**`, `examples/**` | Install core, regenerate `examples/graph.json` from `examples/sessions`, validate with `check-jsonschema`, then `npm ci`, `generate-types`, and `vitest run` in the panel. | `contract`  |
| `core.yml`     | push to `main` / PR touching `theia-core/**`, `schemas/**`, `core.yml`           | In `theia-core`: `pip install -e ".[dev]"`, `ruff check .`, `ruff format --check .`, `mypy theia_core`, `pytest -q`. | `test`      |
| `panel.yml`    | push to `main` / PR touching `theia-panel/**`, `schemas/**`, `panel.yml`         | In `theia-panel`: `npm ci`, `generate-types`, `typecheck`, `test`, `build`, `format:check`.                         | `build`     |

`contract` is the cross-stack check: it is the only workflow that runs
`theia-core` and `theia-panel` together, so it will fail if the schema or the
generator drift apart from the fixtures.

## 6. Local end-to-end

From a fresh clone:

```bash
# 1. clone (at the monorepo root)
git clone <repo> && cd <repo>/theia

# 2. install theia-core (editable, with dev extras)
cd theia-core
pip install -e ".[dev]"
cd ..

# 3. install theia-panel
cd theia-panel
npm install
npm run generate-types        # regenerate src/data/types.ts from the schema
cd ..

# 4. regenerate graph.json from committed fixtures
python -m theia_core examples/sessions -o examples/graph.json

# 5. run the dev server
cd theia-panel
npm run dev
# open http://localhost:5173
```

## 7. Regenerating the golden fixture

`examples/graph.json` is committed to the repo and is treated as a golden
snapshot. The `contract` workflow regenerates it on every push to `main` and
on every PR that touches the generator, schema, or example inputs.

Running the CLI locally will overwrite `examples/graph.json` in place. The
pipeline is deterministic (UMAP / PCA use a fixed seed of 42; detectors sort
sessions by `started_at`; projection normalizes to the unit disk), so **the
same input session set must produce the same graph**, modulo the
`meta.generated_at` timestamp, which changes every run.

When updating fixtures:

1. Edit or add files in `examples/sessions/`.
2. Re-run `python -m theia_core examples/sessions -o examples/graph.json`.
3. Commit both the session files and the refreshed `graph.json`.
4. Expect the diff to contain the new nodes/edges and a new `generated_at`;
   anything else suggests non-determinism and should be investigated.
