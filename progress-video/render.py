#!/usr/bin/env python3
"""
人类进步 · 未来三十年推演 —— 一部完全由代码生成的短片。

没有任何外部素材：画面由 numpy + Pillow 逐帧绘制，配乐由 numpy 合成，
最后通过 ffmpeg 编码为 MP4。

用法:
    python3 render.py                 # 渲染完整视频到 out/human_progress_2055.mp4
    python3 render.py --preview       # 只输出若干关键帧 PNG 到 out/preview/，用于快速检查
    python3 render.py --quick         # 低分辨率 / 低帧率快速渲染

依赖: pip install numpy pillow ；系统需有 ffmpeg 与中文字体 (wqy-microhei 或 DroidSansFallback)。
"""
import math
import os
import subprocess
import sys
import wave
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# --------------------------------------------------------------------------- 基本配置
QUICK = "--quick" in sys.argv
S = 1 if QUICK else 2            # 超采样倍数(抗锯齿)
BW, BH = 1280, 720               # 逻辑画布尺寸
W, H = BW * S, BH * S
FPS = 15 if QUICK else 30
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")

BG = (9, 12, 22)
WHITE = (236, 240, 248)
GREY = (140, 150, 175)
DIM = (70, 80, 105)
AMBER = (245, 183, 90)
CYAN = (86, 214, 232)
ROSE = (236, 110, 160)
VIOLET = (165, 135, 250)
GREEN = (110, 220, 150)

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]
MONO_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def _first_existing(paths):
    for p in paths:
        if os.path.exists(p):
            return p
    raise SystemExit("找不到可用字体: %r" % (paths,))


CJK_FONT = _first_existing(FONT_CANDIDATES)
MONO_FONT = _first_existing(MONO_CANDIDATES)
_fonts = {}


def font(size, mono=False):
    key = (size, mono)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(MONO_FONT if mono else CJK_FONT, int(size * S))
    return _fonts[key]


# --------------------------------------------------------------------------- 小工具
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smooth(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


def ease_out(t):
    t = clamp(t)
    return 1 - (1 - t) ** 3


def mix(c1, c2, a):
    a = clamp(a)
    return tuple(int(round(c1[i] * (1 - a) + c2[i] * a)) for i in range(3))


def alpha(color, a):
    """在深色背景上模拟透明度。"""
    return mix(BG, color, a)


class Canvas:
    """ImageDraw 的薄封装：所有坐标按逻辑尺寸书写，内部自动乘以超采样倍数。"""

    def __init__(self, img):
        self.d = ImageDraw.Draw(img)

    @staticmethod
    def _sc(xy):
        if isinstance(xy[0], (int, float)):
            return [v * S for v in xy]
        return [(x * S, y * S) for x, y in xy]

    def line(self, pts, fill, width=1):
        self.d.line(self._sc(pts), fill=fill, width=max(1, int(round(width * S))), joint="curve")

    def dashed(self, p0, p1, fill, dash=6, gap=5, width=1):
        x0, y0 = p0
        x1, y1 = p1
        length = math.hypot(x1 - x0, y1 - y0)
        if length == 0:
            return
        ux, uy = (x1 - x0) / length, (y1 - y0) / length
        pos = 0.0
        while pos < length:
            e = min(length, pos + dash)
            self.line([(x0 + ux * pos, y0 + uy * pos), (x0 + ux * e, y0 + uy * e)], fill, width)
            pos += dash + gap

    def rect(self, box, fill=None, outline=None, width=1):
        self.d.rectangle(self._sc(box), fill=fill, outline=outline, width=int(width * S))

    def rrect(self, box, radius, fill=None, outline=None, width=1):
        self.d.rounded_rectangle(self._sc(box), radius=radius * S, fill=fill, outline=outline, width=int(width * S))

    def ellipse(self, cx, cy, r, fill=None, outline=None, width=1):
        self.d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=fill, outline=outline, width=int(width * S))

    def arc(self, cx, cy, r, start, end, fill, width=1):
        self.d.arc([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], start, end, fill=fill, width=max(1, int(width * S)))

    def poly(self, pts, fill):
        self.d.polygon(self._sc(pts), fill=fill)

    def text(self, xy, s, f, fill, anchor="la"):
        self.d.text((xy[0] * S, xy[1] * S), s, font=f, fill=fill, anchor=anchor)

    def mtext(self, xy, s, size, fill, anchor="la"):
        """数字用西文粗体、汉字用中文字体混排(西文字体不含 CJK 字形)。"""
        runs, cur, ascii_run = [], "", True
        for ch in s:
            is_ascii = ord(ch) < 128
            if cur and is_ascii != ascii_run:
                runs.append((cur, ascii_run))
                cur = ""
            cur += ch
            ascii_run = is_ascii
        if cur:
            runs.append((cur, ascii_run))
        fonts = [font(size, mono=a) for _, a in runs]
        widths = [f.getlength(r) for (r, _), f in zip(runs, fonts)]
        total = sum(widths)
        x = xy[0] * S
        if anchor[0] == "m":
            x -= total / 2
        elif anchor[0] == "r":
            x -= total
        for (r, _), f, w in zip(runs, fonts, widths):
            self.d.text((x, xy[1] * S), r, font=f, fill=fill, anchor="l" + anchor[1])
            x += w

    def points(self, pts, fill):
        """以小方块绘制大量小点(建筑窗灯)。"""
        flat = []
        k = S + 1
        for x, y in pts:
            px, py = int(x * S), int(y * S)
            flat += [(px + i, py + j) for i in range(k) for j in range(k)]
        if flat:
            self.d.point(flat, fill=fill)


