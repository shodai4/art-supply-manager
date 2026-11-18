/**
 * 使い方（チュートリアル）の中身。
 *
 * タブごとのアコーディオン → その中で「画面の写真＋短い説明」を横にめくる形にする。
 * 画像と文はここ1か所にまとめ、画面（app.js）は tutorialHtml() を差し込むだけにする。
 * 決めごと:
 *   - 説明は1〜2行（長くしない）。絵文字は使わない（絵描き向けに、文字は少なく）。
 *   - 画像は assets/tutorial/ に置き、Service Worker と www/（iOSバンドル）にも入れる。
 *   - 画像は端末のステータスバーと広告帯を切ったもの（720px幅の WebP）。
 */

/** 画像の置き場所（Service Worker・www/ の一覧と合わせる） */
export const TUTORIAL_ASSET_DIR = 'assets/tutorial';

/** 使い方シートの冒頭に出す一言 */
export const TUTORIAL_LEAD = 'タブを開くと、画面の写真で使い方が見られます。';

/** 「使い方を見た」印（初回案内のカードを消すためだけに使う） */
export const GUIDE_SEEN_KEY = 'art-supply-manager/guideSeen';

/** 画像の既定サイズ（幅720px。縦は端末の画面比） */
const SHOT = { w: 720, h: 1291 };
/** バーコード読み取りの画面だけ縦が少し長い */
const SHOT_TALL = { w: 720, h: 1389 };

/**
 * タブ（アコーディオン）4つ。slides の順がそのまま「画像1 → 画像2 …」の順。
 * @type {{id:string, title:string, note:string, slides:{image:string, alt:string, caption:string, w:number, h:number}[]}[]}
 */
export const TUTORIAL_TABS = [
  {
    id: 'stock',
    title: '1. 在庫',
    note: '入れる・数える・場所ごとに見る',
    slides: [
      {
        image: `${TUTORIAL_ASSET_DIR}/stock-1.webp`,
        alt: '在庫タブの最初の画面。お気に入り・すべての画材と、保管場所のフォルダが並ぶ',
        caption: '最初はこの画面。お気に入り・すべての画材の下に、保管場所のフォルダが並びます。',
        ...SHOT,
      },
      {
        image: `${TUTORIAL_ASSET_DIR}/stock-2.webp`,
        alt: 'フォルダの中。メーカーとシリーズごとに画材が並び、−＋と星が付いている',
        caption: 'フォルダを開くとメーカー＞シリーズ別。−＋で在庫数、星でお気に入りを変えられます。',
        ...SHOT,
      },
      {
        image: `${TUTORIAL_ASSET_DIR}/stock-3.webp`,
        alt: '＋を押したときに出る「カタログから選ぶ」と「自分で入力」の2択',
        caption: '＋を押すと「カタログから選ぶ」か「自分で入力」を選べます。',
        ...SHOT,
      },
      {
        image: `${TUTORIAL_ASSET_DIR}/stock-4.webp`,
        alt: 'バーコードの読み取り画面。枠の中にバーコードを入れると読み取る',
        caption: 'バーコードは枠に入れるだけ。連続スキャンをONにすると、閉じずに読み続けられます。',
        ...SHOT_TALL,
      },
    ],
  },
  {
    id: 'restock',
    title: '2. 補充',
    note: '少なくなった画材をまとめて見る',
    slides: [
      {
        image: `${TUTORIAL_ASSET_DIR}/restock-1.webp`,
        alt: '補充タブ。少なくなった画材と使い切った画材が、メーカーとシリーズごとにまとまる',
        caption: '少なくなった画材と使い切った画材が、自動でここにまとまります。通販ボタンから探せます。',
        ...SHOT,
      },
    ],
  },
  {
    id: 'catalog',
    title: '3. カタログ',
    note: '内蔵辞書から探して追加',
    slides: [
      {
        image: `${TUTORIAL_ASSET_DIR}/catalog-1.webp`,
        alt: 'カタログタブ。メーカー・カテゴリ・シリーズ・キーワードで絞り込む画面',
        caption: 'メーカー・カテゴリ・シリーズ・キーワードで、内蔵辞書37,822件から絞り込めます。',
        ...SHOT,
      },
      {
        image: `${TUTORIAL_ASSET_DIR}/catalog-2.webp`,
        alt: 'シリーズを開いた検索結果。商品ごとに「追加」ボタンが並ぶ',
        caption: 'シリーズを開いて「追加」を押すだけで、その画材が在庫に入ります。',
        ...SHOT,
      },
    ],
  },
  {
    id: 'settings',
    title: '4. 設定',
    note: '表示・サンプル・画材名・プラン',
    slides: [
      {
        image: `${TUTORIAL_ASSET_DIR}/settings-1.webp`,
        alt: '設定タブ。表示の切り替え、サンプル、画材名を最新にする、使い方、プランの並び',
        caption: '表示の切り替え、サンプル、画材名を最新にする、この使い方、プランはここから。',
        ...SHOT,
      },
    ],
  },
];

