/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** Detail GETs — NetworkFirst.
 *
 *  Anything with a numeric id after the resource name (`/api/lists/123`,
 *  `/api/lists/123/items`, `/api/notes/4/versions/2`, `/api/recipes/5/…`)
 *  plus the meal-plan endpoints (always week-scoped, never a bare
 *  collection). These responses are highly mutable and a SWR cache
 *  feeds React a stale snapshot on cold mount — the revalidation
 *  fires too late to update component state, so the user sees stale
 *  data until they trigger a focus/visibility refetch. NetworkFirst
 *  flips the trade-off: brief loading state on cold mount, but no
 *  stale renders. Falls back to cache when the network fails (offline).
 *
 *  REGISTRATION ORDER MATTERS — workbox routes match in registration
 *  order. The NetworkFirst route below MUST come before the
 *  collection-level SWR route or the broad `/api/lists` matcher will
 *  swallow `/api/lists/123` and serve stale.
 */
const DETAIL_PATH_RE = /^\/api\/(lists|notes|recipes)\/\d+/;
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    (DETAIL_PATH_RE.test(url.pathname) || url.pathname.startsWith('/api/meal-plans')),
  new NetworkFirst({
    cacheName: 'lyst-detail',
    networkTimeoutSeconds: 4,
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 })],
  }),
);

// Collection-level API: lists & items — stale while revalidate so the
// overview paints instantly offline. The overview's mount-fetch +
// focus refetch reconcile on the next idle moment.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.pathname.startsWith('/api/lists'),
  new StaleWhileRevalidate({
    cacheName: 'lyst-lists',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 })],
  }),
);

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    (url.pathname.startsWith('/api/notes') || url.pathname.startsWith('/api/tags')),
  new StaleWhileRevalidate({
    cacheName: 'lyst-notes',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 })],
  }),
);

// Other GET API: network first
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/'),
  new NetworkFirst({ cacheName: 'lyst-api', networkTimeoutSeconds: 4 }),
);

// Static assets
registerRoute(
  ({ request }) => ['style', 'script', 'worker'].includes(request.destination),
  new StaleWhileRevalidate({ cacheName: 'lyst-static' }),
);

registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'lyst-images',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 3600 })],
  }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