def text_width(s, f):
    return f.getlength(s) / S


# --------------------------------------------------------------------------- 数据(近似真实值)
class Series:
    def __init__(self, name, x, y, rng, color, fmt, band=0.0):
        self.name, self.x, self.y, self.rng, self.color, self.fmt, self.band = name, x, y, rng, color, fmt, band

    def at(self, year):
        return float(np.interp(year, self.x, self.y))


pct = lambda v: f"{v:.0f}%"
pct1 = lambda v: f"{v:.1f}%"
age = lambda v: f"{v:.1f} 岁"
pop = lambda v: f"{v * 10:.0f} 亿"

PAST_SERIES = [
    Series("预期寿命", [1800, 1850, 1900, 1950, 1970, 1990, 2000, 2010, 2019, 2025],
           [29, 29.5, 32, 46, 58, 64, 66.5, 70, 72.8, 73.5], (20, 90), AMBER, age),
    Series("识字率", [1800, 1850, 1900, 1950, 1970, 1990, 2000, 2010, 2020, 2025],
           [12, 19, 21, 36, 56, 74, 81, 84, 87, 87.5], (0, 100), CYAN, pct),
    Series("极端贫困", [1800, 1850, 1900, 1950, 1970, 1990, 2000, 2010, 2019, 2025],
           [79, 75, 66, 55, 47, 38, 29, 16, 8.5, 8.5], (0, 100), ROSE, pct1),
    Series("儿童死亡率", [1800, 1900, 1950, 1970, 1990, 2010, 2025],
           [43, 36, 22, 14, 9.3, 5.2, 3.7], (0, 50), VIOLET, pct1),
    Series("世界人口", [1800, 1850, 1900, 1950, 1970, 1990, 2000, 2010, 2020, 2025],
           [1.0, 1.26, 1.65, 2.5, 3.7, 5.3, 6.1, 6.9, 7.8, 8.2], (0, 10), GREEN, pop),
]

