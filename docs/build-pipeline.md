# theia Build Pipeline

End-to-end reference for how theia turns raw session archives into the 3D
constellation rendered in Hermes. Use this doc to onboard, to trace failures,
or to reason about CI changes.

## 1. Overview

```
  $THEIA_HOME/state.db    theia-core                    theia-graph.json      theia-panel
  ====================   ==========                    ================      ===========
  Hermes SQLite  -->   ingest  -->  detect  -->      nodes[]        -->   mount()  -->  render
                       features     (3 edge          edges[]              (loadGraph,   (three.js
                       project      detectors)       meta{}                scene,        + d3-force-3d)
                       emit                                                simulation)
                       |
                       +-> schema validation against schemas/graph.schema.json
```

Both halves are coupled only through `schemas/graph.schema.json`. Anything
that passes schema validation is a legal graph file.

## 2. `theia-core` build

Single CLI entrypoint, implemented in `theia_core/__main__.py`:

```bash
python -m theia_core [--db-path path] [-o out_path] \
    [--projection {pca,umap,tool-vector}] \
    [--include-features] \
    [--disable-tool-overlap] \
    [--watch] [--watch-interval 1.0]
```

Defaults:
- `--db-path`: `$THEIA_HOME/state.db` (default `$HOME/.hermes/state.db`)
- `-o`: `$THEIA_HOME/theia-graph.json` (default `$HOME/.hermes/theia-graph.json`)
- `--projection umap`, tool-overlap enabled, features omitted

Stages run in order:

| Stage      | Module                       | Output                                                                 |
|------------|------------------------------|------------------------------------------------------------------------|
| ingest     | `theia_core/ingest.py`       | `list[Session]` queried from the Hermes SQLite `sessions` and `messages` tables. Only top-level sessions (`parent_session_id IS NULL`) are loaded. Tool calls, memory events, and search hits are reconstructed by parsing JSON stored in `messages.tool_calls`. |
| detect     | `theia_core/detect/`         | `list[Edge]` from three detectors: `memory_share` (shared memory writes), `cross_search` (session_search hits across sessions), `tool_overlap` (shared skills, web_search queries, web_extract URLs). `--disable-tool-overlap` drops the last one. |
| features   | `theia_core/features.py`     | `(matrix, feature_names)` — L2-normalized rows over a tool-count + memory-touched vocabulary. |
| project    | `theia_core/project.py`      | `(n, 2)` positions normalized to the unit disk. PCA, UMAP (falls back to PCA for <5 sessions), or `tool-vector` (top-2-variance features). |
| emit       | `theia_core/emit.py`         | `theia-graph.json` with `meta`, `nodes`, `edges`. Validates with `jsonschema` against `schemas/graph.schema.json` before writing; validation failure raises and nothing is written. `--include-features` inlines each node's feature vector. |

The CLI prints `wrote <path> — N nodes, M edges` on success and exits 0.

## 3. `theia-panel` dev

```bash
cd theia-panel
npm install
npm run dev      # -> vite dev server at http://localhost:5173
```

During `vite` serve, the dev server reads `theia-graph.json` from
`$THEIA_HOME/theia-graph.json` (default `$HOME/.hermes/theia-graph.json`) via
a custom middleware. `index.html` calls
`mount(document.getElementById("app"), "/theia-graph.json")`.

### Dev URL resolution

When `THEIA_ENV=development`, the plugin API's `/config` endpoint returns a
`dev_panel_url` that the dashboard uses to load the panel iframe. The URL is
resolved from the `THEIA_DEV_HOST` environment variable, falling back to
`localhost`:

1. **`THEIA_DEV_HOST`** env var — explicit override (e.g. `THEIA_DEV_HOST=192.168.1.50`)
2. **`localhost`** — fallback when `THEIA_DEV_HOST` is unset

The API does **not** trust `X-Forwarded-Host` or `Host` request headers for
host resolution, preventing origin-steering attacks.

Port is controlled by **`THEIA_DEV_PORT`** (default `5173`). Both the host
and port resolution apply to any environment where `THEIA_ENV=development`.

### Port validation

The API validates the dev port before returning it:

| Rule                      | Reason                                    |
|---------------------------|-------------------------------------------|
| Must be >= 1024           | Ports < 1024 require root privileges on Linux/macOS |
| Must be <= 65535          | Valid TCP port range                      |
| Must not be 9119          | Well-known Hermes internal port            |

If validation fails, `dev_panel_url` is set to `null` and
`dev_panel_error` contains the reason. This prevents the dashboard from
loading a misconfigured panel.

## 4. `theia-panel` library build

```bash
cd theia-panel
npm run build    # tsc --noEmit && vite build
```

Produces `dist/theia-panel.js` as an ES module (`lib.formats: ["es"]`, entry
`src/index.ts`, name `theia`). The library build does **not** bundle
`theia-graph.json`; the host supplies a URL at mount time. Externals declared in
`rollupOptions.external`: `three`, `d3-force-3d`. The host must provide them
via import map or bundler resolution.

For the mount surface (`mount`, `Controller`, events, lifecycle, CSP notes),
see [`integration.md`](./integration.md).

## 5. CI workflows

All workflows live under `.github/workflows/`. Vercel preview deploys were
removed; deployment now happens inside the Hermes dashboard.

| Workflow       | Triggers (paths)                                                                 | What it runs                                                                                                        | PR job name |
|----------------|----------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|-------------|
| `contract.yml` | push to `main` / PR touching `theia-core/**`, `theia-panel/**`, `schemas/**`, `examples/**` | Install core, seed test DB from `examples/sessions`, regenerate `examples/graph.json` via `--db-path`, validate with `check-jsonschema`, then `npm ci`, `generate-types`, and `vitest run` in the panel. | `contract`  |
| `core.yml`     | push to `main` / PR touching `theia-core/**`, `schemas/**`, `core.yml`           | In `theia-core`: `pip install -e ".[dev]"`, `ruff check .`, `ruff format --check .`, `mypy theia_core`, `pytest -q`. | `test`      |
| `panel.yml`    | push to `main` / PR touching `theia-panel/**`, `schemas/**`, `panel.yml`         | In `theia-panel`: `npm ci`, `generate-types`, `typecheck`, `test`, `build`, `format:check`.                         | `build`     |
| `plugin.yml`   | push to `main` / PR touching `plugin/**`, `theia-panel/**`, `schemas/**`, `Makefile` | Install core + panel, validate plugin structure, lint plugin API, `generate-types`, `make build-graph`, build embedded panel, assemble plugin, package tarball. | `build`     |
| `release.yml`  | push tag `v*`                                                                     | Full CI pipeline (`lint` + `test` + `build` + `package`), create GitHub Release with tarball artifact. | `release`   |

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

# 4. generate graph from your Hermes database (defaults to ~/.hermes/state.db)
python -m theia_core --watch

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
2. Re-run `make build-graph` (seeds a temp DB from `examples/sessions/` and generates `examples/graph.json`).
3. Commit both the session files and the refreshed `graph.json`.
4. Expect the diff to contain the new nodes/edges and a new `generated_at`;
   anything else suggests non-determinism and should be investigated.
