// Reading/writing deck folders: deck.json, assets/, versions/, exports/.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUNTIME_DIR = path.join(SKILL_ROOT, 'runtime');

const require = createRequire(import.meta.url);
export const Layouts = require(path.join(RUNTIME_DIR, 'layouts.js'));

export function resolveDeckDir(p) {
  const abs = path.resolve(p);
  if (abs.toLowerCase().endsWith('.json') && fs.existsSync(abs) && fs.statSync(abs).isFile()) return path.dirname(abs);
  return abs;
}

export const deckFile = dir => path.join(dir, 'deck.json');

export function readDeckText(dir) {
  return fs.readFileSync(deckFile(dir), 'utf8').replace(/^﻿/, '');
}

export function loadDeck(dir) {
  return JSON.parse(readDeckText(dir));
}

export function serializeDeck(deck) {
  return JSON.stringify(deck, null, 2) + '\n';
}

export function writeDeck(dir, deck) {
  deck.meta = deck.meta || {};
  deck.meta.updatedAt = new Date().toISOString();
  const text = serializeDeck(deck);
  const tmp = deckFile(dir) + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, deckFile(dir));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return text;
}

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function slug(s) {
  return String(s || 'version').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'version';
}

// Saves the current deck.json as versions/<time>-<label>.json. With a stage, deck.meta.stage is updated first.
export function snapshot(dir, label, stage) {
  const deck = loadDeck(dir);
  let text = null;
  if (stage) { deck.meta = deck.meta || {}; deck.meta.stage = stage; text = writeDeck(dir, deck); }
  const vdir = path.join(dir, 'versions');
  fs.mkdirSync(vdir, { recursive: true });
  const file = `${stamp()}-${randomUUID()}-${slug(label)}.json`;
  const record = Object.assign({}, deck, { __version: { label: label || '版本', stage: stage || deck.meta?.stage || null, savedAt: new Date().toISOString() } });
  fs.writeFileSync(path.join(vdir, file), serializeDeck(record), 'utf8');
  return { file, text };
}

export function listVersions(dir) {
  const vdir = path.join(dir, 'versions');
  if (!fs.existsSync(vdir)) return [];
  return fs.readdirSync(vdir).filter(f => f.endsWith('.json')).sort().reverse().map(file => {
    let label = file, stage = null, savedAt = null;
    try {
      const v = JSON.parse(fs.readFileSync(path.join(vdir, file), 'utf8')).__version || {};
      label = v.label || file; stage = v.stage || null; savedAt = v.savedAt || null;
    } catch { /* unreadable version file */ }
    const t = savedAt ? new Date(savedAt) : fs.statSync(path.join(vdir, file)).mtime;
    const time = t.toLocaleString('zh-TW', { hour12: false });
    return { file, label, stage, time };
  });
}

export function restoreVersion(dir, file) {
  if (typeof file !== 'string' || !/^[\w.\-\u0080-￿]+\.json$/.test(file)) throw new Error('版本檔名不合法');
  const src = path.join(dir, 'versions', file);
  if (!fs.existsSync(src)) throw new Error('找不到版本：' + file);
  snapshot(dir, '還原前自動備份');
  const deck = JSON.parse(fs.readFileSync(src, 'utf8'));
  delete deck.__version;
  const text = writeDeck(dir, deck);
  return { deck, text };
}

export function createDeckFromOutline(dir, outline, force) {
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(deckFile(dir)) && !force) throw new Error(`${deckFile(dir)} 已存在（要覆蓋請加 --force）`);
  for (const sub of ['assets', 'versions', 'exports']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const deck = Layouts.buildDeck(outline);
  writeDeck(dir, deck);
  return deck;
}

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
};
export const mimeOf = p => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
