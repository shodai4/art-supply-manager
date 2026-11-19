/**
 * JAN辞書の表記揺れをそろえる共通ルール（内蔵辞書と Drive CSV 取り込みの両方から使う）。
 *
 *   1) 英語＋日本語の色名併記（VERMILION バーミリオン → バーミリオン）／英語はキーワードへ
 *   2) カタカナ色名の語間スペース（ブリリアント ピンク → ブリリアントピンク）
 *   3) 号数と容量の統一（6号 → 6号(20ml)。同じメーカー・シリーズ・号数で容量が1つに定まるものだけ）
 *   4) 基本の正規化
 *      - シリーズの分裂を1つに統合（NFKC・空白・中黒・大文字小文字を除いて同じもの）
 *      - 半角カタカナ → 全角カタカナ／全角英数字 → 半角英数字
 *      - 「メーカー｜英語名」「コクヨ KOKUYO」などの機械的な前置きを落とす
 *
 * JAN（第1要素）と件数は変えない。落とした語は検索用キーワードに残す。
 */

/* ---------------- 文字の正規化 ---------------- */

const HALF_KANA = /[\uFF61-\uFF9F]/;
const FULL_ALNUM = /[Ａ-Ｚａ-ｚ０-９]/;
const KATAKANA = /^[\u30A1-\u30F6\u30FC]+$/;
const KATA_CHAR = /[\u30A1-\u30F6\u30FC]/;

/** NFKC（半角カナ→全角カナ・全角英数→半角英数）。前後に余分な空白を残さない */
export function normalizeChars(value) {
  return String(value ?? '').replace(/[\u200D\uFE0F]/g, '').normalize('NFKC');
}

/** 全角英数字だけを半角へ（句読点はそのまま） */
export function halfWidthAlnum(value) {
  return String(value ?? '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => ch.normalize('NFKC'));
}

/** 連続する空白を1つに詰める */
function tidy(value) {
  return String(value ?? '').replace(/[\s\u3000]+/g, ' ').trim();
}

/** シリーズ名の同一判定に使う形（NFKC・小文字・空白/中黒/記号を除く） */
export function seriesKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000・･\-–—_/／.．,，]/g, '');
}

/** メーカー名の同一判定に使う形（NFKC・小文字・空白/中黒を除く） */
export function makerKey(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\u3000・･]/g, '');
}

/* ---------------- 1) 英語＋日本語の色名併記 ---------------- */

const CORE_COLORS = new Set(`white black red blue green yellow orange pink purple violet brown grey gray gold silver bronze copper cream ivory beige navy turquoise teal magenta cyan lime olive maroon crimson scarlet vermilion vermillion rose lemon peach salmon lavender lilac amber sapphire ruby emerald indigo sepia ochre ocher sienna umber charcoal viridian phthalo phthalocyanine quinacridone cobalt cadmium cerulean ultramarine alizarin gamboge carmine madder van dyke vandyke terre`.split(/\s+/));
const COLOR_MODIFIERS = new Set(`light deep pale brilliant bright dark soft luminous neon fluorescent medium extra super new clear pure rich vivid natural warm cool transparent permanent steel wine grass sea sky`.split(/\s+/));

/** 色名として並ぶ日本語（漢字）の語。英語の色名と対になっているときだけ使う */
const JAPANESE_COLORS = new Set('黒 赤 青 緑 黄 白 茶 灰 紫 桃 朱 藍 橙 金 銀 常盤 群青 深緑 薄橙 黄緑 青緑 赤紫 臙脂 山吹 蜜柑 薄紫 茜 紅 桜 墨'.split(/\s+/));

/**
 * 名前の中で、日本語の色名の直前に同じ色の英語名が併記されているかを見る。
 * 例: 「VERMILION バーミリオン」「LUMINOUS WHITE 蛍光ホワイト」「PASTA パスタ black 黒」
 * 英語がシリーズ名・品番（FRV, HWC, SSM など）のときは触らない。
 */
function findEnglishColorPrefix(name, colorName) {
  const cn = String(colorName || '').trim();
  if (!cn) return null;
  const at = name.indexOf(cn);
  if (at <= 0) return null;
  const before = name.slice(0, at);
  const m = /([A-Za-z][A-Za-z'’.\-]*(?:\(\d+\))?(?:\s+[A-Za-z][A-Za-z'’.\-]*(?:\(\d+\))?)*)\s+$/.exec(before);
  if (!m) return null;
  const phrase = m[1];
  const words = phrase.toLowerCase().split(/\s+/).map((w) => w.replace(/\(\d+\)$/, ''));
  if (!words.every((w) => CORE_COLORS.has(w) || COLOR_MODIFIERS.has(w))) return null;
  if (!words.some((w) => CORE_COLORS.has(w))) return null;
  // 小文字の英単語だけのときは、日本語の色名が漢字のもの（「black 黒」）に限る
  const kanjiColor = /^[一-龥]/.test(cn);
  if (!/^[A-Z]/.test(phrase) && !kanjiColor) return null;
  return { phrase, start: m.index };
}

