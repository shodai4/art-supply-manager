"""公開URL（GitHub Pages）での実表示チェック"""
import json
import sys

from playwright.sync_api import sync_playwright

OUT = "/workspace/work/art-supply-manager/.preview/out"
BASE = "https://shodai4.com/art-supply-manager/"

SEED = """() => {
  const folders=[{id:'home',name:'家',icon:'🏠',color:'#2f80ed'},
    {id:'atelier',name:'アトリエ',icon:'🎨',color:'#e07b39'},
    {id:'carry',name:'持ち出し用',icon:'🎒',color:'#2e9e6b'},
    {id:'stock',name:'ストック・予備',icon:'📦',color:'#7b61c9'},
    {id:'studio',name:'スタジオ',icon:'🏛️',color:'#2f9e9e'}];
  const rows=[['ホルベイン 油絵具 シルバー 6号','ホルベイン','シルバー','6号','atelier',1,'enough'],
    ['ホルベイン 油絵具 ウルトラマリン 6号','ホルベイン','ウルトラマリン','6号','atelier',3,'low'],
    ['ターナー アクリルガッシュ ジャパネスクカラー','ターナー','赤金','20ml','home',2,'enough'],
    ['クサカベ 油絵具 チタニウムホワイト','クサカベ','チタニウムホワイト','12号','stock',5,'new'],
    ['リキテックス ヘビーボディ ナフサレッド','リキテックス','ナフサレッド','59ml','carry',0,'empty'],
    ['ジェッソ 下地剤 250ml','ターナー','','250ml','studio',1,'low'],
    ['ホルベイン 平筆 6号','ホルベイン','','6号','home',2,'enough'],
    ['鉛筆 ユニ 2B','','','','home',1,'enough'],
    ['F6 キャンバス 中目','名村大成堂','','F6','stock',2,'enough']];
  const items=rows.map((a,i)=>({id:'s'+i,name:a[0],maker:a[1],brand:'',category:'oil',colorName:a[2],
    colorCode:'',size:a[3],folderId:a[4],qty:a[5],status:a[6],jan:'',shop:'',price:null,memo:'',
    createdAt:'2026-11-1'+i+'T10:00:00.000Z',updatedAt:'2026-11-1'+i+'T10:00:00.000Z'}));
  localStorage.setItem('art-supply-manager/v1', JSON.stringify({folders,items,settings:{sort:'updated'}}));
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=3,
                              is_mobile=True, has_touch=True, locale="ja-JP", timezone_id="Asia/Tokyo")
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until="load")
    page.evaluate(SEED)
    page.reload(wait_until="load")
    page.wait_for_timeout(600)
    page.screenshot(path=f"{OUT}/live-default.png")
    sorter = page.query_selector("#fSort")
    page.select_option("#fSort", "maker")
    page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/live-maker.png")
    page.select_option("#fSort", "updated")
    page.wait_for_timeout(300)
    info = page.evaluate("""() => ({
      title: document.title,
      headerH: Math.round(document.querySelector('.app-header').getBoundingClientRect().height),
      cards: document.querySelectorAll('#itemList .item').length,
      sw: !!navigator.serviceWorker.controller,
      sortOptions: [...document.querySelectorAll('#fSort option')].map(o => o.textContent),
      makerOptions: [...document.querySelectorAll('#fMakerFilter option')].map(o => o.textContent),
    })""")
    info["errors"] = errors
    print(json.dumps(info, ensure_ascii=False, indent=2))
    browser.close()
