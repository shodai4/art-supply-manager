// 内蔵JAN辞書の商品名を「シリーズ／色名／色番号／号数・容量」に分解する。
// 18カテゴリへの再分類もここで行う（scripts/build-dictionary.mjs から使う）。
//
// 分解の考え方（work/dict-analysis/REPORT.md の試行実装をアプリ側へ移植）:
//   1) 括弧（【】〈〉［］（））の中身をメーカー・品番・号数・仕上げ色・注記に振り分ける
//   2) 先頭・末尾に付いたメーカー名（単独の語）を落とす
//   3) 号数・容量（号 / ml / g / 12色セット / 八切 / F6 …）を抜き出す
//   4) 品番と色番を分ける（色番だけを colorCode に残す）
//   5) 残りを「シリーズ（先頭側）＋色名（末尾側）」に分ける
// 色名が無いのが正しい商品（筆・紙・キャンバス・メディウム・セット品）は無理に切らない。

export const NF = (s) => String(s || '').normalize('NFKC');
export const key = (s) => NF(s).replace(/[\s　・=]/g, '').toLowerCase();
const JP = /[ぁ-んァ-ヶー一-龯]/;

const PRODUCT_WORD = /(絵具|カラー|色鉛筆|パステル|クレパス|クレヨン|マーカー|インク|水彩|油絵|アクリル|ガッシュ|筆|紙|ボード|ペン|ナイフ|パレット|スケッチブック|キャンバス|フレーム|額|テープ|ノート|ファイル|ケース|ローラー|バーニッシュ|メディウム|画用液|ニス|ジェッソ|チョーク|粘土|陶土|アルバム|ポスター|工作|クラフト|デッサン|製図|定規|はさみ|カッター|のり|消しゴム|鉛筆|シャープ|ホルダー|バインダー|ケント|画帳|マット|シート|パッド|ブック|ロール|チューブ|ボトル|セット|詰合|額縁|コンテ|木炭|墨|硯|印|糊|溶き油|筆洗|画架|イーゼル|クロッキー)/;

export const MAKER_ALIAS_EXTRA = {
  'ウィンザー＆ニュートン': ['ウィンザー＆ニュートン', 'ウィンザー&ニュートン', 'ウィンザーニュートン', 'ウインザー＆ニュートン', 'W&N', 'W＆N', 'ニュートン'],
  サクラクレパス: ['サクラクレパス', 'サクラ'],
  ターレンス: ['ターレンス', 'ロイヤルターレンス'],
  ニッカー絵具: ['ニッカー絵具', 'ニッカー'],
  ホルベイン: ['ホルベイン画材', 'ホルベイン'],
  ファーバーカステル: ['ファーバーカステル', 'FABER-CASTELL', 'ファーバー'],
  ステッドラー: ['ステッドラー', 'STAEDTLER'],
  ぺんてる: ['ぺんてる', 'PENTEL'],
  コピック: ['コピック', 'COPIC'],
  ゴールデン: ['ゴールデン', 'GOLDEN'],
  リキテックス: ['リキテックス', 'LIQUITEX'],
  クサカベ: ['クサカベ', 'KUSAKABE'],
  ターナー: ['ターナー', 'TURNER'],
  シュミンケ: ['シュミンケ', 'SCHMINCKE'],
  セヌリエ: ['セヌリエ', 'SENNELIER'],
  デリーター: ['デリーター', 'DELETER'],
  'カラン・ダッシュ': ['カラン・ダッシュ', 'カランダッシュ', "CARAN D'ACHE"],
  'サム・トレーディング': ['サム・トレーディング', 'サム'],
  三菱鉛筆: ['三菱鉛筆', 'uni'],
  トンボ: ['トンボ鉛筆', 'トンボ'],
  'ルフラン＆ブルジョア': ['ルフラン＆ブルジョア', 'ルフラン'],
  名村大成堂: ['名村大成堂', '名村'],
  アシーナ: ['アシーナ'],
  ミューズ: ['ミューズ'],
  マービー: ['マービー'],
  墨運堂: ['墨運堂'],
  光栄堂: ['光栄堂'],
  ペベオ: ['ペベオ', 'PEBEO'],
  マイメリ: ['マイメリ', 'MAIMERI'],
  ダニエルスミス: ['ダニエルスミス', 'DANIEL SMITH'],
  呉竹: ['呉竹'],
};

export function buildAliases(makers) {
  const map = new Map();
  for (const m of makers) {
    const list = MAKER_ALIAS_EXTRA[m] || [m];
    for (const a of list) {
      const k = key(a);
      if (k.length >= 2) map.set(k, m);
    }
  }
  return [...map.entries()].sort((a, b) => b[0].length - a[0].length);
}

