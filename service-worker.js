// Service Worker — Controle Financeiro
// HTML em network-first; cache apenas como contingência offline.

const CACHE_VERSION = "cf-v14-lancamentos-periodo-sticky";
const CACHE_NAME = `controle-financeiro-${CACHE_VERSION}`;

const TABLET_SELECTION_FIX = `
<style id="cf-tablet-selection-fix">
#panel-lancamentos table th:first-child,
#panel-lancamentos table td:first-child,
#cart-table th:first-child,
#cart-table td:first-child{width:44px!important;min-width:44px!important;text-align:center!important}
#panel-lancamentos table input[type="checkbox"],#cart-table input[type="checkbox"]{appearance:auto;-webkit-appearance:checkbox;accent-color:var(--cyan);opacity:1}
@media(max-width:1180px),(pointer:coarse){
  #panel-lancamentos table th:first-child,#cart-table th:first-child{position:sticky!important;left:0!important;z-index:5!important;background:var(--card2)!important;box-shadow:1px 0 0 var(--border)}
  #panel-lancamentos table td:first-child,#cart-table td:first-child{position:sticky!important;left:0!important;z-index:4!important;background:var(--card)!important;box-shadow:1px 0 0 var(--border)}
  #panel-lancamentos table input[type="checkbox"],#cart-table input[type="checkbox"]{width:22px!important;height:22px!important;min-width:22px!important;min-height:22px!important;cursor:pointer;touch-action:manipulation}
  #lanc-selection-bar,#cart-selection-bar{position:sticky!important;top:8px!important;z-index:30!important;box-shadow:var(--shadow-md)}
}
</style>`;

const CARD_DATE_SORT_FIX = `
<script id="cf-card-date-sort-fix">
(function(){
  if(typeof getCartFiltered!=="function"||getCartFiltered.__cfDefaultDateDesc)return;
  const originalGetCartFiltered=getCartFiltered;
  const patched=function(){
    const rows=originalGetCartFiltered.apply(this,arguments);
    try{if(typeof curCartSort!=="undefined"&&!curCartSort.field&&Array.isArray(rows))rows.sort((a,b)=>(b.data||"").localeCompare(a.data||""));}catch(err){}
    return rows;
  };
  patched.__cfDefaultDateDesc=true;getCartFiltered=patched;
  const opt=document.querySelector('#cart-sort-select option[value=""]');if(opt)opt.textContent="Data (recente→antiga) — padrão";
  try{const panel=document.getElementById("panel-cartoes");if(panel&&panel.classList.contains("active")&&typeof renderCartTable==="function")renderCartTable();}catch(err){}
})();
</script>`;

const RECONCILIACAO_LOADER = `<script id="cf-reconciliacao-loader" src="./reconciliacao.js"></script>`;
const RECONCILIACAO_MULTI_LOADER = `<script id="cf-reconciliacao-multi-loader" src="./reconciliacao-multiplos.js"></script>`;
const RECONCILIACAO_ASSIST_LOADER = `<script id="cf-reconciliacao-assist-loader" src="./reconciliacao-assistida.js"></script>`;
const CARTOES_FIADORES_FIX_LOADER = `<script id="cf-cartoes-fiadores-fix-loader" src="./cartoes-fiadores-fix.js"></script>`;
const CARTOES_MES_PADRAO_LOADER = `<script id="cf-cartoes-mes-padrao-loader" src="./cartoes-mes-padrao.js"></script>`;
const LANCAMENTOS_PERIODO_LOADER = `<script id="cf-lancamentos-periodo-loader" src="./lancamentos-periodo-sticky.js"></script>`;

// Em Cartões cada fiador é independente. Agrupamentos históricos continuam só
// na lógica de Lançamentos.
function applyCardFiadorFilterSourceFix(text){
  text=text.replace(
    '    const isCasal=f=>f==="Despesas Casal"||f==="Despesas Casal Inc"||f==="Casal";\n    const fiadoresPresentes=new Set(scope.map(t=>t.fiador).filter(Boolean));\n    const items=[{label:"Todas as pessoas",key:"Todos"}];\n    // Montar lista de opções (Cícero, Despesas Casal agrupado, terceiros)\n    const opts=[];\n    if([...fiadoresPresentes].some(f=>f==="Cícero")) opts.push({label:"Cícero",key:"Cícero"});\n    if([...fiadoresPresentes].some(isCasal)) opts.push({label:"Despesas Casal",key:"Casal"});\n    [...fiadoresPresentes].filter(f=>f!=="Cícero"&&!isCasal(f)).forEach(f=>opts.push({label:f,key:f}));',
    '    const fiadoresPresentes=new Set(scope.map(t=>t.fiador).filter(Boolean));\n    fiadoresPresentes.add("Despesas Casal");\n    fiadoresPresentes.add("Despesas Casal PG");\n    const items=[{label:"Todas as pessoas",key:"Todos"}];\n    // Em Cartões, cada fiador aparece separadamente pelo nome exato.\n    const opts=[];\n    [...fiadoresPresentes].forEach(f=>opts.push({label:f,key:f}));'
  );
  text=text.replace(
    '  if(curPerson!=="Todos"){\n    if(curPerson==="Cícero") d=d.filter(t=>t.fiador==="Cícero");\n    else if(curPerson==="Casal") d=d.filter(t=>t.fiador==="Despesas Casal"||t.fiador==="Despesas Casal Inc"||t.fiador==="Casal");\n    else d=d.filter(t=>t.fiador===curPerson);\n  }',
    '  if(curPerson!=="Todos") d=d.filter(t=>t.fiador===curPerson);'
  );
  text=text.replace(
    'const terceiros=[...fiadorSet].filter(f=>!CICERO_FIADORES.has(f)&&!f.startsWith("Despesas Casal")).sort((a,b)=>a.localeCompare(b,"pt"));',
    'fiadorSet.add("Despesas Casal"); fiadorSet.add("Despesas Casal PG"); const terceiros=[...fiadorSet].filter(f=>f!=="Cícero").sort((a,b)=>a.localeCompare(b,"pt"));'
  );
  text=text.replace('    `<option value="Despesas Casal">Despesas Casal</option>`+\n','');
  text=text.replace(
    '  if(curPerson==="Cícero"||curPerson==="Casal"||terceiros.includes(curPerson))\n    sp.value=curPerson==="Casal"?"Despesas Casal":curPerson;',
    '  if(curPerson==="Cícero"||terceiros.includes(curPerson))\n    sp.value=curPerson;'
  );
  text=text.replace(
    '  if(pessoa==="Cícero") d=d.filter(t=>t.is_cicero);\n  else if(pessoa==="Despesas Casal") d=d.filter(t=>t.fiador&&t.fiador.startsWith("Despesas Casal")&&t.fiador!=="Despesas Casal PG");\n  else if(pessoa) d=d.filter(t=>t.fiador===pessoa);',
    '  if(pessoa) d=d.filter(t=>t.fiador===pessoa);'
  );
  text=text.replace('allCC.filter(t=>!CICERO_FIADORES.has(t.fiador)&&!t.fiador.startsWith("Despesas Casal"))','allCC.filter(t=>t.fiador!=="Cícero")');
  return text;
}

