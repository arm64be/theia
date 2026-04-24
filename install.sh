#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# theia — One-command installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/arm64be/theia/main/install.sh | bash
#   bash install.sh                          (from a local clone)
#
# What it does:
#   1. Checks prerequisites (Python ≥3.11, Node.js, npm, git, make)
#   2. Clones the repo into ~/.hermes/hermes-theia/ (only if missing)
#   3. Installs Python & Node dependencies
#   4. Builds the panel embed and assembles the plugin
#   5. Symlinks the plugin into ~/.hermes/plugins/theia-constellation
#   6. Optionally installs a watch service (systemd or shell script)
# ---------------------------------------------------------------------------
set -euo pipefail

SKIP_SERVICE=false
for arg in "$@"; do [ "$arg" = "--no-service" ] && SKIP_SERVICE=true; done

REPO_URL="https://github.com/arm64be/theia"
INSTALL_DIR="${HOME}/.hermes/hermes-theia"
HERMES_PLUGINS_DIR="${HOME}/.hermes/plugins"
PLUGIN_NAME="theia-constellation"

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${B}[INFO]${NC}  $1"; }
ok()    { echo -e "${G}[ OK ]${NC}  $1"; }
warn()  { echo -e "${Y}[WARN]${NC}  $1"; }
err()   { echo -e "${R}[ERR]${NC}  $1"; }

# ---------------------------------------------------------------------------
# Step 1 — Prerequisites
# ---------------------------------------------------------------------------
check_prereqs() {
    info "Checking prerequisites..."
    local fail=0

    for cmd in python3 node npm git make; do
        command -v "$cmd" &>/dev/null || { err "'$cmd' is required but not found"; fail=1; }
    done

    if command -v python3 &>/dev/null; then
        local pyver
        pyver=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
        if python3 -c "import sys; exit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null; then
            ok "Python ${pyver}"
        else
            err "Python 3.11+ required (found ${pyver})"; fail=1
        fi
    fi

    if command -v node &>/dev/null; then
        ok "Node.js $(node --version)"
    fi
    if command -v npm &>/dev/null; then
        ok "npm $(npm --version)"
    fi

    [ "$fail" -eq 1 ] && exit 1
}

# ---------------------------------------------------------------------------
# Step 2 — Clone / copy repository
# ---------------------------------------------------------------------------
clone_repo() {
    if [ -d "$INSTALL_DIR" ]; then
        info "Repository already exists at ${INSTALL_DIR}"
        return
    fi

    mkdir -p "$(dirname "$INSTALL_DIR")"

    # If we're already inside a theia checkout, copy instead of cloning
    local self
    self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "${self}/Makefile" ] && [ -f "${self}/plugin/manifest.json" ]; then
        info "Copying repository from ${self} → ${INSTALL_DIR}..."
        cp -r "$self" "$INSTALL_DIR"
        ok "Repository copied"
        return
    fi

    info "Cloning into ${INSTALL_DIR}..."
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    ok "Repository cloned"
}

# ---------------------------------------------------------------------------
# Step 3 — Install dependencies
# ---------------------------------------------------------------------------
install_deps() {
    info "Installing theia-core (Python dependencies)..."
    local core_dir="${INSTALL_DIR}/theia-core"
    if command -v uv &>/dev/null; then
        (cd "$core_dir" && uv pip install -e ".[dev]") || { err "Python install failed"; exit 1; }
    elif command -v pip &>/dev/null; then
        (cd "$core_dir" && pip install -e ".[dev]") || { err "Python install failed"; exit 1; }
    elif python3 -m pip --version &>/dev/null; then
        (cd "$core_dir" && python3 -m pip install -e ".[dev]") || { err "Python install failed"; exit 1; }
    else
        err "No Python package manager found (install pip or uv)"
        exit 1
    fi
    ok "theia-core installed"

    info "Installing theia-panel (Node dependencies)..."
    (cd "${INSTALL_DIR}/theia-panel" && npm ci) || { err "npm install failed"; exit 1; }
    ok "theia-panel dependencies installed"
}

# ---------------------------------------------------------------------------
# Step 4 — Build
# ---------------------------------------------------------------------------
build_project() {
    info "Building project..."
    (cd "$INSTALL_DIR" && make build) || { err "Build failed"; exit 1; }
    ok "Build complete"
}

# ---------------------------------------------------------------------------
# Step 5 — Symlink plugin into Hermes
# ---------------------------------------------------------------------------
symlink_plugin() {
    info "Setting up Hermes plugin symlink..."
    mkdir -p "$HERMES_PLUGINS_DIR"
    local target="${HERMES_PLUGINS_DIR}/${PLUGIN_NAME}"
    [ -e "$target" ] && rm -rf "$target"
    ln -sfn "${INSTALL_DIR}/dist/plugin" "$target"
    ok "Plugin linked: ${target} → ${INSTALL_DIR}/dist/plugin"
}

