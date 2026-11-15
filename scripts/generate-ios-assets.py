#!/usr/bin/env python3
"""iOS の AppIcon（1024px・アルファなし）と起動画面用の素材を作る。

入力: icon-512.png（リポジトリ直下）
出力: resources/AppIcon.appiconset/{Contents.json, icon-1024.png}
      resources/splash.png

使い方: python3 scripts/generate-ios-assets.py
必要なもの: Pillow（pip install Pillow）
"""
from pathlib import Path
import json

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "icon-512.png"
OUT_DIR = ROOT / "resources" / "AppIcon.appiconset"
SIZE = 1024
BACKGROUND = (255, 255, 255, 255)

CONTENTS = {
    "images": [
        {"filename": "icon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}
    ],
    "info": {"author": "xcode", "version": 1},
}


def load_square(path: Path) -> Image.Image:
    """角丸・透過を白で埋めて正方形にする（iOSのアイコンはアルファ不可）。"""
    image = Image.open(path).convert("RGBA")
    side = max(image.size)
    canvas = Image.new("RGBA", (side, side), BACKGROUND)
    canvas.paste(image, ((side - image.width) // 2, (side - image.height) // 2), image)
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"元画像が見つかりません: {SOURCE}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    icon = load_square(SOURCE).convert("RGB")
    icon.save(OUT_DIR / "icon-1024.png", "PNG", optimize=True)
    (OUT_DIR / "Contents.json").write_text(
        json.dumps(CONTENTS, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    splash = Image.new("RGB", (2732, 2732), (244, 246, 249))
    mark = load_square(SOURCE).convert("RGB").resize((600, 600), Image.LANCZOS)
    splash.paste(mark, ((2732 - 600) // 2, (2732 - 600) // 2))
    splash.save(ROOT / "resources" / "splash.png", "PNG", optimize=True)

    print(f"作成: {OUT_DIR / 'icon-1024.png'}（{SIZE}x{SIZE}）")
    print(f"作成: {ROOT / 'resources' / 'splash.png'}（2732x2732）")


if __name__ == "__main__":
    main()