/** 画像の枚数（合計） */
export const TUTORIAL_SLIDE_TOTAL = TUTORIAL_TABS.reduce((n, tab) => n + tab.slides.length, 0);

/** 使い方で使う画像のパス（Service Worker・www/ の一覧に使う） */
export function tutorialImages() {
  return TUTORIAL_TABS.flatMap((tab) => tab.slides.map((slide) => slide.image));
}

/** HTMLに入れる文字を安全にする（データは固定だが、属性を壊さないように） */
function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 画像1枚分（写真＋説明） */
function slideHtml(tab, slide, index) {
  const total = tab.slides.length;
  return [
    `<figure class="gslide" data-gslide="${index}">`,
    `<img src="${esc(slide.image)}" alt="${esc(slide.alt)}" width="${slide.w}" height="${slide.h}"`,
    ' loading="lazy" decoding="async" draggable="false">',
    `<figcaption class="gcap"><span class="gnum">${index + 1}/${total}</span>${esc(slide.caption)}</figcaption>`,
    '</figure>',
  ].join('');
}

/** タブ1つ分（アコーディオン。最初は閉じておく） */
function tabHtml(tab) {
  const dots = tab.slides
    .map((_, i) => `<button type="button" class="gdot" data-goto="${i}" role="tab" aria-selected="${i === 0}" aria-label="${i + 1}枚目"></button>`)
    .join('');
  return [
    `<details class="gacc" data-gtab="${esc(tab.id)}">`,
    '<summary>',
    '<span class="gacc-mark" aria-hidden="true">▸</span>',
    `<span class="gacc-title">${esc(tab.title)}</span>`,
    `<span class="gacc-note">${esc(tab.note)}</span>`,
    `<span class="gacc-count" aria-hidden="true">${tab.slides.length}</span>`,
    '</summary>',
    '<div class="gacc-body">',
    `<div class="gswipe" data-gswipe="${esc(tab.id)}" tabindex="0" role="group" aria-label="${esc(tab.title)}の画面">`,
    tab.slides.map((slide, i) => slideHtml(tab, slide, i)).join(''),
    '</div>',
    '<div class="gnav-row">',
    '<button type="button" class="gnav" data-gnav="-1" aria-label="前の画面">‹</button>',
    `<div class="gdots" data-gdots="${esc(tab.id)}" role="tablist" aria-label="${esc(tab.title)}の画面を選ぶ">${dots}</div>`,
    '<button type="button" class="gnav" data-gnav="1" aria-label="次の画面">›</button>',
    '</div>',
    '</div>',
    '</details>',
  ].join('');
}

/** チュートリアル全体のHTML（#guideList に入れる） */
export function tutorialHtml() {
  return TUTORIAL_TABS.map(tabHtml).join('');
}

/**
 * 横スクロールの位置から「いま何枚目か」を出す（0始まり）。
 * 画面幅で割って、いちばん近いスライドを選ぶ。
 */
export function slideIndexAt(scrollLeft, slideWidth, count = 1) {
  if (!(slideWidth > 0) || !(count > 0)) return 0;
  const raw = Math.round(Number(scrollLeft || 0) / slideWidth);
  return Math.min(count - 1, Math.max(0, raw));
}

/** 「使い方を見た」印を読む（読めないときは未見あつかい） */
export function readGuideSeen(storage) {
  try {
    return storage?.getItem(GUIDE_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** 「使い方を見た」印を書く（false で消す） */
export function writeGuideSeen(storage, value = true) {
  try {
    if (value) storage?.setItem(GUIDE_SEEN_KEY, '1');
    else storage?.removeItem(GUIDE_SEEN_KEY);
    return true;
  } catch {
    return false;
  }
}
