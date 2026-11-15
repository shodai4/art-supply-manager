#!/usr/bin/env python3
"""iOS の AppIcon（1024px・アルファ無し）と起動画面の素材を作る。

- 文字を描かないのでフォントを一切使わない（macOS ランナーに Linux のフォントパスが
  無いことで落ちる問題を避ける。date-15 で踏んだエラーと同じ種類の罠を踏まない）
- 形は Pillow の描画だけで作り、4倍の大きさで描いてから縮小する（輪郭が滑らかになる）
- 出力は resources/ 配下（`IOS_ASSETS_OUT` を指定すると別の場所へ。テスト用）

出力:
  resources/AppIcon.appiconset/Contents.json   … iPhone / iPad / App Store の全サイズ
  resources/AppIcon.appiconset/AppIcon-*.png
  resources/splash.png                         … 2732x2732

使い方: python3 scripts/generate-ios-assets.py
必要なもの: Pillow（pip install Pillow）
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - CI では先に pip install する
    sys.exit("Pillow が必要です（pip install Pillow）")

ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = Path(os.environ.get("IOS_ASSETS_OUT") or ROOT)
RES_DIR = OUT_ROOT / "resources"
APPICON_DIR = RES_DIR / "AppIcon.appiconset"

ICON_SIZE = 1024
SPLASH_SIZE = 2732
# 図柄は 192 角の座標で書いて、1024 に拡大する（元の icon.svg と同じ比率）
DESIGN_UNIT = 192
SS = 4  # スーパーサンプリング倍率

BG_TOP = (47, 111, 208)      # #2f6fd0
BG_BOTTOM = (123, 97, 201)   # #7b61c9
WHITE = (255, 255, 255)
SPLASH_BG = (244, 246, 249)  # #f4f6f9（capacitor.config.json の backgroundColor と同じ）

# iPhone（20/29/40/60 → 1x/2x/3x）、iPad（20/29/40/76/83.5）、App Store（1024）
APPICON_SPECS = [
    (20, 1, "iphone"), (20, 2, "iphone"), (20, 3, "iphone"),
    (29, 1, "iphone"), (29, 2, "iphone"), (29, 3, "iphone"),
    (40, 2, "iphone"), (40, 3, "iphone"),
    (60, 2, "iphone"), (60, 3, "iphone"),
    (20, 1, "ipad"), (20, 2, "ipad"),
    (29, 1, "ipad"), (29, 2, "ipad"),
    (40, 1, "ipad"), (40, 2, "ipad"),
    (76, 1, "ipad"), (76, 2, "ipad"),
    (83.5, 2, "ipad"),
    (1024, 1, "ios-marketing"),
]


def _scale(points, k):
    return [(x * k, y * k) for x, y in points]


def _bezier(p0, p1, p2, p3, steps=48):
    """3次ベジェを折れ線に均す（Pillow で滑らかな曲線を引くため）。"""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ))
    return out


def _gradient(size):
    """左上→右下の2色グラデーション（小さい画像で作って拡大する）。"""
    steps = 256
    small = Image.new("RGB", (steps, steps))
    px = small.load()
    for y in range(steps):
        for x in range(steps):
            t = (x + y) / (2 * (steps - 1))
            px[x, y] = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
    return small.resize((size, size), Image.BICUBIC)


def _stroke_polygon(points, width):
    """折れ線を太さ width の帯（両端丸め）の多角形にする。

    ImageDraw.line(width=...) は関節に小さなトゲや段差が出るため、
    中心線の法線方向へ振った多角形を塗り、両端に円を足す。
    """
    half = width / 2
    left, right = [], []
    for i, (x, y) in enumerate(points):
        if i == 0:
            dx, dy = points[1][0] - x, points[1][1] - y
        elif i == len(points) - 1:
            dx, dy = x - points[-2][0], y - points[-2][1]
        else:
            dx, dy = points[i + 1][0] - points[i - 1][0], points[i + 1][1] - points[i - 1][1]
        length = (dx * dx + dy * dy) ** 0.5 or 1.0
        nx, ny = -dy / length * half, dx / length * half
        left.append((x + nx, y + ny))
        right.append((x - nx, y - ny))
    return left + right[::-1]


def draw_icon(size=ICON_SIZE):
    """筆の一筆と3つの絵具の粒（元の icon.svg と同じ図柄）を描く。"""
    big = size * SS
    k = big / DESIGN_UNIT
    img = _gradient(big)
    draw = ImageDraw.Draw(img)

    # 筆の一筆（icon.svg の path: M52 132c0-32 22-58 52-58 22 0 36 12 36 28 0 18-16 30-34 30）
    stroke = 9 * k
    points = [(52, 132)]
    points += _bezier((52, 132), (52, 100), (74, 74), (104, 74), steps=72)[1:]
    points += _bezier((104, 74), (126, 74), (140, 86), (140, 102), steps=72)[1:]
    points += _bezier((140, 102), (140, 120), (124, 132), (106, 132), steps=72)[1:]
    scaled = _scale(points, k)
    draw.polygon(_stroke_polygon(scaled, stroke), fill=WHITE)
    # 線の両端を丸くする
    for x, y in (scaled[0], scaled[-1]):
        draw.ellipse([x - stroke / 2, y - stroke / 2, x + stroke / 2, y + stroke / 2], fill=WHITE)

    # 中心の小さな粒
    r = 4 * k
    draw.ellipse([96 * k - r, 96 * k - r, 96 * k + r, 96 * k + r], fill=WHITE)

    # 絵具の粒（黄・緑・赤）
    for cx, cy, radius, color in (
        (70, 70, 11, (255, 209, 102)),
        (120, 62, 8, (140, 233, 154)),
        (136, 92, 6, (255, 168, 168)),
    ):
        rr = radius * k
        draw.ellipse([cx * k - rr, cy * k - rr, cx * k + rr, cy * k + rr], fill=color)

    return img.resize((size, size), Image.LANCZOS)


def _rounded(icon, radius_ratio=0.225):
    """起動画面用に角を丸めたアイコン（透過つき）。"""
    size = icon.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255,
    )
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(icon, (0, 0), mask)
    return out


def write_appiconset(icon):
    APPICON_DIR.mkdir(parents=True, exist_ok=True)
    images = []
    written = []
    for point, scale, idiom in APPICON_SPECS:
        px = int(round(point * scale))
        size_label = f"{point:g}x{point:g}"
        name = f"AppIcon-{size_label}@{scale}x.png"
        icon.resize((px, px), Image.LANCZOS).save(APPICON_DIR / name, "PNG", optimize=True)
        images.append({"filename": name, "idiom": idiom, "scale": f"{scale}x", "size": size_label})
        written.append(name)
    contents = {"images": images, "info": {"author": "xcode", "version": 1}}
    (APPICON_DIR / "Contents.json").write_text(
        json.dumps(contents, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    return written


def write_splash(icon):
    splash = Image.new("RGB", (SPLASH_SIZE, SPLASH_SIZE), SPLASH_BG)
    mark = _rounded(icon.resize((640, 640), Image.LANCZOS))
    splash.paste(mark, ((SPLASH_SIZE - 640) // 2, (SPLASH_SIZE - 640) // 2 - 90), mark)
    path = RES_DIR / "splash.png"
    splash.save(path, "PNG", optimize=True)
    return path


def main():
    RES_DIR.mkdir(parents=True, exist_ok=True)
    APPICON_DIR.mkdir(parents=True, exist_ok=True)
    icon = draw_icon()
    files = write_appiconset(icon)
    splash = write_splash(icon)
    print(f"作成: {APPICON_DIR / 'AppIcon-1024x1024@1x.png'}（{ICON_SIZE}x{ICON_SIZE}）")
    print(f"作成: {APPICON_DIR / 'Contents.json'}（{len(files)}種）")
    print(f"作成: {splash}（{SPLASH_SIZE}x{SPLASH_SIZE}）")


if __name__ == "__main__":
    main()
