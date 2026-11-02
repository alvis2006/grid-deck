// Local editor server: serves the editor, autosaves deck.json, pushes external edits, exports.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { RUNTIME_DIR, deckFile, readDeckText, writeDeck, snapshot, listVersions, restoreVersion, mimeOf } from './deck-io.mjs';
import { exportDeck } from './export.mjs';
import { validateDeck } from './validate.mjs';

function safeJoin(root, rel) {
  const p = path.resolve(root, '.' + path.sep + decodeURIComponent(rel));
  const r = path.resolve(root);
  if (!(p === r || p.startsWith(r + path.sep))) return null;
  if (fs.existsSync(p)) {
    const rel = path.relative(fs.realpathSync(r), fs.realpathSync(p));
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  }
  return p;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('檔案太大')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(buf);
}

function sendFile(res, file) {
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': mimeOf(file), 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

function uniqueAssetName(dir, name) {
  const ext = (path.extname(name) || '.png').toLowerCase().replace(/[^.\w]/g, '');
  const base = path.basename(name, path.extname(name)).replace(/[\\/:*?"<>|\s#%&]+/g, '-').slice(0, 60) || 'image';
  let n = 0, file;
  do { file = base + (n ? '-' + n : '') + ext; n++; } while (fs.existsSync(path.join(dir, file)));
  return file;
}

export function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* no browser */ }
}

export function serve(deckDir, opts) {
  opts = opts || {};
  const file = deckFile(deckDir);
  if (!fs.existsSync(file)) throw new Error('找不到 ' + file);
  for (const sub of ['assets', 'versions', 'exports']) fs.mkdirSync(path.join(deckDir, sub), { recursive: true });

  let rev = 1;
  let lastText = readDeckText(deckDir);
  const clients = new Set();
  const broadcast = msg => { const line = `data: ${JSON.stringify(msg)}\n\n`; for (const c of clients) c.write(line); };

  const refresh = () => {
    const text = readDeckText(deckDir);
    JSON.parse(text);
    if (text !== lastText) { lastText = text; rev++; broadcast({ type: 'external', rev }); }
  };

  // Pick up edits made outside the editor (for example by Claude) and tell open editors.
  fs.watchFile(file, { interval: 600 }, (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs) return;
    try { refresh(); } catch { /* Ignore incomplete external writes. */ }
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      const origin = req.headers.origin;
      if (origin && origin !== 'http://' + req.headers.host) return send(res, 403, { error: '只接受本機編輯器的請求' });
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return sendFile(res, path.join(RUNTIME_DIR, 'editor.html'));
      if (req.method === 'GET' && p.startsWith('/runtime/')) {
        const f = safeJoin(RUNTIME_DIR, p.slice('/runtime/'.length));
        return f ? sendFile(res, f) : send(res, 403, { error: 'forbidden' });
      }
      if (req.method === 'GET' && p.startsWith('/deck/')) {
        const f = safeJoin(deckDir, p.slice('/deck/'.length));
        return f ? sendFile(res, f) : send(res, 403, { error: 'forbidden' });
      }
      if (p === '/api/deck' && req.method === 'GET') {
        refresh();
        return send(res, 200, `{"rev":${rev},"deck":${lastText}}`);
      }
      if (p === '/api/deck' && req.method === 'PUT') {
        const body = JSON.parse((await readBody(req, 50e6)).toString('utf8'));
        refresh();
        if (body.baseRev !== rev) return send(res, 409, { rev, error: 'conflict' });
        const report = validateDeck(body.deck, deckDir);
        if (report.errors.length) return send(res, 400, { error: report.errors.join('；') });
        lastText = writeDeck(deckDir, body.deck);
        rev++;
        broadcast({ type: 'external', rev });
        return send(res, 200, { rev });
      }
      if (p === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ type: 'hello', rev })}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      if (p === '/api/upload' && req.method === 'POST') {
        const buf = await readBody(req, 60e6);
        const dir = path.join(deckDir, 'assets');
        const name = uniqueAssetName(dir, url.searchParams.get('name') || 'image.png');
        fs.writeFileSync(path.join(dir, name), buf);
        return send(res, 200, { path: 'assets/' + name });
      }
      if (p === '/api/versions' && req.method === 'GET') return send(res, 200, listVersions(deckDir));
      if (p === '/api/snapshot' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}');
        refresh();
        if (body.baseRev != null && body.baseRev !== rev) return send(res, 409, { rev, error: '檔案已更新，請等待同步後重試' });
        const r = snapshot(deckDir, body.label || '手動存檔', body.stage || null);
        if (r.text) { lastText = r.text; rev++; broadcast({ type: 'external', rev }); }
        return send(res, 200, { file: r.file, rev });
      }
      if (p === '/api/restore' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}');
        refresh();
        if (body.baseRev != null && body.baseRev !== rev) return send(res, 409, { rev, error: '檔案已更新，請等待同步後重試' });
        const r = restoreVersion(deckDir, body.file);
        lastText = r.text; rev++;
        broadcast({ type: 'external', rev });
        return send(res, 200, { rev, deck: r.deck });
      }
      if (p === '/api/export' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}');
        const files = await exportDeck(deckDir, body.formats);
        return send(res, 200, { files: files.map(f => Object.assign({}, f, { url: '/deck/exports/' + encodeURIComponent(f.name) })) });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, e instanceof SyntaxError || e instanceof URIError ? 400 : 500, { error: e.message });
    }
  });

  server.on('close', () => { fs.unwatchFile(file); for (const c of clients) c.end(); clients.clear(); });
  return new Promise((resolve, reject) => {
    let port = opts.port == null ? 5610 : Number(opts.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) { fs.unwatchFile(file); reject(new Error('port 必須是 0–65535 的整數')); return; }
    const maxPort = Math.min(65535, port + 30);
    const tryListen = () => {
      server.once('error', e => {
        if (e.code === 'EADDRINUSE' && port < maxPort) { port++; tryListen(); }
        else { fs.unwatchFile(file); reject(e); }
      });
      server.listen(port, '127.0.0.1', () => {
        port = server.address().port;
        const url = `http://127.0.0.1:${port}/`;
        resolve({ server, port, url });
      });
    };
    tryListen();
  });
}
