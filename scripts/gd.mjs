#!/usr/bin/env node
// Grid Deck CLI: new | serve | validate | export | shots | snapshot
import fs from 'node:fs';
import path from 'node:path';
import { resolveDeckDir, loadDeck, createDeckFromOutline, snapshot } from './lib/deck-io.mjs';
import { validateDeck } from './lib/validate.mjs';
import { exportDeck, screenshots } from './lib/export.mjs';
import { serve, openBrowser } from './lib/server.mjs';

const HELP = `Grid Deck CLI

  node gd.mjs new <deckDir> --outline <outline.json> [--force]
      用大綱 JSON 產生 <deckDir>/deck.json（套用起始版型）
  node gd.mjs serve <deckDir> [--port 5610] [--open]
      啟動本機編輯器（自動存檔到 deck.json，外部修改會即時同步）
  node gd.mjs validate <deckDir>
      檢查結構、圖片路徑、預設文字與可能的文字溢出
  node gd.mjs export <deckDir> [--formats html,pdf]
      匯出到 <deckDir>/exports/（html 會同時產生觀眾用 <名稱>.html 與簡報者用 <名稱>-presenter.html）
  node gd.mjs shots <deckDir> [--slides 1,3,5]
      每頁截一張 1920×1080 PNG 到 <deckDir>/exports/shots/（動畫完成後的畫面）
  node gd.mjs snapshot <deckDir> --label <名稱> [--stage static-confirmed|animated]
      把目前的 deck.json 存成版本`;

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) { flags[k] = next; i++; } else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

function readJsonFile(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  if (!cmd || cmd === 'help' || flags.help) { console.log(HELP); return; }
  if (!pos[0]) throw new Error('請提供 deck 資料夾路徑\n\n' + HELP);
  const dir = resolveDeckDir(pos[0]);

  if (cmd === 'new') {
    if (!flags.outline) throw new Error('需要 --outline <outline.json>');
    const deck = createDeckFromOutline(dir, readJsonFile(path.resolve(flags.outline)), !!flags.force);
    console.log(`已建立 ${path.join(dir, 'deck.json')}（${deck.slides.length} 頁，主題 ${deck.theme.name}）`);
    const r = validateDeck(deck, dir);
    printReport(r);
    return;
  }

  if (cmd === 'validate') {
    const r = validateDeck(loadDeck(dir), dir);
    printReport(r);
    if (r.errors.length) process.exitCode = 1;
    return;
  }

  if (cmd === 'export') {
    const formats = typeof flags.formats === 'string' ? flags.formats.split(',') : ['html', 'pdf'];
    const files = await exportDeck(dir, formats);
    const LABEL = { html: 'HTML（觀眾）', presenter: 'HTML（簡報者畫面）', pdf: 'PDF' };
    for (const f of files) if (!f.implicit) console.log(`${LABEL[f.format] || f.format.toUpperCase()}: ${f.path}`);
    return;
  }

  if (cmd === 'shots') {
    const list = typeof flags.slides === 'string' ? flags.slides.split(',').map(n => parseInt(n, 10)).filter(Boolean) : null;
    const files = await screenshots(dir, list);
    for (const f of files) console.log(f);
    return;
  }

  if (cmd === 'snapshot') {
    const r = snapshot(dir, typeof flags.label === 'string' ? flags.label : '手動存檔', typeof flags.stage === 'string' ? flags.stage : null);
    console.log('已存成版本：' + path.join(dir, 'versions', r.file));
    return;
  }

  if (cmd === 'serve') {
    const { url } = await serve(dir, { port: flags.port });
    console.log(`Grid Deck editor: ${url}`);
    console.log(`deck: ${path.join(dir, 'deck.json')}`);
    if (flags.open) openBrowser(url);
    return;
  }

  throw new Error('未知指令：' + cmd + '\n\n' + HELP);
}

function printReport(r) {
  if (!r.errors.length && !r.warnings.length) { console.log('檢查通過：沒有錯誤或警告。'); return; }
  for (const e of r.errors) console.log('✗ ' + e);
  for (const w of r.warnings) console.log('⚠ ' + w);
  console.log(`錯誤 ${r.errors.length}，警告 ${r.warnings.length}`);
}

main().catch(e => { console.error('錯誤：' + e.message); process.exit(1); });
