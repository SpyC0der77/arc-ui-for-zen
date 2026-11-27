"""Windows helpers that keep the development Zen behind your windows. Used by dev.cjs.

  launch <zen.exe> <profile>   start minimized with Marionette; hand any focus back
  settle <pid>                 restore the window without activating it, at the back
  guard <pid>                  until stdin closes, push new dev popups/windows to the
                               back and hand stolen focus back (Gecko forces menus topmost)
  capture <pid> <out.png>      PrintWindow capture of the main window plus open popups;
                               works while other windows cover Zen (needs Pillow)

Never activates Zen, never makes it topmost, never grabs the screen.
"""
import ctypes
import os
import subprocess
import sys
import threading
import time
from ctypes import wintypes

u = ctypes.windll.user32
g = ctypes.windll.gdi32
k = ctypes.windll.kernel32
u.SetProcessDPIAware()
u.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND] + [ctypes.c_int] * 4 + [ctypes.c_uint]
HWND_BOTTOM = wintypes.HWND(1)
BACK = 0x1 | 0x2 | 0x10 | 0x200  # NOSIZE | NOMOVE | NOACTIVATE | NOOWNERZORDER
SW_SHOWNOACTIVATE = 4


def windows(pid, visible=True):
    out = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def enum(h, _):
        p = wintypes.DWORD()
        u.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value == pid and (not visible or u.IsWindowVisible(h)):
            b = ctypes.create_unicode_buffer(256)
            u.GetClassNameW(h, b, 256)
            r = wintypes.RECT()
            u.GetWindowRect(h, ctypes.byref(r))
            out.append((h, b.value, (r.left, r.top, r.right, r.bottom)))
        return True

    u.EnumWindows(enum, 0)
    return out


def to_back(h):
    u.SetWindowPos(h, HWND_BOTTOM, 0, 0, 0, 0, BACK)


def image_path(h):
    p = wintypes.DWORD()
    u.GetWindowThreadProcessId(h, ctypes.byref(p))
    proc = k.OpenProcess(0x1000, False, p.value)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not proc:
        return ""
    buf = ctypes.create_unicode_buffer(1024)
    size = wintypes.DWORD(1024)
    k.QueryFullProcessImageNameW(proc, 0, buf, ctypes.byref(size))
    k.CloseHandle(proc)
    return buf.value


def give_back(prev):
    """Return keyboard focus to the window you were using."""
    fg = u.GetForegroundWindow()
    # Only the process that sent the last input may change the foreground; a
    # zero-distance relative mouse move qualifies and does nothing visible.
    u.mouse_event(0x0001, 0, 0, 0, 0)
    a, b = k.GetCurrentThreadId(), u.GetWindowThreadProcessId(fg, None)
    u.AttachThreadInput(a, b, True)
    ok = u.SetForegroundWindow(prev)
    u.AttachThreadInput(a, b, False)
    if not ok or u.GetForegroundWindow() != prev:
        u.SwitchToThisWindow(prev, True)


