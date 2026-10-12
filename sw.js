// Keeps the app working with no signal. Bump VERSION when files change.
const VERSION = 'strut-v8';
const FILES = ['./', './index.html', './style.css', './config.js', './logic.js', './app.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // data calls go straight to the network
  // Network first so updates arrive; fall back to the cached copy with no signal.
  // Poor signal: give the network 3 seconds, then use the cached copy.
  const net = fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 3000));
  e.respondWith(Promise.race([net, timeout]).catch(async () =>
    (await caches.match(e.request, { ignoreSearch: true })) || net));
});
