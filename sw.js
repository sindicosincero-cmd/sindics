// SINDICS — service worker mínimo: permite instalar como aplicativo.
// Sempre busca a versão mais nova na rede (nada fica preso em cache); sem internet, mostra a última cópia da página.
const CACHE = "sindics-v1";
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.mode !== "navigate") return; // só a página; APIs e voz passam direto
  e.respondWith(
    fetch(req).then(res => { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {}); return res; })
      .catch(() => caches.match(req))
  );
});
