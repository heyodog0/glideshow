/* IndexedDB for a library kept in this browser (local/sw.js): one database, "glideshow", with
     kv       the library's own state, as a Durable Object keeps it (lib/library.js `ctx.storage`)
     blobs    file contents, by id
     commits  the library's versions (store-browser.js), and "head", the newest */

/** @type {Promise<IDBDatabase> | null} */
let opening = null;
const db = () => opening ??= new Promise((resolve, reject) => {
  const r = indexedDB.open('glideshow', 1);
  r.onupgradeneeded = () => { for (const s of ['kv', 'blobs', 'commits']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => { opening = null; reject(r.error); };
});
/** @template T @param {IDBRequest<T>} r @returns {Promise<T>} */
const done = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
/** @param {string} store @param {IDBTransactionMode} mode @param {(s: IDBObjectStore) => any} fn */
async function tx(store, mode, fn) {
  const t = (await db()).transaction(store, mode), out = fn(t.objectStore(store));
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
  return out;
}

/** @param {string} store @param {string} key */
export const get = (store, key) => tx(store, 'readonly', s => done(s.get(key))).then(p => p);
/** @param {string} store @param {string[]} keys */
export const getMany = (store, keys) => tx(store, 'readonly', s => Promise.all(keys.map(k => done(s.get(k))))).then(p => p);
/** @param {string} store @param {[string, any][]} entries */
export const put = (store, entries) => tx(store, 'readwrite', s => { for (const [k, v] of entries) s.put(v, k); });
/** @param {string} store */
export const keys = store => tx(store, 'readonly', s => done(s.getAllKeys())).then(p => /** @type {string[]} */ (p));
/** @param {string} store @param {string[]} keys */
export const del = (store, keys) => tx(store, 'readwrite', s => { for (const k of keys) s.delete(k); });

/* The part of a Durable Object's storage API that lib/library.js uses. */
export const storage = {
  /** @param {string | string[]} key */
  async get(key) {
    if (!Array.isArray(key)) return (await get('kv', key)) ?? undefined;
    const vals = await getMany('kv', key), out = new Map();
    key.forEach((k, i) => { if (vals[i] !== undefined) out.set(k, vals[i]); });
    return out;
  },
  /** @param {string | Record<string, any>} key @param {any} [value] */
  put(key, value) { return put('kv', typeof key === 'string' ? [[key, value]] : Object.entries(key)); },
  /** @param {string | string[]} key */
  delete(key) { return del('kv', Array.isArray(key) ? key : [key]); },
};
