// Export: self-contained HTML player, PDF (headless Chrome/Edge print), PNG screenshots.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { RUNTIME_DIR, loadDeck, mimeOf } from './deck-io.mjs';

export function findBrowser() {
  if (process.env.GD_BROWSER && fs.existsSync(process.env.GD_BROWSER)) return process.env.GD_BROWSER;
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = process.platform === 'win32' ? [
    path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  const hit = candidates.find(p => p && fs.existsSync(p));
  if (!hit) throw new Error('找不到 Chrome 或 Edge，無法匯出 PDF／截圖。可以設定環境變數 GD_BROWSER 指向瀏覽器執行檔。');
  return hit;
}

function runHeadless(extraArgs, url, timeoutMs) {
  const browser = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-deck-browser-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--mute-audio', '--disable-background-networking', '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=8000', `--user-data-dir=${profile}`, ...extraArgs, url,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(browser, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('瀏覽器逾時')); }, timeoutMs || 90000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', code => {
      clearTimeout(timer);
      fs.rm(profile, { recursive: true, force: true }, () => {});
      if (code === 0) resolve(); else reject(new Error('瀏覽器結束碼 ' + code + (err ? '：' + err.slice(-400) : '')));
    });
  });
}

function inlineAsset(deckDir, src) {
  if (!src || /^(data:|https?:|blob:)/.test(src)) return src;
  const abs = path.resolve(deckDir, src);
  const rel = path.relative(fs.realpathSync(deckDir), fs.existsSync(abs) ? fs.realpathSync(abs) : abs);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('素材必須在簡報資料夾內：' + src);
  if (!fs.existsSync(abs)) throw new Error('找不到素材：' + src);
  if (!fs.statSync(abs).isFile()) throw new Error('素材不是檔案：' + src);
  return `data:${mimeOf(abs)};base64,${fs.readFileSync(abs).toString('base64')}`;
}

function inlineDeck(deckDir) {
  const deck = loadDeck(deckDir);
  for (const s of deck.slides || []) {
    if (s.background && s.background.image) s.background.image = inlineAsset(deckDir, s.background.image);
    for (const el of s.elements || []) if (el.type === 'image' && el.src) el.src = inlineAsset(deckDir, el.src);
  }
  return deck;
}

const scriptJson = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// deck.scripts: deck-local JavaScript files (for example scenes for animated elements), inlined after the runtime.
function deckScripts(deckDir, deck) {
  return (Array.isArray(deck.scripts) ? deck.scripts : []).map(src => {
    const abs = path.resolve(deckDir, String(src));
    const rel = path.relative(fs.realpathSync(deckDir), fs.existsSync(abs) ? fs.realpathSync(abs) : abs);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('腳本必須在簡報資料夾內：' + src);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('找不到腳本：' + src);
    return fs.readFileSync(abs, 'utf8');
  });
}

