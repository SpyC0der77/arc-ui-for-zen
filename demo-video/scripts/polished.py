"""Polished three-lane comparison renderer for the real browser recordings.

Reads the same manifest as comparison.py (timeline/comparison.json) and keeps
its editorial rules: every lane plays its real footage up to its measured ready
frame, early lanes hold their last frame until the slowest lane finishes, then
all lanes hold together before the next feature. On top of that it renders, in
Python, at 60 fps:

* eased camera moves and cursor paths (whole moves are eased, not each sample),
  with the cursor carried over between features instead of re-entering;
* a crisp vector cursor drawn at panel resolution after the camera;
* staggered crossfades between features and animated feature titles;
* per-lane status (running spinner, done check, unavailable dash) and a gentle
  dim on lanes that finished while others are still working;
* a chaptered progress bar, short intro and outro cards.

No browser is launched and no footage is altered beyond crop/scale.
Requires Pillow, NumPy, ffmpeg and ffprobe.
"""
import argparse
import json
import math
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comparison import LANES, load_plan  # noqa: E402

FPS = 60
SRC_FPS = 60  # sources are decoded at this rate (30 fps footage repeats frames)
W, H = 1920, 1080
PW, PH = 588, 882
GUTTER = 32
PX0 = (W - 3 * PW - 2 * GUTTER) // 2
PY = 150
RADIUS = 18
LABELS = {"arc": "Arc", "themed": "Arc UI for Zen", "zen": "Vanilla Zen"}
SUBTITLE = "Side by side with Arc and vanilla Zen, feature by feature"
ACCENT = (185, 169, 255)
DONE = (110, 220, 150)
TEXT = (242, 244, 250)
MUTED = (160, 166, 182)
AMBER = (240, 206, 140)

LEAD_FIRST, LEAD = 0.6, 0.2
HOLD, HOLD_LAST = 1.5, 2.0
STAGGER = 4  # frames between lanes
UNAVAILABLE_DIM = 0.35
INTRO, OUTRO = 2.4, 3.2
LETTERBOX = (26, 28, 36)
BENTO_SECONDS = 6.5

CHAPTERS = [
    ("Spaces & folders", ["work-space-essentials-and-real-documentation", "collapsed-folder", "expanded-folder",
                          "personal-space", "reading-space", "back-to-work"]),
    ("Sidebar", ["undock-the-sidebar", "hover-peek", "full-page-with-hidden-sidebar", "dock-the-sidebar",
                 "resize-sidebar", "restore-sidebar-width"]),
    ("Command bar & split view", ["centered-command-bar", "side-by-side-split-view", "unsplit-command",
                                  "return-to-one-page", "horizontal-split-command", "top-to-bottom-split",
                                  "unsplit-horizontal-view"]),
    ("Downloads & library", ["downloads-command", "library-downloads", "library-spaces", "media-library",
                             "return-from-library", "downloads-hover-menu", "download-file-flight",
                             "hidden-sidebar-download", "dock-after-download"]),
    ("Live Folders & Boosts", ["github-live-folders", "boosts-library"]),
    ("Archive", ["archive-command", "javascript-reference-as-a-background-tab",
                 "auto-archive-javascript-reference", "archive-library", "restore-javascript-reference",
                 "finish-on-work"]),
]

WINDOWS = sys.platform == "win32"
FONT_PATH = "C:/Windows/Fonts/SegUIVar.ttf" if WINDOWS else "/System/Library/Fonts/SFNS.ttf"
_fonts = {}


WEIGHTS = {"Regular": 400, "Medium": 510, "Semibold": 590, "Bold": 700}


def font(size, weight="Regular"):
    """SF Pro with its optical size matched to the pixel size, so large text gets
    the Display design and spacing instead of the loose small-text spacing."""
    key = (size, weight)
    if key not in _fonts:
        try:
            f = ImageFont.truetype(FONT_PATH, size)
            if WINDOWS:
                # Segoe UI Variable axes: Weight, Optical Size (points). Used for
                # measuring; sprites come from DirectWrite (text-render.exe).
                f.set_variation_by_axes([min(700, WEIGHTS.get(weight, 400)), max(5, min(36, size * .75))])
            else:
                # Axes: Width, Optical Size, GRAD, Weight.
                f.set_variation_by_axes([100, max(17, min(96, size)), 400, WEIGHTS.get(weight, 400)])
        except OSError:
            f = ImageFont.load_default(size=size)
        _fonts[key] = f
    return _fonts[key]


# ---------------------------------------------------------------- easing

def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def ease_io(u):
    u = clamp(u)
    return 4 * u * u * u if u < .5 else 1 - (-2 * u + 2) ** 3 / 2


def ease_out(u):
    u = clamp(u)
    return 1 - (1 - u) ** 3


def ease_back(u, s=1.7):
    u = clamp(u)
    return 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2


def lerp(a, b, u):
    return a + (b - a) * u


# ---------------------------------------------------------------- paths

def camera_at(keys, t):
    if t <= keys[0][0]:
        return keys[0][1]
    for (a, ar), (b, br) in zip(keys, keys[1:]):
        if t < b:
            u = ease_io((t - a) / (b - a))
            return [lerp(x, y, u) for x, y in zip(ar, br)]
    return keys[-1][1]


def catmull(points, samples=24):
    if len(points) < 3:
        return points
    pts = [points[0]] + points + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(samples):
            u = s / samples
            out.append(tuple(.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u
                                   + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u ** 3) for k in (0, 1)))
    out.append(points[-1])
    return out


REST_PX = 4  # recorded samples this close together count as a rest


