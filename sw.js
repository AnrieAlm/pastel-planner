// sw.js - Calyx Planner's service worker. It runs in the background of the browser and does three jobs:
//   1. Keeps the app's fixed files (styles, scripts, images, fonts) so pages open faster.
//   2. Shows a friendly "Waking things up..." page when the free server is asleep or slow.
//   3. Shows the same page, worded for it, when you are offline.
// It NEVER keeps pages or data from your account (notes, habits, lists). Those always come
// fresh from the server, so nothing private is left behind on a shared phone.

// main.py replaces __VERSION__ with a new number on every deploy, so old files are thrown away.
const VERSION = '__VERSION__';
const SHELL_CACHE = 'calyx-shell-' + VERSION;      // the "waking" page and the icon
const STATIC_CACHE = 'calyx-static-' + VERSION;    // /static/... files (their addresses carry ?v=VERSION)
const FONT_CACHE = 'calyx-fonts-v1';               // Google Fonts (they never change)
const WAKING_URL = '/waking';
const SLOW_AFTER_MS = 4000;                        // a page slower than this gets the waking page
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Remembers when we last showed the waking page, so a slow page cannot make it flash again and again
let lastWakingAt = 0;

// Install: keep the waking page ready, and take over straight away
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll([WAKING_URL, '/icons/icon-192.png']))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete files kept by older versions, then start controlling open pages
self.addEventListener('activate', (event) => {
  const keep = [SHELL_CACHE, STATIC_CACHE, FONT_CACHE];
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name.startsWith('calyx-') && !keep.includes(name))
             .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// Every request the app makes passes through here
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;           // forms and saves always go straight to the server

  const url = new URL(request.url);

  if (request.mode === 'navigate') {              // opening a page
    event.respondWith(handlePage(request));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.startsWith('/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }
  // Everything else (/api/..., /health, your data) is left alone and goes to the network
});


// ---------- Push notifications (Stage 8) ----------
// FCM delivers a data-only message here when the app is closed or in the background. There is
// no "notification" field on purpose (we build the notification ourselves), so nothing appears
// unless we explicitly call showNotification — this also means a silent push (still useful for
// waking the app up later) is possible, though Calyx Planner does not use that yet.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    return;
  }
  const data = payload.data || payload;
  const title = data.title || 'Calyx Planner';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-32.png',
    tag: data.tag || undefined,      // a repeat push with the same tag replaces the old one
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an already-open tab if there is one, otherwise opens a new one
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// The waking page, from the shelf we filled at install time
async function wakingPage() {
  const cached = await caches.match(WAKING_URL);
  if (cached) return cached;
  return new Response('<h1>Waking things up…</h1><p>Please try again in a moment.</p>',
                      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Opening a page: ask the server. If it is slow (asleep) or unreachable, show the waking page,
// which keeps checking and reloads the page by itself once the server answers.
async function handlePage(request) {
  const path = new URL(request.url).pathname;
  const isDownload = /\/(ics|gcal)$/.test(path);
  const justWoke = Date.now() - lastWakingAt < 60000;

  // Downloads, and a page right after the waking page: just wait for the server, no timer
  if (isDownload || justWoke) {
    try {
      return await fetch(request);
    } catch (error) {
      return wakingPage();
    }
  }

  const network = fetch(request);
  network.catch(() => {});                        // if we stop waiting, do not complain later
  let timer;
  const slow = new Promise((resolve) => { timer = setTimeout(() => resolve('slow'), SLOW_AFTER_MS); });

  try {
    const result = await Promise.race([network, slow]);
    clearTimeout(timer);
    if (result === 'slow') {
      lastWakingAt = Date.now();
      return await wakingPage();
    }
    return result;
  } catch (error) {
    clearTimeout(timer);
    return wakingPage();                          // no connection at all
  }
}

// Fixed files: use the kept copy if there is one, otherwise get it and keep it
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.status === 200) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

// Fonts: show the kept copy straight away, and refresh it quietly in the background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response && (response.status === 200 || response.type === 'opaque')) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || refresh;
}
