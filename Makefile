# theia — Build Pipeline
#
# Environments:
#   make dev       — Local development: Vite hot-reload + dashboard symlink
#   make staging   — Staging: full build, packaged plugin, tested end-to-end
#   make release   — Production: versioned tarball for GitHub Releases
#
# Quick reference:
#   make install   — Install all dependencies (core + panel)
#   make test      — Run all tests (core + panel + contract)
#   make lint      — Run all linters
#   make ci        — Full CI pipeline (lint + test + build + package)

SHELL := /bin/bash
.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

VERSION       := $(shell python3 -c "import json; print(json.load(open('plugin/manifest.json'))['version'])")
PLUGIN_NAME   := theia-constellation
DIST_DIR      := dist/plugin/dashboard
PACKAGE_NAME  := $(PLUGIN_NAME)-v$(VERSION).tar.gz
HERMES_PLUGINS := $(HOME)/.hermes/plugins
DEV_PORT      := 5173

# ---------------------------------------------------------------------------
# Source collections (for file-target dependency tracking)
# ---------------------------------------------------------------------------

CORE_SOURCES    := $(shell find theia-core/theia_core -name '*.py' 2>/dev/null)
FIXTURE_SOURCES := $(shell find examples/sessions -name '*.json' 2>/dev/null)
PANEL_SOURCES   := $(shell find theia-panel/src -name '*.ts' ! -path '*/data/types.ts' 2>/dev/null) \
                   theia-panel/vite.config.embed.ts theia-panel/index.html