FUTURE_SERIES = [
    Series("预期寿命", [2025, 2030, 2040, 2050, 2055], [73.5, 74.6, 76.3, 77.6, 78.2], (70, 82), AMBER, age, band=2.5),
    Series("可再生能源发电占比", [2025, 2030, 2040, 2050, 2055], [33, 48, 66, 80, 85], (0, 100), CYAN, pct, band=14),
    Series("极端贫困", [2025, 2030, 2040, 2050, 2055], [8.5, 6.5, 4.2, 2.8, 2.2], (0, 12), ROSE, pct1, band=2.2),
    Series("AI 有效算力 (log10)", [2025, 2030, 2040, 2050, 2055], [0, 2.5, 5.5, 8, 9], (0, 10), VIOLET,
           lambda v: f"×10^{v:.1f}", band=2.4),
    Series("世界人口", [2025, 2030, 2040, 2050, 2055], [8.2, 8.5, 9.2, 9.7, 9.8], (7, 11), GREEN, pop, band=0.6),
]

PAST_EVENTS = [
    (1804, "蒸汽机车", "工业革命加速，距离开始缩短"),
    (1879, "白炽灯", "夜晚被点亮，一天变得更长"),
    (1928, "青霉素", "抗生素时代：感染不再等于死亡"),
    (1947, "晶体管", "信息时代的基石被发明"),
    (1969, "阿波罗登月", "人类首次踏上另一个天体"),
    (1991, "万维网", "知识开始全球互联"),
    (2003, "人类基因组", "读懂生命的源代码"),
    (2012, "深度学习", "机器开始“看见”"),
    (2020, "mRNA 疫苗", "一年之内研发并全球部署"),
    (2022, "大语言模型", "机器开始“对话”与“推理”"),
]

FUTURE_EVENTS = [
    (2027, "AI 科研协作者", "AI 成为实验室的常规成员"),
    (2030, "可再生能源过半", "全球电力结构的转折点"),
    (2033, "示范聚变电站", "首次向电网稳定供电"),
    (2036, "月球常驻基地", "人类在地球之外长期生活"),
    (2039, "载人登陆火星", "成为多行星物种的第一步"),
    (2042, "基因疗法普及", "多数罕见病可被治愈"),
    (2046, "脑机接口医疗化", "失语与瘫痪患者重获交流"),
    (2050, "主要经济体碳中和", "排放曲线终于走向零"),
    (2054, "人口接近峰值", "约 98 亿，随后趋于平稳"),
]

# --------------------------------------------------------------------------- 时间线
SCENES = [("intro", 7.0), ("past", 34.0), ("bridge", 5.0), ("future", 48.0), ("outro", 10.0)]
TOTAL = sum(d for _, d in SCENES)
PAST_DUR = dict(SCENES)["past"]
FUT_DUR = dict(SCENES)["future"]


def scene_at(t):
    acc = 0.0
    for name, dur in SCENES:
        if t < acc + dur:
            return name, t - acc, dur
        acc += dur
    return SCENES[-1][0], SCENES[-1][1], SCENES[-1][1]


def scene_start(name):
    acc = 0.0
    for n, d in SCENES:
        if n == name:
            return acc
        acc += d
    return 0.0


def past_year(tl):
    return 1800 + 225 * clamp((tl - 1.0) / (PAST_DUR - 4.5))


def past_tl_of_year(y):
    return 1.0 + (y - 1800) / 225 * (PAST_DUR - 4.5)


def future_year(tl):
    return 2025 + 30 * clamp((tl - 1.0) / (FUT_DUR - 5.0))


def future_tl_of_year(y):
    return 1.0 + (y - 2025) / 30 * (FUT_DUR - 5.0)


def skyline_progress(year):
    if year <= 2025:
        return (year - 1800) / 225 * 0.68
    return 0.68 + (year - 2025) / 30 * 0.32