def launch(exe, profile, watch=12):
    prev = u.GetForegroundWindow()
    si = subprocess.STARTUPINFO(dwFlags=subprocess.STARTF_USESHOWWINDOW, wShowWindow=7)  # SW_SHOWMINNOACTIVE
    # A Shift held while you type would start safe mode without the theme, and
    # quick restarts can trigger automatic safe mode. Marionette needs system
    # access, set only for this child process.
    env = {**os.environ, "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1",
           "MOZ_DISABLE_SAFE_MODE_KEY": "1", "MOZ_DISABLE_AUTO_SAFE_MODE": "1"}
    subprocess.Popen([exe, "-no-remote", "-purgecaches", "--marionette", "-profile", profile, "about:blank"],
                     startupinfo=si, env=env, close_fds=True,
                     creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
    target = os.path.normcase(os.path.abspath(exe))
    end = time.time() + watch
    while time.time() < end:
        fg = u.GetForegroundWindow()
        if fg and fg != prev and os.path.normcase(image_path(fg)) == target:
            to_back(fg)
            if prev and u.IsWindow(prev):
                give_back(prev)
        time.sleep(0.005)


def settle(pid):
    for _ in range(10):  # the first window can appear a moment after Marionette answers
        for h, cls, _ in windows(pid, visible=False):
            if cls == "MozillaWindowClass":
                if u.IsIconic(h):
                    u.ShowWindow(h, SW_SHOWNOACTIVATE)
                to_back(h)
        time.sleep(0.3)


def guard(pid):
    prev = u.GetForegroundWindow()
    PROC = ctypes.WINFUNCTYPE(None, wintypes.HANDLE, wintypes.DWORD, wintypes.HWND,
                              wintypes.LONG, wintypes.LONG, wintypes.DWORD, wintypes.DWORD)

    def cb(hook, event, h, obj, child, thread, ms):
        if not h or obj != 0:
            return
        b = ctypes.create_unicode_buffer(64)
        u.GetClassNameW(h, b, 64)
        if event == 0x0003:  # EVENT_SYSTEM_FOREGROUND
            to_back(h)
            if prev and u.IsWindow(prev):
                give_back(prev)
        elif b.value == "MozillaDropShadowWindowClass" or (b.value == "MozillaWindowClass" and event == 0x8002):
            to_back(h)

    callback = PROC(cb)
    tid = k.GetCurrentThreadId()
    # Stop when the parent closes stdin.
    threading.Thread(target=lambda: (sys.stdin.read(), u.PostThreadMessageW(tid, 0x12, 0, 0)), daemon=True).start()
    hooks = [u.SetWinEventHook(e, e, None, callback, pid, 0, 0) for e in (0x0003, 0x8002, 0x800B)]
    print("ready", flush=True)
    msg = wintypes.MSG()
    while u.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        u.TranslateMessage(ctypes.byref(msg))
        u.DispatchMessageW(ctypes.byref(msg))
    for hook in hooks:
        u.UnhookWinEvent(hook)


def grab(h):
    from PIL import Image
    r = wintypes.RECT()
    u.GetWindowRect(h, ctypes.byref(r))
    w, hh = r.right - r.left, r.bottom - r.top
    dc = u.GetWindowDC(h)
    mdc = g.CreateCompatibleDC(dc)
    bmp = g.CreateCompatibleBitmap(dc, w, hh)
    g.SelectObject(mdc, bmp)
    u.PrintWindow(ctypes.c_void_p(h), mdc, 2)  # PW_RENDERFULLCONTENT

    class BI(ctypes.Structure):
        _fields_ = [("a", ctypes.c_uint32), ("w", ctypes.c_int32), ("h", ctypes.c_int32), ("p", ctypes.c_uint16),
                    ("b", ctypes.c_uint16), ("c", ctypes.c_uint32), ("s", ctypes.c_uint32), ("x", ctypes.c_int32),
                    ("y", ctypes.c_int32), ("u", ctypes.c_uint32), ("i", ctypes.c_uint32)]

    bi = BI(40, w, -hh, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * hh * 4)
    g.GetDIBits(mdc, bmp, 0, hh, buf, ctypes.byref(bi), 0)
    g.DeleteObject(bmp)
    g.DeleteDC(mdc)
    u.ReleaseDC(h, dc)
    return Image.frombuffer("RGBA", (w, hh), buf, "raw", "BGRA", 0, 1), (r.left, r.top)


def capture(pid, out):
    from PIL import Image, ImageDraw
    ws = windows(pid)
    main = [w for w in ws if w[1] == "MozillaWindowClass"]
    if not main:
        raise SystemExit("No visible dev Zen window")
    pops = [w for w in ws if w[1] == "MozillaDropShadowWindowClass"]
    base, (bx, by) = grab(main[0][0])
    rects = [(bx, by, bx + base.width, by + base.height)] + [p[2] for p in pops]
    left, top = min(r[0] for r in rects), min(r[1] for r in rects)
    right, bottom = max(r[2] for r in rects), max(r[3] for r in rects)
    canvas = Image.new("RGBA", (right - left, bottom - top), (128, 128, 128, 255))
    canvas.paste(base, (bx - left, by - top))
    for h, _, _ in pops:
        im, (px, py) = grab(h)
        w, hh = im.size
        # PrintWindow paints a popup's transparent pixels pure black. Flood them
        # from the corners so the real shape, rounding included, shows. Never
        # replace this with a synthetic rounded mask: it hides real regressions.
        black = Image.eval(im.convert("L"), lambda v: 255 if v == 0 else 0)
        for corner in ((0, 0), (w - 1, 0), (0, hh - 1), (w - 1, hh - 1)):
            if black.getpixel(corner):
                ImageDraw.floodfill(black, corner, 128)
        canvas.paste(im, (px - left, py - top), Image.eval(black, lambda v: 0 if v == 128 else 255))
    canvas.convert("RGB").save(out)
    print(f"{out} ({len(pops)} popup{'s' if len(pops) != 1 else ''})")


if __name__ == "__main__":
    command, args = sys.argv[1], sys.argv[2:]
    if command == "launch":
        launch(args[0], args[1])
    elif command == "settle":
        settle(int(args[0]))
    elif command == "guard":
        guard(int(args[0]))
    elif command == "capture":
        capture(int(args[0]), args[1])
    else:
        raise SystemExit(__doc__)