# ---------------------------------------------------------------------------
# Step 6 — Optional watch service
# ---------------------------------------------------------------------------
install_service() {
    $SKIP_SERVICE && { info "Skipping service installation (--no-service)"; return; }

    # If stdin is not a terminal (e.g. piped from curl), skip automatically
    if [ ! -t 0 ]; then
        info "Non-interactive shell — skipping service prompt"
        info "Pass --no-service to silence, or run again in an interactive terminal"
        return
    fi

    echo ""
    echo "  ┌──────────────────────────────────────────────────┐"
    echo "  │  Theia can watch your Hermes database and        │"
    echo "  │  regenerate the constellation graph whenever     │"
    echo "  │  sessions change.                               │"
    echo "  │                                                  │"
    echo "  │  Choose how to run the watcher:                  │"
    echo "  └──────────────────────────────────────────────────┘"
    echo ""
    PS3="  Select an option (1-4): "
    options=(
        "systemd --user service (recommended)"
        "systemd system service (requires sudo)"
        "Simple shell script (run manually)"
        "Skip"
    )
    select opt in "${options[@]}"; do
        case $opt in
            "systemd --user service (recommended)")
                install_systemd_user_service; break;;
            "systemd system service (requires sudo)")
                install_systemd_system_service; break;;
            "Simple shell script (run manually)")
                install_shell_script; break;;
            "Skip")
                info "Skipping service installation"; break;;
        esac
    done
}

install_systemd_user_service() {
    local service_dir="${HOME}/.config/systemd/user"
    local service_file="${service_dir}/theia-watch.service"
    mkdir -p "$service_dir"

    cat > "$service_file" << EOF
[Unit]
Description=Theia Constellation — Hermes session graph watcher
Documentation=https://github.com/arm64be/theia
After=network.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/start-watch.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

    write_watch_script

    systemctl --user daemon-reload 2>/dev/null || warn "Could not reload systemd (not running in systemd?)"
    ok "systemd --user service installed: ${service_file}"
    info "Enable with:  systemctl --user enable theia-watch.service"
    info "Start with:   systemctl --user start theia-watch.service"
}

install_systemd_system_service() {
    local service_file="/etc/systemd/system/theia-watch.service"

    cat > /tmp/theia-watch.service << EOF
[Unit]
Description=Theia Constellation — Hermes session graph watcher
Documentation=https://github.com/arm64be/theia
After=network.target

[Service]
Type=simple
User=${USER}
ExecStart=${INSTALL_DIR}/start-watch.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    write_watch_script

    info "Installing system service (requires sudo)..."
    sudo mv /tmp/theia-watch.service "$service_file" || { err "sudo failed"; exit 1; }
    sudo systemctl daemon-reload 2>/dev/null || warn "Could not reload systemd"
    ok "systemd system service installed: ${service_file}"
    info "Enable with:  sudo systemctl enable theia-watch.service"
    info "Start with:   sudo systemctl start theia-watch.service"
}

install_shell_script() {
    local script_file="${HOME}/.hermes/start-theia.sh"
    cat > "$script_file" << EOF
#!/usr/bin/env bash
set -euo pipefail

cd "${INSTALL_DIR}"
echo "Starting Theia Constellation watcher..."
echo "Watching Hermes database for changes (Ctrl+C to stop)"
echo ""
exec python3 -m theia_core --watch
EOF
    chmod +x "$script_file"
    ok "Shell script created: ${script_file}"
    info "Run it with:  ${script_file}"
}

write_watch_script() {
    local script="${INSTALL_DIR}/start-watch.sh"
    cat > "$script" << EOF
#!/usr/bin/env bash
set -euo pipefail
cd "${INSTALL_DIR}"
exec python3 -m theia_core --watch
EOF
    chmod +x "$script"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    echo ""
    echo "  ╔═══════════════════════════════════════════╗"
    echo "  ║     Theia Constellation Installer         ║"
    echo "  ║  Visualize Hermes agent sessions as a     ║"
    echo "  ║  semantic constellation.                  ║"
    echo "  ╚═══════════════════════════════════════════╝"
    echo ""

    check_prereqs
    clone_repo
    install_deps
    build_project
    symlink_plugin
    install_service

    echo ""
    ok "Installation complete!"
    echo ""
    echo "  Next steps:"
    echo "    1. Make sure Hermes is running and has session data"
    echo "    2. If you didn't install a watcher service, run:"
    echo "       cd ${INSTALL_DIR} && python -m theia_core --watch"
    echo "    3. Open the Hermes dashboard and click the 'Constellation' tab"
    echo ""
}

main
