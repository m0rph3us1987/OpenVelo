#!/usr/bin/env bash
# mcp/stop.sh — non-blocking process stopper for the tester_rewrite container.
#
# Raw `pkill` / `kill` on a GUI app under Xvfb can hang the calling tool
# for many seconds while the X client tears down its display connection,
# flushes AT-SPI, etc. That makes the agent stall on what looks like a
# trivial "close the app" step. stop.sh signals the target(s) and returns
# immediately: SIGTERM is sent now, and the SIGKILL escalation runs in a
# fully detached (setsid) background subshell so the caller never waits on
# teardown or on the grace period.
#
# Usage:
#   stop.sh <pattern|pid> [pattern|pid ...]
#
#   - Numeric arguments are treated as PIDs.
#   - Non-numeric arguments are treated as pgrep -f patterns (matched
#     against the full command line), e.g.  stop.sh SweetVault.Desktop
#
# Always exits 0 quickly; it is best-effort by design.
set -u

if [ "$#" -eq 0 ]; then
    echo "usage: stop.sh <pattern|pid> [pattern|pid ...]" >&2
    exit 2
fi

# Grace period (seconds) between SIGTERM and the forced SIGKILL.
GRACE="${OPENVELO_STOP_GRACE:-3}"

SELF_PID=$$
PARENT_PID="${PPID:-0}"

# Read a pid's full command line (NUL-separated in /proc) as a space-joined
# string. Empty if the pid is gone or unreadable.
cmdline_of() {
    local p="$1"
    [ -r "/proc/$p/cmdline" ] || { echo ""; return; }
    tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null
}

# A pgrep -f <pattern> match is a *false* self-match if the matched pid is
# stop.sh itself, the calling shell, or a transient pgrep launched from
# here — all of which carry the pattern text in their own command line.
# Detect those by inspecting the matched pid's command line rather than by
# racing pid/pgid snapshots (the pgrep subshell pid isn't known in advance).
is_self_match() {
    local p="$1"
    [ "$p" = "$SELF_PID" ] && return 0
    [ "$p" = "$PARENT_PID" ] && return 0
    local cl
    cl="$(cmdline_of "$p")"
    case "$cl" in
        *stop.sh*|*"pgrep -f"*) return 0 ;;
    esac
    return 1
}

# Collect target PIDs from all args (numeric = PID, else pgrep -f pattern),
# dropping false self-matches as we go.
pids=""
for arg in "$@"; do
    if [[ "$arg" =~ ^[0-9]+$ ]]; then
        pids="$pids $arg"
    else
        # pgrep -f matches against the full command line. Re-validate each
        # match by re-reading its live cmdline: this drops (a) false
        # self-matches (stop.sh / pgrep carrying the pattern text) and
        # (b) transient pgrep/subshell pids that have already exited by
        # the time we look — their /proc cmdline is empty, so they no
        # longer "match" and are skipped.
        for m in $(pgrep -f -- "$arg" 2>/dev/null || true); do
            is_self_match "$m" && continue
            cl="$(cmdline_of "$m")"
            case "$cl" in
                *"$arg"*) pids="$pids $m" ;;   # still alive and still matches
                *) : ;;                         # gone or no longer matching
            esac
        done
    fi
done

# Deduplicate.
pids="$(
    echo "$pids" \
        | tr ' ' '\n' \
        | grep -E '^[0-9]+$' \
        | sort -u \
        || true
)"

if [ -z "$pids" ]; then
    echo "stop: no matching processes"
    exit 0
fi

# Phase 1: polite SIGTERM to every target, right now (non-blocking).
for pid in $pids; do
    kill -TERM "$pid" 2>/dev/null || true
done
echo "stop: sent SIGTERM to:$(echo "$pids" | tr '\n' ' ')"

# Phase 2: escalate to SIGKILL after a grace period. Run it fully detached
# with setsid + all std streams redirected away from the caller's pipe, so
# this call returns immediately instead of waiting out the grace window
# (mirrors run.sh's detachment).
setsid bash -c '
    sleep "$1"
    shift
    for pid in "$@"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
    done
' _ "$GRACE" $pids </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true

exit 0
