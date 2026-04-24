# theia — Hermes Dashboard Integration

Both `theia-core` and `theia-panel` expect a `.hermes` directory (default
`$HOME/.hermes`) containing session archives and the generated graph. Override
with the `THEIA_HOME` environment variable.

## Mount surface

`theia-panel` exports a single function:

```ts
import { mount } from "theia-panel";

const controller = await mount(element, graphUrl, options?);
```

- `element` — an `HTMLElement` that will host the canvas. The function sets `position: relative` if not already set.
- `graphUrl` — URL to a `theia-graph.json` file that validates against `schemas/graph.schema.json`.
- `options?.edgeKinds` — optional array of edge kinds to show initially (default: `["memory-share", "cross-search"]`).

## Lifecycle

- `mount()` is async because it fetches `graph.json`.
- `controller.destroy()` tears down the simulation, renderer, event listeners, and DOM elements.
- `controller.on("node-click", (nodeId) => { ... })` and `controller.on("node-hover", (nodeId | null) => { ... })` emit interaction events for the host dashboard to consume.

## Integration paths (risk-ordered)

### 1. Iframe (lowest risk)

Serve the built panel as static assets from a route (e.g., `/theia/`). The host page embeds:

```html
<iframe src="/theia/?graph=/api/graph.json" style="width:100%;height:100%;border:none"></iframe>
```

The panel reads the `graph` query param and calls `mount()`.

### 2. Plugin registry (medium risk)

If Hermes has a plugin registry that expects an ES module exporting `mount`, the built `dist/theia-panel.js` can be loaded directly:

```ts
import { mount } from "/static/theia-panel.js";

export async function activate(context) {
  const el = context.getPanelElement("theia");
  const ctrl = await mount(el, "/api/graph.json");
  context.subscriptions.push({ dispose: () => ctrl.destroy() });
}
```

### 3. Route slot (highest value)

Add a new dashboard route (e.g., `/dashboard/constellation`) that imports the panel and mounts it full-bleed. This gives the deepest integration — the dashboard header, navigation, and theming wrap the panel.

## Build artifact

```bash
cd theia-panel
npm run build
# → dist/theia-panel.js (ES module, ~32 kB gzipped)
```

External dependencies (`three`, `d3-force-3d`) are **not** bundled — the host must provide them or the import map must resolve them.

## CSP considerations

- The panel creates a `<canvas>` via Three.js — no `unsafe-eval` required.
- Tooltips and the side panel use inline styles. If the host has a strict `style-src` CSP, either allow `unsafe-inline` or pre-load the panel CSS in the host.

## Styling conflicts

- The panel sets its own dark background (`#07080d`). If embedded in a light-themed dashboard, consider wrapping it in a dark container or overriding `scene.background` via a future API.
- The filter bar and side panel use `position: absolute` within the mount element. The host should not apply transforms or clipping to the mount element that would hide absolute children.
