#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Theia Constellation — One-command installer
#
# Builds and deploys the Theia plugin into a Hermes Agent installation.
# Default target is staging (production-style: bundled panel, pre-built graph
# from the real ~/.hermes/state.db).  Pass --dev to leave the panel pointing
# at a Vite dev server instead.
#
# Usage:
#   bash install.sh                          install staging build
#   bash install.sh --dev                    dev mode (panel via Vite)
#   bash install.sh --no-graph               skip initial graph generation
#   bash install.sh --no-service             skip the watcher service prompt
#   bash install.sh --no-update              don't git-pull an existing clone
#   bash install.sh --help
#
# What it does (staging, the default):
#   1. Verify prerequisites (python3 ≥ 3.11, node, npm, git)
#   2. Clone or update the repo into ~/.hermes/hermes-theia
#   3. Create a venv and install theia-core (no [dev] extras)
#   4. npm ci + vite build for the panel embed
#   5. Assemble the plugin tree into ~/.hermes/plugins/theia-constellation
#   6. Generate ~/.hermes/theia-graph.json from ~/.hermes/state.db (if present)
#   7. Optionally install a watcher (systemd --user / system / shell script)
# ---------------------------------------------------------------------------
set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
REPO_URL="https://github.com/arm64be/theia"
REPO_TAG="main"  # pin to a release tag or commit SHA for production

# ---------------------------------------------------------------------------
# Curl-pipe bootstrap: when BASH_SOURCE is empty the script was piped via
#   curl -fsSL https://raw.githubusercontent.com/arm64be/theia/main/install.sh | bash
# Download a tarball of the repo into a temp directory and re-exec from
# there so the full checkout (theia-core, theia-panel, plugin) is available.
# ---------------------------------------------------------------------------
if [ -z "${BASH_SOURCE[0]:-}" ]; then
    TMPDIR="$(mktemp -d)"

    echo ""
    echo "  Cloning Theia from ${REPO_URL} ..."
    echo ""

    git clone --depth 1 --branch "$REPO_TAG" "$REPO_URL" "$TMPDIR"

    exec bash "${TMPDIR}/install.sh" "$@"
fi
HERMES_HOME="${THEIA_HOME:-${HERMES_HOME:-${HOME}/.hermes}}"
INSTALL_DIR="${HERMES_HOME}/hermes-theia"
VENV_DIR="${INSTALL_DIR}/.venv"
PLUGINS_DIR="${HERMES_HOME}/plugins"
PLUGIN_NAME="theia-constellation"
PLUGIN_TARGET="${PLUGINS_DIR}/${PLUGIN_NAME}"
STATE_DB="${HERMES_HOME}/state.db"
GRAPH_OUT="${HERMES_HOME}/theia-graph.json"

MODE="staging"
NO_UPDATE=false
NO_SERVICE=false
NO_GRAPH=false

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
usage() {
    cat <<'EOF'
Usage: bash install.sh [options]

Options:
  --dev            Install in dev mode (no panel build, plugin expects Vite)
  --no-graph       Skip initial graph generation from state.db
  --no-service     Skip the watcher service prompt
  --no-update      Don't git-pull if the repo is already cloned
  -h, --help       Show this help and exit
EOF
}

for arg in "$@"; do
    case "$arg" in
        -h|--help)    usage; exit 0 ;;
        --dev)        MODE="dev" ;;
        --no-graph)   NO_GRAPH=true ;;
        --no-service) NO_SERVICE=true ;;
        --no-update)  NO_UPDATE=true ;;
        *)            echo "error: unknown option: $arg" >&2; usage; exit 2 ;;
    esac
done

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; RESET='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi
info() { printf "${BLUE}[INFO]${RESET}  %s\n" "$*"; }
ok()   { printf "${GREEN}[ OK ]${RESET}  %s\n" "$*"; }
warn() { printf "${YELLOW}[WARN]${RESET}  %s\n" "$*" >&2; }
err()  { printf "${RED}[ERR ]${RESET}  %s\n" "$*" >&2; }

