#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# theia — One-command installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/arm64be/theia/main/install.sh | bash
#   bash install.sh                          (from a local clone)
#   bash install.sh --help                   (show this help)
#   bash install.sh --no-service             (skip service prompt)
#   bash install.sh --no-update              (don't git pull if already installed)
#
# What it does:
#   1. Checks prerequisites (Python >= 3.11, Node.js, npm, git, make)
#   2. Clones the repo into ~/.hermes/hermes-theia/ (git pull to update if exists)
#   3. Creates a Python virtual environment and installs dependencies
#   4. Installs Node dependencies
#   5. Builds the panel embed and assembles the plugin
#   6. Symlinks the plugin into ~/.hermes/plugins/theia-constellation
#   7. Optionally installs a watch service (systemd or shell script)
# ---------------------------------------------------------------------------
set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
REPO_URL="https://github.com/arm64be/theia"
INSTALL_DIR="${HOME}/.hermes/hermes-theia"
VENV_DIR="${INSTALL_DIR}/.venv"
HERMES_PLUGINS_DIR="${HOME}/.hermes/plugins"
PLUGIN_NAME="theia-constellation"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
HELP=false
NO_UPDATE=false
SKIP_SERVICE=false

for arg in "$@"; do
    case "$arg" in
        --help|-h) HELP=true ;;
        --no-update) NO_UPDATE=true ;;
        --no-service) SKIP_SERVICE=true ;;
    esac
done

usage() {
    cat << 'EOF'
Usage: bash install.sh [options]

Options:
  --help, -h       Show this help message
  --no-service     Skip the watch service prompt
  --no-update      Don't git pull if already installed
EOF
}

$HELP && { usage; exit 0; }

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${B}[INFO]${NC}  $1"; }
ok()    { echo -e "${G}[ OK ]${NC}  $1"; }
warn()  { echo -e "${Y}[WARN]${NC}  $1"; }
err()   { echo -e "${R}[ERR]${NC}  $1"; }

# ---------------------------------------------------------------------------
# Step 1 - Prerequisites
# ---------------------------------------------------------------------------
check_prereqs() {
    info "Checking prerequisites..."
    local fail=0

    for cmd in python3 node npm git make; do
        command -v "$cmd" &>/dev/null || { err "'${cmd}' is required but not found"; fail=1; }
    done
    [ "$fail" -eq 1 ] && exit 1

    if python3 -c "import sys; exit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null; then
        local pyver; pyver=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
        ok "Python ${pyver}"
    else
        local pyver; pyver=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
        err "Python 3.11+ required (found ${pyver})"; fail=1; exit 1
    fi

    ok "Node.js $(node --version)"
    ok "npm $(npm --version)"
    ok "$(git --version 2>/dev/null || git version)"
    ok "$(make --version 2>/dev/null | head -1)"
}

# ---------------------------------------------------------------------------
# Step 2 - Clone / update repository
# ---------------------------------------------------------------------------
clone_repo() {
    if [ -d "$INSTALL_DIR" ]; then
        if $NO_UPDATE; then
            info "Repository exists at ${INSTALL_DIR}, skipping update (--no-update)"
            return
        fi
        info "Updating existing repository at ${INSTALL_DIR}..."
        (cd "$INSTALL_DIR" && git pull --ff-only) || warn "Could not git pull (local changes or network issue?)"
        return
    fi

    mkdir -p "$(dirname "$INSTALL_DIR")"

    local self
    self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "${self}/Makefile" ] && [ -f "${self}/plugin/manifest.json" ]; then
        info "Copying repository from ${self} to ${INSTALL_DIR}..."
        cp -r "$self" "$INSTALL_DIR"
        ok "Repository copied"
        return
    fi

    info "Cloning into ${INSTALL_DIR}..."
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    ok "Repository cloned"
}

# ---------------------------------------------------------------------------
# Step 3 - Python virtual environment + theia-core
# ---------------------------------------------------------------------------
setup_venv() {
    info "Creating Python virtual environment at ${VENV_DIR}..."
    python3 -m venv "$VENV_DIR"
    local pip="${VENV_DIR}/bin/pip"

    info "Installing theia-core (Python dependencies)..."
    (cd "${INSTALL_DIR}/theia-core" && "$pip" install -e ".[dev]") || {
        err "theia-core install failed"; exit 1
    }
    ok "theia-core installed"
}

# ---------------------------------------------------------------------------
# Step 4 - Node dependencies
# ---------------------------------------------------------------------------
install_panel_deps() {
    info "Installing theia-panel (this may take a minute)..."
    (cd "${INSTALL_DIR}/theia-panel" && npm ci) || {
        err "npm install failed"; exit 1
    }
    ok "theia-panel dependencies installed"
}

