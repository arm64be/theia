# theia — Implementation Plan

> **For execution:** Use subagent-driven-development skill to implement this plan task-by-task. Tasks are bite-sized; full TDD cycle applies to all logic tasks (Python detectors/projection, TS data loading). Aesthetic and scaffolding tasks omit the test-first cycle where it adds no value.

**Goal:** Ship **theia** — a semantic-constellation visualizer for Hermes agent sessions — into the Hermes dashboard by 2026-05-02.

**Architecture:** Monorepo with two packages. `theia-core` (Python) is a build-time CLI that parses Hermes session JSONs, detects typed cross-session edges, and emits a static `graph.json` whose shape is enforced by `schemas/graph.schema.json`. `theia-panel` (TypeScript) mounts into the Hermes dashboard, fetches `graph.json`, and renders it as a glowing 2D constellation using three.js + d3-force-3d with a soft anchor force preserving precomputed semantic positions.

**Tech Stack:** Python 3.11+, numpy, scikit-learn, umap-learn, jsonschema, pytest, ruff, mypy · TypeScript, Vite, three.js, d3-force-3d, json-schema-to-typescript, vitest · GitHub Actions, pre-commit, Vercel/Netlify preview.

**Spec:** [`docs/superpowers/specs/2026-04-21-theia-design.md`](../specs/2026-04-21-theia-design.md)

**Branch prefix convention** (for CI path filtering — not author assignment):
- `core/*` — changes under `theia-core/` or `schemas/`
- `panel/*` — changes under `theia-panel/`
- `joint/*` — schema changes, CI, integration, demo, this plan itself

Both devs work across the monorepo. No task is tied to a specific person.

---

## Task index

| # | Day | Area | Task |
|---|---|---|---|
| 1.1–1.13 | 1 (04-21) | joint | Repo scaffold, schema, CI, sample JSON blocker |
| 2.1–2.14 | 2 (04-22) | core | Ingest + memory-share + golden fixture |
| 3.1–3.18 | 3 (04-23) | core | cross-search, tool-overlap, PCA, emit, CLI |
| 4.1–4.13 | 4 (04-24) | panel | Scaffold, basic render, aesthetic lock |
| 5.1–5.12 | 5 (04-25) | panel | Physics + anchor force + bloom |
| 6.1–6.10 | 6 (04-26) | panel | Hover, click, tooltip, filter bar |
| 7.1–7.7 | 7 (04-27) | panel | Side panel, end-to-end demo playable |
| 8.1–8.4 | 8 (04-28) | panel | Aesthetic freeze + 3D stretch |
| 9.1–9.5 | 9 (04-29) | joint | Hermes dashboard integration |
| 10.1–10.4 | 10 (04-30) | joint | Polish + rehearsal + video backup |
| 11.1–11.2 | 11 (05-01) | joint | Buffer + final rehearsal |

---

## Conventions

- **Commit style:** Conventional Commits — `feat:`, `fix:`, `chore:`, `test:`, `docs:`, `ci:`, `refactor:`.
- **Branch naming:** `core/<slug>`, `panel/<slug>`, `joint/<slug>`. Squash-merge via PR.
- **Every logic task:** write failing test → verify fails → implement → verify passes → commit.
- **Scaffolding/aesthetic tasks:** skip TDD but still commit per task.
- **Don't batch commits.** One task = one commit. Small reverts are free; large reverts are painful under deadline pressure.

---

# Day 1 — 2026-04-21 · Scaffold + CI + schema

## Task 1.1: Create monorepo top-level structure

**Branch:** `joint/scaffold` · **Objective:** Lay down the directory tree.

**Files — Create:**
- `theia-core/` (empty dir, keep with `.gitkeep`)
- `theia-panel/` (empty dir, keep with `.gitkeep`)
- `examples/sessions/` (`.gitkeep`)
- `schemas/` (`.gitkeep`)
- `.github/workflows/` (`.gitkeep`)
- `.gitignore`
- `README.md`
- `.pre-commit-config.yaml` (empty, filled in 1.11)

**`.gitignore`:**
```gitignore
# Python
__pycache__/
*.pyc
*.egg-info/
.venv/
.mypy_cache/
.ruff_cache/
.pytest_cache/
dist/
build/

# TypeScript / Node
node_modules/
theia-panel/dist/
*.tsbuildinfo

# Generated
examples/graph.json

# Superpowers (brainstorming/plans sessions)
.superpowers/

# OS
.DS_Store
Thumbs.db
```

**`README.md`:**
```markdown
# theia

Visualize Hermes agent sessions as a semantic constellation.

- `theia-core/` — Python build tool: session JSONs → `graph.json`
- `theia-panel/` — TypeScript panel: `graph.json` → three.js constellation
- `schemas/graph.schema.json` — contract between the two halves

See [`docs/superpowers/specs/2026-04-21-theia-design.md`](docs/superpowers/specs/2026-04-21-theia-design.md).
```

**Commit:**
```bash
git add .
git commit -m "chore: scaffold monorepo structure"
```

---

## Task 1.2: Author `schemas/graph.schema.json`

**Objective:** Codify the core↔panel contract as JSON Schema.

**Files — Create:** `schemas/graph.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://theia.local/schemas/graph.schema.json",
  "title": "TheiaGraph",
  "type": "object",
  "required": ["meta", "nodes", "edges"],
  "additionalProperties": false,
  "properties": {
    "meta": {
      "type": "object",
      "required": ["generated_at", "source_count", "projection"],
      "additionalProperties": false,
      "properties": {
        "generated_at": { "type": "string", "format": "date-time" },
        "source_count": { "type": "integer", "minimum": 0 },
        "projection": { "enum": ["pca", "umap", "tool-vector"] },
        "feature_dim": { "type": "integer", "minimum": 1 }
      }
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "title", "started_at", "duration_sec", "tool_count", "position"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "title": { "type": "string" },
          "started_at": { "type": "string", "format": "date-time" },
          "duration_sec": { "type": "number", "minimum": 0 },
          "tool_count": { "type": "integer", "minimum": 0 },
          "message_count": { "type": "integer", "minimum": 0 },
          "model": { "type": "string" },
          "position": {
            "type": "object",
            "required": ["x", "y"],
            "additionalProperties": false,
            "properties": {
              "x": { "type": "number", "minimum": -1.5, "maximum": 1.5 },
              "y": { "type": "number", "minimum": -1.5, "maximum": 1.5 }
            }
          },
          "features": {
            "oneOf": [
              { "type": "null" },
              { "type": "array", "items": { "type": "number" } }
            ]
          }
        }
      }
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["source", "target", "kind", "weight"],
        "additionalProperties": false,
        "properties": {
          "source": { "type": "string" },
          "target": { "type": "string" },
          "kind": { "enum": ["memory-share", "cross-search", "tool-overlap"] },
          "weight": { "type": "number", "minimum": 0, "maximum": 1 },
          "evidence": { "type": "object" }
        }
      }
    }
  }
}
```

**Commit:**
```bash
git add schemas/graph.schema.json
git commit -m "feat(schemas): add graph.schema.json contract"
```

---

## Task 1.3: Scaffold `theia-core` Python package

**Objective:** Empty-but-importable Python package with test + lint tooling configured.

**Files — Create:**
- `theia-core/pyproject.toml`
- `theia-core/theia_core/__init__.py`
- `theia-core/theia_core/__main__.py` (stub)
- `theia-core/theia_core/ingest.py` (empty)
- `theia-core/theia_core/detect/__init__.py` (empty)
- `theia-core/theia_core/detect/memory_share.py` (empty)
- `theia-core/theia_core/detect/cross_search.py` (empty)
- `theia-core/theia_core/detect/tool_overlap.py` (empty)
- `theia-core/theia_core/features.py` (empty)
- `theia-core/theia_core/project.py` (empty)
- `theia-core/theia_core/emit.py` (empty)
- `theia-core/tests/__init__.py`
- `theia-core/tests/conftest.py` (empty)

**`theia-core/pyproject.toml`:**
```toml
[project]
name = "theia-core"
version = "0.0.1"
description = "Hermes session JSON → theia graph.json"
requires-python = ">=3.11"
dependencies = [
    "numpy>=1.26",
    "scikit-learn>=1.4",
    "umap-learn>=0.5",
    "jsonschema>=4.21",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "ruff>=0.4", "mypy>=1.10"]

[project.scripts]
theia-core = "theia_core.__main__:main"

[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM"]

[tool.mypy]
python_version = "3.11"
strict = true

[tool.pytest.ini_options]
testpaths = ["tests"]
```

**`theia-core/theia_core/__main__.py`:**
```python
def main() -> int:
    raise NotImplementedError("CLI lands on Day 3")

if __name__ == "__main__":
    raise SystemExit(main())
```

**Verify install:**
```bash
cd theia-core && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest  # exits with "no tests" — fine
ruff check .
```

**Commit:**
```bash
git add theia-core/
git commit -m "chore(core): scaffold Python package with ruff/mypy/pytest"
```

---

## Task 1.4: Scaffold `theia-panel` TypeScript package

**Objective:** Empty-but-runnable Vite + TS package, three.js and d3-force-3d installed.

**Commands:**
```bash
cd theia-panel
npm init -y
npm install three d3-force-3d
npm install -D typescript vite vitest @types/three json-schema-to-typescript prettier
```

**Files — Create / Modify:**

`theia-panel/package.json` (replace generated):
```json
{
  "name": "theia-panel",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "generate-types": "json2ts -i ../schemas/graph.schema.json -o src/data/types.ts --additionalProperties false",
    "format": "prettier --write src index.html",
    "format:check": "prettier --check src index.html"
  },
  "dependencies": {
    "three": "^0.163.0",
    "d3-force-3d": "^3.0.5"
  },
  "devDependencies": {
    "@types/three": "^0.163.0",
    "json-schema-to-typescript": "^14.0.0",
    "prettier": "^3.2.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.5.0"
  }
}
```

`theia-panel/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals"],
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src", "index.html"]
}
```

`theia-panel/vite.config.ts`:
```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "theia",
      formats: ["es"],
      fileName: "theia-panel",
    },
    rollupOptions: { external: ["three", "d3-force-3d"] },
  },
});
```

`theia-panel/src/index.ts`:
```ts
export async function mount(element: HTMLElement, graphUrl: string): Promise<void> {
  throw new Error("mount() not implemented yet — see Day 4");
}
```

