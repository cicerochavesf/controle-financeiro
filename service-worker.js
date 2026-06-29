// Service Worker — Controle Financeiro
// Estratégia: network-first para navegação (sempre busca a versão mais nova),
// cache como reserva apenas quando offline. Assim você nunca fica preso numa
// versão antiga do app — o problema clássico de cache de PWA.

const CACHE_VERSION = "cf-v1";
const CACHE_NAME = `controle-financeiro-${CACHE_VERSION}`;

// Arquivos essenciais para funcionar offline
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

// Instala e faz cache dos assets essenciais
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting()) // ativa imediatamente a nova versão
  );
});

// Limpa caches antigos ao ativar
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith("controle-financeiro-") && k !== CACHE_NAME)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;

  // Só lida com GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // NUNCA intercepta chamadas externas (Firebase, Google APIs, CDNs).
  // Deixa o navegador lidar diretamente — sync e auth precisam da rede.
  if (url.origin !== self.location.origin) return;

  // Para o HTML/navegação: NETWORK-FIRST.
  // Tenta buscar a versão mais nova; se offline, cai para o cache.
  const isHTML = req.mode === "navigate" ||
                 req.headers.get("accept")?.includes("text/html") ||
                 url.pathname.endsWith(".html") ||
                 url.pathname.endsWith("/");

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then(res => {
          // Atualiza o cache com a versão fresca
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy).catch(() => {}));
          return res;
        })
        .catch(() =>
          // Offline: serve do cache (ou o index como fallback)
          caches.match(req).then(c => c || caches.match("./index.html"))
        )
    );
    return;
  }

  // Para os demais assets locais (ícones, manifest): CACHE-FIRST com atualização.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy).catch(() => {}));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
