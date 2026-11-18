// Service worker: keeps a copy of the app's own files so it opens offline and
// can be installed to a phone's home screen. Books are never cached here; they
// stay in IndexedDB as before.
//
// Change VERSION whenever any of FILES change. Open pages then show a
// "new version" bar, and the new files are used once it's tapped.
const VERSION = '2026-11-18c';
const CACHE = 'epub-reader-' + VERSION;
// Holds a book shared from another Android app until the page picks it up.
// (Its name doesn't start with "epub-reader-", so updates don't delete it.)
const SHARE_CACHE = 'shared-file';
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
  // Sample book covers for the start screen (the books themselves are only
  // downloaded when opened).
  'samples/covers/arthur-conan-doyle_a-study-in-scarlet.jpg',
  'samples/covers/frances-hodgson-burnett_a-little-princess.jpg',
  'samples/covers/johanna-spyri_heidi_elisabeth-p-stork.jpg',
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

// Android's Share menu (see share_target in the manifest) posts the file
// here. It's kept on the device and the app opens with ?shared, which loads
// it. Nothing is sent anywhere.
async function receiveShare(req) {
  try {
    const files = (await req.formData()).getAll('book').filter(f => f instanceof File);
    const file = files.find(f => /\.epub$/i.test(f.name)) || files[0];
    if (file) {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put('book', new Response(file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'Shared book.epub') },
      }));
    }
  } catch (err) {
    console.warn('Could not receive shared file', err);
  }
  return Response.redirect(new URL('./?shared', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // The app page always gets the cached copy; files match whatever their ?v= tag.
  const isApp = req.mode === 'navigate' && /\/(index\.html)?$/.test(url.pathname);
  const lookup = isApp ? caches.match('./', { cacheName: CACHE })
    : caches.match(req, { cacheName: CACHE, ignoreSearch: true });
  e.respondWith(lookup.then(hit => hit || fetch(req)));
});
