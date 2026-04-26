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
| Can't access dashboard on a remote VPS | Dashboard binds to localhost only | Use SSH port forwarding (see [VPS deployment](#vps-deployment) below) |

## VPS deployment

When running Hermes (with the Theia plugin) on a remote VPS, the dashboard
binds to `localhost` by default and is not directly accessible from outside.
Use SSH port forwarding to tunnel the dashboard to your local machine.

### SSH port forwarding (recommended)

```bash
# Forward the Hermes dashboard port to your local machine
ssh -L 9119:localhost:9119 user@your-vps

# Then open http://localhost:9119 in your browser
```

If you are also running the panel dev server on the VPS:

```bash
# Forward both ports
ssh -L 9119:localhost:9119 -L 5173:localhost:5173 user@your-vps
```

### Dev mode on a VPS

When using `THEIA_ENV=development` (dev mode), the plugin's `/config` endpoint
returns a `dev_panel_url` that the dashboard iframe loads.  Set
`THEIA_DEV_HOST` to your VPS's hostname or IP so the plugin generates a
reachable URL:

```bash
THEIA_DEV_HOST=your-vps-ip THEIA_DEV_PORT=5173 THEIA_ENV=development hermes dashboard
```

> **Security note:** Do not expose the dev server or dashboard to the public
> internet without authentication.  SSH tunneling keeps traffic encrypted and
> limits access to your local machine.  If you must bind to `0.0.0.0`, use a
> firewall (e.g. `ufw`) to restrict access to trusted IPs.
