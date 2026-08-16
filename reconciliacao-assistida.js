/* Conciliação assistida — sugestões, parcelamento e filtro em Cartões.
   Nada é conciliado automaticamente: o módulo apenas pré-seleciona e oferece
   confirmações explícitas, inclusive em lote para sugestões fortes. */
(function(){
  "use strict";
  if(window.__cfReconAssistLoaded) return;
  window.__cfReconAssistLoaded=true;

  const STATE_PROP="reconciliacoesCartao";
  let importRows=null;
  let importFileName="";
  let cartReconFilter="todos"; // todos | conciliados | nao-conciliados
  let assistBusy=false;

  const old={
    prepareFile:window.reconPrepareFile,
    confirmImport:window.reconConfirmImport,
    groupStart:window.reconGroupStart,
    open:window.reconOpen,
    openSession:window.reconOpenSession,
    contextChanged:window.reconContextChanged,
    setView:window.reconSetView,
    renderCart:typeof renderCartTable==="function"?renderCartTable:null,
    getCartFiltered:typeof getCartFiltered==="function"?getCartFiltered:null
  };

  function h(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");}
  function money(v){const n=Number(v)||0;try{return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}catch(e){return "R$ "+n.toFixed(2).replace(".",",");}}
  function toast(msg,color){try{if(typeof showToast==="function")showToast(msg,color||"#4361EE");else alert(msg);}catch(e){alert(msg);}}
  function persist(){try{if(typeof saveToLocal==="function")saveToLocal();return true;}catch(e){console.error(e);toast("Não foi possível salvar a conciliação.","#E63757");return false;}}
  function uid(){return "grp_ast_"+Date.now()+"_"+Math.random().toString(36).slice(2,8);}
  function appKey(t){return t?`${t._src}:${t._idx}`:"";}
  function appSnapshot(t){return{src:t._src,idx:t._idx,data:t.data||"",descricao:t.descricao||"",local:t.local||"",valor:Number(t.valor)||0,cartao:t.cartao||"",fiador:t.fiador||""};}
  function sameSnapshot(t,l){return !!t&&!!l&&String(t.data||"")===String(l.data||"")&&Math.abs((Number(t.valor)||0)-(Number(l.valor)||0))<0.005&&String(t.cartao||"")===String(l.cartao||"")&&String(t.descricao||"")===String(l.descricao||"");}
  function normalizeText(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();}
  function dayDiff(a,b){const da=new Date(a),db=new Date(b);if(isNaN(da)||isNaN(db))return 999;return Math.abs(Math.round((da-db)/86400000));}

  function parseMoney(v){
    if(typeof v==="number"&&Number.isFinite(v))return v;
    let s=String(v==null?"":v).trim();if(!s)return NaN;let neg=false;
    if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1);}if(/-$/.test(s)){neg=true;s=s.slice(0,-1);}
    s=s.replace(/R\$/gi,"").replace(/\s/g,"").replace(/[^0-9,.-]/g,"");
    const comma=s.lastIndexOf(","),dot=s.lastIndexOf(".");
    if(comma>=0&&dot>=0){if(comma>dot)s=s.replace(/\./g,"").replace(",",".");else s=s.replace(/,/g,"");}
    else if(comma>=0)s=s.replace(/\./g,"").replace(",",".");
    else if((s.match(/\./g)||[]).length>1){const p=s.split(".");const d=p.pop();s=p.join("")+"."+d;}
    const n=Number(s);return Number.isFinite(n)?(neg?-Math.abs(n):n):NaN;
  }
  function normalizeDate(v,yearHint){
    if(v instanceof Date&&!isNaN(v))return v.toISOString().slice(0,10);
    let s=String(v==null?"":v).trim();if(!s)return "";let m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if(m)return `${m[1]}-${String(+m[2]).padStart(2,"0")}-${String(+m[3]).padStart(2,"0")}`;
    m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);if(m){let y=+m[3];if(y<100)y+=2000;return `${y}-${String(+m[2]).padStart(2,"0")}-${String(+m[1]).padStart(2,"0")}`;}
    m=s.match(/^(\d{1,2})[\/.-](\d{1,2})$/);if(m)return `${yearHint||new Date().getFullYear()}-${String(+m[2]).padStart(2,"0")}-${String(+m[1]).padStart(2,"0")}`;
    return s;
  }

  // Reconhece 03/10, 3/10, "parcela 3/10", "3 de 10" e variantes.
  function normalizeInstallment(v){
    const s=String(v==null?"":v).trim();if(!s)return "";let m;
    m=s.match(/(?:parc(?:ela)?\s*)?(\d{1,2})\s*[\/-]\s*(\d{1,2})/i);
    if(!m)m=s.match(/(?:parc(?:ela)?\s*)?(\d{1,2})\s*(?:de)\s*(\d{1,2})/i);
    if(!m)return "";
    const a=+m[1],b=+m[2];if(!(a>0&&b>0&&a<=b&&b<=99))return "";
    return `${String(a).padStart(2,"0")}/${String(b).padStart(2,"0")}`;
  }
  function bankInstallment(r){return normalizeInstallment(r?.parcela)||normalizeInstallment(r?.descricao);}
  function appInstallment(t){return normalizeInstallment(t?.parcela)||normalizeInstallment(t?.descricao);}

  function stateSessions(){try{const st=typeof getState==="function"?getState():null;return st&&Array.isArray(st[STATE_PROP])?st[STATE_PROP]:[];}catch(e){return[];}}
  function selectedContext(){return{ano:Number(document.getElementById("recon-ano")?.value||2026),mes:document.getElementById("recon-mes")?.value||"",cartao:document.getElementById("recon-cartao")?.value||""};}
  function currentSession(){const c=selectedContext();return stateSessions().find(s=>Number(s.ano)===c.ano&&s.mes===c.mes&&s.cartao===c.cartao)||null;}

  function buildHistoricalRow(t,i){
    if(typeof ccDeletedTxns!=="undefined"&&ccDeletedTxns.has("cc_"+i))return null;
    const o=(typeof ccOverrides!=="undefined"&&ccOverrides["cc_"+i])||null;
    const rw=o?[o.mes||t[0],o.data||t[1],t[2],o.local||t[3],o.descricao||t[4],o.categoria||t[5],o.subcategoria||t[6],o.cartao||t[7],o.valor!==undefined?o.valor:t[8],o.fiador||t[9],t[10]]:t;
    const p=typeof parseCCItem==="function"?parseCCItem(rw):{mes:rw[0],data:rw[1],cod:rw[2],local:rw[3],descricao:rw[4],categoria:rw[5],subcategoria:rw[6],cartao:rw[7],valor:rw[8],fiador:rw[9]};
    return{...p,ano:2026,_src:"cc",_idx:i};
  }
  function appRowsFor(s){
    let rows=[];try{if(Number(s.ano)===2026)ALL_CC.forEach((t,i)=>{const p=buildHistoricalRow(t,i);if(p)rows.push(p);});}catch(e){}
    try{newCCTxns.forEach((t,i)=>{if(Number(t.ano||2026)===Number(s.ano))rows.push({...t,ano:Number(t.ano||2026),_src:"newcc",_idx:i});});}catch(e){}
    return rows.filter(t=>t.mes===s.mes&&t.cartao===s.cartao);
  }
  function resolveLink(link,rows){
    if(!link)return null;let t=rows.find(x=>x._src===link.src&&x._idx===link.idx);if(t&&sameSnapshot(t,link))return t;
    t=rows.find(x=>sameSnapshot(x,link));if(t)return t;return null;
  }
  function normalizeSession(s){if(!s)return;s.rows=Array.isArray(s.rows)?s.rows:[];s.groups=Array.isArray(s.groups)?s.groups:[];s.ignoredApp=Array.isArray(s.ignoredApp)?s.ignoredApp:[];}
  function linkedAndIgnored(s,rows){
    normalizeSession(s);const linked=new Set(),ignored=new Set();
    s.groups.forEach(g=>(g.appLinks||[]).forEach(l=>{const t=resolveLink(l,rows);if(t)linked.add(appKey(t));}));
    s.ignoredApp.forEach(l=>{const t=resolveLink(l,rows);if(t)ignored.add(appKey(t));});
    return{linked,ignored};
  }

  function wordSimilarity(a,b){
    const A=new Set(normalizeText(a).split(" ").filter(w=>w.length>2)),B=new Set(normalizeText(b).split(" ").filter(w=>w.length>2));
    if(!A.size||!B.size)return 0;let inter=0;A.forEach(w=>{if(B.has(w))inter++;});return inter/Math.max(A.size,B.size);
  }
  function candidateScore(bank,t){
    let score=0;const bv=Number(bank.valor)||0,tv=Number(t.valor)||0;
    if(Math.abs(bv-tv)<0.005)score+=100;
    const bp=bankInstallment(bank),ap=appInstallment(t);if(bp&&ap)score+=bp===ap?90:-80;else if(bp||ap)score-=5;
    const dd=dayDiff(bank.data,t.data);if(dd===0)score+=35;else if(dd<=2)score+=28;else if(dd<=5)score+=18;else if(dd<=10)score+=8;
    const sim=wordSimilarity(bank.descricao,(t.local||"")+" "+(t.descricao||""));score+=Math.round(sim*55);
    return score;
  }

  function exactCombination(bank,available){
    const target=Math.round(Math.abs(Number(bank.valor)||0)*100);if(!target)return null;
    const bp=bankInstallment(bank);
    let pool=available.filter(t=>{const c=Math.round(Math.abs(Number(t.valor)||0)*100);return c>0&&c<=target;});
    // Quando há parcela, primeiro tenta somente itens da mesma parcela.
    if(bp){const same=pool.filter(t=>appInstallment(t)===bp);if(same.length)pool=same;}
    pool=pool.sort((a,b)=>candidateScore(bank,b)-candidateScore(bank,a)).slice(0,24);
    let best=null,bestScore=-Infinity,nodes=0;
    function rec(start,sum,items){
      if(++nodes>30000)return;
      if(sum===target&&items.length){
        const avg=items.reduce((a,t)=>a+candidateScore(bank,t),0)/items.length;
        const sc=avg-(items.length-1)*5;
        if(sc>bestScore){bestScore=sc;best=items.slice();}
        return;
      }
      if(sum>target||items.length>=6)return;
      for(let i=start;i<pool.length;i++){
        const cents=Math.round(Math.abs(Number(pool[i].valor)||0)*100);if(sum+cents>target)continue;
        items.push(pool[i]);rec(i+1,sum+cents,items);items.pop();
      }
    }
    rec(0,0,[]);return best?{items:best,score:bestScore}:null;
  }

  function suggestionFor(bank,s,rows,blocked){
    const available=rows.filter(t=>!blocked.has(appKey(t)));
    const singles=available.filter(t=>Math.abs((Number(t.valor)||0)-(Number(bank.valor)||0))<0.005).sort((a,b)=>candidateScore(bank,b)-candidateScore(bank,a));
    if(singles.length){
      const top=singles[0],topScore=candidateScore(bank,top),second=singles[1]?candidateScore(bank,singles[1]):-999;
      const bp=bankInstallment(bank),ap=appInstallment(top);const parcelGood=!bp||!ap||bp===ap;
      const strong=parcelGood&&topScore>=120&&(topScore-second>=18||singles.length===1);
      return{items:[top],sum:Number(top.valor)||0,strong,ambiguous:!strong,score:topScore,kind:"1:1"};
    }
    const combo=exactCombination(bank,available);
    if(combo){
      const bp=bankInstallment(bank);const parcelGood=!bp||combo.items.every(t=>!appInstallment(t)||appInstallment(t)===bp);
      const strong=parcelGood&&combo.score>=28;
      return{items:combo.items,sum:combo.items.reduce((a,t)=>a+(Number(t.valor)||0),0),strong,ambiguous:!strong,score:combo.score,kind:`1:${combo.items.length}`};
    }
    return null;
  }

  function activeView(){const b=document.querySelector("#recon-body .recon-filter.active");const txt=(b?.textContent||"").toLowerCase();if(txt.includes("pendente"))return"pendentes";if(txt.includes("concili"))return"conciliados";if(txt.includes("ignorado"))return"ignorados";if(txt.includes("diverg"))return"divergencias";return"todos";}
  function refreshRecon(){try{if(typeof window.reconSetView==="function")window.reconSetView(activeView());}catch(e){}}

  function createGroupFromSuggestion(s,bank,sug){
    normalizeSession(s);const rows=appRowsFor(s),usage=linkedAndIgnored(s,rows);
    if((s.groups||[]).some(g=>(g.bankIds||[]).includes(bank.id)))return false;
    if(sug.items.some(t=>usage.linked.has(appKey(t))||usage.ignored.has(appKey(t))))return false;
    const links=sug.items.map(appSnapshot);const g={id:uid(),bankIds:[bank.id],appLinks:links,createdAt:new Date().toISOString(),assisted:true};
    s.groups.push(g);bank.status="conciliado";bank.links=links.slice();bank.link=links[0];bank.linkedAt=new Date().toISOString();delete bank.ignoredAt;return true;
  }

  function reconAssistConfirm(bankId){
    const s=currentSession();if(!s||s.closed)return;normalizeSession(s);const bank=s.rows.find(r=>r.id===bankId);if(!bank)return;
    const rows=appRowsFor(s),usage=linkedAndIgnored(s,rows),sug=suggestionFor(bank,s,rows,new Set([...usage.linked,...usage.ignored]));
    if(!sug){toast("Não encontrei uma combinação exata para confirmar.","#F89C2A");return;}
    const lines=sug.items.map(t=>`${t.local||t.descricao} · ${money(t.valor)}${appInstallment(t)?` · ${appInstallment(t)}`:""}`).join("\n");
    if(!confirm(`Confirmar esta sugestão?\n\nBanco: ${money(bank.valor)}${bankInstallment(bank)?` · parcela ${bankInstallment(bank)}`:""}\n\nApp:\n${lines}\n\nSoma: ${money(sug.sum)}`))return;
    if(createGroupFromSuggestion(s,bank,sug)&&persist()){refreshRecon();try{if(typeof renderCartTable==="function")renderCartTable();}catch(e){}toast("✓ Sugestão confirmada.","#2EB872");}
  }

  function reconAssistConfirmStrong(){
    const s=currentSession();if(!s||s.closed)return;normalizeSession(s);const rows=appRowsFor(s),usage=linkedAndIgnored(s,rows);
    const blocked=new Set([...usage.linked,...usage.ignored]);const picks=[];
    s.rows.filter(r=>r.status!=="ignorado"&&!(s.groups||[]).some(g=>(g.bankIds||[]).includes(r.id))).forEach(bank=>{
      const sug=suggestionFor(bank,s,rows,blocked);if(sug?.strong&&sug.items.every(t=>!blocked.has(appKey(t)))){picks.push({bank,sug});sug.items.forEach(t=>blocked.add(appKey(t)));}
    });
    if(!picks.length){toast("Não há sugestões fortes disponíveis para confirmação em lote.","#F89C2A");return;}
    const total=picks.reduce((a,x)=>a+(Number(x.bank.valor)||0),0);
    if(!confirm(`Confirmar ${picks.length} correspondência(s) forte(s), totalizando ${money(total)}?\n\nNada além dessas sugestões será alterado.`))return;
    let n=0;picks.forEach(x=>{if(createGroupFromSuggestion(s,x.bank,x.sug))n++;});
    if(n&&persist()){refreshRecon();try{if(typeof renderCartTable==="function")renderCartTable();}catch(e){}toast(`✓ ${n} correspondência(s) confirmada(s).`,"#2EB872");}
  }

  function reconAssistConfirmNext(){
    const s=currentSession();if(!s)return;const before=(s.groups||[]).length;
    if(typeof window.reconGroupConfirm==="function")window.reconGroupConfirm();
    setTimeout(()=>{
      const now=currentSession();if(!now||now.closed||(now.groups||[]).length<=before)return;normalizeSession(now);
      const next=now.rows.find(r=>r.status!=="ignorado"&&!(now.groups||[]).some(g=>(g.bankIds||[]).includes(r.id)));
      if(next&&typeof window.reconGroupStart==="function")window.reconGroupStart(next.id);
    },80);
  }

  // Pré-seleciona a melhor sugestão quando o usuário abre o agrupamento.
  function reconGroupStart(bankId){
    const s=currentSession();if(!s||s.closed||typeof old.groupStart!=="function")return old.groupStart?.(bankId);
    const rows=appRowsFor(s),usage=linkedAndIgnored(s,rows),bank=(s.rows||[]).find(r=>r.id===bankId);
    const sug=bank?suggestionFor(bank,s,rows,new Set([...usage.linked,...usage.ignored])):null;
    old.groupStart(bankId);
    if(!sug)return;
    setTimeout(()=>{
      sug.items.forEach(t=>{
        const key=appKey(t);try{if(typeof window.reconGroupToggleApp==="function")window.reconGroupToggleApp(key,true);}catch(e){}
        [...document.querySelectorAll('#recon-group-editor input[type="checkbox"]')].forEach(cb=>{const oc=cb.getAttribute("onchange")||"";if(oc.includes(`reconGroupToggleApp('${key}'`))cb.checked=true;});
      });
      const editor=document.getElementById("recon-group-editor");if(editor&&!editor.querySelector(".recon-assist-note"))editor.insertAdjacentHTML("afterbegin",`<div class="recon-assist-note" style="margin-bottom:10px;padding:9px 11px;border-radius:9px;background:${sug.strong?'rgba(46,184,114,.10)':'rgba(248,156,42,.10)'};color:${sug.strong?'#2EB872':'#B76A00'};font-size:11px;font-weight:650">${sug.strong?'✓ Sugestão forte pré-selecionada':'⚠ Sugestão encontrada — revise antes de confirmar'}${bankInstallment(bank)?` · parcela ${h(bankInstallment(bank))}`:""}</div>`);
      addConfirmNextButton();
    },40);
  }

  function addConfirmNextButton(){
    const ed=document.getElementById("recon-group-editor");if(!ed||ed.querySelector("#recon-confirm-next"))return;
    const btn=[...ed.querySelectorAll("button")].find(b=>(b.textContent||"").includes("Conciliar selecionados"));if(!btn)return;
    const b=document.createElement("button");b.id="recon-confirm-next";b.className="recon-btn primary";b.textContent="Confirmar e próximo";b.onclick=reconAssistConfirmNext;btn.parentElement?.insertBefore(b,btn);
  }

  // --- Importação com parcela ------------------------------------------------
  function detectDelimiter(line){const a=[[";",(line.match(/;/g)||[]).length],[",",(line.match(/,/g)||[]).length],["\t",(line.match(/\t/g)||[]).length]];a.sort((x,y)=>y[1]-x[1]);return a[0][1]?a[0][0]:";";}
  function parseDelimited(text){const d=detectDelimiter((text.split(/\r?\n/).find(x=>x.trim())||""));const out=[];let row=[],cell="",q=false;for(let i=0;i<text.length;i++){const ch=text[i];if(q){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')q=false;else cell+=ch;}else if(ch==='"')q=true;else if(ch===d){row.push(cell);cell="";}else if(ch==='\n'){row.push(cell.replace(/\r$/,""));out.push(row);row=[];cell="";}else cell+=ch;}row.push(cell.replace(/\r$/,""));if(row.some(x=>String(x).trim()))out.push(row);return out;}
  async function captureFile(file){
    const ext=(file.name.split(".").pop()||"").toLowerCase();if(ext==="csv"||ext==="txt")return parseDelimited(await file.text());
    if(!window.XLSX)return null;const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:"array",cellDates:true});const sh=wb.SheetNames[0];return XLSX.utils.sheet_to_json(wb.Sheets[sh],{header:1,raw:false,defval:"",dateNF:"yyyy-mm-dd"});
  }
  function guessParcelCol(headers){let i=headers.findIndex(x=>/(parcela|parcelamento|prestacao|presta[cç][aã]o)/i.test(String(x||"")));if(i>=0)return i;i=headers.findIndex(x=>/parc/i.test(String(x||"")));return i;}
  function addParcelMapping(){
    const map=document.getElementById("recon-import-map");if(!map||!importRows?.length||map.querySelector("#recon-map-parcela"))return;
    const headers=importRows[0].map((x,i)=>String(x||`Coluna ${i+1}`).trim()||`Coluna ${i+1}`),guess=guessParcelCol(headers);
    const grid=map.querySelector("div[style*='grid-template-columns:repeat(3']");if(grid){grid.style.gridTemplateColumns="repeat(4,1fr)";const box=document.createElement("div");box.innerHTML=`<label class="filter-label">Parcela</label><select id="recon-map-parcela" class="filter-select" style="width:100%"><option value="-1">Detectar pela descrição</option>${headers.map((x,i)=>`<option value="${i}" ${i===guess?"selected":""}>${h(x)}</option>`).join("")}</select>`;grid.appendChild(box);}
    const info=map.querySelector(".recon-sub");if(info)info.insertAdjacentHTML("beforeend",' <strong>Parcela</strong> também será importada e usada na conferência.');
  }
  async function reconPrepareFile(input){
    const file=input?.files?.[0];if(!file)return typeof old.prepareFile==="function"?old.prepareFile(input):undefined;
    importFileName=file.name;
    if(typeof old.prepareFile==="function")await old.prepareFile(input);
    try{importRows=(await captureFile(file))?.filter(r=>Array.isArray(r)&&r.some(x=>String(x||"").trim()!==""))||null;}catch(e){console.warn("Conciliação: não foi possível capturar parcelas",e);importRows=null;}
    addParcelMapping();
  }
  function reconConfirmImport(){
    const parcelSel=document.getElementById("recon-map-parcela"),parcelIdx=parcelSel?Number(parcelSel.value):-1;
    const di=Number(document.getElementById("recon-map-date")?.value||0),xi=Number(document.getElementById("recon-map-desc")?.value||1),vi=Number(document.getElementById("recon-map-value")?.value||2),ctx=selectedContext();
    const parcelValues=[];
    if(importRows?.length){importRows.slice(1).forEach(r=>{const val=parseMoney(r[vi]),desc=String(r[xi]??"").trim(),date=normalizeDate(r[di],ctx.ano);if(!Number.isFinite(val)||(!desc&&!date))return;parcelValues.push(normalizeInstallment(parcelIdx>=0?r[parcelIdx]:"")||normalizeInstallment(desc));});}
    if(typeof old.confirmImport==="function")old.confirmImport();
    setTimeout(()=>{
      const s=currentSession();if(!s)return;(s.rows||[]).forEach((r,i)=>{const p=parcelValues[i]||normalizeInstallment(r.descricao);if(p)r.parcela=p;});
      if(parcelValues.some(Boolean)){persist();refreshRecon();toast("✓ Parcelamentos importados e incluídos na conferência.","#2EB872");}
      importRows=null;importFileName="";
    },30);
  }

  // --- Decoração da tela de conciliação -------------------------------------
  function enhanceReconUi(){
    if(assistBusy)return;assistBusy=true;
    try{
      const body=document.getElementById("recon-body"),s=currentSession();if(!body||!s||s.closed){assistBusy=false;return;}normalizeSession(s);
      const rows=appRowsFor(s),usage=linkedAndIgnored(s,rows),blocked=new Set([...usage.linked,...usage.ignored]);
      // Botão em lote.
      const toolbar=[...body.querySelectorAll(".recon-filter")].map(x=>x.parentElement).find(Boolean);
      if(toolbar&&!body.querySelector("#recon-confirm-strong")){
        const b=document.createElement("button");b.id="recon-confirm-strong";b.className="recon-btn green";b.textContent="✓ Confirmar sugestões fortes";b.onclick=reconAssistConfirmStrong;
        const right=toolbar.querySelector("div[style*='margin-left:auto']");if(right)right.insertBefore(b,right.firstChild);else toolbar.appendChild(b);
      }
      // Sugestões por linha e badge de parcela.
      body.querySelectorAll("button[onclick*='reconGroupStart']").forEach(btn=>{
        const oc=btn.getAttribute("onclick")||"",m=oc.match(/reconGroupStart\('([^']+)'\)/);if(!m)return;const id=m[1],bank=s.rows.find(r=>r.id===id);if(!bank)return;
        const tr=btn.closest("tr"),descTd=tr?.children?.[2],action=btn.parentElement;if(descTd&&bankInstallment(bank)&&!descTd.querySelector(".recon-parcela-badge"))descTd.insertAdjacentHTML("beforeend",`<div class="recon-parcela-badge" style="margin-top:4px"><span class="recon-badge" style="background:rgba(67,97,238,.10);color:#4361EE">Parcela ${h(bankInstallment(bank))}</span></div>`);
        if(action?.querySelector(".recon-assist-suggestion"))return;
        const sug=suggestionFor(bank,s,rows,blocked);if(!sug)return;
        const detail=sug.items.slice(0,4).map(t=>`${h(t.local||t.descricao)} · ${money(t.valor)}${appInstallment(t)?` · ${h(appInstallment(t))}`:""}`).join("<br>");
        const box=document.createElement("div");box.className="recon-assist-suggestion";box.style.cssText=`margin-bottom:7px;padding:7px 8px;border-radius:8px;background:${sug.strong?'rgba(46,184,114,.09)':'rgba(248,156,42,.09)'};font-size:10.5px;line-height:1.45`;
        box.innerHTML=`<div style="font-weight:750;color:${sug.strong?'#2EB872':'#B76A00'}">${sug.strong?'✓ Sugestão forte':'⚠ Sugestão para revisar'} · ${sug.kind}</div>${detail}<div style="font-weight:700;margin-top:3px">Soma ${money(sug.sum)} · Dif. ${money((Number(bank.valor)||0)-sug.sum)}</div>${sug.strong?`<button class="recon-btn green" style="margin-top:5px" onclick="event.stopPropagation();reconAssistConfirm('${h(id)}')">Confirmar sugestão</button>`:""}`;
        action?.insertBefore(box,action.firstChild);btn.textContent=sug.strong?"Revisar / alterar":"Revisar sugestão";
      });
      // Parcelas também no editor do app.
      const ed=document.getElementById("recon-group-editor");if(ed){
        ed.querySelectorAll("input[onchange*='reconGroupToggleApp']").forEach(cb=>{const oc=cb.getAttribute("onchange")||"",m=oc.match(/reconGroupToggleApp\('([^']+)'/);if(!m)return;const t=rows.find(x=>appKey(x)===m[1]),p=appInstallment(t),lab=cb.closest("label");if(p&&lab&&!lab.querySelector(".recon-app-parc")){const sp=document.createElement("span");sp.className="recon-app-parc";sp.style.cssText="font-size:9px;font-weight:700;color:#4361EE";sp.textContent=p;lab.children[2]?.appendChild(sp);}});
        addConfirmNextButton();
      }
    }catch(e){console.warn("Conciliação assistida:",e);}finally{assistBusy=false;}
  }

  // --- Filtro Conciliados / Não conciliados na tela Cartões -----------------
  function allLinkedSnapshots(){
    const out=[];stateSessions().forEach(s=>{normalizeSession(s);(s.groups||[]).forEach(g=>(g.appLinks||[]).forEach(l=>out.push(l)));(s.rows||[]).forEach(r=>{if(r.status==="conciliado"&&r.link)out.push(r.link);});});return out;
  }
  function isLinkedCartRow(t){const links=allLinkedSnapshots();return links.some(l=>(l.src===t._src&&l.idx===t._idx)||sameSnapshot(t,l));}
  if(typeof old.getCartFiltered==="function"){
    const patched=function(){const rows=old.getCartFiltered.apply(this,arguments);if(cartReconFilter==="conciliados")return rows.filter(isLinkedCartRow);if(cartReconFilter==="nao-conciliados")return rows.filter(t=>!isLinkedCartRow(t));return rows;};
    patched.__reconAssistFilter=true;getCartFiltered=patched;
  }
  function installCartFilter(){
    if(document.getElementById("cart-recon-filter"))return;const row=document.querySelector("#panel-cartoes .search-row");if(!row)return;
    const sel=document.createElement("select");sel.id="cart-recon-filter";sel.className="filter-select";sel.style.cssText="max-width:180px;flex-shrink:0";sel.title="Filtrar pela situação da conciliação";
    sel.innerHTML='<option value="todos">Conciliação: Todos</option><option value="nao-conciliados">Não conciliados</option><option value="conciliados">Conciliados</option>';
    sel.onchange=function(){cartReconFilter=this.value;try{if(typeof renderCartTable==="function")renderCartTable();}catch(e){}};
    const sort=document.getElementById("cart-sort-select");if(sort?.nextSibling)row.insertBefore(sel,sort.nextSibling);else row.appendChild(sel);
  }

  // Reaplica melhorias após qualquer render da conciliação.
  const obs=new MutationObserver(()=>setTimeout(enhanceReconUi,0));
  function observe(){const body=document.getElementById("recon-body");if(body&&!body.__assistObserved){body.__assistObserved=true;obs.observe(body,{childList:true,subtree:true});}}
  function reconOpen(){const r=typeof old.open==="function"?old.open():undefined;setTimeout(()=>{observe();enhanceReconUi();},40);return r;}
  function reconOpenSession(id){const r=typeof old.openSession==="function"?old.openSession(id):undefined;setTimeout(()=>{observe();enhanceReconUi();},40);return r;}
  function reconContextChanged(){const r=typeof old.contextChanged==="function"?old.contextChanged():undefined;setTimeout(enhanceReconUi,40);return r;}
  function reconSetView(v){const r=typeof old.setView==="function"?old.setView(v):undefined;setTimeout(enhanceReconUi,20);return r;}

  // CSS pequeno para responsividade do mapeamento de 4 colunas.
  const st=document.createElement("style");st.id="recon-assist-style";st.textContent='@media(max-width:760px){#recon-import-map div[style*="grid-template-columns: repeat(4"],#recon-import-map div[style*="grid-template-columns:repeat(4"]{grid-template-columns:1fr 1fr!important}}';document.head.appendChild(st);

  Object.assign(window,{reconPrepareFile,reconConfirmImport,reconGroupStart,reconOpen,reconOpenSession,reconContextChanged,reconSetView,reconAssistConfirm,reconAssistConfirmStrong,reconAssistConfirmNext});
  installCartFilter();setTimeout(()=>{observe();enhanceReconUi();},0);
})();