const SIZE_PATTERNS = [
  { re: /(\d+(?:\.\d+)?)\s*[×xX]\s*(\d+(?:\.\d+)?)(?:\s*[×xX]\s*(\d+(?:\.\d+)?))?\s*(mm|cm|m)?/g, kind: 'dim' },
  { re: /(\d+(?:\.\d+)?)号\s*\(\s*([^)]*?(?:ml|mL|g|L|ℓ|cc)[^)]*?)\s*\)/g, kind: 'gou-cap' },
  { re: /(\d+(?:\.\d+)?)号\s*-\s*([A-Z])(?![A-Za-z])/g, kind: 'gou-letter' },
  { re: /(\d+(?:\.\d+)?)\s*(ml|mL|ML|cc|ℓ|L|g|kg|oz|lb)(?![A-Za-z])/g, kind: 'volume' },
  { re: /(\d+)\s*(色セット|色|本セット|本入り|本入|本組|本|ダース|枚入り|枚入|枚セット|枚|個入|個|組|片|段)/g, kind: 'count' },
  { re: /\b(A[0-6]|B[0-6])\b/g, kind: 'paper' },
  { re: /(大衣|太子|半切|四切|八切|版画判|全紙|色紙判|キャビネ|六切|三切|小全紙)/g, kind: 'japan-paper' },
  { re: /(?<![ぁ-んァ-ヶー一-龯])インチ/g, kind: 'inch' },
  { re: /(\d+(?:\.\d+)?)号/g, kind: 'gou' },
  { re: /(\d+(?:\.\d+)?)\s*(mm|cm|ポンド|切|判|坪)(?![A-Za-zぁ-んァ-ヶ])/gi, kind: 'length' },
];

const PRODUCT_CODE_RES = [
  /\b([A-Z]{1,5}-[A-Z]{0,2}\d{1,6}[A-Z]{0,2})\b/g, // GHS-T14R / SE-4016
  /\b([A-Z]{1,4}-\d{1,3}[A-Z]-\d{1,4})\b/g, // PC-1M-48
  /\b([A-Z]{1,5}\d{1,6}[A-Z]{0,2}-\d{1,5})\b/g,
  /\b(\d{3,4}[A-Z]{1,3}-\d{1,5})\b/g,
  /\b(\d{4}-\d{1,3})\b/g,
  /\b([A-Z]{1,4}-\d{2,6})\b/g,
  /\b([A-Z]{1,5}\d{2,7}[A-Z]{0,2})\b/g,
];

const SPEC_WORDS = /(セット|色鉛筆|水彩|油絵|絵具|画筆|水彩筆|筆|紙|キャンバス|額縁|パレット|ケース|バッグ|ファイル|ノート|テープ|のり|はさみ|カッター|定規|消しゴム|鉛筆|ペン|マーカー|ローラー|ナイフ|スケール|マット|ボード|スケッチブック|クロッキー|画用液|メディウム|ニス|バーニッシュ|パステル|チョーク|インク|ジェッソ|粘土|陶土|フレーム|アルバム|ポスター|工作|クラフト|デッサン|製図|筆ペン|万年筆|ボールペン|シャープ|芯|替芯|ペイント|スプレー|スケール|クレヨン|ガッシュ|カラー|キット|ハーフパン|フルパン|ケーキ|スモール|ラージ|くれよん|ホルダー|バインダー|ケント|画帳|物差|分度器|コンパス|彫刻刀|パンチ|ステープラ|クリップ|ワイヤ|金具|額|マスキング|カード|ドット|シート|パッド|ブック|ロール|チューブ|ボトル|缶|箱|単色|各種|詰合|詰め合|アソート|バラ|業務用|大容量|特価|セール|用|付|入|タイプ|サイズ|柄|デザイン|シリーズ|モデル|式|パーツ|替|部品|本|枚|組|号|厚|幅|径|重量|約|パック|化粧箱|透明|乳白|系|木炭|コンテ|顔彩|墨)$/;