PLUGIN_SOURCES  := $(wildcard plugin/api/*.py) \
                   plugin/manifest.json plugin/src/index.js plugin/src/style.css

# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

.PHONY: install install-core install-panel
install: install-core install-panel ## Install all dependencies

install-core:
	cd theia-core && pip install -e ".[dev]"

install-panel:
	cd theia-panel && npm ci

# ---------------------------------------------------------------------------
# Dev
# ---------------------------------------------------------------------------

.PHONY: dev dev-panel dev-link
dev: dev-link ## Start dev environment (Vite hot-reload + plugin symlink)
	@echo ""
	@echo "  Dev environment ready:"
	@echo "    Panel:     http://localhost:$(DEV_PORT)"
	@echo "    Dashboard: run 'THEIA_ENV=development hermes dashboard'"
	@echo ""
	THEIA_ENV=development cd theia-panel && npx vite --host 0.0.0.0 --port $(DEV_PORT)

dev-panel: ## Start panel dev server only
	cd theia-panel && npx vite --host 0.0.0.0 --port $(DEV_PORT)

dev-link: ## Symlink plugin source into ~/.hermes/plugins for dev
	@mkdir -p $(HERMES_PLUGINS)
	@mkdir -p $(DIST_DIR)/panel $(DIST_DIR)/dist
	@# In dev mode, plugin_api.py reads static files and panel points at Vite
	@cp plugin/manifest.json $(DIST_DIR)/manifest.json
	@cp plugin/src/index.js $(DIST_DIR)/dist/index.js
	@cp plugin/src/style.css $(DIST_DIR)/dist/style.css
	@cp plugin/api/__init__.py $(DIST_DIR)/__init__.py
	@cp plugin/api/plugin_api.py $(DIST_DIR)/plugin_api.py
	@cp plugin/api/graph_data.py $(DIST_DIR)/graph_data.py
	@ln -sfn $(CURDIR)/dist/plugin $(HERMES_PLUGINS)/$(PLUGIN_NAME)
	@echo "  Linked: $(HERMES_PLUGINS)/$(PLUGIN_NAME) -> $(CURDIR)/dist/plugin"

# ---------------------------------------------------------------------------
# Build (file-based targets — only rebuild when sources change)
# ---------------------------------------------------------------------------

# Generated types: rebuilds only when schema changes
GENERATED_TYPES := theia-panel/src/data/types.ts
$(GENERATED_TYPES): schemas/graph.schema.json
	cd theia-panel && npm run generate-types

# Graph: rebuilds only when core code or fixture JSONs change
examples/graph.json: $(CORE_SOURCES) $(FIXTURE_SOURCES)
	@rm -f /tmp/theia_build.db
	@PYTHONPATH=theia-core python3 -c "\
	from pathlib import Path; \
	from tests.db_helpers import seed_test_db; \
	db = Path('/tmp/theia_build.db'); \
	seed_test_db(db, Path('examples/sessions')); \
	print(f'seeded {db}')"
	python3 -m theia_core --db-path /tmp/theia_build.db -o examples/graph.json

# Panel embed: rebuilds only when panel TS sources or generated types change
theia-panel/dist-embed/.built: $(PANEL_SOURCES) $(GENERATED_TYPES)
	cd theia-panel && npx vite build --config vite.config.embed.ts
	@touch $@

# Plugin assembly: rebuilds when embed or plugin sources change
$(DIST_DIR)/.built: theia-panel/dist-embed/.built $(PLUGIN_SOURCES)
	@rm -rf $(DIST_DIR)
	@mkdir -p $(DIST_DIR)/dist $(DIST_DIR)/panel
	@# Copy plugin source
	@cp plugin/manifest.json $(DIST_DIR)/manifest.json
	@cp plugin/src/index.js $(DIST_DIR)/dist/index.js
	@cp plugin/src/style.css $(DIST_DIR)/dist/style.css
	@# Copy backend API modules
	@cp plugin/api/__init__.py $(DIST_DIR)/__init__.py
	@cp plugin/api/plugin_api.py $(DIST_DIR)/plugin_api.py
	@cp plugin/api/graph_data.py $(DIST_DIR)/graph_data.py
	@# Copy built panel
	@cp -r theia-panel/dist-embed/* $(DIST_DIR)/panel/
	@echo "  Plugin assembled: $(DIST_DIR)/"
	@echo "    $$(find $(DIST_DIR) -type f | wc -l) files"
	@touch $@

# Package: rebuilds only when assembled plugin changes
dist/$(PACKAGE_NAME): $(DIST_DIR)/.built
	@mkdir -p dist
	cd dist/plugin && tar -czf ../$(PACKAGE_NAME) .
	@echo "  Package: dist/$(PACKAGE_NAME)"
	@echo "  Size: $$(du -h dist/$(PACKAGE_NAME) | cut -f1)"

# PHONY convenience aliases (delegate to file targets)
.PHONY: build build-graph build-panel-embed build-plugin package
build: build-graph build-panel-embed build-plugin ## Full build (graph + panel + plugin)
build-graph: examples/graph.json
build-panel-embed: theia-panel/dist-embed/.built
build-plugin: $(DIST_DIR)/.built
package: dist/$(PACKAGE_NAME) ## Create distributable tarball

# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------

.PHONY: staging staging-deploy
staging: build ## Build and deploy to local hermes for staging
	@$(MAKE) --no-print-directory staging-deploy

staging-deploy: ## Deploy built plugin to ~/.hermes/plugins (staging mode)
	@mkdir -p $(HERMES_PLUGINS)
	@rm -rf $(HERMES_PLUGINS)/$(PLUGIN_NAME)
	@mkdir -p $(HERMES_PLUGINS)/$(PLUGIN_NAME)
	@cp -r $(DIST_DIR) $(HERMES_PLUGINS)/$(PLUGIN_NAME)/dashboard
	@echo "  Deployed: $(HERMES_PLUGINS)/$(PLUGIN_NAME)/dashboard/"
	@echo "  Start with: THEIA_ENV=staging hermes dashboard"

# ---------------------------------------------------------------------------
# Release
# ---------------------------------------------------------------------------

.PHONY: release
release: package ## Create release (tarball + git tag)
	@echo ""
	@echo "  Release v$(VERSION) ready:"
	@echo "    Artifact: dist/$(PACKAGE_NAME)"
	@echo "    Tag:      git tag -a v$(VERSION) -m 'Release $(VERSION)'"
	@echo "    Push:     git push origin v$(VERSION)"
	@echo ""

# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------

.PHONY: test test-core test-panel test-contract test-plugin
test: test-core test-panel test-contract test-plugin ## Run all tests

test-core: ## Run theia-core tests
	cd theia-core && pytest -q

test-panel: ## Run theia-panel tests
	cd theia-panel && npm run test -- --run

test-contract: examples/graph.json ## Run cross-stack contract test (reuses graph)
	@python3 -c "\
	import json, jsonschema; \
	schema = json.load(open('schemas/graph.schema.json')); \
	data = json.load(open('examples/graph.json')); \
	jsonschema.validate(data, schema); \
	print('Schema validation: OK')"

test-plugin: ## Validate plugin structure
	@echo "  Checking plugin manifest..."
	@python3 -c "import json, sys; m = json.load(open('plugin/manifest.json')); assert 'name' in m, 'missing name'; assert 'entry' in m, 'missing entry'; assert 'api' in m, 'missing api'; print('  manifest.json: OK')"
	@echo "  Checking plugin source files..."
	@test -f plugin/src/index.js || (echo '  FAIL: plugin/src/index.js missing' && exit 1)
	@test -f plugin/src/style.css || (echo '  FAIL: plugin/src/style.css missing' && exit 1)
	@test -f plugin/api/__init__.py || (echo '  FAIL: plugin/api/__init__.py missing' && exit 1)
	@test -f plugin/api/plugin_api.py || (echo '  FAIL: plugin/api/plugin_api.py missing' && exit 1)
	@test -f plugin/api/graph_data.py || (echo '  FAIL: plugin/api/graph_data.py missing' && exit 1)
	@echo "  Plugin structure: OK"

# ---------------------------------------------------------------------------
# Lint
# ---------------------------------------------------------------------------

.PHONY: lint lint-core lint-panel lint-plugin
lint: lint-core lint-panel lint-plugin ## Run all linters

lint-core: ## Lint theia-core (ruff + mypy)
	cd theia-core && ruff check . && ruff format --check . && mypy theia_core

lint-panel: ## Lint theia-panel (tsc + prettier)
	cd theia-panel && npm run typecheck && npm run format:check

lint-plugin: ## Lint plugin Python code
	ruff check plugin/api/*.py && ruff format --check plugin/api/*.py

# ---------------------------------------------------------------------------
# CI (full pipeline — parallelised phases, file targets prevent re-work)
# ---------------------------------------------------------------------------

.PHONY: ci
ci: ## Full CI pipeline (parallelised phases)
	@$(MAKE) --no-print-directory -j4 lint-core lint-panel lint-plugin test-plugin
	@$(MAKE) --no-print-directory -j4 test-core test-panel build-graph build-panel-embed
	@$(MAKE) --no-print-directory -j4 test-contract build-plugin
	@$(MAKE) --no-print-directory package
	@echo ""
	@echo "  CI passed: lint + test + build + package"
	@echo "  Artifact:  dist/$(PACKAGE_NAME)"

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------

.PHONY: clean
clean: ## Remove all build artifacts
	rm -rf dist/ theia-panel/dist/ theia-panel/dist-embed/
	rm -rf theia-core/build/ theia-core/*.egg-info/
