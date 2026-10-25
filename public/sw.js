const CACHE_NAME = "wricord-v25";
const APP_FILES = [
  "/",
  "/index.html",
  "/src/styles.css",
  "/src/main.js",
  "/src/camera-art.js",
  "/src/mondrian.js",
  "/src/rothko-plus.js",
  "/src/art-geometry.js",
  "/src/scene-geometry.js",
  "/src/face-tracker.js",
  "/src/face-worker.js",
  "/src/pages.js",
  "/src/markdown.js",
  "/src/compositor.js",
  "/src/recorder.js",
  "/src/saver.js",
  "/src/time.js",
  "/manifest.webmanifest",
  "/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) || caches.match("/index.html")),
  );
});
