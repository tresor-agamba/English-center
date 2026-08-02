'use strict';

const CACHE_VERSION = 'new-vision-academy-v6';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PUBLIC_CACHE = `${CACHE_VERSION}-public`;
const ALLOWED_CACHES = new Set([STATIC_CACHE, PUBLIC_CACHE]);
const ESSENTIAL_ASSETS = [
  '/offline',
  '/offline.html',
  '/css/style.css?v=nva-hero-20260802-2',
  '/js/main.js?v=nva-ui-20260730-3',
  '/js/pwa.js?v=nva-ui-20260730-3',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
  '/images/logo/logo-icon.png',
  '/favicon.ico',
];
const PRIVATE_PREFIXES = [
  '/admin', '/teacher', '/student', '/api', '/health', '/notifications',
  '/settings/public/logo', '/webhooks', '/payments', '/payment', '/enrollment',
];
const PRIVATE_FILE_PATTERN = /\.(?:pdf|mp3|m4a|wav|ogg|mp4|webm|mov|avi|docx?|xlsx?|zip)(?:$|\?)/i;
const STATIC_PATTERN = /\.(?:css|js|png|jpe?g|gif|webp|svg|ico|woff2?|ttf)(?:$|\?)/i;

function isPrivate(url) {
  return PRIVATE_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
    || PRIVATE_FILE_PATTERN.test(url.pathname)
    || url.pathname.startsWith('/uploads/');
}

function isPublicPage(url) {
  return url.pathname === '/' || url.pathname === '/login' || url.pathname === '/formations'
    || url.pathname.startsWith('/formations/') || url.pathname.startsWith('/certificates/verify');
}

async function cacheIfSafe(cacheName, request, response) {
  if (response && response.ok && response.type === 'basic' && !response.headers.has('set-cookie')) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(ESSENTIAL_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((names) => Promise.all(names.filter((name) => !ALLOWED_CACHES.has(name)).map((name) => caches.delete(name)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivate(url)) return;

  if (request.mode === 'navigate') {
    if (!isPublicPage(url)) return;
    event.respondWith(
      fetch(request)
        .then((response) => cacheIfSafe(PUBLIC_CACHE, request, response))
        .catch(async () => (await caches.match(request)) || caches.match('/offline')),
    );
    return;
  }

  if (STATIC_PATTERN.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => cacheIfSafe(STATIC_CACHE, request, response))),
    );
  }
});
