// Service Worker — Controle Financeiro
// Estratégia: network-first para navegação (sempre busca a versão mais nova),
// cache como reserva apenas quando offline. Assim você nunca fica preso numa
// versão antiga do app — o problema clássico de cache de PWA.

const CACHE_VERSION = "cf-v5-fiador-filter";
const CACHE_NAME = `controle-financeiro-${CACHE_VERSION}`;

// Ajuste de usabilidade para tablets/telas touch:
// mantém a coluna das caixinhas visível durante a rolagem horizontal,
// aumenta a área de toque e deixa a barra de soma sempre acessível.
const TABLET_SELECTION_FIX = `
<style id="cf-tablet-selection-fix">
#panel-lancamentos table th:first-child,
#panel-lancamentos table td:first-child,
#cart-table th:first-child,
#cart-table td:first-child{
  width:44px!important;
  min-width:44px!important;
  text-align:center!important;
}
#panel-lancamentos table input[type="checkbox"],
#cart-table input[type="checkbox"]{
  appearance:auto;
  -webkit-appearance:checkbox;
  accent-color:var(--cyan);
  opacity:1;
}
@media(max-width:1180px),(pointer:coarse){
  #panel-lancamentos table th:first-child,
  #cart-table th:first-child{
    position:sticky!important;
    left:0!important;
    z-index:5!important;
    background:var(--card2)!important;
    box-shadow:1px 0 0 var(--border);
  }
  #panel-lancamentos table td:first-child,
  #cart-table td:first-child{
    position:sticky!important;
    left:0!important;
    z-index:4!important;
    background:var(--card)!important;
    box-shadow:1px 0 0 var(--border);
  }
  #panel-lancamentos table input[type="checkbox"],
  #cart-table input[type="checkbox"]{
    width:22px!important;
    height:22px!important;
    min-width:22px!important;
    min-height:22px!important;
    cursor:pointer;
    touch-action:manipulation;
  }
  #lanc-selection-bar,
  #cart-selection-bar{
    position:sticky!important;
    top:8px!important;
    z-index:30!important;
    box-shadow:var(--shadow-md);
  }
}
</style>`;

// Ordenação padrão dos cartões:
// em qualquer visão/filtro de Cartões, quando nenhuma ordenação manual estiver
// escolhida, mostra primeiro a compra com data mais recente.
const CARD_DATE_SORT_FIX = `
<script id="cf-card-date-sort-fix">
(function(){
  if(typeof getCartFiltered!=="function") return;
  if(getCartFiltered.__cfDefaultDateDesc) return;

  const originalGetCartFiltered=getCartFiltered;
  const patchedGetCartFiltered=function(){
    const rows=originalGetCartFiltered.apply(this,arguments);
    try{
      if(typeof curCartSort!=="undefined" && !curCartSort.field && Array.isArray(rows)){
        rows.sort((a,b)=>(b.data||"").localeCompare(a.data||""));
      }
    }catch(err){
      console.warn("Falha ao aplicar ordenação padrão por data:",err);
    }
    return rows;
  };
  patchedGetCartFiltered.__cfDefaultDateDesc=true;
  getCartFiltered=patchedGetCartFiltered;

  const defaultOption=document.querySelector('#cart-sort-select option[value=""]');
  if(defaultOption) defaultOption.textContent="Data (recente→antiga) — padrão";

  try{
    const panel=document.getElementById("panel-cartoes");
    if(panel && panel.classList.contains("active") && typeof renderCartTable==="function"){
      renderCartTable();
    }
  }catch(err){}
})();
</script>`;

// Corrige a regra do filtro por fiador em Cartões.
// "Despesas Casal" e "Despesas Casal PG" são terceiros diferentes e devem
// aparecer como opções separadas, cada uma filtrando apenas o próprio nome.
function applyCardFiadorFilterSourceFix(text){
  text = text.replace(
    'const terceiros=[...fiadorSet].filter(f=>!CICERO_FIADORES.has(f)&&!f.startsWith("Despesas Casal")).sort((a,b)=>a.localeCompare(b,"pt"));',
    'const terceiros=[...fiadorSet].filter(f=>!CICERO_FIADORES.has(f)).sort((a,b)=>a.localeCompare(b,"pt"));'
  );

  text = text.replace(
    '    `<option value="Despesas Casal">Despesas Casal</option>`+\n',
    ''
  );

  text = text.replace(
    '  else if(pessoa==="Despesas Casal") d=d.filter(t=>t.fiador&&t.fiador.startsWith("Despesas Casal")&&t.fiador!=="Despesas Casal PG");\n  else if(pessoa) d=d.filter(t=>t.fiador===pessoa);',
    '  else if(pessoa) d=d.filter(t=>t.fiador===pessoa);'
  );

  // Mantém a exportação de terceiros coerente com a mesma classificação.
  text = text.replace(
    'allCC.filter(t=>!CICERO_FIADORES.has(t.fiador)&&!t.fiador.startsWith("Despesas Casal"))',
    'allCC.filter(t=>!CICERO_FIADORES.has(t.fiador))'
  );

  return text;
}

// Arquivos essenciais para funcionar offline
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

function cloneHtmlResponseWithFix(response, html){
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function applyRuntimeFixes(response){
  if(!response) return response;
  const contentType = response.headers.get("content-type") || "";
  if(!contentType.includes("text/html")) return response;

  let text = await response.text();
  text = applyCardFiadorFilterSourceFix(text);

  if(!text.includes('id="cf-tablet-selection-fix"')){
    text = text.includes("</head>")
      ? text.replace("</head>", TABLET_SELECTION_FIX + "\n</head>")
      : TABLET_SELECTION_FIX + text;
  }

  if(!text.includes('id="cf-card-date-sort-fix"')){
    text = text.includes("</body>")
      ? text.replace("</body>", CARD_DATE_SORT_FIX + "\n</body>")
      : text + CARD_DATE_SORT_FIX;
  }

  return cloneHtmlResponseWithFix(response, text);
}

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
        .then(async res => {
          const fixed = await applyRuntimeFixes(res);
          const copy = fixed.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy).catch(() => {}));
          return fixed;
        })
        .catch(async () => {
          const cached = await caches.match(req) || await caches.match("./index.html");
          return applyRuntimeFixes(cached);
        })
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