ORIG_INSTALL_DIR="${INSTALL_DIR}"
_FRESH_CLONE=false
trap 'err "Installation failed at line $LINENO."; if $_FRESH_CLONE; then err "To retry: rm -rf ${ORIG_INSTALL_DIR} && bash install.sh"; else err "Check the messages above and fix any issues, then re-run bash install.sh"; fi; exit 1' ERR

# ---------------------------------------------------------------------------
# OS detection
# ---------------------------------------------------------------------------
case "$(uname -s)" in
    Linux*)  OS_KIND="linux" ;;
    Darwin*) OS_KIND="macos" ;;
    *)       OS_KIND="other" ;;
esac

# ---------------------------------------------------------------------------
# 1. Prerequisites
# ---------------------------------------------------------------------------
check_prereqs() {
    info "Checking prerequisites..."
    local missing=()
    for cmd in python3 node npm git; do
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
    done
    if [ ${#missing[@]} -gt 0 ]; then
        err "Missing required commands: ${missing[*]}"
        err "Install them via your package manager and re-run."
        exit 1
    fi

    if ! python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null; then
        local pyver
        pyver=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
        err "Python 3.11+ required (found ${pyver})"
        exit 1
    fi
    ok "python3 $(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")')"
    ok "node $(node --version)"
    ok "npm $(npm --version)"
}

# ---------------------------------------------------------------------------
# 2. Clone or update the repository
# ---------------------------------------------------------------------------
clone_repo() {
    # If the script was invoked from inside an existing checkout, prefer that
    # checkout instead of re-cloning into ~/.hermes/hermes-theia.  This makes
    # `bash install.sh` a noop-friendly, in-place install for developers.
    local self="${BASH_SOURCE[0]:-}"
    if [ -n "$self" ] && [ -f "$self" ]; then
        local self_dir
        self_dir="$(cd "$(dirname "$self")" && pwd)"
        if [ -f "${self_dir}/Makefile" ] && [ -f "${self_dir}/plugin/manifest.json" ]; then
            INSTALL_DIR="$self_dir"
            VENV_DIR="${INSTALL_DIR}/.venv"
            info "Using existing checkout at ${INSTALL_DIR}"
            return
        fi
    fi

    if [ -d "${INSTALL_DIR}/.git" ]; then
        if $NO_UPDATE; then
            info "Repository exists at ${INSTALL_DIR} (skipping update)"
            return
        fi
        info "Updating ${INSTALL_DIR}..."
        if ! git -C "$INSTALL_DIR" pull --ff-only 2>/dev/null; then
            warn "git pull failed (local changes or network) — continuing with existing checkout"
        fi
        return
    fi

    info "Cloning ${REPO_URL} -> ${INSTALL_DIR}..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --depth 1 --branch "$REPO_TAG" "$REPO_URL" "$INSTALL_DIR"
    _FRESH_CLONE=true
    ok "Repository cloned"
}

# ---------------------------------------------------------------------------
# 3. Python venv + theia-core
# ---------------------------------------------------------------------------
setup_venv() {
    if [ -x "${VENV_DIR}/bin/theia-core" ]; then
        info "Reusing existing venv at ${VENV_DIR}"
    else
        info "Creating venv at ${VENV_DIR}..."
        python3 -m venv "$VENV_DIR"
    fi
    info "Installing theia-core into venv..."
    "${VENV_DIR}/bin/pip" install --upgrade pip --quiet
    "${VENV_DIR}/bin/pip" install --quiet -e "${INSTALL_DIR}/theia-core"
    ok "theia-core installed: $("${VENV_DIR}/bin/theia-core" --help | head -1)"
}

# ---------------------------------------------------------------------------
# 4. Build the panel embed (skipped in --dev mode)
# ---------------------------------------------------------------------------
build_panel() {
    if [ "$MODE" = "dev" ]; then
        info "Skipping panel build (--dev mode — start it manually with: cd theia-panel && npm run dev)"
        return
    fi
    info "Installing panel npm dependencies..."
    (cd "${INSTALL_DIR}/theia-panel" && npm ci --silent --no-audit --no-fund)

    info "Building panel embed (vite)..."
    (cd "${INSTALL_DIR}/theia-panel" && npx vite build --config vite.config.embed.ts --logLevel=error)
    ok "Panel embed built"
}

# ---------------------------------------------------------------------------
# 5. Assemble the plugin tree directly under ~/.hermes/plugins/
# ---------------------------------------------------------------------------
deploy_plugin() {
    info "Deploying plugin to ${PLUGIN_TARGET}..."

    # Refuse to clobber a non-symlink directory that we didn't create.
    if [ -e "$PLUGIN_TARGET" ] && [ ! -L "$PLUGIN_TARGET" ]; then
        local backup="${PLUGIN_TARGET}.bak.$(date +%s)"
        warn "Existing ${PLUGIN_TARGET} is not a symlink — backing up to ${backup}"
        mv "$PLUGIN_TARGET" "$backup"
    fi
    rm -f "$PLUGIN_TARGET"

    mkdir -p "$PLUGINS_DIR"
    local dest="${PLUGIN_TARGET}/dashboard"
    mkdir -p "${dest}/dist" "${dest}/data"

    # Plugin manifest, frontend loader, styles
    cp "${INSTALL_DIR}/plugin/manifest.json" "${dest}/manifest.json"
    cp "${INSTALL_DIR}/plugin/src/index.js"  "${dest}/dist/index.js"
    cp "${INSTALL_DIR}/plugin/src/style.css" "${dest}/dist/style.css"

    # Backend Python modules
    cp "${INSTALL_DIR}/plugin/api/__init__.py"   "${dest}/__init__.py"
    cp "${INSTALL_DIR}/plugin/api/plugin_api.py" "${dest}/plugin_api.py"
    cp "${INSTALL_DIR}/plugin/api/graph_data.py" "${dest}/graph_data.py"

    # Built panel (only in staging — dev relies on Vite at localhost:5173)
    if [ "$MODE" = "staging" ]; then
        mkdir -p "${dest}/panel"
        cp -r "${INSTALL_DIR}/theia-panel/dist-embed/." "${dest}/panel/"
    fi

    ok "Plugin deployed: ${PLUGIN_TARGET}  ($(find "$PLUGIN_TARGET" -type f | wc -l) files)"
}

# ---------------------------------------------------------------------------
# 6. Generate the initial graph from the user's real state.db
# ---------------------------------------------------------------------------
generate_initial_graph() {
    if $NO_GRAPH; then
        info "Skipping initial graph generation (--no-graph)"
        return
    fi
    if [ ! -f "$STATE_DB" ]; then
        warn "No Hermes database at ${STATE_DB} — skipping initial graph."
        warn "After your first Hermes session, run:"
        warn "  ${VENV_DIR}/bin/theia-core   # one-shot"
        warn "  ${VENV_DIR}/bin/theia-core --watch  # live regeneration"
        return
    fi
    info "Generating initial graph from ${STATE_DB}..."
    if "${VENV_DIR}/bin/theia-core" --db-path "$STATE_DB" -o "$GRAPH_OUT"; then
        ok "Wrote ${GRAPH_OUT}"
    else
        warn "Graph generation failed — the plugin will 404 until the watcher catches up."
    fi
}

# ---------------------------------------------------------------------------
# 7. Optional watcher service (Linux + systemd only)
# ---------------------------------------------------------------------------
install_service() {
    if $NO_SERVICE; then
        info "Skipping watcher service (--no-service)"
        return
    fi
    if [ "$OS_KIND" != "linux" ]; then
        info "Watcher service is Linux/systemd-only — skipping on ${OS_KIND}."
        info "On macOS, run manually: ${VENV_DIR}/bin/theia-core --watch"
        return
    fi
    if ! command -v systemctl >/dev/null 2>&1; then
        info "systemctl not found — skipping watcher service."
        info "Run manually: ${VENV_DIR}/bin/theia-core --watch"
        return
    fi
    if [ ! -t 0 ]; then
        info "Non-interactive shell — skipping watcher prompt."
        info "Re-run interactively, or start manually: ${VENV_DIR}/bin/theia-core --watch"
        return
    fi

    echo
    echo "  The watcher regenerates ${GRAPH_OUT} whenever ${STATE_DB} changes."
    echo "  How would you like to run it?"
    echo
    PS3="  Select (1-4): "
    select opt in \
        "systemd --user (recommended)" \
        "systemd system (sudo required)" \
        "Plain shell script (run manually)" \
        "Skip"
    do
        case "$opt" in
            "systemd --user (recommended)") install_systemd_user; break ;;
            "systemd system (sudo required)") install_systemd_system; break ;;
            "Plain shell script (run manually)") install_shell_script; break ;;
            "Skip"|"") info "Skipping watcher install"; break ;;
            *) warn "Pick 1-4" ;;
        esac
    done
}