`theia-panel/index.html` (dev harness, not shipped):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>theia dev</title>
    <style>
      html, body, #app { height: 100%; margin: 0; background: #07080d; color: #cfd6e4; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
      import { mount } from "/src/index.ts";
      mount(document.getElementById("app"), "/examples/graph.json").catch(console.error);
    </script>
  </body>
</html>
```

**Verify:**
```bash
npm run typecheck
npm run build  # will produce dist/ but empty mount — expected
```

**Commit:**
```bash
git add theia-panel/ .gitignore
git commit -m "chore(panel): scaffold Vite + TS package"
```

---

## Task 1.5: Generate initial TS types from schema

**Objective:** Wire schema → TS type generation so `types.ts` exists before panel code.

**Command:**
```bash
cd theia-panel && npm run generate-types
```

**Expected:** `theia-panel/src/data/types.ts` created. Open it — should export `TheiaGraph`, nested types for `Node`, `Edge`, etc.

**Commit:**
```bash
git add theia-panel/src/data/types.ts
git commit -m "feat(panel): generate TS types from schema"
```

**Acceptance:** `tsc --noEmit` passes with the generated types.

---

## Task 1.6: Configure pre-commit hooks

**Objective:** Auto-format on commit.

**Files — Replace:** `.pre-commit-config.yaml`

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.4.4
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
  - repo: https://github.com/pre-commit/mirrors-prettier
    rev: v4.0.0-alpha.8
    hooks:
      - id: prettier
        types_or: [ts, tsx, javascript, json, markdown, html]
  - repo: https://github.com/python-jsonschema/check-jsonschema
    rev: 0.28.4
    hooks:
      - id: check-jsonschema
        args: ["--schemafile", "schemas/graph.schema.json"]
        files: "^examples/graph\\.json$"
```

**Install per-dev (local):**
```bash
pipx install pre-commit || pip install --user pre-commit
pre-commit install
pre-commit run --all-files   # should pass or auto-fix
```

**Commit:**
```bash
git add .pre-commit-config.yaml
git commit -m "ci: add pre-commit config"
```

---

## Task 1.7: GitHub Actions — `core.yml`

**Objective:** Core CI runs on Python/schema changes.

**File — Create:** `.github/workflows/core.yml`

```yaml
name: core
on:
  push:
    branches: [main]
    paths: ["theia-core/**", "schemas/**", ".github/workflows/core.yml"]
  pull_request:
    paths: ["theia-core/**", "schemas/**", ".github/workflows/core.yml"]

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: theia-core
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
          cache: pip
      - run: pip install -e ".[dev]"
      - run: ruff check .
      - run: ruff format --check .
      - run: mypy theia_core
      - run: pytest -q
```

**Commit:**
```bash
git add .github/workflows/core.yml
git commit -m "ci: add core workflow"
```

---

## Task 1.8: GitHub Actions — `panel.yml`

**File — Create:** `.github/workflows/panel.yml`

```yaml
name: panel
on:
  push:
    branches: [main]
    paths: ["theia-panel/**", "schemas/**", ".github/workflows/panel.yml"]
  pull_request:
    paths: ["theia-panel/**", "schemas/**", ".github/workflows/panel.yml"]

jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: theia-panel
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: theia-panel/package-lock.json
      - run: npm ci
      - run: npm run generate-types
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build
      - run: npm run format:check
```

**Commit:**
```bash
git add .github/workflows/panel.yml
git commit -m "ci: add panel workflow"
```

---

## Task 1.9: GitHub Actions — `contract.yml`

**Objective:** The cross-seam guardrail.

**File — Create:** `.github/workflows/contract.yml`

```yaml
name: contract
on:
  push:
    branches: [main]
    paths: ["theia-core/**", "theia-panel/**", "schemas/**", "examples/**"]
  pull_request:
    paths: ["theia-core/**", "theia-panel/**", "schemas/**", "examples/**"]

jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - name: Install core
        working-directory: theia-core
        run: pip install -e ".[dev]"
      - name: Generate graph.json from fixtures
        run: |
          python -m theia_core examples/sessions -o examples/graph.json
      - name: Validate against schema
        run: |
          pip install check-jsonschema
          check-jsonschema --schemafile schemas/graph.schema.json examples/graph.json
      - name: Install panel
        working-directory: theia-panel
        run: npm ci && npm run generate-types
      - name: Headless panel smoke test
        working-directory: theia-panel
        run: npm run test -- --run
```

**Note:** Until the core CLI is implemented on Day 3, this workflow will fail on unmerged PRs. That's intentional — once core is ready, the workflow starts protecting the seam. Expect this to be red during days 1–2.

**Commit:**
```bash
git add .github/workflows/contract.yml
git commit -m "ci: add contract workflow (guardrail)"
```

---

## Task 1.10: GitHub Actions — `preview.yml`

**Objective:** Vercel/Netlify preview on every panel PR for visual review.

**File — Create:** `.github/workflows/preview.yml`

Choose one platform. Vercel example (requires adding `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` as repo secrets):

```yaml
name: preview
on:
  pull_request:
    paths: ["theia-panel/**", "schemas/**", "examples/**"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
        working-directory: theia-panel
      - run: npm run generate-types && npm run build
        working-directory: theia-panel
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: theia-panel
```

**Fallback if Vercel setup is slow:** skip this workflow on day 1, spin it up only when it matters (day 5+). Local `npm run dev` is fine until then.

**Commit (or stash if deferring):**
```bash
git add .github/workflows/preview.yml
git commit -m "ci: add preview deploy workflow"
```

---

## Task 1.11: BLOCKER — obtain a real Hermes session JSON sample

**Objective:** Without a real sample, §3 edge-detection assumptions (field names, memory-read surface, search-hit citation shape) are unverified. Core code must not be written against imagined data.