# --------------------------------------------------------------------------- 背景 / 星空 / 城市
def _build_base():
    yy = np.linspace(0, 1, H)[:, None]
    xx = np.linspace(0, 1, W)[None, :]
    top, bottom = np.array([13, 17, 32]), np.array([6, 8, 15])
    grad = top[None, :] * (1 - yy) + bottom[None, :] * yy          # (H, 3)
    glow = np.exp(-(((xx - 0.5) ** 2) / 0.18 + ((yy - 0.35) ** 2) / 0.12))  # (H, W)
    img = grad[:, None, :] + glow[..., None] * np.array([10, 14, 30])
    return np.clip(img, 0, 255).astype(np.uint8)


BASE_IMG = Image.fromarray(_build_base())

_rng = np.random.default_rng(2055)
STARS = np.column_stack([
    _rng.uniform(0, BW, 320), _rng.uniform(0, BH * 0.75, 320),
    _rng.uniform(0.4, 1.4, 320), _rng.uniform(0, 2 * math.pi, 320), _rng.uniform(0.4, 1.6, 320),
])

BUILDINGS = []
_cell = BW / 84
for _i in range(84):
    _w = _cell * _rng.uniform(0.55, 0.95)
    _x = _i * _cell + _rng.uniform(0, _cell - _w)
    _era = float(_rng.random()) ** 1.6      # 偏向早期出现，城市更早成形
    _hmax = _rng.uniform(18, 60) + (_era ** 2) * _rng.uniform(30, 130)
    _cols = max(1, int(_w / 5))
    _rows = int(_hmax / 6) + 2
    BUILDINGS.append((_x, _w, _hmax, _era, _rng.random((_rows, _cols))))

SKY_TRAFFIC = _rng.random((40, 4))


def draw_stars(c, t):
    for x, y, r, ph, sp in STARS:
        b = 0.35 + 0.65 * (0.5 + 0.5 * math.sin(t * sp + ph))
        c.ellipse(x, y, r, fill=alpha((200, 210, 240), b * 0.9))


def draw_skyline(c, p, t):
    gy = BH - 14
    k = clamp((p - 0.68) / 0.32)          # 0 = 2025 之前, 1 = 2055
    lit = mix(AMBER, CYAN, k)
    c.line([(0, gy), (BW, gy)], alpha(lit, 0.25), 1)
    c.rect([0, gy, BW, BH], fill=(6, 8, 14))
    lit_prob = 0.12 + 0.5 * p
    pts = []
    for x, w, hmax, era, win in BUILDINGS:
        vis = smooth((p - era) / 0.1)
        if vis <= 0:
            continue
        h = hmax * vis
        body = mix((14, 18, 32), (28, 34, 56), era)
        c.rect([x, gy - h, x + w, gy], fill=body)
        rows, cols = int(h / 6), win.shape[1]
        for r in range(rows):
            for cc in range(cols):
                v = win[r, cc]
                if v < lit_prob * (0.75 + 0.25 * math.sin(t * 2.0 + v * 40)):
                    pts.append((x + 2 + cc * 5, gy - h + 3 + r * 6))
        if era > 0.82 and vis > 0.9:          # 尖塔 + 航标灯
            c.line([(x + w / 2, gy - h), (x + w / 2, gy - h - 14)], alpha(DIM, 0.8), 1)
            if math.sin(t * 4 + era * 30) > 0.3:
                c.ellipse(x + w / 2, gy - h - 15, 1.5, fill=ROSE)
    c.points(pts, lit)
    if k > 0.05:                                # 未来：低空飞行器
        n = int(k * len(SKY_TRAFFIC))
        for j in range(n):
            a, sp, ph, dr = SKY_TRAFFIC[j]
            d = 1 if dr > 0.5 else -1
            y = 470 + a * 160
            x = (ph * BW + d * t * (25 + sp * 45)) % BW
            c.line([(x - 14 * d, y), (x, y)], alpha(CYAN, 0.35 * k), 1)
            c.ellipse(x, y, 1.4, fill=alpha(WHITE, 0.9 * k))


