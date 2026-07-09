// service-worker.js — 꽃안부 PWA
// 결제 사이트이므로 안전이 최우선:
//  - 페이지 이동(navigate): network-first (항상 최신). 오프라인일 때만 캐시/offline.html.
//    ↳ 결제 redirect(?payresult=success&paymentKey=...)는 절대 캐시하지 않음.
//  - /api/* : 가로채지 않음 → 항상 네트워크 (결제·주문저장·파싱).
//  - 외부(토스 SDK·구글폰트·Supabase): 가로채지 않음 → 브라우저 기본 동작.
//  - 같은 출처 정적자산(아이콘·사진·gallery-data.js): stale-while-revalidate.
//
// 코드를 바꾸면 VERSION 을 올려야 옛 캐시가 정리됩니다.

const VERSION = 'v1.11.3';
const CACHE = `kkotanbu-${VERSION}`;

// 오프라인 폴백용 최소 앱셸 (하나라도 404면 install 실패하므로 확실한 것만)
const PRECACHE = [
  '/',
  '/catalog.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] precache 실패(무시):', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('kkotanbu-') && k !== CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET 외(POST 결제 등)는 절대 손대지 않음
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 외부 출처(토스/폰트/Supabase)는 브라우저 기본 처리
  if (url.origin !== self.location.origin) return;

  // API는 항상 네트워크
  if (url.pathname.startsWith('/api/')) return;

  // 페이지 이동: network-first. 오프라인일 때만 캐시(쿼리 무시) → offline.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then((cached) => cached || caches.match('/offline.html'))
      )
    );
    return;
  }

  // 같은 출처 정적자산: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// 새 버전 즉시 적용용 (앱이 보내는 메시지)
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ── 웹푸시 수신 (기념일 D-7 알림 등) ──
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) {}
  const title = d.title || '꽃안부';
  const body = d.body || '';
  const url = d.url || '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
      tag: d.tag || undefined,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if (c.url.indexOf(url) !== -1 && 'focus' in c) return c.focus(); }
      return clients.openWindow(url);
    })
  );
});
