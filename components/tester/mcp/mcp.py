#!/usr/bin/env python3
"""
mcp.py — MCP server for the OpenVelo tester_rewrite component.

Exposes the same surface the previous fused Flask service offered, but as
MCP tools instead of REST endpoints:

  * mouse / keyboard / screenshot control  (formerly skynet/worker/worker.py)
  * AT-SPI based UI element introspection  (formerly skynet/observer/observer.py)

The server speaks the Model Context Protocol over stdio and is launched
by kilo acp itself via the ACP `session/new mcpServers` payload
(`{name, command, args, env}` — see workflow.ts `runTest()`).

Designed for the OpenVelo tester_rewrite container: it expects Xvfb,
openbox, and an AT-SPI bus to already be up (started by entrypoint.sh).
AT-SPI tools are imported lazily so the worker tools remain usable even
when pyatspi / typelibs are unavailable early in startup.
"""
from __future__ import annotations

import ctypes
import io
import os
import sys
import time
import hashlib
import base64
from typing import Any

# This script lives in /app/mcp/mcp.py — a folder named `mcp`. Python
# inserts the script's directory at the front of sys.path, which then
# shadows the installed `mcp` PyPI package (FastMCP, Image, etc.).
# Drop the script's own directory from sys.path so `import mcp.*`
# resolves to the installed package, not this folder.
_script_dir = os.path.dirname(os.path.abspath(__file__))
if sys.path and sys.path[0] == _script_dir:
    sys.path.pop(0)

import pyautogui
from mcp.server.fastmcp import FastMCP, Image
from mcp.server.transport_security import TransportSecuritySettings

# ---------------------------------------------------------------------------
# Bootstrap local Atspi typelib if present.
# ---------------------------------------------------------------------------
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_LOCAL_TYPELIB_DIR = os.path.join(_BASE_DIR, 'atspi_local', 'usr', 'lib',
                                  'x86_64-linux-gnu', 'girepository-1.0')
if os.path.isdir(_LOCAL_TYPELIB_DIR):
    existing = os.environ.get('GI_TYPELIB_PATH', '')
    os.environ['GI_TYPELIB_PATH'] = (
        _LOCAL_TYPELIB_DIR + (os.pathsep + existing if existing else '')
    )


def _import_atspi():
    import pyatspi  # type: ignore
    return pyatspi


mcp = FastMCP(
    name='openvelo-controller',
    instructions=(
        'OpenVelo GUI automation controller. Drives the X display with '
        'pyautogui (mouse, keyboard, screenshots) and exposes the live '
        'AT-SPI accessibility tree as a structured JSON element map.'
    ),
)


# ---------------------------------------------------------------------------
# Worker tools — mouse / keyboard / screenshot
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Input tools auto-observe: after every action that can change the UI
# (click, double/right/middle click, drag, scroll, keyboard), the tool
# sleeps a short settle interval and then returns the FRESH elements() map
# in its response. This guarantees the agent always sees any dialog/window
# that the action popped up, without having to remember to call wait() +
# elements() itself. Override the settle time with OPENVELO_SETTLE_MS.
# ---------------------------------------------------------------------------
def _settle_seconds() -> float:
    raw = os.environ.get('OPENVELO_SETTLE_MS', '')
    try:
        ms = float(raw)
        if ms >= 0:
            return ms / 1000.0
    except (TypeError, ValueError):
        pass
    return 1.0


def _act_and_observe(status: str = 'ok') -> dict[str, Any]:
    """Sleep the settle interval, then return {status, settle_ms, elements}.

    `elements` is the foreground UI map — the SAME shape and scoping as the
    elements() tool (built via _build_ui_map_v2), so what an action returns
    matches what a standalone elements() call returns. If building the map
    fails, the error is embedded under `elements` so the action's own success
    is still reported.
    """
    settle = _settle_seconds()
    time.sleep(settle)
    try:
        ui = _build_ui_map_v2()
    except Exception as e:  # never let observation failure mask the action
        import traceback
        ui = {'status': 'error', 'message': str(e),
              'traceback': traceback.format_exc()}
    return {'status': status, 'settle_ms': int(settle * 1000), 'elements': ui}


@mcp.tool()
def mouse_move(x: int, y: int) -> dict[str, str]:
    """Move the mouse cursor to absolute screen coordinates (x, y).

    Cursor moves do not settle-and-observe (they don't spawn dialogs); the
    subsequent click/keyboard tool returns the fresh elements() map.
    """
    pyautogui.moveTo(x, y)
    return {'status': 'ok'}


@mcp.tool()
def mouse_move_relative(dx: int, dy: int) -> dict[str, str]:
    """Move the mouse cursor by a relative offset (dx, dy)."""
    pyautogui.moveRel(dx, dy)
    return {'status': 'ok'}


@mcp.tool()
def mouse_click() -> dict[str, Any]:
    """Left-click at the current cursor position.

    After clicking, this waits a short settle interval and returns the
    fresh UI map under `elements` (same shape as the elements() tool), so
    you immediately see any dialog/window the click opened. You normally do
    NOT need to call wait()/elements() again right after this.
    """
    pyautogui.click()
    return _act_and_observe()


@mcp.tool()
def mouse_double_click() -> dict[str, Any]:
    """Double-click (left button) at the current cursor position.

    Issues both clicks within the OS double-click interval via a single
    pyautogui.doubleClick() call — more reliable than two separate
    mouse_click() RPCs, whose round-trip latency can exceed the window
    manager's double-click threshold and register as two single clicks
    (e.g. failing to open items in file lists / tree views).

    After clicking, this waits a short settle interval and returns the
    fresh UI map under `elements`, so you immediately see any dialog/window
    the double-click opened.
    """
    pyautogui.doubleClick()
    return _act_and_observe()


@mcp.tool()
def mouse_right_click() -> dict[str, Any]:
    """Right-click at the current cursor position.

    Waits a short settle interval and returns the fresh UI map under
    `elements` (any context menu that opened will be in it).
    """
    pyautogui.rightClick()
    return _act_and_observe()


@mcp.tool()
def mouse_middle_click() -> dict[str, Any]:
    """Middle-click at the current cursor position.

    Waits a short settle interval and returns the fresh UI map under
    `elements`.
    """
    pyautogui.middleClick()
    return _act_and_observe()


@mcp.tool()
def mouse_drag(start: list[int], end: list[int], duration: float = 0.5) -> dict[str, Any]:
    """Drag from `start` to `end` over `duration` seconds.

    Waits a short settle interval and returns the fresh UI map under
    `elements`.
    """
    pyautogui.moveTo(start[0], start[1])
    pyautogui.dragTo(end[0], end[1], duration=duration)
    return _act_and_observe()


@mcp.tool()
def mouse_scroll(amount: int = 0) -> dict[str, Any]:
    """Scroll the mouse wheel by `amount` (positive = up, negative = down).

    Waits a short settle interval and returns the fresh UI map under
    `elements` (newly-scrolled-into-view items will be in it).
    """
    pyautogui.scroll(amount)
    return _act_and_observe()


@mcp.tool()
def mouse_wheel(clicks: int = 0, horizontal: bool = False) -> dict[str, Any]:
    """Scroll the mouse wheel by `clicks` (positive = up/right, negative = down/left).

    If `horizontal` is True, scrolls horizontally (using pyautogui.hscroll).
    Otherwise, scrolls vertically (using pyautogui.scroll).

    Waits a short settle interval and returns the fresh UI map under `elements`.
    """
    if horizontal:
        pyautogui.hscroll(clicks)
    else:
        pyautogui.scroll(clicks)
    return _act_and_observe()



@mcp.tool()
def mouse_position() -> dict[str, int]:
    """Return the current cursor position."""
    x, y = pyautogui.position()
    return {'x': x, 'y': y}


@mcp.tool()
def keyboard_type(text: str) -> dict[str, Any]:
    """Type a string at the current focus (uses pyautogui.typewrite).

    Waits a short settle interval and returns the fresh UI map under
    `elements`, so any dialog/validation the typing triggered is visible.
    """
    pyautogui.typewrite(text)
    return _act_and_observe()


@mcp.tool()
def keyboard_press(key: str) -> dict[str, Any]:
    """Press a single named key (e.g. 'Return', 'Tab', 'Escape').

    Waits a short settle interval and returns the fresh UI map under
    `elements` (e.g. the dialog that 'Return' confirmed/opened).
    """
    pyautogui.press(key)
    return _act_and_observe()


@mcp.tool()
def keyboard_hotkey(keys: list[str]) -> dict[str, Any]:
    """Press a key combination (e.g. ['ctrl', 's']).

    Waits a short settle interval and returns the fresh UI map under
    `elements` (e.g. the Save dialog that Ctrl+S opened).
    """
    pyautogui.hotkey(*keys)
    return _act_and_observe()


# ---------------------------------------------------------------------------
# Cursor overlay — pyautogui.screenshot() does NOT draw the X11 cursor on
# Linux. We grab the real cursor image via the XFixes extension
# (`XFixesGetCursorImage`, called through ctypes because python-xlib
# doesn't ship an XFixes wrapper) and composite it onto the screenshot at
# its actual on-screen position. Falls back to a synthetic arrow if the
# XFixes call fails (e.g. the X server doesn't support XFixes, or the
# current cursor has no image yet).
# ---------------------------------------------------------------------------
class _XFixesCursorImage(ctypes.Structure):
    _fields_ = [
        ('x', ctypes.c_short),
        ('y', ctypes.c_short),
        ('width', ctypes.c_ushort),
        ('height', ctypes.c_ushort),
        ('xhot', ctypes.c_ushort),
        ('yhot', ctypes.c_ushort),
        ('cursor_serial', ctypes.c_ulong),
        # Variable-length trailing array; cast to a typed pointer later.
        ('pixels', ctypes.c_ulong * 1),
    ]