# --------------------------------------------------------------------------- 图表与卡片
def draw_chart(c, box, xr, series, year, ticks, fan=False):
    x0, y0, x1, y1 = box

    def px(v):
        return x0 + (v - xr[0]) / (xr[1] - xr[0]) * (x1 - x0)

    for g in range(5):
        yy = y0 + (y1 - y0) * g / 4
        c.line([(x0, yy), (x1, yy)], (22, 28, 44), 1)
    for yr in ticks:
        xx = px(yr)
        c.line([(xx, y1), (xx, y1 + 5)], DIM, 1)
        c.text((xx, y1 + 9), str(yr), font(12, mono=True), GREY, "mt")
    cx = px(year)
    c.dashed((cx, y0), (cx, y1), alpha(WHITE, 0.25))

    xs = np.linspace(xr[0], year, 140)
    curves = []
    for s in series:
        ys = np.interp(xs, s.x, s.y)
        lo, hi = s.rng
        curves.append((s, ys, lambda v, lo=lo, hi=hi: y1 - (v - lo) / (hi - lo) * (y1 - y0)))

    if fan and year > xr[0] + 0.2:              # 先画全部不确定带，再画曲线，避免互相遮挡
        for s, ys, py in curves:
            spread = s.band * ((xs - xr[0]) / (xr[1] - xr[0])) ** 0.8
            upper = [(px(a), py(b + d)) for a, b, d in zip(xs, ys, spread)]
            lower = [(px(a), py(b - d)) for a, b, d in zip(xs, ys, spread)]
            c.poly(upper + lower[::-1], alpha(s.color, 0.07))

    labels = []
    for s, ys, py in curves:
        pts = [(px(a), py(b)) for a, b in zip(xs, ys)]
        if len(pts) > 1:
            c.line(pts, alpha(s.color, 0.3), 7)
            c.line(pts, s.color, 2.2)
        ex, ey = pts[-1]
        c.ellipse(ex, ey, 7, fill=alpha(s.color, 0.3))
        c.ellipse(ex, ey, 3.2, fill=WHITE)
        labels.append([ey, ex, s, ys[-1]])

    labels = [[ey, ex, s, v, ey] for ey, ex, s, v in labels]
    labels.sort(key=lambda l: l[0])
    gap = 24
    for i in range(1, len(labels)):                      # 自上而下推开重叠的标签
        if labels[i][0] - labels[i - 1][0] < gap:
            labels[i][0] = labels[i - 1][0] + gap
    overflow = labels[-1][0] - (y1 + 4) if labels else 0  # 超出底部则整体上移
    if overflow > 0:
        for l in labels:
            l[0] -= overflow
    for ly, lx, s, v, ey in labels:
        if abs(ly - ey) > 3:                             # 被推开的标签用细线指回数据点
            c.line([(lx + 4, ey), (lx + 9, ly)], alpha(s.color, 0.5), 1)
        c.text((lx + 12, ly), s.name, font(13), alpha(s.color, 0.85), "lm")
        c.mtext((lx + 12 + text_width(s.name, font(13)) + 6, ly), s.fmt(v), 13, WHITE, "lm")


def draw_cards(c, events, year, tl, tl_of_year, accent, header):
    x0, x1, top, sp = 850, 1215, 150, 86
    c.text((x0, 126), header, font(13), GREY)
    c.line([(x0, 143), (x1, 143)], (30, 38, 58), 1)
    visible = sorted([e for e in events if e[0] <= year], key=lambda e: -e[0])[:5]
    if not visible:
        c.text(((x0 + x1) / 2, top + 60), "……", font(20), DIM, "mm")
        return
    e_new = ease_out((tl - tl_of_year(visible[0][0])) / 0.6)
    for k, (yr, title, desc) in enumerate(visible):
        if k == 0:
            y, a, xoff = top, e_new, (1 - e_new) * 40
        else:
            y, a, xoff = top + (k - 1 + e_new) * sp, 1 - 0.18 * k, 0
            if k == 4:
                a *= (1 - e_new)
        if a <= 0.02:
            continue
        box = (x0 + xoff, y, x1 + xoff, y + sp - 12)
        c.rrect(box, 8, fill=alpha((22, 28, 46), a), outline=alpha(accent, 0.45 * a))
        c.rect((x0 + xoff, y + 10, x0 + xoff + 3, y + sp - 22), fill=alpha(accent, a))
        c.text((x0 + xoff + 16, y + 13), str(yr), font(15, mono=True), alpha(accent, a))
        c.text((x0 + xoff + 72, y + 11), title, font(18), alpha(WHITE, a))
        c.text((x0 + xoff + 16, y + 44), desc, font(13), alpha(GREY, a))


