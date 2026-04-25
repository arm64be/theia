# Usage

## CLI

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

## Makefile

```bash
make dev       # Start dev environment (Vite hot-reload + plugin symlink)
make staging   # Build and deploy for staging
make release   # Create versioned tarball
make test      # Run all tests (core + panel + contract)
make lint      # Run all linters
make ci        # Full CI pipeline
make clean     # Remove build artifacts
```

## Installer

```bash
curl -fsSL https://raw.githubusercontent.com/arm64be/theia/main/install.sh | sh

# Or, after cloning the repo:
bash install.sh              # Staging build (default)
bash install.sh --dev        # Dev mode (panel via Vite)
bash install.sh --no-graph   # Skip initial graph generation
bash install.sh --no-service # Skip watcher service prompt
bash install.sh --no-update  # Don't git-pull existing clone
bash install.sh --help       # Show help
```