def ease_cursor(u):
    """Sine in-out: peak speed ~1.6x average, gentler than cubic for a hand-moved pointer."""
    u = clamp(u)
    return .5 - .5 * math.cos(math.pi * u)


def natural_duration(distance):
    """Seconds a person takes to move the pointer this many source pixels."""
    return clamp(.32 + distance / 1900, .4, 1.15)


def make_curve(points):
    curve = catmull(points)
    lens = [0.0]
    for p, q in zip(curve, curve[1:]):
        lens.append(lens[-1] + math.dist(p, q))
    return curve, lens


def recorded_moves(positions):
    """Split recorded [t,x,y] samples into (t0, t1, route) moves separated by rests."""
    pts = [(t, (x, y)) for t, x, y in positions]
    near = lambda a, b: math.dist(a, b) <= REST_PX
    rests = [0]
    for i in range(1, len(pts)):
        if i == len(pts) - 1 or near(pts[i][1], pts[i - 1][1]) or near(pts[i][1], pts[i + 1][1]):
            rests.append(i)
    moves = []
    for a, b in zip(rests, rests[1:]):
        route = [p for _, p in pts[a:b + 1]]
        dedup = [route[0]] + [p for i, p in enumerate(route[1:], 1) if not near(p, route[i - 1])]
        if len(dedup) >= 2:
            moves.append((pts[a][0], pts[b][0], dedup))
    return pts[0][1], moves


class Track:
    """A cursor that rests at start and then follows eased moves (t0, t1, curve, lens)."""

    def __init__(self, start, moves=()):
        self.start = tuple(start)
        self.moves = list(moves)
        self.end = tuple(self.moves[-1][2][-1]) if self.moves else self.start

    def at(self, t):
        pos = self.start
        for t0, t1, curve, lens in self.moves:
            if t < t0:
                return pos
            if t >= t1:
                pos = curve[-1]
                continue
            d = ease_cursor((t - t0) / max(t1 - t0, 1e-6)) * (lens[-1] or 1)
            i = max(0, min(len(lens) - 2, int(np.searchsorted(lens, d)) - 1))
            u = (d - lens[i]) / ((lens[i + 1] - lens[i]) or 1)
            return (lerp(curve[i][0], curve[i + 1][0], u), lerp(curve[i][1], curve[i + 1][1], u))
        return pos


class CursorPath(Track):
    """Recorded samples eased as whole moves, with their recorded timing."""

    def __init__(self, positions):
        start, moves = recorded_moves(positions)
        super().__init__(start, [(t0, t1, *make_curve(route)) for t0, t1, route in moves])


EARLY_ARRIVAL = 1.0  # a first move ending by this time is made during the previous hold
PARK = (1749, 964)  # where the Arc recorder parks the pointer at the start of each take


def humanize(start, positions, approach_window):
    """Rebuild one lane's recorded track at a human pace without moving any arrival later.

    Returns (track, approach): approach is a (from, to, duration) move to make during the
    previous feature's hold, so a quick opening move becomes an unhurried glide that
    lands before the feature starts. Later moves keep their departure time and slow
    their arrival, but never past the next move's departure."""
    first, moves = recorded_moves(positions)
    pos = tuple(start) if start is not None else tuple(first)
    approach = None
    if tuple(first) == PARK and moves and moves[0][1] <= EARLY_ARRIVAL:
        # The recorder parks the pointer off-window at t=0 and flicks it to the first
        # control; the real starting point is that control.
        first, moves = tuple(moves[0][2][-1]), moves[1:]
    elif tuple(first) == PARK:
        first = pos
    first = tuple(first)
    if math.dist(pos, first) > REST_PX:
        if approach_window > 0:
            approach = (pos, first, min(natural_duration(math.dist(pos, first)), approach_window))
        else:
            moves = [(0, natural_duration(math.dist(pos, first)), [pos, first])] + moves
    begin = first if approach else pos
    pos = begin
    out = []
    for k, (t0, t1, route) in enumerate(moves):
        route = [pos] + route[1:] if math.dist(pos, route[0]) > REST_PX else route
        curve, lens = make_curve(route)
        want = natural_duration(lens[-1])
        if k == 0 and not out and t0 <= 1e-6:
            t0 = max(0.0, t1 - want)  # opening move that ends late: arrive on time, leave later
        if out:
            t0 = max(t0, out[-1][1])
        limit = moves[k + 1][0] if k + 1 < len(moves) else math.inf
        t1 = max(t1, min(t0 + want, limit))
        out.append((t0, t1, curve, lens))
        pos = tuple(curve[-1])
    return Track(begin, out), approach


