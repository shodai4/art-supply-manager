// アトリコ Service Worker（オフライン用キャッシュ）
const CACHE = 'art-supply-manager-v65';
const ASSETS = [
  './', './index.html', './privacy.html', './terms.html', './support.html',
  './styles.css', './app.js', './core.js', './motion.js', './icloud.js', './links.js', './images.js', './pro.js', './iap.js', './samples.js', './theme.js', './tutorial.js', './jan-database.js', './data/jan-part-1.js', './data/jan-part-2.js', './data/jan-part-3.js', './data/jan-part-4.js', './data/jan-part-5.js', './jan-extra.js',
  './jan-extra.json', './shops.js', './scanner.js', './scan-guard.js', './scan-open-gate.js', './scan-flow.js', './auto-image.js', './admob.js', './export-file.js',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './assets/tutorial/stock-1.webp', './assets/tutorial/stock-2.webp', './assets/tutorial/stock-3.webp',
  './assets/tutorial/restock-1.webp', './assets/tutorial/catalog-1.webp', './assets/tutorial/catalog-2.webp', './assets/tutorial/settings-1.webp',
  // 動きのライブラリ（同梱。CDNからは読まないので、オフラインでも同じ手触りになる）
  './vendor/gsap.min.js',
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
    // no-cache で毎回サーバーに確認する（GitHub Pages は max-age=600 なので、
    // 版を付けていない部品が古いまま使われてアプリが起動しないのを防ぐ）
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});