**Deliverable:** 1–3 real Hermes session JSONs anonymized and committed to `examples/sessions/`. At least one pair that has an observable cross-session reference (A's memory read in B, or B's search hitting A's artifact).

**Steps:**
1. Pick 1–3 recent sessions from Hermes that demonstrably interact.
2. Redact any personal/secret data in-place (keep the structural fields).
3. Commit them as `examples/sessions/sess_*.json`.
4. Open a PR titled `joint/sample-sessions` describing what cross-session relationships each sample contains. This PR is how we confirm the detection rules.

**Acceptance:** PR description lists, for each pair, what edge kind should be detected and which JSON path in each session evidences it.

**If this blocks past end of day 1:** core development on day 2 starts against the *assumed* schema in §3 of the spec. When the sample arrives, `ingest.py` and the detectors get patched in one batch.

**Commit:**
```bash
git add examples/sessions/
git commit -m "feat(examples): add real Hermes session samples"
```

---

## Task 1.12: Smoke-test local dev loop end-to-end

**Objective:** Every dev can run the panel against a hand-made fixture before day 4.

**Steps:**
1. Create a minimal hand-crafted `examples/graph.json` (3 nodes, 2 edges) — validates against the schema but doesn't come from real data. See template below.
2. `cd theia-panel && npm run dev` — open the URL, see a blank page (panel is a stub). Confirms toolchain.
3. Throw the file away or keep as a dev-only fixture under `examples/graph.dev.json` — whichever is less cluttered.

**Template `examples/graph.dev.json`:**
```json
{
  "meta": { "generated_at": "2026-04-21T12:00:00Z", "source_count": 3, "projection": "pca" },
  "nodes": [
    { "id": "a", "title": "A", "started_at": "2026-04-20T10:00:00Z", "duration_sec": 100, "tool_count": 5, "position": { "x": 0.2, "y": 0.3 } },
    { "id": "b", "title": "B", "started_at": "2026-04-20T11:00:00Z", "duration_sec": 200, "tool_count": 8, "position": { "x": -0.4, "y": 0.1 } },
    { "id": "c", "title": "C", "started_at": "2026-04-20T12:00:00Z", "duration_sec": 150, "tool_count": 3, "position": { "x": 0.0, "y": -0.5 } }
  ],
  "edges": [
    { "source": "a", "target": "b", "kind": "memory-share", "weight": 0.8, "evidence": {} },
    { "source": "b", "target": "c", "kind": "cross-search", "weight": 0.6, "evidence": {} }
  ]
}
```

**No commit** — this is dev-only. Add `examples/graph.dev.json` to `.gitignore` if it sticks around.

---

## Task 1.13: Merge scaffold PR to main

**Objective:** End of day 1 — main contains everything from 1.1–1.10.

**Steps:**
- Open PR titled `joint/scaffold`, merge to main. Tag `day-1-complete`.

**Acceptance criteria for end of Day 1:**
- [ ] `main` builds: `core.yml`, `panel.yml` pass. `contract.yml` may be red until day 3 — acceptable.
- [ ] `npm run dev` in `theia-panel` serves a blank page without errors.
- [ ] `pytest -q` in `theia-core` says "no tests collected" — acceptable.
- [ ] Task 1.11 is either complete or explicitly flagged in the day-2 kickoff.

---

# Day 2 — 2026-04-22 · Core ingest + memory-share + golden fixture

**Branch:** `core/ingest` (single PR at end of day, or split 2.1–2.5 and 2.6–2.14 if preferred).

## Task 2.1: Define `Session` dataclass in `ingest.py`

**File — Modify:** `theia-core/theia_core/ingest.py`

```python
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class MemoryEvent:
    kind: str               # "write" | "read"
    memory_id: str
    salience: float = 0.5
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolCall:
    name: str
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SearchHit:
    query: str
    source_session_id: str   # session whose artifact was hit
    hit_rank: int
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Session:
    id: str
    title: str
    started_at: datetime
    duration_sec: float
    model: str
    message_count: int
    tool_calls: tuple[ToolCall, ...]
    memory_events: tuple[MemoryEvent, ...]
    search_hits: tuple[SearchHit, ...]
    raw: dict[str, Any] = field(default_factory=dict)
```

**Rationale:** These structs are the ingest layer's contract with the rest of the package. Field paths here are the only place we need to update once the real Hermes schema lands.

**No commit yet** — pair with 2.2.

---

## Task 2.2: Write failing test for `parse_session`

**File — Create:** `theia-core/tests/test_ingest.py`

```python
from datetime import datetime, timezone
from pathlib import Path

import pytest

from theia_core.ingest import parse_session, Session


FIXTURE_JSON = """
{
  "id": "sess_aaa",
  "title": "Refactor auth",
  "started_at": "2026-04-18T09:14:00Z",
  "duration_sec": 3421,
  "model": "claude-opus-4-7",
  "message_count": 187,
  "tool_calls": [{"name": "bash"}, {"name": "read"}],
  "memory_events": [
    {"kind": "write", "memory_id": "mem_1", "salience": 0.8},
    {"kind": "read", "memory_id": "mem_9"}
  ],
  "search_hits": [
    {"query": "auth middleware", "source_session_id": "sess_bbb", "hit_rank": 1}
  ]
}
"""


def test_parse_session_happy_path(tmp_path: Path) -> None:
    p = tmp_path / "sess.json"
    p.write_text(FIXTURE_JSON)

    sess = parse_session(p)

    assert isinstance(sess, Session)
    assert sess.id == "sess_aaa"
    assert sess.title == "Refactor auth"
    assert sess.started_at == datetime(2026, 4, 18, 9, 14, tzinfo=timezone.utc)
    assert sess.duration_sec == pytest.approx(3421)
    assert len(sess.tool_calls) == 2
    assert sess.tool_calls[0].name == "bash"
    assert len(sess.memory_events) == 2
    assert sess.memory_events[0].kind == "write"
    assert sess.memory_events[0].memory_id == "mem_1"
    assert sess.memory_events[0].salience == pytest.approx(0.8)
    assert len(sess.search_hits) == 1
```

**Run:** `pytest tests/test_ingest.py::test_parse_session_happy_path -v`
**Expected:** FAIL — `parse_session` not defined.

---

## Task 2.3: Implement `parse_session`

**File — Modify:** `theia-core/theia_core/ingest.py` (append)

```python
import json
from pathlib import Path


def _parse_iso(s: str) -> datetime:
    # Python 3.11 handles "Z" suffix in fromisoformat
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def parse_session(path: Path) -> Session:
    data = json.loads(Path(path).read_text())
    return Session(
        id=data["id"],
        title=data.get("title", ""),
        started_at=_parse_iso(data["started_at"]),
        duration_sec=float(data.get("duration_sec", 0.0)),
        model=data.get("model", "unknown"),
        message_count=int(data.get("message_count", 0)),
        tool_calls=tuple(ToolCall(name=t["name"], raw=t) for t in data.get("tool_calls", [])),
        memory_events=tuple(
            MemoryEvent(
                kind=m["kind"],
                memory_id=m["memory_id"],
                salience=float(m.get("salience", 0.5)),
                raw=m,
            )
            for m in data.get("memory_events", [])
        ),
        search_hits=tuple(
            SearchHit(
                query=s["query"],
                source_session_id=s["source_session_id"],
                hit_rank=int(s.get("hit_rank", 0)),
                raw=s,
            )
            for s in data.get("search_hits", [])
        ),
        raw=data,
    )
```

**Run:** `pytest tests/test_ingest.py -v`
**Expected:** PASS

**Commit:**
```bash
git add theia-core/theia_core/ingest.py theia-core/tests/test_ingest.py
git commit -m "feat(core): parse_session handles the Hermes session shape (assumed)"
```

> **Note:** this task *assumes* §3 field names (`memory_events`, `search_hits`, etc.). When Task 1.11's real samples land, update the field paths here and re-run tests. Likely a small patch — the struct layout is right; the JSON pointers may differ.

---

## Task 2.4: Write failing test — `parse_session` on a directory

**File — Modify:** `theia-core/tests/test_ingest.py` (append)

```python
from theia_core.ingest import load_sessions


def test_load_sessions_reads_all(tmp_path: Path) -> None:
    (tmp_path / "a.json").write_text(FIXTURE_JSON)
    (tmp_path / "b.json").write_text(FIXTURE_JSON.replace("sess_aaa", "sess_bbb"))
    (tmp_path / "ignore.txt").write_text("not a session")

    sessions = load_sessions(tmp_path)

    assert {s.id for s in sessions} == {"sess_aaa", "sess_bbb"}
```

**Run → FAIL** (not defined).

---

## Task 2.5: Implement `load_sessions`

**File — Modify:** `theia-core/theia_core/ingest.py` (append)

```python
def load_sessions(directory: Path) -> list[Session]:
    directory = Path(directory)
    return [parse_session(p) for p in sorted(directory.glob("*.json"))]
```

**Run → PASS. Commit:**
```bash
git add theia-core/theia_core/ingest.py theia-core/tests/test_ingest.py
git commit -m "feat(core): load_sessions reads a directory of session JSONs"
```

---

## Task 2.6: Define `Edge` dataclass in `detect/__init__.py`

**File — Modify:** `theia-core/theia_core/detect/__init__.py`

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

EdgeKind = Literal["memory-share", "cross-search", "tool-overlap"]


@dataclass(frozen=True)
class Edge:
    source: str
    target: str
    kind: EdgeKind
    weight: float  # 0..1
    evidence: dict[str, Any] = field(default_factory=dict)
```

**No commit yet** — pair with 2.7.

---

## Task 2.7: Write failing test for `detect_memory_share`

**File — Create:** `theia-core/tests/test_memory_share.py`

```python
from datetime import datetime, timezone

import pytest

from theia_core.detect.memory_share import detect_memory_share
from theia_core.ingest import MemoryEvent, Session


def _sess(id: str, events: list[MemoryEvent], minute: int) -> Session:
    return Session(
        id=id,
        title=id,
        started_at=datetime(2026, 4, 20, 12, minute, tzinfo=timezone.utc),
        duration_sec=60.0,
        model="test",
        message_count=1,
        tool_calls=(),
        memory_events=tuple(events),
        search_hits=(),
    )


def test_memory_share_writer_before_reader_yields_edge() -> None:
    writer = _sess("A", [MemoryEvent(kind="write", memory_id="m1", salience=0.9)], minute=0)
    reader = _sess("B", [MemoryEvent(kind="read", memory_id="m1")], minute=5)

    edges = detect_memory_share([writer, reader])

    assert len(edges) == 1
    e = edges[0]
    assert e.source == "A" and e.target == "B"
    assert e.kind == "memory-share"
    assert 0 < e.weight <= 1
    assert e.evidence["memory_id"] == "m1"


def test_memory_share_ignores_when_reader_before_writer() -> None:
    reader = _sess("B", [MemoryEvent(kind="read", memory_id="m1")], minute=0)
    writer = _sess("A", [MemoryEvent(kind="write", memory_id="m1")], minute=5)

    assert detect_memory_share([reader, writer]) == []


def test_memory_share_no_edge_without_match() -> None:
    a = _sess("A", [MemoryEvent(kind="write", memory_id="m1")], minute=0)
    b = _sess("B", [MemoryEvent(kind="read", memory_id="m99")], minute=5)

    assert detect_memory_share([a, b]) == []


def test_memory_share_weight_scales_with_salience_and_read_count() -> None:
    a = _sess("A", [MemoryEvent(kind="write", memory_id="m1", salience=0.1)], minute=0)
    b1 = _sess("B", [MemoryEvent(kind="read", memory_id="m1")], minute=5)
    a2 = _sess("A2", [MemoryEvent(kind="write", memory_id="m2", salience=1.0)], minute=0)
    b2 = _sess("B2", [
        MemoryEvent(kind="read", memory_id="m2"),
        MemoryEvent(kind="read", memory_id="m2"),
    ], minute=5)

    low = detect_memory_share([a, b1])[0]
    high = detect_memory_share([a2, b2])[0]

    assert high.weight > low.weight
```

**Run → FAIL** (detect_memory_share not implemented).

---

## Task 2.8: Implement `detect_memory_share`

**File — Modify:** `theia-core/theia_core/detect/memory_share.py`

```python
from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from theia_core.detect import Edge
from theia_core.ingest import Session


def detect_memory_share(sessions: Iterable[Session]) -> list[Edge]:
    sessions = sorted(sessions, key=lambda s: s.started_at)
    # memory_id -> list of (session_id, salience) of writes, earliest first
    writes: dict[str, list[tuple[str, float]]] = defaultdict(list)
    edges_by_pair: dict[tuple[str, str, str], dict] = {}

    for sess in sessions:
        for event in sess.memory_events:
            if event.kind == "write":
                writes[event.memory_id].append((sess.id, event.salience))
            elif event.kind == "read":
                # Link to the most recent prior write of this memory (if any).
                prior = writes.get(event.memory_id, [])
                if not prior:
                    continue
                writer_id, salience = prior[-1]
                if writer_id == sess.id:
                    continue  # same session read its own write; not cross-session
                key = (writer_id, sess.id, event.memory_id)
                agg = edges_by_pair.setdefault(
                    key, {"read_count": 0, "salience": salience}
                )
                agg["read_count"] += 1

    edges: list[Edge] = []
    for (src, tgt, memory_id), agg in edges_by_pair.items():
        # weight combines salience and log-scaled read count; clamp to [0, 1]
        import math
        raw = agg["salience"] * (1 + math.log1p(agg["read_count"] - 1))
        weight = min(1.0, raw)
        edges.append(
            Edge(
                source=src,
                target=tgt,
                kind="memory-share",
                weight=weight,
                evidence={
                    "memory_id": memory_id,
                    "read_count": agg["read_count"],
                    "salience": agg["salience"],
                },
            )
        )
    return edges
```

**Run → PASS. Commit:**
```bash
git add theia-core/theia_core/detect/ theia-core/tests/test_memory_share.py
git commit -m "feat(core): detect memory-share edges"
```

---

## Task 2.9: Create golden fixture — 3 synthetic sessions

**Files — Create:** `theia-core/tests/fixtures/golden_sessions/sess_alpha.json`, `..._beta.json`, `..._gamma.json`

**`sess_alpha.json`:**
```json
{
  "id": "sess_alpha",
  "title": "Alpha — writes auth memory",
  "started_at": "2026-04-18T09:00:00Z",
  "duration_sec": 1000,
  "model": "claude-opus-4-7",
  "message_count": 50,
  "tool_calls": [{"name": "read"}, {"name": "edit"}, {"name": "bash"}],
  "memory_events": [
    {"kind": "write", "memory_id": "mem_auth_design", "salience": 0.9}
  ],
  "search_hits": []
}
```

**`sess_beta.json`:**
```json
{
  "id": "sess_beta",
  "title": "Beta — reads auth memory",
  "started_at": "2026-04-18T11:00:00Z",
  "duration_sec": 800,
  "model": "claude-opus-4-7",
  "message_count": 32,
  "tool_calls": [{"name": "read"}, {"name": "edit"}],
  "memory_events": [
    {"kind": "read", "memory_id": "mem_auth_design"},
    {"kind": "read", "memory_id": "mem_auth_design"}
  ],
  "search_hits": [
    {"query": "auth middleware", "source_session_id": "sess_alpha", "hit_rank": 1}
  ]
}
```

**`sess_gamma.json`:**
```json
{
  "id": "sess_gamma",
  "title": "Gamma — overlaps tools only",
  "started_at": "2026-04-18T14:00:00Z",
  "duration_sec": 600,
  "model": "claude-opus-4-7",
  "message_count": 20,
  "tool_calls": [{"name": "read"}, {"name": "edit"}, {"name": "bash"}],
  "memory_events": [],
  "search_hits": []
}
```

**Commit:**
```bash
git add theia-core/tests/fixtures/
git commit -m "test(core): add golden fixture sessions"
```

---

## Task 2.10: Write golden test asserting memory-share edge

**File — Create:** `theia-core/tests/test_golden.py`

```python
from pathlib import Path

from theia_core.detect.memory_share import detect_memory_share
from theia_core.ingest import load_sessions

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "golden_sessions"


def test_golden_memory_share_alpha_to_beta() -> None:
    sessions = load_sessions(FIXTURE_DIR)
    edges = detect_memory_share(sessions)

    memory_edges = [e for e in edges if e.kind == "memory-share"]
    assert len(memory_edges) == 1
    e = memory_edges[0]
    assert e.source == "sess_alpha"
    assert e.target == "sess_beta"
    assert e.evidence["read_count"] == 2
    assert 0 < e.weight <= 1
```

**Run → PASS** (if implementation from 2.8 is right).

**Commit:**
```bash
git add theia-core/tests/test_golden.py
git commit -m "test(core): golden memory-share assertion"
```

---

## Task 2.11: Open PR `core/ingest`, merge

**Acceptance for end of Day 2:**
- [ ] `pytest` in `theia-core` passes with ≥ 5 tests.
- [ ] `ruff`/`mypy` clean.
- [ ] Golden fixture committed.
- [ ] PR merged to main.

---

# Day 3 — 2026-04-23 · cross-search, tool-overlap, PCA, emit, CLI

**Branch:** `core/emit` (or split)

## Task 3.1: Test + implement `detect_cross_search`

**Test — Create:** `theia-core/tests/test_cross_search.py`

```python
from datetime import datetime, timezone

from theia_core.detect.cross_search import detect_cross_search
from theia_core.ingest import SearchHit, Session


def _sess(id: str, hits: list[SearchHit]) -> Session:
    return Session(
        id=id, title=id,
        started_at=datetime(2026, 4, 20, tzinfo=timezone.utc),
        duration_sec=60, model="t", message_count=1,
        tool_calls=(), memory_events=(), search_hits=tuple(hits),
    )


def test_cross_search_creates_edge_from_source_to_searcher() -> None:
    a = _sess("A", [])
    b = _sess("B", [SearchHit(query="q", source_session_id="A", hit_rank=1)])

    edges = detect_cross_search([a, b])

    assert len(edges) == 1
    e = edges[0]
    assert e.source == "A"
    assert e.target == "B"
    assert e.kind == "cross-search"
    assert e.evidence["query"] == "q"


def test_cross_search_weight_decreases_with_rank() -> None:
    a = _sess("A", [])
    top = _sess("B", [SearchHit(query="q", source_session_id="A", hit_rank=1)])
    bottom = _sess("C", [SearchHit(query="q", source_session_id="A", hit_rank=10)])

    e_top = detect_cross_search([a, top])[0]
    e_bot = detect_cross_search([a, bottom])[0]

    assert e_top.weight > e_bot.weight


def test_cross_search_ignores_self_hits() -> None:
    a = _sess("A", [SearchHit(query="q", source_session_id="A", hit_rank=1)])

    assert detect_cross_search([a]) == []
```

**Implementation — Create:** `theia-core/theia_core/detect/cross_search.py`

```python
from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from theia_core.detect import Edge
from theia_core.ingest import Session


def detect_cross_search(sessions: Iterable[Session]) -> list[Edge]:
    by_pair: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for sess in sessions:
        for hit in sess.search_hits:
            if hit.source_session_id == sess.id:
                continue
            by_pair[(hit.source_session_id, sess.id)].append(
                {"query": hit.query, "hit_rank": hit.hit_rank}
            )

    edges: list[Edge] = []
    for (src, tgt), hits in by_pair.items():
        # weight: average of 1 / rank across hits; clamp to (0,1]
        inv_ranks = [1.0 / max(h["hit_rank"], 1) for h in hits]
        weight = sum(inv_ranks) / len(inv_ranks)
        # favor the top hit as the representative evidence
        top = min(hits, key=lambda h: h["hit_rank"])
        edges.append(
            Edge(
                source=src,
                target=tgt,
                kind="cross-search",
                weight=min(1.0, weight),
                evidence={"query": top["query"], "hit_rank": top["hit_rank"], "hits": len(hits)},
            )
        )
    return edges
```

**Verify, commit:**
```bash
pytest tests/test_cross_search.py -v
git add theia-core/theia_core/detect/cross_search.py theia-core/tests/test_cross_search.py
git commit -m "feat(core): detect cross-search edges"
```

---

## Task 3.2: Test + implement `detect_tool_overlap`

**Test — Create:** `theia-core/tests/test_tool_overlap.py`

```python
from datetime import datetime, timezone

from theia_core.detect.tool_overlap import detect_tool_overlap
from theia_core.ingest import Session, ToolCall


def _sess(id: str, tools: list[str]) -> Session:
    return Session(
        id=id, title=id,
        started_at=datetime(2026, 4, 20, tzinfo=timezone.utc),
        duration_sec=60, model="t", message_count=1,
        tool_calls=tuple(ToolCall(name=t) for t in tools),
        memory_events=(), search_hits=(),
    )


def test_tool_overlap_returns_edge_above_threshold() -> None:
    a = _sess("A", ["read", "edit", "bash"])
    b = _sess("B", ["read", "edit", "bash"])

    edges = detect_tool_overlap([a, b], threshold=0.4)

    assert len(edges) == 1
    e = edges[0]
    # Jaccard 3/3 = 1.0
    assert e.weight == 1.0
    assert e.kind == "tool-overlap"
    assert e.evidence["jaccard"] == 1.0


def test_tool_overlap_below_threshold_ignored() -> None:
    a = _sess("A", ["read", "edit"])
    b = _sess("B", ["bash"])

    assert detect_tool_overlap([a, b], threshold=0.4) == []


def test_tool_overlap_undirected_no_duplicates() -> None:
    a = _sess("A", ["read"])
    b = _sess("B", ["read"])

    edges = detect_tool_overlap([a, b], threshold=0.4)

    assert len(edges) == 1
    assert {edges[0].source, edges[0].target} == {"A", "B"}
```

**Implementation — Create:** `theia-core/theia_core/detect/tool_overlap.py`

```python
from __future__ import annotations

from itertools import combinations
from typing import Iterable

from theia_core.detect import Edge
from theia_core.ingest import Session


def detect_tool_overlap(sessions: Iterable[Session], threshold: float = 0.4) -> list[Edge]:
    sessions = list(sessions)
    tool_sets: dict[str, set[str]] = {
        s.id: {t.name for t in s.tool_calls} for s in sessions
    }
    edges: list[Edge] = []
    for a, b in combinations(sorted(tool_sets), key=None):  # type: ignore[arg-type]
        ts_a = tool_sets[a]
        ts_b = tool_sets[b]
        union = ts_a | ts_b
        if not union:
            continue
        jacc = len(ts_a & ts_b) / len(union)
        if jacc < threshold:
            continue
        edges.append(
            Edge(
                source=a,
                target=b,
                kind="tool-overlap",
                weight=jacc,
                evidence={"jaccard": jacc, "shared_tools": sorted(ts_a & ts_b)},
            )
        )
    return edges
```

> **Note:** `combinations(sorted(...), key=None)` is wrong — `combinations` takes an iterable and a length. Fix before running:

```python
for a, b in combinations(sorted(tool_sets), 2):
```

**Verify, commit:**
```bash
pytest tests/test_tool_overlap.py -v
git commit -am "feat(core): detect tool-overlap edges (Jaccard)"
```

---

## Task 3.3: Implement `features.py` — feature vector per session

**File — Create:** `theia-core/theia_core/features.py`

```python
from __future__ import annotations

from collections import Counter

import numpy as np

from theia_core.ingest import Session


def build_feature_matrix(sessions: list[Session]) -> tuple[np.ndarray, list[str]]:
    """Returns (matrix of shape (n_sessions, n_features), feature_names)."""
    tool_vocab = sorted({t.name for s in sessions for t in s.tool_calls})
    # memory tag vocab: memory IDs touched (write or read)
    memory_vocab = sorted({m.memory_id for s in sessions for m in s.memory_events})

    feature_names: list[str] = []
    feature_names += [f"tool:{t}" for t in tool_vocab]
    feature_names += [f"mem:{m}" for m in memory_vocab]

    rows = []
    for s in sessions:
        tool_counts = Counter(t.name for t in s.tool_calls)
        mem_touched = {m.memory_id for m in s.memory_events}
        row = (
            [float(tool_counts.get(t, 0)) for t in tool_vocab]
            + [1.0 if m in mem_touched else 0.0 for m in memory_vocab]
        )
        rows.append(row)

    matrix = np.asarray(rows, dtype=float)
    # L2-normalize rows so projection isn't dominated by long sessions
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    matrix = matrix / norms
    return matrix, feature_names
```

**Test — Create:** `theia-core/tests/test_features.py`

```python
from datetime import datetime, timezone

import numpy as np

from theia_core.features import build_feature_matrix
from theia_core.ingest import MemoryEvent, Session, ToolCall


def _sess(id: str, tools: list[str], memories: list[str]) -> Session:
    return Session(
        id=id, title=id,
        started_at=datetime(2026, 4, 20, tzinfo=timezone.utc),
        duration_sec=60, model="t", message_count=1,
        tool_calls=tuple(ToolCall(name=t) for t in tools),
        memory_events=tuple(MemoryEvent(kind="write", memory_id=m) for m in memories),
        search_hits=(),
    )


def test_build_feature_matrix_shape_and_normalization() -> None:
    a = _sess("A", ["read", "bash"], ["m1"])
    b = _sess("B", ["read"], ["m2"])

    matrix, names = build_feature_matrix([a, b])

    assert matrix.shape[0] == 2
    assert matrix.shape[1] == len(names)
    # Row norms should be 1 (L2) for non-empty sessions
    assert np.allclose(np.linalg.norm(matrix, axis=1), 1.0)
    # Vocab ordering is deterministic
    assert "tool:bash" in names
    assert "mem:m1" in names
```

**Run → PASS. Commit:**
```bash
git commit -am "feat(core): build_feature_matrix"
```

---

## Task 3.4: Implement `project.py` — PCA to 2D

**File — Create:** `theia-core/theia_core/project.py`

```python
from __future__ import annotations

from typing import Literal

import numpy as np
from sklearn.decomposition import PCA

Projection = Literal["pca", "umap", "tool-vector"]


def project_to_2d(matrix: np.ndarray, method: Projection = "pca", seed: int = 42) -> np.ndarray:
    """Returns (n, 2) array of positions, normalized to the unit disk."""
    if matrix.shape[0] == 0:
        return np.zeros((0, 2))
    if matrix.shape[0] == 1:
        return np.zeros((1, 2))

    if method == "pca":
        n_components = min(2, matrix.shape[1], matrix.shape[0] - 1)
        if n_components < 2:
            # Degenerate case — pad with zero column
            coords = PCA(n_components=n_components, random_state=seed).fit_transform(matrix)
            coords = np.pad(coords, ((0, 0), (0, 2 - n_components)))
        else:
            coords = PCA(n_components=2, random_state=seed).fit_transform(matrix)
    elif method == "umap":
        import umap  # lazy import
        reducer = umap.UMAP(n_components=2, random_state=seed, n_neighbors=min(15, matrix.shape[0] - 1))
        coords = reducer.fit_transform(matrix)
    elif method == "tool-vector":
        # Pick the two highest-variance features; fallback to first two.
        variances = matrix.var(axis=0)
        idx = np.argsort(variances)[-2:] if matrix.shape[1] >= 2 else np.array([0, 0])
        coords = matrix[:, idx]
    else:
        raise ValueError(f"unknown projection {method!r}")

    # Normalize to unit disk: center, scale so max radius = 1
    coords = coords - coords.mean(axis=0)
    max_r = np.linalg.norm(coords, axis=1).max()
    if max_r > 0:
        coords = coords / max_r
    return coords
```

**Test — Create:** `theia-core/tests/test_project.py`

```python
import numpy as np
import pytest

from theia_core.project import project_to_2d


def test_project_pca_within_unit_disk() -> None:
    rng = np.random.default_rng(0)
    matrix = rng.normal(size=(10, 8))

    coords = project_to_2d(matrix, method="pca")

    assert coords.shape == (10, 2)
    radii = np.linalg.norm(coords, axis=1)
    assert radii.max() == pytest.approx(1.0, abs=1e-9)


def test_project_pca_deterministic() -> None:
    rng = np.random.default_rng(0)
    matrix = rng.normal(size=(10, 8))

    a = project_to_2d(matrix, method="pca", seed=42)
    b = project_to_2d(matrix, method="pca", seed=42)

    assert np.allclose(a, b)


def test_project_handles_single_row() -> None:
    matrix = np.ones((1, 5))
    coords = project_to_2d(matrix, method="pca")

    assert coords.shape == (1, 2)
```

**Run → PASS. Commit:**
```bash
git commit -am "feat(core): PCA/UMAP/tool-vector projection to unit disk"
```

---

## Task 3.5: Implement `emit.py` — build and write `graph.json`

**File — Create:** `theia-core/theia_core/emit.py`

```python
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from jsonschema import Draft202012Validator

from theia_core.detect import Edge
from theia_core.ingest import Session

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schemas" / "graph.schema.json"


def _load_validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text())
    return Draft202012Validator(schema)


