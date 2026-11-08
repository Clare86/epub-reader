// Service worker: keeps a copy of the app's own files so it opens offline and
// can be installed to a phone's home screen. Books are never cached here; they
// stay in IndexedDB as before.
//
// Change VERSION whenever any of FILES change. Open pages then show a
// "new version" bar, and the new files are used once it's tapped.
const VERSION = '2026-11-08a';
const CACHE = 'epub-reader-' + VERSION;
const FILES = [
  './',
  'index.html',
  'style.css',
  'zip.js',
  'epub.js',
  'reader.js',
  'favicon.svg',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the HTTP cache, so a just-published file is never
  // stored alongside a stale copy of another.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('epub-reader-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => {
  if (e.data === 'update') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // The app page always gets the cached copy; files match whatever their ?v= tag.
  const isApp = req.mode === 'navigate' && /\/(index\.html)?$/.test(url.pathname);
  const lookup = isApp ? caches.match('./', { cacheName: CACHE })
    : caches.match(req, { cacheName: CACHE, ignoreSearch: true });
  e.respondWith(lookup.then(hit => hit || fetch(req)));
});
