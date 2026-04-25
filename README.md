# theia

Visualize Hermes agent sessions as a semantic constellation.

- `theia-core/` — Python build tool: Hermes SQLite DB → `theia-graph.json`
- `theia-panel/` — TypeScript panel: `theia-graph.json` → three.js constellation
- `schemas/graph.schema.json` — contract between the two halves

## Documentation

| Document | Description |
|---|---|
| [`docs/quick-start.md`](docs/quick-start.md) | Installation guide and prerequisites |
| [`docs/usage.md`](docs/usage.md) | CLI, Makefile, and installer reference |
| [`docs/build-pipeline.md`](docs/build-pipeline.md) | End-to-end build pipeline reference |
| [`docs/integration.md`](docs/integration.md) | Hermes dashboard integration guide |
| [`docs/updating.md`](docs/updating.md) | How to update theia |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Common problems and solutions |
| [`docs/demo-script.md`](docs/demo-script.md) | 3-minute demo walkthrough script |
| [`docs/superpowers/specs/2026-04-21-theia-design.md`](docs/superpowers/specs/2026-04-21-theia-design.md) | Architecture design spec |

## Project structure

```
theia/
├── theia-core/              # Python package — SQLite → graph.json
├── theia-panel/             # TypeScript package — graph.json → constellation
├── plugin/                  # Hermes dashboard plugin
├── schemas/
│   └── graph.schema.json    # Contract between core ↔ panel
├── examples/
│   ├── sessions/            # Sample Hermes session JSONs
│   └── graph.json           # Canonical golden fixture
├── docs/                    # Documentation
├── install.sh               # One-command installer
└── Makefile                 # Build targets
```