def build_graph(
    sessions: list[Session],
    edges: list[Edge],
    positions: np.ndarray,
    projection: str,
    feature_dim: int,
) -> dict[str, Any]:
    assert positions.shape == (len(sessions), 2)
    nodes = []
    for sess, (x, y) in zip(sessions, positions, strict=True):
        nodes.append({
            "id": sess.id,
            "title": sess.title,
            "started_at": sess.started_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "duration_sec": sess.duration_sec,
            "tool_count": len(sess.tool_calls),
            "message_count": sess.message_count,
            "model": sess.model,
            "position": {"x": float(x), "y": float(y)},
            "features": None,
        })
    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "source_count": len(sessions),
            "projection": projection,
            "feature_dim": feature_dim,
        },
        "nodes": nodes,
        "edges": [
            {
                "source": e.source,
                "target": e.target,
                "kind": e.kind,
                "weight": e.weight,
                "evidence": e.evidence,
            }
            for e in edges
        ],
    }


def write_graph(graph: dict[str, Any], out_path: Path) -> None:
    validator = _load_validator()
    errors = sorted(validator.iter_errors(graph), key=lambda e: e.path)
    if errors:
        messages = "\n".join(f"  - {'/'.join(map(str, e.path))}: {e.message}" for e in errors)
        raise ValueError(f"graph.json failed schema validation:\n{messages}")
    out_path.write_text(json.dumps(graph, indent=2))
