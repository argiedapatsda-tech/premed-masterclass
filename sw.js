/* PreMed Science Masterclass — offline service worker.
   The shell (index.html) holds every chapter, photo, quiz and 2-D simulation, so once it is cached the
   whole textbook works with no connection. The 3-D models live in PreMed-3D/ and are cached either as
   they are first opened, or all at once from the "save for offline" chip in the page.

   UPDATES: opening the app while online always fetches the current index.html AND stores it, so the next
   offline session has the newest book. The cache name is deliberately stable — bumping it would throw away
   the 122 MB of saved 3-D models and force a fresh download. */
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

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {                       // opening the app
    e.respondWith(fetch(req).then(res => {             // online: take the newest book…
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('index.html', copy)).catch(() => {});   // …and keep it for offline
      }
      return res;
    }).catch(() => caches.match('index.html', { ignoreSearch: true })));            // offline: the saved one
    return;
  }

  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res && res.ok && (url.pathname.indexOf('/PreMed-3D/') >= 0 || /\.(png|webp|json|js|html|webmanifest)$/.test(url.pathname))) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  })));
});

/* bulk download of the 3-D models, driven by the page */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'refresh3d') {                        // used when a model itself has changed
    caches.open(CACHE).then(async c => {
      for (const u of (d.urls || [])) { try { await c.delete(u); } catch (_) {} }
      e.source && e.source.postMessage({ type: 'refresh3d-done' });
    });
    return;
  }
  if (d.type !== 'cache3d' || !Array.isArray(d.urls)) return;
  const reply = m => e.source && e.source.postMessage(m);
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
