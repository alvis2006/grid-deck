import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDeckFromOutline, snapshot, loadDeck, writeDeck, restoreVersion } from '../scripts/lib/deck-io.mjs';
import { validateDeck } from '../scripts/lib/validate.mjs';
import { buildHtml, exportDeck } from '../scripts/lib/export.mjs';
import { serve } from '../scripts/lib/server.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(process.env.GD_TEST_TMP || os.tmpdir(), 'grid-deck-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  createDeckFromOutline(dir, { title: '測試簡報', slides: [{ layout: 'cover', title: '測試標題' }] });
  return dir;
}

test('repeated snapshots preserve every version; restore keeps a backup', t => {
  const dir = fixture(t);
  const names = new Set(Array.from({length: 30}, () => snapshot(dir, '同名版本').file));
  assert.equal(names.size, 30);
  const first = [...names][0];
  const deck = loadDeck(dir); deck.meta.title = '修改後'; writeDeck(dir, deck);
  restoreVersion(dir, first);
  assert.equal(loadDeck(dir).meta.title, '測試簡報');
  assert.equal(fs.readdirSync(path.join(dir, 'versions')).length, 31);
});

test('malformed structures produce diagnostics instead of crashing', () => {
  for (const deck of [null, { slides: {} }, { slides: [null] },
    { slides: [{ id: 's', elements: [null], build: {} }] },
    { slides: [{ id: 's', elements: [], build: [null, {duration: -1}] }] }]) {
    assert.ok(validateDeck(deck).errors.length);
  }
});

test('HTML export rejects files from a sibling folder with a matching prefix', async t => {
  const dir = fixture(t), sibling = dir + '-outside';
  fs.mkdirSync(sibling); t.after(() => fs.rmSync(sibling, { recursive: true, force: true }));
  fs.writeFileSync(path.join(sibling, 'secret.png'), 'private');
  const deck = loadDeck(dir);
  deck.slides[0].background = { image: '../' + path.basename(sibling) + '/secret.png' };
  writeDeck(dir, deck);
  assert.throws(() => buildHtml(dir), /素材必須/);
  await assert.rejects(exportDeck(dir, ['typo']), /只支援/);
});

test('HTML audience and presenter export preserve Chinese content', async t => {
  const dir = fixture(t);
  const files = await exportDeck(dir, ['html']);
  assert.equal(files.length, 2);
  for (const file of files) {
    const html = fs.readFileSync(file.path, 'utf8');
    assert.ok(html.includes('測試標題'));
    assert.ok(html.includes('GridDeck.boot'));
  }
});

test('server detects external edits on GET, rejects stale saves and notifies other editors', async t => {
  const dir = fixture(t);
  const {server, url} = await serve(dir, {port: 0});
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const get = () => fetch(url + 'api/deck').then(r => r.json());
  const put = (rev, deck) => fetch(url + 'api/deck', { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({baseRev: rev, deck}) });
  const first = await get();
  const deck = loadDeck(dir); deck.meta.title = '外部修改'; writeDeck(dir, deck);
  const second = await get();
  assert.ok(second.rev > first.rev);
  assert.equal(second.deck.meta.title, '外部修改');
  assert.equal((await put(first.rev, first.deck)).status, 409);
  assert.equal(loadDeck(dir).meta.title, '外部修改');
  const abort = new AbortController();
  const stream = await fetch(url + 'api/events', { signal: abort.signal });
  const reader = stream.body.getReader();
  await reader.read();
  second.deck.meta.title = '編輯器修改';
  assert.equal((await put(second.rev, second.deck)).status, 200);
  const event = await reader.read();
  assert.match(new TextDecoder().decode(event.value), /external/);
  abort.abort();
  const current = await get();
  assert.equal(current.deck.meta.title, '編輯器修改');
  assert.equal((await fetch(url + 'api/snapshot', {method: 'POST', body: JSON.stringify({baseRev: first.rev})})).status, 409);
  assert.equal((await fetch(url + 'api/deck', {method: 'PUT', body: '{'})).status, 400);
  assert.equal((await fetch(url + 'api/snapshot', {method: 'POST', headers: {Origin: 'https://example.com'}, body: '{}'})).status, 403);
});