```

**Test — Create:** `theia-core/tests/test_emit.py`

```python
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from theia_core.detect import Edge
from theia_core.emit import build_graph, write_graph
from theia_core.ingest import Session


def _sess(id: str) -> Session:
    return Session(
        id=id, title=id,
        started_at=datetime(2026, 4, 20, tzinfo=timezone.utc),
        duration_sec=60.0, model="t", message_count=1,
        tool_calls=(), memory_events=(), search_hits=(),
    )


def test_build_graph_structure() -> None:
    sessions = [_sess("A"), _sess("B")]
    edges = [Edge(source="A", target="B", kind="memory-share", weight=0.5)]
    positions = np.array([[0.1, 0.2], [-0.3, 0.4]])

    g = build_graph(sessions, edges, positions, projection="pca", feature_dim=4)

    assert g["meta"]["source_count"] == 2
    assert g["meta"]["projection"] == "pca"
    assert len(g["nodes"]) == 2
    assert g["nodes"][0]["position"] == {"x": 0.1, "y": 0.2}
    assert len(g["edges"]) == 1


def test_write_graph_schema_invalid_raises(tmp_path: Path) -> None:
    bad = {"meta": {}, "nodes": [], "edges": []}
    with pytest.raises(ValueError, match="schema validation"):
        write_graph(bad, tmp_path / "out.json")


def test_write_graph_schema_valid_writes_file(tmp_path: Path) -> None:
    sessions = [_sess("A")]
    positions = np.array([[0.0, 0.0]])
    g = build_graph(sessions, [], positions, projection="pca", feature_dim=1)

    out = tmp_path / "out.json"
    write_graph(g, out)

    assert out.exists()
```

**Run → PASS. Commit:**
```bash
git commit -am "feat(core): build and schema-validate graph.json"
```

---

## Task 3.6: Wire the CLI in `__main__.py`

**File — Replace:** `theia-core/theia_core/__main__.py`

```python
from __future__ import annotations

import argparse
from pathlib import Path

from theia_core.detect.cross_search import detect_cross_search
from theia_core.detect.memory_share import detect_memory_share
from theia_core.detect.tool_overlap import detect_tool_overlap
from theia_core.emit import build_graph, write_graph
from theia_core.features import build_feature_matrix
from theia_core.ingest import load_sessions
from theia_core.project import project_to_2d


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="theia-core")
    parser.add_argument("sessions_dir", type=Path)
    parser.add_argument("-o", "--out", type=Path, default=Path("graph.json"))
    parser.add_argument("--projection", choices=["pca", "umap", "tool-vector"], default="pca")
    parser.add_argument("--tool-overlap-threshold", type=float, default=0.4)
    parser.add_argument("--include-features", action="store_true")
    parser.add_argument("--disable-tool-overlap", action="store_true")
    args = parser.parse_args(argv)

    sessions = load_sessions(args.sessions_dir)
    if not sessions:
        parser.error(f"no session JSONs found in {args.sessions_dir}")

    edges = detect_memory_share(sessions) + detect_cross_search(sessions)
    if not args.disable_tool_overlap:
        edges += detect_tool_overlap(sessions, threshold=args.tool_overlap_threshold)

    matrix, feature_names = build_feature_matrix(sessions)
    positions = project_to_2d(matrix, method=args.projection)
    graph = build_graph(
        sessions=sessions,
        edges=edges,
        positions=positions,
        projection=args.projection,
        feature_dim=len(feature_names),
    )
    if args.include_features:
        for i, node in enumerate(graph["nodes"]):
            node["features"] = matrix[i].tolist()

    write_graph(graph, args.out)
    print(f"wrote {args.out} — {len(graph['nodes'])} nodes, {len(graph['edges'])} edges")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

**Smoke test:**
```bash
cd /home/beheerder/projects/hermes-hackathon-theia
python -m theia_core theia-core/tests/fixtures/golden_sessions -o /tmp/graph.json
cat /tmp/graph.json | head
```
**Expected:** prints `wrote /tmp/graph.json — 3 nodes, N edges`. File validates against the schema.

**Commit:**
```bash
git commit -am "feat(core): wire CLI end-to-end"
```

---

## Task 3.7: Integration test — CLI against golden fixture

**File — Create:** `theia-core/tests/test_cli.py`

```python
import json
import subprocess
import sys
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "golden_sessions"


def test_cli_produces_valid_graph(tmp_path: Path) -> None:
    out = tmp_path / "graph.json"
    result = subprocess.run(
        [sys.executable, "-m", "theia_core", str(FIXTURE), "-o", str(out)],
        check=True, capture_output=True, text=True,
    )
    assert "wrote" in result.stdout

    graph = json.loads(out.read_text())
    assert graph["meta"]["source_count"] == 3
    assert len(graph["nodes"]) == 3
    # Should have at least one memory-share edge (alpha → beta)
    kinds = {e["kind"] for e in graph["edges"]}
    assert "memory-share" in kinds
```

**Run → PASS. Commit:**
```bash
git commit -am "test(core): CLI integration test against golden fixture"
```

---

## Task 3.8: Commit `examples/graph.json` from real samples (if 1.11 is done)

```bash
python -m theia_core examples/sessions -o examples/graph.json
git add examples/graph.json
git commit -m "chore(examples): regenerate graph.json from real sessions"
```

Remove `examples/graph.json` from `.gitignore` if it was listed — it should be committed.

**Acceptance for end of Day 3:**
- [ ] `pytest` covers ingest, memory-share, cross-search, tool-overlap, features, project, emit, CLI.
- [ ] `contract.yml` goes green.
- [ ] `examples/graph.json` exists and validates.

---

# Day 4 — 2026-04-24 · Panel scaffold + basic render + aesthetic lock

**Branch:** `panel/scaffold`

## Task 4.1: Fetch + validate `graph.json` loader

**File — Create:** `theia-panel/src/data/load.ts`

