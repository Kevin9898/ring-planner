// 서비스 워커: 항상 서버에 최신 파일인지 확인하고, 인터넷이 안 될 때만 저장해 둔 파일로 연다.
const CACHE = 'ringplan-shell-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ev) =>
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith(
    // no-cache: 브라우저가 예전에 받아 둔 파일을 그대로 쓰지 않고 매번 서버에 바뀌었는지 묻는다.
    // (홈 화면 앱이 며칠씩 옛 화면을 보여 주는 것을 막는다.)
    fetch(req.url, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
