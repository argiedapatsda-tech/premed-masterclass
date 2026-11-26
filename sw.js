/* PreMed Science Masterclass — offline service worker.
   The shell (index.html) holds every chapter, quiz and 2-D simulation. Photos live in img/ and the 3-D models in PreMed-3D/;
   both are cached as they are first opened, or all at once from the "save for offline" chip in the page.

   OPENING (2026-11-26): the app opens INSTANTLY from the saved copy of index.html — it no longer downloads the whole book
   before showing anything. The page then asks for the tiny version.json; when a newer book exists it offers "Update", this
   worker fetches the new index.html in the background and stores it, and the page reloads into it.

   The cache name is deliberately stable — bumping it would throw away the saved 3-D models and photos. */
const CACHE = 'premed-v3';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function freshShell() {                                  // download the newest book and keep it
  return fetch('index.html', { cache: 'reload' }).then(res => {
    if (!res || !res.ok) throw new Error('shell ' + (res && res.status));
    const copy = res.clone();
    return caches.open(CACHE).then(c => c.put('index.html', copy)).then(() => res);
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (/\/version\.json$/.test(url.pathname)) return;    // always from the network: it is how updates are found

  if (req.mode === 'navigate') {                         // opening the app: saved copy first (instant), network only if none
    e.respondWith(caches.match('index.html', { ignoreSearch: true }).then(hit => hit || freshShell().catch(() => fetch(req))));
    return;
  }

  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res && res.ok && (url.pathname.indexOf('/PreMed-3D/') >= 0 || url.pathname.indexOf('/img/') >= 0 || /\.(png|webp|jpe?g|json|js|html|webmanifest)$/.test(url.pathname))) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  })));
});

/* messages from the page: update the book, refresh changed files, bulk-save photos and 3-D models */
self.addEventListener('message', e => {
  const d = e.data || {};
  const reply = m => e.source && e.source.postMessage(m);
  if (d.type === 'update-shell') {
    freshShell().then(() => reply({ type: 'shell-updated' }), () => reply({ type: 'shell-failed' }));
    return;
  }
  if (d.type === 'refresh3d') {                          // used when a model or photo itself has changed
    caches.open(CACHE).then(async c => {
      for (const u of (d.urls || [])) { try { await c.delete(u); } catch (_) {} }
      reply({ type: 'refresh3d-done' });
    });
    return;
  }
  if (d.type !== 'cache3d' || !Array.isArray(d.urls)) return;
  caches.open(CACHE).then(async c => {
    let done = 0, failed = 0;
    for (const u of d.urls) {
      try {
        if (!(await c.match(u))) {
          const r = await fetch(u, { cache: 'reload' });
          if (r.ok) await c.put(u, r.clone()); else failed++;
        }
      } catch (_) { failed++; }
      reply({ type: 'cache3d-progress', done: ++done, total: d.urls.length, failed });
    }
    reply({ type: 'cache3d-done', total: d.urls.length, failed });
  });
});