```ts
import type { TheiaGraph } from "./types";

export async function loadGraph(url: string): Promise<TheiaGraph> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
  const graph = (await res.json()) as TheiaGraph;
  if (!graph.meta || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("graph.json missing required top-level fields");
  }
  return graph;
}
```

**Test — Create:** `theia-panel/src/data/load.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGraph } from "./load";

afterEach(() => vi.restoreAllMocks());

describe("loadGraph", () => {
  it("parses a valid graph.json", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        meta: { generated_at: "2026-04-21T00:00:00Z", source_count: 1, projection: "pca" },
        nodes: [{ id: "a", title: "A", started_at: "2026-04-20T00:00:00Z", duration_sec: 0, tool_count: 0, position: { x: 0, y: 0 } }],
        edges: [],
      }),
    }));

    const g = await loadGraph("/graph.json");
    expect(g.nodes).toHaveLength(1);
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(loadGraph("/missing")).rejects.toThrow(/404/);
  });
});
```

**Run → PASS. Commit:**
```bash
npm run test
git commit -am "feat(panel): loadGraph with basic validation"
```

---

## Task 4.2: Create `Scene.ts` — renderer, camera, scene graph

**File — Create:** `theia-panel/src/scene/Scene.ts`

```ts
import * as THREE from "three";

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  dispose(): void;
  resize(): void;
}

export function createScene(container: HTMLElement): SceneContext {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07080d);

  const { clientWidth: w, clientHeight: h } = container;
  const aspect = w / h;
  const size = 1.2; // visible window = roughly the unit disk + margin
  const camera = new THREE.OrthographicCamera(-size * aspect, size * aspect, size, -size, -10, 10);
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h, false);
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  const resize = () => {
    const { clientWidth: w2, clientHeight: h2 } = container;
    const a = w2 / h2;
    camera.left = -size * a;
    camera.right = size * a;
    camera.top = size;
    camera.bottom = -size;
    camera.updateProjectionMatrix();
    renderer.setSize(w2, h2, false);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(container);

  return {
    scene, camera, renderer, container,
    resize,
    dispose() {
      ro.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
```

**Commit:**
```bash
git add theia-panel/src/scene/Scene.ts
git commit -m "feat(panel): scene + orthographic camera + renderer"
```

---

## Task 4.3: `Nodes.ts` — instanced glowing circles

**File — Create:** `theia-panel/src/scene/Nodes.ts`

```ts
import * as THREE from "three";
import type { TheiaGraph } from "../data/types";

const NODE_GLOW_TEXTURE = makeGlowTexture();

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export interface NodeLayer {
  mesh: THREE.InstancedMesh;
  count: number;
  setPosition(i: number, x: number, y: number): void;
  setHighlight(i: number, on: boolean): void;
  flush(): void;
  dispose(): void;
}

export function createNodes(graph: TheiaGraph): NodeLayer {
  const n = graph.nodes.length;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    map: NODE_GLOW_TEXTURE,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  const dummy = new THREE.Object3D();
  const baseColor = new THREE.Color(0xffc477); // warm default

  for (let i = 0; i < n; i++) {
    const node = graph.nodes[i]!;
    const size = 0.04 + Math.log1p(node.tool_count) * 0.01;
    dummy.position.set(node.position.x, node.position.y, 0);
    dummy.scale.set(size, size, size);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, baseColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor!.needsUpdate = true;

  return {
    mesh,
    count: n,
    setPosition(i, x, y) {
      mesh.getMatrixAt(i, dummy.matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      dummy.position.set(x, y, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    },
    setHighlight(i, on) {
      const c = on ? new THREE.Color(0xffffff) : baseColor;
      mesh.setColorAt(i, c);
    },
    flush() {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
```

**Commit:**
```bash
git add theia-panel/src/scene/Nodes.ts
git commit -m "feat(panel): instanced glowing node layer"
```

---

## Task 4.4: `Edges.ts` — line segments per edge kind

**File — Create:** `theia-panel/src/scene/Edges.ts`

```ts
import * as THREE from "three";
import type { TheiaGraph, Edge as GraphEdge } from "../data/types";

const COLORS: Record<GraphEdge["kind"], number> = {
  "memory-share": 0xffb366,
  "cross-search": 0x66d9ef,
  "tool-overlap": 0xb089ff,
};

export interface EdgeLayer {
  group: THREE.Group;
  rebuild(graph: TheiaGraph, enabledKinds: Set<GraphEdge["kind"]>, nodeIndex: Map<string, number>): void;
  updatePositions(positions: Float32Array): void;
  dispose(): void;
}

export function createEdges(): EdgeLayer {
  const group = new THREE.Group();
  const materials = new Map<GraphEdge["kind"], THREE.LineBasicMaterial>();
  let lineSegmentsByKind = new Map<GraphEdge["kind"], { line: THREE.LineSegments; edgeIdx: number[] }>();

  function rebuild(graph: TheiaGraph, enabledKinds: Set<GraphEdge["kind"]>, nodeIndex: Map<string, number>) {
    // Clear existing
    for (const { line } of lineSegmentsByKind.values()) {
      group.remove(line);
      line.geometry.dispose();
    }
    lineSegmentsByKind.clear();

    for (const kind of enabledKinds) {
      const edges = graph.edges.filter((e) => e.kind === kind);
      if (edges.length === 0) continue;
      const positions = new Float32Array(edges.length * 6);
      const edgeIdx: number[] = [];
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        const si = nodeIndex.get(e.source);
        const ti = nodeIndex.get(e.target);
        if (si === undefined || ti === undefined) continue;
        const s = graph.nodes[si]!;
        const t = graph.nodes[ti]!;
        positions[i * 6 + 0] = s.position.x;
        positions[i * 6 + 1] = s.position.y;
        positions[i * 6 + 2] = 0;
        positions[i * 6 + 3] = t.position.x;
        positions[i * 6 + 4] = t.position.y;
        positions[i * 6 + 5] = 0;
        edgeIdx.push(i);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      let mat = materials.get(kind);
      if (!mat) {
        mat = new THREE.LineBasicMaterial({
          color: COLORS[kind],
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        materials.set(kind, mat);
      }
      const line = new THREE.LineSegments(geometry, mat);
      group.add(line);
      lineSegmentsByKind.set(kind, { line, edgeIdx });
    }
  }

  function updatePositions(nodePositions: Float32Array) {
    // nodePositions is (n, 2). Recompute edge segment positions from current node positions.
    // For now this is called externally with the node-index map; simpler to rebuild().
    // Kept as a hook; used when physics updates nodes each tick.
  }

  function dispose() {
    for (const { line } of lineSegmentsByKind.values()) {
      line.geometry.dispose();
    }
    materials.forEach((m) => m.dispose());
  }

  return { group, rebuild, updatePositions, dispose };
}
```

**Commit:**
```bash
git add theia-panel/src/scene/Edges.ts
git commit -m "feat(panel): edge layer with per-kind color"
```

---

## Task 4.5: Wire `mount()` — first render

**File — Replace:** `theia-panel/src/index.ts`

```ts
import { loadGraph } from "./data/load";
import type { TheiaGraph, Edge as GraphEdge } from "./data/types";
import { createScene } from "./scene/Scene";
import { createNodes } from "./scene/Nodes";
import { createEdges } from "./scene/Edges";

export interface PanelOptions {
  edgeKinds?: GraphEdge["kind"][];
}

export interface Controller {
  destroy(): void;
}

const DEFAULT_KINDS: GraphEdge["kind"][] = ["memory-share", "cross-search"];

export async function mount(
  element: HTMLElement,
  graphUrl: string,
  options: PanelOptions = {},
): Promise<Controller> {
  const graph: TheiaGraph = await loadGraph(graphUrl);

  const ctx = createScene(element);
  const nodes = createNodes(graph);
  const edges = createEdges();
  const nodeIndex = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const kinds = new Set(options.edgeKinds ?? DEFAULT_KINDS);

  ctx.scene.add(nodes.mesh);
  ctx.scene.add(edges.group);
  edges.rebuild(graph, kinds, nodeIndex);

  let disposed = false;
  function frame() {
    if (disposed) return;
    ctx.renderer.render(ctx.scene, ctx.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    destroy() {
      disposed = true;
      nodes.dispose();
      edges.dispose();
      ctx.dispose();
    },
  };
}
```

**Verify visually:**
```bash
npm run dev
# open the printed URL, confirm glowing dots with lines.
# Use examples/graph.dev.json from Task 1.12, or the real examples/graph.json if available.
```

**Commit:**
```bash
git commit -am "feat(panel): mount() renders nodes + edges"
```

---

## Task 4.6: Aesthetic lock — commit palette + sizes + docs

**File — Create:** `theia-panel/src/aesthetic.ts`

```ts
// Locked 2026-04-24. Do not modify without a `joint/aesthetic-*` PR.
export const PALETTE = {
  background: 0x07080d,
  nodeBase: 0xffc477,        // warm amber
  nodeHighlight: 0xffffff,
  edgeMemory: 0xffb366,      // warm amber
  edgeSearch: 0x66d9ef,      // cool cyan
  edgeOverlap: 0xb089ff,     // muted violet
} as const;

export const SIZES = {
  nodeBase: 0.04,
  nodeToolScale: 0.01,       // per log1p(tool_count)
  edgeOpacity: 0.6,
} as const;
```

Move the hardcoded colors in `Nodes.ts` / `Edges.ts` to read from `PALETTE` / `SIZES`.

**Commit:**
```bash
git commit -am "feat(panel): aesthetic lock — palette + sizing constants"
```

**Acceptance for end of Day 4:**
- [ ] `npm run dev` shows a recognizable constellation from `examples/graph.json`.
- [ ] Three edge kinds render with distinct colors.
- [ ] Screenshot posted to team channel for aesthetic sign-off.

---

# Day 5 — 2026-04-25 · Physics + anchor force + bloom

**Branch:** `panel/physics-bloom`

## Task 5.1: `Simulation.ts` — d3-force-3d with custom anchor force

**File — Create:** `theia-panel/src/physics/Simulation.ts`

