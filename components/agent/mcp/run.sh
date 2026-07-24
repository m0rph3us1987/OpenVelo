#!/usr/bin/env bash
# mcp/run.sh — non-blocking GUI launcher for the tester_rewrite container.
#
# GUI apps started for testing are long-lived: if the agent launches one
# directly, the launching tool call blocks for the app's entire lifetime
# and the agent stalls, believing "startup is slow" when the app is in
# fact already up. run.sh detaches the app into its own session with all
# std streams redirected to a log file, so the launching tool call
# returns immediately (do NOT append `&` — detachment is handled here).
#
# Sources the entrypoint-written profile so DBUS / AT-SPI bus propagate
# to the app (required for the accessibility-driven controller).
#
# Usage:
#   run.sh <command> [args...]
# Prints the launched pid and log path, then exits 0 immediately.
set -u

if [ "$#" -eq 0 ]; then
    echo "usage: run.sh <command> [args...]" >&2
    exit 2
fi

if [ -f /etc/profile.d/openvelo-tester.sh ]; then
    # shellcheck disable=SC1091
    . /etc/profile.d/openvelo-tester.sh
fi

LOG_DIR="${OPENVELO_LOG_DIR:-/work/scratch/logs}"
mkdir -p "$LOG_DIR" 2>/dev/null || true
APP_BASE="$(basename "$1")"
LOG_FILE="$LOG_DIR/${APP_BASE}.log"

if [[ "$APP_BASE" == "chromium" || "$APP_BASE" == "google-chrome" || "$APP_BASE" == "chrome" ]]; then
    set -- "$1" "--test-type" "--disable-infobars" "--disable-session-crashed-bubble" "${@:2}"
fi

# setsid detaches the app into its own session (new process group) so the
# caller's controlling terminal / pipe is not held open by the child.
# Redirect stdin from /dev/null and both std streams to the log so the
# launching tool call sees EOF immediately and returns.
setsid env -u LINES -u COLUMNS "$@" </dev/null >"$LOG_FILE" 2>&1 &
APP_PID=$!
disown "$APP_PID" 2>/dev/null || true

echo "launched: $* (pid=$APP_PID, log=$LOG_FILE)"
exit 0
