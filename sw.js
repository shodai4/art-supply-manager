// 画材管理アプリ Service Worker（オフライン用キャッシュ）
const CACHE = 'art-supply-manager-v12';
const ASSETS = [
  './', './index.html', './privacy.html', './support.html',
  './styles.css', './app.js', './core.js', './images.js', './jan-database.js', './jan-extra.js',
  './jan-extra.json', './shops.js', './scanner.js',
  './manifest.webmanifest', './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ネットワーク優先・失敗時キャッシュ（更新を届けつつオフラインでも開ける）
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // CDN等はそのまま
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});
