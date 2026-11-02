/* Grid Deck presenter view: current and next previews, notes, timer and a slide strip.
   It drives the audience window(s) through G.createLink; the audience page follows with Player.sync. */
(function (G) {
  'use strict';

  const pad = n => String(n).padStart(2, '0');
  function fmt(ms) {
    const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60);
    return (hh ? hh + ':' + pad(mm) : pad(mm)) + ':' + pad(s % 60);
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // buttons never take focus, so Space / Enter always mean "next step"
  function btn(text, title, onClick, cls) {
    const b = h('button', cls, text);
    b.type = 'button';
    b.tabIndex = -1;
    if (title) b.title = title;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', onClick);
    return b;
  }

  G.bootPresenter = function () {
    const deck = G.normalizeDeck(window.__GD_DECK__);
    const audienceUrl = window.__GD_AUDIENCE__ || '';
    const slides = deck.slides.filter(s => !s.skip);
    document.documentElement.classList.add('gd-presenter');

    // ---------- layout ----------
    const app = h('div', 'gdp');
    const top = h('header', 'gdp-top');
    const counter = h('div', 'gdp-counter');
    const nav = h('div', 'gdp-nav');
    nav.append(btn('◀', '上一步（←）', () => act('prev')), counter, btn('▶', '下一步（→、空白鍵或點目前畫面）', () => act('next')));
    const elapsedEl = h('div', 'gdp-elapsed', '00:00');
    const slideTimeEl = h('div', 'gdp-slide-time');
    const tstack = h('div', 'gdp-tstack');
    tstack.append(elapsedEl, slideTimeEl);
    const playBtn = btn('開始', '開始／暫停計時（T）', () => toggleTimer());
    const timer = h('div', 'gdp-timer');
    timer.append(tstack, playBtn, btn('重設', '計時歸零', () => resetTimer()));
    const clock = h('div', 'gdp-clock');
    const status = h('div', 'gdp-status');
    const blackBtn = btn('黑屏', '觀眾畫面黑屏／恢復（B）', () => toggleBlack());
    const openBtn = btn('開啟觀眾畫面', '開啟觀眾畫面（O）', () => openAudience(), 'primary');
    top.append(h('div', 'gdp-title', deck.meta.title), nav, h('div', 'gdp-spacer'), timer, clock, status, blackBtn, openBtn);

    const curPanel = h('section', 'gdp-panel gdp-current');
    const curLabel = h('div', 'gdp-label');
    const curName = h('b');
    const steps = h('div', 'gdp-steps');
    curLabel.append(h('span', null, '目前畫面'), curName, h('span', 'gdp-grow'), steps);
    const curStage = h('div', 'gdp-stage');
    curPanel.append(curLabel, curStage);

    const nextPanel = h('section', 'gdp-panel gdp-next');
    const nextLabel = h('div', 'gdp-label');
    const nextText = h('b');
    nextLabel.append(h('span', null, '下一個畫面'), nextText);
    const nextStage = h('div', 'gdp-stage');
    nextPanel.append(nextLabel, nextStage);

    const notesPanel = h('section', 'gdp-panel gdp-notes');
    const notesLabel = h('div', 'gdp-label');
    const fontBox = h('div', 'gdp-font');
    fontBox.append(btn('A−', '講稿字變小（-）', () => font(-2)), btn('A+', '講稿字變大（+）', () => font(2)));
    notesLabel.append(h('span', null, '講稿'), h('span', 'gdp-grow'), fontBox);
    const notesBody = h('div', 'gdp-notes-body');
    notesPanel.append(notesLabel, notesBody);

    const side = h('div', 'gdp-side');
    side.append(nextPanel, notesPanel);
    const main = h('main', 'gdp-main');
    main.append(curPanel, side);
    const strip = h('footer', 'gdp-strip');
    app.append(top, main, strip);
    const toastEl = h('div', 'gdp-toast');
    document.body.append(app, toastEl);

    const cur = new G.Player(curStage, deck, { interactive: false });
    const nextP = new G.Player(nextStage, deck, { interactive: false });
    curStage.appendChild(h('div', 'gdp-black', '觀眾畫面黑屏中'));
    nextStage.appendChild(h('div', 'gdp-end', '已經是最後一頁'));
    curStage.addEventListener('click', () => act('next'));
    if (window.ResizeObserver) {
      new ResizeObserver(() => cur.layout()).observe(curStage);
      new ResizeObserver(() => nextP.layout()).observe(nextStage);
    }

    const thumbs = slides.map((s, i) => {
      const t = h('div', 'gdp-thumb');
      t.title = (i + 1) + (s.name ? '　' + s.name : '');
      t.appendChild(G.renderSlide(deck, s, {}));
      t.appendChild(h('span', null, String(i + 1)));
      t.addEventListener('click', () => jumpTo(i));
      strip.appendChild(t);
      return t;
    });

    let toastTimer = 0;
    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
    }

    let notesSize = +store.get('gdp-notes-size', 22) || 22;
    function font(d) {
      notesSize = Math.min(48, Math.max(14, notesSize + d));
      app.style.setProperty('--gdp-notes', notesSize + 'px');
      store.set('gdp-notes-size', notesSize);
    }
    font(0);

    // ---------- audience link ----------
    const sid = Math.random().toString(36).slice(2);
    let seq = 0, black = false, audienceWin = null, lastHello = 0;
    const link = G.createLink(G.deckKey(deck), msg => {
      if (msg.from !== 'audience') return;
      lastHello = Date.now();
      if (msg.type === 'hello') send({});
      else if (msg.type === 'input') act(msg.action);
      updateStatus();
    });
    function send(extra) {
      const s = cur.state();
      link.send(Object.assign({ from: 'presenter', type: 'state', sid, seq: ++seq, index: s.index, played: s.played, black }, extra));
    }
    function openAudience() {
      if (!audienceUrl) { toast('找不到觀眾畫面的檔案'); return; }
      const w = window.open(audienceUrl + '#' + (cur.index + 1), 'gd-audience', 'popup=yes,width=1280,height=760');
      if (!w) { toast('瀏覽器擋住了新視窗：請允許這個頁面開啟彈出視窗，再按一次'); return; }
      audienceWin = w;
      link.addPeer(w);
      try { w.focus(); } catch (e) { /* ignore */ }
      toast('把觀眾畫面拖到投影幕上，在那個視窗按 F 進入全螢幕');
      updateStatus();
    }
    function updateStatus() {
      const live = Date.now() - lastHello < 5000;
      const opened = !!(audienceWin && !audienceWin.closed);
      status.className = 'gdp-status' + (live ? ' ok' : opened ? ' wait' : '');
      status.textContent = live ? '觀眾畫面已連線' : opened ? '等待觀眾畫面…' : '觀眾畫面未開啟';
      openBtn.textContent = live || opened ? '重新開啟觀眾畫面' : '開啟觀眾畫面';
    }
    function toggleBlack() {
      black = !black;
      app.classList.toggle('is-black', black);
      blackBtn.classList.toggle('on', black);
      blackBtn.textContent = black ? '恢復畫面' : '黑屏';
      send({});
    }
    window.addEventListener('beforeunload', () => link.send({ from: 'presenter', type: 'bye' }));

    // ---------- navigation ----------
    function act(action) {
      autoStart();
      const before = cur.state();
      if (action === 'next') cur.next();
      else if (action === 'prev') cur.prev();
      else if (action === 'first') cur.go(0, { transition: false });
      else if (action === 'last') cur.go(slides.length - 1, { transition: false, built: true });
      else return;
      const after = cur.state();
      const finish = action === 'next' && before.index === after.index && before.played === after.played;
      send({ finish, jump: action === 'first' || action === 'last' });
      refresh();
    }
    function jumpTo(i) {
      autoStart();
      cur.go(i, { transition: false });
      send({ jump: true });
      refresh();
    }

    // ---------- timer ----------
    let running = false, acc = 0, since = 0, slideSince = Date.now(), slideIdx = -1;
    const elapsed = () => acc + (running ? Date.now() - since : 0);
    function toggleTimer() {
      if (running) { acc += Date.now() - since; running = false; } else { since = Date.now(); running = true; }
      tick();
    }
    function resetTimer() { running = false; acc = 0; slideSince = Date.now(); tick(); }
    function autoStart() { if (!running && !acc) toggleTimer(); }

    // ---------- views ----------
    let shown = '';
    function refresh() {
      const st = cur.state();
      const s = slides[st.index];
      if (!s || !cur.cur) return;
      shown = st.index + ':' + st.played;
      const played = Math.max(1, st.played);
      const groups = cur.cur.groups.length;
      const clicks = groups - 1, done = Math.min(clicks, played - 1);

      counter.innerHTML = '';
      counter.append(String(st.index + 1), h('span', null, ' / ' + slides.length));
      curName.textContent = s.name || '';
      steps.innerHTML = '';
      for (let k = 0; k < clicks; k++) steps.appendChild(h('i', k < done ? 'done' : ''));
      const left = clicks - done;
      if (clicks) steps.appendChild(h('em', null, left ? '還有 ' + left + ' 個動畫' : '動畫已播完'));

      if (st.index !== slideIdx) {
        slideIdx = st.index;
        slideSince = Date.now();
        notesBody.textContent = s.notes || '（本頁沒有講稿）';
        notesBody.classList.toggle('empty', !s.notes);
        notesBody.scrollTop = 0;
        thumbs.forEach((t, i) => t.classList.toggle('cur', i === st.index));
        thumbs[st.index].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      }

      nextPanel.classList.remove('ended');
      if (played < groups) {
        nextP.go(st.index, { transition: false, played: played + 1 });
        nextText.textContent = '本頁下一個動畫（' + (done + 1) + ' / ' + clicks + '）';
      } else if (st.index + 1 < slides.length) {
        nextP.go(st.index + 1, { transition: false, played: 1 });
        const n = slides[st.index + 1];
        nextText.textContent = '第 ' + (st.index + 2) + ' 頁' + (n.name ? '　' + n.name : '');
      } else {
        nextPanel.classList.add('ended');
        nextText.textContent = '';
      }
    }

    function tick() {
      const now = new Date();
      elapsedEl.textContent = fmt(elapsed());
      elapsedEl.classList.toggle('paused', !running);
      playBtn.textContent = running ? '暫停' : elapsed() ? '繼續' : '開始';
      slideTimeEl.textContent = '本頁 ' + fmt(Date.now() - slideSince);
      clock.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
      updateStatus();
      const st = cur.state();
      if (st.index + ':' + st.played !== shown) refresh();
    }

    window.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') { e.preventDefault(); act('next'); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); act('prev'); }
      else if (k === 'Home') { e.preventDefault(); act('first'); }
      else if (k === 'End') { e.preventDefault(); act('last'); }
      else if (k === 'b' || k === 'B' || k === '.') toggleBlack();
      else if (k === 't' || k === 'T') toggleTimer();
      else if (k === 'o' || k === 'O') openAudience();
      else if (k === '+' || k === '=') font(2);
      else if (k === '-' || k === '_') font(-2);
    });

    cur.start((parseInt(location.hash.slice(1), 10) || 1) - 1);
    refresh();
    tick();
    setInterval(tick, 250);
    send({});
  };
})(window.GridDeck = window.GridDeck || {});
