# theia

Visualize Hermes agent sessions as a semantic constellation.

- `theia-core/` — Python build tool: Hermes SQLite DB → `theia-graph.json`
- `theia-panel/` — TypeScript panel: `theia-graph.json` → three.js constellation
- `schemas/graph.schema.json` — contract between the two halves

---

## Quick start

```bash
# 1. Clone the repo
git clone https://github.com/arm64be/theia.git
cd theia

# 2. Install core (Python)
cd theia-core && pip install -e ".[dev]" && cd ..

# 3. Install panel (Node.js)
cd theia-panel && npm ci && cd ..

# 4. Generate a graph from your Hermes database
theia-core --watch

# 5. Start the dev server
cd theia-panel && npm run dev
# Open http://localhost:5173
```

Or use the all-in-one installer:

```bash
bash install.sh
```

---

## Prerequisites

| Tool       | Minimum version |
|------------|-----------------|
| Python     | ≥ 3.11          |
| Node.js    | ≥ 20            |
| npm        | (ships with Node) |
| GNU Make   | (optional, for `Makefile` targets) |
| gh CLI     | (optional, for GitHub workflow commands) |

Both halves expect a `.hermes` directory (default: `$HOME/.hermes`):

```
$HOME/.hermes/
  state.db            ← Hermes SQLite database (source of truth)
  theia-graph.json    ← generated constellation graph
```

Override the home directory with `THEIA_HOME` (or `HERMES_HOME` as fallback):

```bash
export THEIA_HOME=/custom/path
# or
export HERMES_HOME=/custom/path
```

---

## Usage

### CLI

```bash
# One-shot graph generation
theia-core

# Watch mode (regenerates on database changes)
theia-core --watch

# Custom database path and output
theia-core --db-path /path/to/state.db -o /path/to/graph.json

# Different projection methods
theia-core --projection pca
theia-core --projection umap
theia-core --projection tool-vector

# Disable tool-overlap edges
theia-core --disable-tool-overlap

# Include feature vectors in output
theia-core --include-features
```

### Makefile

```bash
make dev       # Start dev environment (Vite hot-reload + plugin symlink)
make staging   # Build and deploy for staging
make release   # Create versioned tarball
make test      # Run all tests (core + panel + contract)
make lint      # Run all linters
make ci        # Full CI pipeline
make clean     # Remove build artifacts
```

### Installer

```bash
bash install.sh              # Staging build (default)
bash install.sh --dev        # Dev mode (panel via Vite)
bash install.sh --no-graph   # Skip initial graph generation
bash install.sh --no-service # Skip watcher service prompt
bash install.sh --no-update  # Don't git-pull existing clone
bash install.sh --help       # Show help
```

---

## Project structure

```
theia/
├── theia-core/              # Python package — SQLite → graph.json
│   ├── theia_core/
│   │   ├── __main__.py      # CLI entrypoint
│   │   ├── ingest.py        # Hermes DB → Session objects
│   │   ├── features.py      # Session → feature vectors
│   │   ├── project.py       # 2D projection (PCA / UMAP / tool-vector)
│   │   ├── emit.py          # graph.json builder + schema validator
│   │   └── detect/
│   │       ├── memory_share.py
│   │       ├── cross_search.py
│   │       └── tool_overlap.py
│   └── tests/
├── theia-panel/             # TypeScript package — graph.json → constellation
│   ├── src/
│   │   ├── index.ts         # mount() / Controller
│   │   ├── scene/           # three.js wiring, nodes, edges, post-processing
│   │   ├── physics/         # d3-force-3d simulation with anchor force
│   │   ├── ui/              # side panel, filter bar, tooltip
│   │   └── data/            # graph loading + generated TS types
│   └── vite.config.ts
├── plugin/                  # Hermes dashboard plugin
│   ├── manifest.json
│   ├── api/                 # Python backend modules
│   └── src/                 # Frontend loader
├── schemas/
│   └── graph.schema.json    # Contract between core ↔ panel
├── examples/
│   ├── sessions/            # Sample Hermes session JSONs
│   └── graph.json           # Canonical golden fixture
├── docs/
│   ├── superpowers/specs/   # Architecture design spec
│   └── build-pipeline.md    # End-to-end build reference
├── install.sh               # One-command installer
└── Makefile                 # Build targets
```

---

## Updating

```bash
# Pull latest code
git pull --ff-only

# Reinstall core (if dependencies changed)
cd theia-core && pip install -e ".[dev]" && cd ..

# Reinstall panel (if dependencies changed)
cd theia-panel && npm install && cd ..

# Regenerate TS types from schema (if schema changed)
cd theia-panel && npm run generate-types && cd ..

# Rebuild everything
make build
```

The installer also supports updates:

```bash
bash install.sh --no-update   # Skip git pull (use local checkout as-is)
```

---

## Troubleshooting

| Problem | Likely cause | Solution |
|---------|-------------|----------|
| `python3: command not found` | Python not installed | Install Python ≥ 3.11 via your package manager |
| `node: command not found` | Node.js not installed | Install Node.js ≥ 20 via `nvm` or your package manager |
| `npm ci` fails | Outdated lockfile | Run `npm install` to regenerate `package-lock.json` |
| Schema validation errors | Core/panel mismatch | `cd theia-panel && npm run generate-types` to sync types |
| Graph is empty | No Hermes database found | Run a Hermes session first, or set `THEIA_HOME` |
| Panel shows blank screen | Missing or invalid `graph.json` | Run `theia-core` to generate the graph file |
| 404 on Constellation tab | Plugin not deployed | Run `bash install.sh` to deploy plugin |
| `ruff` / `mypy` errors | Code style issues | Run `make lint` to see details; `ruff check --fix` auto-fixes |
| Watcher not running | Service not installed | Run `theia-core --watch` manually, or re-run installer |

---

## Architecture

See [`docs/superpowers/specs/2026-04-21-theia-design.md`](docs/superpowers/specs/2026-04-21-theia-design.md)
for the full design spec, including data contracts, edge kinds, rendering pipeline,
and demo narrative.

For the end-to-end build pipeline reference, see [`docs/build-pipeline.md`](docs/build-pipeline.md).
