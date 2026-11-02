// Structural checks plus a rough text-overflow estimate (the editor shows exact overflow).
import fs from 'node:fs';
import path from 'node:path';

const TYPES = new Set(['text', 'shape', 'image', 'chart', 'table']);
const EFFECTS = new Set(['fade', 'rise', 'drop', 'slide-left', 'slide-right', 'zoom', 'pop', 'blur', 'wipe-right', 'wipe-up', 'spin', 'count', 'grow', 'scene']);
const TRIGGERS = new Set(['click', 'with', 'after']);
const TRANSITIONS = new Set(['none', 'fade', 'slide', 'drift', 'zoom', 'rise']);
const THEMES = new Set(['paper', 'mono', 'forest', 'ink', 'navy']);
const PLACEHOLDERS = ['頁面標題', '簡報標題', '章節標題', '重點一', '在這裡寫一段說明文字。', '輸入文字', '左欄標題', '右欄標題', '說明文字', '數字說明', '圖片標題', '圖片說明文字', '在這裡放一句有力量的話。', '— 出處', '卡片一', '指標一', '階段一'];

function plainLines(html) {
  return String(html || '').split(/<br\s*\/?>/i).map(l => {
    // the small-unit span renders at .42em: count it at that width
    const small = [];
    const main = l.replace(/<span class="sm">(.*?)<\/span>/gi, (_, t) => { small.push(t.replace(/<[^>]+>/g, '')); return ''; });
    const strip = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return { text: strip(main), small: small.join('') };
  });
}

