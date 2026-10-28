// SINDICS — service worker mínimo: permite instalar como aplicativo.
// Sempre busca a versão mais nova na rede (nada fica preso em cache); sem internet, mostra a última cópia da página.
const CACHE = "sindics-v7";
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.mode !== "navigate") return; // só a página; APIs e voz passam direto
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then(res => { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {}); return res; })
      .catch(() => caches.match(req))
  );
});
