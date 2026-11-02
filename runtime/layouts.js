/* Grid Deck starter layouts. A layout only decides where elements start;
   every element stays freely movable in the editor afterwards.
   Loaded by the browser editor (window.GridDeckLayouts) and by Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GridDeckLayouts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const W = 1920, H = 1080, M = 120, CW = W - 2 * M;
  let seq = 0;

  function uid(prefix) {
    seq = (seq + 1) % 1296;
    return (prefix || 'e') + Date.now().toString(36).slice(-5) + seq.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 5);
  }

  // Content strings are stored HTML (subset); plain newlines become <br>.
  function rich(v) {
    if (Array.isArray(v)) return v.map(rich).join('<br>');
    return String(v == null ? '' : v).replace(/\r?\n/g, '<br>');
  }

  function T(x, y, w, h, html, style, name) {
    return {
      id: uid(), type: 'text', name: name || '', x, y, w, h, rotate: 0,
      text: rich(html),
      style: Object.assign({ font: 'body', size: 32, weight: 400, color: 'text', align: 'left', valign: 'top', lineHeight: 1.4 }, style || {}),
    };
  }

  function R(x, y, w, h, style, name, shape) {
    return { id: uid(), type: 'shape', shape: shape || 'rect', name: name || '', x, y, w, h, rotate: 0, style: Object.assign({ fill: 'surface', radius: 24 }, style || {}) };
  }

  function header(d, els) {
    if (d.kicker) els.push(T(M, 120, CW, 50, d.kicker, { size: 26, weight: 700, color: 'accent', letterSpacing: 0.06 }, '眉標'));
    els.push(T(M, 180, CW, 150, d.title || '頁面標題', { font: 'heading', size: 64, weight: 800, lineHeight: 1.15 }, '標題'));
  }

  function columns(n, gap) {
    const w = (CW - gap * (n - 1)) / n;
    return Array.from({ length: n }, (_, i) => ({ x: Math.round(M + i * (w + gap)), w: Math.round(w) }));
  }

  function valueHtml(value, unit) {
    return rich(value) + (unit ? '<span class="sm">' + unit + '</span>' : '');
  }

  const LAYOUTS = {
    cover: {
      label: '封面',
      build(d) {
        const els = [R(M, 300, 120, 12, { fill: 'accent', radius: 6 }, '色條')];
        if (d.kicker) els.push(T(M, 336, 1400, 50, d.kicker, { size: 28, weight: 700, color: 'accent', letterSpacing: 0.06 }, '眉標'));
        els.push(T(M, 400, 1560, 300, d.title || '簡報標題', { font: 'heading', size: 120, weight: 800, lineHeight: 1.1 }, '主標'));
        if (d.subtitle) els.push(T(M, 720, 1400, 120, d.subtitle, { size: 38, color: 'muted' }, '副標'));
        if (d.meta) els.push(T(M, 960, CW, 50, d.meta, { size: 24, color: 'muted' }, '資訊'));
        return els;
      },
    },
    section: {
      label: '章節頁',
      build(d) {
        const els = [T(M, 240, 800, 280, d.no || '01', { font: 'heading', size: 240, weight: 800, color: 'accent', lineHeight: 1 }, '章節號')];
        els.push(T(M, 540, 1560, 150, d.title || '章節標題', { font: 'heading', size: 96, weight: 800, lineHeight: 1.15 }, '標題'));
        if (d.subtitle) els.push(T(M, 720, 1400, 100, d.subtitle, { size: 34, color: 'muted' }, '副標'));
        return els;
      },
    },
    statement: {
      label: '標題＋段落',
      build(d) {
        const els = []; header(d, els);
        els.push(T(M, 360, 1440, 540, d.body || '在這裡寫一段說明文字。', { size: 36, lineHeight: 1.6 }, '內文'));
        return els;
      },
    },
    bullets: {
      label: '條列重點',
      build(d) {
        const els = []; header(d, els);
        const items = d.bullets && d.bullets.length ? d.bullets : ['重點一', '重點二', '重點三'];
        els.push(T(M, 360, 1500, 560, items, { size: 36, lineHeight: 1.5, list: 'bullet', paraSpacing: 0.5 }, '條列'));
        if (d.note) els.push(T(M, 960, CW, 50, d.note, { size: 22, color: 'muted' }, '註解'));
        return els;
      },
    },
    'two-column': {
      label: '左右兩欄',
      build(d) {
        const els = []; header(d, els);
        const cols = columns(2, 60);
        [d.left || {}, d.right || {}].forEach((c, i) => {
          const x = cols[i].x, w = cols[i].w;
          els.push(T(x, 360, w, 70, c.heading || (i ? '右欄標題' : '左欄標題'), { size: 40, weight: 800, color: i ? 'accent2' : 'accent' }, i ? '右標' : '左標'));
          const body = c.body || (c.bullets ? c.bullets : '說明文字');
          els.push(T(x, 450, w, 480, body, Object.assign({ size: 30, lineHeight: 1.6 }, Array.isArray(body) ? { list: 'bullet', paraSpacing: 0.4 } : {}), i ? '右文' : '左文'));
        });
        els.push(R(959, 360, 2, 540, { fill: 'line', radius: 0 }, '分隔線'));
        return els;
      },
    },
    'big-number': {
      label: '大數字',
      build(d) {
        const els = [];
        if (d.kicker) els.push(T(M, 240, CW, 60, d.kicker, { size: 30, weight: 700, color: 'accent', align: 'center', letterSpacing: 0.06 }, '眉標'));
        els.push(T(M, 320, CW, 360, valueHtml(d.value || '100', d.unit), { font: 'heading', size: 280, weight: 800, align: 'center', lineHeight: 1 }, '數字'));
        els.push(T(M, 700, CW, 80, d.label || '數字說明', { size: 44, weight: 700, align: 'center' }, '說明'));
        if (d.note) els.push(T(M, 800, CW, 120, d.note, { size: 28, color: 'muted', align: 'center' }, '註解'));
        return els;
      },
    },
    stats: {
      label: '多個數據卡',
      build(d) {
        const els = []; header(d, els);
        const items = (d.stats && d.stats.length ? d.stats : [{ value: '12', label: '指標一' }, { value: '34', label: '指標二' }, { value: '56', label: '指標三' }]).slice(0, 4);
        const cols = columns(items.length, 60);
        items.forEach((s, i) => {
          const { x, w } = cols[i];
          els.push(R(x, 360, w, 420, { fill: 'surface', radius: 28 }, '卡片 ' + (i + 1)));
          els.push(T(x + 48, 408, w - 96, 140, valueHtml(s.value, s.unit), { font: 'heading', size: items.length >= 4 ? 88 : 104, weight: 800, color: 'accent', lineHeight: 1.1 }, '數字 ' + (i + 1)));
          els.push(T(x + 48, 570, w - 96, 60, s.label || '', { size: 32, weight: 700 }, '標籤 ' + (i + 1)));
          if (s.desc) els.push(T(x + 48, 640, w - 96, 100, s.desc, { size: 24, color: 'muted', lineHeight: 1.5 }, '說明 ' + (i + 1)));
        });
        return els;
      },
    },
    cards: {
      label: '多張文字卡',
      build(d) {
        const els = []; header(d, els);
        const items = (d.cards && d.cards.length ? d.cards : [{ title: '卡片一', body: '說明' }, { title: '卡片二', body: '說明' }, { title: '卡片三', body: '說明' }]).slice(0, 4);
        const cols = columns(items.length, 60);
        items.forEach((c, i) => {
          const { x, w } = cols[i];
          els.push(R(x, 360, w, 460, { fill: 'surface', radius: 28 }, '卡片 ' + (i + 1)));
          els.push(T(x + 48, 408, w - 96, 50, c.no || String(i + 1).padStart(2, '0'), { size: 28, weight: 800, color: 'accent' }, '編號 ' + (i + 1)));
          els.push(T(x + 48, 468, w - 96, 100, c.title || '', { size: 36, weight: 800, lineHeight: 1.3 }, '卡片標題 ' + (i + 1)));
          els.push(T(x + 48, 580, w - 96, 200, c.body || '', { size: 26, color: 'muted', lineHeight: 1.6 }, '卡片內文 ' + (i + 1)));
        });
        return els;
      },
    },
    'image-text': {
      label: '圖文並排',
      build(d) {
        const right = d.imageSide === 'right';
        const imgX = right ? 960 : M, txtX = right ? M : 1080;
        const els = [{ id: uid(), type: 'image', name: '圖片', x: imgX, y: 120, w: 840, h: 840, rotate: 0, src: d.image || '', style: { fit: 'cover', radius: 28 } }];
        if (d.kicker) els.push(T(txtX, 240, 720, 50, d.kicker, { size: 26, weight: 700, color: 'accent', letterSpacing: 0.06 }, '眉標'));
        els.push(T(txtX, 300, 720, 250, d.title || '圖片標題', { font: 'heading', size: 60, weight: 800, lineHeight: 1.2 }, '標題'));
        els.push(T(txtX, 570, 720, 330, d.body || '圖片說明文字', { size: 30, color: 'muted', lineHeight: 1.6 }, '內文'));
        return els;
      },
    },
    quote: {
      label: '引言',
      build(d) {
        return [
          T(M, 120, 300, 300, '“', { font: 'heading', size: 320, weight: 800, color: 'accent', lineHeight: 1 }, '引號'),
          T(240, 330, 1440, 360, d.quote || '在這裡放一句有力量的話。', { font: 'heading', size: 64, weight: 700, lineHeight: 1.35 }, '引言'),
          T(240, 750, 1440, 60, d.author ? '— ' + d.author : '— 出處', { size: 30, color: 'muted' }, '出處'),
        ];
      },
    },
    timeline: {
      label: '時間軸／流程',
      build(d) {
        const els = []; header(d, els);
        const steps = (d.steps && d.steps.length ? d.steps : [{ label: '第一步', title: '階段一' }, { label: '第二步', title: '階段二' }, { label: '第三步', title: '階段三' }]).slice(0, 6);
        const colW = CW / steps.length;
        els.push(R(M, 543, CW, 4, { fill: 'line', radius: 2 }, '軸線'));
        steps.forEach((s, i) => {
          const x = Math.round(M + colW * i), w = Math.round(colW - 40);
          els.push(R(x, 525, 40, 40, { fill: 'accent', radius: 0 }, '節點 ' + (i + 1), 'ellipse'));
          els.push(T(x, 440, w, 60, s.label || '', { size: 26, weight: 800, color: 'accent' }, '時間 ' + (i + 1)));
          els.push(T(x, 600, w, 70, s.title || '', { size: 34, weight: 800 }, '階段 ' + (i + 1)));
          if (s.desc) els.push(T(x, 680, w, 200, s.desc, { size: 24, color: 'muted', lineHeight: 1.55 }, '說明 ' + (i + 1)));
        });
        return els;
      },
    },
    chart: {
      label: '圖表',
      build(d) {
        const els = []; header(d, els);
        const chart = d.chart || { kind: 'bar', labels: ['A', 'B', 'C', 'D'], series: [{ name: '數值', values: [12, 19, 8, 15] }], showValues: true };
        const withInsight = !!d.insight;
        els.push({ id: uid(), type: 'chart', name: '圖表', x: M, y: 360, w: withInsight ? 1080 : CW, h: 600, rotate: 0, chart, style: { size: 24 } });
        if (withInsight) {
          els.push(R(1260, 360, 540, 600, { fill: 'surface', radius: 28 }, '重點底'));
          els.push(T(1308, 408, 444, 50, d.insightTitle || '重點', { size: 26, weight: 800, color: 'accent' }, '重點標'));
          els.push(T(1308, 480, 444, 440, d.insight, { size: 30, lineHeight: 1.6 }, '重點文'));
        }
        return els;
      },
    },
    table: {
      label: '表格',
      build(d) {
        const els = []; header(d, els);
        const rows = [d.columns || ['項目', '方案 A', '方案 B']].concat(d.rows || [['成本', '低', '高'], ['速度', '快', '慢']]);
        els.push({ id: uid(), type: 'table', name: '表格', x: M, y: 360, w: CW, h: Math.min(600, 84 * rows.length), rotate: 0, table: { rows, header: true, highlightCol: d.highlightCol == null ? null : d.highlightCol }, style: { size: 28 } });
        if (d.note) els.push(T(M, 990, CW, 50, d.note, { size: 22, color: 'muted' }, '註解'));
        return els;
      },
    },
    closing: {
      label: '結尾',
      build(d) {
        const els = [R(900, 270, 120, 12, { fill: 'accent', radius: 6 }, '色條')];
        els.push(T(M, 330, CW, 200, d.title || '謝謝', { font: 'heading', size: 120, weight: 800, align: 'center', lineHeight: 1.1 }, '標題'));
        if (d.subtitle) els.push(T(M, 580, CW, 90, d.subtitle, { size: 38, color: 'muted', align: 'center' }, '副標'));
        if (d.contact) els.push(T(M, 720, CW, 60, d.contact, { size: 26, color: 'muted', align: 'center' }, '聯絡'));
        return els;
      },
    },
    blank: { label: '空白頁', build() { return []; } },
  };

  function buildSlide(d) {
    d = d || {};
    const layout = LAYOUTS[d.layout] ? d.layout : 'blank';
    const slide = {
      id: uid('s'), name: d.name || (d.title ? String(d.title).replace(/<[^>]+>/g, '').replace(/\n/g, ' ').slice(0, 24) : LAYOUTS[layout].label),
      layout, notes: d.notes || '', elements: LAYOUTS[layout].build(d), build: [],
    };
    if (d.background) slide.background = d.background;
    return slide;
  }

  function buildDeck(outline) {
    outline = outline || {};
    const now = new Date().toISOString();
    return {
      version: 1,
      meta: { title: outline.title || '未命名簡報', author: outline.author || '', stage: 'draft', createdAt: now, updatedAt: now },
      canvas: { width: W, height: H },
      grid: { size: 60, snap: true, show: true },
      theme: { name: outline.theme || 'paper', overrides: outline.themeOverrides || {} },
      transition: outline.transition || { effect: 'fade', duration: 500 },
      slides: (outline.slides || []).map(buildSlide),
    };
  }

  return { LAYOUTS, buildSlide, buildDeck, uid, W, H, M };
});