const STRONG_COLOR = /(ホワイト|ブラック|イエロー|レッド|ブルー|グリーン|ブラウン|オレンジ|バイオレット|ピンク|パープル|グレイ|グレー|アンバー|シェンナ|オーカー|セピア|カーマイン|マゼンタ|シアン|ゴールド|シルバー|パール|ウルトラマリン|コバルト|セルリアン|プルシアン|プルシャン|ビリジャン|ビリジアン|エメラルド|サップ|オリーブ|バーント|ロー|インディゴ|ローズ|コーラル|サーモン|スカーレット|バーミリオン|クリムソン|ワイン|ボルド|シャモア|セーブル|クロミアム|チタン|チタニウム|ジンク|カドミウム|ニッケル|ハンザ|キナクリドン|ベンズイミダゾロン|アリザリン|インディアン|ネイプルス|ネープルス|テラコッタ|サンド|ストロー|アイボリー|クリーム|レモン|マリーゴールド|アプリコット|ピーチ|ラベンダー|ライラック|モーブ|ヘリオトロープ|ターコイズ|アクア|ミント|フォレスト|モス|カーキ|セージ|フタロ|ウンバー|アッシュ|グラファイト|チャコール|メタリック|ルミナス|ネオン|ペイニーズ|ペインズ|オペラ|ブリリアント|ビスク|バナナ|カナリア|マスタード|ナフトール|イミダゾロン|ピロール|ジョーンブリヤン|インデンスロン|パーマネント|ナチュラル|ナポリ|マダー|セラミック|トランスペアレント|オペーク|ルビン|ルビー|サンゴ|ベージュ|タン|ココア|チョコ|キャラメル|メープル|シナモン|ブランデー|グレージュ|モカ|ラテ|ミルク|スノー|アイス|フロスト|ミスト|スモーク|シャドウ|ライト|ディープ|ミディアム|ペール|ダーク|ブライト|ビビッド|ソフト|ニュー|エクストラ|スーパー|モダン|ビンテージ|アンティーク|レトロ|クラシック|フレッシュ|リッチ|グロス|シルク|サテン|ベルベット|クリスタル|オパール|トパーズ|アメジスト|サファイア|ガーネット|トルマリン|ラピス|マラカイト|アジュール|ウルトラ|ネイビー|マリン|オーシャン|スカイ|エアー|ウォーター|ミントグリーン|ライム|リーフ|グラス|ジャングル|トロピカル|サボテン|バジル|ローズマリー|ティール|ラグーン|ペトロール|プール|アイビー|アボカド|ピスタチオ|クロム|クローム|テール|バンダイク|バント|蛍光|金属|真鍮|臙脂|群青|若草|萌黄|山吹|鳩羽|胡粉|代赭|弁柄|白緑|青緑|青磁|納戸|海松)/;

// 色名を持つのが自然なカテゴリ（絵具・色鉛筆・パステル・マーカー類・墨）
export const COLOR_BEARING = new Set([
  'oil', 'watercolor', 'acrylic', 'pastel', 'colored_pencil', 'crayon', 'charcoal', 'nihonga', 'copic', 'marker', 'pen',
]);

/* ---------------- 18カテゴリへの再分類 ---------------- */