def _load_xfixes():
    """Lazily load libXfixes and python-xlib's Display. Returns
    (libxfixes, display_obj) or (None, None) if either is unavailable.
    """
    try:
        lib = ctypes.CDLL('libXfixes.so.3')
    except OSError:
        return None, None
    # Query version + get-cursor-image signatures.
    lib.XFixesQueryVersion.restype = ctypes.c_int
    lib.XFixesQueryVersion.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_int),
    ]
    lib.XFixesGetCursorImage.restype = ctypes.POINTER(_XFixesCursorImage)
    lib.XFixesGetCursorImage.argtypes = [ctypes.c_void_p]
    # XFree from libX11, used to release memory that XFixesGetCursorImage
    # malloc'd on the C side (otherwise each screenshot leaks the cursor
    # image — small per call but unbounded over a long-running tester).
    try:
        x11 = ctypes.CDLL('libX11.so.6')
        x11.XFree.restype = ctypes.c_int
        x11.XFree.argtypes = [ctypes.c_void_p]
        lib._xfree = x11.XFree  # stash for later use
    except OSError:
        lib._xfree = None
    try:
        from Xlib import display as _xdisplay  # local import — optional dep
        d = _xdisplay.Display()
    except Exception:
        return None, None
    return lib, d


# Process-wide cached (libxfixes, display). Xlib's Display() is
# expensive to create; reuse one for all screenshots. The cursor's
# position changes per call but the connection is stable.
_xfixes_cache: dict[str, Any] = {}


