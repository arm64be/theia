# theia — Demo Script (3-minute walkthrough)

> Rehearse from this script. Do not ad-lib data values; the golden fixture is deterministic.

## Setup (before audience arrives)

1. `cd theia-panel && npm run dev`
2. Open the printed URL in a clean browser window (no bookmarks bar, 100% zoom).
3. Confirm `examples/graph.json` loads — three amber nodes with five edges.
4. Keep browser DevTools closed unless debugging.

---

## Beat 1 — The constellation appears (0:00–0:30)

**Narration:**
> “This is theia — a semantic constellation of Hermes agent sessions. Every glowing dot is a session. The layout is PCA-projected from feature vectors built from tools, memory events, and search hits. Watch them settle — the d3-force-3d anchor force pulls each node back toward its semantic home while links pull related sessions together.”

**Action:** Let the page load. Do not touch the mouse for 5 seconds so the audience sees the gentle settling motion.

---

## Beat 2 — Memory share (0:30–1:00)

**Narration:**
> “Alpha wrote an auth-design memory. Beta read it — twice. theia detects that as a memory-share edge, weighted by salience and read count. The warm amber line is the visual signature of shared memory.”

**Action:** Hover over the **Alpha** node. Tooltip shows `Alpha — writes auth memory`. Non-incident edges dim. Point at the amber line connecting Alpha → Beta.

---

## Beat 3 — Cross-search (1:00–1:30)

**Narration:**
> “Beta also searched for ‘auth middleware’ and hit Alpha as the top result. That’s a cross-search edge — cool cyan. The weight decays with hit rank, so top-ranked hits glow brighter.”

**Action:** Hover over **Beta**. Point at the cyan edge. Then hover over **Gamma** and note that it has no cross-session edges yet — it only overlaps tools.

---

## Beat 4 — Tool overlap + filter bar (1:30–2:00)

**Narration:**
> “All three sessions used read, edit, and bash. theia can surface tool-overlap edges too — muted violet. They’re hidden by default to reduce clutter, but the filter bar lets us toggle them on.”

**Action:** Click the **tool-overlap** checkbox in the filter bar. A violet edge appears between Alpha and Gamma (and others). Click it off again.

---

## Beat 5 — Detail panel (2:00–2:30)

**Narration:**
> “Click any node to inspect the session. The side panel shows duration, model, tool count, and every connection with direction and weight. It’s the bridge from the visual overview back to the raw session data.”

**Action:** Click **Beta**. Side panel slides in. Scroll to the Connections list. Point out the memory-share and cross-search entries. Click the × to close.

---

## Beat 6 — Closing (2:30–3:00)

**Narration:**
> “theia turns a folder of session JSONs into a navigable constellation. The core pipeline is a Python CLI — ingest, detect, project, emit — and the panel is a mountable three.js widget. Both sides are guarded by a JSON Schema contract and CI. That’s theia.”

**Action:** Pause on the settled constellation. If asked, mention the GitHub Actions workflows and the schema validation.

---

## Emergency fallbacks

- **If the dev server fails:** Open `examples/graph.json` in an editor and show the structured output. Pivot to “this is what the pipeline produces.”
- **If bloom looks blown out on the projector:** Open DevTools, run `document.querySelector('canvas').style.filter = 'contrast(1.2)'` as a quick hack.
- **If a node is off-screen:** Refresh — the physics re-settles from the same seed.
