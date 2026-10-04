/* Mogoba POS — offline cache. The whole app is cached on install, served cache-first,
 * and replaced atomically when a new version is deployed (bump VERSION). */
const VERSION = 'mogoba-pos-6ddb12562a';
const FILES = [
  "assets/fonts/bhs-ko.woff2",
  "assets/fonts/bhs-latin.woff2",
  "assets/fonts/ga1-400-latin.woff2",
  "assets/fonts/ga1-600-ko.woff2",
  "assets/fonts/ga1-600-latin.woff2",
  "assets/fonts/ga1-800-latin.woff2",
  "assets/food/bihon.jpg",
  "assets/food/classic.jpg",
  "assets/food/dosirak.jpg",
  "assets/food/fishcake.jpg",
  "assets/food/gimbap-dosirak.jpg",
  "assets/food/gimbap.jpg",
  "assets/food/honeybutter.jpg",
  "assets/food/kimchi.jpg",
  "assets/food/milktea.jpg",
  "assets/food/prinkle.jpg",
  "assets/food/ramyeon.jpg",
  "assets/food/spicy.jpg",
  "assets/food/suyuk.jpg",
  "assets/food/tteokbokki.jpg",
  "assets/food/yangnyeom.jpg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-512.png",
  "assets/logo.png",
  "css/app.css",
  "index.html",
  "js/app.js",
  "js/core.js",
  "js/db.js",
  "js/demo.js",
  "js/lock.js",
  "js/logic.js",
  "js/print.js",
  "js/seed.js",
  "js/sync.js",
  "js/ui.js",
  "js/util.js",
  "js/views/checkout.js",
  "js/views/drawer.js",
  "js/views/menu.js",
  "js/views/orders.js",
  "js/views/register.js",
  "js/views/reports.js",
  "js/views/settings.js",
  "js/views/stock.js",
  "manifest.webmanifest"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['./'].concat(FILES))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    )
  );
});
