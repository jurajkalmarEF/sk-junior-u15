const CACHE_NAME = 'ivanka-u15-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192-maskable.png',
  '/icon-512-maskable.png',
  '/data/teams.json'
];

// Tieto sa menia (dáta, appka samotná) — vždy skús sieť ako prvú, cache je
// len záloha pre prípad, že si offline. Inak appka ukazuje starý obsah aj
// keď je nový dostupný.
const NETWORK_FIRST = ['/data/teams.json', '/index.html', '/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isNetworkFirst(url) {
  const path = new URL(url).pathname;
  return NETWORK_FIRST.indexOf(path) !== -1;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (!url.startsWith(self.location.origin)) return;

  if (isNetworkFirst(url)) {
    // Network-first: skús sieť, ulož do cache pre offline použitie, pri
    // zlyhaní siete (offline) padni späť na to, čo máme v cache.
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Ostatné statické súbory (ikony, manifest) — cache-first, na pozadí sa
  // obnoví pre nabudúce.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