def draw_header(c, title, sub, year, frac, accent, tag=None):
    c.text((70, 52), title, font(26), WHITE)
    c.text((70, 94), sub, font(13), GREY)
    if tag:
        tw = text_width(tag, font(12)) + 18
        tx = 70 + text_width(title, font(26)) + 18
        c.rrect((tx, 58, tx + tw, 80), 11, outline=accent, width=1)
        c.text((tx + 9, 69), tag, font(12), accent, "lm")
    c.text((1215, 50), f"{int(year)}", font(54, mono=True), WHITE, "ra")
    c.rect((850, 114, 1215, 117), fill=(28, 34, 52))
    c.rect((850, 114, 850 + 365 * clamp(frac), 117), fill=accent)


# --------------------------------------------------------------------------- 各场景
def scene_intro(c, tl, dur):
    cx, cy = BW / 2, 330
    for i in range(5):
        r = 110 + i * 34
        spd = (1 if i % 2 == 0 else -1) * (14 + i * 6)
        st = (tl * spd + i * 50) % 360
        c.arc(cx, cy, r, st, st + 160 + i * 20, alpha(mix(CYAN, AMBER, i / 4), 0.35), 1.2)
        ang = math.radians(st)
        c.ellipse(cx + r * math.cos(ang), cy + r * math.sin(ang), 2.2, fill=alpha(WHITE, 0.8))
    a1 = smooth((tl - 0.5) / 1.4)
    a2 = smooth((tl - 1.8) / 1.2)
    a3 = smooth((tl - 3.2) / 1.0)
    c.text((cx, cy - 10), "人类进步", font(74), alpha(WHITE, a1), "mm")
    c.text((cx, cy + 56), "推演未来三十年 · 2025 → 2055", font(24), alpha(AMBER, a2), "mm")
    c.line([(cx - 160 * a2, cy + 92), (cx + 160 * a2, cy + 92)], alpha(DIM, a2), 1)
    c.text((cx, 626), "本片全部由代码生成 · numpy / Pillow / ffmpeg · 无任何外部素材", font(13), alpha(GREY, a3), "mm")


def scene_past(c, tl, dur):
    year = past_year(tl)
    draw_skyline(c, skyline_progress(year), tl)
    draw_header(c, "回望 · 1800 → 2025", "数据来源: Our World in Data / 联合国 / 世界银行（近似值）",
                year, (year - 1800) / 225, AMBER)
    draw_chart(c, (70, 150, 680, 470), (1800, 2025), PAST_SERIES, year, [1800, 1850, 1900, 1950, 2000, 2025])
    draw_cards(c, PAST_EVENTS, year, tl, past_tl_of_year, AMBER, "关键里程碑")


