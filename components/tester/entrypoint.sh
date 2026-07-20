#!/usr/bin/env bash
# entrypoint.sh — supervised tester_rewrite container entry point (PID 1).
#
# Starts:
#   1. dbus session bus
#   2. Xvfb (DISPLAY=:99 by default)
#   3. xsetroot default cursor
#   4. openbox window manager
#   5. profile.d env + at-spi-bus-launcher
#   6. x11vnc (view-only default; interactive in TESTER_DEBUG)
#   7. (no standalone controller process — it is a stdio MCP server
#      launched on demand by kilo acp via the ACP `session/new
#      mcpServers` payload; see workflow.ts runTest())
#
# Then spawns the Node.js workflow in the foreground. `node` decides
# its own behavior based on `TESTER_DEBUG`:
#   * DEBUG=true : applies DEBUG_* env config, runs the production setup
#                  stage (clone + kilo.json + .openvelo/setup.sh), then
#                  parks on a keepalive HTTP server until SIGTERM. The
#                  container stays alive for `docker exec -it <c> bash`.
#   * DEBUG=false: waits for an orchestrator WS handshake, then runs the
#                  full 3-stage workflow (Setup -> Test -> Verdict).
set -uo pipefail

export DISPLAY="${DISPLAY:-:99}"
export SCREEN_W="${SCREEN_W:-1280}"
export SCREEN_H="${SCREEN_H:-1024}"
export SCREEN_DEPTH="${SCREEN_DEPTH:-24}"
export PORT_VNC="${PORT_VNC:-5900}"
export CONTROLLER_PORT="${CONTROLLER_PORT:-8080}"
export TESTER_PORT="${TESTER_PORT:-8081}"
# Controller MCP server — started BEFORE the workflow (when
# MCP_TRANSPORT != stdio) so debug mode can drive it directly with
# curl / wscat / MCP Inspector. kilo acp attaches to the same server
# via the remote HTTP/SSE shape of `session/new mcpServers`. Set
# MCP_TRANSPORT=stdio to fall back to the legacy per-session stdio
# spawning instead.
#
# MCP_HOST defaults to 0.0.0.0 so the MCP server is reachable from
# outside the container via Docker port mapping (debug-mode MCP
# Inspector on the host, custom curl scripts, etc.). Set MCP_HOST=
# 127.0.0.1 to restrict reachability to the container itself.
export MCP_HOST="${MCP_HOST:-${MCP_BIND:-0.0.0.0}}"
export MCP_PORT="${MCP_PORT:-8765}"
export CI=true
export PATH="/usr/libexec:${PATH}"

DEBUG_MODE="false"
if [ "${TESTER_DEBUG:-false}" = "true" ]; then
    DEBUG_MODE="true"
fi

pids=()

cleanup() {
    echo "[init] Received termination signal or main process exited. Cleaning up..."
    for pid in "${pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done
    sleep 1.5
    for pid in "${pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
    done
    exit 0
}
trap cleanup SIGTERM SIGINT EXIT

# 1. dbus session bus
echo "[init] Launching DBus session bus..."
eval $(dbus-launch --sh-syntax)
export DBUS_SESSION_BUS_ADDRESS
export DBUS_SESSION_BUS_PID
pids+=("$DBUS_SESSION_BUS_PID")

# 2. Xvfb
echo "[init] Starting Xvfb on $DISPLAY ($SCREEN_W x $SCREEN_H x $SCREEN_DEPTH)..."
Xvfb "$DISPLAY" -screen 0 "${SCREEN_W}x${SCREEN_H}x${SCREEN_DEPTH}" -nolisten tcp -ac &
XVFB_PID=$!
pids+=("$XVFB_PID")

X_SOCK_NUM=$(echo "$DISPLAY" | cut -d: -f2 | cut -d. -f1)
timeout=100
while [ ! -e "/tmp/.X11-unix/X${X_SOCK_NUM}" ]; do
    sleep 0.1
    timeout=$((timeout-1))
    if [ $timeout -le 0 ]; then
        echo "[init] Error: Xvfb socket did not appear in time."
        exit 1
    fi
