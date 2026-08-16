/* Conciliação de fatura — módulo adicional do Controle Financeiro
   Regra principal: nenhuma alteração ou conciliação acontece automaticamente.
   O módulo apenas importa, compara e apresenta opções; toda vinculação, exclusão
   lógica, criação de lançamento e fechamento depende de ação explícita do usuário. */
(function(){
  "use strict";

  if(window.__cfReconLoaded) return;
  window.__cfReconLoaded=true;

  const MONTHS=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const STATE_PROP="reconciliacoesCartao";
  let conciliacoesCartao=[];
  let reconView="todos";
  let reconImportRaw=null;
  let reconImportName="";
  let reconImportSheet="";

  function h(v){
    return String(v==null?"":v)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function money(v){
    const n=Number(v)||0;
    try{return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
    catch(e){return "R$ "+n.toFixed(2).replace(".",",");}
  }
  function uid(prefix){ return (prefix||"r")+"_"+Date.now()+"_"+Math.random().toString(36).slice(2,9); }
  function toast(msg,color){
    try{ if(typeof showToast==="function") showToast(msg,color||"#4361EE"); else alert(msg); }
    catch(e){ alert(msg); }
  }
  function canEdit(){
    try{return typeof _requireSync!=="function" || _requireSync();}
    catch(e){return true;}
  }
  function todayIso(){ return new Date().toISOString().slice(0,10); }
  function monthNumber(name){ return MONTHS.indexOf(name)+1; }
  function monthShort(name){ return name?name.slice(0,3):""; }

  function loadStateFallback(){
    try{
      const key=typeof LS_KEY!=="undefined"?LS_KEY:"op2026_estado";
      const raw=localStorage.getItem(key);
      if(!raw) return;
      const d=JSON.parse(raw);
      if(Array.isArray(d[STATE_PROP])) conciliacoesCartao=d[STATE_PROP];
    }catch(e){ console.warn("Conciliação: falha ao ler estado local",e); }
  }

  function wrapState(){
    try{
      if(typeof getState==="function" && !getState.__reconWrapped){
        const originalGetState=getState;
        const wrapped=function(){
          const state=originalGetState.apply(this,arguments)||{};
          state[STATE_PROP]=conciliacoesCartao;
          return state;
        };
        wrapped.__reconWrapped=true;
        getState=wrapped;
      }
      if(typeof applyState==="function" && !applyState.__reconWrapped){
        const originalApplyState=applyState;
        const wrapped=function(d){
          if(d && Array.isArray(d[STATE_PROP])) conciliacoesCartao=d[STATE_PROP];
          const out=originalApplyState.apply(this,arguments);
          setTimeout(()=>{ try{ reconRender(); reconDecorateCartTable(); }catch(e){} },0);
          return out;
        };
        wrapped.__reconWrapped=true;
        applyState=wrapped;
      }
    }catch(e){ console.warn("Conciliação: falha ao integrar estado",e); }
  }

  function persist(){
    if(!canEdit()) return false;
    try{ if(typeof saveToLocal==="function") saveToLocal(); return true; }
    catch(e){ console.error(e); toast("Não foi possível salvar a conciliação.","#E63757"); return false; }
  }

  function reconCards(){
    const set=new Set();
    try{ (configCards||[]).forEach(c=>{if(c&&c!=="-")set.add(c);}); }catch(e){}
    try{ ALL_CC.forEach(t=>{if(t[7]&&t[7]!=="-")set.add(t[7]);}); }catch(e){}
    try{ newCCTxns.forEach(t=>{if(t.cartao&&t.cartao!=="-")set.add(t.cartao);}); }catch(e){}
    return [...set].sort((a,b)=>a.localeCompare(b,"pt"));
  }

  function reconYears(){
    const set=new Set([2026]);
    try{ (anos||[]).forEach(a=>set.add(Number(a))); }catch(e){}
    conciliacoesCartao.forEach(s=>set.add(Number(s.ano)));
    return [...set].filter(Boolean).sort((a,b)=>a-b);
  }

  function buildHistoricalRow(t,i){
    if(typeof ccDeletedTxns!=="undefined" && ccDeletedTxns.has("cc_"+i)) return null;
    const o=(typeof ccOverrides!=="undefined" && ccOverrides["cc_"+i])||null;
    const rw=o?[o.mes||t[0],o.data||t[1],t[2],o.local||t[3],o.descricao||t[4],o.categoria||t[5],o.subcategoria||t[6],o.cartao||t[7],o.valor!==undefined?o.valor:t[8],o.fiador||t[9],t[10]]:t;
    const p=typeof parseCCItem==="function"?parseCCItem(rw):{mes:rw[0],data:rw[1],cod:rw[2],local:rw[3],descricao:rw[4],categoria:rw[5],subcategoria:rw[6],cartao:rw[7],valor:rw[8],fiador:rw[9]};
    return {...p,ano:2026,_src:"cc",_idx:i};
  }

  function reconAppRows(ano,mes,cartao){
    let rows=[];
    try{
      if(Number(ano)===2026) ALL_CC.forEach((t,i)=>{const p=buildHistoricalRow(t,i);if(p)rows.push(p);});
    }catch(e){console.warn(e);}
    try{
      newCCTxns.forEach((t,i)=>{
        if(Number(t.ano||2026)!==Number(ano)) return;
        rows.push({...t,ano:Number(t.ano||2026),_src:"newcc",_idx:i});
      });
    }catch(e){console.warn(e);}
    return rows.filter(t=>(!mes||t.mes===mes)&&(!cartao||t.cartao===cartao));
  }

  function appKey(t){ return t?`${t._src}:${t._idx}`:""; }
  function appSnapshot(t){
    return {src:t._src,idx:t._idx,data:t.data||"",descricao:t.descricao||"",local:t.local||"",valor:Number(t.valor)||0,cartao:t.cartao||"",fiador:t.fiador||""};
  }
  function sameSnapshot(t,l){
    if(!t||!l) return false;
    return String(t.data||"")===String(l.data||"") && Math.abs((Number(t.valor)||0)-(Number(l.valor)||0))<0.005 && String(t.cartao||"")===String(l.cartao||"") && String(t.descricao||"")===String(l.descricao||"");
  }
  function resolveLink(link,appRows){
    if(!link) return null;
    let t=appRows.find(x=>x._src===link.src && x._idx===link.idx);
    if(t && sameSnapshot(t,link)) return t;
    t=appRows.find(x=>sameSnapshot(x,link));
    if(t) return t;
    const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9áàâãéêíóôõúç ]/gi," ").replace(/\s+/g," ").trim();
    const nd=norm(link.descricao||link.local);
    return appRows.find(x=>Math.abs((Number(x.valor)||0)-(Number(link.valor)||0))<0.005 && String(x.data||"")===String(link.data||"") && String(x.cartao||"")===String(link.cartao||"") && (!nd||norm(x.descricao||x.local).includes(nd)||nd.includes(norm(x.descricao||x.local))))||null;
  }

  function sessionKey(ano,mes,cartao){ return `${Number(ano)}|${mes||""}|${cartao||""}`; }
  function selectedContext(){
    const y=document.getElementById("recon-ano");
    const m=document.getElementById("recon-mes");
    const c=document.getElementById("recon-cartao");
    return {ano:Number(y?.value||2026),mes:m?.value||MONTHS[0],cartao:c?.value||""};
  }
  function findSession(ctx){
    const k=sessionKey(ctx.ano,ctx.mes,ctx.cartao);
    return conciliacoesCartao.find(s=>sessionKey(s.ano,s.mes,s.cartao)===k)||null;
  }
  function ensureSession(ctx){
    let s=findSession(ctx);
    if(!s){
      s={id:uid("conc"),ano:ctx.ano,mes:ctx.mes,cartao:ctx.cartao,fileName:"",sheetName:"",importedAt:null,rows:[],ignoredApp:[],closed:false,closedAt:null,closedSnapshot:null,createdAt:new Date().toISOString()};
      conciliacoesCartao.push(s);
    }
    if(!Array.isArray(s.rows)) s.rows=[];
    if(!Array.isArray(s.ignoredApp)) s.ignoredApp=[];
    return s;
  }

  function currentSession(){ return findSession(selectedContext()); }

  function normalizeText(s){
    return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
  }
  function parseMoney(v){
    if(typeof v==="number" && Number.isFinite(v)) return v;
    let s=String(v==null?"":v).trim();
    if(!s) return NaN;
    let neg=false;
    if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1);}
    if(/-$/.test(s)){neg=true;s=s.slice(0,-1);}
    s=s.replace(/R\$/gi,"").replace(/\s/g,"").replace(/[^0-9,.-]/g,"");
    const comma=s.lastIndexOf(","), dot=s.lastIndexOf(".");
    if(comma>=0 && dot>=0){
      if(comma>dot) s=s.replace(/\./g,"").replace(",",".");
      else s=s.replace(/,/g,"");
    }else if(comma>=0){
      s=s.replace(/\./g,"").replace(",",".");
    }else if((s.match(/\./g)||[]).length>1){
      const parts=s.split("."); const dec=parts.pop(); s=parts.join("")+"."+dec;
    }
    const n=Number(s);
    return Number.isFinite(n)?(neg?-Math.abs(n):n):NaN;
  }
  function normalizeDate(v,yearHint){
    if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
    let s=String(v==null?"":v).trim();
    if(!s) return "";
    let m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if(m) return `${m[1]}-${String(+m[2]).padStart(2,"0")}-${String(+m[3]).padStart(2,"0")}`;
    m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if(m){ let y=+m[3]; if(y<100)y+=2000; return `${y}-${String(+m[2]).padStart(2,"0")}-${String(+m[1]).padStart(2,"0")}`; }
    m=s.match(/^(\d{1,2})[\/.-](\d{1,2})$/);
    if(m) return `${yearHint||new Date().getFullYear()}-${String(+m[2]).padStart(2,"0")}-${String(+m[1]).padStart(2,"0")}`;
    return s;
  }
  function displayDate(v){
    const s=String(v||"");
    const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m?`${m[3]}/${m[2]}/${m[1]}`:s||"—";
  }
  function dayDiff(a,b){
    const da=new Date(a),db=new Date(b);
    if(isNaN(da)||isNaN(db)) return 999;
    return Math.abs(Math.round((da-db)/86400000));
  }

  function candidateSort(bank,appRows){
    const btxt=normalizeText(bank.descricao);
    return appRows.slice().sort((a,b)=>{
      function score(x){
        let sc=0;
        if(Math.abs((Number(x.valor)||0)-(Number(bank.valor)||0))<0.005) sc+=100;
        const dd=dayDiff(x.data,bank.data); if(dd===0)sc+=30; else if(dd<=3)sc+=20; else if(dd<=7)sc+=10;
        const xt=normalizeText((x.local||"")+" "+(x.descricao||""));
        if(btxt&&xt){ if(xt.includes(btxt)||btxt.includes(xt))sc+=30; else btxt.split(" ").forEach(w=>{if(w.length>3&&xt.includes(w))sc+=3;}); }
        return sc;
      }
      return score(b)-score(a);
    });
  }

  function sessionComputed(s){
    const appRows=reconAppRows(s.ano,s.mes,s.cartao);
    const linkedMap=new Map();
    (s.rows||[]).forEach(r=>{
      if(r.status==="conciliado"&&r.link){const t=resolveLink(r.link,appRows);if(t)linkedMap.set(appKey(t),r);}
    });
    const ignoredMap=new Map();
    (s.ignoredApp||[]).forEach(l=>{const t=resolveLink(l,appRows);if(t)ignoredMap.set(appKey(t),l);});
    const bankConsidered=(s.rows||[]).filter(r=>r.status!=="ignorado").reduce((a,r)=>a+(Number(r.valor)||0),0);
    const bankRaw=(s.rows||[]).reduce((a,r)=>a+(Number(r.valor)||0),0);
    const appConsidered=appRows.filter(t=>!ignoredMap.has(appKey(t))).reduce((a,t)=>a+(Number(t.valor)||0),0);
    const linkedTotal=(s.rows||[]).filter(r=>r.status==="conciliado").reduce((a,r)=>a+(Number(r.valor)||0),0);
    const pending=(s.rows||[]).filter(r=>r.status==="pendente").length;
    const linked=(s.rows||[]).filter(r=>r.status==="conciliado").length;
    const ignored=(s.rows||[]).filter(r=>r.status==="ignorado").length;
    const appOnly=appRows.filter(t=>!linkedMap.has(appKey(t))&&!ignoredMap.has(appKey(t)));
    const appIgnored=appRows.filter(t=>ignoredMap.has(appKey(t))&&!linkedMap.has(appKey(t)));
    return {appRows,linkedMap,ignoredMap,bankConsidered,bankRaw,appConsidered,linkedTotal,pending,linked,ignored,appOnly,appIgnored,diff:bankConsidered-appConsidered};
  }

  function statusBadge(st){
    if(st==="conciliado") return '<span class="recon-badge ok">✓ Conciliado</span>';
    if(st==="ignorado") return '<span class="recon-badge ign">Ignorado</span>';
    return '<span class="recon-badge pend">Pendente</span>';
  }

  function injectCss(){
    if(document.getElementById("recon-style")) return;
    const st=document.createElement("style");
    st.id="recon-style";
    st.textContent=`
#recon-modal{z-index:420}
#recon-modal .modal{max-width:1180px;width:min(1180px,96vw);height:min(92vh,900px);display:flex;flex-direction:column;padding:0;overflow:hidden}
.recon-head{padding:18px 20px 12px;border-bottom:1px solid var(--border);background:var(--card)}
.recon-body{padding:18px 20px;overflow:auto;flex:1;background:var(--bg)}
.recon-grid{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:10px;margin:12px 0}
.recon-kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:13px 14px;min-width:0}
.recon-kpi .l{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin-bottom:5px}
.recon-kpi .v{font-size:18px;font-weight:750;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.recon-table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.recon-table{width:100%;min-width:920px;border-collapse:collapse;font-size:12px}
.recon-table th{position:sticky;top:0;z-index:2;background:var(--card2);padding:9px 10px}
.recon-table td{padding:10px;border-bottom:1px solid var(--border);vertical-align:top}
.recon-badge{display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;font-size:10px;font-weight:700;white-space:nowrap}
.recon-badge.ok{background:rgba(46,184,114,.12);color:#2EB872}.recon-badge.pend{background:rgba(248,156,42,.13);color:#B76A00}.recon-badge.ign{background:rgba(114,122,146,.12);color:var(--muted)}
.recon-btn{border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:8px;padding:7px 10px;font-size:11px;font-weight:650;cursor:pointer;white-space:nowrap}
.recon-btn.primary{background:var(--cyan);border-color:var(--cyan);color:#fff}.recon-btn.green{background:#2EB872;border-color:#2EB872;color:#fff}.recon-btn.red{color:#E63757;border-color:rgba(230,55,87,.35)}
.recon-filter{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;padding:6px 11px;font-size:11px;font-weight:650;cursor:pointer}.recon-filter.active{background:var(--cyan);border-color:var(--cyan);color:#fff}
.recon-section{margin-top:18px}.recon-title{font-size:13px;font-weight:750;color:var(--text);margin-bottom:9px}.recon-sub{font-size:11px;color:var(--muted);line-height:1.45}
.recon-map{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-top:12px}
.recon-preview{max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;margin-top:10px}
.recon-preview table{min-width:700px;font-size:11px}
.recon-cart-mark{display:inline-flex;margin-top:3px;padding:2px 5px;border-radius:5px;background:rgba(46,184,114,.12);color:#2EB872;font-size:9px;font-weight:700}
@media(max-width:760px){#recon-modal .modal{width:100vw;height:100dvh;max-height:none;border-radius:0}.recon-head{padding:14px}.recon-body{padding:12px}.recon-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.recon-grid .recon-kpi:last-child{grid-column:1/-1}.recon-controls{display:grid!important;grid-template-columns:1fr 1fr}.recon-controls>div{min-width:0!important}.recon-controls .wide{grid-column:1/-1}.recon-actions{display:grid!important;grid-template-columns:1fr 1fr}.recon-actions .wide{grid-column:1/-1}.recon-btn{white-space:normal}}
`;
    document.head.appendChild(st);
  }

  function modalHtml(){
    return `<div class="modal-overlay" id="recon-modal">
      <div class="modal">
        <div class="recon-head">
          <div class="modal-header" style="margin-bottom:8px">
            <div>
              <div class="modal-title">Conciliação da fatura</div>
              <div class="recon-sub" style="margin-top:4px">Compare a fatura emitida pelo banco com Cartões. Nenhuma vinculação ou alteração é feita sem sua confirmação.</div>
            </div>
            <button class="modal-close" onclick="reconClose()">&#215;</button>
          </div>
          <div class="recon-controls" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
            <div style="min-width:100px"><label class="filter-label">Ano</label><select id="recon-ano" class="filter-select" onchange="reconContextChanged()"></select></div>
            <div style="min-width:135px"><label class="filter-label">Mês</label><select id="recon-mes" class="filter-select" onchange="reconContextChanged()"></select></div>
            <div class="wide" style="min-width:190px;flex:1"><label class="filter-label">Cartão</label><select id="recon-cartao" class="filter-select" style="width:100%" onchange="reconContextChanged()"></select></div>
            <div class="recon-actions" style="display:flex;gap:7px;flex-wrap:wrap">
              <label class="recon-btn primary" style="display:inline-flex;align-items:center;justify-content:center;cursor:pointer">Importar fatura<input id="recon-file" type="file" accept=".csv,.txt,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onchange="reconPrepareFile(this)" style="display:none"></label>
              <button class="recon-btn" onclick="reconResetCurrent()">Limpar</button>
            </div>
          </div>
          <div id="recon-import-map"></div>
        </div>
        <div class="recon-body" id="recon-body"></div>
      </div>
    </div>`;
  }

  function installUi(){
    injectCss();
    if(!document.getElementById("recon-modal")) document.body.insertAdjacentHTML("beforeend",modalHtml());
    if(!document.getElementById("btn-reconciliacao-cartoes")){
      const panel=document.getElementById("panel-cartoes");
      const row=panel?.querySelector(".search-row");
      if(row){
        const extr=[...row.querySelectorAll("button")].find(b=>(b.textContent||"").includes("Extrato"));
        const btn=document.createElement("button");
        btn.id="btn-reconciliacao-cartoes";
        btn.className="btn-add";
        btn.style.cssText="background:var(--card);color:var(--purple);border:1px solid var(--purple)";
        btn.title="Conferir a fatura do banco com os lançamentos de Cartões";
        btn.innerHTML="&#8644; Conciliação";
        btn.onclick=reconOpen;
        if(extr?.nextSibling) row.insertBefore(btn,extr.nextSibling); else row.appendChild(btn);
      }
    }
  }

  function fillSelectors(){
    const ys=document.getElementById("recon-ano"),ms=document.getElementById("recon-mes"),cs=document.getElementById("recon-cartao");
    if(!ys||!ms||!cs) return;
    const oldY=ys.value,oldM=ms.value,oldC=cs.value;
    ys.innerHTML=reconYears().map(y=>`<option value="${y}">${y}</option>`).join("");
    ms.innerHTML=MONTHS.map(m=>`<option value="${h(m)}">${h(m)}</option>`).join("");
    const cards=reconCards();
    cs.innerHTML=cards.map(c=>`<option value="${h(c)}">${h(c)}</option>`).join("");
    if([...ys.options].some(o=>o.value===oldY)) ys.value=oldY;
    if([...ms.options].some(o=>o.value===oldM)) ms.value=oldM;
    if([...cs.options].some(o=>o.value===oldC)) cs.value=oldC;
  }

  function reconOpen(){
    installUi(); fillSelectors();
    const ys=document.getElementById("recon-ano"),ms=document.getElementById("recon-mes"),cs=document.getElementById("recon-cartao");
    try{ if(typeof curCartAno!=="undefined" && [...ys.options].some(o=>+o.value===+curCartAno)) ys.value=String(curCartAno); }catch(e){}
    try{ if(typeof curCartMes!=="undefined" && curCartMes!=="Todos" && MONTHS.includes(curCartMes)) ms.value=curCartMes; else ms.value=MONTHS[new Date().getMonth()]; }catch(e){ms.value=MONTHS[new Date().getMonth()];}
    try{
      if(typeof curCards!=="undefined" && curCards.size===1){const c=[...curCards][0];if([...cs.options].some(o=>o.value===c))cs.value=c;}
      else if(typeof curCard!=="undefined"&&curCard!=="Todos"&&[...cs.options].some(o=>o.value===curCard))cs.value=curCard;
    }catch(e){}
    document.getElementById("recon-import-map").innerHTML="";
    reconView="todos";
    document.getElementById("recon-modal").classList.add("open");
    reconRender();
  }
  function reconClose(){ document.getElementById("recon-modal")?.classList.remove("open"); reconDecorateCartTable(); }
  function reconContextChanged(){ document.getElementById("recon-import-map").innerHTML=""; reconView="todos"; reconRender(); }

  function renderEmpty(ctx){
    const app=reconAppRows(ctx.ano,ctx.mes,ctx.cartao);
    return `<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px;text-align:center">
      <div style="font-size:30px;margin-bottom:10px">⇄</div>
      <div style="font-size:16px;font-weight:750;color:var(--text);margin-bottom:6px">Nenhuma fatura importada</div>
      <div class="recon-sub" style="max-width:560px;margin:0 auto 16px">Há ${app.length} lançamento(s) no app para ${h(monthShort(ctx.mes))}/${ctx.ano} · ${h(ctx.cartao||"cartão")}. Importe a fatura do banco para iniciar a conferência.</div>
      <label class="recon-btn primary" style="display:inline-flex;cursor:pointer">Importar fatura<input type="file" accept=".csv,.txt,.xls,.xlsx" onchange="reconPrepareFile(this)" style="display:none"></label>
    </div>${renderHistory()}`;
  }

  function filterBankRows(rows){
    if(reconView==="pendentes") return rows.filter(r=>r.status==="pendente");
    if(reconView==="conciliados") return rows.filter(r=>r.status==="conciliado");
    if(reconView==="ignorados") return rows.filter(r=>r.status==="ignorado");
    if(reconView==="divergencias") return rows.filter(r=>r.status==="pendente");
    return rows;
  }

  function renderBankRows(s,c){
    const used=new Set([...c.linkedMap.keys(),...c.ignoredMap.keys()]);
    const available=c.appRows.filter(t=>!used.has(appKey(t)));
    const rows=filterBankRows(s.rows||[]);
    if(!rows.length) return `<div style="padding:22px;text-align:center;color:var(--muted)">Nenhum item neste filtro.</div>`;
    return rows.map(r=>{
      const linked=r.status==="conciliado"?resolveLink(r.link,c.appRows):null;
      let action="";
      if(s.closed){
        action=linked?`<div style="font-size:11px"><strong>${h(linked.local||linked.descricao)}</strong><br>${h(displayDate(linked.data))} · ${money(linked.valor)}</div>`:`<span class="recon-sub">—</span>`;
      }else if(r.status==="conciliado"){
        action=`<div style="font-size:11px;margin-bottom:6px"><strong>${h(linked?.local||linked?.descricao||r.link?.descricao||"Lançamento vinculado")}</strong><br>${h(displayDate(linked?.data||r.link?.data))} · ${money(linked?.valor??r.link?.valor)}</div><button class="recon-btn" onclick="reconUnlinkBank('${h(r.id)}')">Desvincular</button>`;
      }else if(r.status==="ignorado"){
        action=`<button class="recon-btn" onclick="reconRestoreBank('${h(r.id)}')">Restaurar</button>`;
      }else{
        const sorted=candidateSort(r,available);
        const exact=sorted.filter(t=>Math.abs((Number(t.valor)||0)-(Number(r.valor)||0))<0.005);
        const rest=sorted.filter(t=>!exact.includes(t));
        const opt=(t,star)=>`<option value="${h(appKey(t))}">${star?"★ ":""}${h(displayDate(t.data))} · ${h(t.local||t.descricao)} · ${money(t.valor)} · ${h(t.fiador||"")}</option>`;
        const options=[...exact.map(t=>opt(t,true)),...rest.slice(0,25).map(t=>opt(t,false))].join("");
        action=`<select id="recon-cand-${h(r.id)}" class="filter-select" style="width:100%;min-width:320px;margin-bottom:6px"><option value="">Selecione um lançamento...</option>${options}</select><div style="display:flex;gap:5px;flex-wrap:wrap"><button class="recon-btn green" onclick="reconLinkBank('${h(r.id)}')">Vincular</button><button class="recon-btn" onclick="reconCreateFromBank('${h(r.id)}')">Criar no app</button><button class="recon-btn red" onclick="reconIgnoreBank('${h(r.id)}')">Ignorar</button></div>`;
      }
      return `<tr><td>${statusBadge(r.status)}</td><td style="white-space:nowrap">${h(displayDate(r.data))}</td><td><div style="font-weight:650;color:var(--text)">${h(r.descricao||"Sem descrição")}</div>${r.origem?`<div class="recon-sub">${h(r.origem)}</div>`:""}</td><td style="text-align:right;font-weight:750;white-space:nowrap">${money(r.valor)}</td><td>${action}</td></tr>`;
    }).join("");
  }

  function renderAppOnly(s,c){
    const showIgnored=reconView==="ignorados"||reconView==="todos";
    const rows=[...c.appOnly.map(t=>({t,ignored:false})),...(showIgnored?c.appIgnored.map(t=>({t,ignored:true})):[])];
    if(reconView==="conciliados") return "";
    if(!rows.length) return `<div class="recon-section"><div class="recon-title">Lançamentos somente no app</div><div class="recon-map" style="color:#2EB872;font-size:12px">✓ Nenhum lançamento pendente somente no app.</div></div>`;
    return `<div class="recon-section"><div class="recon-title">Lançamentos somente no app <span class="recon-sub">(${c.appOnly.length} pendente${c.appOnly.length===1?"":"s"})</span></div><div class="recon-sub" style="margin-bottom:8px">Itens de Cartões ainda não vinculados a nenhuma linha da fatura. Você pode marcar explicitamente que um item não consta nesta fatura.</div><div class="recon-table-wrap"><table class="recon-table" style="min-width:760px"><thead><tr><th>Status</th><th>Data</th><th>Descrição</th><th>Fiador</th><th style="text-align:right">Valor</th><th>Ação</th></tr></thead><tbody>${rows.map(({t,ignored})=>`<tr><td>${ignored?'<span class="recon-badge ign">Não consta</span>':'<span class="recon-badge pend">Só no app</span>'}</td><td>${h(displayDate(t.data))}</td><td><strong>${h(t.local||t.descricao)}</strong><div class="recon-sub">${h(t.descricao||"")}</div></td><td>${h(t.fiador||"")}</td><td style="text-align:right;font-weight:750">${money(t.valor)}</td><td>${s.closed?"—":ignored?`<button class="recon-btn" onclick="reconRestoreApp('${h(appKey(t))}')">Restaurar</button>`:`<button class="recon-btn red" onclick="reconIgnoreApp('${h(appKey(t))}')">Não consta na fatura</button>`}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  function renderHistory(){
    const arr=conciliacoesCartao.slice().sort((a,b)=>String(b.closedAt||b.importedAt||b.createdAt||"").localeCompare(String(a.closedAt||a.importedAt||a.createdAt||"")));
    if(!arr.length) return "";
    return `<div class="recon-section"><div class="recon-title">Histórico de conciliações</div><div style="display:grid;gap:7px">${arr.map(s=>{
      const snap=s.closedSnapshot;
      const diff=snap?Number(snap.diff)||0:sessionComputed(s).diff;
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px;flex-wrap:wrap"><div style="flex:1;min-width:210px"><div style="font-size:12px;font-weight:750;color:var(--text)">${h(monthShort(s.mes))}/${s.ano} · ${h(s.cartao)}</div><div class="recon-sub">${s.closed?`Fechada ${h(new Date(s.closedAt).toLocaleDateString("pt-BR"))}`:"Em andamento"}${s.fileName?` · ${h(s.fileName)}`:""}</div></div><div style="font-size:12px;font-weight:750;color:${Math.abs(diff)<0.005?'#2EB872':'#E63757'}">Dif. ${money(diff)}</div><button class="recon-btn" onclick="reconOpenSession('${h(s.id)}')">Abrir</button></div>`;
    }).join("")}</div></div>`;
  }

  function reconRender(){
    const body=document.getElementById("recon-body");
    if(!body) return;
    const ctx=selectedContext();
    if(!ctx.cartao){body.innerHTML='<div class="recon-map">Cadastre ou selecione um cartão para iniciar.</div>';return;}
    const s=findSession(ctx);
    if(!s||!(s.rows||[]).length){ body.innerHTML=renderEmpty(ctx); return; }
    const c=sessionComputed(s);
    const diffColor=Math.abs(c.diff)<0.005?"#2EB872":"#E63757";
    const closeBox=s.closed?`<div style="padding:10px 12px;background:rgba(46,184,114,.10);border:1px solid rgba(46,184,114,.3);border-radius:10px;font-size:12px;color:#2EB872;font-weight:650;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><span>✓ Conciliação fechada em ${h(new Date(s.closedAt).toLocaleString("pt-BR"))}</span><button class="recon-btn" onclick="reconReopen()">Reabrir</button></div>`:"";
    body.innerHTML=`${closeBox}<div class="recon-grid">
      <div class="recon-kpi"><div class="l">Fatura considerada</div><div class="v">${money(c.bankConsidered)}</div><div class="recon-sub">Arquivo: ${money(c.bankRaw)}</div></div>
      <div class="recon-kpi"><div class="l">Lançado no app</div><div class="v">${money(c.appConsidered)}</div><div class="recon-sub">${c.appRows.length} lançamento(s)</div></div>
      <div class="recon-kpi"><div class="l">Conciliado</div><div class="v" style="color:#2EB872">${money(c.linkedTotal)}</div><div class="recon-sub">${c.linked} vínculo(s)</div></div>
      <div class="recon-kpi"><div class="l">Diferença</div><div class="v" style="color:${diffColor}">${money(c.diff)}</div><div class="recon-sub">Fatura − app</div></div>
      <div class="recon-kpi"><div class="l">Pendências</div><div class="v" style="color:${c.pending+c.appOnly.length?'#F89C2A':'#2EB872'}">${c.pending+c.appOnly.length}</div><div class="recon-sub">${c.pending} banco · ${c.appOnly.length} app</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0 10px">
      ${[["todos","Todos",s.rows.length+c.appOnly.length],["pendentes","Pendentes",c.pending],["conciliados","Conciliados",c.linked],["ignorados","Ignorados",c.ignored+c.appIgnored.length],["divergencias","Divergências",c.pending+c.appOnly.length]].map(x=>`<button class="recon-filter ${reconView===x[0]?"active":""}" onclick="reconSetView('${x[0]}')">${x[1]} · ${x[2]}</button>`).join("")}
      <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${!s.closed?`<button class="recon-btn green" onclick="reconCloseSession()">Concluir conciliação</button>`:""}</div>
    </div>
    <div class="recon-section" style="margin-top:8px"><div class="recon-title">Itens da fatura do banco</div><div class="recon-sub" style="margin-bottom:8px">${h(s.fileName||"Arquivo importado")}${s.sheetName?` · aba ${h(s.sheetName)}`:""}. O sistema não confirma nenhuma correspondência sozinho.</div><div class="recon-table-wrap"><table class="recon-table"><thead><tr><th>Status</th><th>Data</th><th>Banco</th><th style="text-align:right">Valor</th><th>Correspondência no app</th></tr></thead><tbody>${renderBankRows(s,c)}</tbody></table></div></div>
    ${renderAppOnly(s,c)}
    ${renderHistory()}`;
  }

  function reconSetView(v){ reconView=v; reconRender(); }

  function findBankRow(id){ const s=currentSession(); return {s,row:s?.rows?.find(r=>r.id===id)||null}; }
  function appFromKey(key,rows){ return rows.find(t=>appKey(t)===key)||null; }

  function reconLinkBank(id){
    const {s,row}=findBankRow(id); if(!s||!row||s.closed) return;
    const sel=document.getElementById("recon-cand-"+id); const key=sel?.value; if(!key){toast("Selecione um lançamento do app.","#F89C2A");return;}
    const c=sessionComputed(s); const t=appFromKey(key,c.appRows); if(!t){toast("Lançamento não encontrado. Atualize a tela.","#E63757");return;}
    row.status="conciliado"; row.link=appSnapshot(t); row.linkedAt=new Date().toISOString();
    if(persist()){reconRender();reconDecorateCartTable();toast("✓ Itens vinculados.","#2EB872");}
  }
  function reconUnlinkBank(id){
    const {s,row}=findBankRow(id); if(!s||!row||s.closed)return;
    row.status="pendente"; delete row.link; delete row.linkedAt;
    if(persist()){reconRender();reconDecorateCartTable();}
  }
  function reconIgnoreBank(id){
    const {s,row}=findBankRow(id); if(!s||!row||s.closed)return;
    row.status="ignorado"; delete row.link; row.ignoredAt=new Date().toISOString();
    if(persist()){reconRender();reconDecorateCartTable();}
  }
  function reconRestoreBank(id){
    const {s,row}=findBankRow(id); if(!s||!row||s.closed)return;
    row.status="pendente"; delete row.ignoredAt;
    if(persist())reconRender();
  }
  function reconIgnoreApp(key){
    const s=currentSession(); if(!s||s.closed)return;
    const c=sessionComputed(s); const t=appFromKey(key,c.appRows); if(!t)return;
    if(!s.ignoredApp.some(l=>resolveLink(l,c.appRows)&&appKey(resolveLink(l,c.appRows))===key)) s.ignoredApp.push(appSnapshot(t));
    if(persist()){reconRender();reconDecorateCartTable();}
  }
  function reconRestoreApp(key){
    const s=currentSession(); if(!s||s.closed)return;
    const c=sessionComputed(s); s.ignoredApp=(s.ignoredApp||[]).filter(l=>{const t=resolveLink(l,c.appRows);return !t||appKey(t)!==key;});
    if(persist()){reconRender();reconDecorateCartTable();}
  }

  function reconCreateFromBank(id){
    const {s,row}=findBankRow(id); if(!s||!row||s.closed)return;
    if(typeof openFormCart!=="function"){toast("Formulário de Cartões não encontrado.","#E63757");return;}
    openFormCart();
    setTimeout(()=>{
      const set=(id,val)=>{const e=document.getElementById(id);if(e&&val!==undefined&&val!==null)e.value=val;};
      set("f-data",/^\d{4}-\d{2}-\d{2}$/.test(row.data||"")?row.data:"");
      set("f-local",row.descricao||"");
      set("f-desc",row.descricao||"");
      set("f-cartao",s.cartao);
      set("f-valor",row.valor);
      const fi=document.getElementById("f-fiador"); if(fi&&[...fi.options].some(o=>o.value==="Cícero"))fi.value="Cícero";
      toast("Formulário preenchido com os dados da fatura. Revise e salve manualmente.","#4361EE");
    },0);
  }

  function reconCloseSession(){
    const s=currentSession(); if(!s||s.closed)return;
    const c=sessionComputed(s);
    if(c.pending||c.appOnly.length){
      const ok=confirm(`Ainda existem ${c.pending} item(ns) pendente(s) do banco e ${c.appOnly.length} item(ns) somente no app. Deseja fechar a conciliação mesmo assim?`);
      if(!ok)return;
    }
    s.closed=true; s.closedAt=new Date().toISOString(); s.closedSnapshot={bank:c.bankConsidered,app:c.appConsidered,linked:c.linkedTotal,diff:c.diff,pending:c.pending,appOnly:c.appOnly.length,linkedCount:c.linked,ignoredCount:c.ignored+c.appIgnored.length};
    if(persist()){reconRender();reconDecorateCartTable();toast("✓ Conciliação concluída.","#2EB872");}
  }
  function reconReopen(){
    const s=currentSession(); if(!s||!s.closed)return;
    if(!confirm("Reabrir esta conciliação para novos ajustes?"))return;
    s.closed=false; s.closedAt=null; s.closedSnapshot=null;
    if(persist())reconRender();
  }
  function reconResetCurrent(){
    const s=currentSession();
    if(!s){toast("Não há conciliação neste filtro.","#F89C2A");return;}
    if(!confirm(`Apagar a conciliação de ${monthShort(s.mes)}/${s.ano} · ${s.cartao}? Os lançamentos de Cartões não serão alterados.`))return;
    conciliacoesCartao=conciliacoesCartao.filter(x=>x.id!==s.id);
    if(persist()){reconView="todos";reconRender();reconDecorateCartTable();}
  }
  function reconOpenSession(id){
    const s=conciliacoesCartao.find(x=>x.id===id); if(!s)return;
    fillSelectors();
    const y=document.getElementById("recon-ano"),m=document.getElementById("recon-mes"),c=document.getElementById("recon-cartao");
    if(y)y.value=String(s.ano); if(m)m.value=s.mes; if(c)c.value=s.cartao;
    reconView="todos"; reconRender(); document.getElementById("recon-body")?.scrollTo({top:0,behavior:"smooth"});
  }

  function detectDelimiter(line){
    const counts=[[";",(line.match(/;/g)||[]).length],[",",(line.match(/,/g)||[]).length],["\t",(line.match(/\t/g)||[]).length]];
    counts.sort((a,b)=>b[1]-a[1]); return counts[0][1]?counts[0][0]:";";
  }
  function parseDelimited(text){
    const first=(text.split(/\r?\n/).find(l=>l.trim())||"");
    const d=detectDelimiter(first); const rows=[]; let row=[],cell="",q=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(q){ if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;} else if(ch==='"')q=false; else cell+=ch; }
      else if(ch==='"')q=true;
      else if(ch===d){row.push(cell);cell="";}
      else if(ch==='\n'){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}
      else cell+=ch;
    }
    row.push(cell.replace(/\r$/,"")); if(row.some(x=>String(x).trim()))rows.push(row);
    return rows;
  }
  function loadXlsx(){
    if(window.XLSX) return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const old=document.getElementById("recon-xlsx-lib"); if(old){old.addEventListener("load",resolve,{once:true});old.addEventListener("error",reject,{once:true});return;}
      const s=document.createElement("script"); s.id="recon-xlsx-lib"; s.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"; s.onload=resolve; s.onerror=()=>reject(new Error("Falha ao carregar leitor de Excel")); document.head.appendChild(s);
    });
  }
  async function readImportFile(file){
    const ext=(file.name.split(".").pop()||"").toLowerCase();
    if(ext==="csv"||ext==="txt") return {rows:parseDelimited(await file.text()),sheet:""};
    await loadXlsx();
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:"array",cellDates:true});
    const sheet=wb.SheetNames[0];
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,raw:false,defval:"",dateNF:"yyyy-mm-dd"});
    return {rows,sheet};
  }
  function guessCol(headers,type){
    const regs={date:[/\bdata\b/i,/date/i,/compra/i,/transa/i,/lan[cç]amento/i],desc:[/descr/i,/estabelec/i,/hist[oó]rico/i,/detalhe/i,/merchant/i,/lan[cç]amento/i],value:[/\bvalor\b/i,/amount/i,/total/i,/r\$/i,/d[eé]bito/i,/cr[eé]dito/i]};
    for(const r of regs[type]){const i=headers.findIndex(x=>r.test(String(x||"")));if(i>=0)return i;}
    return type==="date"?0:type==="desc"?Math.min(1,headers.length-1):Math.min(2,headers.length-1);
  }
  function mappingSelect(id,headers,selected){
    return `<select id="${id}" class="filter-select" style="width:100%">${headers.map((x,i)=>`<option value="${i}" ${i===selected?"selected":""}>${h(x||`Coluna ${i+1}`)}</option>`).join("")}</select>`;
  }
  function renderImportMap(rows){
    const box=document.getElementById("recon-import-map"); if(!box)return;
    if(!rows||rows.length<2){box.innerHTML='<div class="recon-map" style="color:#E63757">Não encontrei linhas suficientes no arquivo.</div>';return;}
    const headers=rows[0].map((x,i)=>String(x||`Coluna ${i+1}`).trim()||`Coluna ${i+1}`);
    const di=guessCol(headers,"date"),xi=guessCol(headers,"desc"),vi=guessCol(headers,"value");
    const preview=rows.slice(0,6);
    box.innerHTML=`<div class="recon-map"><div style="font-size:12px;font-weight:750;color:var(--text);margin-bottom:4px">Confira as colunas antes de importar</div><div class="recon-sub">Nada será gravado até você clicar em “Confirmar importação”.</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px"><div><label class="filter-label">Data</label>${mappingSelect("recon-map-date",headers,di)}</div><div><label class="filter-label">Descrição / estabelecimento</label>${mappingSelect("recon-map-desc",headers,xi)}</div><div><label class="filter-label">Valor</label>${mappingSelect("recon-map-value",headers,vi)}</div></div><div class="recon-preview"><table><thead><tr>${headers.map(x=>`<th>${h(x)}</th>`).join("")}</tr></thead><tbody>${preview.slice(1).map(r=>`<tr>${headers.map((_,i)=>`<td>${h(r[i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div style="display:flex;justify-content:flex-end;gap:7px;margin-top:10px"><button class="recon-btn" onclick="reconCancelImport()">Cancelar</button><button class="recon-btn green" onclick="reconConfirmImport()">Confirmar importação</button></div></div>`;
  }

  async function reconPrepareFile(input){
    const file=input?.files?.[0]; if(!file)return;
    const ctx=selectedContext();
    if(!ctx.cartao){toast("Selecione um cartão antes de importar.","#F89C2A");input.value="";return;}
    try{
      toast("Lendo a fatura...","#4361EE");
      const out=await readImportFile(file);
      reconImportRaw=out.rows.filter(r=>Array.isArray(r)&&r.some(x=>String(x||"").trim()!==""));
      reconImportName=file.name; reconImportSheet=out.sheet||"";
      renderImportMap(reconImportRaw);
    }catch(e){console.error(e);toast("Não consegui ler o arquivo. Para Excel, verifique sua conexão; CSV também é aceito.","#E63757");}
    input.value="";
  }
  function reconCancelImport(){reconImportRaw=null;reconImportName="";reconImportSheet="";const b=document.getElementById("recon-import-map");if(b)b.innerHTML="";}
  function reconConfirmImport(){
    if(!reconImportRaw||reconImportRaw.length<2)return;
    const ctx=selectedContext(); const existing=findSession(ctx);
    if(existing&&(existing.rows||[]).length && !confirm(`Já existe uma conciliação para ${monthShort(ctx.mes)}/${ctx.ano} · ${ctx.cartao}. Substituir os itens importados e reiniciar esta conciliação?`))return;
    const di=+document.getElementById("recon-map-date").value,xi=+document.getElementById("recon-map-desc").value,vi=+document.getElementById("recon-map-value").value;
    const rows=[];
    reconImportRaw.slice(1).forEach(r=>{
      const val=parseMoney(r[vi]); const desc=String(r[xi]??"").trim(); const date=normalizeDate(r[di],ctx.ano);
      if(!Number.isFinite(val) || (!desc && !date)) return;
      rows.push({id:uid("bank"),data:date,descricao:desc||"Sem descrição",valor:val,status:"pendente",origem:""});
    });
    if(!rows.length){toast("Nenhuma linha válida encontrada com esse mapeamento.","#E63757");return;}
    let s=existing||ensureSession(ctx);
    s.ano=ctx.ano;s.mes=ctx.mes;s.cartao=ctx.cartao;s.fileName=reconImportName;s.sheetName=reconImportSheet;s.importedAt=new Date().toISOString();s.rows=rows;s.ignoredApp=[];s.closed=false;s.closedAt=null;s.closedSnapshot=null;
    reconCancelImport();
    if(persist()){reconView="todos";reconRender();reconDecorateCartTable();toast(`✓ ${rows.length} item(ns) importado(s). Agora faça as vinculações manualmente.`,"#2EB872");}
  }

  function allLinkedSnapshots(){
    const arr=[]; conciliacoesCartao.forEach(s=>(s.rows||[]).forEach(r=>{if(r.status==="conciliado"&&r.link)arr.push(r.link);})); return arr;
  }
  function reconDecorateCartTable(){
    try{
      const tbody=document.getElementById("cart-tbody"); if(!tbody)return;
      const linked=allLinkedSnapshots(); if(!linked.length)return;
      const filtered=typeof getCartFiltered==="function"?getCartFiltered():[];
      let visible=filtered;
      if(typeof curCartShowAll!=="undefined"&&!curCartShowAll && typeof PER_PAGE!=="undefined") visible=filtered.slice((curCartPage||0)*PER_PAGE,(curCartPage||0)*PER_PAGE+PER_PAGE);
      const trs=[...tbody.querySelectorAll("tr")];
      trs.forEach((tr,i)=>{
        const t=visible[i]; if(!t)return;
        const isLinked=linked.some(l=>sameSnapshot(t,l)||(l.src===t._src&&l.idx===t._idx));
        const td=tr.children[11];
        if(isLinked&&td&&!td.querySelector(".recon-cart-mark")) td.insertAdjacentHTML("beforeend",'<div class="recon-cart-mark">✓ Conciliado</div>');
      });
    }catch(e){}
  }

  function wrapCartRender(){
    try{
      if(typeof renderCartTable==="function"&&!renderCartTable.__reconWrapped){
        const original=renderCartTable;
        const wrapped=function(){const out=original.apply(this,arguments);setTimeout(reconDecorateCartTable,0);return out;};
        wrapped.__reconWrapped=true;renderCartTable=wrapped;
      }
    }catch(e){}
  }

  Object.assign(window,{reconOpen,reconClose,reconContextChanged,reconRender,reconSetView,reconLinkBank,reconUnlinkBank,reconIgnoreBank,reconRestoreBank,reconIgnoreApp,reconRestoreApp,reconCreateFromBank,reconCloseSession,reconReopen,reconResetCurrent,reconOpenSession,reconPrepareFile,reconCancelImport,reconConfirmImport});

  loadStateFallback();
  wrapState();
  installUi();
  wrapCartRender();
  setTimeout(()=>{fillSelectors();reconDecorateCartTable();},0);
})();
