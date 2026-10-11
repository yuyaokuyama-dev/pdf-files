#!/usr/bin/env python3
"""アプリアイコン生成: 赤背景に白抜きの太字「PDF」。

使い方:  python3 scripts/make-app-icon.py [太字フォントのパス]
         node scripts/make-png-icons.mjs   (SVG → PNG)
文字はアウトライン(SVGパス)化して出力するので、表示側にフォントは不要。
既定フォントは Inter Display Black (SIL OFL)。
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

RED = "#dc2626"
WHITE = "#ffffff"
TEXT = "PDF"
TRACK = -0.01  # 字間(em)。太字なので少しだけ詰める
S = 512

font_path = sys.argv[1] if len(sys.argv) > 1 else "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf"
font = TTFont(font_path)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font["head"].unitsPerEm
hmtx = font["hmtx"]

# 文字ごとのパスと位置、全体の実寸(インク)範囲
glyphs, x = [], 0
xmin = ymin = float("inf")
xmax = ymax = float("-inf")
for ch in TEXT:
    name = cmap[ord(ch)]
    pen = SVGPathPen(gs)
    gs[name].draw(pen)
    bp = BoundsPen(gs)
    gs[name].draw(bp)
    bx0, by0, bx1, by1 = bp.bounds
    xmin, xmax = min(xmin, x + bx0), max(xmax, x + bx1)
    ymin, ymax = min(ymin, by0), max(ymax, by1)
    glyphs.append((pen.getCommands(), x))
    x += hmtx[name][0] + upm * TRACK


def app_icon(width_ratio):
    """文字の実寸幅がアイコン幅の width_ratio になるよう中央に配置。"""
    s = S * width_ratio / (xmax - xmin)
    ox = (S - (xmax - xmin) * s) / 2 - xmin * s
    oy = (S + (ymax - ymin) * s) / 2 + ymin * s  # ベースライン位置(上下中央)
    paths = "".join(
        f'<path d="{d}" transform="translate({ox + gx * s:.2f} {oy:.2f}) scale({s:.5f} {-s:.5f})"/>'
        for d, gx in glyphs
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">'
        f'<rect width="{S}" height="{S}" fill="{RED}"/><g fill="{WHITE}">{paths}</g></svg>'
    )


# 通常: 文字を大きく。maskable: 円形などに切り抜かれても欠けないよう安全域(中央80%)に収める
open("icons/app-icon.svg", "w").write(app_icon(0.80))
open("icons/app-icon-maskable.svg", "w").write(app_icon(0.62))
print("generated icons/app-icon.svg, icons/app-icon-maskable.svg")
