/* Grid Deck presenter link: keeps audience windows in step with the presenter view.
   Messages travel over postMessage (presenter ⇄ the window it opened; works between file:// pages)
   and over a BroadcastChannel when both pages share an origin (e.g. served by the editor). */
(function (G) {
  'use strict';

  const TAG = 'grid-deck-link';

  G.deckKey = function (deck) {
    const m = (deck && deck.meta) || {};
    return String(m.createdAt || m.title || 'deck');
  };

  G.createLink = function (key, onMessage) {
    const seen = [];
    const peers = new Set();
    let bc = null;
    try { bc = new BroadcastChannel(TAG + ':' + key); } catch (e) { /* unsupported or opaque origin */ }

    function receive(data, source) {
      if (!data || data.tag !== TAG || data.key !== key || seen.includes(data.mid)) return;
      seen.push(data.mid);
      if (seen.length > 300) seen.shift();
      if (source && source !== window) peers.add(source);
      onMessage(data);
    }
    window.addEventListener('message', e => receive(e.data, e.source));
    if (bc) bc.onmessage = e => receive(e.data, null);

    return {
      addPeer(w) { if (w && w !== window) peers.add(w); },
      send(msg) {
        const data = Object.assign({ tag: TAG, key, mid: Math.random().toString(36).slice(2) + Date.now().toString(36) }, msg);
        for (const w of Array.from(peers)) {
          try {
            if (w.closed) { peers.delete(w); continue; }
            w.postMessage(data, '*');
          } catch (e) { peers.delete(w); }
        }
        if (bc) { try { bc.postMessage(data); } catch (e) { /* closed */ } }
      },
    };
  };

  // Audience side: while a presenter is connected, follow it and hand keys/clicks to it;
  // otherwise the page plays on its own as usual.
  G.followPresenter = function (player, deck) {
    let lastSeen = 0, sid = '', seq = -1;
    const black = document.createElement('div');
    black.style.cssText = 'position:fixed;inset:0;background:#000;z-index:20;display:none;cursor:none';
    document.body.appendChild(black);

    const link = G.createLink(G.deckKey(deck), msg => {
      if (msg.from !== 'presenter') return;
      if (msg.type === 'bye') { lastSeen = 0; black.style.display = 'none'; return; }
      if (msg.type !== 'state') return;
      if (msg.sid === sid && msg.seq <= seq) return;   // stale copy from the other channel
      sid = msg.sid; seq = msg.seq;
      lastSeen = Date.now();
      black.style.display = msg.black ? 'block' : 'none';
      player.sync(msg);
    });
    if (window.opener) link.addPeer(window.opener);

    player.opts.remote = action => {
      if (Date.now() - lastSeen > 6000) return false;
      link.send({ from: 'audience', type: 'input', action });
      return true;
    };
    black.addEventListener('click', () => player.input('next'));
    const hello = () => link.send({ from: 'audience', type: 'hello', state: player.state() });
    hello();
    setInterval(hello, 2000);
  };
})(window.GridDeck = window.GridDeck || {});
