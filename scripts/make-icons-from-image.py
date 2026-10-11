#!/usr/bin/env python3
"""アプリアイコン生成: 元画像(灰色の背景に赤い角丸アイコン)から各サイズの PNG / ICO を作る。

使い方:  python3 scripts/make-icons-from-image.py [元画像]   (既定: icons/source/app-icon-original.jpg)
必要なもの: Pillow, numpy
- 角丸の外側(灰色)は取り除き、通常アイコンは角を透明に、全面塗りが必要なもの(iPhone / maskable)は角を赤で埋める
"""
import sys
import numpy as np
from PIL import Image, ImageDraw

SRC = sys.argv[1] if len(sys.argv) > 1 else "icons/source/app-icon-original.jpg"
RED = (218, 32, 36)  # 元画像の赤(中央値)

im = Image.open(SRC).convert("RGB")
a = np.asarray(im).astype(int)
red_px = (a[..., 0] > 150) & (a[..., 1] < 80) & (a[..., 2] < 80)
ys, xs = np.where(red_px)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
side = max(x1 - x0, y1 - y0)
crop = im.crop((x0, y0, x0 + side, y0 + side))
c = np.asarray(crop).astype(float)

# 角丸の形: 灰色→赤の度合い(赤チャンネル)を不透明度にする。白い書類・文字は角から離れているので角付近だけで判定
bg = np.median(np.asarray(im)[:20, :20].reshape(-1, 3), axis=0)
alpha = np.clip((c[..., 0] - bg[0]) / (RED[0] - bg[0]), 0, 1)
r = side * 0.25  # 角丸の範囲(これより内側は不透明)
yy, xx = np.mgrid[0:side, 0:side]
cx = np.minimum(xx, side - 1 - xx)
cy = np.minimum(yy, side - 1 - yy)
corner = (cx < r) & (cy < r)
alpha = np.where(corner, alpha, 1.0)
alpha = np.where(alpha < 0.1, 0.0, np.where(alpha > 0.95, 1.0, alpha))  # JPEG のノイズを除く

# 色は赤と白の2色に整える(JPEG のムラ・ノイズを消す)。緑チャンネルで赤(32)〜白(255)の割合を求め、縁のなめらかさは残す
t = np.clip((c[..., 1] - RED[1]) / (255 - RED[1]), 0, 1)
t = np.where(t < 0.08, 0.0, np.where(t > 0.92, 1.0, t))
t = np.where(corner & (alpha < 1), 0.0, t)  # 角の縁は赤
rgb = np.array(RED, float) + t[..., None] * (255 - np.array(RED, float))

rounded = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), "RGBA")
full = Image.new("RGB", (side, side), RED)  # 角まで赤で埋めた正方形
full.paste(rounded, (0, 0), rounded)

def save(img, size, path):
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print("wrote", path)

# Windows / Android / ブラウザのタブ: 角丸(角は透明)
for size, path in [(32, "icons/files-favicon-32.png"), (192, "icons/files-icon-192.png"),
                   (256, "icons/files-icon-256.png"), (512, "icons/files-icon-512.png"),
                   (192, "icons/icon-192.png")]:
    save(rounded, size, path)
rounded.resize((256, 256), Image.LANCZOS).save("favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
print("wrote favicon.ico")

# Android の maskable: 端末側で丸や角丸に切り抜かれるので、絵柄を安全領域(中央80%)に収める
m = Image.new("RGB", (512, 512), RED)
inner = full.resize((440, 440), Image.LANCZOS)
m.paste(inner, (36, 36))
m.save("icons/files-icon-maskable-512.png", optimize=True)
print("wrote icons/files-icon-maskable-512.png")
