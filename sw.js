const cacheName = 'work-journal-shell-4';
const appFiles = [
  './', './index.html', './styles.css', './app.mjs', './model.mjs', './storage.mjs',
  './reports.mjs', './report-ui.mjs',
  './manifest.webmanifest', './cover.png', './icon-192.png', './icon-512.png',
].map(path => new URL(path, self.registration.scope).href);
const appFileSet = new Set(appFiles);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(appFiles))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('work-journal-shell-') && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = '';
  if (!appFileSet.has(url.href) || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(async () =>
    (await caches.open(cacheName)).match(url.href)));
});
