# Quick Start

The fastest way to install theia:

```bash
curl -fsSL https://raw.githubusercontent.com/arm64be/theia/main/install.sh | sh
```

Or run the installer locally after cloning:

```bash
git clone https://github.com/arm64be/theia.git
cd theia
bash install.sh
```

For a manual step-by-step setup:

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
