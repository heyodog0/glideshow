/* After signing in: the decks made in this browser without an account (local/sw.js), offered for moving into the
   account's library. The browser's library is read here with the same code that keeps it (library.js over
   store-browser.js); each deck goes over with its pictures (onefile.js bringIn) and leaves the browser once all of it is in. */

import { LibraryCore, baseOf, dirOf } from './library.js';
import { BrowserStore } from './store-browser.js';
import { storage } from './browser-db.js';
import { bringIn } from './onefile.js';

const LATER = 'glideshow-move-later';

async function browserLibrary() {
  if (indexedDB.databases && !(await indexedDB.databases()).some(d => d.name === 'glideshow')) return null;   // never used without an account
  const lib = new LibraryCore({ storage, blockConcurrencyWhile: fn => fn() }, {}, { store: l => new BrowserStore(l), share: {} });
  await lib.loaded;
  if (lib.cfg.kind !== 'browser') return null;
  await lib.refresh(true);
  return lib;
}
const call = (lib, path, body) => lib.fetch(new Request('https://browser' + path, { method: 'POST', body: JSON.stringify(body) })).then(r => r.json());

/** @param {HTMLElement} where  the home screen's place for it */
export async function offer(where) {
  let later = 0; try { later = +(localStorage.getItem(LATER) || 0); } catch {}
  if (Date.now() - later < 7 * 86400_000) return;   // "Not now" holds for a week
  const lib = await browserLibrary(); if (!lib) return;
  const v = lib.view(), decks = lib.walk(v).decks; if (!decks.length) return;
  const bar = document.createElement('div'); bar.className = 'hm-move';
  const say = document.createElement('span'), move = document.createElement('button'), not = document.createElement('button');
  say.textContent = `${decks.length} ${decks.length === 1 ? 'deck' : 'decks'} you made in this browser without an account can move into your library.`;
  move.textContent = 'Move them here'; move.className = 'hm-move-go primary'; not.textContent = 'Not now'; not.className = 'hm-move-not';
  not.onclick = () => { try { localStorage.setItem(LATER, String(Date.now())); } catch {} bar.remove(); };
  move.onclick = async () => {
    move.disabled = not.disabled = true; let moved = 0; const failed = [];
    for (const d of decks) {
      say.textContent = `Moving ${moved + 1} of ${decks.length}…`;
      const /** @type {Record<string, Uint8Array>} */ files = {}; let html = '';
      for (const p of Object.keys(v)) if (p.startsWith(d + '/')) {
        const rel = p.slice(d.length + 1), bytes = await lib.read(v[p]);
        if (rel === 'deck.html') html = new TextDecoder().decode(bytes); else if (rel !== 'AGENTS.md') files[rel] = bytes;
      }
      const j = await bringIn({ name: baseOf(d), folder: dirOf(d), html, files });
      if (j.error) { failed.push(`${baseOf(d)} (${j.error})`); continue; }
      await call(lib, '/api/deckop', { path: d, op: 'delete' });   // in the library now: out of the browser
      moved++;
    }
    if (!failed.length) return location.reload();
    say.textContent = `Moved ${moved}. Still in this browser: ${failed.join(', ')}.`; move.disabled = not.disabled = false;
  };
  bar.append(say, move, not); where.prepend(bar);
}
