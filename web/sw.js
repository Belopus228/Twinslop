/* Кэш оболочки, чтобы контроллер открывался без сети. */
const CACHE = 'twinslop-hands-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './game.html',
  './game.css',
  './game.bundle.js',
  './apk.html',
  './apk.css',
  './apk.bundle.js',
  './apps.html',
  './apps.css',
  './apps.bundle.js',
  './ape.html',
  './ape.css',
  './ape.bundle.js',
  './settings.html',
  './settings.css',
  './settings.bundle.js',
  './docs/reverse-apk.html',
  './docs/prosto.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