install_systemd_user() {
    local unit="${HOME}/.config/systemd/user/theia-watch.service"
    mkdir -p "$(dirname "$unit")"
    cat > "$unit" <<EOF
[Unit]
Description=Theia Constellation — Hermes session graph watcher
Documentation=${REPO_URL}
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
Environment=PATH=${VENV_DIR}/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${VENV_DIR}/bin/theia-core --watch --db-path ${STATE_DB} -o ${GRAPH_OUT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload 2>/dev/null \
        || warn "systemctl --user daemon-reload failed (no user systemd session?)"
    ok "Wrote ${unit}"
    info "Enable + start with:"
    info "  systemctl --user enable --now theia-watch.service"
}

install_systemd_system() {
    local unit_user="${USER:-$(whoami)}"
    local tmpfile
    tmpfile=$(mktemp)
    cat > "$tmpfile" <<EOF
[Unit]
Description=Theia Constellation — Hermes session graph watcher
Documentation=${REPO_URL}
After=network.target

[Service]
Type=simple
User=${unit_user}
WorkingDirectory=${INSTALL_DIR}
Environment=PATH=${VENV_DIR}/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${VENV_DIR}/bin/theia-core --watch --db-path ${STATE_DB} -o ${GRAPH_OUT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    info "Installing /etc/systemd/system/theia-watch.service (sudo)..."
    sudo install -m 0644 -o root -g root "$tmpfile" /etc/systemd/system/theia-watch.service
    rm -f "$tmpfile"
    sudo systemctl daemon-reload
    ok "Installed /etc/systemd/system/theia-watch.service"
    info "Enable + start with:"
    info "  sudo systemctl enable --now theia-watch.service"
}

install_shell_script() {
    local script="${HERMES_HOME}/start-theia-watch.sh"
    cat > "$script" <<EOF
#!/usr/bin/env bash
# Theia watch loop — regenerates ${GRAPH_OUT}
set -euo pipefail
exec "${VENV_DIR}/bin/theia-core" --watch --db-path "${STATE_DB}" -o "${GRAPH_OUT}"
EOF
    chmod +x "$script"
    ok "Wrote ${script}"
    info "Run with:  ${script}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo
echo "  +------------------------------------------+"
echo "  |  Theia Constellation Installer           |"
echo "  |  Mode: ${MODE}$(printf '%*s' $(( 34 - ${#MODE} )) ' ')|"
echo "  +------------------------------------------+"
echo

check_prereqs
clone_repo
setup_venv
build_panel
deploy_plugin
generate_initial_graph
install_service

echo
ok "Installation complete."
echo
echo "  Next steps:"
if [ "$MODE" = "dev" ]; then
    echo "    1. Start the panel dev server:"
    echo "         cd ${INSTALL_DIR}/theia-panel && npm run dev"
    echo "    2. Start the dashboard in dev mode:"
    echo "         THEIA_ENV=development hermes dashboard"
else
    echo "    1. Start the dashboard:"
    echo "         hermes dashboard"
    echo "    2. Open the 'Constellation' tab"
    if [ ! -f "$STATE_DB" ]; then
        echo "    3. Run a Hermes session, then regenerate:"
        echo "         ${VENV_DIR}/bin/theia-core"
    fi
fi
echo