done
echo "[init] Xvfb ready."

echo "[init] Initializing native root cursor..."
xsetroot -cursor_name left_ptr

# 3. openbox
echo "[init] Configuring Openbox to auto-maximize windows..."
mkdir -p /root/.config/openbox
if [ -f /etc/xdg/openbox/rc.xml ]; then
    cp /etc/xdg/openbox/rc.xml /root/.config/openbox/rc.xml
else
    cat <<EOF > /root/.config/openbox/rc.xml
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc" xmlns:xi="http://www.w3.org/2001/XInclude">
  <applications>
  </applications>
</openbox_config>
EOF
fi
sed -i 's|<applications>|<applications>\n  <application type="dialog">\n    <maximized>no</maximized>\n  </application>\n  <application class="*">\n    <maximized>yes</maximized>\n  </application>|' /root/.config/openbox/rc.xml

echo "[init] Starting Openbox window manager..."
openbox &
OPENBOX_PID=$!
pids+=("$OPENBOX_PID")

# 4. profile.d so apps run via run.sh inherit DBUS / DISPLAY / AT-SPI
#
# XDG_CURRENT_DESKTOP + GTK_USE_PORTAL steer toolkits (Avalonia, GTK) to the
# xdg-desktop-portal file/folder chooser (started below). That portal dialog
# is a real, AT-SPI-accessible GtkFileChooser, so elements() sees its
# controls. Without these, Avalonia uses an in-process "managed" picker that
# is NOT in the accessibility tree and the controller is blind to it.
mkdir -p /etc/profile.d
cat <<EOF > /etc/profile.d/openvelo-tester.sh
export DISPLAY="$DISPLAY"
export DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS"
export AT_SPI_BUS="unix:path=/run/user/0/at-spi/bus"
export AT_SPI_BUS_ADDRESS="unix:path=/run/user/0/at-spi/bus"
export XDG_RUNTIME_DIR="/run/user/0"
export CONTROLLER_PORT="$CONTROLLER_PORT"
export XDG_CURRENT_DESKTOP="GNOME"
export GTK_USE_PORTAL="1"
EOF
chmod 644 /etc/profile.d/openvelo-tester.sh

# Make the portal env effective for this entrypoint process too (so any
# apps it launches directly inherit it).
export XDG_CURRENT_DESKTOP="GNOME"
export GTK_USE_PORTAL="1"

export XDG_RUNTIME_DIR="/run/user/0"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# 5. at-spi-bus-launcher
echo "[init] Starting AT-SPI bus launcher..."
at-spi-bus-launcher --launch-immediately &
ATSPI_PID=$!
pids+=("$ATSPI_PID")

# 5b. xdg-desktop-portal + GTK backend. Provides the accessible GtkFileChooser
# used by Avalonia/GTK file & folder dialogs (see the profile.d note above).
# Best-effort: if the binaries are missing the shell just logs and continues,
# so the container still comes up (dialogs would then fall back to the
# in-process picker, which elements() flags as atspi_accessible=false).
if [ -x /usr/libexec/xdg-desktop-portal ]; then
    echo "[init] Starting xdg-desktop-portal (file-chooser portal)..."
    /usr/libexec/xdg-desktop-portal &
    pids+=("$!")
    if [ -x /usr/libexec/xdg-desktop-portal-gtk ]; then
        /usr/libexec/xdg-desktop-portal-gtk &
        pids+=("$!")
    fi
else
    echo "[init] xdg-desktop-portal not found; file dialogs may be inaccessible." >&2
fi

# 6. x11vnc (view-only default; interactive when TESTER_DEBUG=true)
VNC_VIEW_ONLY="true"
if [ "$DEBUG_MODE" = "true" ]; then
    VNC_VIEW_ONLY="false"
