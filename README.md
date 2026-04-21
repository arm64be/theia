# theia

Visualize Hermes agent sessions as a semantic constellation.

- `theia-core/` — Python build tool: session JSONs → `graph.json`
- `theia-panel/` — TypeScript panel: `graph.json` → three.js constellation
- `schemas/graph.schema.json` — contract between the two halves

## Docs

- [Design spec](docs/superpowers/specs/2026-04-21-theia-design.md)
- [Implementation plan](docs/superpowers/plans/2026-04-21-theia-implementation.md)

## Quick start

```bash
# Core: generate graph.json from session dumps
cd theia-core
pip install -e ".[dev]"
python -m theia_core ../examples/sessions -o ../examples/graph.json

# Panel: dev server
cd theia-panel
npm install
npm run generate-types
npm run dev
```

## Hackathon

Deadline: **2026-05-02**. Judged on creativity · usefulness · presentation.
