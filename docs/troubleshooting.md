# Troubleshooting

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