const CORE_ASSETS=["./","./index.html","./reconciliacao.js","./reconciliacao-multiplos.js","./reconciliacao-assistida.js","./cartoes-fiadores-fix.js","./cartoes-mes-padrao.js","./lancamentos-periodo-sticky.js","./manifest.json","./icon-192.png","./icon-512.png","./apple-touch-icon.png"];

function cloneHtmlResponseWithFix(response,html){
  const headers=new Headers(response.headers);headers.delete("content-length");headers.delete("content-encoding");
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

async function applyRuntimeFixes(response){
  if(!response)return response;const contentType=response.headers.get("content-type")||"";if(!contentType.includes("text/html"))return response;
  let text=applyCardFiadorFilterSourceFix(await response.text());
  if(!text.includes('id="cf-tablet-selection-fix"'))text=text.includes("</head>")?text.replace("</head>",TABLET_SELECTION_FIX+"\n</head>"):TABLET_SELECTION_FIX+text;
  if(!text.includes('id="cf-card-date-sort-fix"'))text=text.includes("</body>")?text.replace("</body>",CARD_DATE_SORT_FIX+"\n</body>"):text+CARD_DATE_SORT_FIX;
  if(!text.includes('id="cf-reconciliacao-loader"'))text=text.includes("</body>")?text.replace("</body>",RECONCILIACAO_LOADER+"\n</body>"):text+RECONCILIACAO_LOADER;
  if(!text.includes('id="cf-reconciliacao-multi-loader"'))text=text.includes("</body>")?text.replace("</body>",RECONCILIACAO_MULTI_LOADER+"\n</body>"):text+RECONCILIACAO_MULTI_LOADER;
  if(!text.includes('id="cf-reconciliacao-assist-loader"'))text=text.includes("</body>")?text.replace("</body>",RECONCILIACAO_ASSIST_LOADER+"\n</body>"):text+RECONCILIACAO_ASSIST_LOADER;
  if(!text.includes('id="cf-cartoes-fiadores-fix-loader"'))text=text.includes("</body>")?text.replace("</body>",CARTOES_FIADORES_FIX_LOADER+"\n</body>"):text+CARTOES_FIADORES_FIX_LOADER;
  if(!text.includes('id="cf-cartoes-mes-padrao-loader"'))text=text.includes("</body>")?text.replace("</body>",CARTOES_MES_PADRAO_LOADER+"\n</body>"):text+CARTOES_MES_PADRAO_LOADER;
  if(!text.includes('id="cf-lancamentos-periodo-loader"'))text=text.includes("</body>")?text.replace("</body>",LANCAMENTOS_PERIODO_LOADER+"\n</body>"):text+LANCAMENTOS_PERIODO_LOADER;
  return cloneHtmlResponseWithFix(response,text);
}

self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(CORE_ASSETS).catch(()=>{})).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("controle-financeiro-")&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
  const req=event.request;if(req.method!=="GET")return;const url=new URL(req.url);if(url.origin!==self.location.origin)return;
  const isHTML=req.mode==="navigate"||req.headers.get("accept")?.includes("text/html")||url.pathname.endsWith(".html")||url.pathname.endsWith("/");
  if(isHTML){event.respondWith(fetch(req).then(async res=>{const fixed=await applyRuntimeFixes(res),copy=fixed.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,copy).catch(()=>{}));return fixed;}).catch(async()=>{const cached=await caches.match(req)||await caches.match("./index.html");return applyRuntimeFixes(cached);}));return;}
  event.respondWith(caches.match(req).then(cached=>{const network=fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,copy).catch(()=>{}));return res;}).catch(()=>cached);return cached||network;}));
});