def scene_bridge(c, tl, dur):
    draw_skyline(c, 0.68, scene_start("bridge") + tl)
    cx = BW / 2
    pulse = 1 + 0.03 * math.sin(tl * 3)
    c.arc(cx, 250, 86 * pulse, (tl * 60) % 360, (tl * 60) % 360 + 250, alpha(AMBER, 0.6), 1.5)
    c.text((cx, 250), "2025", font(62, mono=True), WHITE, "mm")
    lines = [
        (0.6, "过去 225 年，人类把预期寿命翻了一倍以上，"),
        (1.4, "把极端贫困从四分之三降到不足十分之一。"),
        (2.6, "接下来的 30 年会怎样？"),
        (3.5, "以下为基于公开趋势的情景推演，不是预言。"),
    ]
    for i, (t0, s) in enumerate(lines):
        a = smooth((tl - t0) / 0.7)
        col = AMBER if i == 2 else (GREY if i == 3 else WHITE)
        c.text((cx, 378 + i * 40 - (1 - a) * 10), s, font(22 if i < 3 else 15), alpha(col, a), "mm")


def scene_future(c, tl, dur):
    year = future_year(tl)
    draw_skyline(c, skyline_progress(year), scene_start("future") + tl)
    draw_header(c, "推演 · 2025 → 2055", "情景外推自 UN WPP / IEA NZE / 算力趋势；阴影带表示不确定区间",
                year, (year - 2025) / 30, CYAN, tag="情景推演 · 非预言")
    draw_chart(c, (70, 150, 680, 470), (2025, 2055), FUTURE_SERIES, year,
               [2025, 2030, 2035, 2040, 2045, 2050, 2055], fan=True)
    draw_cards(c, FUTURE_EVENTS, year, tl, future_tl_of_year, CYAN, "情景节点")


def scene_outro(c, tl, dur):
    cx = BW / 2
    cols = [("1800", 390, GREY), ("2025", 640, AMBER), ("2055 · 推演", 890, CYAN)]
    rows = [
        ("预期寿命", "29 岁", "73.5 岁", "78 岁"),
        ("识字率", "12%", "87%", "95%+"),
        ("极端贫困", "~79%", "8.5%", "<3%"),
        ("儿童死亡率", "43%", "3.7%", "<2%"),
        ("世界人口", "10 亿", "82 亿", "98 亿"),
    ]
    a0 = smooth(tl / 0.8)
    c.text((cx, 92), "两个世纪 · 三十年", font(30), alpha(WHITE, a0), "mm")
    for name, x, col in cols:
        c.mtext((x, 150), name, 16, alpha(col, a0), "mm")
    c.line([(150, 172), (1130, 172)], alpha(DIM, a0), 1)
    for i, (label, v0, v1, v2) in enumerate(rows):
        a = smooth((tl - 0.8 - i * 0.45) / 0.6)
        y = 212 + i * 58
        c.text((160, y), label, font(19), alpha(WHITE, a), "lm")
        for (name, x, col), v in zip(cols, (v0, v1, v2)):
            c.mtext((x, y + (1 - a) * 8), v, 22, alpha(col, a), "mm")
        c.dashed((160, y + 28), (1130, y + 28), alpha((26, 32, 50), a), 2, 4)
    a5 = smooth((tl - 4.3) / 1.0)
    a6 = smooth((tl - 5.6) / 1.0)
    c.text((cx, 560), "未来不是被预测出来的，而是被建造出来的。", font(26), alpha(AMBER, a5), "mm")
    c.text((cx, 626), "全片由代码生成 · 数据为公开资料近似值 · 未来部分为情景推演", font(13), alpha(GREY, a6), "mm")


SCENE_FN = {"intro": scene_intro, "past": scene_past, "bridge": scene_bridge,
            "future": scene_future, "outro": scene_outro}


def render_frame(i):
    t = i / FPS
    name, tl, dur = scene_at(t)
    img = BASE_IMG.copy()
    c = Canvas(img)
    draw_stars(c, t)
    SCENE_FN[name](c, tl, dur)
    if S != 1:
        img = img.resize((BW, BH), Image.LANCZOS)
    fade = clamp(min(tl / 0.8, (dur - tl) / 0.8))
    if fade < 1:
        arr = np.asarray(img).astype(np.float32) * fade
        img = Image.fromarray(arr.astype(np.uint8))
    return img


def render_frame_bytes(i):
    return render_frame(i).tobytes()