```ts
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  type Simulation,
} from "d3-force-3d";
import type { TheiaGraph } from "../data/types";

interface PhysicsNode {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  anchorX: number;
  anchorY: number;
}

interface PhysicsLink {
  source: string;
  target: string;
  weight: number;
}

/** Custom force: pulls each node toward its semantic anchor. */
function forceAnchor(strength = 0.15) {
  let nodes: PhysicsNode[] = [];
  function force(alpha: number) {
    for (const n of nodes) {
      n.vx = (n.vx ?? 0) + (n.anchorX - n.x) * strength * alpha;
      n.vy = (n.vy ?? 0) + (n.anchorY - n.y) * strength * alpha;
    }
  }
  force.initialize = (n: PhysicsNode[]) => { nodes = n; };
  return force;
}

export function createSimulation(graph: TheiaGraph) {
  const nodes: PhysicsNode[] = graph.nodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    anchorX: n.position.x,
    anchorY: n.position.y,
  }));
  const links: PhysicsLink[] = graph.edges.map((e) => ({
    source: e.source,
    target: e.target,
    weight: e.weight,
  }));

  const sim: Simulation<PhysicsNode, PhysicsLink> = forceSimulation(nodes, 2)
    .force("link", forceLink<PhysicsNode, PhysicsLink>(links).id((n) => n.id).strength(0.05))
    .force("charge", forceManyBody<PhysicsNode>().strength(-0.02))
    .force("anchor", forceAnchor(0.25))
    .force("center", forceCenter(0, 0))
    .alphaDecay(0.03)
    .alphaTarget(0.02); // keep a low-level breathing motion

  return { simulation: sim, nodes };
}
```

**Commit:**
```bash
git add theia-panel/src/physics/Simulation.ts
git commit -m "feat(panel): d3-force-3d simulation with anchor force"
```

---

## Task 5.2: Wire simulation into `mount()` — update positions each frame

**File — Modify:** `theia-panel/src/index.ts` (inside `mount`)

Replace the `frame()` loop with:

```ts
import { createSimulation } from "./physics/Simulation";

// … after nodes/edges are built:
const { simulation, nodes: simNodes } = createSimulation(graph);
simulation.stop();

function tick() {
  simulation.tick(1);
  for (let i = 0; i < simNodes.length; i++) {
    const sn = simNodes[i]!;
    nodes.setPosition(i, sn.x, sn.y);
  }
  nodes.flush();
  edges.rebuild(graph, kinds, nodeIndex); // positions update → simple rebuild for now
}

function frame() {
  if (disposed) return;
  tick();
  ctx.renderer.render(ctx.scene, ctx.camera);
  requestAnimationFrame(frame);
}
```

> Note: rebuilding edges every frame is fine for <500 edges. If jank appears, switch to in-place position-attribute updates on `BufferGeometry`.

**Commit:**
```bash
git commit -am "feat(panel): animate positions via simulation"
```

---

## Task 5.3: Bloom post-processing

**File — Create:** `theia-panel/src/scene/Post.ts`

```ts
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, container: HTMLElement) {
  const composer = new EffectComposer(renderer);
  composer.setSize(container.clientWidth, container.clientHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(container.clientWidth, container.clientHeight),
    0.9,  // strength
    0.4,  // radius
    0.12, // threshold
  );
  composer.addPass(bloom);

  function resize() {
    composer.setSize(container.clientWidth, container.clientHeight);
  }

  return { composer, bloom, resize };
}
```

**Wire into `mount()`:**

```ts
import { createPost } from "./scene/Post";

const post = createPost(ctx.renderer, ctx.scene, ctx.camera, element);
// Replace ctx.renderer.render(...) with:
post.composer.render();
// Also call post.resize() from the ResizeObserver in Scene.ts — pass it in or expose a callback.
```

**Commit:**
```bash
git commit -am "feat(panel): bloom post-processing"
```

**Acceptance for end of Day 5:**
- [ ] Nodes visibly settle and gently breathe.
- [ ] Bloom halos on nodes; edges glow faintly.
- [ ] Pairing the look with the spec's aesthetic — "chic hacker constellation" recognizable at a glance.

---

# Day 6 — 2026-04-26 · Hover, click, tooltip, filter bar

**Branch:** `panel/interactions`

## Task 6.1: Raycaster for mouse → node hit test

**File — Create:** `theia-panel/src/scene/Picker.ts`

```ts
import * as THREE from "three";
import type { NodeLayer } from "./Nodes";

export function createPicker(container: HTMLElement, camera: THREE.Camera, nodes: NodeLayer) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered: number | null = null;
  const listeners: Array<(i: number | null) => void> = [];

  function onMove(evt: MouseEvent) {
    const rect = container.getBoundingClientRect();
    ndc.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(nodes.mesh, false);
    const idx = hits.length > 0 ? (hits[0]!.instanceId ?? null) : null;
    if (idx !== hovered) {
      hovered = idx;
      listeners.forEach((fn) => fn(idx));
    }
  }

  container.addEventListener("mousemove", onMove);

  return {
    onHover(fn: (i: number | null) => void) { listeners.push(fn); },
    dispose() { container.removeEventListener("mousemove", onMove); },
  };
}
```

**Commit:**
```bash
git commit -am "feat(panel): raycaster picker for node hover"
```

---

## Task 6.2: `Tooltip.ts` + wire to picker

**File — Create:** `theia-panel/src/ui/Tooltip.ts`

```ts
import type { TheiaGraph } from "../data/types";

export function createTooltip(container: HTMLElement) {
  const el = document.createElement("div");
  el.style.cssText = `
    position: absolute; pointer-events: none;
    padding: 8px 12px; background: rgba(10,12,20,0.9);
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    font: 12px/1.4 ui-monospace, monospace; color: #cfd6e4;
    transform: translate(8px, 8px); opacity: 0; transition: opacity 120ms;
    max-width: 280px;
  `;
  container.appendChild(el);

  function show(node: TheiaGraph["nodes"][number], x: number, y: number) {
    el.innerHTML = `
      <div style="font-weight:600;color:#ffc477">${escape(node.title)}</div>
      <div style="opacity:0.7">${node.id}</div>
      <div style="margin-top:4px">${new Date(node.started_at).toLocaleString()}</div>
      <div>${Math.round(node.duration_sec)}s · ${node.tool_count} tools</div>
    `;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.opacity = "1";
  }

  function hide() { el.style.opacity = "0"; }
  function dispose() { container.removeChild(el); }

  return { show, hide, dispose };
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
```

**Wire in `mount()`:**
```ts
import { createTooltip } from "./ui/Tooltip";
import { createPicker } from "./scene/Picker";

element.style.position ||= "relative";
const tooltip = createTooltip(element);
const picker = createPicker(element, ctx.camera, nodes);
picker.onHover((idx) => {
  if (idx === null) { tooltip.hide(); return; }
  const n = graph.nodes[idx]!;
  // Use NDC→screen coords: simplest — use the last mouse event position.
  // For MVP: show near cursor via a separate mousemove listener updating coords.
});

let lastMouse = { x: 0, y: 0 };
element.addEventListener("mousemove", (e) => {
  const r = element.getBoundingClientRect();
  lastMouse = { x: e.clientX - r.left, y: e.clientY - r.top };
});
picker.onHover((idx) => {
  if (idx === null) tooltip.hide();
  else tooltip.show(graph.nodes[idx]!, lastMouse.x, lastMouse.y);
});
```

**Commit:**
```bash
git commit -am "feat(panel): tooltip on node hover"
```

---

## Task 6.3: Hover fade — dim non-incident edges

**Approach:** rebuild edges with per-edge opacity based on whether it's incident to the hovered node. For MVP, simpler: tint incident edges brighter, leave others base opacity.

**Modify:** `theia-panel/src/scene/Edges.ts` — add `setIncident(nodeId: string | null)` method that scales line material opacity per kind, OR (better) duplicates edges into foreground/background groups.

For time-economy: a quick variant — when hover is active, set all materials' opacity to 0.15 and add a secondary `LineSegments` per kind for just the incident edges at full opacity.

Keep the scope to "visibly responsive". Commit when good enough.

**Commit:**
```bash
git commit -am "feat(panel): dim non-incident edges on node hover"
```

---

## Task 6.4: Node click → emit event from Controller

**Modify:** `theia-panel/src/index.ts`

Add event emitter to Controller:

```ts
export interface Controller {
  destroy(): void;
  on(event: "node-click", handler: (nodeId: string) => void): void;
  on(event: "node-hover", handler: (nodeId: string | null) => void): void;
}

// inside mount:
const listeners: Record<string, Array<(...args: unknown[]) => void>> = { "node-click": [], "node-hover": [] };
function emit(event: string, ...args: unknown[]) {
  (listeners[event] ?? []).forEach((fn) => fn(...args));
}

element.addEventListener("click", () => {
  if (picker.currentHovered() !== null) {
    const n = graph.nodes[picker.currentHovered()!]!;
    emit("node-click", n.id);
  }
});

picker.onHover((idx) => emit("node-hover", idx === null ? null : graph.nodes[idx]!.id));

return {
  destroy() { /* … */ },
  on(event, handler) { (listeners[event] ??= []).push(handler as never); },
};
```

(Expose `currentHovered()` from `Picker.ts`.)

**Commit:**
```bash
git commit -am "feat(panel): emit node-click and node-hover events"
```

---

## Task 6.5: `FilterBar.ts` — edge-kind toggles

**File — Create:** `theia-panel/src/ui/FilterBar.ts`

```ts
import type { Edge as GraphEdge } from "../data/types";

export function createFilterBar(
  container: HTMLElement,
  initial: Set<GraphEdge["kind"]>,
  onChange: (kinds: Set<GraphEdge["kind"]>) => void,
) {
  const bar = document.createElement("div");
  bar.style.cssText = `
    position: absolute; top: 12px; left: 12px;
    display: flex; gap: 12px;
    padding: 8px 12px; background: rgba(10,12,20,0.7);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
    font: 12px/1.4 ui-monospace, monospace; color: #cfd6e4;
    user-select: none;
  `;
  const kinds: GraphEdge["kind"][] = ["memory-share", "cross-search", "tool-overlap"];
  const state = new Set(initial);

  for (const kind of kinds) {
    const label = document.createElement("label");
    label.style.cssText = "display:flex;gap:6px;align-items:center;cursor:pointer";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.has(kind);
    cb.onchange = () => {
      if (cb.checked) state.add(kind);
      else state.delete(kind);
      onChange(new Set(state));
    };
    label.append(cb, document.createTextNode(kind));
    bar.append(label);
  }

  container.appendChild(bar);
  return { dispose: () => container.removeChild(bar) };
}
```

**Wire:** call `edges.rebuild(graph, newKinds, nodeIndex)` on change. Make `kinds` a mutable variable in mount closure.

**Commit:**
```bash
git commit -am "feat(panel): edge-kind filter bar"
```

**Acceptance for end of Day 6:**
- [ ] Hovering a node shows a tooltip and dims non-incident edges.
- [ ] Clicking emits `node-click` (verify in console).
- [ ] Filter bar toggles reshape the graph live.

