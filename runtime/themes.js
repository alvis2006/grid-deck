/* Grid Deck themes: shared by the editor, the player and the exported HTML. */
(function (G) {
  'use strict';

  const SANS = '"Noto Sans TC","Microsoft JhengHei","PingFang TC","Heiti TC","Noto Sans CJK TC",system-ui,sans-serif';
  const SERIF = '"Noto Serif TC","Source Han Serif TC","Songti TC","PMingLiU",serif';
  const MONO = '"JetBrains Mono","Cascadia Mono",Consolas,"Courier New",monospace';

  G.FONTS = { sans: SANS, serif: SERIF, mono: MONO };
  G.TOKENS = ['bg', 'surface', 'text', 'muted', 'line', 'accent', 'accent2', 'accent3'];
  G.TOKEN_LABELS = {
    bg: '背景', surface: '卡片', text: '文字', muted: '次要',
    line: '線條', accent: '主色', accent2: '輔色', accent3: '點綴',
  };

  G.THEMES = {
    paper: {
      label: '紙白', dark: false,
      tokens: { bg: '#F7F5F0', surface: '#FFFFFF', text: '#1C1B19', muted: '#6B675F', line: '#DDD7CC', accent: '#E4572E', accent2: '#2B59C3', accent3: '#E9B44C' },
    },
    mono: {
      label: '極簡白', dark: false,
      tokens: { bg: '#FFFFFF', surface: '#F3F4F6', text: '#0A0A0A', muted: '#6B7280', line: '#E5E7EB', accent: '#2F5BFF', accent2: '#0A0A0A', accent3: '#9CA3AF' },
    },
    forest: {
      label: '森綠', dark: false,
      tokens: { bg: '#F1F4EF', surface: '#FFFFFF', text: '#17241C', muted: '#5E6E63', line: '#D5DED6', accent: '#2F7A4F', accent2: '#C8963E', accent3: '#7FA88B' },
    },
    ink: {
      label: '墨黑', dark: true,
      tokens: { bg: '#111214', surface: '#1C1E22', text: '#F2F2F0', muted: '#9A9DA3', line: '#30333A', accent: '#7CDCB4', accent2: '#8AA9FF', accent3: '#FFB86B' },
    },
    navy: {
      label: '深藍', dark: true,
      tokens: { bg: '#0F1B2D', surface: '#172741', text: '#EEF2F7', muted: '#93A3B8', line: '#26395C', accent: '#4EA8FF', accent2: '#FFC857', accent3: '#6EE7B7' },
    },
  };

  function fontStack(v, fallback) {
    if (!v) return fallback;
    return G.FONTS[v] || v;
  }

  G.resolveTheme = function (deck) {
    const t = (deck && deck.theme) || {};
    const name = G.THEMES[t.name] ? t.name : 'paper';
    const base = G.THEMES[name];
    const ov = t.overrides || {};
    const tokens = Object.assign({}, base.tokens);
    for (const k of G.TOKENS) if (ov[k]) tokens[k] = ov[k];
    return {
      name, label: base.label, dark: base.dark, tokens,
      fonts: { heading: fontStack(ov.fontHeading, SANS), body: fontStack(ov.fontBody, SANS), mono: MONO },
    };
  };

  G.applyTheme = function (node, deck) {
    const th = G.resolveTheme(deck);
    for (const k of G.TOKENS) node.style.setProperty('--gd-' + k, th.tokens[k]);
    node.style.setProperty('--gd-font-heading', th.fonts.heading);
    node.style.setProperty('--gd-font-body', th.fonts.body);
    node.style.setProperty('--gd-font-mono', th.fonts.mono);
    node.dataset.theme = th.name;
    return th;
  };

  // A color value is either a theme token name or any CSS color.
  G.color = function (v, fallback) {
    if (v == null || v === '') return fallback || 'transparent';
    if (v === 'none' || v === 'transparent') return 'transparent';
    if (G.TOKENS.includes(v)) return 'var(--gd-' + v + ')';
    return v;
  };
})(window.GridDeck = window.GridDeck || {});
