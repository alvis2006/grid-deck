/* Grid Deck player: build animations, slide transitions, presenting, print and static modes. */
(function (G) {
  'use strict';

  const EASE = 'cubic-bezier(.2,.75,.25,1)';

  G.EFFECTS = {
    fade: { label: '淡入', kf: [{ opacity: 0 }, { opacity: 1 }] },
    rise: { label: '上浮', kf: [{ opacity: 0, transform: 'translateY(48px)' }, { opacity: 1, transform: 'none' }] },
    drop: { label: '下落', kf: [{ opacity: 0, transform: 'translateY(-48px)' }, { opacity: 1, transform: 'none' }] },
    'slide-left': { label: '從右滑入', kf: [{ opacity: 0, transform: 'translateX(96px)' }, { opacity: 1, transform: 'none' }] },
    'slide-right': { label: '從左滑入', kf: [{ opacity: 0, transform: 'translateX(-96px)' }, { opacity: 1, transform: 'none' }] },
    zoom: { label: '放大', kf: [{ opacity: 0, transform: 'scale(.82)' }, { opacity: 1, transform: 'none' }] },
    pop: { label: '彈出', easing: 'cubic-bezier(.3,.7,.3,1)', kf: [{ opacity: 0, transform: 'scale(.5)', offset: 0 }, { opacity: 1, transform: 'scale(1.06)', offset: 0.65 }, { opacity: 1, transform: 'none', offset: 1 }] },
    blur: { label: '模糊淡入', kf: [{ opacity: 0, filter: 'blur(18px)' }, { opacity: 1, filter: 'blur(0px)' }] },
    'wipe-right': { label: '向右擦除', kf: [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }] },
    'wipe-up': { label: '向上擦除', kf: [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)' }] },
    spin: { label: '旋入', kf: [{ opacity: 0, transform: 'rotate(-120deg) scale(.4)' }, { opacity: 1, transform: 'none' }] },
    count: { label: '數字跳動', kf: [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1 }], special: 'count', textOnly: true },
    grow: { label: '圖表生長', kf: [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1 }], special: 'grow', chartOnly: true },
    scene: { label: '畫面下一步', kf: [{ opacity: 1 }, { opacity: 1 }], sceneOnly: true },
  };

  G.TRIGGERS = { click: '點擊時', with: '與上一個同時', after: '接續上一個' };

  G.TRANSITIONS = { none: '無', fade: '淡入', slide: '推移', drift: '滑移', zoom: '縮放', rise: '上升' };
  G.SCENES = G.SCENES || {};

  // Turn slide.build into click groups with absolute start times.
  // Group 0 plays automatically when the slide appears; each 'click' step starts a new group.
  G.buildGroups = function (slide) {
    const ids = new Set((slide.elements || []).filter(e => !e.hidden).map(e => e.id));
    const seen = new Set();
    const sceneSteps = {};
    const groups = [[]];
    let prevStart = 0, prevEnd = 0;
    for (let raw of slide.build || []) {
      if (!ids.has(raw.id)) continue;
      // a scene element (image with `scene`) may appear many times: each entry advances it one step
      if (raw.effect === 'scene') raw = Object.assign({}, raw, { sceneStep: (sceneSteps[raw.id] = (sceneSteps[raw.id] || 0) + 1) });
      else if (seen.has(raw.id)) continue;
      else seen.add(raw.id);
      const step = Object.assign({ effect: 'fade', trigger: 'click', delay: 0, duration: 600 }, raw);
      const delay = Math.max(0, +step.delay || 0), dur = Math.max(0, +step.duration || 0);
      let start;
      if (step.trigger === 'click') { groups.push([]); start = delay; }
      else if (step.trigger === 'with') start = prevStart + delay;
      else start = prevEnd + delay;
      step.start = start; step.dur = dur;
      groups[groups.length - 1].push(step);
      prevStart = start; prevEnd = start + dur;
    }
    return groups;
  };

  // ---------- count-up helper ----------
  function findNumber(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const m = n.data.match(/-?\d[\d,]*(\.\d+)?/);
      if (m) {
        const raw = m[0];
        const value = parseFloat(raw.replace(/,/g, ''));
        if (!isFinite(value)) continue;
        return {
          node: n, before: n.data.slice(0, m.index), after: n.data.slice(m.index + raw.length), original: n.data,
          value, decimals: m[1] ? m[1].length - 1 : 0, comma: raw.includes(','),
        };
      }
    }
    return null;
  }
  function fmtCount(c, v) {
    let s = v.toFixed(c.decimals);
    if (c.comma) {
      const [i, d] = s.split('.');
      s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : '');
    }
    return c.before + s + c.after;
  }

  // ---------- step preparation ----------
  function prepareStep(slideNode, step) {
    const elNode = slideNode.querySelector('[data-id="' + CSS.escape(step.id) + '"]');
    if (!elNode) return null;
    if (step.effect === 'scene') return { step, parts: [], timers: [], raf: 0, scene: elNode.__scene || null };
    const inner = elNode.querySelector('.gd-inner') || elNode;
    const fx = G.EFFECTS[step.effect] || G.EFFECTS.fade;
    const easing = step.easing || fx.easing || EASE;
    const parts = [];
    const add = (target, kf, timing, offset) => {
      const a = target.animate(kf, Object.assign({ duration: step.dur, easing, fill: 'both' }, timing || {}));
      a.pause(); a.currentTime = 0;
      parts.push({ anim: a, offset: offset || 0 });
    };
    add(inner, fx.kf);
    const prepared = { step, parts, counter: null, timers: [], raf: 0 };
    if (fx.special === 'grow' && elNode.classList.contains('gd-chart')) {
      const bars = inner.querySelectorAll('.gd-bar');
      const stagger = Math.min(90, step.dur / Math.max(1, bars.length) / 2);
      bars.forEach((b, i) => add(b, [{ transform: b.classList.contains('gd-bar-h') ? 'scaleX(0)' : 'scaleY(0)' }, { transform: 'none' }], { duration: step.dur * 0.8 }, i * stagger));
      inner.querySelectorAll('.gd-line-path').forEach(p => add(p, [{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }], { duration: step.dur }, 0));
      inner.querySelectorAll('.gd-dot,.gd-val,.gd-area').forEach((d, i) => add(d, [{ opacity: 0 }, { opacity: 1 }], { duration: Math.min(400, step.dur / 2) }, step.dur * 0.5 + i * 20));
      inner.querySelectorAll('.gd-seg').forEach((s, i, all) => {
        const len = +s.dataset.len, C = +s.dataset.c;
        add(s, [{ strokeDasharray: '0 ' + C }, { strokeDasharray: len + ' ' + (C - len) }], { duration: step.dur / all.length, easing: 'linear' }, i * step.dur / all.length);
      });
    }
    if (fx.special === 'count') {
      const c = findNumber(inner);
      if (c) { prepared.counter = c; c.node.data = fmtCount(c, 0); }
    }
    return prepared;
  }

  function playPrepared(p) {
    if (p.scene) {
      const k = p.step.sceneStep, dur = p.step.dur;
      p.timers.push(setTimeout(() => p.scene.go(k, dur), p.step.start));
      return;
    }
    for (const part of p.parts) {
      part.anim.effect.updateTiming({ delay: p.step.start + part.offset });
      part.anim.currentTime = 0;
      part.anim.play();
    }
    const c = p.counter;
    if (c) {
      const t0 = performance.now() + p.step.start;
      const dur = Math.max(1, p.step.dur);
      const tick = now => {
        const t = Math.min(1, Math.max(0, (now - t0) / dur));
        const e = 1 - Math.pow(1 - t, 3);
        c.node.data = t >= 1 ? c.original : fmtCount(c, c.value * e);
        if (t < 1) p.raf = requestAnimationFrame(tick);
      };
      p.raf = requestAnimationFrame(tick);
    }
  }

  function finishPrepared(p) {
    if (p.scene) {
      p.timers.forEach(clearTimeout); p.timers = [];
      p.scene.go(p.step.sceneStep, 0);
      return;
    }
    for (const part of p.parts) { try { part.anim.finish(); } catch (e) { /* detached */ } }
    if (p.raf) cancelAnimationFrame(p.raf);
    if (p.counter) p.counter.node.data = p.counter.original;
  }

  function preparedRunning(p) {
    if (p.scene) return p.timers.length > 0 && p.scene.busy();
    return p.parts.some(part => part.anim.playState === 'running') || (p.counter && p.counter.node.data !== p.counter.original);
  }

  // ---------- slide state ----------
  function makeState(deck, slide, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'gd-frame';
    const node = G.renderSlide(deck, slide, { assetBase: opts.assetBase || '', still: !!opts.still });
    wrap.appendChild(node);
    const groups = G.buildGroups(slide);
    return { slide, wrap, node, groups, prepared: null, played: 0 };
  }

  // A slide as it looks after `played` click groups (1 = just entered), with every animation finished.
  function stillState(deck, slide, played, opts) {
    const st = makeState(deck, slide, Object.assign({}, opts, { still: true }));
    prepareState(st);
    st.prepared.slice(0, played).forEach(g => g.forEach(finishPrepared));
    return st;
  }

  function prepareState(st) {
    st.prepared = st.groups.map(g => g.map(step => prepareStep(st.node, step)).filter(Boolean));
  }

  // ---------- transitions ----------
  function runTransition(effect, prevWrap, nextWrap, dir, dur) {
    const anims = [];
    const opt = { duration: dur, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' };
    const W = G.W;
    if (effect === 'fade') {
      anims.push(nextWrap.animate([{ opacity: 0 }, { opacity: 1 }], opt));
      // slides drawn over a shared backdrop are see-through, so the old one has to fade out too
      if (prevWrap && prevWrap.querySelector('.gd-has-backdrop')) anims.push(prevWrap.animate([{ opacity: 1 }, { opacity: 0 }], opt));
    } else if (effect === 'slide') {
      anims.push(nextWrap.animate([{ transform: 'translateX(' + dir * W + 'px)' }, { transform: 'none' }], opt));
      if (prevWrap) anims.push(prevWrap.animate([{ transform: 'none' }, { transform: 'translateX(' + -dir * W + 'px)' }], opt));
    } else if (effect === 'zoom') {
      anims.push(nextWrap.animate([{ opacity: 0, transform: 'scale(1.06)' }, { opacity: 1, transform: 'none' }], opt));
      if (prevWrap) anims.push(prevWrap.animate([{ opacity: 1 }, { opacity: 0 }], opt));
    } else if (effect === 'drift') {
      // content slides in from the side it is heading to, the old slide slides out the other way
      const D = 280;
      anims.push(nextWrap.animate([{ opacity: 0, transform: 'translateX(' + dir * D + 'px)' }, { opacity: 1, transform: 'none' }], opt));
      if (prevWrap) anims.push(prevWrap.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(' + -dir * D + 'px)' }], opt));
    } else if (effect === 'rise') {
      anims.push(nextWrap.animate([{ opacity: 0, transform: 'translateY(' + dir * 80 + 'px)' }, { opacity: 1, transform: 'none' }], opt));
    }
    return anims;
  }

  // ---------- player ----------
  class Player {
    constructor(host, deck, opts) {
      this.opts = opts || {};
      this.deck = G.normalizeDeck(deck);
      this.slides = this.deck.slides.filter(s => !s.skip);
      this.host = host;
      host.classList.add('gd-player');
      this.viewport = document.createElement('div');
      this.viewport.className = 'gd-viewport';
      this.frames = document.createElement('div');
      this.frames.className = 'gd-frames';
      this.viewport.appendChild(this.frames);
      // one live copy of the deck backdrop behind all slides; its lines drift on every slide change
      if (G.hasBackdrop(this.deck)) {
        this.backdrop = G.renderBackdrop(this.deck, 0);
        this.backdrop.classList.add('gd-backdrop-live');
        G.applyTheme(this.backdrop, this.deck);   // theme colours are CSS variables set per slide; this layer sits outside the slides
        this.frames.appendChild(this.backdrop);
      }
      this.notes = document.createElement('div');
      this.notes.className = 'gd-notes';
      host.appendChild(this.viewport);
      host.appendChild(this.notes);
      this.index = -1;
      this.cur = null;
      this.trAnims = [];
      this.timers = [];
      this.onKey = this.onKey.bind(this);
      this.onResize = this.layout.bind(this);
      window.addEventListener('resize', this.onResize);
      // interactive: false = driven from outside only (presenter previews)
      if (this.opts.interactive !== false) {
        window.addEventListener('keydown', this.onKey);
        this.viewport.addEventListener('click', e => { if (e.button === 0) this.input('next'); });
        let sx = null;
        this.viewport.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') sx = e.clientX; });
        this.viewport.addEventListener('pointerup', e => {
          if (sx == null) return;
          const dx = e.clientX - sx; sx = null;
          if (Math.abs(dx) > 50) { e.stopPropagation(); this.input(dx < 0 ? 'next' : 'prev'); }
        });
      }
      this.layout();
    }

    layout() {
      const vw = this.viewport.clientWidth || window.innerWidth, vh = this.viewport.clientHeight || window.innerHeight;
      const s = Math.min(vw / G.W, vh / G.H);
      this.frames.style.transform = 'translate(' + (vw - G.W * s) / 2 + 'px,' + (vh - G.H * s) / 2 + 'px) scale(' + s + ')';
    }

    start(i) {
      if (!this.slides.length) { this.frames.innerHTML = '<div class="gd-empty">沒有可播放的頁面</div>'; return; }
      this.go(Math.min(Math.max(0, i || 0), this.slides.length - 1), { transition: false });
    }

    go(i, o) {
      o = o || {};
      this.finishTransition();
      const slide = this.slides[i];
      if (!slide) return;
      const prev = this.cur;
      const next = makeState(this.deck, slide, this.opts);
      this.frames.appendChild(next.wrap);
      prepareState(next);
      if (o.built) { next.prepared.forEach(g => g.forEach(finishPrepared)); next.played = next.groups.length; }
      else if (o.played != null) {
        // show exactly the first `played` click groups, already finished
        next.played = Math.min(Math.max(0, o.played), next.groups.length);
        next.prepared.slice(0, next.played).forEach(g => g.forEach(finishPrepared));
      }
      if (prev) this.stopState(prev);
      this.cur = next;
      this.index = i;
      this.renderNotes();
      if (this.opts.hash) { try { history.replaceState(null, '', '#' + (i + 1)); } catch (e) { /* file:// */ } }
      const tr = (slide.transition && slide.transition.effect) ? slide.transition : this.deck.transition;
      const effect = o.transition === false || !prev ? 'none' : (tr.effect || 'none');
      const dur = +tr.duration || 500;
      if (this.backdrop) {
        const animate = prev && o.transition !== false;
        G.moveBackdrop(this.backdrop, this.deck, this.deck.slides.indexOf(slide), animate ? (+this.deck.backdrop.duration || 1400) : 0);
      }
      const done = () => {
        this.trAnims.forEach(a => a.cancel());
        this.trAnims = [];
        if (prev) prev.wrap.remove();
        if (!o.built && o.played == null) this.enter(next);
      };
      this.trAnims = effect === 'none' ? [] : runTransition(effect, prev && prev.wrap, next.wrap, o.dir || 1, dur);
      if (!this.trAnims.length) { done(); return; }
      this.trDone = done;
      this.trAnims[0].onfinish = () => { if (this.trDone === done) { this.trDone = null; done(); } };
    }

    finishTransition() {
      if (this.trDone) { const d = this.trDone; this.trDone = null; d(); }
    }

    enter(st) {
      if (st.groups[0].length) this.playGroup(st, 0);
      else st.played = 1;
      this.afterGroup(st);
    }

    playGroup(st, gi) {
      st.prepared[gi].forEach(playPrepared);
      st.played = gi + 1;
    }

    groupDuration(st, gi) {
      return Math.max(0, ...st.groups[gi].map(s => s.start + s.dur));
    }

    afterGroup(st) {
      if (!this.opts.preview) return;
      const gi = st.played - 1;
      const wait = (gi >= 0 ? this.groupDuration(st, gi) : 0) + 700;
      this.timers.push(setTimeout(() => {
        if (this.cur !== st) return;
        if (st.played < st.groups.length) { this.playGroup(st, st.played); this.afterGroup(st); }
        else if (this.opts.onExit) this.timers.push(setTimeout(() => this.opts.onExit(), 600));
      }, wait));
    }

    stopState(st) {
      if (st.prepared) st.prepared.forEach(g => g.forEach(finishPrepared));
    }

    next() {
      if (this.trDone) { this.finishTransition(); return; }
      const st = this.cur;
      if (!st) return;
      const running = st.prepared.slice(0, st.played).some(g => g.some(preparedRunning));
      if (running) { st.prepared.slice(0, st.played).forEach(g => g.forEach(finishPrepared)); return; }
      if (st.played < st.groups.length) { this.playGroup(st, st.played); return; }
      if (this.opts.preview) return;
      if (this.index < this.slides.length - 1) this.go(this.index + 1, { dir: 1 });
    }

    prev() {
      if (this.opts.preview) return;
      if (this.index > 0) this.go(this.index - 1, { dir: -1, built: true });
    }

    // Navigation from keys, clicks and swipes. A connected presenter (opts.remote) can take it over.
    input(action) {
      if (this.opts.remote && this.opts.remote(action)) return;
      if (action === 'next') this.next();
      else if (action === 'prev') this.prev();
      else if (action === 'first') this.go(0, { transition: false });
      else if (action === 'last') this.go(this.slides.length - 1, { transition: false, built: true });
    }

    state() {
      return { index: this.index, played: this.cur ? this.cur.played : 0 };
    }

    finishRunning() {
      if (this.trDone) { this.finishTransition(); return; }
      const st = this.cur;
      if (st && st.prepared) st.prepared.slice(0, st.played).forEach(g => g.forEach(finishPrepared));
    }

    // Follow another player's position: single steps animate like a normal click, anything else jumps.
    sync(t) {
      const i = t.index, n = Math.max(1, t.played || 0);
      if (!this.slides[i]) return;
      const st = this.cur;
      if (st && i === this.index) {
        if (this.trDone) { if (n <= 1) return; this.finishTransition(); }
        if (n === st.played) { if (t.finish) this.finishRunning(); return; }
        if (n === st.played + 1 && n <= st.groups.length) { this.playGroup(st, st.played); return; }
      } else if (st && n <= 1 && (t.jump || i === this.index + 1)) {
        this.go(i, t.jump ? { transition: false } : { dir: 1 });
        return;
      } else if (st && !t.jump && i === this.index - 1 && n >= G.buildGroups(this.slides[i]).length) {
        this.go(i, { dir: -1, built: true });
        return;
      }
      this.go(i, { transition: false, played: n });
    }

    renderNotes() {
      const s = this.slides[this.index];
      this.notes.innerHTML = '<div class="gd-notes-head">' + (this.index + 1) + ' / ' + this.slides.length + (s && s.name ? ' · ' + G.escapeHtml(s.name) : '') + '</div><div class="gd-notes-body"></div>';
      this.notes.lastChild.textContent = (s && s.notes) || '（本頁沒有講稿）';
    }

    onKey(e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') { e.preventDefault(); this.input('next'); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); this.input('prev'); }
      else if (k === 'Home') { e.preventDefault(); this.input('first'); }
      else if (k === 'End') { e.preventDefault(); this.input('last'); }
      else if (k === 'n' || k === 'N') this.host.classList.toggle('show-notes');
      else if (k === 'f' || k === 'F') {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (this.host.requestFullscreen) this.host.requestFullscreen().catch(() => {});
      } else if (k === 'Escape' && this.opts.onExit) { e.preventDefault(); this.opts.onExit(); }
    }

    destroy() {
      window.removeEventListener('keydown', this.onKey);
      window.removeEventListener('resize', this.onResize);
      this.timers.forEach(clearTimeout);
      this.trDone = null;
      this.trAnims.forEach(a => a.cancel());
      if (this.cur) this.stopState(this.cur);
      this.host.classList.remove('gd-player', 'show-notes');
      this.host.innerHTML = '';
    }
  }
  G.Player = Player;

  // ---------- print & static ----------
  G.renderPrint = function (container, deck, opts) {
    deck = G.normalizeDeck(deck);
    document.documentElement.classList.add('gd-print-root');
    container.classList.add('gd-print');
    // one page per click state: the slide as it enters, then after each click
    for (const s of deck.slides.filter(s => !s.skip)) {
      const n = G.buildGroups(s).length;
      for (let played = 1; played <= n; played++) {
        const page = document.createElement('div');
        page.className = 'gd-page';
        container.appendChild(page);
        page.appendChild(stillState(deck, s, played, opts || {}).node);
      }
    }
  };

  // The slide fully built (every click played) — used for screenshots.
  G.renderStatic = function (container, deck, index, opts) {
    deck = G.normalizeDeck(deck);
    const slides = deck.slides.filter(s => !s.skip);
    document.documentElement.classList.add('gd-static-root');
    const s = slides[Math.min(Math.max(0, index), slides.length - 1)];
    if (!s) return;
    const holder = document.createElement('div');
    container.appendChild(holder);
    holder.appendChild(stillState(deck, s, G.buildGroups(s).length, opts || {}).node);
  };

  G.boot = function () {
    const deck = window.__GD_DECK__;
    const h = decodeURIComponent(location.hash.slice(1));
    if (h === 'print') return G.renderPrint(document.body, deck);
    const m = h.match(/^static=(\d+)/);
    if (m) return G.renderStatic(document.body, deck, +m[1] - 1);
    const root = document.createElement('div');
    root.id = 'gd-root';
    document.body.appendChild(root);
    const p = new G.Player(root, deck, { hash: true, assetBase: '' });
    p.start((parseInt(h, 10) || 1) - 1);
    window.__GD_PLAYER__ = p;
    if (G.followPresenter) G.followPresenter(p, deck);
  };
})(window.GridDeck = window.GridDeck || {});