fi
echo "[init] Starting x11vnc on port $PORT_VNC (view-only: $VNC_VIEW_ONLY)..."
VNC_ARGS=("-display" "$DISPLAY" "-rfbport" "$PORT_VNC" "-nopw" "-forever" "-shared" "-cursor" "most" "-nocursorshape" "-noxdamage")
if [ "$VNC_VIEW_ONLY" = "true" ]; then
    VNC_ARGS+=("-viewonly")
fi
x11vnc "${VNC_ARGS[@]}" &
VNC_PID=$!
pids+=("$VNC_PID")

# 7. Controller MCP server — started BEFORE the workflow so it's
#    reachable on http://${MCP_HOST}:${MCP_PORT} (or unix stdio if
#    MCP_TRANSPORT=stdio). kilo acp attaches to it via the remote
#    HTTP/SSE shape of `session/new mcpServers`; debug mode can drive
#    it directly with curl / wscat / MCP Inspector.
mkdir -p /work/scratch/logs /work/tmp /tmp/tester-shots
if [ "$MCP_TRANSPORT" = "stdio" ]; then
    echo "[init] Controller MCP transport=stdio — spawned per session by kilo acp."
else
    echo "[init] Starting controller MCP server (${MCP_TRANSPORT}) on ${MCP_HOST}:${MCP_PORT}..."
    MCP_TRANSPORT="$MCP_TRANSPORT" \
    MCP_HOST="$MCP_HOST" \
    MCP_PORT="$MCP_PORT" \
    python3 /app/mcp/mcp.py &
    MCP_PID=$!
    pids+=("$MCP_PID")

    # Wait for the HTTP/SSE transport to start accepting connections.
    # FastMCP's streamable-http transport (and SSE) only respond to a
    # request with the proper Accept header — a bare GET returns 406.
    # We probe with a minimal JSON-RPC `initialize` POST that matches
    # what a real MCP client would send. For SSE the GET /sse request
    # keeps a streaming connection open, so we use `--max-time 2` to
    # cut it short and treat any response as "up".
    mcp_timeout=100
    if [ "$MCP_TRANSPORT" = "sse" ]; then
        MCP_URL="http://${MCP_HOST}:${MCP_PORT}/sse"
        while ! curl -sf -o /dev/null --max-time 2 "$MCP_URL"; do
            sleep 0.2
            mcp_timeout=$((mcp_timeout-1))
            if [ $mcp_timeout -le 0 ]; then
                echo "[init] Error: controller MCP server failed to come up on $MCP_URL."
                exit 1
            fi
        done
    else
        MCP_URL="http://${MCP_HOST}:${MCP_PORT}/mcp"
        INIT_BODY='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"openvelo-init-probe","version":"0"}}}'
        while ! curl -sf -o /dev/null --max-time 2 -X POST "$MCP_URL" \
                -H 'Content-Type: application/json' \
                -H 'Accept: application/json, text/event-stream' \
                --data "$INIT_BODY"; do
            sleep 0.2
            mcp_timeout=$((mcp_timeout-1))
            if [ $mcp_timeout -le 0 ]; then
                echo "[init] Error: controller MCP server failed to come up on $MCP_URL."
                exit 1
            fi
        done
    fi
    echo "[init] Controller MCP server ready at $MCP_URL."
fi

# 8. Spawn the Node.js workflow runner in the FOREGROUND. node decides
#    what to do based on TESTER_DEBUG: run setup + park (debug), or run
#    the full 3-stage workflow (server). In both cases the entrypoint
#    waits on the node process — when node exits, the cleanup trap
#    kills the services.
echo "[init] Launching Node.js workflow (TESTER_DEBUG=$DEBUG_MODE)..."
node /app/dist/index.js
NODE_EXIT=$?

echo "[init] Node.js workflow exited with code $NODE_EXIT. Cleaning up services..."
cleanup
exit $NODE_EXIT