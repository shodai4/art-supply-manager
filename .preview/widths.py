"""横幅ごとの横はみ出し・主要素の寸法チェック（ローカル専用）"""
import json
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

seed_js = open("/workspace/work/art-supply-manager/.preview/shots.py", encoding="utf-8").read()

servers = []


def start():
    servers.append(subprocess.Popen([sys.executable, "-m", "http.server", "8787"],
                                    cwd="/workspace/work/art-supply-manager",
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    time.sleep(1.2)


def main():
    start()
    out = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for width in (320, 375, 393, 430):
                ctx = browser.new_context(viewport={"width": width, "height": 800}, device_scale_factor=2,
                                          is_mobile=True, has_touch=True, locale="ja-JP")
                page = ctx.new_page()
                page.goto("http://127.0.0.1:8787/", wait_until="networkidle")
                page.evaluate("""() => {
                  const folders=[{id:'home',name:'家',icon:'🏠',color:'#2f80ed'},
                    {id:'stock',name:'ストック・予備',icon:'📦',color:'#7b61c9'}];
                  const items=[['ホルベイン 油絵具 ウルトラマリン 6号','ホルベイン','ウルトラマリン','6号','stock',3,'low'],
                    ['ターナー アクリルガッシュ ジャパネスクカラー','ターナー','赤金','20ml','home',2,'enough'],
                    ['鉛筆','','','','home',1,'enough']].map((a,i)=>({id:'s'+i,name:a[0],maker:a[1],brand:'',
                    category:'oil',colorName:a[2],colorCode:'',size:a[3],folderId:a[4],qty:a[5],status:a[6],
                    jan:'',shop:'',price:null,memo:'',createdAt:'2026-11-10T10:00:00.000Z',updatedAt:'2026-11-10T10:00:00.000Z'}));
                  localStorage.setItem('art-supply-manager/v1', JSON.stringify({folders,items,settings:{sort:'maker'}}));
                }""")
                page.reload(wait_until="networkidle")
                page.wait_for_timeout(300)
                res = page.evaluate("""() => {
                  const vw = window.innerWidth;
                  const over = [...document.querySelectorAll('body *')].filter(el => {
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && (r.right > vw + 1 || r.left < -1);
                  }).map(el => el.className || el.tagName).slice(0, 8);
                  const card = document.querySelector('.item');
                  return {
                    innerWidth: vw,
                    scrollWidth: document.documentElement.scrollWidth,
                    bodyScrollWidth: document.body.scrollWidth,
                    overflowing: over,
                    cardHeight: card ? Math.round(card.getBoundingClientRect().height) : null,
                    nameWidth: document.querySelector('.it-name') ? Math.round(document.querySelector('.it-name').getBoundingClientRect().width) : null,
                    metaTruncated: (() => { const m = document.querySelector('.it-meta'); return m ? m.scrollWidth > m.clientWidth + 1 : null; })(),
                    tabbarBottom: (() => { const t = document.querySelector('.tabbar').getBoundingClientRect(); return Math.round(t.bottom); })(),
                  };
                }""")
                out[width] = res
                page.screenshot(path=f"/workspace/work/art-supply-manager/.preview/out/w{width}.png")
                ctx.close()
            browser.close()
    finally:
        for s in servers:
            s.terminate()
    print(json.dumps(out, ensure_ascii=False, indent=2))


main()