function htmlPage(deck, { rootClass, titleSuffix, css, js, extraJs, globals, boot }) {
  const read = f => fs.readFileSync(path.join(RUNTIME_DIR, f), 'utf8');
  const title = (String((deck.meta && deck.meta.title) || 'Grid Deck') + (titleSuffix || '')).replace(/[<&>"]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));
  const vars = Object.entries(Object.assign({ __GD_DECK__: deck }, globals)).map(([k, v]) => `window.${k} = ${scriptJson(v)};`).join('\n');
  return `<!doctype html>
<html lang="zh-Hant" class="${rootClass}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="data:,">
<style>
${css.map(read).join('\n')}
</style>
</head>
<body>
<script>${vars}</script>
<script>
${js.map(read).concat(extraJs || []).join('\n').replace(/<\/script/gi, '<\\/script')}
</script>
<script>${boot}</script>
</body>
</html>
`;
}

// Audience player: plays on its own, or follows the presenter view once one connects.
export function buildHtml(deckDir) {
  const deck = inlineDeck(deckDir);
  return htmlPage(deck, {
    rootClass: 'gd-export', css: ['deck.css'],
    js: ['themes.js', 'render.js', 'player.js', 'link.js'], extraJs: deckScripts(deckDir, deck), boot: 'GridDeck.boot();',
  });
}

// Presenter view: opens audienceFile (same folder) and drives it.
export function buildPresenterHtml(deckDir, audienceFile) {
  const deck = inlineDeck(deckDir);
  return htmlPage(deck, {
    rootClass: 'gd-presenter', titleSuffix: ' \u00b7 \u7c21\u5831\u8005\u756b\u9762', css: ['deck.css', 'presenter.css'],
    js: ['themes.js', 'render.js', 'player.js', 'link.js', 'presenter.js'], extraJs: deckScripts(deckDir, deck),
    globals: { __GD_AUDIENCE__: encodeURIComponent(audienceFile) }, boot: 'GridDeck.bootPresenter();',
  });
}

function exportName(deckDir) {
  return path.basename(path.resolve(deckDir)).replace(/[\\/:*?"<>|]+/g, '-') || 'deck';
}

export async function exportDeck(deckDir, formats) {
  if (formats != null && (!Array.isArray(formats) || !formats.length)) throw new Error('formats 必須是非空陣列');
  formats = [...new Set((formats || ['html', 'pdf']).map(f => String(f).trim().toLowerCase()))];
  if (formats.some(f => !['html', 'pdf', 'presenter'].includes(f))) throw new Error('只支援 html、pdf、presenter 格式');
  const outDir = path.join(deckDir, 'exports');
  fs.mkdirSync(outDir, { recursive: true });
  const name = exportName(deckDir);
  const htmlPath = path.join(outDir, name + '.html');
  fs.writeFileSync(htmlPath, buildHtml(deckDir), 'utf8');
  const files = [];
  if (formats.includes('html')) files.push({ format: 'html', path: htmlPath, name: path.basename(htmlPath) });
  if (formats.includes('html') || formats.includes('presenter')) {
    const presenterPath = path.join(outDir, name + '-presenter.html');
    fs.writeFileSync(presenterPath, buildPresenterHtml(deckDir, path.basename(htmlPath)), 'utf8');
    files.push({ format: 'presenter', path: presenterPath, name: path.basename(presenterPath) });
  }
  if (formats.includes('pdf')) {
    const pdfPath = path.join(outDir, name + '.pdf');
    if (fs.existsSync(pdfPath)) fs.rmSync(pdfPath);
    await runHeadless(['--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`], pathToFileURL(htmlPath).href + '#print', 180000);
    if (!fs.existsSync(pdfPath)) throw new Error('PDF 沒有產生出來');
    files.push({ format: 'pdf', path: pdfPath, name: path.basename(pdfPath) });
  }
  if (!formats.includes('html')) {
    // keep the HTML anyway: the PDF is printed from it and it is useful on its own
    files.push({ format: 'html', path: htmlPath, name: path.basename(htmlPath), implicit: true });
  }
  return files;
}

// One PNG per slide (final, fully-built state) for visual QA.
export async function screenshots(deckDir, slideNumbers) {
  const deck = loadDeck(deckDir);
  const count = (deck.slides || []).filter(s => !s.skip).length;
  const outDir = path.join(deckDir, 'exports', 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  const htmlPath = path.join(deckDir, 'exports', exportName(deckDir) + '.html');
  fs.writeFileSync(htmlPath, buildHtml(deckDir), 'utf8');
  const list = slideNumbers && slideNumbers.length ? slideNumbers : Array.from({ length: count }, (_, i) => i + 1);
  const out = [];
  const href = pathToFileURL(htmlPath).href;
  const queue = list.filter(n => n >= 1 && n <= count);
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const n = queue.shift();
      const file = path.join(outDir, String(n).padStart(2, '0') + '.png');
      await runHeadless(['--window-size=1920,1080', '--force-device-scale-factor=1', `--screenshot=${file}`], `${href}#static=${n}`, 60000);
      out.push(file);
    }
  });
  await Promise.all(workers);
  return out.sort();
}