def cursor_sprite(scale):
    """Arrow cursor (macOS style; Windows colours on Windows), soft shadow. Returns RGBA and hotspot."""
    ss = 4
    shape = [(0, 0), (0, 16.5), (3.9, 12.9), (6.4, 18.6), (8.9, 17.5), (6.5, 11.9), (11.8, 11.9)]
    size = 1.45 * scale
    pad = 6
    w, h = int((13 * size + 2 * pad) * ss), int((21 * size + 2 * pad) * ss)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pts = [((x * size + pad) * ss, (y * size + pad) * ss) for x, y in shape]
    shadow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(shadow).polygon([(x + 1.2 * ss, y + 1.8 * ss) for x, y in pts], fill=110)
    shadow = shadow.filter(ImageFilter.GaussianBlur(1.6 * ss))
    img.paste((0, 0, 0, 255), (0, 0), shadow)
    d = ImageDraw.Draw(img)
    # Windows arrow: white fill, black outline (macOS: the reverse).
    edge, body = ((10, 10, 12, 255), (255, 255, 255, 255)) if WINDOWS else ((255, 255, 255, 255), (10, 10, 12, 255))
    d.polygon(pts, fill=edge, outline=edge, width=int((1.6 if WINDOWS else 2.6) * ss * size / 1.45))
    inner = [((x * size + pad) * ss, (y * size + pad) * ss) for x, y in
             [(1.25, 2.9), (1.25, 13.6), (4.3, 10.8), (6.95, 16.9), (7.9, 16.5), (5.3, 10.6), (9.1, 10.6)]]
    d.polygon(inner, fill=body)
    img = img.resize((w // ss, h // ss), Image.LANCZOS)
    return img, (pad, pad)


# ---------------------------------------------------------------- video io

class Reader:
    def __init__(self, source, start, count, width, height):
        self.size = (width, height)
        self.count = count
        self.index = -1
        self.image = None
        self.proc = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-ss", str(start), "-i", source, "-vf", f"fps={SRC_FPS}",
             "-frames:v", str(count), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            stdout=subprocess.PIPE)

    def get(self, i):
        i = min(i, self.count - 1)
        while self.index < i:
            raw = self.proc.stdout.read(self.size[0] * self.size[1] * 3)
            if len(raw) < self.size[0] * self.size[1] * 3:
                self.count = self.index + 1
                break
            self.index += 1
            self.image = Image.frombuffer("RGB", self.size, raw)
        return self.image

    def close(self):
        self.proc.stdout.close()
        self.proc.wait()


# ---------------------------------------------------------------- static art

def rounded_mask(w, h, r):
    ss = 4
    m = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), r * ss, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def panel_x(i):
    return PX0 + i * (PW + GUTTER)


def shadow_sprite():
    pad = 60
    s = Image.new("L", (PW + 2 * pad, PH + 2 * pad), 0)
    ImageDraw.Draw(s).rounded_rectangle((pad, pad + 14, pad + PW, pad + PH + 14), RADIUS, fill=150)
    return s.filter(ImageFilter.GaussianBlur(26)), pad


def ring_sprite(color, alpha, width):
    ss = 4
    pad = 6
    w, h = PW + 2 * pad, PH + 2 * pad
    img = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
    o = (pad - width / 2) * ss
    ImageDraw.Draw(img).rounded_rectangle((o, o, w * ss - o, h * ss - o), (RADIUS + width / 2) * ss,
                                          outline=color + (alpha,), width=int(width * ss))
    return img.resize((w, h), Image.LANCZOS), pad


def make_backdrop(wallpaper):
    img = Image.open(wallpaper).convert("RGB")
    scale = max(W / img.width, H / img.height)
    img = img.resize((math.ceil(img.width * scale), math.ceil(img.height * scale)), Image.LANCZOS)
    img = img.crop(((img.width - W) // 2, (img.height - H) // 2, (img.width - W) // 2 + W, (img.height - H) // 2 + H))
    img = img.filter(ImageFilter.GaussianBlur(70))
    a = np.asarray(img).astype(np.float32) / 255
    y = np.linspace(0, 1, H)[:, None, None]
    x = np.linspace(-1, 1, W)[None, :, None]
    vignette = 1 - .35 * (x ** 2) - .25 * (y - .45) ** 2
    a = a * .26 * vignette + np.array([12, 13, 20]) / 255 * .55
    return Image.fromarray((clamp_arr(a) * 255).astype(np.uint8))


def clamp_arr(a):
    return np.clip(a, 0, 1)


TEXT_RENDER = Path(__file__).resolve().parents[2] / (
    "artifacts/bin/text-render-win/text-render.exe" if WINDOWS else "artifacts/bin/text-render")
_text_cache = {}


def text_image(text, size, weight, color, tracking=0):
    """Text sprite drawn by Core Text (macOS's text engine), so SF Pro gets its
    real kerning, optical sizes and spacing. On Windows, DirectWrite draws
    Segoe UI Variable the same way (text-render-win). Falls back to Pillow."""
    key = (text, size, weight, tuple(color), tracking)
    if key in _text_cache:
        return _text_cache[key]
    if TEXT_RENDER.is_file():
        import hashlib
        import tempfile
        out = Path(tempfile.gettempdir()) / ("arc-text-" + hashlib.sha1(repr(key).encode()).hexdigest() + ".png")
        if not out.is_file():
            subprocess.run([str(TEXT_RENDER), str(out), str(size), weight, *map(str, color[:3]), str(tracking), text],
                           check=True)
        img = Image.open(out).convert("RGBA")
        img.load()
    else:
        f = font(size, weight)
        asc, desc = f.getmetrics()
        img = Image.new("RGBA", (int(f.getlength(text)) + 6, asc + desc + 4), (0, 0, 0, 0))
        ImageDraw.Draw(img).text((3, 2), text, font=f, fill=tuple(color))
    _text_cache[key] = img
    return img


def with_alpha(img, a):
    if a >= .999:
        return img
    out = img.copy()
    out.putalpha(img.getchannel("A").point(lambda v: int(v * a)))
    return out


def paste_rgba(frame, img, x, y, a=1.0):
    if a <= .001:
        return
    frame.paste(img if a >= .999 else with_alpha(img, a), (int(round(x)), int(round(y))),
                img if a >= .999 else with_alpha(img, a))


def pill(text, size=17, weight="Medium", color=TEXT, bg=(20, 22, 30), bg_alpha=200, pad=(14, 7), icon_w=0):
    t = text_image(text, size, weight, color)
    w, h = t.width + 2 * pad[0] + icon_w, t.height + 2 * pad[1] - 4
    ss = 4
    img = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), h * ss / 2, fill=bg + (bg_alpha,))
    img = img.resize((w, h), Image.LANCZOS)
    img.alpha_composite(t, (pad[0] + icon_w, pad[1] - 4))
    return img


