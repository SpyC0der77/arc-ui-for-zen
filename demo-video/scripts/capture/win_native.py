"""Windows counterparts of the macOS-only capture helpers (osascript, CG window
ids, mac-native input). ctypes only; no third-party packages.

- now(): QueryPerformanceCounter seconds, the clock window-recorder.exe stamps
  frames with (time.perf_counter() on Windows).
- windows(pid) / main_window(pid): top-level windows of one process.
- front(hwnd) / to_back(hwnd) / give_back(hwnd): Z-order and focus.
- move/click/right_click/key/type_text: real input through SendInput.

Window titles are never read, because they can contain personal tab names.
"""
import ctypes
from ctypes import wintypes
import json
import math
from pathlib import Path
import subprocess
import time

u = ctypes.windll.user32
k32 = ctypes.windll.kernel32
try:
    u.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # per-monitor v2: real pixels
except Exception:
    u.SetProcessDPIAware()
u.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND] + [ctypes.c_int] * 4 + [ctypes.c_uint]
u.GetForegroundWindow.restype = wintypes.HWND

ROOT = Path(__file__).resolve().parents[3]
RECORDER = ROOT / 'artifacts/bin/window-recorder-win/window-recorder.exe'
HWND_TOP, HWND_BOTTOM = wintypes.HWND(0), wintypes.HWND(1)
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x1, 0x2, 0x10, 0x40


def now():
    return time.perf_counter()


def windows(pid):
    """[{id, class, onscreen, bounds}] for one process (window-recorder list)."""
    return json.loads(subprocess.check_output([str(RECORDER), 'list', str(pid)], text=True))


def main_window(pid, size=None):
    wins = [w for w in windows(pid) if w['class'] in ('MozillaWindowClass', 'Chrome_WidgetWin_1') and w['onscreen']]
    if not wins:
        raise RuntimeError(f'No visible browser window for PID {pid}')
    win = max(wins, key=lambda w: w['bounds']['Width'] * w['bounds']['Height'])
    if size and (win['bounds']['Width'], win['bounds']['Height']) != tuple(size):
        raise RuntimeError(f'Unexpected window size {win["bounds"]}, expected {size}')
    return win


def rect(hwnd):
    r = wintypes.RECT()
    ctypes.windll.dwmapi.DwmGetWindowAttribute(wintypes.HWND(hwnd), 9, ctypes.byref(r), ctypes.sizeof(r))
    return r.left, r.top, r.right - r.left, r.bottom - r.top


def foreground():
    return u.GetForegroundWindow()


def _nudge():
    # Windows only lets the process that sent the last input change the
    # foreground. A zero-distance relative mouse move qualifies and is inert.
    send_mouse(0, 0, 0x0001)


def front(hwnd):
    """Bring a window to the front and give it focus (recording takes only)."""
    hwnd = wintypes.HWND(hwnd)
    if u.IsIconic(hwnd):
        u.ShowWindow(hwnd, 9)  # SW_RESTORE
    _nudge()
    u.SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW)
    u.SetForegroundWindow(hwnd)
    for _ in range(40):
        if foreground() == hwnd.value:
            return True
        time.sleep(.05)
        _nudge()
        u.SetForegroundWindow(hwnd)
    raise RuntimeError('Could not bring the capture window to the front')


def to_back(hwnd):
    u.SetWindowPos(wintypes.HWND(hwnd), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE)


def give_back(hwnd):
    """Return focus to the window the user was working in."""
    if hwnd and u.IsWindow(wintypes.HWND(hwnd)):
        _nudge()
        u.SetForegroundWindow(wintypes.HWND(hwnd))


# ------------------------------------------------------------------ input

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [('dx', wintypes.LONG), ('dy', wintypes.LONG), ('mouseData', wintypes.DWORD),
                ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [('wVk', wintypes.WORD), ('wScan', wintypes.WORD), ('dwFlags', wintypes.DWORD),
                ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]


class _U(ctypes.Union):
    _fields_ = [('mi', MOUSEINPUT), ('ki', KEYBDINPUT), ('pad', ctypes.c_byte * 32)]


class INPUT(ctypes.Structure):
    _fields_ = [('type', wintypes.DWORD), ('u', _U)]


def _send(*inputs):
    arr = (INPUT * len(inputs))(*inputs)
    if u.SendInput(len(inputs), arr, ctypes.sizeof(INPUT)) != len(inputs):
        raise RuntimeError('SendInput was blocked (is the screen locked?)')


def send_mouse(dx, dy, flags, data=0):
    i = INPUT(type=0)
    i.u.mi = MOUSEINPUT(dx, dy, data, flags, 0, 0)
    _send(i)


def cursor():
    p = wintypes.POINT()
    u.GetCursorPos(ctypes.byref(p))
    return p.x, p.y


def move(x, y):
    u.SetCursorPos(int(round(x)), int(round(y)))
    send_mouse(0, 0, 0x0001)  # a real (zero) move so hover tracking updates


def glide(x, y, seconds):
    """Really move the pointer along an eased path (screen pixels)."""
    x0, y0 = cursor()
    start = now()
    while True:
        t = min(1, (now() - start) / seconds) if seconds > 0 else 1
        e = .5 - .5 * math.cos(math.pi * t)
        move(x0 + (x - x0) * e, y0 + (y - y0) * e)
        if t >= 1:
            return
        time.sleep(1 / 120)


def click(right=False):
    down, up = (0x0008, 0x0010) if right else (0x0002, 0x0004)
    send_mouse(0, 0, down)
    time.sleep(.06)
    send_mouse(0, 0, up)


VK = {'esc': 0x1B, 'enter': 0x0D, 'tab': 0x09, 'ctrl': 0x11, 'shift': 0x10, 'alt': 0x12, 'win': 0x5B,
      'left': 0x25, 'up': 0x26, 'right': 0x27, 'down': 0x28, 'backspace': 0x08, 'delete': 0x2E, 'space': 0x20}


def _key(vk, upflag=False):
    i = INPUT(type=1)
    ext = 0x0001 if vk in (0x25, 0x26, 0x27, 0x28, 0x2E) else 0
    i.u.ki = KEYBDINPUT(vk, 0, (0x0002 if upflag else 0) | ext, 0, 0)
    return i


def key(*names):
    """Press a chord, e.g. key('ctrl', 't') or key('esc')."""
    codes = [VK[n] if n in VK else ord(n.upper()) for n in names]
    _send(*[_key(c) for c in codes])
    time.sleep(.03)
    _send(*[_key(c, True) for c in reversed(codes)])


def type_text(text, gap=.09):
    for ch in text:
        i, j = INPUT(type=1), INPUT(type=1)
        i.u.ki = KEYBDINPUT(0, ord(ch), 0x0004, 0, 0)          # KEYEVENTF_UNICODE
        j.u.ki = KEYBDINPUT(0, ord(ch), 0x0004 | 0x0002, 0, 0)
        _send(i, j)
        time.sleep(gap)


def screen_locked():
    """True when the input desktop is not the default one (lock screen/UAC)."""
    h = u.OpenInputDesktop(0, False, 0x0100)  # DESKTOP_READOBJECTS... any access
    if not h:
        return True
    name = ctypes.create_unicode_buffer(256)
    needed = wintypes.DWORD()
    u.GetUserObjectInformationW(h, 2, name, ctypes.sizeof(name), ctypes.byref(needed))
    u.CloseDesktop(h)
    return name.value.lower() != 'default'
