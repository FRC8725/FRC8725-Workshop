// Service worker for Team 8725 培訓室工具與材料管理系統
// Provides an installable, resilient app shell. Firestore/Auth calls to
// Google/Firebase domains are intentionally left untouched (network only) —
// this worker only manages this app's own static assets.

const VERSION = "v1";
const CACHE_NAME = `frc8725-workshop-${VERSION}`;

// Core app-shell files needed to boot the SPA offline.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/theme.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/home.css",
  "./css/storage.css",
  "./css/auth.css",
  "./css/users.css",
  "./css/ops.css",
  "./js/core/main.js",
  "./js/core/app.js",
  "./js/core/router.js",
  "./js/core/demo-mode.js",
  "./js/core/debug-mode.js",
  "./js/core/firebase-client.js",
  "./js/core/firebase-config.js",
  "./js/pages/home.js",
  "./js/pages/login.js",
  "./js/pages/logs.js",
  "./js/pages/ops.js",
  "./js/pages/storage.js",
  "./js/pages/users.js",
  "./js/services/actor.js",
  "./js/services/auth-service.js",
  "./js/services/data-service.js",
  "./js/services/demo-service.js",
  "./js/services/firebase-service.js",
  "./js/services/ops-service.js",
  "./js/services/user-service.js",
  "./js/ui/datamatrix.js",
  "./js/ui/item-form.js",
  "./js/ui/item-view.js",
  "./js/ui/labels.js",
  "./js/ui/map-calibrate.js",
  "./js/ui/map-renderer.js",
  "./js/ui/modal.js",
  "./js/ui/notifications.js",
  "./js/ui/sidebar.js",
  "./js/ui/storage-renderer.js",
  "./js/utils/item-logic.js",
  "./js/utils/search.js",
  "./js/utils/utils.js",
  "./pages/home.html",
  "./pages/login.html",
  "./pages/logs.html",
  "./pages/ops.html",
  "./pages/storage.html",
  "./pages/users.html",
  "./images/icon.ico",
  "./images/icons/pwa/icon-192x192.png",
  "./images/icons/pwa/icon-512x512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

// Never intercept Firebase/Google API calls (auth, Firestore, gstatic, etc.) —
// those must always hit the network so data and login stay live and correct.
function isAppAsset(url) {
  return (
    isSameOrigin(url) &&
    (APP_SHELL.some((path) => url.pathname.endsWith(path.replace("./", "/"))) ||
      /\.(?:js|css|html|png|svg|ico|json|webmanifest)$/.test(url.pathname))
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return; // let Firebase/Auth/Firestore/CDN requests pass straight through

  // Navigations (loading index.html itself): network-first so users always
  // get the latest app shell when online, falling back to cache offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  if (!isAppAsset(url)) return;

  // Static assets: stale-while-revalidate for fast loads that self-heal when online.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
