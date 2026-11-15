// Guarda la aplicación para que abra rápido y sin señal; los datos (registro de Google Sheets) siempre van por la red.
const CACHE = "licencias-v1";
const ARCHIVOS = ["./", "index.html", "estilos.css", "licencia.js", "app.js", "manifest.webmanifest",
  "icono.svg", "icono-180.png", "icono-192.png", "icono-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Primero la red (así se ven las versiones nuevas); si no hay señal, la copia guardada.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request)
    .then((r) => {
      const copia = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia));
      return r;
    })
    .catch(() => caches.match(e.request)));
});
