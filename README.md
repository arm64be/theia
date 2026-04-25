# theia

Visualize Hermes agent sessions as a semantic constellation.

- `theia-core/` — Python build tool: Hermes SQLite DB → `theia-graph.json`
- `theia-panel/` — TypeScript panel: `theia-graph.json` → three.js constellation
- `schemas/graph.schema.json` — contract between the two halves

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

See [`docs/superpowers/specs/2026-04-21-theia-design.md`](docs/superpowers/specs/2026-04-21-theia-design.md).