# ---------------------------------------------------------------- status icons

def spinner(angle, color, size=16):
    ss = 4
    s = size * ss
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((ss, ss, s - ss, s - ss), outline=color + (60,), width=2 * ss)
    d.arc((ss, ss, s - ss, s - ss), angle, angle + 110, fill=color + (255,), width=2 * ss)
    return img.resize((size, size), Image.LANCZOS)


def check(scale, size=16):
    ss = 4
    s = size * ss
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((0, 0, s - 1, s - 1), fill=DONE + (255,))
    d.line([(s * .28, s * .52), (s * .44, s * .68), (s * .73, s * .35)], fill=(14, 40, 24, 255), width=int(2.2 * ss),
           joint="curve")
    img = img.resize((size, size), Image.LANCZOS)
    if abs(scale - 1) > .01:
        n = max(1, int(size * scale))
        big = img.resize((n, n), Image.LANCZOS)
        img = Image.new("RGBA", (max(n, size), max(n, size)), (0, 0, 0, 0))
        img.alpha_composite(big, ((img.width - n) // 2, (img.height - n) // 2))
    return img


def dash(size=16):
    ss = 4
    s = size * ss
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((0, 0, s - 1, s - 1), fill=MUTED + (90,))
    d.line([(s * .3, s * .5), (s * .7, s * .5)], fill=TEXT + (230,), width=int(2.2 * ss))
    return img.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------- renderer

class Renderer:
    def __init__(self, plan, root):
        self.plan = plan
        self.backdrop = make_backdrop(root / "assets" / "wallpaper.jpg")
        self.mask = rounded_mask(PW, PH, RADIUS)
        self.shadow, self.shadow_pad = shadow_sprite()
        self.ring = ring_sprite((255, 255, 255), 34, 1.2)
        self.ring_accent = ring_sprite(ACCENT, 150, 2.0)
        self.static = self.backdrop.copy()
        for i in range(3):
            self.static.paste((0, 0, 0), (panel_x(i) - self.shadow_pad, PY - self.shadow_pad), self.shadow)
        self.chapter_of = {}
        for ci, (name, ids) in enumerate(CHAPTERS):
            for sid in ids:
                self.chapter_of[sid] = ci
        self.labels = {}
        for lane in LANES:
            color = ACCENT if lane == "themed" else TEXT
            self.labels[lane] = pill(LABELS[lane], 18, "Semibold", color, icon_w=24, bg_alpha=170)
        self.cursor_cache = {}
        self.prev_panels = None
        self.prev_title = None
        plan_cursors(plan)

    # -- pieces
    def cursor(self, scale):
        key = round(scale, 2)
        if key not in self.cursor_cache:
            self.cursor_cache[key] = cursor_sprite(key)
        return self.cursor_cache[key]

    def title_art(self, shot, index, total):
        ci = self.chapter_of.get(shot["id"])
        chapter = CHAPTERS[ci][0].upper() if ci is not None else ""
        eyebrow = text_image(f"{chapter}   {index + 1:02d} / {total}", 15, "Semibold", ACCENT, tracking=2.2)
        size = 42
        while font(size, "Semibold").getlength(shot["title"]) > 1500 and size > 24:
            size -= 1
        title = text_image(shot["title"], size, "Semibold", TEXT)
        return eyebrow, title

    def draw_progress(self, frame, shot_index, progress):
        d = ImageDraw.Draw(frame, "RGBA")
        shots = self.plan["shots"]
        n = len(shots)
        y, h = 1054, 4
        chapter_gap, gap = 14, 3
        groups = [self.chapter_of.get(s["id"], -1) for s in shots]
        breaks = sum(1 for a, b in zip(groups, groups[1:]) if a != b)
        usable = 3 * PW + 2 * GUTTER - breaks * chapter_gap - (n - 1 - breaks) * gap
        seg = usable / n
        x = PX0
        for i in range(n):
            if i:
                x += chapter_gap if groups[i] != groups[i - 1] else gap
            d.rounded_rectangle((x, y, x + seg, y + h), 2, fill=(255, 255, 255, 38))
            fill = 1 if i < shot_index else progress if i == shot_index else 0
            if fill > 0:
                color = ACCENT + (235,) if i == shot_index else (255, 255, 255, 150)
                d.rounded_rectangle((x, y, x + max(seg * fill, h), y + h), 2, fill=color)
            x += seg

    def lane_panel(self, ctx, lane, t):
        """Rendered 588x882 panel for lane at playback time t (seconds since play start)."""
        p = ctx["panels"][lane]
        last = (p["ready_frames"] - 1) / SRC_FPS
        clock = source_time(p, clamp(t, 0, last))
        idx = min(int(math.floor(clock * SRC_FPS + 1e-6)), p["src_frames"] - 1)
        rect = camera_at(ctx["cams"][lane], clock)
        zoom = p.get("zoom_out", 1)
        if zoom != 1:  # widen the view around the camera centre; letterbox the rest
            cx, cy = rect[0] + rect[2] / 2, rect[1] + rect[3] / 2
            rect = [cx - rect[2] * zoom / 2, cy - rect[3] * zoom / 2, rect[2] * zoom, rect[3] * zoom]
        key = (idx, tuple(round(v, 2) for v in rect))
        cursor = ctx["shot"]["_cursor"].get(lane)
        cpos = cursor.at(clock) if cursor else None
        approach = ctx["shot"]["_approach"].get(lane)
        if approach:
            (ax, ay), (bx, by), dur = approach
            begin = ctx["play_end"] - dur
            if t > begin:
                u = ease_cursor((t - begin) / dur)
                cpos = (lerp(ax, bx, u), lerp(ay, by, u))
        if cpos:
            key += (round(cpos[0], 1), round(cpos[1], 1))
        cache = ctx["cache"]
        if cache.get(lane, (None,))[0] == key:
            return cache[lane][1]
        src = ctx["readers"][lane].get(idx)
        x, y, w, h = rect
        if x < 0 or y < 0 or x + w > src.width or y + h > src.height:
            scale = PW / w
            panel = Image.new("RGB", (PW, PH), LETTERBOX)
            bx0, by0 = max(x, 0), max(y, 0)
            bx1, by1 = min(x + w, src.width), min(y + h, src.height)
            part = src.resize((max(1, round((bx1 - bx0) * scale)), max(1, round((by1 - by0) * scale))),
                              Image.BICUBIC, box=(bx0, by0, bx1, by1), reducing_gap=2.0)
            panel.paste(part, (round((bx0 - x) * scale), round((by0 - y) * scale)))
        else:
            panel = src.resize((PW, PH), Image.BICUBIC, box=(x, y, x + w, y + h), reducing_gap=2.0)
        if cpos:
            scale = PW / w
            sprite, (hx, hy) = self.cursor(scale)
            cx, cy = (cpos[0] - x) * scale - hx, (cpos[1] - y) * scale - hy
            panel.paste(sprite, (int(round(cx)), int(round(cy))), sprite)
        cache[lane] = (key, panel)
        return panel

    def open_shot(self, shot):
        readers, cams = {}, {}
        for lane in LANES:
            p = shot["panels"][lane]
            readers[lane] = Reader(p["source"], p["start"], p["src_frames"], p["width"], p["height"])
            cams[lane] = [(k["time"], k["rect"]) for k in p["camera"]]
        return dict(shot=shot, panels=shot["panels"], readers=readers, cams=cams, cache={})

    def shot_frames(self, shot, index, emit):
        total_shots = len(self.plan["shots"])
        first = index == 0
        lead, action, hold = timing(shot, index, total_shots)
        ready = {lane: shot["panels"][lane]["ready_frames"] / SRC_FPS for lane in LANES}
        count = lead + action + hold
        ctx = self.open_shot(shot)
        ctx["play_end"] = (action + hold) / FPS
        eyebrow, title = self.title_art(shot, index, total_shots)
        status = {lane: shot["panels"][lane].get("availability", "native") for lane in LANES}
        captions = {}
        for lane in LANES:
            cap = shot["panels"][lane].get("caption", "")
            if status[lane] == "unavailable":
                captions[lane] = pill(cap or "No native equivalent", 19, "Medium", TEXT, bg_alpha=215, pad=(18, 10))
            elif cap:
                captions[lane] = pill(cap, 15, "Medium", AMBER, bg_alpha=200)
        panels = {}
        for f in range(count):
            t = (f - lead) / FPS
            frame = (self.backdrop if first else self.static).copy()
            # titles
            if self.prev_title and f < 14:
                u = ease_io(f / 14)
                pe, pt = self.prev_title
                paste_rgba(frame, pe, (W - pe.width) / 2, 22 - 8 * u, 1 - u)
                paste_rgba(frame, pt, (W - pt.width) / 2, 44 - 10 * u, 1 - u)
            ue = ease_out((f - (6 if self.prev_title else 0)) / 22)
            paste_rgba(frame, eyebrow, (W - eyebrow.width) / 2, 22 + 10 * (1 - ue), ue)
            ut = ease_out((f - (9 if self.prev_title else 4)) / 24)
            paste_rgba(frame, title, (W - title.width) / 2, 44 + 14 * (1 - ut), ut)

            for i, lane in enumerate(LANES):
                panel = self.lane_panel(ctx, lane, t)
                done_at = ready[lane]
                dim = 0.0
                if status[lane] == "unavailable":
                    dim = UNAVAILABLE_DIM
                if dim > .003:
                    panel = Image.fromarray((np.asarray(panel, dtype=np.float32) * (1 - dim)).astype(np.uint8))
                if lane in captions:
                    panel = panel.copy()
                    c = captions[lane]
                    if status[lane] == "unavailable":
                        panel.paste(c, ((PW - c.width) // 2, (PH - c.height) // 2), c)
                    else:
                        panel.paste(c, ((PW - c.width) // 2, PH - c.height - 18), c)
                # transitions
                local = f - i * STAGGER
                alpha, dy = 1.0, 0.0
                if first:
                    u = ease_out(local / 30)
                    alpha, dy = u, 40 * (1 - u)
                panels[lane] = panel
                self.composite_panel(frame, i, lane, panel, alpha, dy, first)
                # lane label + status
                lab = self.labels[lane]
                lx, ly = panel_x(i) + (PW - lab.width) / 2, 110 + dy * .5
                paste_rgba(frame, lab, lx, ly, alpha)
                if status[lane] == "unavailable":
                    icon = dash()
                elif t >= done_at - 1e-6:
                    icon = check(ease_back((t - done_at) / .28) if t - done_at < .28 else 1.0)
                else:
                    icon = spinner((f * 9) % 360, ACCENT if lane == "themed" else TEXT)
                iy = ly + (lab.height - 16) / 2
                paste_rgba(frame, icon, lx + 13 - (icon.width - 16) / 2, iy - (icon.height - 16) / 2, alpha)
            progress = clamp(f / max(count - 1, 1))
            self.draw_progress(frame, index, progress)
            emit(frame)
        for r in ctx["readers"].values():
            r.close()
        self.prev_panels = panels
        self.prev_title = (eyebrow, title)

    def composite_panel(self, frame, i, lane, panel, alpha, dy, animated):
        x, y = panel_x(i), int(round(PY + dy))
        if animated:
            if alpha > .001:
                frame.paste((0, 0, 0), (x - self.shadow_pad, y - self.shadow_pad),
                            self.shadow.point(lambda v: int(v * alpha)))
        mask = self.mask if alpha >= .999 else self.mask.point(lambda v: int(v * alpha))
        frame.paste(panel, (x, y), mask)
        ring, pad = self.ring_accent if lane == "themed" else self.ring
        paste_rgba(frame, ring, x - pad, y - pad, alpha)

    def intro(self, emit):
        n = round(INTRO * FPS)
        big = text_image("Arc UI for Zen", 92, "Bold", TEXT)
        sub = text_image(SUBTITLE, 28, "Regular", MUTED)
        lanes = [self.labels[l] for l in LANES]
        for f in range(n):
            frame = self.backdrop.copy()
            out = ease_io((f - (n - 22)) / 22)
            u1 = ease_out(f / 30)
            paste_rgba(frame, big, (W - big.width) / 2, 410 + 24 * (1 - u1) - 30 * out, u1 * (1 - out))
            u2 = ease_out((f - 10) / 30)
            paste_rgba(frame, sub, (W - sub.width) / 2, 530 + 18 * (1 - u2) - 30 * out, u2 * (1 - out))
            total = sum(l.width for l in lanes) + 2 * 18
            x = (W - total) / 2
            for k, lab in enumerate(lanes):
                u = ease_out((f - 22 - 6 * k) / 26)
                paste_rgba(frame, lab, x, 600 + 14 * (1 - u) - 30 * out, u * (1 - out))
                icon = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
                ImageDraw.Draw(icon).ellipse((4, 4, 12, 12), fill=(ACCENT if LANES[k] == "themed" else TEXT) + (255,))
                paste_rgba(frame, icon, x + 13, 600 + 14 * (1 - u) - 30 * out + (lab.height - 16) / 2, u * (1 - out))
                x += lab.width + 18
            emit(frame)

    def bento(self, emit, last_frame, data):
        """Closing page: an Apple-style bento grid of features not shown above."""
        BG, CARD, INK, SUB = (245, 245, 247), (255, 255, 255), (29, 29, 31), (110, 110, 115)
        G0, G1 = (167, 139, 250), (124, 58, 237)
        cols, rows, mx, my, gap = 6, 4, 56, 48, 18
        cw = (W - 2 * mx - (cols - 1) * gap) / cols
        ch = (H - 2 * my - (rows - 1) * gap) / rows
        page = Image.new("RGB", (W, H), BG)
        cards = []
        for i, tile in enumerate(data["tiles"]):
            c, r, sc, sr = tile["at"]
            x0, y0 = mx + c * (cw + gap), my + r * (ch + gap)
            w, h = int(sc * cw + (sc - 1) * gap), int(sr * ch + (sr - 1) * gap)
            card = Image.new("RGBA", (w, h), CARD + (255,))
            pad = 26
            if tile.get("image"):
                img = Image.open(tile["image"]).convert("RGB")
                if tile.get("crop"):
                    img = img.crop(tile["crop"])
                cap_h = 64 if tile.get("caption") else 0
                box_w, box_h = w - 2 * pad, h - 2 * pad - cap_h
                scale = min(box_w / img.width, box_h / img.height)
                img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
                shot = Image.new("RGBA", img.size, (0, 0, 0, 0))
                if tile.get("transparent"):
                    # A capture over a plain white page: key the page out so
                    # only the feature itself sits on the card.
                    a = 255 - np.asarray(img.convert("L")).astype(np.int16)
                    alpha = Image.fromarray(np.clip(a * 4, 0, 255).astype(np.uint8))
                    shot.paste(img, (0, 0), alpha)
                else:
                    shot.paste(img, (0, 0), rounded_mask(img.width, img.height, 14))
                card.alpha_composite(shot, ((w - img.width) // 2, pad + (box_h - img.height) // 2))
                if tile.get("caption"):
                    for k, line in enumerate(wrap(tile["caption"], 22, "Semibold", w - 2 * pad)[:2]):
                        t = text_image(line, 22, "Semibold", INK)
                        card.alpha_composite(t, ((w - t.width) // 2, h - pad - cap_h + 6 + k * 28))
            else:
                parts = []
                if tile.get("eyebrow"):
                    parts.append(text_image(tile["eyebrow"], 20, "Medium", INK))
                size = tile.get("size", 64)
                for line in tile["big"].split("\n"):
                    while font(size, "Bold").getlength(line) > w - 2 * pad and size > 24:
                        size -= 2
                for line in tile["big"].split("\n"):
                    parts.append(gradient_text(line, size, "Bold", G0, G1))
                for line in wrap(tile.get("text", ""), 21, "Medium", w - 2 * pad):
                    parts.append(text_image(line, 21, "Medium", SUB))
                total = sum(p.height for p in parts) + 4 * (len(parts) - 1)
                y = (h - total) // 2
                for part in parts:
                    card.alpha_composite(part, ((w - part.width) // 2, y))
                    y += part.height + 4
            mask = rounded_mask(w, h, 26)
            cards.append((card, mask, int(x0), int(y0)))
        n = round(BENTO_SECONDS * FPS)
        order = sorted(range(len(cards)), key=lambda k: (cards[k][3] + cards[k][2] * .35))
        for f in range(n):
            u = ease_io(f / 22)
            frame = Image.blend(last_frame, page, u) if u < 1 else page.copy()
            for rank, k in enumerate(order):
                card, mask, x0, y0 = cards[k]
                a = ease_out((f - 10 - rank * 3) / 24)
                if a <= 0:
                    continue
                sc = .94 + .06 * a
                cw2, ch2 = int(card.width * sc), int(card.height * sc)
                img = card.resize((cw2, ch2), Image.BILINEAR) if sc < .999 else card
                m2 = mask.resize((cw2, ch2), Image.BILINEAR) if sc < .999 else mask
                m2 = m2.point(lambda v, a=a: int(v * a))
                frame.paste(img.convert("RGB"), (x0 + (card.width - cw2) // 2, y0 + (card.height - ch2) // 2), m2)
            emit(frame)

    def outro(self, emit, last_frame):
        n = round(OUTRO * FPS)
        big = text_image("Arc UI for Zen", 84, "Bold", TEXT)
        sub = text_image("github.com/SpyC0der77/arc-ui-for-zen", 28, "Medium", ACCENT)
        for f in range(n):
            u = ease_io(f / 24)
            frame = Image.blend(last_frame, self.backdrop, u) if u < 1 else self.backdrop.copy()
            u1 = ease_out((f - 16) / 30)
            paste_rgba(frame, big, (W - big.width) / 2, 430 + 24 * (1 - u1), u1)
            u2 = ease_out((f - 26) / 30)
            paste_rgba(frame, sub, (W - sub.width) / 2, 545 + 18 * (1 - u2), u2)
            fade = ease_io((f - (n - 30)) / 30)
            if fade > 0:
                frame = Image.blend(frame, Image.new("RGB", (W, H), (0, 0, 0)), fade)
            emit(frame)


def extra_bento(root, path=None):
    """Tiles for the closing Apple-style bento page (timeline/bento.json)."""
    path = Path(path) if path else root / "timeline" / "bento.json"
    if not path.is_file():
        return None
    data = json.loads(path.read_text())
    for tile in data["tiles"]:
        if tile.get("image"):
            tile["image"] = str((root / tile["image"]).resolve())
    return data


def gradient_text(text, size, weight, c0, c1):
    """Text filled with a left-to-right gradient, like Apple's spec tiles."""
    mask = text_image(text, size, weight, (255, 255, 255)).getchannel("A")
    w, h = mask.size
    ramp = np.linspace(0, 1, w)[None, :, None]
    fill = (np.array(c0)[None, None, :] * (1 - ramp) + np.array(c1)[None, None, :] * ramp)
    img = Image.fromarray(np.repeat(fill, h, axis=0).astype(np.uint8), "RGB").convert("RGBA")
    img.putalpha(mask)
    return img


def wrap(text, size, weight, width):
    words, lines, line = text.split(), [], ""
    for word in words:
        trial = (line + " " + word).strip()
        if font(size, weight).getlength(trial) > width and line:
            lines.append(line)
            line = word
        else:
            line = trial
    return lines + ([line] if line else [])


def source_time(p, t):
    """Map a lane's playback time to source time through its holds.

    holds: [[source_seconds, hold_seconds], ...] freeze the footage at that
    source moment, so every lane reaches a shared action at the same instant."""
    for at, hold in p.get("holds", []):
        if t <= at:
            return t
        if t <= at + hold:
            return at
        t -= hold
    return t


def timing(shot, index, total):
    """(lead, action, hold) frame counts for a feature."""
    lead = round((LEAD_FIRST if index == 0 else LEAD) * FPS)
    action = math.ceil(max(p["ready_frames"] for p in shot["panels"].values()) / SRC_FPS * FPS)
    hold = round((HOLD_LAST if index == total - 1 else HOLD) * FPS)
    return lead, action, hold


def plan_cursors(plan):
    """Attach a humanized cursor Track per lane to every shot, and the glide each lane
    makes during a shot's hold toward the next shot's first control."""
    shots = plan["shots"]
    current = {lane: None for lane in LANES}
    for k, shot in enumerate(shots):
        shot["_cursor"] = {}
        shot.setdefault("_approach", {})
        window = (timing(shots[k - 1], k - 1, len(shots))[2] / FPS - .15) if k else 0
        for lane in LANES:
            cursor = shot["panels"][lane].get("cursor")
            if not cursor:
                current[lane] = None
                continue
            if cursor.get("positions") is None:  # authored rest: stay where it is
                if current[lane] is not None:
                    shot["_cursor"][lane] = Track(current[lane])
                continue
            can_glide = k > 0 and current[lane] is not None
            if cursor.get("recorded"):
                # Real-time takes: the glides were made at a human pace and are
                # synced across lanes, so keep their recorded timing exactly.
                track, approach = CursorPath(cursor["positions"]), None
            else:
                track, approach = humanize(current[lane], cursor["positions"], window if can_glide else 0)
            if approach:
                shots[k - 1].setdefault("_approach", {})[lane] = approach
            shot["_cursor"][lane] = track
            current[lane] = track.end


def add_scripted_cursor(plan, path, lane="zen"):
    """Give a cursor-less lane an authored track: listed shots move, unlisted shots rest."""
    path = Path(path)
    if not path.is_file():
        return
    table = json.loads(path.read_text())["shots"]
    for shot in plan["shots"]:
        p = shot["panels"][lane]
        if p.get("cursor"):
            continue
        positions = table.get(shot["id"])
        if positions is not None:
            last = -1
            for point in positions:
                if len(point) != 3 or point[0] <= last:
                    raise ValueError(f"{shot['id']}/{lane}: scripted cursor points must be increasing [t,x,y]")
                last = point[0]
        p["cursor"] = {"positions": positions, "approach": True}


def apply_cut(plan, path):
    """Keep only the features a cut lists, in its order, with optional title overrides."""
    cut = json.loads(Path(path).read_text())["shots"]
    by_id = {s["id"]: s for s in plan["shots"]}
    missing = [c["id"] for c in cut if c["id"] not in by_id]
    if missing:
        raise ValueError(f"Cut lists unknown features: {missing}")
    shots = []
    for c in cut:
        shot = dict(by_id[c["id"]], title=c.get("title", by_id[c["id"]]["title"]))
        shot["panels"] = {lane: dict(p) for lane, p in shot["panels"].items()}
        for lane, (x, y, w) in c.get("camera", {}).items():
            p = shot["panels"][lane]
            h = w * PH / PW
            if x < 0 or y < 0 or x + w > p["width"] or y + h > p["height"]:
                raise ValueError(f"{c['id']}/{lane}: cut camera exceeds the source frame")
            p["camera"] = [{"time": 0, "rect": [x, y, w, h]}]
        shots.append(shot)
    plan["shots"] = shots


def render(manifest, output, shots=None, intro=True, outro=True, crf=16, preset="medium", zen_cursor=None,
           cut=None, bento_path=None):
    plan = load_plan(manifest, require_assets=True)
    raw = json.loads(Path(manifest).read_text())["shots"]
    extra = {s["id"]: s for s in raw}
    for shot in plan["shots"]:
        for lane, p in shot["panels"].items():
            src = extra[shot["id"]]["panels"][lane]
            for key in ("holds", "zoom_out"):
                if key in src:
                    p[key] = src[key]
            held = sum(h for _, h in p.get("holds", []))
            p["src_frames"] = max(1, math.ceil(p["ready"] * SRC_FPS - 1e-8))
            p["ready_frames"] = max(1, math.ceil((p["ready"] + held) * SRC_FPS - 1e-8))
    bento = extra_bento(root := Path(__file__).resolve().parent.parent, bento_path)
    add_scripted_cursor(plan, zen_cursor if zen_cursor is not None else root / "timeline" / "zen-cursor.json")
    if cut:
        apply_cut(plan, cut)
    if shots:
        plan["shots"] = plan["shots"][shots[0]:shots[1]]
    renderer = Renderer(plan, root)
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    enc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
         "-i", "-", "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p",
         "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
         "-movflags", "+faststart", str(output)], stdin=subprocess.PIPE)
    state = {"n": 0, "last": None}

    def emit(frame):
        enc.stdin.write(frame.tobytes())
        state["n"] += 1
        state["last"] = frame
        if state["n"] % 600 == 0:
            print(f"  {state['n'] / FPS:6.1f}s rendered", flush=True)

    if intro:
        renderer.intro(emit)
    for i, shot in enumerate(plan["shots"]):
        renderer.shot_frames(shot, i, emit)
    if outro:
        if bento:
            renderer.bento(emit, state["last"], bento)
        renderer.outro(emit, state["last"])
    enc.stdin.close()
    if enc.wait():
        raise RuntimeError("ffmpeg encode failed")
    return output, state["n"]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, default=Path("demo-video/exports/arc-zen-comparison-polished.mp4"))
    parser.add_argument("--cut", default="highlights",
                        help="'highlights' (timeline/highlights.json), 'full' for all features, or a cut JSON path")
    parser.add_argument("--shots", help="Render a slice of shots, e.g. 0:4 (for previews)")
    parser.add_argument("--no-intro", action="store_true")
    parser.add_argument("--no-outro", action="store_true")
    parser.add_argument("--preset", default="medium")
    parser.add_argument("--crf", type=int, default=16, help="x264 quality (lower is better; default 16)")
    parser.add_argument("--label", action="append", default=[], metavar="LANE=TEXT",
                        help='Lane label override, e.g. --label "arc=Arc (macOS)"')
    parser.add_argument("--subtitle", help="Intro subtitle override")
    parser.add_argument("--bento", type=Path, help="Bento board JSON (default timeline/bento.json), "
                        "e.g. demo-video/timeline/bento-windows.json")
    args = parser.parse_args()
    shots = tuple(int(v) for v in args.shots.split(":")) if args.shots else None
    global SUBTITLE
    for item in args.label:
        lane, _, text = item.partition("=")
        if lane not in LABELS or not text:
            parser.error(f"--label expects LANE=TEXT with LANE in {sorted(LABELS)}")
        LABELS[lane] = text
    if args.subtitle:
        SUBTITLE = args.subtitle
    cut = None if args.cut == "full" else (Path(__file__).resolve().parent.parent / "timeline" / "highlights.json"
                                           if args.cut == "highlights" else Path(args.cut))
    out, n = render(args.manifest, args.output, shots, not args.no_intro, not args.no_outro, preset=args.preset, cut=cut, crf=args.crf,
                    bento_path=args.bento)
    print(f"{out}  {n} frames, {n / FPS:.2f}s")


if __name__ == "__main__":
    main()
