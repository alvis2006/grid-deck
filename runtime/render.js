/* Grid Deck renderer: turns deck.json into DOM. Shared by editor, player and export. */
(function (G) {
  'use strict';

  const W = 1920, H = 1080;
  G.W = W; G.H = H;

  let seq = 0;
  G.uid = function (prefix) {
    seq = (seq + 1) % 1296;
    return (prefix || 'e') + Date.now().toString(36).slice(-5) + seq.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 5);
  };

  G.clone = function (v) { return JSON.parse(JSON.stringify(v)); };

  // ---------- deck defaults ----------
  G.normalizeDeck = function (deck) {
    deck = deck || {};
    deck.version = deck.version || 1;
    deck.meta = Object.assign({ title: '未命名簡報', author: '', stage: 'draft' }, deck.meta || {});
    deck.canvas = { width: W, height: H };
    deck.grid = Object.assign({ size: 60, snap: true, show: true }, deck.grid || {});
    deck.theme = Object.assign({ name: 'paper', overrides: {} }, deck.theme || {});
    deck.theme.overrides = deck.theme.overrides || {};
    deck.transition = Object.assign({ effect: 'fade', duration: 500 }, deck.transition || {});
    deck.slides = Array.isArray(deck.slides) ? deck.slides : [];
    for (const s of deck.slides) {
      s.id = s.id || G.uid('s');
      s.elements = Array.isArray(s.elements) ? s.elements : [];
      s.build = Array.isArray(s.build) ? s.build : [];
      s.notes = s.notes || '';
      for (const el of s.elements) {
        el.id = el.id || G.uid();
        el.x = +el.x || 0; el.y = +el.y || 0;
        el.w = Math.max(1, +el.w || 100); el.h = Math.max(1, +el.h || 100);
        el.rotate = +el.rotate || 0;
        el.style = el.style || {};
      }
    }
    return deck;
  };

  // ---------- rich text ----------
  const KEEP = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, BR: 1, SPAN: 1, DIV: 1, P: 1 };
  const DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1, TEMPLATE: 1, SVG: 1, MATH: 1 };
  G.SPAN_CLASSES = ['hl', 'hl2', 'hl3', 'mu', 'sm', 'mark'];

  function cleanTree(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1) { child.remove(); continue; }
      const tag = child.tagName.toUpperCase();
      if (DROP[tag]) { child.remove(); continue; }
      if (!KEEP[tag]) { cleanTree(child); child.replaceWith(...child.childNodes); continue; }
      const cls = tag === 'SPAN' ? Array.from(child.classList).filter(c => G.SPAN_CLASSES.includes(c)) : [];
      for (const a of Array.from(child.attributes)) child.removeAttribute(a.name);
      if (tag === 'SPAN' && !cls.length) { cleanTree(child); child.replaceWith(...child.childNodes); continue; }
      if (cls.length) child.className = cls.join(' ');
      cleanTree(child);
    }
  }

  G.sanitizeHtml = function (html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html == null ? '' : html);
    cleanTree(tpl.content);
    return tpl.innerHTML;
  };

  G.splitLines = function (html) {
    return String(html == null ? '' : html).split(/<br\s*\/?>/i);
  };

  G.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  // Read a contenteditable node back into the stored format: lines joined by <br>.
  G.serializeEditable = function (root) {
    const isBlock = n => n.nodeType === 1 && /^(DIV|P|LI)$/.test(n.tagName);
    function inlineHtml(n) {
      if (n.nodeType === 3) return G.escapeHtml(n.data);
      if (n.nodeType === 1) return n.outerHTML;
      return '';
    }
    function lines(container, block) {
      const out = []; let cur = ''; let has = false;
      const kids = Array.from(container.childNodes);
      kids.forEach((n, i) => {
        if (n.nodeType === 3 && /^\s*$/.test(n.data) && /\n/.test(n.data)) return;
        if (isBlock(n)) {
          if (has) { out.push(cur); cur = ''; has = false; }
          out.push(...lines(n, true));
        } else if (n.nodeType === 1 && n.tagName === 'BR') {
          if (block && i === kids.length - 1) return;
          out.push(cur); cur = ''; has = false;
        } else { cur += inlineHtml(n); has = true; }
      });
      if (has) out.push(cur);
      if (block && !out.length) out.push('');
      return out;
    }
    const ls = lines(root, false).map(l => G.sanitizeHtml(l).replace(/&nbsp;/g, ' '));
    while (ls.length > 1 && ls[ls.length - 1] === '') ls.pop();
    return ls.join('<br>');
  };

  // ---------- helpers ----------
  G.assetUrl = function (src, opts) {
    if (!src) return '';
    if (/^(data:|https?:|blob:|\/)/.test(src)) return src;
    return ((opts && opts.assetBase) || '') + src;
  };

  function px(n) { return Math.round(n * 100) / 100 + 'px'; }

  G.elementLabel = function (el) {
    if (el.name) return el.name;
    if (el.type === 'text') {
      const t = String(el.text || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      return t ? (t.length > 16 ? t.slice(0, 16) + '…' : t) : '文字';
    }
    return { shape: '形狀', image: '圖片', chart: '圖表', table: '表格' }[el.type] || el.type;
  };

  // ---------- element renderers ----------
  function renderText(el, inner) {
    const s = el.style || {};
    inner.style.display = 'flex';
    inner.style.flexDirection = 'column';
    inner.style.justifyContent = s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start';
    if (s.fill) inner.style.background = G.color(s.fill);
    if (s.padding) inner.style.padding = px(s.padding);
    if (s.radius) inner.style.borderRadius = px(s.radius);
    if (s.stroke && s.strokeWidth) inner.style.border = px(s.strokeWidth) + ' solid ' + G.color(s.stroke);
    const txt = document.createElement('div');
    txt.className = 'gd-txt' + (s.list === 'bullet' ? ' list-bullet' : s.list === 'number' ? ' list-number' : '');
    const font = s.font === 'heading' ? 'var(--gd-font-heading)' : s.font === 'mono' ? 'var(--gd-font-mono)' : 'var(--gd-font-body)';
    Object.assign(txt.style, {
      fontFamily: font,
      fontSize: px(s.size || 32),
      fontWeight: String(s.weight || 400),
      fontStyle: s.italic ? 'italic' : 'normal',
      color: G.color(s.color, 'var(--gd-text)'),
      textAlign: s.align || 'left',
      lineHeight: String(s.lineHeight || 1.4),
      letterSpacing: (s.letterSpacing || 0) + 'em',
    });
    txt.style.setProperty('--gd-lh', String(s.lineHeight || 1.4));
    if (s.paraSpacing != null || s.list) txt.style.setProperty('--gd-para', (s.paraSpacing != null ? s.paraSpacing : 0.4) + 'em');
    txt.innerHTML = G.splitLines(G.sanitizeHtml(el.text)).map(l => '<div class="ln">' + (l === '' ? '<br>' : l) + '</div>').join('');
    inner.appendChild(txt);
  }

  function renderShape(el, inner) {
    const s = el.style || {};
    const kind = el.shape || 'rect';
    if (kind === 'line') {
      inner.classList.add('gd-line');
      const line = document.createElement('div');
      line.className = 'gd-line-stroke';
      line.style.borderTop = px(s.strokeWidth || 4) + ' ' + (s.dash || 'solid') + ' ' + G.color(s.stroke || s.fill, 'var(--gd-line)');
      inner.appendChild(line);
      return;
    }
    inner.style.background = G.color(s.fill, 'transparent');
    if (s.stroke && s.strokeWidth) inner.style.border = px(s.strokeWidth) + ' ' + (s.dash || 'solid') + ' ' + G.color(s.stroke);
    if (kind === 'ellipse') inner.style.borderRadius = '50%';
    else if (kind === 'triangle') inner.style.clipPath = 'polygon(50% 0, 100% 100%, 0 100%)';
    else if (s.radius) inner.style.borderRadius = px(Math.min(s.radius, el.w / 2, el.h / 2));
  }

  function renderImage(el, inner, opts) {
    const s = el.style || {};
    if (s.radius) inner.style.borderRadius = px(s.radius);
    inner.style.overflow = 'hidden';
    if (s.stroke && s.strokeWidth) inner.style.border = px(s.strokeWidth) + ' solid ' + G.color(s.stroke);
    // An image with `scene` is a stand-in: when playing or printing, a scene registered in G.SCENES
    // (from a deck script) draws into a canvas instead. Build steps with effect 'scene' advance it.
    const make = el.scene && !(opts && (opts.editor || opts.thumb)) && G.SCENES && G.SCENES[el.scene];
    if (make) {
      const c = document.createElement('canvas');
      c.width = Math.round(el.w); c.height = Math.round(el.h);
      c.style.cssText = 'display:block;width:100%;height:100%';
      inner.appendChild(c);
      inner.parentNode.__scene = make(c, { w: el.w, h: el.h, still: !!(opts && opts.still) });
      return;
    }
    if (el.src) {
      const img = document.createElement('img');
      img.src = G.assetUrl(el.src, opts);
      img.alt = el.alt || '';
      img.draggable = false;
      img.style.objectFit = s.fit || 'cover';
      img.style.objectPosition = s.position || 'center';
      inner.appendChild(img);
    } else {
      inner.classList.add('gd-ph');
      inner.innerHTML = '<span>' + (opts && opts.editor ? '拖放圖片到這裡' : '圖片') + '</span>';
    }
  }

  function renderTable(el, inner) {
    const t = el.table || {};
    const s = el.style || {};
    const rows = Array.isArray(t.rows) ? t.rows : [];
    const table = document.createElement('table');
    table.className = 'gd-table';
    table.style.fontSize = px(s.size || 26);
    table.style.fontFamily = 'var(--gd-font-body)';
    rows.forEach((r, ri) => {
      const tr = document.createElement('tr');
      (r || []).forEach((cell, ci) => {
        const head = t.header !== false && ri === 0;
        const td = document.createElement(head ? 'th' : 'td');
        td.innerHTML = G.sanitizeHtml(cell);
        if (t.highlightCol != null && +t.highlightCol === ci) td.classList.add('hl-col');
        if (t.align && t.align[ci]) td.style.textAlign = t.align[ci];
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    inner.appendChild(table);
  }

  // ---------- charts (SVG) ----------
  const PALETTE = ['accent', 'accent2', 'accent3', 'muted', 'text'];
  function esc(s) { return G.escapeHtml(s); }
  function fmtNum(v) {
    const n = Number(v);
    if (!isFinite(n)) return '';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  G.chartSvg = function (el) {
    const c = el.chart || {};
    const w = el.w, h = el.h;
    const fs = (el.style && el.style.size) || 24;
    const kind = c.kind || 'bar';
    const labels = (c.labels || []).map(String);
    const series = (c.series || []).filter(s => s && Array.isArray(s.values));
    const colorOf = (i, s) => G.color((s && s.color) || PALETTE[i % PALETTE.length]);
    const fmt = v => esc((c.prefix || '') + fmtNum(v) + (c.unit || ''));
    const showValues = c.showValues !== false;
    const font = 'font-family:var(--gd-font-body)';
    let out = '';
    const legendOn = kind !== 'donut' && (c.showLegend != null ? c.showLegend : series.length > 1);
    let top = 0;
    if (legendOn) {
      let lx = 0;
      series.forEach((s, i) => {
        out += `<rect x="${lx}" y="${fs * 0.2}" width="${fs * 0.8}" height="${fs * 0.8}" rx="${fs * 0.16}" style="fill:${colorOf(i, s)}"/>`;
        out += `<text x="${lx + fs * 1.1}" y="${fs * 0.9}" style="${font};font-size:${fs * 0.9}px;fill:var(--gd-muted)">${esc(s.name || '系列 ' + (i + 1))}</text>`;
        lx += fs * 1.6 + String(s.name || '系列 1').length * fs * 0.95 + fs;
      });
      top = fs * 2;
    }
    const n = Math.max(labels.length, ...series.map(s => s.values.length), 1);
    const all = series.flatMap(s => s.values.map(Number)).filter(isFinite);
    const maxV = c.max != null ? +c.max : Math.max(1e-9, ...all, 0);
    const minV = c.min != null ? +c.min : 0;
    const span = Math.max(1e-9, maxV - minV);
    const hl = c.highlight != null && c.highlight !== '' && series.length === 1 ? +c.highlight : null;

    if (kind === 'bar') {
      const plotTop = top + (showValues ? fs * 1.6 : fs * 0.4), plotBottom = h - fs * 1.9;
      const plotH = Math.max(10, plotBottom - plotTop);
      const groupW = w / n, k = Math.max(1, series.length);
      const inner = groupW * (k > 1 ? 0.72 : 0.56), barW = inner / k;
      for (let i = 0; i < n; i++) {
        series.forEach((s, si) => {
          const v = Number(s.values[i]);
          if (!isFinite(v)) return;
          const bh = Math.max(0, (v - minV) / span * plotH);
          const x = groupW * i + (groupW - inner) / 2 + barW * si + barW * 0.06;
          const bw = barW * 0.88, y = plotBottom - bh;
          const dim = hl != null && hl !== i;
          out += `<rect class="gd-bar" x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${Math.min(8, bw / 6)}" style="fill:${dim ? 'var(--gd-muted)' : colorOf(si, s)};${dim ? 'opacity:.3;' : ''}transform-box:fill-box;transform-origin:50% 100%"/>`;
          if (showValues) out += `<text class="gd-val" x="${x + bw / 2}" y="${y - fs * 0.45}" text-anchor="middle" style="${font};font-size:${fs * 0.95}px;font-weight:700;fill:var(--gd-text)">${fmt(v)}</text>`;
        });
        out += `<text x="${groupW * (i + 0.5)}" y="${h - fs * 0.45}" text-anchor="middle" style="${font};font-size:${fs}px;fill:var(--gd-muted)">${esc(labels[i] || '')}</text>`;
      }
      out += `<line x1="0" y1="${plotBottom}" x2="${w}" y2="${plotBottom}" style="stroke:var(--gd-line);stroke-width:2"/>`;
    } else if (kind === 'hbar') {
      const maxLabel = Math.max(1, ...labels.map(l => l.length));
      const labelW = Math.min(w * 0.32, maxLabel * fs * 1.0 + fs);
      const valueW = showValues ? fs * 4.5 : fs;
      const plotW = Math.max(10, w - labelW - valueW);
      const rowH = (h - top) / n, k = Math.max(1, series.length);
      const inner = rowH * (k > 1 ? 0.74 : 0.56), barH = inner / k;
      for (let i = 0; i < n; i++) {
        const ry = top + rowH * i;
        series.forEach((s, si) => {
          const v = Number(s.values[i]);
          if (!isFinite(v)) return;
          const bw = Math.max(0, (v - minV) / span * plotW);
          const y = ry + (rowH - inner) / 2 + barH * si + barH * 0.06, bh = barH * 0.88;
          const dim = hl != null && hl !== i;
          out += `<rect class="gd-bar gd-bar-h" x="${labelW}" y="${y}" width="${bw}" height="${bh}" rx="${Math.min(8, bh / 6)}" style="fill:${dim ? 'var(--gd-muted)' : colorOf(si, s)};${dim ? 'opacity:.3;' : ''}transform-box:fill-box;transform-origin:0% 50%"/>`;
          if (showValues) out += `<text class="gd-val" x="${labelW + bw + fs * 0.4}" y="${y + bh / 2}" dominant-baseline="central" style="${font};font-size:${fs * 0.95}px;font-weight:700;fill:var(--gd-text)">${fmt(v)}</text>`;
        });
        out += `<text x="${labelW - fs * 0.6}" y="${ry + rowH / 2}" text-anchor="end" dominant-baseline="central" style="${font};font-size:${fs}px;fill:var(--gd-muted)">${esc(labels[i] || '')}</text>`;
      }
    } else if (kind === 'line') {
      const plotTop = top + (showValues ? fs * 1.8 : fs * 0.6), plotBottom = h - fs * 1.9;
      const plotH = Math.max(10, plotBottom - plotTop);
      const stepX = w / n;
      out += `<line x1="0" y1="${plotBottom}" x2="${w}" y2="${plotBottom}" style="stroke:var(--gd-line);stroke-width:2"/>`;
      series.forEach((s, si) => {
        const pts = [];
        for (let i = 0; i < n; i++) {
          const v = Number(s.values[i]);
          if (!isFinite(v)) continue;
          pts.push([stepX * (i + 0.5), plotBottom - (v - minV) / span * plotH, v]);
        }
        if (!pts.length) return;
        const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
        if (c.area) out += `<path class="gd-area" d="${d} L${pts[pts.length - 1][0]} ${plotBottom} L${pts[0][0]} ${plotBottom} Z" style="fill:${colorOf(si, s)};opacity:.12"/>`;
        out += `<path class="gd-line-path" pathLength="1" d="${d}" style="fill:none;stroke:${colorOf(si, s)};stroke-width:${Math.max(3, fs * 0.18)};stroke-linecap:round;stroke-linejoin:round"/>`;
        pts.forEach(p => {
          out += `<circle class="gd-dot" cx="${p[0]}" cy="${p[1]}" r="${fs * 0.3}" style="fill:var(--gd-bg);stroke:${colorOf(si, s)};stroke-width:${Math.max(3, fs * 0.14)}"/>`;
          if (showValues) out += `<text class="gd-val" x="${p[0]}" y="${p[1] - fs * 0.8}" text-anchor="middle" style="${font};font-size:${fs * 0.9}px;font-weight:700;fill:var(--gd-text)">${fmt(p[2])}</text>`;
        });
      });
      for (let i = 0; i < n; i++) out += `<text x="${stepX * (i + 0.5)}" y="${h - fs * 0.45}" text-anchor="middle" style="${font};font-size:${fs}px;fill:var(--gd-muted)">${esc(labels[i] || '')}</text>`;
    } else if (kind === 'donut') {
      const s = series[0] || { values: [] };
      const vals = s.values.map(Number).map(v => (isFinite(v) && v > 0 ? v : 0));
      const total = vals.reduce((a, b) => a + b, 0) || 1;
      const size = Math.min(h, w * 0.55);
      const cx = size / 2, cy = h / 2, sw = size * 0.15, r = size / 2 - sw / 2;
      const C = 2 * Math.PI * r;
      const colors = s.colors || PALETTE;
      let acc = 0;
      out += `<circle cx="${cx}" cy="${cy}" r="${r}" style="fill:none;stroke:var(--gd-line);stroke-width:${sw};opacity:.5"/>`;
      vals.forEach((v, i) => {
        const len = v / total * C;
        out += `<circle class="gd-seg" data-len="${len}" data-c="${C}" cx="${cx}" cy="${cy}" r="${r}" transform="rotate(-90 ${cx} ${cy})" style="fill:none;stroke:${G.color(colors[i % colors.length])};stroke-width:${sw};stroke-dasharray:${len} ${C - len};stroke-dashoffset:${-acc}"/>`;
        acc += len;
      });
      const center = c.centerLabel != null ? c.centerLabel : fmtNum(vals.reduce((a, b) => a + b, 0)) + (c.unit || '');
      out += `<text x="${cx}" y="${cy - (c.centerSub ? fs * 0.5 : 0)}" text-anchor="middle" dominant-baseline="central" style="font-family:var(--gd-font-heading);font-size:${fs * 1.8}px;font-weight:800;fill:var(--gd-text)">${esc(center)}</text>`;
      if (c.centerSub) out += `<text x="${cx}" y="${cy + fs * 1.1}" text-anchor="middle" dominant-baseline="central" style="${font};font-size:${fs * 0.9}px;fill:var(--gd-muted)">${esc(c.centerSub)}</text>`;
      const lx = size + fs * 1.6, rowH = Math.min(fs * 2.2, h / Math.max(1, vals.length));
      const ly0 = cy - rowH * vals.length / 2;
      vals.forEach((v, i) => {
        const y = ly0 + rowH * i + rowH / 2;
        out += `<rect x="${lx}" y="${y - fs * 0.4}" width="${fs * 0.8}" height="${fs * 0.8}" rx="${fs * 0.16}" style="fill:${G.color(colors[i % colors.length])}"/>`;
        out += `<text x="${lx + fs * 1.3}" y="${y}" dominant-baseline="central" style="${font};font-size:${fs}px;fill:var(--gd-text)">${esc(labels[i] || '')}</text>`;
        out += `<text x="${w}" y="${y}" text-anchor="end" dominant-baseline="central" style="${font};font-size:${fs}px;font-weight:700;fill:var(--gd-text)">${Math.round(v / total * 100)}%</text>`;
      });
    }
    return `<svg class="gd-chart-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible">${out}</svg>`;
  };

  function renderChart(el, inner) {
    inner.innerHTML = G.chartSvg(el);
  }

  // ---------- element & slide ----------
  G.renderElement = function (deck, el, opts) {
    opts = opts || {};
    const node = document.createElement('div');
    node.className = 'gd-el gd-' + el.type;
    node.dataset.id = el.id;
    node.style.left = px(el.x);
    node.style.top = px(el.y);
    node.style.width = px(el.w);
    node.style.height = px(el.h);
    if (el.rotate) node.style.transform = 'rotate(' + el.rotate + 'deg)';
    if (el.opacity != null && el.opacity !== 1) node.style.opacity = String(el.opacity);
    if (el.hidden) node.classList.add('gd-hidden');
    const inner = document.createElement('div');
    inner.className = 'gd-inner';
    node.appendChild(inner);
    try {
      if (el.type === 'text') renderText(el, inner);
      else if (el.type === 'shape') renderShape(el, inner);
      else if (el.type === 'image') renderImage(el, inner, opts);
      else if (el.type === 'chart') renderChart(el, inner);
      else if (el.type === 'table') renderTable(el, inner);
    } catch (err) {
      inner.textContent = '⚠ ' + err.message;
    }
    return node;
  };

  // ---------- backdrop: deck-wide background lines that pan between slides ----------
  // deck.backdrop = { color, duration, period, clearCenter, lines: [{ x1, y1, x2, y2, color, width, opacity, blur, speed }] }
  // The lines form a horizontally repeating band (period px). On slide i each line sits `speed * i` px
  // to the left, so moving forward pans the whole backdrop left like a camera, near (fast) lines more
  // than far (slow) ones. The player keeps one live copy and pans it during the transition; everywhere
  // else each slide draws its own pose.
  G.hasBackdrop = function (deck, slide) {
    return !!(deck.backdrop && Array.isArray(deck.backdrop.lines) && deck.backdrop.lines.length && !(slide && slide.background && slide.background.backdrop === false));
  };

  G.backdropOffset = function (line, index) {
    return { x: -(+line.speed || 0) * index, y: 0 };
  };

  // still = printing / screenshots: no blur filters there — they turn every PDF page into a big bitmap
  G.renderBackdrop = function (deck, index, still) {
    const bd = deck.backdrop;
    const wrap = document.createElement('div');
    wrap.className = 'gd-backdrop';
    const bg = G.color(bd.color || 'bg');
    wrap.style.background = bg;
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    const P = +bd.period || 2400, n = Math.max(1, deck.slides.length);
    for (const l of bd.lines) {
      // lengthen each line well past the canvas, and repeat it every P px to the right far enough
      // that panning to the last slide never runs out of lines
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1, len = Math.hypot(dx, dy) || 1, ext = 900;
      const x1 = l.x1 - dx / len * ext, y1 = l.y1 - dy / len * ext, x2 = l.x2 + dx / len * ext, y2 = l.y2 + dy / len * ext;
      const copies = Math.ceil(((+l.speed || 0) * (n - 1) + W) / P) + 1;
      const o = G.backdropOffset(l, index);
      let g = '<g class="gd-bl" style="transform:translate(' + o.x.toFixed(1) + 'px,' + o.y.toFixed(1) + 'px)">';
      for (let k = -1; k <= copies; k++) {
        g += '<line x1="' + (x1 + k * P).toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + (x2 + k * P).toFixed(1) + '" y2="' + y2.toFixed(1) + '"'
          + ' style="fill:none;stroke-linecap:round;stroke:' + G.color(l.color || 'muted') + ';stroke-width:' + (+l.width || 1)
          + ';opacity:' + (l.opacity == null ? 0.2 : +l.opacity) + (l.blur && !still ? ';filter:blur(' + (+l.blur) + 'px)' : '') + '"/>';
      }
      svg += g + '</g>';
    }
    wrap.innerHTML = svg + '</svg>';
    // clearCenter: a fixed veil of background colour, solid in the middle and clear toward the edges,
    // so the lines fade out in the centre while they move underneath (a gradient stays vector in PDFs)
    if (bd.clearCenter) {
      const c = bd.clearCenter === true ? {} : bd.clearCenter;
      const solid = 'color-mix(in srgb, ' + bg + ' ' + Math.round(100 * (1 - (c.inner == null ? 0.06 : c.inner))) + '%, transparent)';
      const veil = document.createElement('div');
      veil.className = 'gd-backdrop-veil';
      veil.style.background = 'radial-gradient(ellipse ' + (c.rx || 62) + '% ' + (c.ry || 58) + '% at 50% 50%, ' + solid + ' 0%, ' + solid + ' ' + (c.hold || 35) + '%, transparent 100%)';
      wrap.appendChild(veil);
    }
    return wrap;
  };

  // Pans an existing backdrop's lines to the pose of slide `index` over `ms` milliseconds.
  G.moveBackdrop = function (wrap, deck, index, ms) {
    const groups = wrap.querySelectorAll('g.gd-bl');
    deck.backdrop.lines.forEach((l, i) => {
      const n = groups[i];
      if (!n) return;
      const o = G.backdropOffset(l, index);
      n.style.transition = ms ? 'transform ' + ms + 'ms cubic-bezier(.45,0,.2,1)' : 'none';
      n.style.transform = 'translate(' + o.x.toFixed(1) + 'px,' + o.y.toFixed(1) + 'px)';
    });
  };

  G.renderSlide = function (deck, slide, opts) {
    opts = opts || {};
    const root = document.createElement('div');
    root.className = 'gd-slide' + (opts.editor ? ' gd-editing' : '');
    root.dataset.slide = slide.id;
    G.applyTheme(root, deck);
    const bg = slide.background || {};
    if (bg.color) root.style.background = G.color(bg.color);
    if (G.hasBackdrop(deck, slide)) {
      root.classList.add('gd-has-backdrop');
      root.appendChild(G.renderBackdrop(deck, Math.max(0, deck.slides.indexOf(slide)), !!opts.still));
    }
    if (bg.image) {
      const b = document.createElement('div');
      b.className = 'gd-bg';
      b.style.backgroundImage = 'url("' + G.assetUrl(bg.image, opts).replace(/"/g, '%22') + '")';
      b.style.backgroundSize = bg.fit || 'cover';
      if (bg.dim) b.style.opacity = String(1 - bg.dim);
      root.appendChild(b);
    }
    for (const el of slide.elements || []) {
      if (el.hidden && !opts.editor) continue;
      root.appendChild(G.renderElement(deck, el, opts));
    }
    return root;
  };
})(window.GridDeck = window.GridDeck || {});