# --------------------------------------------------------------------------- 配乐合成
def milestone_times():
    ts = [scene_start(n) + 0.4 for n, _ in SCENES]
    ts += [scene_start("past") + past_tl_of_year(y) for y, _, _ in PAST_EVENTS]
    ts += [scene_start("future") + future_tl_of_year(y) for y, _, _ in FUTURE_EVENTS]
    return sorted(ts)


def make_audio(path):
    sr = 44100
    n = int(TOTAL * sr)
    t = np.arange(n) / sr
    out = np.zeros(n)
    chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]]  # Am7 Fmaj7 Cmaj7 G7
    seg = 8.0
    idx = 0
    st = 0.0
    while st < TOTAL:
        en = min(TOTAL, st + seg + 1.5)
        i0, i1 = int(st * sr), int(en * sr)
        tt = t[i0:i1] - st
        env = np.clip(tt / 1.6, 0, 1) * np.clip((en - st - tt) / 1.6, 0, 1)
        for m in chords[idx % 4]:
            f = 440 * 2 ** ((m - 69) / 12)
            for mult, amp in ((1, 1.0), (2, 0.22), (0.5, 0.45), (1.003, 0.6)):
                vib = 0.004 * np.sin(2 * np.pi * 0.17 * tt + m)
                out[i0:i1] += amp * env * np.sin(2 * np.pi * f * mult * tt * (1 + vib)) * 0.045
        idx += 1
        st += seg
    # 低频脉动：进入“未来”后渐强
    beat = (np.sin(2 * np.pi * 55 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t)) ** 4)
    beat *= np.clip((t - scene_start("future")) / 6, 0, 1) * np.clip((TOTAL - 4 - t) / 3, 0, 1)
    out += 0.08 * beat
    # 里程碑“铃声”
    penta = [880, 987.8, 1108.7, 1318.5, 1480]
    for k, te in enumerate(milestone_times()):
        f = penta[k % len(penta)]
        ln = int(2.0 * sr)
        i0 = int(te * sr)
        if i0 + ln > n:
            ln = n - i0
        tt = np.arange(ln) / sr
        bell = np.exp(-tt * 2.8) * (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * f * 2.01 * tt)
                                    + 0.2 * np.sin(2 * np.pi * f * 3.0 * tt))
        out[i0:i0 + ln] += 0.11 * bell
    out *= np.clip(t / 2.0, 0, 1) * np.clip((TOTAL - t) / 3.0, 0, 1)
    out /= np.max(np.abs(out)) * 1.15
    pcm = (out * 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


# --------------------------------------------------------------------------- 主流程
def preview():
    d = os.path.join(OUT_DIR, "preview")
    os.makedirs(d, exist_ok=True)
    times = [3.5, 9, 20, 36, 44, 55, 70, 86, 95, 100]
    for tm in times:
        render_frame(int(tm * FPS)).save(os.path.join(d, f"t{tm:05.1f}.png"))
    print("预览帧已写入", d)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if "--preview" in sys.argv:
        preview()
        return
    wav = os.path.join(OUT_DIR, "score.wav")
    mp4 = os.path.join(OUT_DIR, "human_progress_2055.mp4")
    print("合成配乐 …")
    make_audio(wav)
    nframes = int(TOTAL * FPS)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-stats",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{BW}x{BH}", "-r", str(FPS), "-i", "-",
           "-i", wav,
           "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", mp4]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    print(f"渲染 {nframes} 帧 ({TOTAL:.0f}s @ {FPS}fps) …")
    with Pool() as pool:
        for k, fb in enumerate(pool.imap(render_frame_bytes, range(nframes), chunksize=6)):
            proc.stdin.write(fb)
            if k % (FPS * 5) == 0:
                print(f"  {k}/{nframes}", flush=True)
    proc.stdin.close()
    proc.wait()
    os.remove(wav)
    print("完成:", mp4)


if __name__ == "__main__":
    main()