// 判定はこの順番（上から）。狭い語を先に、広い語を後に置く。
// 例: 「色鉛筆」を「鉛筆」より先に、「コピック」を「マーカー」より先に、
//     「筆ペン」を「ペン」より後に（筆は既存カテゴリを壊さないため対象外）。
const CATEGORY_RULES = [
  { id: 'copic', re: /コピック|COPIC|Copic/i },
  {
    id: 'nihonga',
    // 固有名はそのまま。素の「墨」は色名・画材（墨色・青墨の絵具）を拾わないよう後段で絞る
    re: /日本画|顔彩|岩絵具|新岩|水干|胡粉|画仙|硯|膠|墨運堂|固形墨|液体墨|墨液|磨墨|写経用墨|墨滴|墨韻|超濃墨|淡墨|茶墨|朱墨|金墨|銀墨|白墨|彩墨|墨/,
    exclude: /墨色/,
  },
  { id: 'frame', re: /額縁|額装|額(?=[<〈《【（(\s]|$)/ },
  { id: 'frame', re: /フレーム(?!付)/, exclude: /付フレーム|フレーム付|キャンバス|パネル/ },
  { id: 'crayon', re: /クレヨン|くれよん|クレパス|クーピー/ },
  { id: 'colored_pencil', re: /色鉛筆|色えんぴつ|色エンピツ|水彩色鉛筆|パステル鉛筆/ },
  {
    id: 'charcoal',
    re: /木炭|チャコール|コンテ|カーボン(?!紙)/,
    // 「チャコールブラック」等の色名・「マイクロカーボン」等の芯は木炭ではない
    exclude: /チャコール(ブラック|グレー|グレイ|ブルー|色)|カーボンブラック|マイクロカーボン/,
  },
  {
    id: 'pastel',
    // 「パステルブルー」等は色名（マーカー・ペンの色）なので、パステル画材として扱わない
    re: /パステル(?!イエロー|ブルー|ピンク|グリーン|レッド|オレンジ|パープル|カラー|系|調|トーン)/,
  },
  { id: 'pencil', re: /鉛筆|えんぴつ|エンピツ|シャープペン|シャープペンシル|製図用シャープ/ },
  { id: 'marker', re: /マーカー|ポスカ|POSCA|プロッキー|マッキー|コピックモデラー/ },
  {
    id: 'pen',
    re: /サインペン|ボールペン|万年筆|筆ペン|筆ぺん|ガラスペン|ミリペン|デッサンペン|ピグマ|ペン(?!チング|キ|ダント|スタンド|ケース|ホルダー|先|軸|立て|タブ|ライト)|ゲルインク|水性ペン|油性ペン/,
  },
];

// 画材そのものではない事務用品・道具（色名に紛れた語で誤分類しないよう、判定の前に外す）
const NOISE_WORD = /(消しゴム|練り消し|テープ|シール|定規|はさみ|カッター|のり|ステープラ|ホッチキス|クリップ|シャープナー|鉛筆削り|マスキング)/;

// 画材の用途語（絵具そのもの・支持体・道具）。これがあるものは既存カテゴリを動かさない。
const MEDIUM_WORD = /(絵具|水彩|油絵|アクリル|ガッシュ|ポスターカラー|メディウム|画用液|インク|ジェッソ|バーニッシュ|ニス)/;
const SUPPORT_WORD = /(紙|スケッチブック|画帳|クロッキー|ブック|パッド|キャンバス|パネル|筆|刷毛|ナイフ|パレット|ケース|バッグ|ファイル|イーゼル|画架)/;

/**
 * 商品名（メーカー名を除いた語）から新しいカテゴリを判定する。
 * 該当が無ければ null（呼び出し側は今のカテゴリを残す）。
 */
export function detectCategory(text) {
  const t = NF(text);
  if (NOISE_WORD.test(t)) return null;
  for (const rule of CATEGORY_RULES) {
    if (!rule.re.test(t)) continue;
    if (rule.exclude && rule.exclude.test(t)) continue;
    return rule.id;
  }
  return null;
}

/**
 * 1件のカテゴリを決める。
 * - 既存8カテゴリは、その商品名が新しいカテゴリの語を強く示すときだけ動かす
 * - 「その他」は、当てはまる新カテゴリがあれば必ず動かす
 * - 絵具・支持体・道具の語が同居するものは動かさない（パステル用スケッチブック等の誤分類防止）
 * @returns {{category: string, changed: boolean}}
 */
export function classifyCategory({ name, maker, category }, { aliasList = [] } = {}) {
  const current = String(category || 'other');
  const full = NF(name);
  // コピックはメーカー名と商品名が一体（コピックスケッチ・コピックインク）なので先に見る
  if (maker === 'コピック' || /コピック|COPIC/i.test(full)) {
    return { category: 'copic', changed: current !== 'copic' };
  }
  let text = full;
  // メーカー名（と別名）を取り除いてから判定する（「サクラクレパス」の“クレパス”等を拾わない）
  for (const [alias, m] of aliasList) {
    if (m !== maker) continue;
    if (alias.length < 2) continue;
    text = text.split(new RegExp(escapeRe(alias), 'gi')).join(' ');
  }
  const hit = detectCategory(text);
  if (!hit || hit === current) return { category: current, changed: false };
  if (current === 'other') return { category: hit, changed: true };
  // 既存の絵具・紙・筆などは、用途語が同居していれば動かさない
  if (MEDIUM_WORD.test(text) || SUPPORT_WORD.test(text)) return { category: current, changed: false };
  return { category: hit, changed: true };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------------- 分解 ---------------- */

export function decompose(entry, ctx) {
  const { aliases, colorLex, tokFreq } = ctx;
  const maker = entry.maker || '';
  const category = entry.category || 'other';
  const raw = String(entry.name || '').trim();
  let w = NF(raw).replace(/\s{2,}/g, ' ').trim();
  const notes = { makerHits: [], dropped: [], specs: [] };

  let finish = '';
  const colorsFromBrackets = [];
  const specsFromBrackets = [];
  const sizeParts = [];
  let productCode = '';
  let colorCode = '';

  const aliasExact = (t) => aliases.find(([a]) => key(t) === a);

  // 0) 注記の除去
  w = w.replace(/※[^\s]*/g, ' ').replace(/シリーズ[:：]\s*\S+/g, ' ').replace(/[☆★●■◆▲■→⇒]/g, ' ');

  // 1) 括弧
  w = w.replace(/【([^】]*)】/g, (m, inner) => {
    const hit = aliasExact(inner);
    if (hit) { notes.makerHits.push(hit[1]); return ' '; }
    const pn = inner.match(/品番[:：]?\s*([0-9A-Za-z-]+)/);
    if (pn) { productCode = productCode || pn[1]; return ' '; }
    const vol = inner.match(/^(\d+(?:\.\d+)?)\s*(ml|mL|g|L|ℓ|cc)$/);
    if (vol) { sizeParts.push(vol[0]); return ' '; }
    if (/(品切|在庫|予約|お取り寄せ|送料|特価|セール|％|%OFF)/.test(inner)) { notes.dropped.push(inner); return ' '; }
    notes.specs.push(inner);
    return ' ';
  });
  w = w.replace(/[<〈《]([^>〉》]*)[>〉》]/g, (m, inner) => {
    const hit = aliasExact(inner);
    if (hit) { notes.makerHits.push(hit[1]); return ' '; }
    const c = inner.trim().replace(/^[A-Z]{1,3}\d{2,4}\s*/, '');
    if (!finish && c && JP.test(c)) finish = c;
    else notes.specs.push(inner);
    return ' ';
  });
  w = w.replace(/\[([^\]]*)\]/g, (m, inner) => {
    const t = inner.trim();
    if (/^\d{1,4}$/.test(t)) { colorCode = colorCode || t; return ' '; }
    if (/^[A-Z]{1,3}\d{1,4}$/.test(t)) { productCode = productCode || t; return ' '; }
    if (/^\d+\s*(色|本|枚|個|組|入)(セット)?$/.test(t)) { sizeParts.push(t); return ' '; }
    if (colorLex.has(key(t)) && key(t).length >= 2 && !/\d/.test(t)) { colorsFromBrackets.push(t); return ' '; }
    specsFromBrackets.push(t);
    return ' ';
  });
  w = w.replace(/\(([^)]*)\)/g, (m, inner) => {
    const t = inner.trim();
    const hit = aliasExact(t);
    if (hit) { notes.makerHits.push(hit[1]); return ' '; }
    if (/(ml|mL|g|L|ℓ|cc)(?![A-Za-z])/i.test(t) && !/^[A-Za-z]/.test(t)) { sizeParts.push(t); return ' '; }
    if (/^(旧|もと|formerly|新名)/.test(t)) { notes.dropped.push(t); return ' '; }
    if (/^[0-9A-Za-z-]{4,}$/.test(t)) { productCode = productCode || t; return ' '; }
    if (/^\d{1,4}$/.test(t)) { colorCode = colorCode || t; return ' '; }
    specsFromBrackets.push(t);
    return ' ';
  });

  // 2) メーカー名（単独の語・末尾の「メーカー名＋語」のみ）
  const stripMaker = (text) => {
    const out = [];
    for (const tok of text.split(/\s+/).filter(Boolean)) {
      let done = false;
      for (const [a, m] of aliases) {
        const kt = key(tok);
        if (kt === a) { notes.makerHits.push(m); done = true; break; }
        if (kt.endsWith(a) && kt.length - a.length >= 3) {
          const rest = tok.slice(0, tok.length - [...a].length).trim();
          if (PRODUCT_WORD.test(rest)) { notes.makerHits.push(m); out.push(rest); done = true; break; }
        }
      }
      if (!done) out.push(tok);
    }
    return out.join(' ');
  };
  w = stripMaker(w);

  // 3) サイズ
  const sizes = [...sizeParts];
  for (const p of SIZE_PATTERNS) {
    w = w.replace(p.re, (m, g1, g2) => {
      if (p.kind === 'length' && g2 === 'm') return m;
      sizes.push(m.trim());
      return ' ';
    });
  }
  const isBrushLike = category === 'brush' || category === 'copic' || category === 'marker' || category === 'pen'
    || /(ナイフ|刷毛|筆|ペン|マーカー|ローラー)/.test(raw);
  // キャンバス・額の号（F6/P10/M8/S0 など）と「◯角」
  if (category === 'canvas' || /(キャンバス|パネル|木枠|額|フレーム)/.test(raw)) {
    w = w.replace(/(?<![A-Z0-9])([FPSM])\s?(\d{1,3})(?![0-9A-Za-z])/g, (m, a, b) => { sizes.push(`${a}${b}`); return ' '; });
    w = w.replace(/(\d{2,3})\s*角/g, (m, n) => { sizes.push(`${n}角`); return ' '; });
  }
  w = w.replace(/No\.?\s*(\d+(?:\.\d+)?)/gi, (m, d) => {
    if (isBrushLike) sizes.push(`No.${d}`); else colorCode = colorCode || d;
    return ' ';
  });

  let size = '';
  const gou = sizes.find((s) => /号/.test(s));
  const vol = sizes.find((s) => /(ml|mL|g|L|ℓ|cc)\)?$/.test(s));
  if (gou && vol) {
    const g = (gou.match(/(\d+(?:\.\d+)?号)/) || [])[1];
    const v = vol.match(/(\d+(?:\.\d+)?\s*(?:ml|mL|g|L|ℓ|cc))/i);
    size = `${g}(${v[1].replace(/\s+/g, '')})`;
  } else {
    const seen = new Set();
    const uniq = [];
    for (const s of sizes.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); uniq.push(s);
    }
    size = uniq
      .sort((a, b) => a.length - b.length)
      .filter((s, i, arr) => !arr.some((o) => o !== s && o.toLowerCase().includes(s.toLowerCase())))
      .join(' ');
  }

  // マーカー類は英字＋数字の型番が色番（コピック E35 / トンボ ABT 569 など）
  const markerMaker = /(コピック|トンボ|呉竹|メクシー|カラン・ダッシュ|サクラクレパス|ぺんてる|マービー|ゼブラ|パイロット|ステッドラー|三菱鉛筆)/.test(maker);

  // 4) 品番
  if (!productCode) {
    for (const re of PRODUCT_CODE_RES) {
      w = w.replace(re, (m) => {
        if (/^(A[0-6]|B[0-6]|HB|RC|B|F)$/.test(m)) return m;
        productCode = productCode || m;
        return ' ';
      });
      if (productCode) break;
    }
  }
  w = w.replace(/\b(\d{5,9})\b/g, (m) => { productCode = productCode || m; return ' '; });
  if (!colorCode && productCode && markerMaker && /^[A-Z]{1,2}\d{1,3}[A-Z]?$/.test(productCode)) {
    colorCode = productCode; productCode = '';
  }
  w = w.replace(/(?:^|\s)(\d{2,4}\.\d{1,2})(?=\s|$)/g, (m, d) => { colorCode = colorCode || d; return ' '; });
  w = w.replace(/#\s*(\d{2,4})/g, (m, d) => { colorCode = colorCode || d; return ' '; });
  w = w.replace(/\b(\d{2,4})-(S\d)\b/g, (m, a, b) => { colorCode = colorCode || `${a}-${b}`; return ' '; });
  w = w.replace(/(\d)\s*(厚|幅|径|サイズ|用|付)(?=\s|$)/g, '$1 ');
  w = w.replace(/\s{2,}/g, ' ').replace(/^[\s#・]+|[\s#・]+$/g, '').trim();

  // 5) 色名とシリーズ
  const expectsColor = COLOR_BEARING.has(category)
    || (category === 'other' && (entry.colorName || /(色鉛筆|パステル|マーカー|インク|絵具|クレヨン|クレパス|油絵|水彩|ガッシュ|顔料|染料|スプレー|墨|コンテ|チョーク|くれよん)/.test(w)));
  const isFrame = /(額縁|フレーム)/.test(raw) || category === 'frame';

  let color = '';
  let series = w;

  const isColor = (c) => {
    if (!c) return false;
    const t = c.trim();
    const len = [...t].length;
    if (len < 1 || len > 26) return false;
    if (!JP.test(t)) return false;
    if (/^(大|小|中|特大|極小|木地|上|下)$/.test(t)) return false;
    if ([...t].length === 1) return /^(白|黒|赤|青|黄|緑|紫|茶|灰|桃|橙|金|銀|朱|緋|藍|藤|菫|茜|錆|焦|鉄|墨)$/.test(t);
    if (/\d/.test(t) && !/No\.?\s*\d/.test(t) && !/[^\d]\d{1,2}$/.test(t)) return false;
    if (/^(色|単色|各種|セット|バラ|詰合|大容量|特価|セール品?)$/.test(t)) return false;
    if (/(偏光|透明|不透明|パール|メタリック|艶消|つや消し|グロス|マット)色$/.test(t)) return false;
    if (SPEC_WORDS.test(t) && !STRONG_COLOR.test(t)) return false;
    if (len === 1 && !STRONG_COLOR.test(t)) return false;
    return true;
  };

  const MODIFIER = /^(ライト|ディープ|ミディアム|ペール|ダーク|ブライト|ビビッド|ソフト|ハード|ニュー|エクストラ|スーパー|モダン|ビンテージ|アンティーク|レトロ|クラシック|フレッシュ|リッチ|蛍光|偏光|パール|メタリック|明|浅|深|淡|濃|薄|中|超|極|特濃|イリディセント|イリデッセント|デュオクローム|ルミナス|クロマ|プライマリー|セカンダリー|グラニュレーティング|スーパーグラニュレーティング)$/;

  class TokClassifier {
    constructor() { this.cache = new Map(); }

    get(t) {
      if (this.cache.has(t)) return this.cache.get(t);
      let c;
      const k = key(t);
      if (/^\d+$/.test(t)) c = 'num';
      else if (SPEC_WORDS.test(t) && !/^(ホワイト|ブラック)$/.test(t)) c = 'spec';
      else if (colorLex.has(k) || STRONG_COLOR.test(t) || (/(いろ)$/.test(t) && JP.test(t))) c = 'color';
      else if ((tokFreq.get(k) || 0) >= 6) c = 'series';
      else if (JP.test(t)) c = 'other';
      else c = 'latin';
      this.cache.set(t, c);
      return c;
    }
  }
  const classifier = (ctx.classifier ||= new TokClassifier());

  const isIroToken = (t) => /(いろ|色)$/.test(t) && JP.test(t) && !/[\d]/.test(t);
  const isStrictColorToken = (t) => colorLex.has(key(t)) || STRONG_COLOR.test(t) || isIroToken(t);

  // 末尾の色名（強い色語を核に、修飾語だけ左右に広げる）
  const colorRun = (text) => {
    const toks = text.split(/\s+/).filter(Boolean);
    let j = -1;
    for (let i = toks.length - 1; i >= 0; i -= 1) {
      if (isStrictColorToken(toks[i]) && classifier.get(toks[i]) === 'color') { j = i; break; }
    }
    if (j < 0) return null;
    let start = j;
    let end = j + 1;
    while (start > 0) {
      const prev = toks[start - 1];
      const c = classifier.get(prev);
      if (c === 'color' && (MODIFIER.test(prev) || isStrictColorToken(prev))) start -= 1;
      else if (MODIFIER.test(prev) && c !== 'spec' && c !== 'num') start -= 1;
      else break;
    }
    while (end < toks.length) {
      const next = toks[end];
      if (MODIFIER.test(next) && classifier.get(next) !== 'spec') end += 1; else break;
    }
    return { colorTokens: toks.slice(start, end), start, end, toks };
  };

  // (a) 既存 colorName（系列名と連結していても色の部分だけ拾う）
  const cnRaw = NF(entry.colorName || '').trim();
  if (cnRaw && expectsColor) {
    const run = colorRun(cnRaw);
    const cand = run ? run.colorTokens.join(' ').trim() : '';
    if (cand && isColor(cand) && key(series).endsWith(key(cand)) && [...cand].length <= 26) {
      const chars = [...series];
      const n = [...cand].length;
      const rest = chars.slice(0, chars.length - n).join('').trim();
      if (rest || isStrictColorToken(cand)) {
        color = chars.slice(chars.length - n).join('').trim();
        series = rest;
      }
    }
  }
  // (e) 数字コード直後の色名（007パーマネント…）
  if (!color && series && expectsColor) {
    const m = series.match(/(?:^|\s)(\d{1,4})[\s.]*([^\d\s].{0,26})$/);
    if (m && isColor(m[2])) {
      colorCode = colorCode || m[1];
      color = m[2].trim();
      series = series.slice(0, m.index).trim();
    }
  }
  if (!color && finish && isColor(finish) && isFrame) color = finish;
  // (b) 強い色語を核にした色名
  if (!color && series && expectsColor) {
    const run = colorRun(series);
    if (run) {
      const cand = run.colorTokens.join(' ').trim();
      if (isColor(cand)) {
        color = cand;
        series = [...run.toks.slice(0, run.start), ...run.toks.slice(run.end)].join(' ').trim();
      }
    }
  }
  // (c) 語彙にない色名：末尾2トークンまで
  if (!color && series && expectsColor) {
    const parts = series.split(/\s+/).filter(Boolean);
    const cands = [];
    if (parts.length >= 2) cands.push(parts.slice(-2).join(' '));
    if (parts.length >= 1) cands.push(parts[parts.length - 1]);
    for (const cand of cands) {
      const toks = cand.split(' ');
      if (toks.some((t) => ['spec', 'num', 'series', 'latin'].includes(classifier.get(t)))) continue;
      if (toks.some((t) => /[A-Z]{2,}/.test(t))) continue;
      // 語彙に無い語を色名にしない（「素描木炭」のような材質名を拾わないため、色語を必ず含む）
      if (!toks.some((t) => isStrictColorToken(t))) continue;
      if (!isColor(cand)) continue;
      color = cand;
      series = parts.slice(0, parts.length - toks.length).join(' ').trim();
      break;
    }
  }
  // (d) 先頭トークン
  if (!color && series && expectsColor && /^\S+\s+\S/.test(series)) {
    const parts = series.split(/\s+/);
    const first = parts[0];
    if (isColor(first) && STRONG_COLOR.test(first) && !SPEC_WORDS.test(first)) { color = first; series = parts.slice(1).join(' ').trim(); }
  }
  if (!color && colorsFromBrackets.length) color = colorsFromBrackets[colorsFromBrackets.length - 1];
  if (!color && finish && isColor(finish) && isFrame) color = finish;

  // 既存の色名欄を保険に使う（系列名やラテン混じりの型番は除く）
  if (!color && expectsColor && cnRaw) {
    const cand = cnRaw.split(/\s{2,}|\s+/).filter(Boolean).pop() || '';
    if (cand && !/[A-Za-z]{2,}/.test(cand) && [...cand].length <= 14 && isColor(cand)
        && !SPEC_WORDS.test(cand) && (isStrictColorToken(cand) || /色$/.test(cand))) color = cand;
  }

  // セット品は単色ではない
  if (color && /\d+\s*色(セット)?/.test(size || '')) color = '';

  // 6) シリーズの掃除
  series = series
    .replace(/(^|\s)[A-Za-z]{1,2}(?=\s|$)/g, ' ')
    .replace(/(^|\s)-\d+(?=\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—・、,./:#]+|[\s\-–—・、,./:#]+$/g, '');
  const tail = series.match(/(?:^|\s)(\d{1,4})$/);
  if (tail) { colorCode = colorCode || tail[1]; series = series.slice(0, tail.index).trim(); }
  color = color.replace(/^[\s\-–—・、,./:]+|[\s\-–—・、,./:]+$/g, '');
  if (color && !isColor(color)) color = '';
  // 「画用木炭」のような材質名・道具名は色名にしない
  if (color && SPEC_WORDS.test(color) && !STRONG_COLOR.test(color)) color = '';

  const specText = [...specsFromBrackets, ...notes.specs].filter((s) => s && [...s].length > 1).join(' ').trim();
  if (specText && series) series = `${series} ${specText}`.trim();
  series = series
    .replace(/\s*-\s*(?=厚|幅口|並厚|特厚)(?=\S)/g, ' ') // 「バックボード - 厚 10枚組」の余分な「-」
    .replace(/\s*-\s*(厚|幅|径|サイズ|用|付|入|タイプ|セット|込)$/g, '')
    .replace(/\s{2,}/g, ' ').trim();

  // 7) 整頓後品名（シリーズ＋色名＋号数）
  let cleanName = [series, color, size].filter(Boolean).join(' ');
  if (!series && !color) {
    cleanName = stripMaker(NF(raw)).replace(/\s{2,}/g, ' ').replace(/^[\s\-–—・、,./]+|[\s\-–—・、,./]+$/g, '').trim();
  } else if (!series) {
    cleanName = [color, size].filter(Boolean).join(' ');
  }

  return {
    maker, category, makerInName: notes.makerHits.length > 0,
    series, color, size, code: colorCode, productCode, finish,
    cleanName, raw,
    notes: [...specsFromBrackets, ...notes.specs, ...notes.dropped, ...notes.makerHits].filter(Boolean),
  };
}

export function buildColorLex(dict) {
  const lex = new Map();
  const add = (word) => {
    const k = key(word);
    if (k.length >= 2 && k.length <= 30 && JP.test(k)) lex.set(k, (lex.get(k) || 0) + 1);
  };
  for (const d of dict) {
    const cn = NF(d.colorName || '').trim();
    if (!cn) continue;
    if (/\d/.test(cn)) continue;
    const parts = cn.split(/\s{2,}|\s+/).filter(Boolean);
    for (const p of parts) if (!SPEC_WORDS.test(p) || STRONG_COLOR.test(p)) add(p);
    if (parts.length > 1) add(cn);
  }
  return lex;
}

export function buildTokFreq(dict) {
  const freq = new Map();
  for (const d of dict) {
    for (const t of NF(d.name || '').split(/\s+/)) {
      const k = key(t);
      if (k) freq.set(k, (freq.get(k) || 0) + 1);
    }
  }
  return freq;
}