function charEm(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0x2e80 || (c >= 0x3000 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef)) return 1;
  if (ch === ' ') return 0.28;
  if (/[A-Z0-9]/.test(ch)) return 0.62;
  if (/[mwMW]/.test(ch)) return 0.8;
  if (/[il.,:;'|!]/.test(ch)) return 0.28;
  return 0.54;
}

export function estimateTextHeight(el) {
  const s = el.style || {};
  const size = s.size || 32, lh = s.lineHeight || 1.4, ls = s.letterSpacing || 0;
  const pad = (s.padding || 0) * 2;
  const indent = s.list === 'bullet' ? 1.15 : s.list === 'number' ? 1.6 : 0;
  const avail = Math.max(1, el.w - pad - indent * size);
  const para = (s.paraSpacing != null ? s.paraSpacing : (s.list ? 0.4 : 0)) * size;
  let lines = 0, widest = 0;
  const all = plainLines(el.text);
  for (const l of all) {
    let em = 0;
    for (const ch of l.text) em += charEm(ch) + ls;
    for (const ch of l.small) em += (charEm(ch) + ls) * 0.42;
    const px = em * size;
    widest = Math.max(widest, px);
    lines += Math.max(1, Math.ceil(px / avail - 0.02));
  }
  return { height: lines * size * lh + para * Math.max(0, all.length - 1) + pad, lines, widest };
}

export function validateDeck(deck, deckDir) {
  const errors = [], warnings = [];
  const err = (where, msg) => errors.push(`${where}：${msg}`);
  const warn = (where, msg) => warnings.push(`${where}：${msg}`);
  if (!deck || typeof deck !== 'object') { err('deck', '不是 JSON 物件'); return { errors, warnings }; }
  if (!Array.isArray(deck.slides) || !deck.slides.length) { err('deck', 'slides 必須是非空陣列'); return { errors, warnings }; }
  if (deck.theme && deck.theme.name && !THEMES.has(deck.theme.name)) warn('theme', `未知主題「${deck.theme.name}」，會改用 paper`);
  if (deck.transition && deck.transition.effect && !TRANSITIONS.has(deck.transition.effect)) warn('transition', `未知轉場「${deck.transition.effect}」`);
  const slideIds = new Set();
  (deck.slides || []).forEach((s, si) => {
    const sw = `第 ${si + 1} 頁`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) { err(sw, '必須是物件'); return; }
    if (!s.id) err(sw, '缺少 id');
    else if (slideIds.has(s.id)) err(sw, `id「${s.id}」重複`);
    slideIds.add(s.id);
    if (!Array.isArray(s.elements)) { err(sw, 'elements 必須是陣列'); return; }
    if (!s.elements.length) warn(sw, '是空白頁');
    const ids = new Set();
    for (const el of s.elements) {
      if (!el || typeof el !== 'object' || Array.isArray(el)) { err(sw, '元素必須是物件'); continue; }
      const w = `${sw}「${el.name || el.id || el.type}」`;
      if (!el.id) err(w, '缺少 id');
      else if (ids.has(el.id)) err(w, `id「${el.id}」重複`);
      ids.add(el.id);
      if (!TYPES.has(el.type)) { err(w, `未知 type「${el.type}」`); continue; }
      for (const k of ['x', 'y', 'w', 'h']) if (!Number.isFinite(el[k])) err(w, `${k} 必須是數字`);
      if (el.w <= 0 || el.h <= 0) err(w, 'w、h 必須大於 0');
      if (!el.hidden && Number.isFinite(el.x)) {
        if (el.x >= 1920 || el.y >= 1080 || el.x + el.w <= 0 || el.y + el.h <= 0) warn(w, '完全在畫面外');
        else if (!el.rotate && (el.x < -2 || el.y < -2 || el.x + el.w > 1922 || el.y + el.h > 1082) && !(el.type === 'shape' || el.type === 'image')) warn(w, '超出畫面邊界');
      }
      if (el.type === 'text') {
        const plain = String(el.text || '').replace(/<[^>]+>/g, '').trim();
        if (!plain) warn(w, '文字是空的');
        if (PLACEHOLDERS.includes(plain)) warn(w, `還是預設文字「${plain}」`);
        const est = estimateTextHeight(el);
        if (est.height > el.h * 1.08 + 4) warn(w, `文字可能超出框（估計需要高度 ${Math.round(est.height)}px，框高 ${el.h}px）`);
      }
      if (el.type === 'image') {
        if (!el.src) warn(w, '圖片框還沒有放圖片');
        else if (!/^(data:|https?:)/.test(el.src) && deckDir && !fs.existsSync(path.resolve(deckDir, el.src))) err(w, `找不到圖片檔 ${el.src}`);
      }
      if (el.type === 'chart') {
        const c = el.chart || {};
        if (!['bar', 'hbar', 'line', 'donut'].includes(c.kind || 'bar')) err(w, `未知圖表類型「${c.kind}」`);
        if (!Array.isArray(c.series) || !c.series.length) err(w, '圖表沒有 series');
        else for (const se of c.series) {
          if (!se || !Array.isArray(se.values)) { err(w, '系列 values 必須是陣列'); continue; }
          if (se.values.some(v => !Number.isFinite(v))) err(w, '圖表數值必須是有限數字');
          if (se.values.length !== (c.labels || []).length) warn(w, `系列「${se.name || ''}」的數值數量和 labels 不一致`);
        }
      }
      if (el.type === 'table' && !(el.table && Array.isArray(el.table.rows) && el.table.rows.length)) err(w, '表格沒有 rows');
    }
    const seen = new Set();
    if (s.build != null && !Array.isArray(s.build)) err(sw, 'build 必須是陣列');
    for (const b of (Array.isArray(s.build) ? s.build : [])) {
      if (!b || typeof b !== 'object' || Array.isArray(b)) { err(sw, '動畫必須是物件'); continue; }
      for (const k of ['delay', 'duration']) if (b[k] != null && (!Number.isFinite(b[k]) || b[k] < 0)) err(sw + ' 動畫', k + ' 必須是非負數字');
      const w = `${sw} 動畫`;
      if (!ids.has(b.id)) err(w, `指向不存在的元素「${b.id}」`);
      if (b.effect !== 'scene' && seen.has(b.id)) warn(w, `元素「${b.id}」重複出現，只會用第一次`);   // scene steps repeat on purpose
      seen.add(b.id);
      if (b.effect && !EFFECTS.has(b.effect)) err(w, `未知效果「${b.effect}」`);
      if (b.trigger && !TRIGGERS.has(b.trigger)) err(w, `未知觸發「${b.trigger}」`);
    }
    if (s.background && s.background.image && deckDir && !/^(data:|https?:)/.test(s.background.image) && !fs.existsSync(path.resolve(deckDir, s.background.image))) err(sw, `找不到背景圖 ${s.background.image}`);
  });
  return { errors, warnings };
}