def _capture_cursor() -> tuple[int, int, int, int, int, int, bytes] | None:
    """Return (hot_x, hot_y, xhot, yhot, width, height, RGBA pixel bytes)
    for the current X11 cursor image, or None if XFixes is unavailable.

    `(hot_x, hot_y)` is the on-screen position of the cursor's hot spot
    — that's where the arrow tip "points". `(xhot, yhot)` is the
    hot-spot offset within the cursor image; to paste the cursor on a
    screenshot, use position `(hot_x - xhot, hot_y - yhot)`.
    """
    if 'fixes' not in _xfixes_cache:
        lib, disp = _load_xfixes()
        if lib is None or disp is None:
            _xfixes_cache['fixes'] = None
            return None
        try:
            maj = ctypes.c_int()
            min_ = ctypes.c_int()
            ok = lib.XFixesQueryVersion(
                disp.display._display,
                ctypes.byref(maj),
                ctypes.byref(min_),
            )
            if not ok:
                _xfixes_cache['fixes'] = None
                return None
        except Exception:
            _xfixes_cache['fixes'] = None
            return None
        _xfixes_cache['fixes'] = (lib, disp)

    cached = _xfixes_cache.get('fixes')
    if cached is None:
        return None
    lib, disp = cached

    try:
        raw = lib.XFixesGetCursorImage(disp.display._display)
    except Exception:
        return None
    if not raw:
        return None
    try:
        img = raw.contents
        w, h = int(img.width), int(img.height)
        if w <= 0 or h <= 0:
            return None
        # Re-cast the trailing array to the actual size.
        arr_ty = ctypes.c_ulong * (w * h)
        arr = ctypes.cast(img.pixels, ctypes.POINTER(arr_ty)).contents
        # XFixes returns pre-multiplied ARGB32 in native byte order.
        # Reverse the alpha-premultiplication so PIL shows the cursor's
        # real colors rather than dimmed ones, and pack as RGBA bytes.
        out = bytearray(w * h * 4)
        for i in range(w * h):
            argb = int(arr[i])
            a = (argb >> 24) & 0xFF
            if a == 0:
                continue  # leave RGBA bytes zero
            r8 = (argb >> 16) & 0xFF
            g8 = (argb >> 8) & 0xFF
            b8 = argb & 0xFF
            if a < 255:
                # Un-premultiply: pixel = raw * 255 / alpha.
                r8 = min(255, (r8 * 255 + a // 2) // max(a, 1))
                g8 = min(255, (g8 * 255 + a // 2) // max(a, 1))
                b8 = min(255, (b8 * 255 + a // 2) // max(a, 1))
            j = i * 4
            out[j] = r8
            out[j + 1] = g8
            out[j + 2] = b8
            out[j + 3] = a
        return int(img.x), int(img.y), int(img.xhot), int(img.yhot), w, h, bytes(out)
    finally:
        # XFixesGetCursorImage returns malloc'd memory — release it with
        # libX11's XFree to avoid leaking one cursor image per call.
        if getattr(lib, '_xfree', None):
            try:
                lib._xfree(raw)
            except Exception:
                pass


def _draw_fallback_cursor(img: Any, x: int, y: int) -> None:
    """Draw a synthetic black arrow with white outline at (x, y)
    (the cursor's hot-spot screen position) so the agent sees *some*
    indicator at the cursor location if XFixes is unavailable.
    """
    try:
        from PIL import ImageDraw
    except ImportError:
        return
    draw = ImageDraw.Draw(img, 'RGBA')
    # Classic left-pointer shape, anchored at (0,0) = hot spot.
    arrow = [
        (0, 0), (0, 13), (3, 10), (5, 16), (7, 15), (5, 9),
        (9, 9),
    ]
    abs_pts = [(x + dx, y + dy) for dx, dy in arrow]
    # 2-pixel white outline for visibility on light & dark backgrounds.
    for off in range(-2, 3):
        for dx, dy in ((off, 0), (0, off), (off, off), (-off, off)):
            if dx == 0 and dy == 0:
                continue
            draw.polygon([(px + dx, py + dy) for px, py in abs_pts],
                         fill=(255, 255, 255, 255))
    draw.polygon(abs_pts, fill=(0, 0, 0, 255))


def _query_pointer_position() -> tuple[int, int] | None:
    """Fallback path: read the cursor's screen position via
    XQueryPointer when XFixes isn't available (no cursor image, just
    the position for the synthetic arrow).
    """
    try:
        from Xlib import display as _xdisplay
        d = _xdisplay.Display()
        data = d.screen().root.query_pointer()
        return int(data.root_x), int(data.root_y)
    except Exception:
        return None


def _composite_cursor(img: Any, region: tuple[int, int, int, int] | None = None) -> None:
    """Composite the current X11 cursor onto `img` in-place. Tries
    XFixes first; falls back to a synthetic arrow on failure.
    `region` is the (x, y, w, h) crop that produced `img` — if the
    cursor's hot spot lies outside it, skip compositing.
    """
    cur = _capture_cursor()
    if cur is not None:
        hot_x, hot_y, xhot, yhot, cw, ch, pixels = cur
        # Translate into screenshot-coordinate space. Region crops
        # move the visible window's top-left to (rx, ry).
        rx, ry = (region[0], region[1]) if region else (0, 0)
        rw, rh = (region[2], region[3]) if region else img.size
        # If the hot spot is outside the cropped region, skip.
        if not (rx <= hot_x < rx + rw and ry <= hot_y < ry + rh):
            return
        from PIL import Image as _Image
        cursor_img = _Image.frombuffer('RGBA', (cw, ch), pixels,
                                       'raw', 'RGBA', 0, 1)
        # Paste position = (hot_x - xhot - rx, hot_y - yhot - ry).
        overlay = _Image.new('RGBA', img.size, (0, 0, 0, 0))
        overlay.paste(cursor_img, (hot_x - xhot - rx, hot_y - yhot - ry),
                      cursor_img)
        img.alpha_composite(overlay)
        return

    # Fallback: synthetic arrow at the actual pointer position.
    pos = _query_pointer_position()
    if pos is None:
        return
    rx, ry = (region[0], region[1]) if region else (0, 0)
    rw, rh = (region[2], region[3]) if region else img.size
    if not (rx <= pos[0] < rx + rw and ry <= pos[1] < ry + rh):
        return
    _draw_fallback_cursor(img, pos[0] - rx, pos[1] - ry)




def _draw_grid(img, spacing: int, region: tuple[int, int, int, int] | None = None) -> None:
    """Overlay a coordinate grid on `img` with the given pixel spacing.

    Lines are drawn at every `spacing` pixels horizontally and vertically
    in the image's local coordinate space (0..img.width, 0..img.height).
    When `region` is set, the lines start from the region offset so the
    on-screen coordinate labels match the actual screen coordinates.
    
    The lines are semi-transparent dark-grey with a thin white edge so they
    stay visible on both light and dark backgrounds. Major lines every
    100 px (5x the spacing) are slightly heavier so the LLM agent can use
    them as anchors when reasoning about coordinates.
    """
    if not spacing or spacing < 2:
        return
    try:
        from PIL import ImageDraw, ImageFont
    except ImportError:
        return
    draw = ImageDraw.Draw(img, 'RGBA')
    w, h = img.size
    rx, ry = (region[0], region[1]) if region else (0, 0)
    # Minor lines (every `spacing` px): faint grey, 1 px wide.
    minor = (160, 160, 160, 110)
    edge = (255, 255, 255, 60)
    # Major lines (every `spacing * 10` px): stronger, 2 px wide, with
    # coordinate labels at the top/bottom & left/right margins.
    major = (40, 40, 40, 200)
    major_edge = (255, 255, 255, 140)
    label_bg = (0, 0, 0, 180)
    label_fg = (255, 255, 255, 255)
    font = None
    try:
        font = ImageFont.truestyle('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
    except Exception:
        try:
            font = ImageFont.load_default()
        except Exception:
            font = None
    # Vertical lines.
    first_x = -((rx) % spacing) if rx % spacing else 0
    x = first_x
    line_idx = 0
    while x < w:
        screen_x = rx + x
        is_major = (screen_x % (spacing * 10)) == 0
        col = major if is_major else minor
        edge_col = major_edge if is_major else edge
        # 2-pixel-thick line: draw the centre column with edge, then
        # shift +1/-1 with the edge color so it's visible on both
        # light and dark backgrounds.
        if is_major:
            draw.line([(x, 0), (x, h)], fill=col, width=2)
            draw.line([(x - 1, 0), (x - 1, h)], fill=edge_col, width=1)
            draw.line([(x + 1, 0), (x + 1, h)], fill=edge_col, width=1)
        else:
            draw.line([(x, 0), (x, h)], fill=col, width=1)
        x += spacing
        line_idx += 1
    # Horizontal lines.
    first_y = -((ry) % spacing) if ry % spacing else 0
    y = first_y
    while y < h:
        screen_y = ry + y
        is_major = (screen_y % (spacing * 10)) == 0
        col = major if is_major else minor
        edge_col = major_edge if is_major else edge
        if is_major:
            draw.line([(0, y), (w, y)], fill=col, width=2)
            draw.line([(0, y - 1), (w, y - 1)], fill=edge_col, width=1)
            draw.line([(0, y + 1), (w, y + 1)], fill=edge_col, width=1)
        else:
            draw.line([(0, y), (w, y)], fill=col, width=1)
        y += spacing
    # Coordinate labels along the top edge for major vertical lines,
    # and along the left edge for major horizontal lines. Only drawn
    # when there's room (skip when spacing < 25 to avoid clutter).
    if spacing >= 25 and font is not None:
        for x in range(0, w, 1):
            screen_x = rx + x
            if screen_x % (spacing * 10) != 0:
                continue
            text = str(screen_x)
            tw = draw.textlength(text, font=font)
            tx = max(0, min(w - int(tw) - 4, x - int(tw) // 2))
            draw.rectangle([tx, 2, tx + int(tw) + 4, 16], fill=label_bg)
            draw.text((tx + 2, 2), text, fill=label_fg, font=font)
            break  # one label per major line; draw next via iteration
        # Re-loop with break removed: draw one label per major x.
        x = first_x
        while x < w:
            screen_x = rx + x
            if screen_x % (spacing * 10) == 0:
                text = str(screen_x)
                tw = draw.textlength(text, font=font)
                tx = max(0, min(w - int(tw) - 4, x - int(tw) // 2))
                draw.rectangle([tx, 2, tx + int(tw) + 4, 16], fill=label_bg)
                draw.text((tx + 2, 2), text, fill=label_fg, font=font)
            x += spacing
        # And the y-axis labels on the left edge.
        y = first_y
        while y < h:
            screen_y = ry + y
            if screen_y % (spacing * 10) == 0:
                text = str(screen_y)
                tw = draw.textlength(text, font=font)
                ty = max(0, min(h - 14, y - 6))
                draw.rectangle([2, ty, int(tw) + 6, ty + 16], fill=label_bg)
                draw.text((4, ty), text, fill=label_fg, font=font)
            y += spacing


def _screenshot_with_cursor_and_grid(
    region: tuple[int, int, int, int] | None = None,
    grid: int = 0,
):
    """Capture the X11 screen, composite the cursor overlay, optionally
    draw a coordinate grid, and return a PIL Image in RGB mode.
    """
    base = pyautogui.screenshot(region=region)
    rgba = base.convert('RGBA')
    _composite_cursor(rgba, region=region)
    if grid and grid > 0:
        _draw_grid(rgba, grid, region=region)
    return rgba.convert('RGB')



@mcp.tool()
def screenshot(grid: int = 0) -> Image:
    """Capture the full screen as a JPEG image, with the current mouse
    cursor composited on top (via XFixes).

    Pass `grid=10` (or any positive integer) to overlay a coordinate
    grid with lines every N pixels — useful when handing the image
    to an LLM agent, which can then target clicks precisely (e.g.
    "click at (430, 270)" by reading the grid labels instead of
    eyeballing pixel coordinates). Major lines every `grid * 10` px
    are rendered heavier and labelled with their screen coordinate.
    `grid=0` (default) disables the overlay.
    """
    img = _screenshot_with_cursor_and_grid(grid=grid)
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=70)
    buf.seek(0)
    return Image(data=buf.getvalue(), format='jpeg')


@mcp.tool()
def screenshot_region(x: int = 0, y: int = 0, w: int = 100, h: int = 100, grid: int = 0) -> Image:
    """Capture a rectangular region of the screen as a JPEG image. If
    the cursor's hot spot falls inside the region, it's composited on
    top. Pass `grid=N` (N > 0) to overlay a coordinate grid every N px
    (see `screenshot` for details).
    """
    img = _screenshot_with_cursor_and_grid(region=(x, y, w, h), grid=grid)
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=70)
    buf.seek(0)
    return Image(data=buf.getvalue(), format='jpeg')


@mcp.tool()
def wait(seconds: float = 1.0) -> dict[str, str]:
    """Sleep for `seconds` to let the UI settle."""
    time.sleep(seconds)
    return {'status': 'ok'}


# ---------------------------------------------------------------------------
# Observer — AT-SPI UI map (shape preserved from the legacy skynet/observer).
# ---------------------------------------------------------------------------
ACTIONABLE_ROLES = {
    'push button', 'toggle button', 'check box', 'radio button',
    'combo box', 'list item', 'tree item', 'text', 'entry',
    'password text', 'spin button', 'link', 'slider', 'menu', 'menu item',
    'page tab',
}
CONTEXT_ROLES = {
    'frame', 'dialog', 'terminal', 'document', 'text view', 'scroll bar', 'page tab list',
}
WINDOW_ROLES = {'frame', 'dialog', 'window'}


def _observer_screen_size() -> tuple[int, int]:
    try:
        w, h = pyautogui.size()
        return int(w), int(h)
    except Exception:
        return 1920, 1080


def _stable_id(role, name, x, y, w, h):
    payload = f"{role}|{name}|{x},{y},{w},{h}"
    return "el_" + hashlib.sha1(payload.encode()).hexdigest()[:12]


def _normalize_bbox(x, y, w, h, sw, sh):
    return {
        "x": round(x / sw, 4),
        "y": round(y / sh, 4),
        "w": round(w / sw, 4),
        "h": round(h / sh, 4),
    }


def _sane_geometry(x, y, w, h, sw, sh):
    if w <= 1 or h <= 1:
        return False
    if x < -100 or y < -100:
        return False
    if x > sw + 100 or y > sh + 100:
        return False
    return True


def _classify_window(name, role, x, y, w, h, sw, sh):
    name_lower = (name or "").lower()
    if w >= sw * 0.9 and h >= sh * 0.9 and "desktop" in name_lower:
        return "desktop"
    if y <= 40 and h <= 60:
        return "system_panel_top"
    if y >= sh - 80 and h <= 80:
        return "system_panel_bottom"
    return "app_window"


def _build_ui_map(merge: bool = True) -> dict[str, Any]:
    atspi = _import_atspi()
    sw, sh = _observer_screen_size()

    def get_bbox(obj):
        try:
            comp = obj.queryComponent()
            ext = comp.getExtents(atspi.DESKTOP_COORDS)
            return int(ext.x), int(ext.y), int(ext.width), int(ext.height)
        except Exception:
            return None

    def is_in_bbox(px, py, b):
        return (b['x'] <= px <= b['x'] + b['w'] and
                b['y'] <= py <= b['y'] + b['h'])

    def element_info(obj):
        try:
            states = obj.getState()
            if not (states.contains(atspi.STATE_VISIBLE) and states.contains(atspi.STATE_SHOWING)):
                return None
            bbox = get_bbox(obj)
            if not bbox or not _sane_geometry(*bbox, sw, sh):
                return None
            x, y, w, h = bbox
            role = str(obj.getRoleName())
            name = str(obj.name).strip() if obj.name else ""

            category = "noise"
            if role in ACTIONABLE_ROLES:
                category = "actionable"
            elif role in CONTEXT_ROLES:
                category = "context"
            elif role in WINDOW_ROLES:
                category = "window"
            if category == "noise" and name:
                category = "context"

            el_id = _stable_id(role, name, x, y, w, h)
            label_quality = "named" if name else "unnamed"
            risk = "low"
            if label_quality == "unnamed":
                if y < 40 or y > sh - 80:
                    risk = "high"
                else:
                    risk = "medium"

            return {
                "id": el_id,
                "name": name,
                "role": role,
                "category": category,
                "bbox_px": {"x": x, "y": y, "w": w, "h": h},
                "bbox_norm": _normalize_bbox(x, y, w, h, sw, sh),
                "center": {"x": int(x + w / 2), "y": int(y + h / 2)},
                "area": int(w * h),
                "label_quality": label_quality,
                "risk": risk,
                "actions": ["click"] if category == "actionable" else [],
            }
        except Exception:
            return None

    def collect(obj, store, depth=0):
        if depth > 15:
            return
        info = element_info(obj)
        if info:
            key = (info["bbox_px"]["x"], info["bbox_px"]["y"], info["bbox_px"]["w"], info["bbox_px"]["h"])
            existing = store.get(key)
            if (not existing
                or (info["category"] == "actionable" and existing["category"] != "actionable")
                or (info["name"] and not existing["name"])):
                store[key] = info
        try:
            if obj.childCount > 1000:
                return
            for i in range(obj.childCount):
                ch = obj.getChildAtIndex(i)
                if ch:
                    collect(ch, store, depth + 1)
        except Exception:
            pass

    focused_el_id = None
    focused_obj = None
    try:
        focused_obj = atspi.Registry.getFocusedElement()
        if focused_obj:
            f_bbox = get_bbox(focused_obj)
            if f_bbox:
                focused_el_id = _stable_id(str(focused_obj.getRoleName()),
                                            str(focused_obj.name or ""), *f_bbox)
    except Exception:
        pass

    raw = {}
    for i in range(atspi.Registry.getDesktopCount()):
        collect(atspi.Registry.getDesktop(i), raw)
    all_elements = list(raw.values())

    windows = []
    for el in all_elements:
        if el["role"] in WINDOW_ROLES and el["area"] > (sw * sh * 0.001):
            windows.append({
                "id": el["id"],
                "title": el["name"],
                "role": el["role"],
                "type": _classify_window(el["name"], el["role"], **el["bbox_px"], sw=sw, sh=sh),
                "bbox_px": el["bbox_px"],
                "area": el["area"],
            })

    active_window_id = None
    if focused_obj:
        f_bbox = get_bbox(focused_obj)
        if f_bbox:
            fc = (f_bbox[0] + f_bbox[2] / 2, f_bbox[1] + f_bbox[3] / 2)
            for win in windows:
                if win["type"] == "app_window" and is_in_bbox(fc[0], fc[1], win["bbox_px"]):
                    active_window_id = win["id"]
                    break
    if not active_window_id:
        app_windows = sorted([w for w in windows if w["type"] == "app_window"],
                             key=lambda x: x["area"], reverse=True)
        if app_windows:
            active_window_id = app_windows[0]["id"]

    window_ids = {w["id"] for w in windows}
    final = []
    for el in all_elements:
        if el["category"] not in ("actionable", "context"):
            continue
        if el["id"] in window_ids:
            continue
        owner = None
        for win in windows:
            if is_in_bbox(el["center"]["x"], el["center"]["y"], win["bbox_px"]):
                if not owner or win["area"] < owner["area"]:
                    owner = win
        el["window_id"] = owner["id"] if owner else None
        y = el["bbox_px"]["y"]
        if y < 40:
            el["region"] = "top_panel"
        elif y > sh - 80:
            el["region"] = "bottom_panel"
        elif owner:
            if (y < owner["bbox_px"]["y"] + 100
                    and el["role"] in ("menu", "menu item", "menu bar", "page tab")):
                el["region"] = "window_menu"
            else:
                el["region"] = "content"
        else:
            el["region"] = "unknown"
        final.append(el)

    if merge:
        final = _propagate_actions_to_labels(final)

    return {
        "status": "success",
        "screen": {"w": sw, "h": sh},
        "active_window_id": active_window_id,
        "focused_element_id": focused_el_id,
        "windows": windows,
        "elements": final,
    }


def _center_in_bbox(cx, cy, b) -> bool:
    """True if point (cx, cy) lies within the pixel bbox `b`."""
    return (b["x"] <= cx <= b["x"] + b["w"] and
            b["y"] <= cy <= b["y"] + b["h"])


def _bbox_contains(outer: dict, inner: dict) -> bool:
    """True if bbox `outer` fully encloses bbox `inner` (pixel coords)."""
    return (outer["x"] <= inner["x"] and
            outer["y"] <= inner["y"] and
            outer["x"] + outer["w"] >= inner["x"] + inner["w"] and
            outer["y"] + outer["h"] >= inner["y"] + inner["h"])


def _propagate_actions_to_labels(elements: list[dict]) -> list[dict]:
    """Mark named labels that overlay a clickable as themselves clickable.

    Some toolkits (notably GTK file-chooser / sidebar rows) expose the
    clickable element (a list item / cell with actions=['click']) as a
    SEPARATE element from the named label that renders inside it (a
    'label'/'text' element with the visible text but no actions). To an
    LLM the label then looks un-clickable and the clickable looks
    anonymous, which breaks targeting.

    Rather than merging the two elements (which loses information and can
    move names onto the wrong row), this pass leaves EVERY element exactly
    as observed — same id, name, bbox, center — and only ANNOTATES the
    label: it copies the enclosing actionable's `actions` onto the label
    so the LLM knows the label can be clicked. The label keeps its own
    center/bbox (where its text actually is), which is a perfectly good
    click point.

    A label gains actions only when a same-window actionable element fully
    CONTAINS it (the label renders inside the clickable, not merely near
    it). The label's original click-source is recorded under
    `actions_from` for traceability. Elements are never dropped, renamed,
    or moved; the anonymous clickable also stays in the list unchanged.
    """
    actionables = [e for e in elements if e.get("actions")]
    labels = [e for e in elements if not e.get("actions") and e.get("name")]
    if not actionables or not labels:
        return elements

    for label in labels:
        lb = label["bbox_px"]
        # Smallest same-window actionable that fully contains this label.
        best = None
        for act in actionables:
            if act["id"] == label["id"]:
                continue
            if act.get("window_id") != label.get("window_id"):
                continue
            if not _bbox_contains(act["bbox_px"], lb):
                continue
            if best is None or act.get("area", 0) < best.get("area", 0):
                best = act
        if best is None:
            continue
        # Annotate the label in place: advertise the same actions, but keep
        # the label's own geometry/name/id untouched.
        label["actions"] = list(best.get("actions", []))
        label["actions_from"] = best["id"]

    return elements


# ---------------------------------------------------------------------------
# elements() v2 — clean, LLM-focused interactive map.
#
# The legacy `_build_ui_map` filtered a flat, deduplicated element list but,
# on real GTK apps (verified against a live file-chooser), it produced three
# recurring problems for an LLM driving the UI:
#
#   1. Duplication — the clickable row and the label rendered *inside* it were
#      emitted as two separate elements (an anonymous list-item plus a named
#      label), and file-list rows exploded into ~10 nested sub-cells that all
#      share the same actions and overlap the same row.
#   2. Missing names — the genuinely clickable element (the row / cell) is
#      frequently unnamed; the visible text lives on a descendant label/cell,
#      so the actionable looked anonymous and un-targetable.
#   3. Container noise — panels, fillers, scroll panes, viewports, tables,
#      list boxes, etc. were surfaced even though the LLM never clicks them.
#
# v2 walks the accessibility tree (not a flat set), so it can (a) resolve a
# clickable's display name from its descendant labels, (b) collapse nested
# duplicate actionables into the single outermost row, and (c) drop pure
# structural containers. The result is one entry per *thing the LLM can act
# on*, each with a resolved name, a real click point, and its action list.
# ---------------------------------------------------------------------------

# Roles that are interactive targets an LLM may click/type into. Includes
# rows/cells because in GTK the row itself is the clickable unit even when it
# exposes no AT-SPI Action.
_INTERACTIVE_ROLES = {
    'push button', 'toggle button', 'check box', 'radio button', 'radio menu item',
    'check menu item', 'combo box', 'list item', 'tree item', 'table cell',
    'table row', 'entry', 'text', 'password text', 'spin button', 'link',
    'slider', 'menu', 'menu item', 'page tab', 'icon', 'toggle', 'switch',
}
# Editable/typeable roles (so the LLM knows it can type here).
_EDITABLE_ROLES = {'entry', 'text', 'password text', 'spin button', 'combo box'}
# Roles that carry a visible label but are never themselves a click target;
# used only for name resolution of an enclosing actionable.
_LABEL_ROLES = {'label', 'static', 'text', 'table cell', 'icon', 'heading'}
# Pure structural containers — never emitted as clickable, only traversed.
_CONTAINER_ROLES = {
    'filler', 'panel', 'scroll pane', 'scroll bar', 'viewport', 'split pane',
    'list box', 'tree', 'table', 'tree table', 'layered pane', 'redundant object',
    'file chooser', 'menu bar', 'tool bar', 'group', 'section', 'separator',
}


def _enumerate_x11_windows() -> list[dict]:
    """Enumerate mapped top-level X11 windows (title + screen bbox).

    Used as a FALLBACK signal for windows that AT-SPI does not expose. Some
    toolkits (notably Avalonia's file/folder picker on X11) render a real
    top-level dialog window that is fully visible on screen yet is NEVER
    registered in the AT-SPI accessibility tree — so `elements()` alone is
    blind to it. The X server still knows the window exists, so we surface
    it here (title, geometry) so the agent at least knows a dialog is open
    and can fall back to the pixel/screenshot path to drive it.

    Returns a list of {title, x, y, w, h}. Best-effort: returns [] if
    python-xlib or the required EWMH properties are unavailable.
    """
    try:
        from Xlib import display as _xdisplay, X  # local import — optional dep
    except Exception:
        return []
    out: list[dict] = []
    d = None
    try:
        d = _xdisplay.Display()
        root = d.screen().root
        net_client_list = d.intern_atom('_NET_CLIENT_LIST')
        net_wm_name = d.intern_atom('_NET_WM_NAME')
        utf8 = d.intern_atom('UTF8_STRING')

        prop = root.get_full_property(net_client_list, X.AnyPropertyType)
        win_ids = list(prop.value) if prop else []
        for wid in win_ids:
            try:
                w = d.create_resource_object('window', wid)
                attrs = w.get_attributes()
                if attrs is None or attrs.map_state != X.IsViewable:
                    continue
                # Absolute geometry (translate to root coordinates).
                geo = w.get_geometry()
                tx = root.translate_coords(w, 0, 0)
                x, y = int(tx.x), int(tx.y)
                ww, hh = int(geo.width), int(geo.height)

                # Title: prefer _NET_WM_NAME (UTF-8), fall back to WM_NAME.
                title = ""
                try:
                    p = w.get_full_property(net_wm_name, utf8)
                    if p and p.value:
                        title = (p.value.decode('utf-8', 'replace')
                                 if isinstance(p.value, (bytes, bytearray)) else str(p.value))
                except Exception:
                    pass
                if not title:
                    try:
                        wm = w.get_wm_name()
                        if wm:
                            title = wm if isinstance(wm, str) else wm.decode('utf-8', 'replace')
                    except Exception:
                        pass
                out.append({"title": title, "x": x, "y": y, "w": ww, "h": hh})
            except Exception:
                continue
    except Exception:
        return out
    finally:
        try:
            if d is not None:
                d.close()
        except Exception:
            pass
    return out


def _build_ui_map_v2(max_depth: int = 60) -> dict[str, Any]:
    atspi = _import_atspi()
    sw, sh = _observer_screen_size()

    def get_bbox(obj):
        try:
            comp = obj.queryComponent()
            ext = comp.getExtents(atspi.DESKTOP_COORDS)
            return int(ext.x), int(ext.y), int(ext.width), int(ext.height)
        except Exception:
            return None

    def get_actions(obj):
        try:
            act = obj.queryAction()
            return [str(act.getName(i)) for i in range(act.nActions)]
        except Exception:
            return []

    def state_names(obj):
        try:
            ss = obj.getState()
            out = set()
            for s in ss.getStates():
                try:
                    out.add(str(atspi.stateToString(s)))
                except Exception:
                    out.add(str(s))
            return out
        except Exception:
            return set()

    # --- Pass 1: walk the tree into lightweight node records ---------------
    nodes: list[dict] = []

    def walk(obj, parent_ref, depth):
        if depth > max_depth:
            return
        try:
            states = state_names(obj)
            showing = ('showing' in states) and ('visible' in states)
            bbox = get_bbox(obj)
            role = str(obj.getRoleName())
            name = (str(obj.name).strip() if obj.name else "")
            raw_actions = get_actions(obj)
            rec = {
                "role": role,
                "name": name,
                "states": states,
                "bbox": bbox,           # (x,y,w,h) or None
                "raw_actions": raw_actions,
                "parent": parent_ref,
                "depth": depth,
                "self_ref": len(nodes),
            }
            nodes.append(rec)
            my_ref = rec["self_ref"]
            # Guard against pathological trees.
            try:
                cc = int(obj.childCount)
            except Exception:
                cc = 0
            if cc > 4000:
                return
            for i in range(cc):
                try:
                    ch = obj.getChildAtIndex(i)
                except Exception:
                    continue
                if ch is not None:
                    walk(ch, my_ref, depth + 1)
        except Exception:
            return

    for i in range(atspi.Registry.getDesktopCount()):
        try:
            desktop = atspi.Registry.getDesktop(i)
        except Exception:
            continue
        if desktop is not None:
            walk(desktop, None, 0)

    by_ref = {n["self_ref"]: n for n in nodes}

    def sane(bbox):
        if not bbox:
            return False
        x, y, w, h = bbox
        if w <= 1 or h <= 1:
            return False
        if x < -100 or y < -100 or x > sw + 100 or y > sh + 100:
            return False
        return True

    # --- Focused element (for active-window + focus hints) -----------------
    focused_bbox = None
    try:
        fobj = atspi.Registry.getFocusedElement()
        if fobj is not None:
            focused_bbox = get_bbox(fobj)
    except Exception:
        focused_bbox = None

    # --- Ancestry helper (needed for window attribution) ------------------
    def ancestor_refs(ref):
        out = []
        cur = by_ref[ref]["parent"]
        while cur is not None:
            out.append(cur)
            cur = by_ref[cur]["parent"]
        return out

    # --- Windows -----------------------------------------------------------
    # A "window" is a real top-level surface: a frame/dialog/window, OR a
    # top-level dialog-like container (e.g. a GTK 'file chooser') that hangs
    # directly off an `application` node. The latter matters because portal/
    # Avalonia file-choosers are exposed as a SEPARATE application subtree
    # from the main app frame, yet are visually the same foreground dialog.
    _TOP_DIALOG_ROLES = {'file chooser', 'color chooser', 'dialog', 'alert', 'print dialog'}

    def is_window_node(n):
        role = n["role"]
        if role in WINDOW_ROLES:
            return True
        if role in _TOP_DIALOG_ROLES:
            p = n["parent"]
            # Top-level when its parent is an application/desktop frame (i.e.
            # it is not nested inside another dialog already treated as one).
            if p is not None and by_ref.get(p, {}).get("role") in ("application", "desktop frame"):
                return True
        return False

    windows = []
    win_ref_by_id = {}
    for n in nodes:
        if is_window_node(n) and sane(n["bbox"]):
            x, y, w, h = n["bbox"]
            if w * h < sw * sh * 0.001:
                continue
            states = n["states"]
            wid = _stable_id(n["role"], n["name"], x, y, w, h)
            windows.append({
                "ref": n["self_ref"],
                "id": wid,
                "title": n["name"],
                "role": n["role"],
                "type": _classify_window(n["name"], n["role"], x, y, w, h, sw, sh),
                "bbox_px": {"x": x, "y": y, "w": w, "h": h},
                "area": w * h,
                "active": 'active' in states,
                "modal": 'modal' in states,
                "focused": 'focused' in states,
            })
            win_ref_by_id[wid] = n["self_ref"]

    win_by_ref = {w["ref"]: w for w in windows}

    def window_of_ref(ref):
        """The nearest ANCESTOR window of a node (by accessibility tree),
        i.e. the window the element genuinely belongs to — independent of
        whether the window's reported bbox happens to cover the element."""
        if ref in win_by_ref:
            return win_by_ref[ref]
        for anc in ancestor_refs(ref):
            if anc in win_by_ref:
                return win_by_ref[anc]
        return None

    def window_for_bbox(bbox):
        """Fallback: smallest window whose box contains the point-center."""
        if not bbox:
            return None
        cx, cy = bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2
        best = None
        for win in windows:
            b = win["bbox_px"]
            if b["x"] <= cx <= b["x"] + b["w"] and b["y"] <= cy <= b["y"] + b["h"]:
                if best is None or win["area"] < best["area"]:
                    best = win
        return best

    # --- Active window ----------------------------------------------------
    # Determine which window is truly in front. Priority:
    #   1. A MODAL window (a modal dialog is, by definition, the foreground
    #      and blocks its parent) — even if the parent frame also reports
    #      `active`, the modal is what the user must interact with.
    #   2. Otherwise the AT-SPI `active` window (toolkit-authoritative).
    #   3. Otherwise the window enclosing the focused element.
    #   4. Otherwise the largest app window.
    active_window_id = None
    modal_windows = [w for w in windows if w["modal"]]
    active_windows = [w for w in windows if w["active"]]
    if modal_windows:
        # Topmost modal = smallest-area modal that is also active if any.
        cands = [w for w in modal_windows if w["active"]] or modal_windows
        active_window_id = min(cands, key=lambda w: w["area"])["id"]
    elif active_windows:
        active_window_id = min(active_windows, key=lambda w: w["area"])["id"]
    if not active_window_id and focused_bbox:
        w = window_for_bbox(focused_bbox)
        if w:
            active_window_id = w["id"]
    if not active_window_id:
        apps = sorted([w for w in windows if w["type"] == "app_window"],
                      key=lambda x: x["area"], reverse=True)
        if apps:
            active_window_id = apps[0]["id"]

    # --- Foreground window set --------------------------------------------
    # The LLM should only see what is currently in front: the active window
    # plus any dialog/popup layered on top of it (overlapping it). When the
    # active window is a modal dialog, its parent frame behind it is NOT part
    # of the foreground (the modal blocks it), so it is excluded.
    active_win = next((w for w in windows if w["id"] == active_window_id), None)

    def overlaps(a, b):
        ax, ay, aw, ah = a["x"], a["y"], a["w"], a["h"]
        bx, by, bw, bh = b["x"], b["y"], b["w"], b["h"]
        return not (ax + aw <= bx or bx + bw <= ax or ay + ah <= by or by + bh <= ay)

    def overlap_ratio(a, b):
        ax, ay, aw, ah = a["x"], a["y"], a["w"], a["h"]
        bx, by, bw, bh = b["x"], b["y"], b["w"], b["h"]
        ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
        iy = max(0, min(ay + ah, by + bh) - max(ay, by))
        inter = ix * iy
        if inter <= 0:
            return 0.0
        smaller = min(aw * ah, bw * bh) or 1
        return inter / smaller

    foreground_ids = set()
    if active_win:
        foreground_ids.add(active_win["id"])
        ab = active_win["bbox_px"]
        for w in windows:
            if w["id"] in foreground_ids:
                continue
            wb = w["bbox_px"]
            # Compose the frontmost visual stack: any other top-level surface
            # that substantially overlaps the active window belongs to the
            # same on-screen dialog (covers both popups layered on top AND the
            # sibling-application subtrees GTK/Avalonia file-choosers split
            # a single visual dialog across).
            if overlap_ratio(wb, ab) >= 0.6:
                foreground_ids.add(w["id"])
    else:
        foreground_ids = {w["id"] for w in windows}

    # --- Name resolution: pull a display name from descendant labels -------
    def resolve_name(ref):
        n = by_ref[ref]
        if n["name"]:
            return n["name"]
        # BFS over descendants, prefer the shallowest named label/cell/icon.
        found = []
        stack = [(c["self_ref"], 1) for c in nodes if c["parent"] == ref]
        # collect children names by depth
        # (nodes list preserves DFS order; gather all descendants of ref)
        def collect(r, d, acc):
            for c in nodes:
                if c["parent"] == r:
                    if c["name"] and c["role"] in _LABEL_ROLES and ('showing' in c["states"]):
                        acc.append((d, c["role"], c["name"]))
                    collect(c["self_ref"], d + 1, acc)
        collect(ref, 1, found)
        if not found:
            return ""
        found.sort(key=lambda t: t[0])
        top = found[0][0]
        tier = [(role, nm) for d, role, nm in found if d == top]
        # Prefer real text labels over icon accessible-names (e.g. an "Add"
        # icon next to an "Other Locations" label -> use the label).
        labels = [nm for role, nm in tier if role in ('label', 'static', 'heading', 'text')]
        chosen = labels if labels else [nm for _, nm in tier]
        return " ".join(dict.fromkeys(chosen))  # de-dupe, preserve order

    # --- Determine actionability ------------------------------------------
    def is_actionable(n):
        if not sane(n["bbox"]):
            return False
        role = n["role"]
        # Pure structural containers are never click targets, even if the
        # toolkit advertises an AT-SPI action on them (e.g. the file-chooser
        # widget itself). They only exist to be traversed for their children.
        if role in _CONTAINER_ROLES:
            return False
        if n["raw_actions"]:
            return True
        if role in _INTERACTIVE_ROLES:
            states = n["states"]
            # Rows/cells: only actionable when they behave interactively.
            if role in ('table cell', 'table row', 'list item', 'tree item'):
                return ('selectable' in states) or ('focusable' in states)
            if role == 'icon':
                # Standalone icons are only clickable if focusable (toolbar
                # icons); decorative row icons are handled via name-merge.
                return 'focusable' in states
            return True
        return False

    # --- Collapse nested duplicate actionables ----------------------------
    # A child actionable is redundant when an ancestor actionable shares the
    # same action semantics and its box (the child is a sub-cell of the row).
    # (ancestor_refs is defined above, near window attribution.)
    actionable_refs = {n["self_ref"] for n in nodes if is_actionable(n)}

    def click_point(bbox):
        x, y, w, h = bbox
        return {"x": int(x + w / 2), "y": int(y + h / 2)}

    # --- Collapse flat table grids into logical rows ----------------------
    # GTK tables expose a flat grid of cells (no `table row` element); cells
    # for one visual row share a Y band but are separate children of the
    # `table`. Emit ONE synthetic row per (table, Y-band) that spans the row
    # and is named from its cells, instead of one entry per column cell.
    _TABLE_ROLES = {'table', 'tree table'}
    table_cell_refs = set()          # cells folded into a synthetic row
    synthetic_rows = []              # extra element records to emit

    tables = [n for n in nodes if n["role"] in _TABLE_ROLES and sane(n["bbox"])]
    for tbl in tables:
        # Direct actionable cell descendants (row cells + their sub-cells).
        cells = [n for n in nodes
                 if n["role"] in ('table cell', 'table row')
                 and sane(n["bbox"])
                 and tbl["self_ref"] in ancestor_refs(n["self_ref"])]
        if not cells:
            continue
        # Group by Y band (rows are ~constant height; band by rounded top).
        bands: dict[int, list] = {}
        for c in cells:
            y = c["bbox"][1]
            key = None
            for b in bands:
                if abs(b - y) <= 6:
                    key = b
                    break
            bands.setdefault(key if key is not None else y, []).append(c)
        for _, group in bands.items():
            for c in group:
                table_cell_refs.add(c["self_ref"])
            xs = [c["bbox"][0] for c in group]
            ys = [c["bbox"][1] for c in group]
            xe = [c["bbox"][0] + c["bbox"][2] for c in group]
            ye = [c["bbox"][1] + c["bbox"][3] for c in group]
            rx, ry = min(xs), min(ys)
            rw, rh = max(xe) - rx, max(ye) - ry
            # Row name: prefer the leftmost named cell (the Name column);
            # trailing columns (size/type/modified) are metadata, not the
            # row's identity, so we don't fold them into the click target's
            # name.
            named = sorted([c for c in group if resolve_name(c["self_ref"])],
                           key=lambda c: c["bbox"][0])
            row_name = resolve_name(named[0]["self_ref"]) if named else ""
            # Aggregate raw actions across the row's cells.
            row_actions = []
            for c in group:
                row_actions.extend(c["raw_actions"])
            states = set()
            for c in group:
                states |= c["states"]
            synthetic_rows.append({
                "role": "table cell",
                "name": row_name,
                "states": states,
                "bbox": (rx, ry, rw, rh),
                "raw_actions": row_actions,
                "parent": tbl["self_ref"],
                "depth": tbl["depth"] + 1,
                "self_ref": -1,
                "_synthetic_row": True,
            })

    _TEXT_LABEL_ROLES = {'label', 'static', 'heading', 'text'}
    kept = []
    for n in nodes:
        ref = n["self_ref"]
        if ref in actionable_refs:
            if ref in table_cell_refs:
                continue  # folded into a synthetic row
            # Drop if an ancestor is also actionable AND the ancestor is a
            # row/table-cell/list-item container of this cell (nested duplicate).
            redundant = False
            for anc in ancestor_refs(ref):
                if anc in actionable_refs:
                    arole = by_ref[anc]["role"]
                    nrole = n["role"]
                    if arole in ('table cell', 'table row', 'list item', 'tree item') and \
                       nrole in ('table cell', 'icon', 'text', 'label'):
                        redundant = True
                        break
            if redundant:
                continue
            kept.append(n)
        else:
            # Standalone static labels, text blocks, and headings that are visible,
            # named, and have no actionable ancestors.
            if n["role"] in _TEXT_LABEL_ROLES and sane(n["bbox"]) and n["name"]:
                has_actionable_ancestor = False
                for anc in ancestor_refs(ref):
                    if anc in actionable_refs:
                        has_actionable_ancestor = True
                        break
                if not has_actionable_ancestor:
                    kept.append(n)
    kept.extend(synthetic_rows)

    # --- Build final element records --------------------------------------
    seen_ids = set()
    elements = []
    for n in kept:
        x, y, w, h = n["bbox"]
        if n.get("_synthetic_row"):
            name = n["name"]
        else:
            name = resolve_name(n["self_ref"])
        role = n["role"]
        states = n["states"]
        el_id = _stable_id(role, name, x, y, w, h)
        if el_id in seen_ids:
            continue
        seen_ids.add(el_id)

        # Enabled/disabled. AT-SPI exposes two flags: `sensitive` (the
        # toolkit-authoritative "user can interact" flag, cleared for greyed-
        # out widgets) and `enabled`. A widget is treated as usable only when
        # BOTH are present; if either is missing it is visible-but-disabled.
        enabled = ('sensitive' in states) and ('enabled' in states)

        # Actions: normalise to a small, LLM-meaningful set. A DISABLED
        # element carries NO interaction actions — it is shown so the LLM
        # knows it exists on screen, but it must not try to click/type it.
        acts = []
        if enabled:
            if role in _EDITABLE_ROLES or 'editable' in states:
                acts.append("type")
            # Everything interactive can be clicked.
            acts.append("click")
            # Preserve genuinely useful raw actions the LLM might invoke.
            for a in n["raw_actions"]:
                al = a.lower()
                if al in ("activate", "expand or contract", "toggle", "press"):
                    if al == "expand or contract" and "expand" not in acts:
                        acts.append("expand")
            # De-dupe, keep order, 'click' first.
            acts = list(dict.fromkeys(acts))

        # Window attribution by accessibility ancestry (authoritative), with
        # a geometric fallback for orphan nodes. Synthetic table rows carry
        # the owning table's ref in `parent`, so resolve through that.
        if n.get("_synthetic_row"):
            win = window_of_ref(n["parent"]) if n["parent"] is not None else None
        else:
            win = window_of_ref(n["self_ref"])
        if win is None:
            win = window_for_bbox(n["bbox"])

        # Foreground gate: skip elements that belong to a window which is not
        # currently in the foreground (background app windows, inactive
        # dialogs, system panels). This keeps the map focused on what the LLM
        # is actually driving right now.
        if foreground_ids and (win is None or win["id"] not in foreground_ids):
            continue

        el = {
            "id": el_id,
            "role": role,
            "name": name,
            "enabled": enabled,
            "actions": acts,
            "bbox_px": {"x": x, "y": y, "w": w, "h": h},
            "center": click_point(n["bbox"]),
            "window_id": win["id"] if win else None,
        }
        # Focus / selection hints (compact, only when true).
        if 'focused' in states:
            el["focused"] = True
        if 'selected' in states:
            el["selected"] = True
        if 'checked' in states:
            el["checked"] = True
        if role in _EDITABLE_ROLES or 'editable' in states:
            el["editable"] = True
        elements.append(el)

    # Order: top-to-bottom, then left-to-right — matches reading order and
    # makes the list easier for an LLM to scan against a screenshot.
    elements.sort(key=lambda e: (e["bbox_px"]["y"], e["bbox_px"]["x"]))

    focused_element_id = None
    if focused_bbox and sane(focused_bbox):
        for e in elements:
            b = e["bbox_px"]
            if (b["x"], b["y"], b["w"], b["h"]) == tuple(focused_bbox):
                focused_element_id = e["id"]
                break

    # Only surface foreground windows (active + any modal/popup on top).
    windows_out = [{
        "id": w["id"], "title": w["title"], "role": w["role"],
        "type": w["type"], "bbox_px": w["bbox_px"],
        "active": w["id"] == active_window_id,
        "atspi_accessible": True,
    } for w in windows if not foreground_ids or w["id"] in foreground_ids]

    # --- X11 fallback: surface top-level windows AT-SPI cannot see ----------
    # Some toolkits (Avalonia's file/folder picker on X11) render a real,
    # visible top-level dialog that is NEVER placed in the AT-SPI tree. The X
    # server still knows it exists, so we add any mapped X window that does
    # NOT correspond to an AT-SPI window we already have. These carry
    # `atspi_accessible: false` and have NO `elements` — the agent must drive
    # them via the pixel/screenshot path. This is what makes an otherwise
    # invisible open dialog detectable.
    try:
        def _norm_title(t):
            return (t or "").strip().lower()

        atspi_titles = {_norm_title(w["title"]) for w in windows if w["title"]}
        atspi_boxes = [(w["bbox_px"]["x"], w["bbox_px"]["y"],
                        w["bbox_px"]["w"], w["bbox_px"]["h"]) for w in windows]

        def matches_atspi(xw):
            # Primary match: same title (reliable — a stacked dialog has a
            # DIFFERENT title from the main window even when it overlaps it).
            xt = _norm_title(xw["title"])
            if xt and xt in atspi_titles:
                return True
            # Secondary match (only for UNTITLED x-windows, to avoid treating
            # a titled dialog that heavily overlaps the main window as the
            # same surface): near-identical geometry to an AT-SPI window.
            if not xt:
                xa = (xw["x"], xw["y"], xw["w"], xw["h"])
                for bx, by, bw, bh in atspi_boxes:
                    if (abs(xa[0] - bx) <= 8 and abs(xa[1] - by) <= 8 and
                            abs(xa[2] - bw) <= 16 and abs(xa[3] - bh) <= 16):
                        return True
            return False

        for xw in _enumerate_x11_windows():
            # Ignore degenerate / off-screen / root-sized shells.
            if xw["w"] <= 1 or xw["h"] <= 1:
                continue
            if xw["w"] * xw["h"] < sw * sh * 0.005:
                continue
            if matches_atspi(xw):
                continue
            x0, y0, w0, h0 = xw["x"], xw["y"], xw["w"], xw["h"]
            windows_out.append({
                "id": _stable_id("x11window", xw["title"], x0, y0, w0, h0),
                "title": xw["title"],
                "role": "window",
                "type": "app_window",
                "bbox_px": {"x": x0, "y": y0, "w": w0, "h": h0},
                # An X-only window that overlays the AT-SPI active window is
                # almost always the true foreground (e.g. a modal picker).
                "active": True,
                "atspi_accessible": False,
            })
    except Exception:
        pass

    # If a visible top-level window exists that AT-SPI cannot see, flag it at
    # the top level. NOTE: in a correctly-configured environment dialogs
    # (including toolkit file/folder pickers) DO appear in `elements` with
    # full controls — an inaccessible window is the exception, usually a sign
    # the a11y/AT-SPI bus was not propagated to that window's process. The
    # flag exists so the agent knows a window is open (and can fall back to
    # the pixel path if its controls truly never show up) rather than
    # concluding "nothing opened".
    inaccessible = [w for w in windows_out if not w.get("atspi_accessible", True)]

    result: dict[str, Any] = {
        "status": "success",
        "screen": {"w": sw, "h": sh},
        "active_window_id": active_window_id,
        "focused_element_id": focused_element_id,
        "windows": windows_out,
        "elements": elements,
    }
    if inaccessible:
        result["inaccessible_windows"] = [
            {"title": w["title"], "bbox_px": w["bbox_px"]} for w in inaccessible
        ]
        result["hint"] = (
            "A visible top-level window is present but not in the "
            "accessibility tree (atspi_accessible=false), so it has no "
            "elements here. Its controls would normally be listed, so this "
            "usually means the window's process lacks the AT-SPI bus. If its "
            "controls do not appear after a short wait + re-check, drive it "
            "via the pixel path: screenshot (optionally grid=25) and click by "
            "coordinate."
        )
    return result


@mcp.tool()
def elements() -> dict[str, Any]:
    """Return the live, interactive UI element map as JSON (LLM-optimised).

    Built for driving the UI: it returns ONE entry per thing you can act on
    — buttons, menu items, list/table rows, entries, tabs, etc. — with the
    noise removed. Structural containers (panels, fillers, scroll panes,
    tables, list boxes, file-chooser widgets) are dropped, nested duplicate
    cells are collapsed into their single clickable row, and each clickable's
    display name is resolved from its inner label when the clickable itself is
    unnamed (so file-chooser rows and sidebar items are properly named).

    SCOPE: only the FOREGROUND is returned — the active window plus any modal
    dialog / popup layered on top of it. Background app windows, inactive
    windows and system panels are excluded, so `elements` reflects only what
    the user is currently interacting with. `windows` lists just those
    foreground windows (each with `active: true/false`).

    Returns: {status, screen:{w,h}, active_window_id, focused_element_id,
    windows:[{id,title,role,type,bbox_px,active}], elements:[...]}. Each
    element has:
      - id      stable target id (role+name+bbox hash)
      - role    AT-SPI role (e.g. 'push button', 'list item', 'table cell')
      - name    resolved visible text (may come from an inner label)
      - enabled true if the widget is interactive; false if it is visible
                but greyed-out/disabled (AT-SPI sensitive+enabled). DISABLED
                elements are still listed (so you know they exist) but their
                `actions` is EMPTY — do not try to click/type them.
      - actions subset of ['click','type','expand'] you can perform (empty
                when enabled=false)
      - bbox_px {x,y,w,h} and center {x,y} — click at center
      - window_id  the enclosing window's id (or null)
      - focused/selected/checked/editable  present only when true
    Elements are ordered top-to-bottom, left-to-right to match a screenshot.
    Re-fetch after every interaction to re-target by id/name/role. For the
    unfiltered tree use elementsRaw(); for the legacy shape use
    elementsOriginal().
    """
    try:
        return _build_ui_map_v2()
    except Exception as e:
        import traceback
        return {"status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()}


def _build_ui_map_raw(max_depth: int = 100, max_nodes: int = 20000) -> dict[str, Any]:
    """Walk the entire AT-SPI tree from every desktop root and dump it as JSON.

    Unlike _build_ui_map, this applies NO visibility/geometry filtering, NO
    category classification, NO deduplication, and NO derived fields
    (center/region/risk/normalized bbox). It emits one node dict per
    accessible object exactly as reported by AT-SPI. Tree structure is
    preserved via monotonic `index` / `parent_index` (a flat list rather
    than nested children, to stay JSON-friendly and consistent with the
    `elements` style). Guardrails: `max_depth` recursion cap,
    `max_nodes` hard cap on emitted nodes (result gets `"truncated": true`
    when hit), and a child-count guard that skips children for nodes
    reporting an implausibly large child count.
    """
    atspi = _import_atspi()
    sw, sh = _observer_screen_size()

    def state_name(s):
        try:
            getter = getattr(atspi, "stateToString", None)
            if getter is not None:
                return getter(s)
        except Exception:
            pass
        return str(s)

    def parse_attributes(raw_attrs):
        out: dict[str, str] = {}
        if not raw_attrs:
            return out
        try:
            items = list(raw_attrs)
        except Exception:
            return out
        for item in items:
            try:
                s = str(item)
                if ":" in s:
                    k, v = s.split(":", 1)
                else:
                    k, v = s, ""
                out[k] = v
            except Exception:
                continue
        return out

    def raw_node(obj, index, parent_index, depth):
        try:
            role_name = str(obj.getRoleName())
        except Exception:
            role_name = "unknown"
        try:
            role_int = int(obj.getRole())
        except Exception:
            role_int = None

        try:
            name = str(obj.name) if obj.name is not None else ""
        except Exception:
            name = ""
        try:
            description = str(obj.description) if obj.description is not None else ""
        except Exception:
            description = ""

        try:
            child_count = int(obj.childCount)
        except Exception:
            child_count = 0

        try:
            index_in_parent = int(obj.getIndexInParent())
        except Exception:
            index_in_parent = None

        try:
            state_set = obj.getState()
            state_items = list(state_set.getStates())
            states = [state_name(s) for s in state_items]
        except Exception:
            states = []

        try:
            interfaces = [str(i) for i in obj.getInterfaces()]
        except Exception:
            interfaces = []

        try:
            attributes = parse_attributes(obj.getAttributes())
        except Exception:
            attributes = {}

        # NOTE: getInterfaces() is unreliable on some pyatspi builds (returns
        # an empty list even when Component/Action work), so we do not gate on
        # it — we just attempt the queries and swallow failures.
        extents = None
        try:
            comp = obj.queryComponent()
            ext = comp.getExtents(atspi.DESKTOP_COORDS)
            extents = {
                "x": int(ext.x),
                "y": int(ext.y),
                "w": int(ext.width),
                "h": int(ext.height),
            }
        except Exception:
            extents = None

        actions: list[str] = []
        try:
            act = obj.queryAction()
            for i in range(act.nActions):
                try:
                    actions.append(str(act.getName(i)))
                except Exception:
                    continue
        except Exception:
            actions = []

        app_name = None
        toolkit_name = None
        try:
            app = obj.getApplication()
            if app is not None:
                try:
                    app_name = str(app.name) if app.name is not None else None
                except Exception:
                    app_name = None
                getter = getattr(app, "getToolkitName", None)
                if getter is not None:
                    try:
                        toolkit_name = str(getter())
                    except Exception:
                        toolkit_name = None
        except Exception:
            pass

        return {
            "index": index,
            "parent_index": parent_index,
            "depth": depth,
            "role": role_name,
            "role_int": role_int,
            "name": name,
            "description": description,
            "child_count": child_count,
            "index_in_parent": index_in_parent,
            "states": states,
            "interfaces": interfaces,
            "attributes": attributes,
            "extents": extents,
            "actions": actions,
            "app": app_name,
            "toolkit": toolkit_name,
        }

    elements_list: list[dict] = []
    roots: list[int] = []
    truncated = False
    next_index = 0

    def visit(obj, parent_index, depth):
        nonlocal next_index, truncated
        if truncated:
            return
        if next_index >= max_nodes:
            truncated = True
            return
        idx = next_index
        next_index += 1
        node = raw_node(obj, idx, parent_index, depth)
        elements_list.append(node)
        if parent_index is None:
            roots.append(idx)
        if depth >= max_depth:
            return
        try:
            cc = int(obj.childCount)
        except Exception:
            cc = 0
        if cc > 10000:
            return
        for i in range(cc):
            if truncated or next_index >= max_nodes:
                truncated = True
                return
            try:
                ch = obj.getChildAtIndex(i)
            except Exception:
                continue
            if ch is None:
                continue
            visit(ch, idx, depth + 1)

    try:
        for i in range(atspi.Registry.getDesktopCount()):
            if truncated or next_index >= max_nodes:
                truncated = True
                break
            try:
                desktop = atspi.Registry.getDesktop(i)
            except Exception:
                continue
            if desktop is None:
                continue
            visit(desktop, None, 0)
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed to enumerate desktops: {e}",
            "elements": elements_list,
            "roots": roots,
            "truncated": truncated,
        }

    return {
        "status": "success",
        "screen": {"w": sw, "h": sh},
        "node_count": len(elements_list),
        "roots": roots,
        "elements": elements_list,
        "truncated": truncated,
    }


@mcp.tool()
def elementsRaw(max_depth: int = 100, max_nodes: int = 20000) -> dict[str, Any]:
    """Return the FULL, unfiltered AT-SPI accessibility tree as JSON.

    Walks every accessible object from every desktop root and emits one
    raw node per object — role, role_int, name, description, states,
    interfaces, attributes, raw extents, raw actions, app/toolkit —
    preserving structure via monotonic `index` / `parent_index`.

    Unlike `elements()` and `elementsOriginal()`, this applies NO
    visibility/geometry filtering, NO category classification, NO
    deduplication, and NO derived fields (center/region/risk/normalized
    bbox). Intended for debugging and inspecting the true AT-SPI tree;
    prefer `elements()` for driving the UI.

    Guardrails: `max_depth` (recursion cap) and `max_nodes` (hard cap on
    emitted nodes; result gets `truncated: true` when hit), plus a
    per-node child-count guard that skips children for nodes reporting
    an implausibly large child count. Output is a flat list; reconstruct
    the tree via `index`/`parent_index`.

    Returns: {status, screen:{w,h}, node_count, roots, elements, truncated}.
    """
    try:
        return _build_ui_map_raw(max_depth=max_depth, max_nodes=max_nodes)
    except Exception as e:
        import traceback
        return {"status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()}


@mcp.tool()
def elementsOriginal() -> dict[str, Any]:
    """Return the live AT-SPI UI element map as JSON, WITHOUT annotation.

    Identical to `elements()` but with the action-propagation pass
    disabled, so it returns the raw AT-SPI elements exactly as observed:
    named-but-actionless labels keep their empty `actions` (no
    `actions_from`), and the separate anonymous clickable is unchanged.
    Use this to inspect the unmodified tree — e.g. to debug targeting when
    the annotated view of `elements()` looks wrong. Prefer `elements()`
    for normal interaction.
    """
    try:
        return _build_ui_map(merge=False)
    except Exception as e:
        import traceback
        return {"status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()}


# ---------------------------------------------------------------------------
# Health (tool form). The orchestrator / web-UI no longer polls this via
# curl since the MCP server is stdio-only; it's kept as a tool for parity
# with the legacy /health surface.
# ---------------------------------------------------------------------------
@mcp.tool()
def health() -> dict[str, Any]:
    """Liveness probe. Returns process info for the MCP server."""
    return {'status': 'alive',
            'controller': 'openvelo-tester-rewrite',
            'pid': os.getpid()}


# ---------------------------------------------------------------------------
# Swagger-style documentation — mounts three routes on top of the MCP
# transport's Starlette app so anyone (browser, curl, MCP Inspector)
# can browse the exposed tools:
#
#   GET  /                       — redirects to /docs
#   GET  /docs                   — Swagger UI HTML page (loads from CDN)
#   GET  /openapi.json           — OpenAPI 3.1 spec, generated on the
#                                  fly from the registered tools
#   POST /mcp/tools/{name}       — direct HTTP invocation of a tool;
#                                  body = JSON tool arguments, returns
#                                  the tool result as JSON (or the raw
#                                  image bytes for screenshot*)
#
# Skipped when the transport is `stdio` (no HTTP server to mount on).
# ---------------------------------------------------------------------------
_SWAGGER_UI_HTML = '''\
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>OpenVelo Controller — MCP API</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; }
    .topbar { display: none; }
    .info__title { font-size: 1.8em; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"
          crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
      });
    };
  </script>
</body>
</html>
'''


def _build_openapi_spec(mcp: FastMCP) -> dict:
    """Generate an OpenAPI 3.1 spec from the registered MCP tools.

    Each tool becomes one POST endpoint under /mcp/tools/{name}, with the
    tool's JSON-Schema input as the request body and a generic JSON
    response schema. Image-returning tools (screenshot, screenshot_region)
    get an `image/png` response.
    """
    tools = mcp._tool_manager._tools
    paths: dict[str, dict] = {}
    image_tools = {'screenshot', 'screenshot_region'}

    for tool_name, tool in tools.items():
        desc = (tool.description or '').strip() or tool_name
        # First line as summary, full text as description.
        first_line, _, rest = desc.partition('\n')
        input_schema = dict(tool.parameters or {})
        # Drop FastMCP's "title" decoration — Swagger renders it as the
        # schema name, which clutters the UI for per-tool bodies.
        input_schema.pop('title', None)
        input_schema.setdefault('type', 'object')

        op: dict = {
            'summary': first_line or tool_name,
            'description': rest.strip() if rest else first_line,
            'operationId': f'call_{tool_name}',
            'tags': ['controller'],
            'requestBody': {
                'required': True,
                'content': {
                    'application/json': {
                        'schema': input_schema,
                    },
                },
            },
            'responses': {
                '200': {'description': 'Tool result.'},
                '404': {'description': 'Unknown tool.'},
                '500': {'description': 'Tool raised an exception.'},
            },
        }
        if tool_name in image_tools:
            op['responses']['200'] = {
                'description': 'JPEG screenshot of the screen / region.',
                'content': {'image/jpeg': {'schema': {'type': 'string',
                                                     'format': 'binary'}}},
            }
        else:
            op['responses']['200']['content'] = {
                'application/json': {'schema': {'type': 'object'}},
            }

        path = f'/mcp/tools/{tool_name}'
        paths[path] = {'post': op}

    return {
        'openapi': '3.1.0',
        'info': {
            'title': 'OpenVelo Controller MCP API',
            'version': '1.0.0',
            'description': (
                'HTTP mirror of the FastMCP tools exposed by the OpenVelo '
                'tester_rewrite controller. Each POST /mcp/tools/{name} '
                'invokes the underlying MCP tool synchronously and returns '
                'its result. Equivalent to a JSON-RPC `tools/call` against '
                f'the same FastMCP server. Tool count: {len(tools)}.'
            ),
        },
        'servers': [
            {'url': '/', 'description': 'Same host as this Swagger UI.'},
        ],
        'paths': paths,
    }


def _register_docs_routes(mcp: FastMCP) -> None:
    """Mount Swagger UI + OpenAPI + direct HTTP tool endpoints."""
    import json as _json
    from starlette.requests import Request
    from starlette.responses import (
        JSONResponse,
        RedirectResponse,
        Response,
    )

    @mcp.custom_route('/', methods=['GET'])
    async def _root(request: Request) -> Response:  # noqa: ARG001
        return RedirectResponse(url='/docs', status_code=302)

    @mcp.custom_route('/docs', methods=['GET'])
    async def _docs(request: Request) -> Response:  # noqa: ARG001
        return Response(
            content=_SWAGGER_UI_HTML,
            media_type='text/html; charset=utf-8',
        )

    @mcp.custom_route('/openapi.json', methods=['GET'])
    async def _openapi(request: Request) -> Response:  # noqa: ARG001
        spec = _build_openapi_spec(mcp)
        return JSONResponse(spec, headers={'Cache-Control': 'no-store'})

    @mcp.custom_route('/mcp/tools/{tool_name}', methods=['POST'])
    async def _call_tool(request: Request) -> Response:
        tool_name = request.path_params['tool_name']
        tool = mcp._tool_manager._tools.get(tool_name)
        if tool is None:
            return JSONResponse(
                {'error': f'unknown tool: {tool_name}'},
                status_code=404,
            )
        # Body = tool arguments (object). Empty body / {} is fine for
        # tools with no required parameters.
        try:
            raw = await request.body()
            args = _json.loads(raw) if raw else {}
        except Exception as exc:  # pragma: no cover
            return JSONResponse(
                {'error': f'invalid JSON body: {exc}'},
                status_code=400,
            )
        if not isinstance(args, dict):
            args = {}
        try:
            result = await mcp._tool_manager.call_tool(tool_name, args)
        except Exception as exc:
            return JSONResponse(
                {'error': f'tool {tool_name} failed: {exc}'},
                status_code=500,
            )
        # `call_tool(convert_result=False)` returns the raw tool return
        # value. The screenshot / screenshot_region tools return an
        # `Image` object (with `.data` = JPEG bytes); every other tool
        # returns a plain dict like {'status': 'ok'}. Branch on type.
        if isinstance(result, Image):
            return Response(content=result.data, media_type='image/jpeg')
        if isinstance(result, (dict, list, str, int, float, bool)):
            return JSONResponse(result)
        # Last resort — best-effort JSON serialisation of anything else.
        return JSONResponse({'result': str(result)})


# ---------------------------------------------------------------------------
# Entry point — transport is selected via the MCP_TRANSPORT env var
# (default "stdio"). The OpenVelo entrypoint.sh spawns this process in
# HTTP/SSE mode so the controller is reachable from outside the
# container (handy in debug mode — `curl`, `wscat`, MCP Inspector, etc.).
# The kilo acp subprocess, when spawned by the ACP `session/new
# mcpServers` payload, still uses the remote HTTP/SSE URL form so it
# reaches the same server.
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    transport = os.environ.get('MCP_TRANSPORT', 'stdio')
    # Read MCP_HOST (preferred) and fall back to MCP_BIND (legacy alias).
    # Default 0.0.0.0 so the MCP server is reachable from outside the
    # container via Docker port mapping. Set MCP_HOST=127.0.0.1 to
    # restrict reachability to the container itself.
    host = os.environ.get('MCP_HOST') or os.environ.get('MCP_BIND') or '0.0.0.0'
    try:
        port = int(os.environ.get('MCP_PORT', '8765'))
    except ValueError:
        port = 8765
    if transport == 'stdio':
        mcp.run('stdio')
    elif transport in ('sse', 'streamable-http'):
        # FastMCP's run() binds `host`/`port` from the FastMCP settings
        # object (uvicorn.Config reads it at serve time). The constructor
        # was already called above without env values, so re-bind here
        # by mutating settings — that's the supported extension point.
        mcp.settings.host = host
        mcp.settings.port = port
        # When bound to 0.0.0.0 (i.e. reachable from outside the
        # container), FastMCP's DNS-rebinding protection would reject
        # any Host header that isn't a localhost name. Disable it for
        # the exposed bind so MCP Inspector / curl from the host work;
        # leave it on for 127.0.0.1 (loopback-only deployments).
        if host != '127.0.0.1':
            mcp.settings.transport_security = TransportSecuritySettings(
                enable_dns_rebinding_protection=False,
            )
        # Mount Swagger UI + OpenAPI + direct HTTP tool endpoints.
        _register_docs_routes(mcp)
        mcp.run(transport)
    else:
        raise SystemExit(f'unknown MCP_TRANSPORT: {transport!r} (expected stdio|sse|streamable-http)')