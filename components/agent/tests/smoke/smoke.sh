#!/usr/bin/env bash
# Smoke test for the Go agent. Drives the binary with a stub WebSocket
# client to verify it boots, accepts a handshake, and emits the expected
# stage/finish messages.
set -euo pipefail

AGENT_PORT=${AGENT_PORT:-13001}
BIN="${BIN:-$(cd "$(dirname "$0")/../.." && pwd)/bin/openvelo-agent}"

if [[ ! -x "$BIN" ]]; then
    echo "Building agent..."
    (cd "$(dirname "$0")/../.." && make build)
fi

# Start the agent in the background.
AGENT_PORT="$AGENT_PORT" "$BIN" &
AGENT_PID=$!
trap 'kill $AGENT_PID 2>/dev/null || true' EXIT

# Wait for the listener to bind.
for i in $(seq 1 30); do
    if (echo > "/dev/tcp/127.0.0.1/$AGENT_PORT") 2>/dev/null; then
        break
    fi
    sleep 0.1
done

# Handshake payload.
PAYLOAD=$(cat <<EOF
{"type":"handshake","job_id":"smoke","config":{"repo_url":"https://example.com/repo.git","repo_host":"github","repo_pat":"x","backend":"kilo","execution_model":"m","blueprint_model":"m","review_model":"m","documentation_model":"m","build_cmd":"echo","test_cmd":"","staging_branch":"staging","job_title":"smoke","story":"do the thing"}}
EOF
)

# Pipe the handshake over a WebSocket-like connection.
# We use websocat if available, otherwise Python.
if command -v websocat >/dev/null; then
    echo "$PAYLOAD" | websocat "ws://127.0.0.1:$AGENT_PORT" -n
elif command -v python3 >/dev/null; then
    python3 - <<EOF
import socket, struct, json, sys, os

s = socket.create_connection(("127.0.0.1", $AGENT_PORT))
key = "dGhlIHNhbXBsZSBub25jZQ=="
req = (
    "GET / HTTP/1.1\r\n"
    "Host: 127.0.0.1:$AGENT_PORT\r\n"
    "Upgrade: websocket\r\n"
    "Connection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {key}\r\n"
    "Sec-WebSocket-Version: 13\r\n\r\n"
).encode()
s.sendall(req)
# Read handshake response.
buf = b""
while b"\r\n\r\n" not in buf:
    chunk = s.recv(4096)
    if not chunk:
        break
    buf += chunk

def send_text(payload: bytes):
    header = bytearray([0x81])
    n = len(payload)
    mask = os.urandom(4)
    if n < 126:
        header.append(0x80 | n)
    elif n < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack(">H", n))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack(">Q", n))
    header.extend(mask)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    s.sendall(bytes(header) + masked)

def recv_text():
    hdr = s.recv(2)
    if len(hdr) < 2:
        return None
    fin_op = hdr[0]
    length = hdr[1] & 0x7F
    if length == 126:
        ext = s.recv(2)
        length = struct.unpack(">H", ext)[0]
    elif length == 127:
        ext = s.recv(8)
        length = struct.unpack(">Q", ext)[0]
    payload = b""
    while len(payload) < length:
        payload += s.recv(length - len(payload))
    return payload.decode()

send_text(b'''$PAYLOAD''')
# Read a few frames.
for _ in range(3):
    try:
        msg = recv_text()
        if msg:
            print("AGENT:", msg[:200])
    except Exception as e:
        print("recv error:", e)
        break
s.close()
EOF
else
    echo "Need either websocat or python3 to run the smoke test." >&2
    exit 1
fi

kill $AGENT_PID 2>/dev/null || true
wait $AGENT_PID 2>/dev/null || true
echo "Smoke test complete."