---

# Day 7 — 2026-04-27 · Side panel + end-to-end demo playable

**Branch:** `panel/side-panel`

## Task 7.1: `SidePanel.ts` — detail view on click

**File — Create:** `theia-panel/src/ui/SidePanel.ts`

```ts
import type { TheiaGraph } from "../data/types";

export function createSidePanel(container: HTMLElement) {
  const el = document.createElement("aside");
  el.style.cssText = `
    position: absolute; top: 0; right: 0; bottom: 0; width: min(380px, 40vw);
    background: rgba(10,12,20,0.92); border-left: 1px solid rgba(255,255,255,0.1);
    color: #cfd6e4; font: 13px/1.5 ui-monospace, monospace;
    transform: translateX(100%); transition: transform 200ms ease-out;
    padding: 20px 22px; overflow-y: auto; box-sizing: border-box;
  `;
  container.appendChild(el);

  let currentId: string | null = null;

  function show(node: TheiaGraph["nodes"][number], relatedEdges: TheiaGraph["edges"]) {
    currentId = node.id;
    el.innerHTML = `
      <button aria-label="close" id="sv-close"
        style="position:absolute;top:10px;right:14px;background:none;border:none;color:#cfd6e4;font-size:18px;cursor:pointer">×</button>
      <h3 style="margin:0 0 4px;color:#ffc477;font-size:15px">${escape(node.title)}</h3>
      <div style="opacity:0.6;margin-bottom:14px">${node.id}</div>
      <dl style="margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 10px">
        <dt style="opacity:0.6">Started</dt><dd style="margin:0">${new Date(node.started_at).toLocaleString()}</dd>
        <dt style="opacity:0.6">Duration</dt><dd style="margin:0">${Math.round(node.duration_sec)}s</dd>
        <dt style="opacity:0.6">Model</dt><dd style="margin:0">${escape(node.model ?? "-")}</dd>
        <dt style="opacity:0.6">Tools</dt><dd style="margin:0">${node.tool_count}</dd>
        <dt style="opacity:0.6">Messages</dt><dd style="margin:0">${node.message_count ?? "-"}</dd>
      </dl>
      <h4 style="margin:18px 0 6px;font-size:12px;letter-spacing:0.5px;opacity:0.7">CONNECTIONS</h4>
      <ul style="margin:0;padding-left:18px">
        ${relatedEdges.map((e) => `<li>${e.kind} ${e.source === node.id ? "→" : "←"} ${escape(e.source === node.id ? e.target : e.source)} (w=${e.weight.toFixed(2)})</li>`).join("")}
      </ul>
    `;
    (el.querySelector("#sv-close") as HTMLButtonElement).onclick = hide;
    el.style.transform = "translateX(0)";
  }

  function hide() {
    currentId = null;
    el.style.transform = "translateX(100%)";
  }

  function currentNodeId() { return currentId; }
  function dispose() { container.removeChild(el); }

  return { show, hide, currentNodeId, dispose };
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
```

**Wire in `mount()`:**
```ts
import { createSidePanel } from "./ui/SidePanel";

const sidePanel = createSidePanel(element);
const onClick = (nodeId: string) => {
  const n = graph.nodes.find((x) => x.id === nodeId);
  if (!n) return;
  const related = graph.edges.filter((e) => e.source === nodeId || e.target === nodeId);
  sidePanel.show(n, related);
};
// (replace the earlier emit/click wiring to call onClick directly)
```

**Commit:**
```bash
git commit -am "feat(panel): side panel with session details on click"
```

---

## Task 7.2: End-to-end manual walkthrough

**Checklist:**
- [ ] Load `examples/graph.json`.
- [ ] Confirm constellation renders, settles, breathes.
- [ ] Hover — tooltip appears; non-incident edges dim.
- [ ] Click — side panel opens with details + connections list.
- [ ] Close side panel.
- [ ] Filter bar — toggle `tool-overlap` on; confirm extra edges appear.
- [ ] Toggle all off → no edges.
- [ ] Toggle all on → all edges.
- [ ] Resize window — layout stays readable.

**Fix anything broken.** Commit fixes individually.

---

## Task 7.3: Capture a quick screen recording for demo rehearsal

Tool: `peek` (linux), QuickTime (mac), or OBS. 30-second clip of the full interaction flow. Store locally (not in repo).

**Acceptance for end of Day 7:**
- [ ] Full demo playable from `npm run dev` with no console errors.
- [ ] Screen recording exists and looks demo-worthy.

---

# Day 8 — 2026-04-28 · Aesthetic freeze + 3D stretch

**Branch:** `panel/aesthetic-freeze` then `panel/3d-stretch`

## Task 8.1: Aesthetic freeze pass

- Walk through the demo on a fresh machine/session.
- Tune bloom strength/threshold, node base size, edge opacity, breathing perturbation amplitude.
- Update `aesthetic.ts` with final values.
- **Commit labeled `chore(panel): aesthetic freeze`.** No aesthetic edits after this without `joint/` PR.

---

## Task 8.2: 3D mode (stretch)

**File — Modify:** `theia-panel/src/scene/Scene.ts` — add option for `PerspectiveCamera`.

```ts
export interface SceneOptions { dim3?: boolean; }

export function createScene(container: HTMLElement, options: SceneOptions = {}): SceneContext {
  const { clientWidth: w, clientHeight: h } = container;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07080d);

  let camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  if (options.dim3) {
    camera = new THREE.PerspectiveCamera(40, w / h, 0.01, 100);
    camera.position.set(0, 0, 3.5);
  } else {
    const size = 1.2;
    camera = new THREE.OrthographicCamera(-size * (w/h), size * (w/h), size, -size, -10, 10);
    camera.position.z = 5;
  }
  // …
}
```

**Modify:** `Simulation.ts` to optionally use z-axis (encode `started_at` normalized).
**Modify:** `Nodes.ts` / `Edges.ts` to use 3D positions.
**Add** slow camera orbit in `mount()` when `dim3` is true.

This is **stretch** — if any part blows the time budget, revert 8.2 entirely and keep 2D. Do not let 3D break the demo.

**Commit:**
```bash
git commit -am "feat(panel): 3D mode stretch (dim3 option)"
```

**Acceptance for end of Day 8:**
- [ ] Aesthetic values locked in `aesthetic.ts`.
- [ ] 2D demo flow still works.
- [ ] 3D mode either works or is reverted — never half-working.

---

# Day 9 — 2026-04-29 · Hermes dashboard integration

**Branch:** `joint/hermes-integration`

## Task 9.1: Identify Hermes plugin/mount surface

Confirm: does the dashboard have a plugin registry, a route slot, or is "integration" just embedding a built JS bundle into an iframe/HTML panel?

Document in `docs/integration.md` (create it) with the exact mounting approach.

## Task 9.2: Build a loadable module artifact

**Command (in `theia-panel`):**
```bash
npm run build
# outputs dist/theia-panel.js (ES module) and any assets
```

## Task 9.3: Wire into Hermes dashboard

Depends on 9.1's answer. Likely variants:
- **Plugin registry:** register a plugin exporting `mount(element, props)`; Hermes handles lifecycle.
- **Route slot:** add a new route/page that imports the built bundle and calls `mount()`.
- **Iframe:** serve Vite build as static assets; dashboard embeds via iframe with the graph.json URL as a query param.

Smallest-risk path: **iframe with graph.json URL**. Largest-integration-value: **plugin registry**. Pick based on Hermes dashboard's idioms.

## Task 9.4: Smoke test in-dashboard

Open Hermes → navigate to theia panel → confirm:
- [ ] It renders.
- [ ] Interactions work within the dashboard's styling.
- [ ] No console errors from dashboard host.

## Task 9.5: Fix integration surprises

Budget: 0.5 day for unexpected styling conflicts, CSP issues, or bundler incompatibilities.

**Acceptance for end of Day 9:**
- [ ] theia loads and renders inside the real Hermes dashboard.
- [ ] Demo flow from Day 7 still works in-dashboard.

---

# Day 10 — 2026-04-30 · Polish + rehearsal + video backup

## Task 10.1: Full demo rehearsal, timed

- Set a 3-minute timer; run through the demo narrative from spec §7.
- Identify any sticky spots (cluster is ambiguous, transition is awkward, tooltip text is too dense).
- List fixes; execute the ones under ~30 minutes each.

## Task 10.2: Record demo video as fallback

If hackathon presentation has a live-demo risk (wifi, laptop, GPU glitches), a recorded backup saves the score.

- Record in 1080p minimum, screen + mic narration.
- Upload to a private unlisted YouTube/Drive link.
- Tag the commit `v1.0.0-rc1`.

## Task 10.3: Final JSON fixture curation

- Pick the set of real Hermes sessions that tells the best story (clusters are visible, edges are meaningful, demo beats have clear focal points).
- Update `examples/sessions/` and regenerate `examples/graph.json`.
- Tweak `title` field if raw titles are awkward on-screen.

## Task 10.4: Write demo script

`docs/demo-script.md` — verbatim narration for the 3-minute walkthrough, time-stamped per beat. Rehearse from it tomorrow.

**Acceptance for end of Day 10:**
- [ ] Demo runs in 3 minutes or less with zero hiccups.
- [ ] Fallback video recorded.
- [ ] Demo script written.

---

# Day 11 — 2026-05-01 · Buffer + final rehearsal

## Task 11.1: Do nothing new

Only bugfixes. No new features, no refactors, no aesthetic edits.

## Task 11.2: Two final rehearsals

Once in the morning, once in the evening. If something breaks, fix and rehearse again.

**Acceptance for end of Day 11:**
- [ ] Tag `v1.0.0-demo` on main.
- [ ] Backup video confirmed playable.
- [ ] Both devs can run the demo from muscle memory.

---

# Appendix — Risk triage matrix

If things go wrong mid-week, triage against this table:

| If this slips… | …cut this first |
|---|---|
| Day 2–3 (core) | `tool-overlap` detector (spec says it's toggled off by default anyway) |
| Day 4–5 (panel scaffold) | Breathing perturbation, film grain |
| Day 6 (interactions) | Edge-fade-on-hover (keep tooltip) |
| Day 7 (side panel) | Ditch the connections list, show summary only |
| Day 8 (stretch) | **Always** — 3D is explicitly optional |
| Day 9 (integration) | Fall back to iframe or standalone URL |

Do not cut: **the core demo flow (load → cluster reveal → edge toggle → detail panel)**. Everything else is negotiable.