/**
 * 色名の欄が空のものでも、「viridian 常盤」のように英語と漢字の色名が対になっていれば英語を落とす。
 * 漢字側は色名として使われる語に限る（「水」「砂」のような商品名の一部は触らない）。
 */
function findEnglishColorBeforeKanji(name) {
  const re = /([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*)*)\s+([^\s]+)\s/g;
  let m;
  while ((m = re.exec(name))) {
    const jp = m[2];
    if (!JAPANESE_COLORS.has(jp)) continue;
    const words = m[1].toLowerCase().split(/\s+/);
    if (!words.every((w) => CORE_COLORS.has(w) || COLOR_MODIFIERS.has(w))) continue;
    if (!words.some((w) => CORE_COLORS.has(w))) continue;
    return { phrase: m[1], start: m.index };
  }
  return null;
}

/* ---------------- 2) カタカナ色名の語間スペース ---------------- */

/** 色名（カタカナ）の中の空白を詰めた形。カタカナ以外を含むときは null */
function joinedKatakana(value) {
  const parts = String(value || '').trim().split(/[\s\u3000]+/).filter(Boolean);
  if (parts.length < 2) return null;
  if (!parts.every((p) => KATAKANA.test(p))) return null;
  return parts.join('');
}

/** 色名の文字の間に空白が入った形を名前から探す正規表現 */
function spacedColorRegex(joined) {
  const body = [...joined].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\u3000]*');
  return new RegExp(body, 'g');
}

/* ---------------- 3) 号数と容量 ---------------- */

const NUM_SIZE = /^(\d+)号(?:\((\d+(?:\.\d+)?)\s*m[lL]\))?$/;

/** 号数と容量の対応表（メーカー×シリーズ×号数 → 容量） */
export function buildCapacityMap(dict) {
  const seen = new Map();
  for (const d of dict) {
    const m = NUM_SIZE.exec(String(d.size || '').trim());
    if (!m || !m[2]) continue;
    const key = `${makerKey(d.maker)}\u0000${d.series || ''}\u0000${m[1]}`;
    if (!seen.has(key)) seen.set(key, new Map());
    const counts = seen.get(key);
    const cap = `${m[2]}ml`;
    counts.set(cap, (counts.get(cap) || 0) + 1);
  }
  const map = new Map();
  for (const [key, counts] of seen) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const [cap, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    // 同じ号数で容量が割れているときは、9割5分以上が同じ容量のときだけ採用する（推測で付けない）
    if (n / total >= 0.95) map.set(key, cap);
  }
  return map;
}

/* ---------------- 4) シリーズの統合 ---------------- */

/**
 * 同じメーカーの中で、表記だけが違うシリーズを1つにまとめる対応表。
 * 件数の多い表記を残し、同数のときは空白の少ない（カタカナを詰めた）表記を残す。
 */
