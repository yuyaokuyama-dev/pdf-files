#!/usr/bin/env python3
"""ロゴ生成: Builds と同じ TimeBurner フォントの文字をアウトライン(SVGパス)化する。

使い方:  python3 scripts/make-logo.py <timeburnerbold.ttf のパス>
フォント本体はリポジトリに含めず、生成したSVGパスだけを icons/ に出力する。
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

DARK = "#1b2430"   # Builds の "uilds" と同じ濃紺
RED = "#dc2626"    # PDF の P だけ赤
BG = "#e8eaed"     # Builds のアイコン背景
TRACK = 0.14       # Builds と同じ字間 (0.14em)

font_path = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/builds/src/app/fonts/timeburnerbold.ttf"
font = TTFont(font_path)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font["head"].unitsPerEm
hmtx = font["hmtx"]


def layout(text):
    """文字ごとの (path, x) と全体幅(em単位 *upm)を返す。"""
    x = 0
    out = []
    for ch in text:
        if ch == " ":
            x += upm * 0.35
            out.append((None, x, ch))
            continue
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[name].draw(pen)
        out.append((pen.getCommands(), x, ch))
        x += hmtx[name][0] + upm * TRACK
    return out, x - upm * TRACK


def line_svg(text, size, x0, baseline, colors, stroke_w):
    """1行ぶんの <g> を返す。colors: 文字index→色。"""
    glyphs, width = layout(text)
    s = size / upm
    parts = []
    for i, (d, gx, ch) in enumerate(glyphs):
        if d is None:
            continue
        col = colors.get(i, DARK)
        tx = x0 + gx * s
        parts.append(
            f'<path d="{d}" fill="{col}" stroke="{col}" stroke-width="{stroke_w / s:.3f}" '
            f'transform="translate({tx:.2f} {baseline:.2f}) scale({s:.5f} {-s:.5f})"/>'
        )
    return "".join(parts), width * s


# --- 横長ワードマーク "PDF Files" (先頭の P だけ赤) ---
NAME = "PDF Files"
size = 64
g, w = line_svg(NAME, size, 8, 64, {0: RED}, 1.2)
wordmark = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w + 16:.0f} 84" role="img" aria-label="{NAME}">{g}</svg>'
open("icons/logo.svg", "w").write(wordmark)

# アプリアイコン(赤い角丸に白い書類と「PDF Files」)は scripts/make-icons-from-image.py で元画像から生成する
print("generated icons/logo.svg")
