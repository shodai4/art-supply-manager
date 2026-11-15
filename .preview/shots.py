"""375px 表示確認用スクリプト（Playwright・ローカル専用／コミット対象外）

new: http://127.0.0.1:8787/  (作業中の版)
old: http://127.0.0.1:8788/  (直前の版 = commit 93f8131)
"""
import json
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

OUT = pathlib.Path("/workspace/work/art-supply-manager/.preview/out")
OUT.mkdir(parents=True, exist_ok=True)

SERVERS = []


def start_servers():
    for port, cwd in ((8787, "/workspace/work/art-supply-manager"), (8788, "/workspace/work/asm-before")):
        SERVERS.append(subprocess.Popen([sys.executable, "-m", "http.server", str(port)], cwd=cwd,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    time.sleep(1.2)


def stop_servers():
    for p in SERVERS:
        p.terminate()

FOLDERS = [
    {"id": "home", "name": "家", "icon": "🏠", "color": "#2f80ed"},
    {"id": "atelier", "name": "アトリエ", "icon": "🎨", "color": "#e07b39"},
    {"id": "carry", "name": "持ち出し用", "icon": "🎒", "color": "#2e9e6b"},
    {"id": "stock", "name": "ストック・予備", "icon": "📦", "color": "#7b61c9"},
]

ITEMS = [
    ("ホルベイン 油絵具 シルバー 6号", "ホルベイン", "oil", "シルバー", "6号", "atelier", 1, "enough"),
    ("ホルベイン 油絵具 ウルトラマリン 6号", "ホルベイン", "oil", "ウルトラマリン", "6号", "atelier", 3, "low"),
    ("ターナー アクリルガッシュ ジャパネスクカラー", "ターナー", "acrylic", "赤金", "20ml", "home", 2, "enough"),
    ("クサカベ 油絵具 チタニウムホワイト", "クサカベ", "oil", "チタニウムホワイト", "12号", "stock", 5, "new"),
    ("リキテックス ヘビーボディ ナフサレッド", "リキテックス", "acrylic", "ナフサレッド", "59ml", "carry", 0, "empty"),
    ("ジェッソ 下地剤 250ml", "ターナー", "medium", "", "250ml", "studio", 1, "low"),
    ("ホルベイン 平筆 6号", "ホルベイン", "brush", "", "6号", "home", 2, "enough"),
    ("鉛筆 ユニ 2B", "", "other", "", "", "home", 1, "enough"),
    ("F6 キャンバス 中目", "名村大成堂", "canvas", "", "F6", "stock", 2, "enough"),
    ("スケッチブック A4 クロッキー", "マルマン", "paper", "", "A4", "carry", 1, "enough"),
]

FOLDERS_FULL = FOLDERS + [{"id": "studio", "name": "スタジオ", "icon": "🏛️", "color": "#2f9e9e"}]


def seed(_):
    items = []
    for i, (name, maker, cat, color, size, folder, qty, status) in enumerate(ITEMS):
        items.append({
            "id": f"seed{i}",
            "name": name,
            "maker": maker,
            "brand": "",
            "category": cat,
            "colorName": color,
            "colorCode": "",
            "size": size,
            "folderId": folder,
            "qty": qty,
            "status": status,
            "jan": "",
            "shop": "",
            "price": None,
            "memo": "",
            "createdAt": f"2026-11-{10 + i:02d}T10:00:00.000Z",
            "updatedAt": f"2026-11-{10 + i:02d}T10:00:00.000Z",
        })
    state = {"app": "art-supply-manager", "version": 1, "folders": FOLDERS_FULL, "items": items,
             "settings": {"sort": "updated", "askBeforeDelete": True}}
    return "localStorage.setItem('art-supply-manager/v1', %s);" % json.dumps(json.dumps(state))


def run():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, base in (("old", "http://127.0.0.1:8788/"), ("new", "http://127.0.0.1:8787/")):
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                      is_mobile=True, has_touch=True, locale="ja-JP",
                                      timezone_id="Asia/Tokyo")
            page = ctx.new_page()
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(seed(None))
            page.goto(base, wait_until="networkidle")
            page.wait_for_timeout(300)

            info = page.evaluate("""() => {
              const w = (s) => { const el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : null; };
              const items = document.querySelectorAll('.item, .card[data-id]');
              const first = items[0];
              const listTop = document.querySelector('#itemList').getBoundingClientRect().top;
              return {
                cards: items.length,
                firstCard: first ? Math.round(first.getBoundingClientRect().height) : null,
                header: w('.app-header'), search: w('.searchbar'), chips: w('.chips'), filters: w('.filters'),
                tabbar: w('.tabbar'),
                listTop: Math.round(listTop),
                visibleFrom: Math.round(listTop),
                filterCount: document.querySelectorAll('.filters select').length,
                sortValue: document.querySelector('#fSort') ? document.querySelector('#fSort').value : null,
              };
            }""")
            results[label] = info
            page.screenshot(path=str(OUT / f"{label}-list.png"))

            if label == "new":
                # メーカー順に切り替え
                page.select_option("#fSort", "maker")
                page.wait_for_timeout(250)
                page.screenshot(path=str(OUT / "new-maker-sort.png"))
                heads = page.evaluate("() => [...document.querySelectorAll('.maker-head')].map(h => h.textContent.trim())")
                results["makerHeads"] = heads

                # メーカーフィルタ
                page.select_option("#fMakerFilter", "ホルベイン")
                page.wait_for_timeout(250)
                page.screenshot(path=str(OUT / "new-maker-filter.png"))
                results["makerFilterCards"] = page.evaluate("() => document.querySelectorAll('#itemList .item').length")
                results["makerFilterNames"] = page.evaluate("() => [...document.querySelectorAll('#itemList .it-name')].map(e => e.textContent)")

                # 絞り込みリセット＋操作系の回帰確認
                page.select_option("#fMakerFilter", "all")
                page.select_option("#fSort", "shortage")
                page.wait_for_timeout(200)
                results["shortageFirst"] = page.evaluate("() => document.querySelector('.it-name').textContent")
                page.select_option("#fSort", "updated")
                page.wait_for_timeout(150)

                # ステッパー ＋
                before = page.evaluate("() => document.querySelector('.it-side .qty').textContent")
                page.click(".item .it-side .step[data-step='1']")
                page.wait_for_timeout(200)
                after = page.evaluate("() => document.querySelector('.it-side .qty').textContent")
                results["stepper"] = [before, after]

                # フォルダタグ → 移動シート
                page.click(".item .folder-tag")
                page.wait_for_timeout(200)
                results["moveSheetOpen"] = page.evaluate("() => document.querySelector('#sheetMove').classList.contains('open')")
                page.click("#mask")
                page.wait_for_timeout(200)

                # 名前タップ → 編集シート（メーカー欄に入っているか）
                page.click(".item .it-name")
                page.wait_for_timeout(250)
                results["editSheetOpen"] = page.evaluate("() => document.querySelector('#sheetItem').classList.contains('open')")
                results["editName"] = page.input_value("#fName")
                results["editMaker"] = page.input_value("#fMaker")
                page.click("#sheetItem .close")
                page.wait_for_timeout(200)

                # 検索（メーカー名で）
                page.fill("#q", "ホルベイン")
                page.wait_for_timeout(250)
                results["searchCards"] = page.evaluate("() => document.querySelectorAll('#itemList .item').length")
                page.fill("#q", "")
                page.wait_for_timeout(200)

                # 保管場所フォルダ切替
                page.click("#folderChips .chip[data-folder='stock']")
                page.wait_for_timeout(250)
                results["folderChipsCards"] = page.evaluate("() => document.querySelectorAll('#itemList .item').length")
                results["folderSub"] = page.evaluate("() => document.querySelector('#hdrSub').textContent")
                page.click("#folderChips .chip[data-folder='all']")
                page.wait_for_timeout(200)

                # タブ切替（買い物リスト・設定）
                page.click("#tabbar button[data-tab='shopping']")
                page.wait_for_timeout(250)
                results["shoppingCards"] = page.evaluate("() => document.querySelectorAll('#shoppingList .item').length")
                page.screenshot(path=str(OUT / "new-shopping.png"))
                page.click("#tabbar button[data-tab='stock']")
                page.wait_for_timeout(200)

                # 追加モーダル（JAN欄・カテゴリ）
                page.click("#btnAdd")
                page.wait_for_timeout(250)
                results["addSheet"] = page.evaluate("() => document.querySelector('#sheetItem').classList.contains('open')")
                page.click("#sheetItem .actions .btn:not(.primary)")
                page.wait_for_timeout(200)

                # リロードして並び替えの保存を確認（init scriptの再シードを外して判定）
                page.select_option("#fSort", "maker")
                page.wait_for_timeout(200)
                results["sortStored"] = page.evaluate("() => JSON.parse(localStorage.getItem('art-supply-manager/v1')).settings.sort")

            results[f"{label}Errors"] = errors
            ctx.close()
        browser.close()
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    start_servers()
    try:
        run()
    finally:
        stop_servers()
