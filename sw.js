/* Vehicle Scan offline support.
   The offline copy lives in this app's OWN IndexedDB database ("lcc-vehicle-scan"), not in the
   browser's shared Cache Storage list. Other LCC apps on the same site (littlecountrycars.github.io)
   can clear Cache Storage when they update; they never touch this database.
   Network first so updates arrive; saved copy as fallback when there's no signal. */
const VERSION = 'v4'; // bump when any file changes
const STORE = 'files';
const SHELL = ['./', 'index.html', 'obd.js', 'app.js', 'modes/checkin.js', 'modes/auction.js', 'modes/trade.js', 'manifest.webmanifest', 'icon.svg', 'icon-app.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const BASE = new URL('./', self.location).pathname; // e.g. /lcc-vehicle-scan/
const DB = /-test\/$/.test(BASE) ? 'lcc-vehicle-scan-test' : 'lcc-vehicle-scan'; // the test copy keeps its own offline copy

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve) => {
    const q = db.transaction(STORE).objectStore(STORE).get(key);
    q.onsuccess = () => resolve(q.result || null); q.onerror = () => resolve(null);
  });
}
async function dbPut(key, val) {
  const db = await openDb();
  return new Promise((resolve) => {
    const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(val, key);
    t.oncomplete = () => resolve(); t.onerror = () => resolve();
  });
}
// One key per file, ignoring ?query; the app's front page is stored as index.html
function keyFor(url) {
  const p = new URL(url, self.location).pathname;
  return p === BASE || p === BASE.slice(0, -1) ? BASE + 'index.html' : p;
}
async function save(url, res) {
  if (!res || !res.ok || res.type === 'opaque') return;
  const body = await res.clone().arrayBuffer();
  await dbPut(keyFor(url), { body, type: res.headers.get('Content-Type') || '', at: Date.now(), version: VERSION });
}
async function load(url) {
  const hit = await dbGet(keyFor(url)) || await dbGet(BASE + 'index.html');
  return hit ? new Response(hit.body, { status: 200, headers: { 'Content-Type': hit.type } }) : Response.error();
}

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all(SHELL.map((f) => fetch(f, { cache: 'no-store' }).then((r) => save(new URL(f, self.location).href, r)).catch(() => {})))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(BASE)) return; // NHTSA, fonts, other apps: untouched
  e.respondWith(fetch(e.request).then((res) => { e.waitUntil(save(e.request.url, res)); return res; }).catch(() => load(e.request.url)));
});