# ---------------------------------------------------------------------------
# Step 5 - Build
# ---------------------------------------------------------------------------
build_project() {
    info "Building project..."
    (cd "$INSTALL_DIR" && make build) || {
        err "Build failed"; exit 1
    }
    ok "Build complete"
}

# ---------------------------------------------------------------------------
# Step 6 - Symlink plugin into Hermes
# ---------------------------------------------------------------------------
symlink_plugin() {
    info "Setting up Hermes plugin symlink..."
    mkdir -p "$HERMES_PLUGINS_DIR"
    local target="${HERMES_PLUGINS_DIR}/${PLUGIN_NAME}"
    [ -e "$target" ] && rm -rf "$target"
    ln -sfn "${INSTALL_DIR}/dist/plugin" "$target"
    ok "Plugin linked: ${target} -> ${INSTALL_DIR}/dist/plugin"
}

# ---------------------------------------------------------------------------
# Step 7 - Optional watch service
# ---------------------------------------------------------------------------
install_service() {
    [ "$SKIP_SERVICE" = true ] && { info "Skipping service installation (--no-service)"; return; }

    if [ ! -t 0 ]; then
        info "Non-interactive shell - skipping service prompt"
        info "Run interactively to configure a watch service, or pass --no-service to silence"
        return
    fi

    echo ""
    echo "  Theia can watch your Hermes database and regenerate the"
    echo "  constellation graph whenever sessions change."
    echo ""
    echo "  How would you like to run the watcher?"
    echo ""
    PS3="  Select an option (1-4): "
    options=(
        "systemd --user service (recommended)"
        "systemd system service (requires sudo)"
        "Simple shell script (run manually)"
        "Skip"
    )
    select opt in "${options[@]}"; do
        if [ -z "$opt" ]; then
            warn "Invalid option, please select 1-4"
            continue
        fi
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
    local service_file="${HOME}/.config/systemd/user/theia-watch.service"
    mkdir -p "$(dirname "$service_file")"

    cat > "$service_file" << EOF
[Unit]
Description=Theia Constellation - Hermes session graph watcher
Documentation=https://github.com/arm64be/theia
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${VENV_DIR}/bin/python -m theia_core --watch
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload 2>/dev/null \
        || warn "systemctl daemon-reload failed (no systemd user session?)"
    ok "systemd --user service installed: ${service_file}"
    info "Enable with:  systemctl --user enable theia-watch.service"
    info "Start with:   systemctl --user start theia-watch.service"
}

install_systemd_system_service() {
    local user="${USER:-$(whoami)}"
    local tmpfile; tmpfile=$(mktemp)

    cat > "$tmpfile" << EOF
[Unit]
Description=Theia Constellation - Hermes session graph watcher
Documentation=https://github.com/arm64be/theia
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${VENV_DIR}/bin/python -m theia_core --watch
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    info "Installing system service (requires sudo)..."
    sudo mv "$tmpfile" /etc/systemd/system/theia-watch.service \
        || { err "sudo mv failed"; exit 1; }
    sudo systemctl daemon-reload 2>/dev/null \
        || warn "systemctl daemon-reload failed"
    ok "systemd system service installed: /etc/systemd/system/theia-watch.service"
    info "Enable with:  sudo systemctl enable theia-watch.service"
    info "Start with:   sudo systemctl start theia-watch.service"
}

install_shell_script() {
    local script="${HOME}/.hermes/start-theia.sh"
    cat > "$script" << EOF
#!/usr/bin/env bash
set -euo pipefail

cd "${INSTALL_DIR}"
echo "Starting Theia Constellation watcher..."
echo "Watching Hermes database for changes (Ctrl+C to stop)"
echo ""
exec ${VENV_DIR}/bin/python -m theia_core --watch
EOF
    chmod +x "$script"
    ok "Shell script created: ${script}"
    info "Run it with:  ${script}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    echo ""
    echo "  +-------------------------------------------+"
    echo "  |     Theia Constellation Installer         |"
    echo "  |  Visualize Hermes agent sessions as a     |"
    echo "  |  semantic constellation.                  |"
    echo "  +-------------------------------------------+"
    echo ""

    check_prereqs
    clone_repo
    setup_venv
    install_panel_deps
    build_project
    symlink_plugin
    install_service
}

if ! (main "$@"); then
    err ""
    err "Installation did not complete."
    err "To retry from scratch:  rm -rf ${INSTALL_DIR} && bash install.sh"
    exit 1
fi

echo ""
ok "Installation complete!"
echo ""
echo "  Next steps:"
echo "    1. Make sure Hermes is running and has session data"
echo "    2. If you didn't install a watcher service, run:"
echo "       cd ${INSTALL_DIR} && ${VENV_DIR}/bin/python -m theia_core --watch"
echo "    3. Open the Hermes dashboard and click the 'Constellation' tab"
echo ""
