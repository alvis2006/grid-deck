/* Grid Deck editor: grid-snapped drag / resize / rotate, text editing, animation pane, autosave. */
(function () {
  'use strict';
  const G = window.GridDeck, L = window.GridDeckLayouts;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const THUMB_W = 168;
  const ASSET_BASE = '/deck/';
  const STAGE_LABEL = { draft: '草稿', 'static-confirmed': '靜態稿已確認', animated: '動畫已確認', exported: '已匯出' };
  const TYPE_LABEL = { text: '文字', shape: '形狀', image: '圖片', chart: '圖表', table: '表格' };

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'value') n.value = v;
        else if (k === 'checked') n.checked = !!v;
        else if (k === 'text') n.textContent = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }

  const E = {
    deck: null, rev: 0, si: 0, sel: new Set(), mode: 'edit', scale: 1,
    undo: [], redo: [], dirty: false, seq: 0, saving: false, saveAgain: false, conflict: false,
    editingId: null, textBefore: null, slideNode: null, dragging: false, lastNudge: 0,
    base: null, pendingExternal: false,   // base: the deck as last read from / written to the file (JSON)
  };

  const slide = () => E.deck.slides[E.si];
  const els = () => (slide() ? slide().elements : []);
  const elById = id => els().find(e => e.id === id);
  const nodeOf = id => (E.slideNode ? E.slideNode.querySelector('[data-id="' + CSS.escape(id) + '"]') : null);
  const selected = () => Array.from(E.sel).map(elById).filter(Boolean);
  const gridSize = () => +E.deck.grid.size || 60;
  const snapG = v => Math.round(v / gridSize()) * gridSize();
  const plain = html => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  // ---------- status / toast ----------
  function setStatus(text, cls) { const s = $('#status'); s.textContent = text; s.className = 'status ' + (cls || ''); }
  let toastT = 0;
  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 2400);
  }

  // ---------- history ----------
  function pushHistory() {
    E.undo.push(JSON.stringify(E.deck));
    if (E.undo.length > 200) E.undo.shift();
    E.redo = [];
    updateUndoButtons();
  }
  function pushSnap(snap) { E.undo.push(snap); if (E.undo.length > 200) E.undo.shift(); E.redo = []; updateUndoButtons(); }
  function undo() {
    commitTextEdit();
    if (!E.undo.length) return;
    E.redo.push(JSON.stringify(E.deck));
    E.deck = JSON.parse(E.undo.pop());
    afterRestore();
  }
  function redo() {
    commitTextEdit();
    if (!E.redo.length) return;
    E.undo.push(JSON.stringify(E.deck));
    E.deck = JSON.parse(E.redo.pop());
    afterRestore();
  }
  function afterRestore() {
    E.si = Math.max(0, Math.min(E.si, E.deck.slides.length - 1));
    E.sel = new Set(Array.from(E.sel).filter(id => elById(id)));
    renderAll();
    changed();
  }
  function updateUndoButtons() { $('#undo').disabled = !E.undo.length; $('#redo').disabled = !E.redo.length; }

  // Records an undo snapshot on the first change after focus, so focusing alone adds no history.
  function histInput(input, apply, evt) {
    let snap = null;
    input.addEventListener('focus', () => { snap = JSON.stringify(E.deck); });
    input.addEventListener(evt || 'input', () => { if (snap) { pushSnap(snap); snap = null; } apply(); });
    return input;
  }

  // ---------- save / sync ----------
  function changed() {
    E.dirty = true; E.seq++;
    setStatus('未儲存', 'dirty');
    clearTimeout(E.saveT); E.saveT = setTimeout(save, 600);
    scheduleThumb();
    updateUndoButtons();
  }

  async function save() {
    if (E.conflict) return;
    if (E.saving) { E.saveAgain = true; return; }
    E.saving = true;
    const seq = E.seq;
    const sent = JSON.stringify(E.deck);
    setStatus('儲存中…', 'saving');
    try {
      const r = await fetch('/api/deck', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"baseRev":' + E.rev + ',"deck":' + sent + '}' });
      // The file changed underneath us: merge it in (syncExternal runs from finally) instead of stopping.
      if (r.status === 409) { E.pendingExternal = true; }
      else if (!r.ok) throw new Error('HTTP ' + r.status);
      else {
        const j = await r.json();
        E.rev = j.rev; E.base = sent;
        if (E.seq === seq) { E.dirty = false; setStatus('已儲存', 'ok'); }
      }
    } catch (err) {
      setStatus('儲存失敗，重試中', 'err');
      clearTimeout(E.saveT); E.saveT = setTimeout(save, 3000);
    } finally {
      E.saving = false;
      if (E.pendingExternal) { E.saveAgain = false; syncExternal(); }
      else if (E.saveAgain) { E.saveAgain = false; save(); }
    }
  }

  async function flushSave() {
    clearTimeout(E.saveT);
    for (let i = 0; i < 200 && (E.saving || E.dirty) && !E.conflict; i++) {
      if (!E.saving) await save(); else await sleep(50);
    }
    return !E.dirty && !E.saving && !E.conflict && !E.pendingExternal;
  }

  async function load(keepView) {
    const r = await fetch('/api/deck');
    if (!r.ok) throw new Error('讀取 deck.json 失敗（HTTP ' + r.status + '）');
    const j = await r.json();
    const deck = G.normalizeDeck(j.deck);
    if (!deck.slides.length) deck.slides.push(L.buildSlide({ layout: 'blank' }));
    if (keepView) applyDeck(deck, j.rev);
    else {
      E.deck = deck; E.rev = j.rev; E.base = JSON.stringify(deck); E.dirty = false;
      E.si = 0; E.sel.clear();
      renderAll();
    }
    setStatus('已儲存', 'ok');
  }

  // Puts a deck read from the file (or merged with it) into the editor, keeping the current slide.
  // Undo history is cleared: its snapshots predate the outside change and would silently undo it.
  function applyDeck(deck, rev, baseText) {
    const curId = E.deck && E.deck.slides[E.si] ? E.deck.slides[E.si].id : null;
    E.deck = deck; E.rev = rev; E.base = baseText || JSON.stringify(deck);
    E.dirty = false; E.undo = []; E.redo = [];
    const i = curId ? E.deck.slides.findIndex(s => s.id === curId) : -1;
    E.si = i >= 0 ? i : Math.max(0, Math.min(E.si, E.deck.slides.length - 1));
    E.sel = new Set(Array.from(E.sel).filter(id => elById(id)));
    renderAll();
  }

  // Three-way merge by slide: base = last synced file, local = this editor, remote = file now.
  // Returns null when both sides changed the same slide (or the slide order, or the same deck setting).
  function mergeDecks(base, local, remote) {
    const S = x => JSON.stringify(x);
    const ids = d => d.slides.map(s => s.id);
    const byId = d => new Map(d.slides.map(s => [s.id, s]));
    const B = byId(base), Lc = byId(local), R = byId(remote);
    const changedIn = M => {
      const set = new Set();
      for (const [id, s] of M) if (!B.has(id) || S(B.get(id)) !== S(s)) set.add(id);
      for (const id of B.keys()) if (!M.has(id)) set.add(id);
      return set;
    };
    const cl = changedIn(Lc), cr = changedIn(R);
    const clash = [...cl].filter(id => cr.has(id) && S(Lc.get(id)) !== S(R.get(id)));
    const pageOf = id => { const n = ids(local).indexOf(id); return n >= 0 ? n + 1 : ids(remote).indexOf(id) + 1; };
    if (clash.length) return { clash: clash.map(pageOf) };
    const orderL = S(ids(local)) !== S(ids(base)), orderR = S(ids(remote)) !== S(ids(base));
    if (orderL && orderR && S(ids(local)) !== S(ids(remote))) return { clash: [] };
    const merged = Object.assign({}, remote);
    for (const k of ['theme', 'transition', 'grid', 'canvas']) {
      const lc = S(local[k]) !== S(base[k]), rc = S(remote[k]) !== S(base[k]);
      if (lc && rc && S(local[k]) !== S(remote[k])) return { clash: [] };
      if (lc) merged[k] = local[k];
    }
    merged.slides = (orderL ? ids(local) : ids(remote))
      .map(id => (cl.has(id) && Lc.has(id) ? Lc.get(id) : R.get(id) || Lc.get(id)))
      .filter(Boolean);
    const mine = [...cl].filter(id => Lc.has(id)).map(pageOf).sort((a, b) => a - b);
    return { deck: merged, mine };
  }

  // Brings in a change made outside the editor (Claude editing deck.json). Waits while the user is
  // typing, dragging or saving; merges by slide when there are unsaved edits; asks only on a real clash.
  async function syncExternal() {
    if (E.conflict) return;
    if (E.dragging || E.editingId || E.saving) { E.pendingExternal = true; return; }
    E.pendingExternal = false;
    let j;
    try {
      const r = await fetch('/api/deck', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      j = await r.json();
    } catch (e) { E.pendingExternal = true; setTimeout(syncExternal, 1500); return; }
    if (E.dragging || E.editingId || E.saving) { E.pendingExternal = true; return; }
    if (j.rev === E.rev) return;
    const remote = G.normalizeDeck(j.deck);
    const remoteText = JSON.stringify(remote);
    if (!E.dirty) {
      applyDeck(remote, j.rev, remoteText);
      setStatus('已儲存', 'ok');
      toast('已載入 deck.json 的最新修改');
      return;
    }
    const m = mergeDecks(JSON.parse(E.base || remoteText), E.deck, remote);
    if (m.clash) { showConflict(j.rev, m.clash); return; }
    applyDeck(m.deck, j.rev, remoteText);
    E.dirty = true; E.seq++;
    clearTimeout(E.saveT);
    save();
    toast('已合併：保留你在第 ' + m.mine.join('、') + ' 頁的修改，也載入了檔案的新修改', 3600);
  }

  function listen() {
    const es = new EventSource('/api/events');
    es.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type !== 'external' || m.rev === E.rev) return;
      syncExternal();
    };
  }

  function showConflict(rev, pages) {
    E.conflict = true;
    const where = pages && pages.length ? '，而且和你這裡還沒儲存的修改是同一頁（第 ' + pages.join('、') + ' 頁）' : '，而且和你這裡還沒儲存的修改衝突';
    const b = $('#banner');
    b.innerHTML = '';
    b.append(
      h('span', { class: 'msg', text: 'deck.json 被其他地方修改了（可能是 Claude 剛改過）' + where + '。選一個版本之前不會存檔。' }),
      h('button', { onclick: () => { E.conflict = false; b.hidden = true; load(true).then(() => toast('已載入檔案版本')); } }, '載入檔案版本（捨棄我的修改）'),
      h('button', { class: 'primary', onclick: () => { E.conflict = false; b.hidden = true; E.rev = rev; save(); } }, '保留我的版本（覆蓋檔案）'),
    );
    b.hidden = false;
  }

  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { /* not json */ }
    if (!r.ok) throw new Error((j && j.error) || text || ('HTTP ' + r.status));
    return j;
  }

  // ---------- top-level render ----------
  function renderAll() { renderTopbar(); renderSlideList(); renderCanvas(); renderInspector(); renderNotes(); updateUndoButtons(); }

  function renderTopbar() {
    $('#deck-title').value = E.deck.meta.title || '';
    $('#grid-show').checked = !!E.deck.grid.show;
    $('#grid-snap').checked = !!E.deck.grid.snap;
    $('#grid-size').value = String(gridSize());
    $('#theme-select').value = E.deck.theme.name;
    const badge = $('#stage-badge');
    badge.textContent = STAGE_LABEL[E.deck.meta.stage] || '草稿';
    badge.dataset.stage = E.deck.meta.stage || 'draft';
    $$('.tab').forEach(t => { t.classList.toggle('active', t.dataset.mode === E.mode); t.setAttribute('aria-selected', String(t.dataset.mode === E.mode)); });
    $('#insert-group').style.display = E.mode === 'edit' ? '' : 'none';
    $('#confirm-btn').textContent = E.mode === 'edit' ? '✓ 確認靜態稿' : '✓ 確認動畫';
    document.body.dataset.mode = E.mode;
    document.title = (E.deck.meta.title || 'Grid Deck') + ' · Grid Deck';
  }

  function renderNotes() { $('#notes').value = (slide() && slide().notes) || ''; }

  // ---------- slide list ----------
  function thumbRender(s) {
    const n = G.renderSlide(E.deck, s, { assetBase: ASSET_BASE, thumb: true });
    n.style.transform = 'scale(' + THUMB_W / G.W + ')';
    n.style.transformOrigin = '0 0';
    return n;
  }

  function renderSlideList() {
    const list = $('#slide-list');
    list.innerHTML = '';
    E.deck.slides.forEach((s, i) => list.append(thumbItem(s, i)));
    const a = list.children[E.si];
    if (a) a.scrollIntoView({ block: 'nearest' });
  }

  function thumbItem(s, i) {
    const box = h('div', { class: 'thumb-canvas' }, thumbRender(s));
    const item = h('div', { class: 'thumb' + (i === E.si ? ' active' : '') + (s.skip ? ' skipped' : ''), draggable: 'true' },
      h('div', { class: 'thumb-num' }, String(i + 1), s.skip ? h('span', { class: 'skip-tag', text: '隱藏' }) : null),
      box,
      h('div', { class: 'thumb-name', text: s.name || '' }));
    item.addEventListener('click', () => selectSlide(i));
    item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/gd-slide', String(i)); e.dataTransfer.effectAllowed = 'move'; item.classList.add('dragging'); });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', e => { if (Array.from(e.dataTransfer.types).includes('text/gd-slide')) { e.preventDefault(); item.classList.add('drop-target'); } });
    item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
    item.addEventListener('drop', e => {
      if (!Array.from(e.dataTransfer.types).includes('text/gd-slide')) return;
      e.preventDefault(); item.classList.remove('drop-target');
      moveSlide(+e.dataTransfer.getData('text/gd-slide'), i);
    });
    return item;
  }

  function refreshThumb(i) {
    const item = $('#slide-list').children[i];
    const s = E.deck.slides[i];
    if (!item || !s) return;
    const box = $('.thumb-canvas', item);
    box.innerHTML = '';
    box.append(thumbRender(s));
    $('.thumb-name', item).textContent = s.name || '';
    item.classList.toggle('skipped', !!s.skip);
  }
  function scheduleThumb() { clearTimeout(E.thumbT); E.thumbT = setTimeout(() => refreshThumb(E.si), 250); }

  function selectSlide(i) {
    if (i < 0 || i >= E.deck.slides.length) return;
    commitTextEdit();
    E.si = i; E.sel.clear();
    $$('#slide-list .thumb').forEach((t, j) => t.classList.toggle('active', j === i));
    const a = $('#slide-list').children[i];
    if (a) a.scrollIntoView({ block: 'nearest' });
    renderCanvas(); renderInspector(); renderNotes();
  }

  function moveSlide(from, to) {
    if (isNaN(from) || from === to) return;
    pushHistory();
    const [s] = E.deck.slides.splice(from, 1);
    E.deck.slides.splice(to, 0, s);
    E.si = to;
    renderSlideList(); renderCanvas(); renderInspector(); renderNotes();
    changed();
  }

  function addSlide(layout) {
    commitTextEdit();
    pushHistory();
    E.deck.slides.splice(E.si + 1, 0, L.buildSlide({ layout }));
    E.si++; E.sel.clear();
    renderAll(); changed();
  }

  function duplicateSlide() {
    commitTextEdit();
    pushHistory();
    const s = G.clone(slide());
    s.id = G.uid('s');
    const map = {};
    s.elements.forEach(e => { const n = G.uid(); map[e.id] = n; e.id = n; });
    s.build.forEach(b => { b.id = map[b.id] || b.id; });
    s.name = (s.name || '') + ' 副本';
    E.deck.slides.splice(E.si + 1, 0, s);
    E.si++; E.sel.clear();
    renderAll(); changed();
  }

  function deleteSlide() {
    if (E.deck.slides.length <= 1) { toast('至少要保留一頁'); return; }
    if (!confirm('刪除第 ' + (E.si + 1) + ' 頁？（之後可以按復原找回）')) return;
    commitTextEdit();
    pushHistory();
    E.deck.slides.splice(E.si, 1);
    E.si = Math.min(E.si, E.deck.slides.length - 1);
    E.sel.clear();
    renderAll(); changed();
  }

  // ---------- canvas ----------
  function renderCanvas() {
    const stage = $('#stage');
    stage.innerHTML = '';
    E.slideNode = null;
    if (!slide()) return;
    const node = G.renderSlide(E.deck, slide(), { assetBase: ASSET_BASE, editor: true });
    E.slideNode = node;
    stage.append(node, h('div', { class: 'grid-layer' }), h('div', { id: 'overlay' }), h('div', { id: 'guides' }));
    updateGrid();
    fitStage();
    markOverflow();
    drawSelection();
  }

  function updateGrid() {
    const layer = $('#stage .grid-layer');
    if (!layer) return;
    const g = gridSize();
    layer.style.setProperty('--g', g + 'px');
    layer.style.setProperty('--g4', g * 4 + 'px');
    layer.hidden = !E.deck.grid.show;
  }

  function fitStage() {
    const wrap = $('#stage-wrap'), stage = $('#stage');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const s = Math.max(0.05, Math.min((W - 64) / G.W, (H - 64) / G.H));
    E.scale = s;
    $('#canvas-scale').textContent = Math.round(s * 100) + '% · 自動適合';
    stage.style.transform = 'scale(' + s + ')';
    stage.style.left = Math.round((W - G.W * s) / 2) + 'px';
    stage.style.top = Math.round((H - G.H * s) / 2) + 'px';
    stage.style.setProperty('--inv', String(1 / s));
  }

  function textPad(el) {
    const s = el.style || {};
    return (s.padding || 0) * 2 + (s.stroke && s.strokeWidth ? s.strokeWidth * 2 : 0);
  }
  // Grow the existing box in the same edit; preserve width, position and caret.
  function growTextBox(el) {
    if (!el || el.type !== 'text') return false;
    const txt = nodeOf(el.id)?.querySelector('.gd-txt');
    if (!txt) return false;
    const needed = Math.ceil(txt.scrollHeight + textPad(el));
    if (needed <= el.h + 1) return false;
    el.h = needed;
    applyGeom(el);
    syncGeomInputs();
    return true;
  }
  function isOverflow(el) {
    const n = nodeOf(el.id);
    const txt = n && n.querySelector('.gd-txt');
    if (!txt) return false;
    return txt.scrollHeight > el.h - textPad(el) + 2 || txt.scrollWidth > el.w - textPad(el) + 2;
  }
  function markOverflow() {
    for (const el of els()) {
      if (el.type !== 'text') continue;
      const n = nodeOf(el.id);
      if (n) n.classList.toggle('overflow', isOverflow(el));
    }
  }

  function applyGeom(el) {
    const n = nodeOf(el.id);
    if (!n) return;
    n.style.left = el.x + 'px'; n.style.top = el.y + 'px';
    n.style.width = el.w + 'px'; n.style.height = el.h + 'px';
    n.style.transform = el.rotate ? 'rotate(' + el.rotate + 'deg)' : '';
  }

  function rerenderElement(el) {
    const old = nodeOf(el.id);
    if (!old || E.editingId === el.id) return;
    const n = G.renderElement(E.deck, el, { assetBase: ASSET_BASE, editor: true });
    if (old.classList.contains('overflow')) n.classList.add('overflow');
    old.replaceWith(n);
  }

  // Apply an inspector change to the canvas, then save.
  function updateEl(el, geom) {
    if (geom) { applyGeom(el); if (el.type === 'chart') rerenderElement(el); }
    else rerenderElement(el);
    growTextBox(el);
    markOverflow();
    drawSelection();
    changed();
  }

  function corners(el) {
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const t = (el.rotate || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const dx = a * el.w / 2, dy = b * el.h / 2;
      return [cx + dx * c - dy * s, cy + dx * s + dy * c];
    });
  }
  function bbox(list) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const el of list) for (const [x, y] of corners(el)) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function drawSelection() {
    const ov = $('#overlay');
    if (!ov) return;
    ov.innerHTML = '';
    if (E.mode === 'anim') drawBadges(ov);
    const sel = selected();
    for (const el of sel) {
      const box = h('div', { class: 'sel-box' + (el.locked ? ' locked' : '') });
      Object.assign(box.style, { left: el.x + 'px', top: el.y + 'px', width: el.w + 'px', height: el.h + 'px', transform: el.rotate ? 'rotate(' + el.rotate + 'deg)' : '' });
      if (sel.length === 1 && E.mode === 'edit' && !el.locked && E.editingId !== el.id) {
        for (const d of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) box.append(h('div', { class: 'hd hd-' + d, 'data-handle': d }));
        box.append(h('div', { class: 'hd-rot-line' }), h('div', { class: 'hd hd-rot', 'data-handle': 'rot', title: '旋轉（Shift：每 15°）' }));
      }
      ov.append(box);
    }
    if (sel.length > 1) {
      const b = bbox(sel);
      ov.append(h('div', { class: 'group-box', style: { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' } }));
    }
  }

  function drawBadges(ov) {
    let n = 0;
    for (const st of slide().build || []) {
      const el = elById(st.id);
      if (!el) continue;
      n++;
      const b = bbox([el]);
      ov.append(h('div', { class: 'anim-badge' + (st.trigger === 'click' ? ' click' : ''), style: { left: b.x + 'px', top: b.y + 'px' }, text: String(n) }));
    }
  }

  function showGuides(list) {
    const g = $('#guides');
    if (!g) return;
    $$('.guide', g).forEach(n => n.remove());
    for (const it of list || []) {
      g.append(h('div', { class: 'guide ' + (it.axis === 'x' ? 'gx' : 'gy'), style: it.axis === 'x' ? { left: it.at + 'px' } : { top: it.at + 'px' } }));
    }
  }
  const clearGuides = () => showGuides([]);

  // ---------- snapping ----------
  function snapLines(exclude) {
    const xs = [0, G.W / 2, G.W], ys = [0, G.H / 2, G.H];
    for (const o of els()) {
      if (exclude.has(o.id) || o.hidden) continue;
      const b = bbox([o]);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    return { xs, ys };
  }
  // edges: [start, center, end] of the moving box on one axis.
  function snapAxis(edges, lines) {
    const thr = 7 / E.scale;
    let best = null;
    for (const e of edges) for (const l of lines) {
      const d = l - e;
      if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: l };
    }
    if (best) return { d: best.d, guide: best.at };
    const g = gridSize();
    let d = null;
    for (const e of [edges[0], edges[2]]) {
      const dd = Math.round(e / g) * g - e;
      if (d == null || Math.abs(dd) < Math.abs(d)) d = dd;
    }
    return { d, guide: null };
  }
  function snapOn(ev) { return E.deck.grid.snap && !ev.altKey; }

  // ---------- pointer interactions ----------
  function toCanvas(e) {
    const r = $('#stage').getBoundingClientRect();
    return { x: (e.clientX - r.left) / E.scale, y: (e.clientY - r.top) / E.scale };
  }

  function drag(onMove, onUp) {
    E.dragging = true;
    const mv = ev => onMove(ev);
    const up = ev => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      E.dragging = false;
      if (onUp) onUp(ev);
      if (E.pendingExternal) setTimeout(syncExternal, 0);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function onPointerDown(e) {
    if (e.button !== 0 || !slide()) return;
    if (E.editingId && e.target.closest('.gd-txt[contenteditable="true"]')) return;
    if (E.editingId) commitTextEdit();
    closeMenus();
    const p = toCanvas(e);
    const hd = e.target.closest('[data-handle]');
    if (hd && E.mode === 'edit') {
      e.preventDefault();
      const el = selected()[0];
      if (!el) return;
      if (hd.dataset.handle === 'rot') startRotate(el); else startResize(el, hd.dataset.handle);
      return;
    }
    const n = e.target.closest('.gd-el');
    if (n && E.slideNode && E.slideNode.contains(n)) {
      e.preventDefault();
      const id = n.dataset.id;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { if (E.sel.has(id)) E.sel.delete(id); else E.sel.add(id); }
      else if (!E.sel.has(id)) E.sel = new Set([id]);
      drawSelection(); renderInspector();
      if (E.mode === 'edit' && E.sel.has(id)) startMove(p);
      return;
    }
    if (!e.shiftKey) E.sel.clear();
    startMarquee(p, e.shiftKey);
  }

  function startMove(p0) {
    const movers = selected().filter(el => !el.locked);
    if (!movers.length) return;
    const starts = movers.map(el => ({ el, x: el.x, y: el.y }));
    const box0 = bbox(movers);
    const ids = new Set(movers.map(m => m.id));
    let moved = false, lines = null;
    drag(ev => {
      const p = toCanvas(ev);
      let dx = p.x - p0.x, dy = p.y - p0.y;
      if (!moved) {
        if (Math.hypot(dx, dy) * E.scale < 4) return;
        moved = true; pushHistory(); lines = snapLines(ids);
      }
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const guides = [];
      if (snapOn(ev)) {
        const b = { x: box0.x + dx, y: box0.y + dy };
        const sx = snapAxis([b.x, b.x + box0.w / 2, b.x + box0.w], lines.xs);
        const sy = snapAxis([b.y, b.y + box0.h / 2, b.y + box0.h], lines.ys);
        if (!(ev.shiftKey && dx === 0)) dx += sx.d;
        if (!(ev.shiftKey && dy === 0)) dy += sy.d;
        if (sx.guide != null) guides.push({ axis: 'x', at: sx.guide });
        if (sy.guide != null) guides.push({ axis: 'y', at: sy.guide });
      }
      for (const s of starts) { s.el.x = Math.round(s.x + dx); s.el.y = Math.round(s.y + dy); applyGeom(s.el); }
      showGuides(guides); drawSelection(); syncGeomInputs();
    }, () => { clearGuides(); if (moved) changed(); });
  }

  function startResize(el, dir) {
    const s0 = { x: el.x, y: el.y, w: el.w, h: el.h, r: el.rotate || 0 };
    const hx = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0;
    const hy = dir.includes('s') ? 1 : dir.includes('n') ? -1 : 0;
    const ratioDefault = el.type === 'image' && !!el.src;
    const MIN = 16;
    const ids = new Set([el.id]);
    let moved = false, lines = null;
    drag(ev => {
      const p = toCanvas(ev);
      if (!moved) { moved = true; pushHistory(); lines = snapLines(ids); }
      const keep = !!(hx && hy) && (ev.shiftKey !== ratioDefault);
      const guides = [];
      if (!s0.r) {
        let Lx = s0.x, T = s0.y, R = s0.x + s0.w, B = s0.y + s0.h;
        const sn = (v, axis) => {
          if (!snapOn(ev)) return v;
          const r = snapAxis([v, v, v], axis === 'x' ? lines.xs : lines.ys);
          if (r.guide != null) guides.push({ axis, at: r.guide });
          return v + r.d;
        };
        if (hx === 1) R = Math.max(sn(p.x, 'x'), Lx + MIN);
        if (hx === -1) Lx = Math.min(sn(p.x, 'x'), R - MIN);
        if (hy === 1) B = Math.max(sn(p.y, 'y'), T + MIN);
        if (hy === -1) T = Math.min(sn(p.y, 'y'), B - MIN);
        if (keep) {
          const ratio = s0.w / s0.h;
          let w = R - Lx, hh = B - T;
          if (w / hh > ratio) w = hh * ratio; else hh = w / ratio;
          if (hx === 1) R = Lx + w; else Lx = R - w;
          if (hy === 1) B = T + hh; else T = B - hh;
        }
        el.x = Math.round(Lx); el.y = Math.round(T); el.w = Math.round(R - Lx); el.h = Math.round(B - T);
      } else {
        // Rotated box: resize in the element's own frame, keeping the opposite handle fixed.
        const th = s0.r * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
        const cx = s0.x + s0.w / 2, cy = s0.y + s0.h / 2;
        const ax = -hx * s0.w / 2, ay = -hy * s0.h / 2;
        const Ax = cx + ax * c - ay * s, Ay = cy + ax * s + ay * c;
        const dxw = p.x - Ax, dyw = p.y - Ay;
        const lx = dxw * c + dyw * s, ly = -dxw * s + dyw * c;
        let w = hx ? Math.max(MIN, hx * lx) : s0.w;
        let hh = hy ? Math.max(MIN, hy * ly) : s0.h;
        if (keep) { const ratio = s0.w / s0.h; if (w / hh > ratio) w = hh * ratio; else hh = w / ratio; }
        const ox = hx * w / 2, oy = hy * hh / 2;
        const ncx = Ax + ox * c - oy * s, ncy = Ay + ox * s + oy * c;
        el.x = Math.round(ncx - w / 2); el.y = Math.round(ncy - hh / 2); el.w = Math.round(w); el.h = Math.round(hh);
      }
      applyGeom(el);
      if (el.type === 'chart') rerenderElement(el);
      showGuides(guides); drawSelection(); syncGeomInputs();
    }, () => { clearGuides(); if (moved) { els().filter(e => E.sel.has(e.id)).forEach(growTextBox); markOverflow(); drawSelection(); changed(); renderInspector(); } });
  }

  function startRotate(el) {
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    let moved = false;
    drag(ev => {
      const p = toCanvas(ev);
      if (!moved) { moved = true; pushHistory(); }
      let a = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90;
      if (ev.shiftKey) a = Math.round(a / 15) * 15;
      else { const r = Math.round(a / 90) * 90; if (Math.abs(a - r) < 4) a = r; }
      a = ((a % 360) + 540) % 360 - 180;
      el.rotate = Math.round(a * 10) / 10;
      applyGeom(el); drawSelection(); syncGeomInputs();
    }, () => { if (moved) changed(); });
  }

  function startMarquee(p0, additive) {
    const base = new Set(E.sel);
    const box = h('div', { class: 'marquee' });
    $('#guides').append(box);
    let moved = false;
    drag(ev => {
      const p = toCanvas(ev);
      moved = true;
      const r = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      const hit = els().filter(el => {
        const b = bbox([el]);
        return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
      }).map(e => e.id);
      E.sel = new Set([...(additive ? base : []), ...hit]);
      drawSelection();
    }, () => { box.remove(); drawSelection(); renderInspector(); if (!moved) syncGeomInputs(); });
  }

  // ---------- text editing ----------
  function startTextEdit(id, evt, selectAll) {
    const el = elById(id);
    if (!el || el.type !== 'text' || el.locked) return;
    if (E.editingId) commitTextEdit();
    E.sel = new Set([id]);
    E.textBefore = el.text;
    E.textHeightBefore = el.h;
    pushHistory();
    E.editingId = id;
    const n = nodeOf(id);
    const txt = n.querySelector('.gd-txt');
    n.classList.add('is-editing');
    txt.contentEditable = 'true';
    txt.spellcheck = false;
    txt.focus();
    try { document.execCommand('styleWithCSS', false, false); document.execCommand('defaultParagraphSeparator', false, 'div'); } catch (e) { /* older browsers */ }
    const sel = window.getSelection();
    if (selectAll) {
      const r = document.createRange(); r.selectNodeContents(txt);
      sel.removeAllRanges(); sel.addRange(r);
    } else if (evt && document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(evt.clientX, evt.clientY);
      if (r && txt.contains(r.startContainer)) { sel.removeAllRanges(); sel.addRange(r); }
    }
    txt.addEventListener('input', onTextInput);
    txt.addEventListener('paste', onTextPaste);
    drawSelection(); renderInspector();
  }

  function onTextInput() {
    const el = elById(E.editingId);
    const n = el && nodeOf(el.id);
    if (n) {
      el.text = G.serializeEditable(n.querySelector('.gd-txt'));
      growTextBox(el);
      n.classList.toggle('overflow', isOverflow(el));
      drawSelection();
      changed();
    }
  }
  function onTextPaste(e) {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, t);
  }

  function commitTextEdit() {
    const id = E.editingId;
    if (!id) return;
    E.editingId = null;
    const el = elById(id);
    const n = nodeOf(id);
    if (el && n) el.text = G.serializeEditable(n.querySelector('.gd-txt'));
    try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
    if (el && el.text === E.textBefore && el.h === E.textHeightBefore) { E.undo.pop(); updateUndoButtons(); }
    else changed();
    renderCanvas();
    renderInspector();
    if (E.pendingExternal) setTimeout(syncExternal, 0);
  }

  function inlineFormat(kind) {
    const el = selected()[0];
    if (!el || el.type !== 'text') return;
    if (E.editingId !== el.id) startTextEdit(el.id, null, true);
    const txt = nodeOf(el.id).querySelector('.gd-txt');
    txt.focus();
    const sel = window.getSelection();
    if (kind === 'b' || kind === 'i' || kind === 'u') {
      document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[kind]);
    } else if (kind === 'clear') {
      document.execCommand('removeFormat');
      if (sel.rangeCount) {
        const r = sel.getRangeAt(0);
        $$('span', txt).forEach(sp => { if (r.intersectsNode(sp)) sp.replaceWith(...sp.childNodes); });
      }
    } else {
      if (!sel.rangeCount || sel.isCollapsed) { toast('先選取要套用的文字'); return; }
      const r = sel.getRangeAt(0);
      const line = node => (node.nodeType === 1 ? node : node.parentElement).closest('.ln');
      if (line(r.startContainer) !== line(r.endContainer)) { toast('一次請選取同一行的文字'); return; }
      const frag = r.extractContents();
      frag.querySelectorAll('span').forEach(sp => { if (G.SPAN_CLASSES.some(c => sp.classList.contains(c))) sp.replaceWith(...sp.childNodes); });
      const span = document.createElement('span');
      span.className = kind;
      span.append(frag);
      r.insertNode(span);
      sel.removeAllRanges();
      const nr = document.createRange(); nr.selectNodeContents(span); sel.addRange(nr);
    }
    onTextInput();
  }

  function fitTextSize(el) {
    pushHistory();
    for (let i = 0; i < 80 && isOverflow(el) && el.style.size > 10; i++) {
      el.style.size = Math.max(10, Math.floor(el.style.size * 0.95));
      rerenderElement(el);
    }
    markOverflow(); renderInspector(); changed();
  }
  function fitBoxHeight(el) {
    const txt = nodeOf(el.id).querySelector('.gd-txt');
    pushHistory();
    el.h = Math.max(20, Math.ceil(txt.scrollHeight + textPad(el)));
    applyGeom(el); markOverflow(); drawSelection(); renderInspector(); changed();
  }

  // ---------- element operations ----------
  function addElement(el, startEdit) {
    const g = gridSize();
    while (els().some(o => o.x === el.x && o.y === el.y)) { el.x += g; el.y += g; }
    pushHistory();
    els().push(el);
    E.sel = new Set([el.id]);
    renderCanvas(); renderInspector(); changed();
    if (startEdit) startTextEdit(el.id, null, true);
  }

  function centered(w, hh) { return { x: snapG(G.W / 2 - w / 2), y: snapG(G.H / 2 - hh / 2), w, h: hh }; }

  function insert(kind) {
    if (E.mode !== 'edit') setMode('edit');
    commitTextEdit();
    closeMenus();
    const base = { id: G.uid(), name: '', rotate: 0 };
    if (kind === 'text') {
      addElement(Object.assign(base, { type: 'text', text: '輸入文字', style: { font: 'body', size: 48, weight: 700, color: 'text', align: 'left', valign: 'top', lineHeight: 1.3 } }, centered(720, 120)), true);
    } else if (kind === 'rect' || kind === 'ellipse' || kind === 'triangle') {
      addElement(Object.assign(base, { type: 'shape', shape: kind, style: { fill: 'accent', radius: kind === 'rect' ? 16 : 0 } }, centered(kind === 'rect' ? 480 : 360, 360)));
    } else if (kind === 'line') {
      addElement(Object.assign(base, { type: 'shape', shape: 'line', style: { stroke: 'text', strokeWidth: 4 } }, centered(600, 40)));
    } else if (kind === 'image') {
      pickImage(null);
    } else if (kind === 'chart') {
      addElement(Object.assign(base, { type: 'chart', chart: { kind: 'bar', labels: ['一月', '二月', '三月', '四月'], series: [{ name: '數值', values: [12, 18, 15, 24] }], showValues: true }, style: { size: 24 } }, centered(960, 540)));
    } else if (kind === 'table') {
      addElement(Object.assign(base, { type: 'table', table: { header: true, rows: [['項目', '方案 A', '方案 B'], ['成本', '低', '高'], ['速度', '快', '慢']] }, style: { size: 28 } }, centered(1200, 300)));
    }
  }

  function deleteSel() {
    const ids = new Set(Array.from(E.sel));
    if (!ids.size) return;
    pushHistory();
    slide().elements = els().filter(e => !ids.has(e.id));
    slide().build = (slide().build || []).filter(b => !ids.has(b.id));
    E.sel.clear();
    renderCanvas(); renderInspector(); changed();
  }

  function cloneEls(list, offset) {
    return list.map(el => { const c = G.clone(el); c.id = G.uid(); c.x += offset; c.y += offset; return c; });
  }

  function duplicateSel() {
    const list = selected();
    if (!list.length) return;
    pushHistory();
    const copies = cloneEls(list, gridSize() >= 60 ? 30 : gridSize());
    els().push(...copies);
    E.sel = new Set(copies.map(c => c.id));
    renderCanvas(); renderInspector(); changed();
  }

  function pasteEls(list) {
    if (!list || !list.length) return;
    pushHistory();
    const copies = cloneEls(list, 30);
    els().push(...copies);
    E.sel = new Set(copies.map(c => c.id));
    renderCanvas(); renderInspector(); changed();
    toast('已貼上 ' + copies.length + ' 個元素');
  }

  function layer(op) {
    const list = els();
    const ids = new Set(Array.from(E.sel));
    if (!ids.size) return;
    pushHistory();
    if (op === 'front' || op === 'back') {
      const picked = list.filter(e => ids.has(e.id)), rest = list.filter(e => !ids.has(e.id));
      slide().elements = op === 'front' ? rest.concat(picked) : picked.concat(rest);
    } else if (op === 'up') {
      for (let i = list.length - 2; i >= 0; i--) if (ids.has(list[i].id) && !ids.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    } else {
      for (let i = 1; i < list.length; i++) if (ids.has(list[i].id) && !ids.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
    renderCanvas(); renderInspector(); changed();
  }

  function align(kind) {
    const list = selected().filter(e => !e.locked);
    if (!list.length) return;
    pushHistory();
    const ref = list.length === 1 ? { x: 0, y: 0, w: G.W, h: G.H } : bbox(list);
    for (const el of list) {
      const b = bbox([el]);
      let dx = 0, dy = 0;
      if (kind === 'left') dx = ref.x - b.x;
      if (kind === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
      if (kind === 'right') dx = ref.x + ref.w - (b.x + b.w);
      if (kind === 'top') dy = ref.y - b.y;
      if (kind === 'vmiddle') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
      if (kind === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
      el.x = Math.round(el.x + dx); el.y = Math.round(el.y + dy);
      applyGeom(el);
    }
    drawSelection(); syncGeomInputs(); changed();
  }

  function distribute(axis) {
    const list = selected().filter(e => !e.locked);
    if (list.length < 3) { toast('至少選取 3 個元素才能等距分佈'); return; }
    pushHistory();
    const k = axis === 'x' ? 'x' : 'y', sz = axis === 'x' ? 'w' : 'h';
    const items = list.map(el => ({ el, b: bbox([el]) })).sort((a, b) => a.b[k] - b.b[k]);
    const first = items[0].b, last = items[items.length - 1].b;
    const total = items.reduce((s, it) => s + it.b[sz], 0);
    const gap = (last[k] + last[sz] - first[k] - total) / (items.length - 1);
    let pos = first[k];
    for (const it of items) {
      it.el[k] = Math.round(it.el[k] + (pos - it.b[k]));
      pos += it.b[sz] + gap;
      applyGeom(it.el);
    }
    drawSelection(); syncGeomInputs(); changed();
  }

  function nudge(key, e) {
    const list = selected().filter(el => !el.locked);
    if (!list.length) return;
    const step = e.altKey ? 1 : (E.deck.grid.snap ? gridSize() : 10);
    const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
    const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
    const now = Date.now();
    if (now - E.lastNudge > 800) pushHistory();
    E.lastNudge = now;
    for (const el of list) { el.x += dx; el.y += dy; applyGeom(el); }
    drawSelection(); syncGeomInputs(); changed();
  }

  // ---------- images ----------
  async function upload(file) {
    const r = await fetch('/api/upload?name=' + encodeURIComponent(file.name || 'image.png'), { method: 'POST', body: file });
    if (!r.ok) throw new Error('上傳失敗（HTTP ' + r.status + '）');
    return (await r.json()).path;
  }

  function naturalSize(path) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res({ w: 800, h: 600 });
      img.src = G.assetUrl(path, { assetBase: ASSET_BASE });
    });
  }

  async function insertImage(path, at) {
    const n = await naturalSize(path);
    const k = Math.min(1, 960 / n.w, 640 / n.h);
    const w = Math.round(n.w * k), hh = Math.round(n.h * k);
    const c = at || { x: G.W / 2, y: G.H / 2 };
    addElement({ id: G.uid(), type: 'image', name: '', rotate: 0, src: path, style: { fit: 'cover', radius: 0 }, x: snapG(c.x - w / 2), y: snapG(c.y - hh / 2), w, h: hh });
  }

  function pickFile() {
    return new Promise(res => {
      const input = $('#file-input');
      input.value = '';
      input.onchange = () => res(input.files[0] || null);
      input.click();
    });
  }

  async function pickImage(replaceId) {
    const file = await pickFile();
    if (!file) return;
    try {
      const path = await upload(file);
      const el = replaceId && elById(replaceId);
      if (el) { pushHistory(); el.src = path; rerenderElement(el); renderInspector(); changed(); }
      else await insertImage(path);
    } catch (err) { toast(err.message); }
  }

  async function restoreRatio(el) {
    if (!el.src) return;
    const n = await naturalSize(el.src);
    pushHistory();
    el.h = Math.round(el.w * n.h / n.w);
    applyGeom(el); drawSelection(); renderInspector(); changed();
  }

  // ---------- inspector helpers ----------
  const section = (title, ...kids) => h('section', { class: 'ins-sec' }, h('h4', { text: title }), ...kids);
  const row = (label, ...kids) => h('div', { class: 'ins-row' }, h('label', { text: label }), h('div', { class: 'ins-ctl' }, ...kids));
  const labeled = (label, input) => h('div', {}, h('label', { text: label }), input);

  function num(get, set, after, o) {
    o = o || {};
    const v = get();
    const i = h('input', { type: 'number', value: v == null ? '' : String(Math.round(v * 1000) / 1000), step: o.step || 1, min: o.min, max: o.max, 'data-field': o.field || null, placeholder: o.placeholder || null });
    return histInput(i, () => {
      if (i.value === '' && o.allowEmpty) { set(null); after(); return; }
      const n = parseFloat(i.value);
      if (!isFinite(n)) return;
      set(o.min != null ? Math.max(o.min, n) : n);
      after();
    });
  }

  function textInput(get, set, after, o) {
    const i = h('input', { type: 'text', value: get() || '', placeholder: (o && o.placeholder) || null });
    return histInput(i, () => { set(i.value); after(); });
  }

  function selectBox(options, get, set, after) {
    const s = h('select', {}, options.map(([v, label]) => h('option', { value: v, text: label })));
    s.value = String(get());
    return histInput(s, () => { set(s.value); after(); }, 'change');
  }

  function check(label, get, set, after) {
    const i = h('input', { type: 'checkbox', checked: !!get() });
    i.addEventListener('change', () => { pushHistory(); set(i.checked); after(); });
    return h('label', { class: 'chk' }, i, ' ' + label);
  }

  function seg(options, get, set, after) {
    const w = h('div', { class: 'seg' });
    const draw = () => {
      w.innerHTML = '';
      for (const [v, label, title] of options) {
        w.append(h('button', { class: get() === v ? 'on' : '', title: title || null, onclick: () => { pushHistory(); set(v); after(); draw(); } }, label));
      }
    };
    draw();
    return w;
  }

  function colorField(get, set, after, o) {
    o = o || {};
    const wrap = h('div', { class: 'color-field' });
    const pick = v => { pushHistory(); set(v); after(); draw(); };
    function draw() {
      wrap.innerHTML = '';
      const cur = get();
      const th = G.resolveTheme(E.deck);
      if (o.none) wrap.append(h('button', { class: 'sw sw-none' + (!cur || cur === 'none' ? ' on' : ''), title: '無', onclick: () => pick(null) }));
      for (const t of G.TOKENS) wrap.append(h('button', { class: 'sw' + (cur === t ? ' on' : ''), title: G.TOKEN_LABELS[t] + '（跟著主題變）', style: { background: th.tokens[t] }, onclick: () => pick(t) }));
      const isHex = typeof cur === 'string' && /^#[0-9a-f]{6}$/i.test(cur);
      const custom = h('input', { type: 'color', class: 'sw-custom' + (isHex ? ' on' : ''), value: isHex ? cur : '#888888', title: '自訂顏色（不會跟著主題變）' });
      histInput(custom, () => { set(custom.value); after(); });
      custom.addEventListener('change', draw);
      wrap.append(custom);
    }
    draw();
    return wrap;
  }

  function syncGeomInputs() {
    const el = selected().length === 1 ? selected()[0] : null;
    if (!el) return;
    for (const f of ['x', 'y', 'w', 'h', 'rotate']) {
      const i = $('#inspector [data-field="' + f + '"]');
      if (i && document.activeElement !== i) i.value = String(Math.round((el[f] || 0) * 10) / 10);
    }
  }

  // ---------- inspector panes ----------
  function renderInspector() {
    const box = $('#inspector');
    box.innerHTML = '';
    if (!slide()) return;
    if (E.mode === 'anim') { renderAnimPane(box); return; }
    const sel = selected();
    if (!sel.length) renderSlidePane(box);
    else if (sel.length > 1) renderMultiPane(box, sel);
    else renderElementPane(box, sel[0]);
  }

  function alignRow(multi) {
    const b = (k, label, title) => h('button', { title, onclick: () => align(k) }, label);
    return h('div', { class: 'btn-row' },
      b('left', '靠左', multi ? '對齊最左邊' : '貼齊頁面左緣'), b('hcenter', '水平置中', multi ? '水平置中對齊' : '頁面水平置中'), b('right', '靠右', multi ? '對齊最右邊' : '貼齊頁面右緣'),
      b('top', '靠上', null), b('vmiddle', '垂直置中', null), b('bottom', '靠下', null));
  }

  function renderSlidePane(box) {
    const s = slide();
    const refresh = () => { renderCanvas(); scheduleThumb(); changed(); };
    box.append(section('本頁',
      row('名稱', textInput(() => s.name, v => { s.name = v; }, () => { changed(); refreshThumb(E.si); })),
      row('背景色', colorField(() => s.background && s.background.color, v => { s.background = Object.assign({}, s.background); if (v) s.background.color = v; else delete s.background.color; }, refresh, { none: true })),
      row('背景圖',
        h('button', { class: 'small', onclick: async () => { const f = await pickFile(); if (!f) return; try { const p = await upload(f); pushHistory(); s.background = Object.assign({}, s.background, { image: p }); refresh(); } catch (err) { toast(err.message); } } }, s.background && s.background.image ? '更換' : '上傳'),
        s.background && s.background.image ? h('button', { class: 'small', onclick: () => { pushHistory(); delete s.background.image; refresh(); renderInspector(); } }, '移除') : null),
      h('div', { class: 'chk-row' }, check('播放與匯出時隱藏此頁', () => s.skip, v => { s.skip = v; }, () => { changed(); refreshThumb(E.si); })),
    ));

    const list = h('div', { class: 'layer-list' });
    const items = els().slice().reverse();
    if (!items.length) list.append(h('div', { class: 'empty', text: '這頁還沒有元素。用上方工具列新增文字、形狀、圖片、圖表或表格。' }));
    for (const el of items) {
      list.append(h('div', { class: 'layer-item', onclick: () => { E.sel = new Set([el.id]); drawSelection(); renderInspector(); } },
        h('span', { class: 'lt', text: TYPE_LABEL[el.type] || el.type }),
        h('span', { class: 'ln', text: G.elementLabel(el) }),
        el.locked ? h('span', { title: '已鎖定', text: '🔒' }) : null,
        el.hidden ? h('span', { title: '已隱藏', text: '隱' }) : null));
    }
    box.append(section('元素（上層在前）', list));

    const t = E.deck.theme;
    const th = G.resolveTheme(E.deck);
    const all = () => { renderAll(); changed(); };
    const ov = k => h('input', { type: 'color', class: 'sw-custom', value: th.tokens[k], title: G.TOKEN_LABELS[k] });
    const tokenRow = k => {
      const i = ov(k);
      histInput(i, () => { t.overrides[k] = i.value; renderCanvas(); scheduleThumb(); changed(); });
      i.addEventListener('change', () => renderSlideList());
      return labeled(G.TOKEN_LABELS[k], i);
    };
    box.append(section('整份簡報',
      row('主題', selectBox(Object.entries(G.THEMES).map(([k, v]) => [k, v.label + (v.dark ? '（深色）' : '')]), () => t.name, v => { t.name = v; t.overrides = {}; }, all)),
      h('div', { class: 'grid4' }, ['accent', 'accent2', 'accent3', 'bg'].map(tokenRow)),
      h('div', { class: 'grid4' }, ['text', 'muted', 'surface', 'line'].map(tokenRow)),
      h('div', { class: 'btn-row' }, h('button', { class: 'small', onclick: () => { pushHistory(); t.overrides = Object.assign({}, { fontHeading: t.overrides.fontHeading, fontBody: t.overrides.fontBody }); all(); } }, '顏色恢復主題預設')),
      row('標題字', seg([['sans', '黑體'], ['serif', '明體']], () => t.overrides.fontHeading || 'sans', v => { t.overrides.fontHeading = v; }, all)),
      row('內文字', seg([['sans', '黑體'], ['serif', '明體']], () => t.overrides.fontBody || 'sans', v => { t.overrides.fontBody = v; }, all)),
      h('div', { class: 'hint', text: '明體需要電腦裝有 Noto Serif TC，沒有的話會改用系統的明體字。' }),
    ));
    box.append(section('提示', h('div', { class: 'hint', text:'拖曳移動、拉角落縮放、拉上方圓點旋轉。按住 Alt 暫時不吸附，按住 Shift 鎖定方向或比例。雙擊文字直接編輯。' })));
  }

  function renderMultiPane(box, sel) {
    box.append(h('div', { class: 'ins-head' }, h('span', { class: 'type-tag', text: '多選' }), h('b', { text: '已選取 ' + sel.length + ' 個元素' })));
    box.append(section('對齊', alignRow(true)));
    box.append(section('分佈', h('div', { class: 'btn-row' },
      h('button', { onclick: () => distribute('x') }, '水平等距'),
      h('button', { onclick: () => distribute('y') }, '垂直等距'))));
    box.append(section('圖層', layerButtons()));
    box.append(section('動作', h('div', { class: 'btn-row' },
      h('button', { onclick: duplicateSel }, '複製（Ctrl+D）'),
      h('button', { class: 'danger', onclick: deleteSel }, '刪除（Del）'))));
  }

  function layerButtons() {
    return h('div', { class: 'btn-row' },
      h('button', { onclick: () => layer('front'), title: 'Ctrl+Shift+]' }, '移到最上'),
      h('button', { onclick: () => layer('up'), title: 'Ctrl+]' }, '上移一層'),
      h('button', { onclick: () => layer('down'), title: 'Ctrl+[' }, '下移一層'),
      h('button', { onclick: () => layer('back'), title: 'Ctrl+Shift+[' }, '移到最下'));
  }

  function renderElementPane(box, el) {
    const geo = () => updateEl(el, true);
    const re = () => updateEl(el, false);
    el.style = el.style || {};
    box.append(h('div', { class: 'ins-head' },
      h('span', { class: 'type-tag', text: TYPE_LABEL[el.type] || el.type }),
      textInput(() => el.name, v => { el.name = v; }, () => changed(), { placeholder: G.elementLabel(el) })));

    box.append(section('位置與大小',
      h('div', { class: 'grid4' },
        labeled('X', num(() => el.x, v => { el.x = Math.round(v); }, geo, { field: 'x' })),
        labeled('Y', num(() => el.y, v => { el.y = Math.round(v); }, geo, { field: 'y' })),
        labeled('寬', num(() => el.w, v => { el.w = Math.max(1, Math.round(v)); }, geo, { field: 'w', min: 1 })),
        labeled('高', num(() => el.h, v => { el.h = Math.max(1, Math.round(v)); }, geo, { field: 'h', min: 1 }))),
      h('div', { class: 'grid4' },
        labeled('旋轉°', num(() => el.rotate || 0, v => { el.rotate = v; }, geo, { field: 'rotate' })),
        labeled('透明度%', num(() => Math.round((el.opacity == null ? 1 : el.opacity) * 100), v => { el.opacity = Math.min(100, Math.max(0, v)) / 100; }, re, { step: 5, min: 0, max: 100 }))),
      h('div', { class: 'hint', text: '單選時對齊的是整個頁面' }),
      alignRow(false),
      h('div', { class: 'chk-row' },
        check('鎖定位置', () => el.locked, v => { el.locked = v; }, () => { drawSelection(); changed(); }),
        check('隱藏', () => el.hidden, v => { el.hidden = v; }, () => { renderCanvas(); changed(); }))));

    if (el.type === 'text') textSections(box, el, re);
    else if (el.type === 'shape') shapeSection(box, el, re);
    else if (el.type === 'image') imageSection(box, el, re);
    else if (el.type === 'chart') chartSection(box, el, re);
    else if (el.type === 'table') tableSection(box, el, re);

    box.append(section('圖層', layerButtons()));
    box.append(section('動作', h('div', { class: 'btn-row' },
      h('button', { onclick: duplicateSel }, '複製（Ctrl+D）'),
      h('button', { class: 'danger', onclick: deleteSel }, '刪除（Del）'))));
  }

  function textSections(box, el, re) {
    const st = el.style;
    const fb = (label, kind, title, cls) => {
      const b = h('button', { class: cls || null, title: title || null }, label);
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => inlineFormat(kind));
      return b;
    };
    const over = isOverflow(el);
    box.append(section('文字',
      h('div', { class: 'fmt-bar' },
        fb('B', 'b', '粗體（Ctrl+B）'), fb('I', 'i', '斜體'), fb('U', 'u', '底線'),
        fb('主色', 'hl', '選取的字改成主色', 'f-hl'), fb('輔色', 'hl2', null, 'f-hl2'), fb('點綴', 'hl3', null, 'f-hl3'),
        fb('淡色', 'mu'), fb('螢光', 'mark', '螢光筆底線'), fb('小字', 'sm', '縮小（適合數字後面的單位）'), fb('清除', 'clear', '清除選取文字的格式')),
      h('div', { class: 'hint', text: '雙擊文字框直接編輯；文字變多或字級變大時，框高會自動增加。' }),
      over ? h('div', { class: 'warn', text: '⚠ 請檢查文字寬度或特殊格式；一般文字溢出會自動增加框高。' }) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'small', onclick: () => fitTextSize(el) }, '字級縮到框內'),
        h('button', { class: 'small', onclick: () => fitBoxHeight(el) }, '高度貼合文字')),
      row('字型', selectBox([['heading', '標題字'], ['body', '內文字'], ['mono', '等寬']], () => st.font || 'body', v => { st.font = v; }, re)),
      row('字級', num(() => st.size || 32, v => { st.size = v; }, re, { min: 6 }),
        h('button', { class: 'small', onclick: () => { pushHistory(); st.size = Math.max(6, Math.round((st.size || 32) / 1.1)); re(); renderInspector(); } }, 'A−'),
        h('button', { class: 'small', onclick: () => { pushHistory(); st.size = Math.round((st.size || 32) * 1.1); re(); renderInspector(); } }, 'A＋')),
      row('粗細', selectBox([['300', '細 300'], ['400', '一般 400'], ['500', '中 500'], ['600', '半粗 600'], ['700', '粗 700'], ['800', '特粗 800'], ['900', '黑 900']], () => String(st.weight || 400), v => { st.weight = +v; }, re)),
      row('顏色', colorField(() => st.color || 'text', v => { st.color = v || 'text'; }, re)),
      row('水平', seg([['left', '靠左'], ['center', '置中'], ['right', '靠右'], ['justify', '分散']], () => st.align || 'left', v => { st.align = v; }, re)),
      row('垂直', seg([['top', '靠上'], ['middle', '置中'], ['bottom', '靠下']], () => st.valign || 'top', v => { st.valign = v; }, re)),
      row('列表', seg([['none', '無'], ['bullet', '圓點'], ['number', '編號']], () => st.list || 'none', v => { if (v === 'none') delete st.list; else st.list = v; }, re)),
      h('div', { class: 'grid4' },
        labeled('行高', num(() => st.lineHeight || 1.4, v => { st.lineHeight = v; }, re, { step: 0.05, min: 0.6 })),
        labeled('字距 em', num(() => st.letterSpacing || 0, v => { st.letterSpacing = v; }, re, { step: 0.01 })),
        labeled('段距 em', num(() => st.paraSpacing == null ? (st.list ? 0.4 : 0) : st.paraSpacing, v => { st.paraSpacing = v; }, re, { step: 0.1, min: 0 }))),
    ));
    box.append(section('文字框外觀',
      row('底色', colorField(() => st.fill, v => { if (v) st.fill = v; else delete st.fill; }, re, { none: true })),
      h('div', { class: 'grid4' },
        labeled('內距', num(() => st.padding || 0, v => { st.padding = v; }, re, { min: 0 })),
        labeled('圓角', num(() => st.radius || 0, v => { st.radius = v; }, re, { min: 0 })),
        labeled('邊框寬', num(() => st.strokeWidth || 0, v => { st.strokeWidth = v; if (v && !st.stroke) st.stroke = 'line'; }, re, { min: 0 }))),
      row('邊框色', colorField(() => st.stroke, v => { if (v) st.stroke = v; else delete st.stroke; }, re, { none: true }))));
  }

  function shapeSection(box, el, re) {
    const st = el.style;
    const isLine = el.shape === 'line';
    box.append(section('形狀',
      row('種類', seg([['rect', '矩形'], ['ellipse', '圓形'], ['triangle', '三角'], ['line', '線條']], () => el.shape || 'rect', v => { el.shape = v; if (v === 'line' && !st.stroke) { st.stroke = st.fill || 'text'; st.strokeWidth = st.strokeWidth || 4; } }, () => { re(); renderInspector(); })),
      isLine ? null : row('填色', colorField(() => st.fill, v => { if (v) st.fill = v; else delete st.fill; }, re, { none: true })),
      row(isLine ? '線色' : '邊框色', colorField(() => st.stroke, v => { if (v) st.stroke = v; else delete st.stroke; }, re, { none: !isLine })),
      h('div', { class: 'grid4' },
        labeled(isLine ? '線寬' : '邊框寬', num(() => st.strokeWidth || 0, v => { st.strokeWidth = v; if (v && !st.stroke) st.stroke = 'line'; }, re, { min: 0 })),
        el.shape === 'rect' ? labeled('圓角', num(() => st.radius || 0, v => { st.radius = v; }, re, { min: 0 })) : null),
      row('線型', seg([['solid', '實線'], ['dashed', '虛線'], ['dotted', '點線']], () => st.dash || 'solid', v => { st.dash = v; }, re))));
  }

  function imageSection(box, el, re) {
    const st = el.style;
    box.append(section('圖片',
      h('div', { class: 'btn-row' },
        h('button', { onclick: () => pickImage(el.id) }, el.src ? '更換圖片' : '選擇圖片'),
        el.src ? h('button', { onclick: () => restoreRatio(el) }, '恢復原始比例') : null,
        el.src ? h('button', { onclick: () => { pushHistory(); el.src = ''; re(); renderInspector(); } }, '移除圖片') : null),
      h('div', { class: 'hint', text: '也可以把圖片檔直接拖到這個圖片框上替換。' }),
      row('填滿', seg([['cover', '裁切填滿'], ['contain', '完整顯示']], () => st.fit || 'cover', v => { st.fit = v; }, re)),
      row('對位', selectBox([['center', '置中'], ['top', '上'], ['bottom', '下'], ['left', '左'], ['right', '右']], () => st.position || 'center', v => { st.position = v; }, re)),
      h('div', { class: 'grid4' },
        labeled('圓角', num(() => st.radius || 0, v => { st.radius = v; }, re, { min: 0 })),
        labeled('邊框寬', num(() => st.strokeWidth || 0, v => { st.strokeWidth = v; if (v && !st.stroke) st.stroke = 'line'; }, re, { min: 0 }))),
      row('邊框色', colorField(() => st.stroke, v => { if (v) st.stroke = v; else delete st.stroke; }, re, { none: true }))));
  }

  function splitCells(line) {
    const sep = line.includes('|') ? '|' : line.includes('\t') ? '\t' : ',';
    return line.split(sep).map(s => s.trim());
  }

  function chartToText(c) {
    const series = c.series || [];
    const head = [''].concat(series.map(s => s.name || '')).join(' | ');
    const n = Math.max((c.labels || []).length, ...series.map(s => (s.values || []).length), 0);
    const lines = [head];
    for (let i = 0; i < n; i++) lines.push([(c.labels || [])[i] || ''].concat(series.map(s => (s.values || [])[i] == null ? '' : s.values[i])).join(' | '));
    return lines.join('\n');
  }

  function textToChart(text, c) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return false;
    const head = splitCells(lines[0]);
    const names = head.slice(1);
    const rows = lines.slice(1).map(splitCells);
    c.labels = rows.map(r => r[0]);
    c.series = names.map((name, j) => ({
      name: name || '系列 ' + (j + 1),
      values: rows.map(r => { const v = parseFloat(String(r[j + 1] || '').replace(/,/g, '')); return isFinite(v) ? v : null; }),
      color: c.series && c.series[j] ? c.series[j].color : undefined,
    }));
    return true;
  }

  function chartSection(box, el, re) {
    const c = el.chart = el.chart || { kind: 'bar', labels: [], series: [] };
    const st = el.style;
    const data = h('textarea', { class: 'data', id: 'data-field', spellcheck: 'false' });
    data.value = chartToText(c);
    histInput(data, () => { if (textToChart(data.value, c)) re(); });
    data.addEventListener('change', () => renderInspector());
    const seriesColors = (c.series || []).map((s, i) => row(s.name || '系列 ' + (i + 1), colorField(() => s.color || ['accent', 'accent2', 'accent3', 'muted', 'text'][i % 5], v => { s.color = v; }, re)));
    box.append(section('圖表',
      row('類型', seg([['bar', '直條'], ['hbar', '橫條'], ['line', '折線'], ['donut', '圓環']], () => c.kind || 'bar', v => { c.kind = v; }, () => { re(); renderInspector(); })),
      h('div', { class: 'hint', text: '第一列是系列名稱，之後每列是「標籤 | 數值 | 數值…」，用 | 分隔。' }),
      data,
      h('div', { class: 'grid2' },
        labeled('單位（後綴）', textInput(() => c.unit, v => { c.unit = v; }, re)),
        labeled('前綴', textInput(() => c.prefix, v => { c.prefix = v; }, re))),
      h('div', { class: 'grid4' },
        labeled('字級', num(() => st.size || 24, v => { st.size = v; }, re, { min: 8 })),
        labeled('強調第幾項', num(() => (c.highlight == null ? 0 : +c.highlight + 1), v => { c.highlight = v >= 1 ? Math.round(v) - 1 : null; }, re, { min: 0 })),
        labeled('最大值', num(() => c.max, v => { c.max = v; }, re, { allowEmpty: true, placeholder: '自動' }))),
      h('div', { class: 'chk-row' },
        check('顯示數值', () => c.showValues !== false, v => { c.showValues = v; }, re),
        check('圖例', () => (c.showLegend != null ? c.showLegend : (c.series || []).length > 1), v => { c.showLegend = v; }, re),
        c.kind === 'line' ? check('面積', () => c.area, v => { c.area = v; }, re) : null),
      c.kind === 'donut' ? h('div', { class: 'grid2' },
        labeled('中心文字', textInput(() => c.centerLabel, v => { c.centerLabel = v || undefined; }, re, { placeholder: '預設為總和' })),
        labeled('中心小字', textInput(() => c.centerSub, v => { c.centerSub = v; }, re))) : null,
      c.kind === 'donut' ? null : seriesColors));
  }

  function tableSection(box, el, re) {
    const t = el.table = el.table || { rows: [], header: true };
    const st = el.style;
    const data = h('textarea', { class: 'data', id: 'data-field', spellcheck: 'false' });
    data.value = (t.rows || []).map(r => r.join(' | ')).join('\n');
    histInput(data, () => { t.rows = data.value.split(/\r?\n/).filter(l => l.trim()).map(splitCells); re(); });
    box.append(section('表格',
      h('div', { class: 'hint', text: '每列一行，儲存格用 | 分隔。' }),
      data,
      h('div', { class: 'chk-row' }, check('第一列是表頭', () => t.header !== false, v => { t.header = v; }, re)),
      h('div', { class: 'grid4' },
        labeled('字級', num(() => st.size || 26, v => { st.size = v; }, re, { min: 8 })),
        labeled('強調第幾欄', num(() => (t.highlightCol == null ? 0 : +t.highlightCol + 1), v => { t.highlightCol = v >= 1 ? Math.round(v) - 1 : null; }, re, { min: 0 })))));
  }

  // ---------- animation pane ----------
  function effectOptions(el) {
    return Object.entries(G.EFFECTS)
      .filter(([, fx]) => (!fx.textOnly || el.type === 'text') && (!fx.chartOnly || el.type === 'chart') && (!fx.sceneOnly || !!el.scene))
      .map(([k, fx]) => [k, fx.label]);
  }

  function defaultEffect(el) {
    if (el.type === 'chart') return 'grow';
    if (el.type === 'image') return 'zoom';
    if (el.type === 'shape') return 'fade';
    if (el.type === 'text' && /\d/.test(plain(el.text)) && (el.style.size || 0) >= 80) return 'count';
    return 'rise';
  }

  function suggestBuild(s) {
    const big = G.W * G.H * 0.5;
    const cand = s.elements.filter(e => !e.hidden && !(e.type === 'shape' && e.w * e.h > big));
    cand.sort((a, b) => (Math.round(a.y / 60) - Math.round(b.y / 60)) || (a.x - b.x));
    s.build = cand.map((e, i) => {
      const effect = e.type === 'shape' && Math.min(e.w, e.h) <= 16 ? 'wipe-right' : defaultEffect(e);
      return { id: e.id, effect, trigger: i === 0 ? 'after' : 'with', delay: i === 0 ? 100 : 120, duration: effect === 'grow' ? 1100 : effect === 'count' ? 1200 : 600 };
    });
  }

  function renderAnimPane(box) {
    const s = slide();
    s.build = s.build || [];
    const re = () => { drawSelection(); changed(); renderInspector(); };
    const tr = s.transition || {};
    box.append(section('本頁轉場',
      row('效果', selectBox([['', '跟隨預設'], ...Object.entries(G.TRANSITIONS)], () => tr.effect || '', v => { if (v) s.transition = Object.assign({ duration: E.deck.transition.duration }, s.transition, { effect: v }); else delete s.transition; }, re)),
      s.transition ? row('時長 ms', num(() => s.transition.duration || 500, v => { s.transition.duration = v; }, () => changed(), { step: 50, min: 0 })) : null));
    box.append(section('預設轉場（所有頁面）',
      row('效果', selectBox(Object.entries(G.TRANSITIONS), () => E.deck.transition.effect || 'fade', v => { E.deck.transition.effect = v; }, () => changed())),
      row('時長 ms', num(() => E.deck.transition.duration || 500, v => { E.deck.transition.duration = v; }, () => changed(), { step: 50, min: 0 }))));

    const list = h('div');
    const sec = section('動畫順序',
      h('div', { class: 'btn-row' },
        h('button', { class: 'primary', onclick: previewSlide }, '▶ 預覽本頁'),
        h('button', { onclick: addSelectedToBuild, title: '先在畫布上點選元素' }, '＋ 加入選取元素'),
        h('button', { onclick: () => { pushHistory(); suggestBuild(s); re(); toast('已套用建議動畫，可以再逐項調整'); } }, '建議動畫'),
        h('button', { onclick: () => { if (!confirm('把建議動畫套用到所有頁面？各頁原有的動畫設定會被取代。')) return; pushHistory(); E.deck.slides.forEach(suggestBuild); re(); } }, '全部頁面套用'),
        s.build.length ? h('button', { class: 'danger', onclick: () => { pushHistory(); s.build = []; re(); } }, '清除本頁') : null),
      list);
    box.append(sec);

    const steps = s.build.filter(b => elById(b.id));
    if (!steps.length) {
      list.append(h('div', { class: 'empty', text:'這頁還沒有動畫，所有元素一進頁就直接出現。\n點選畫布上的元素後按「＋ 加入選取元素」，或按「建議動畫」自動排一套。' }));
      list.lastChild.style.whiteSpace = 'pre-line';
    }
    let click = 0;
    steps.forEach((b, i) => {
      const el = elById(b.id);
      if (b.trigger === 'click') { click++; list.append(h('div', { class: 'anim-group-head', text: '第 ' + click + ' 次點擊' })); }
      else if (i === 0) list.append(h('div', { class: 'anim-group-head auto', text: '進入本頁時自動播放' }));
      const move = d => {
        const idx = s.build.indexOf(b), j = idx + d;
        if (j < 0 || j >= s.build.length) return;
        pushHistory();
        [s.build[idx], s.build[j]] = [s.build[j], s.build[idx]];
        re();
      };
      const card = h('div', { class: 'step' + (E.sel.has(b.id) ? ' on' : ''), onclick: e => { if (e.target.closest('select,input,button')) return; E.sel = new Set([b.id]); drawSelection(); $$('.step', box).forEach(n => n.classList.remove('on')); card.classList.add('on'); } },
        h('div', { class: 'step-top' },
          h('span', { class: 'step-no' + (b.trigger === 'click' ? ' click' : ''), text: String(i + 1) }),
          h('span', { class: 'step-name', text: G.elementLabel(el) }),
          h('button', { title: '往前', onclick: () => move(-1) }, '↑'),
          h('button', { title: '往後', onclick: () => move(1) }, '↓'),
          h('button', { title: '移除動畫', onclick: () => { pushHistory(); s.build.splice(s.build.indexOf(b), 1); re(); } }, '✕')),
        h('div', { class: 'step-fields' },
          labeled('效果', selectBox(effectOptions(el), () => b.effect || 'fade', v => { b.effect = v; }, () => changed())),
          labeled('開始', selectBox(Object.entries(G.TRIGGERS), () => b.trigger || 'click', v => { b.trigger = v; }, re)),
          labeled('延遲 ms', num(() => b.delay || 0, v => { b.delay = v; }, () => changed(), { step: 50, min: 0 })),
          labeled('時長 ms', num(() => b.duration == null ? 600 : b.duration, v => { b.duration = v; }, () => changed(), { step: 50, min: 0 }))));
      list.append(card);
    });
    box.append(section('說明', h('div', { class: 'hint', text: '「點擊時」：簡報時按一下才出現。「與上一個同時」：跟前一個一起開始，可用延遲錯開。「接續上一個」：前一個播完才開始。沒有加入動畫的元素會直接顯示。' })));
  }

  function addSelectedToBuild() {
    const s = slide();
    const ids = selected().map(e => e.id).filter(id => !s.build.some(b => b.id === id));
    if (!ids.length) { toast(E.sel.size ? '選取的元素已經有動畫了' : '先在畫布上點選元素'); return; }
    pushHistory();
    for (const id of ids) {
      const el = elById(id);
      const effect = defaultEffect(el);
      s.build.push({ id, effect, trigger: 'click', delay: 0, duration: effect === 'grow' ? 1100 : effect === 'count' ? 1200 : 600 });
    }
    drawSelection(); renderInspector(); changed();
  }

  function removeFromBuild() {
    const s = slide();
    const ids = new Set(Array.from(E.sel));
    if (!s.build.some(b => ids.has(b.id))) return;
    pushHistory();
    s.build = s.build.filter(b => !ids.has(b.id));
    drawSelection(); renderInspector(); changed();
  }

  // ---------- modes, play, preview ----------
  function setMode(m) {
    if (E.mode === m) return;
    commitTextEdit();
    E.mode = m;
    renderTopbar(); drawSelection(); renderInspector();
  }

  function openPlayer(deck, start, opts) {
    commitTextEdit();
    const host = h('div', { class: 'player-host' });
    document.body.append(host);
    let p = null, closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('fullscreenchange', onFs);
      p.destroy(); host.remove();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    const onFs = () => { if (!document.fullscreenElement && opts.fullscreen) close(); };
    p = new G.Player(host, deck, Object.assign({ assetBase: ASSET_BASE, onExit: close }, opts));
    host.append(h('button', { class: 'player-close', title: '離開（Esc）', onclick: e => { e.stopPropagation(); close(); } }, '✕'));
    if (opts.preview) host.append(h('div', { class: 'preview-tag', text: '預覽本頁動畫（點擊可加速）' }));
    if (opts.fullscreen && host.requestFullscreen) {
      host.requestFullscreen().then(() => document.addEventListener('fullscreenchange', onFs)).catch(() => {});
    }
    p.start(start);
    requestAnimationFrame(() => p.layout());
    return p;
  }

  function play() {
    const deck = G.clone(E.deck);
    const visible = deck.slides.map((s, i) => ({ s, i })).filter(o => !o.s.skip);
    let start = visible.findIndex(o => o.i >= E.si);
    if (start < 0) start = 0;
    openPlayer(deck, start, { fullscreen: true });
  }

  function previewSlide() {
    const deck = G.clone(E.deck);
    const s = G.clone(slide());
    delete s.skip;
    deck.slides = [s];
    openPlayer(deck, 0, { preview: true });
  }

  // ---------- versions & export ----------
  async function loadVersions() {
    const m = $('#version-menu');
    m.innerHTML = '';
    m.append(h('button', { onclick: () => { const label = prompt('版本名稱', '手動存檔'); if (label) snapshot(label); } }, '＋ 儲存目前版本'));
    try {
      const list = await (await fetch('/api/versions')).json();
      if (!list.length) m.append(h('div', { class: 'menu-note', text: '還沒有存過版本。' }));
      for (const v of list) {
        m.append(h('div', { class: 'ver' },
          h('div', { class: 'ver-main' }, h('b', { text: v.label }), h('small', { text: v.time + (v.stage ? ' · ' + (STAGE_LABEL[v.stage] || v.stage) : '') })),
          h('button', { class: 'small', onclick: () => restore(v.file) }, '還原')));
      }
    } catch (err) { m.append(h('div', { class: 'menu-note', text: '讀取版本失敗：' + err.message })); }
  }

  async function snapshot(label, stage) {
    commitTextEdit();
    if (!await flushSave()) { toast('尚有修改未完成儲存或同步，請確認儲存狀態後重試。', 4000); return false; }
    try {
      const r = await post('/api/snapshot', { label, stage, baseRev: E.rev });
      if (r.rev) E.rev = r.rev;
      if (stage) { E.deck.meta.stage = stage; E.base = JSON.stringify(E.deck); }
      renderTopbar();
      toast('已存成版本：' + label);
      return true;
    } catch (err) { toast('存版本失敗：' + err.message); return false; }
  }

  async function confirmStage() {
    const stage = E.mode === 'edit' ? 'static-confirmed' : 'animated';
    const ok = await snapshot(stage === 'static-confirmed' ? '靜態稿確認' : '動畫確認', stage);
    if (!ok) return;
    if (stage === 'static-confirmed') toast('靜態稿已確認並存成版本。下一步：與 Claude 確認動畫方案，再到「動畫」分頁預覽。', 4200);
    else toast('動畫已確認並存成版本。下一步：從「匯出」輸出 HTML 和 PDF。', 4200);
  }

  async function restore(file) {
    if (!confirm('還原到這個版本？目前的內容會先自動存成一個備份版本。')) return;
    commitTextEdit();
    if (!await flushSave()) { toast('尚有修改未完成儲存或同步，請確認儲存狀態後重試。', 4000); return false; }
    try {
      const r = await post('/api/restore', { file, baseRev: E.rev });
      E.deck = G.normalizeDeck(r.deck); E.rev = r.rev; E.base = JSON.stringify(E.deck);
      E.undo = []; E.redo = []; E.sel.clear(); E.dirty = false;
      E.si = Math.min(E.si, E.deck.slides.length - 1);
      renderAll(); closeMenus(); setStatus('已儲存', 'ok');
      toast('已還原版本');
    } catch (err) { toast('還原失敗：' + err.message); }
  }

  async function doExport(formats) {
    commitTextEdit();
    if (!await flushSave()) { toast('尚有修改未完成儲存或同步，請確認儲存狀態後重試。', 4000); return false; }
    const res = $('#export-result');
    res.textContent = '匯出中…（PDF 大約 10–30 秒）';
    try {
      const r = await post('/api/export', { formats: formats.split(',') });
      res.innerHTML = '';
      for (const f of r.files) {
        res.append(h('div', {}, h('a', { href: f.url, target: '_blank', text: f.format.toUpperCase() + '：' + f.name })), h('div', { class: 'path', text: f.path }));
      }
      toast('匯出完成');
    } catch (err) { res.textContent = '匯出失敗：' + err.message; }
  }

  // ---------- menus, modal ----------
  function closeMenus() { $$('.menu.open').forEach(m => m.classList.remove('open')); }

  function showHelp() {
    const keys = [
      ['拖曳', '移動（會吸附網格與其他元素）'], ['Alt＋拖曳', '暫時不吸附'], ['Shift＋拖曳', '只水平或垂直移動'],
      ['拉角落', '縮放（Shift 鎖定比例；圖片預設鎖比例）'], ['拉上方圓點', '旋轉（Shift 每 15°）'],
      ['雙擊文字', '編輯文字；Esc 結束'], ['Enter', '編輯選取的文字'],
      ['方向鍵', '移動 1 格（關閉吸附時 10px）'], ['Alt＋方向鍵', '移動 1px'],
      ['Shift＋點擊／框選', '多選'], ['Ctrl+A', '全選本頁'],
      ['Ctrl+C／X／V', '複製／剪下／貼上元素（也可以貼上圖片或文字）'], ['Ctrl+D', '再製'],
      ['Delete', '刪除（動畫模式下是移除動畫）'], ['Ctrl+]／[', '上移／下移一層（加 Shift 到最上／最下）'],
      ['Ctrl+Z／Ctrl+Y', '復原／重做'], ['G', '顯示／隱藏網格'], ['T', '新增文字'],
      ['PageUp／PageDown', '上一頁／下一頁'], ['F5', '播放'],
      ['播放時：→ 空白鍵 點擊', '下一步'], ['播放時：←', '上一頁'], ['播放時：N', '顯示講稿'], ['播放時：F／Esc', '全螢幕／離開'],
    ];
    const m = $('#modal');
    m.innerHTML = '';
    m.append(h('div', { class: 'modal-card', onclick: e => e.stopPropagation() },
      h('h3', { text: '快捷鍵' }),
      h('table', {}, keys.map(([k, v]) => h('tr', {}, h('td', { text: k }), h('td', { text: v })))),
      h('div', { class: 'btn-row', style: { justifyContent: 'flex-end', marginTop: '12px' } }, h('button', { class: 'primary', onclick: () => { m.hidden = true; } }, '知道了'))));
    m.hidden = false;
    m.onclick = () => { m.hidden = true; };
  }

  // ---------- clipboard ----------
  const CLIP_PREFIX = 'GRIDDECK:';
  function isTyping(t) { return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); }

  document.addEventListener('copy', e => {
    if (isTyping(e.target) || E.editingId || !E.sel.size) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', CLIP_PREFIX + JSON.stringify(selected()));
    toast('已複製 ' + E.sel.size + ' 個元素');
  });
  document.addEventListener('cut', e => {
    if (isTyping(e.target) || E.editingId || !E.sel.size || E.mode !== 'edit') return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', CLIP_PREFIX + JSON.stringify(selected()));
    deleteSel();
  });
  document.addEventListener('paste', async e => {
    if (isTyping(e.target) || E.editingId || E.mode !== 'edit') return;
    const cd = e.clipboardData;
    if (!cd) return;
    const file = Array.from(cd.files || []).find(f => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      try { await insertImage(await upload(file)); } catch (err) { toast(err.message); }
      return;
    }
    const text = cd.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    if (text.startsWith(CLIP_PREFIX)) {
      try { pasteEls(JSON.parse(text.slice(CLIP_PREFIX.length))); } catch (err) { toast('無法貼上'); }
      return;
    }
    addElement(Object.assign({ id: G.uid(), type: 'text', name: '', rotate: 0, text: G.escapeHtml(text.trim()).replace(/\r?\n/g, '<br>'), style: { font: 'body', size: 32, weight: 400, color: 'text', align: 'left', valign: 'top', lineHeight: 1.5 } }, centered(960, 240)));
  });

  // ---------- keyboard ----------
  document.addEventListener('keydown', e => {
    if (document.querySelector('.player-host')) return;
    if (!$('#modal').hidden) { if (e.key === 'Escape') $('#modal').hidden = true; return; }
    const k = e.key, mod = e.ctrlKey || e.metaKey, lk = k.toLowerCase();
    if (E.editingId) {
      if (k === 'Escape') { e.preventDefault(); commitTextEdit(); }
      return;
    }
    if (isTyping(e.target)) { if (k === 'Escape') e.target.blur(); return; }
    if (mod && lk === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && lk === 'y') { e.preventDefault(); redo(); return; }
    if (mod && lk === 's') { e.preventDefault(); flushSave().then(() => toast('已儲存')); return; }
    if (mod && lk === 'a') { e.preventDefault(); E.sel = new Set(els().map(x => x.id)); drawSelection(); renderInspector(); return; }
    if (mod && lk === 'd') { e.preventDefault(); if (E.mode === 'edit') duplicateSel(); return; }
    if (mod && (k === ']' || k === '}')) { e.preventDefault(); if (E.mode === 'edit') layer(e.shiftKey ? 'front' : 'up'); return; }
    if (mod && (k === '[' || k === '{')) { e.preventDefault(); if (E.mode === 'edit') layer(e.shiftKey ? 'back' : 'down'); return; }
    if (mod) return;
    if (k === 'Delete' || k === 'Backspace') { if (E.sel.size) { e.preventDefault(); if (E.mode === 'anim') removeFromBuild(); else deleteSel(); } return; }
    if (k === 'Escape') { E.sel.clear(); drawSelection(); renderInspector(); closeMenus(); return; }
    if (k === 'Enter' && E.sel.size === 1 && E.mode === 'edit') {
      const el = selected()[0];
      if (el.type === 'text') { e.preventDefault(); startTextEdit(el.id, null, true); }
      return;
    }
    if (k.startsWith('Arrow')) {
      e.preventDefault();
      if (E.sel.size && E.mode === 'edit') nudge(k, e);
      else if (!E.sel.size) selectSlide(E.si + (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1));
      return;
    }
    if (k === 'PageDown') { e.preventDefault(); selectSlide(E.si + 1); return; }
    if (k === 'PageUp') { e.preventDefault(); selectSlide(E.si - 1); return; }
    if (k === 'F5') { e.preventDefault(); play(); return; }
    if (lk === 'g') { E.deck.grid.show = !E.deck.grid.show; $('#grid-show').checked = E.deck.grid.show; updateGrid(); changed(); return; }
    if (lk === 't' && E.mode === 'edit') { insert('text'); return; }
    if (k === '?') showHelp();
  });

  // ---------- canvas context menu ----------
  let canvasMenu = null;
  function dismissCanvasMenu(restoreFocus) {
    if (!canvasMenu) return;
    canvasMenu.remove(); canvasMenu = null;
    if (restoreFocus) $('#stage-wrap').focus();
  }
  function showCanvasMenu(e) {
    if (!slide() || E.mode !== 'edit' || isTyping(e.target)) return;
    e.preventDefault();
    const targetId = e.target.closest('.gd-el')?.dataset.id;
    commitTextEdit(); closeMenus(); dismissCanvasMenu();
    if (targetId && elById(targetId)) {
      if (!E.sel.has(targetId)) E.sel = new Set([targetId]);
    } else E.sel.clear();
    drawSelection(); renderInspector();
    const list = selected();
    const menu = h('div', { id: 'canvas-context-menu', role: 'menu', 'aria-label': list.length ? '元素功能' : '畫布功能' });
    const action = (label, fn, disabled) => {
      const b = h('button', { role: 'menuitem', disabled, onclick: () => { dismissCanvasMenu(true); fn(); } }, label);
      menu.append(b);
    };
    const separator = () => menu.append(h('hr', { role: 'separator' }));
    const toggle = key => {
      pushHistory(); const value = !list.every(el => el[key]);
      list.forEach(el => { el[key] = value; });
      renderCanvas(); renderInspector(); changed();
    };
    menu.append(h('div', { class: 'context-title' }, list.length ? '已選取 ' + list.length + ' 個元素' : '新增元素'));
    if (list.length) {
      if (list.length === 1 && list[0].type === 'text') action('編輯文字', () => startTextEdit(list[0].id, null, true), list[0].locked);
      action('建立副本    Ctrl+D', duplicateSel);
      separator();
      action('移到最上層', () => layer('front'));
      action('上移一層', () => layer('up'));
      action('下移一層', () => layer('down'));
      action('移到最下層', () => layer('back'));
      separator();
      action('水平置中', () => align('hcenter'));
      action('垂直置中', () => align('vmiddle'));
      separator();
      action(list.every(el => el.locked) ? '解除位置鎖定' : '鎖定位置', () => toggle('locked'));
      action(list.every(el => el.hidden) ? '顯示元素' : '隱藏元素', () => toggle('hidden'));
      action('刪除    Delete', deleteSel);
    } else {
      action('新增文字', () => insert('text'));
      action('新增矩形', () => insert('rect'));
      action('新增圓形', () => insert('ellipse'));
      action('插入圖片…', () => insert('image'));
      separator();
      action('全選元素', () => { E.sel = new Set(els().map(el => el.id)); drawSelection(); renderInspector(); });
    }
    canvasMenu = menu; document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(e.clientX, innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - rect.height - 8)) + 'px';
    const buttons = Array.from(menu.querySelectorAll('button:not(:disabled)'));
    buttons[0]?.focus();
    menu.addEventListener('keydown', ev => {
      ev.stopPropagation();
      const i = buttons.indexOf(document.activeElement);
      if (ev.key === 'Escape' || ev.key === 'Tab') { ev.preventDefault(); dismissCanvasMenu(true); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); buttons[(i + (ev.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
      else if (ev.key === 'Home' || ev.key === 'End') { ev.preventDefault(); buttons[ev.key === 'Home' ? 0 : buttons.length-1].focus(); }
    });
  }

  // ---------- wiring ----------
  function wire() {
    const wrap = $('#stage-wrap');
    wrap.tabIndex = -1;
    wrap.addEventListener('contextmenu', showCanvasMenu);
    document.addEventListener('pointerdown', e => { if (canvasMenu && !canvasMenu.contains(e.target)) dismissCanvasMenu(); }, true);
    window.addEventListener('resize', () => dismissCanvasMenu());
    wrap.addEventListener('pointerdown', onPointerDown);
    wrap.addEventListener('dblclick', e => {
      if (E.mode !== 'edit') return;
      const n = e.target.closest('.gd-el');
      if (!n || !E.slideNode || !E.slideNode.contains(n)) return;
      const el = elById(n.dataset.id);
      if (!el || el.locked) return;
      if (el.type === 'text') startTextEdit(el.id, e);
      else if (el.type === 'image') pickImage(el.id);
      else if (el.type === 'chart' || el.type === 'table') { const f = $('#data-field'); if (f) f.focus(); }
    });
    wrap.addEventListener('dragover', e => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault(); wrap.classList.add('drop');
    });
    wrap.addEventListener('dragleave', e => { if (e.target === wrap) wrap.classList.remove('drop'); });
    wrap.addEventListener('drop', async e => {
      wrap.classList.remove('drop');
      const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      if (E.mode !== 'edit') setMode('edit');
      const p = toCanvas(e);
      const target = e.target.closest('.gd-el');
      const tEl = target && elById(target.dataset.id);
      try {
        if (tEl && tEl.type === 'image' && files.length === 1) {
          const path = await upload(files[0]);
          pushHistory(); tEl.src = path; rerenderElement(tEl); E.sel = new Set([tEl.id]); drawSelection(); renderInspector(); changed();
        } else {
          for (const [i, f] of files.entries()) await insertImage(await upload(f), { x: p.x + i * 60, y: p.y + i * 60 });
        }
      } catch (err) { toast(err.message); }
    });

    $$('.tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
    $$('[data-insert]').forEach(b => b.addEventListener('click', () => insert(b.dataset.insert)));
    $$('[data-menu]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const m = document.getElementById(b.dataset.menu);
      const open = !m.classList.contains('open');
      closeMenus();
      if (open) { m.classList.add('open'); if (m.id === 'version-menu') loadVersions(); }
    }));
    document.addEventListener('pointerdown', e => { if (!e.target.closest('.dropdown')) closeMenus(); });
    $$('[data-export]').forEach(b => b.addEventListener('click', () => doExport(b.dataset.export)));

    const add = $('#add-slide-menu');
    for (const [key, def] of Object.entries(L.LAYOUTS)) add.append(h('button', { onclick: () => { closeMenus(); addSlide(key); } }, def.label));

    histInput($('#deck-title'), () => { E.deck.meta.title = $('#deck-title').value; changed(); });
    $('#grid-show').addEventListener('change', e => { E.deck.grid.show = e.target.checked; updateGrid(); changed(); });
    $('#grid-snap').addEventListener('change', e => { E.deck.grid.snap = e.target.checked; changed(); });
    $('#grid-size').addEventListener('change', e => { E.deck.grid.size = +e.target.value; updateGrid(); changed(); });
    const ts = $('#theme-select');
    for (const [k, v] of Object.entries(G.THEMES)) ts.append(h('option', { value: k, text: v.label + (v.dark ? '（深色）' : '') }));
    ts.addEventListener('change', () => { pushHistory(); E.deck.theme.name = ts.value; E.deck.theme.overrides = {}; renderAll(); changed(); });
    $('#undo').addEventListener('click', undo);
    $('#redo').addEventListener('click', redo);
    $('#confirm-btn').addEventListener('click', confirmStage);
    $('#help-btn').addEventListener('click', showHelp);
    $('#play-btn').addEventListener('click', play);
    $('#dup-slide').addEventListener('click', duplicateSlide);
    $('#del-slide').addEventListener('click', deleteSlide);
    histInput($('#notes'), () => { if (slide()) { slide().notes = $('#notes').value; changed(); } });
    window.addEventListener('resize', () => fitStage());
    const panels = ['slides', 'inspector', 'notes'];
    let focusView = false, previousPanels = [];
    function updatePanels() {
      panels.forEach(name => $('#toggle-' + name).setAttribute('aria-expanded', String(!document.body.classList.contains('hide-' + name))));
      $('#focus-canvas').setAttribute('aria-pressed', String(focusView));
      $('#focus-canvas').textContent = focusView ? '返回編輯' : '專注畫布';
      requestAnimationFrame(fitStage);
    }
    panels.forEach(name => {
      $('#toggle-' + name).onclick = () => {
        focusView = false;
        document.body.classList.toggle('hide-' + name);
        if (innerWidth <= 700 && name !== 'notes' && !document.body.classList.contains('hide-' + name)) {
          document.body.classList.add('hide-' + (name === 'slides' ? 'inspector' : 'slides'));
        }
        updatePanels();
      };
    });
    $('#focus-canvas').onclick = () => {
      if (!focusView) {
        previousPanels = panels.filter(name => document.body.classList.contains('hide-' + name));
        panels.forEach(name => document.body.classList.add('hide-' + name));
      } else {
        panels.forEach(name => document.body.classList.toggle('hide-' + name, previousPanels.includes(name)));
      }
      focusView = !focusView; updatePanels();
    };
    if (innerWidth <= 1100) document.body.classList.add('hide-slides');
    if (innerWidth <= 700) document.body.classList.add('hide-inspector', 'hide-notes');
    updatePanels();
    new ResizeObserver(() => { if (E.deck) fitStage(); }).observe($('#stage-wrap'));

    window.addEventListener('beforeunload', e => { if (E.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  wire();
  // deck.scripts (e.g. scenes for animated elements) are loaded once so ▶ 播放 can show them
  function loadDeckScripts() {
    for (const src of (E.deck && Array.isArray(E.deck.scripts)) ? E.deck.scripts : []) {
      const s = document.createElement('script');
      s.src = '/deck/' + String(src).replace(/^\/+/, '');
      document.head.appendChild(s);
    }
  }
  load(false).then(() => { loadDeckScripts(); listen(); }).catch(err => {
    setStatus('載入失敗', 'err');
    $('#stage-wrap').innerHTML = '<div class="empty" style="margin:40px">無法載入簡報：' + G.escapeHtml(err.message) + '</div>';
  });

  window.__GD_EDITOR__ = E;
})();