export function buildSeriesMap(dict) {
  const groups = new Map();
  for (const d of dict) {
    const series = String(d.series || '').trim();
    if (!series) continue;
    const key = `${makerKey(d.maker)}\u0000${seriesKey(series)}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const variants = groups.get(key);
    variants.set(series, (variants.get(series) || 0) + 1);
  }
  const map = new Map();
  for (const [groupKey, variants] of groups) {
    if (variants.size < 2) continue;
    const maker = groupKey.split('\u0000')[0];
    const list = [...variants.entries()];
    list.sort((a, b) => (b[1] - a[1])
      || ((a[0].match(/[\s\u3000]/g) || []).length - (b[0].match(/[\s\u3000]/g) || []).length)
      || a[0].localeCompare(b[0], 'ja'));
    const keep = list[0][0];
    for (const [variant] of list.slice(1)) map.set(`${maker}\u0000${variant}`, keep);
  }
  return map;
}

/* ---------------- 4) 前置きの整理 ---------------- */

const LATIN_RUN = /^([A-Za-z][A-Za-z .&'’\-]*?)\s+(?=[^\x00-\x7F])/;

/**
 * 「メーカー｜英語名」の英語名を、メーカーごとに一番多い形から覚える。
 * 「ぺんてる｜Pentel FITLINE イエロー」の FITLINE のような商品名を巻き込まないため。
 */
export function buildEnglishNameMap(dict) {
  const runs = new Map();
  for (const d of dict) {
    const name = String(d.name || '');
    const at = name.search(/[｜|]/);
    if (at <= 0) continue;
    const pre = makerKey(name.slice(0, at).trim());
    const mk = makerKey(d.maker);
    if (!mk || !(pre === mk || (pre.startsWith(mk) && /^[a-z0-9]+$/.test(pre.slice(mk.length))))) continue;
    const m = LATIN_RUN.exec(name.slice(at + 1).trim());
    if (!m) continue;
    const run = m[1].trim();
    if (!runs.has(mk)) runs.set(mk, new Map());
    const counts = runs.get(mk);
    counts.set(run, (counts.get(run) || 0) + 1);
  }
  const map = new Map();
  for (const [mk, counts] of runs) {
    const [run] = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length))[0];
    map.set(mk, run);
  }
  return map;
}

/**
 * 「メーカー｜英語名 商品名」「コクヨ KOKUYO 商品名」などの機械的な前置きを落とす。
 * 落とした語はキーワードに残す（英語名で検索してもヒットする）。
 */
function stripPrefixes(name, entry, ctx) {
  let out = name;
  const dropped = [];
  const maker = String(entry.maker || '');
  const brand = String(entry.brand || '');
  const mk = makerKey(maker);
  const bk = makerKey(brand);

  const pipeAt = out.search(/[｜|]/);
  if (pipeAt > 0) {
    const pre = out.slice(0, pipeAt).trim();
    const post = out.slice(pipeAt + 1).trim();
    const pk = makerKey(pre);
    // 「和名｜英名 商品名」の和名がこのメーカーのときか、「ブランド｜和名 商品名」のブランドのときだけ落とす。
    // 「パイロット マグバー| り」のように商品名の中の記号は触らない。
    const makerLike = !!mk && (pk === mk || (pk.startsWith(mk) && /^[a-z0-9]+$/.test(pk.slice(mk.length))));
    const brandLike = !!bk && pk === bk;
    if (makerLike || brandLike) {
      let rest = post;
      // パイプ直後の英語名（決まった形のものだけ）を落とす
      const english = ctx.englishName?.get(mk) || '';
      if (english && rest.toLowerCase().startsWith(String(english).toLowerCase() + ' ')) {
        dropped.push(english);
        rest = rest.slice(english.length).trim();
      }
      // 残った先頭のメーカー名（「KOKUYO｜コクヨ ノート」の「コクヨ」）を落とす
      const head = rest.split(/[\s\u3000]/)[0];
      if (mk && makerKey(head) === mk && rest.length > head.length) {
        dropped.push(head);
        rest = rest.slice(head.length).trim();
      }
      if (rest) out = rest;
    }
  }

  // 「コクヨ KOKUYO 商品名」のようなメーカー名＋英語ブランドの重複
  const englishNames = [brand, ctx.englishName?.get(mk)].filter(Boolean).map((w) => makerKey(w));
  if (englishNames.length) {
    const head = out.split(/[\s\u3000]/)[0];
    const rest = out.slice(head.length);
    if (rest && makerKey(head) === mk) {
      const tailParts = rest.trim().split(/[\s\u3000]+/);
      if (tailParts.length > 1 && englishNames.includes(makerKey(tailParts[0]))) {
        dropped.push(tailParts[0]);
        out = tailParts.slice(1).join(' ');
      }
    }
  }
  return { name: out, dropped };
}

/* ---------------- まとめ ---------------- */

function addKeywords(keywords, words) {
  const have = String(keywords || '').split(/\s+/).filter(Boolean);
  const lower = new Set(have.map((w) => w.toLowerCase()));
  for (const word of words) {
    const w = String(word || '').trim();
    if (!w || lower.has(w.toLowerCase())) continue;
    have.push(w);
    lower.add(w.toLowerCase());
  }
  return have.join(' ');
}

/**
 * 1件の表記をそろえる（JANは触らない）。
 * @returns {{entry: object, changes: Array<{rule: string, field: string, from: string, to: string}>}}
 */
export function normalizeEntry(input, ctx = {}) {
  const entry = { ...input };
  const changes = [];
  const note = (rule, field, from, to) => {
    if (String(from) !== String(to)) changes.push({ rule, field, from: String(from ?? ''), to: String(to ?? '') });
  };
  const set = (rule, field, value) => {
    note(rule, field, entry[field], value);
    entry[field] = value;
  };

  /* --- 4b/4c) 半角カナ・全角英数 --- */
  for (const field of ['name', 'series', 'colorName', 'maker', 'size']) {
    const value = String(entry[field] ?? '');
    if (!value) continue;
    if (HALF_KANA.test(value)) set('half-kana', field, normalizeChars(value));
    else if (FULL_ALNUM.test(value)) set('full-alnum', field, halfWidthAlnum(value));
  }
  // 全角のハイフン（－）は半角へ（品番・型番の表記をそろえる）
  for (const field of ['name', 'series', 'size', 'code', 'maker']) {
    const value = String(entry[field] ?? '');
    if (value.includes('\uFF0D')) set('full-hyphen', field, value.replace(/\uFF0D/g, '-'));
  }
  // 数字の間の全角ピリオドと全角パーセントは半角へ（42．5L5％ → 42.5L5%）
  for (const field of ['name', 'size', 'code']) {
    const value = String(entry[field] ?? '');
    const next = value.replace(/(?<=\d)\uFF0E(?=\d)/g, '.').replace(/\uFF05/g, '%');
    if (next !== value) set('full-punct', field, next);
  }
  set('spaces', 'name', tidy(entry.name));

  // 容量の単位の表記をそろえる（20mL / 20ML → 20ml）
  for (const field of ['name', 'size']) {
    const value = String(entry[field] ?? '');
    const next = value.replace(/(\d+(?:\.\d+)?)\s*(?:mL|ML|Ml)\b/g, (_, n) => `${n}ml`);
    if (next !== value) set('size-unit', field, next);
  }

  /* --- 4d) 前置きの整理 --- */
  const stripped = stripPrefixes(String(entry.name || ''), entry, ctx);
  if (stripped.name && stripped.name !== entry.name) {
    set('prefix', 'name', tidy(stripped.name));
  }
  if (stripped.dropped.length) {
    // すでにメーカー名・ブランド名として検索できる語は、キーワードに増やさない
    const known = new Set([makerKey(entry.maker), makerKey(entry.brand)].filter(Boolean));
    const add = stripped.dropped.filter((w) => !known.has(makerKey(w)));
    if (add.length) set('prefix', 'keywords', addKeywords(entry.keywords, add));
  }

  /* --- 1) 英語＋日本語の色名併記 --- */
  const eng = findEnglishColorPrefix(String(entry.name || ''), entry.colorName)
    || (entry.colorName ? null : findEnglishColorBeforeKanji(String(entry.name || '')));
  if (eng) {
    const name = tidy(`${entry.name.slice(0, eng.start)} ${entry.name.slice(eng.start + eng.phrase.length)}`);
    set('english-color', 'name', name);
    set('english-color', 'keywords', addKeywords(entry.keywords, [eng.phrase]));
  }

  /* --- 2) カタカナ色名の語間スペース --- */
  const joined = joinedKatakana(entry.colorName);
  const cn = joined || String(entry.colorName || '').trim();
  if (cn && KATA_CHAR.test(cn) && !/[^\u30A1-\u30F6\u30FC]/.test(cn)) {
    const re = spacedColorRegex(cn);
    const spaced = String(entry.name || '').replace(re, (match) => (/[\s\u3000]/.test(match) ? cn : match));
    if (spaced !== entry.name) set('kana-space', 'name', tidy(spaced));
  }
  if (joined) set('kana-space', 'colorName', joined);

  /* --- 3) 号数と容量 --- */
  const sizeMatch = /^(\d+)号$/.exec(String(entry.size || '').trim());
  if (sizeMatch && ctx.capacityMap) {
    const key = `${makerKey(entry.maker)}\u0000${entry.series || ''}\u0000${sizeMatch[1]}`;
    const cap = ctx.capacityMap.get(key);
    if (cap) {
      set('size-capacity', 'size', `${sizeMatch[1]}号(${cap})`);
      const re = new RegExp(`(^|[\\s\u3000])${sizeMatch[1]}号(?![\\s\\u3000]*[-(（])`, 'g');
      const name = String(entry.name || '').replace(re, (m, p1) => `${p1}${sizeMatch[1]}号(${cap})`);
      if (name !== entry.name) set('size-capacity', 'name', tidy(name));
    }
  }

  /* --- 4a) シリーズの統合 --- */
  if (entry.series && ctx.seriesMap) {
    const keep = ctx.seriesMap.get(`${makerKey(entry.maker)}\u0000${entry.series}`);
    if (keep && keep !== entry.series) set('series-merge', 'series', keep);
  }

  return { entry, changes };
}

/** 辞書全体をそろえる（対応表は元の辞書から作る） */
export function normalizeDictionary(dict, { capacityMap, seriesMap, englishName } = {}) {
  const caps = capacityMap || buildCapacityMap(dict);
  const series = seriesMap || buildSeriesMap(dict);
  const english = englishName || buildEnglishNameMap(dict);
  const changes = [];
  const out = dict.map((row) => {
    const { entry, changes: diff } = normalizeEntry(row, { capacityMap: caps, seriesMap: series, englishName: english });
    for (const c of diff) changes.push({ jan: row.jan, ...c });
    return entry;
  });
  return { dict: out, changes };
}
