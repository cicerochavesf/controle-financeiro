/* Conciliação múltipla — extensão do módulo de conciliação.
   Permite 1↔N, N↔1 e N↔N, sempre por confirmação explícita. */
(function(){
  "use strict";
  if(window.__cfReconMultiLoaded) return;
  window.__cfReconMultiLoaded=true;

  const STATE_PROP="reconciliacoesCartao";
  let multiView="todos";
  let editGroupId=null;
  let selectedBankIds=new Set();
  let selectedAppKeys=new Set();

  const old={
    open:window.reconOpen,
    close:window.reconClose,
    contextChanged:window.reconContextChanged,
    prepareFile:window.reconPrepareFile,
    cancelImport:window.reconCancelImport,
    confirmImport:window.reconConfirmImport,
    createFromBank:window.reconCreateFromBank,
    openSession:window.reconOpenSession,
    resetCurrent:window.reconResetCurrent,
    reopen:window.reconReopen
  };

  function h(v){
    return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function money(v){
    const n=Number(v)||0;
    try{return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
    catch(e){return "R$ "+n.toFixed(2).replace(".",",");}
  }
  function toast(msg,color){
    try{if(typeof showToast==="function")showToast(msg,color||"#4361EE");else alert(msg);}catch(e){alert(msg);}
  }
  function canEdit(){
    try{return typeof _requireSync!=="function"||_requireSync();}catch(e){return true;}
  }
  function persist(){
    if(!canEdit())return false;
    try{if(typeof saveToLocal==="function")saveToLocal();return true;}
    catch(e){console.error(e);toast("Não foi possível salvar a conciliação.","#E63757");return false;}
  }
  function stateSessions(){
    try{
      const st=typeof getState==="function"?getState():null;
      return st&&Array.isArray(st[STATE_PROP])?st[STATE_PROP]:[];
    }catch(e){return [];}
  }
  function selectedContext(){
    return{
      ano:Number(document.getElementById("recon-ano")?.value||2026),
      mes:document.getElementById("recon-mes")?.value||"",
      cartao:document.getElementById("recon-cartao")?.value||""
    };
  }
  function sessionKey(s){return `${Number(s?.ano||0)}|${s?.mes||""}|${s?.cartao||""}`;}
  function currentSession(){
    const ctx=selectedContext(),k=`${ctx.ano}|${ctx.mes}|${ctx.cartao}`;
    return stateSessions().find(s=>sessionKey(s)===k)||null;
  }
  function monthShort(m){return String(m||"").slice(0,3);}
  function displayDate(v){
    const s=String(v||""),m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m?`${m[3]}/${m[2]}/${m[1]}`:s||"—";
  }
  function appKey(t){return t?`${t._src}:${t._idx}`:"";}
  function appSnapshot(t){
    return{src:t._src,idx:t._idx,data:t.data||"",descricao:t.descricao||"",local:t.local||"",valor:Number(t.valor)||0,cartao:t.cartao||"",fiador:t.fiador||""};
  }
  function sameSnapshot(t,l){
    return !!t&&!!l&&String(t.data||"")===String(l.data||"")&&Math.abs((Number(t.valor)||0)-(Number(l.valor)||0))<0.005&&String(t.cartao||"")===String(l.cartao||"")&&String(t.descricao||"")===String(l.descricao||"");
  }
  function resolveLink(link,rows){
    if(!link)return null;
    let t=rows.find(x=>x._src===link.src&&x._idx===link.idx);
    if(t&&sameSnapshot(t,link))return t;
    t=rows.find(x=>sameSnapshot(x,link));
    if(t)return t;
    const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
    const nd=norm(link.descricao||link.local);
    return rows.find(x=>Math.abs((Number(x.valor)||0)-(Number(link.valor)||0))<0.005&&String(x.data||"")===String(link.data||"")&&String(x.cartao||"")===String(link.cartao||"")&&(!nd||norm(x.descricao||x.local).includes(nd)||nd.includes(norm(x.descricao||x.local))))||null;
  }
  function buildHistoricalRow(t,i){
    if(typeof ccDeletedTxns!=="undefined"&&ccDeletedTxns.has("cc_"+i))return null;
    const o=(typeof ccOverrides!=="undefined"&&ccOverrides["cc_"+i])||null;
    const rw=o?[o.mes||t[0],o.data||t[1],t[2],o.local||t[3],o.descricao||t[4],o.categoria||t[5],o.subcategoria||t[6],o.cartao||t[7],o.valor!==undefined?o.valor:t[8],o.fiador||t[9],t[10]]:t;
    const p=typeof parseCCItem==="function"?parseCCItem(rw):{mes:rw[0],data:rw[1],cod:rw[2],local:rw[3],descricao:rw[4],categoria:rw[5],subcategoria:rw[6],cartao:rw[7],valor:rw[8],fiador:rw[9]};
    return{...p,ano:2026,_src:"cc",_idx:i};
  }
  function appRowsFor(s){
    let rows=[];
    try{if(Number(s.ano)===2026)ALL_CC.forEach((t,i)=>{const p=buildHistoricalRow(t,i);if(p)rows.push(p);});}catch(e){}
    try{newCCTxns.forEach((t,i)=>{if(Number(t.ano||2026)===Number(s.ano))rows.push({...t,ano:Number(t.ano||2026),_src:"newcc",_idx:i});});}catch(e){}
    return rows.filter(t=>t.mes===s.mes&&t.cartao===s.cartao);
  }

  function normalizeSession(s){
    if(!s)return s;
    if(!Array.isArray(s.rows))s.rows=[];
    if(!Array.isArray(s.ignoredApp))s.ignoredApp=[];
    if(!Array.isArray(s.groups))s.groups=[];
    const grouped=new Set();
    s.groups.forEach(g=>{
      if(!g.id)g.id="grp_"+Date.now()+"_"+Math.random().toString(36).slice(2,8);
      if(!Array.isArray(g.bankIds))g.bankIds=[];
      if(!Array.isArray(g.appLinks))g.appLinks=[];
      g.bankIds.forEach(id=>grouped.add(id));
    });
    // Compatibilidade: vínculos individuais anteriores viram grupos 1↔1.
    s.rows.forEach(r=>{
      if(r.status==="conciliado"&&!grouped.has(r.id)&&(r.link||Array.isArray(r.links))){
        const links=Array.isArray(r.links)&&r.links.length?r.links:(r.link?[r.link]:[]);
        if(links.length){
          s.groups.push({id:"grp_legacy_"+r.id,bankIds:[r.id],appLinks:links,createdAt:r.linkedAt||new Date().toISOString()});
          grouped.add(r.id);
        }
      }
    });
    return s;
  }
  function groupForBank(s,id){normalizeSession(s);return s.groups.find(g=>g.bankIds.includes(id))||null;}
  function groupTotals(g,s,c){
    const banks=g.bankIds.map(id=>s.rows.find(r=>r.id===id)).filter(Boolean);
    const apps=g.appLinks.map(l=>resolveLink(l,c.appRows)||l).filter(Boolean);
    const bankSum=banks.reduce((a,r)=>a+(Number(r.valor)||0),0);
    const appSum=apps.reduce((a,t)=>a+(Number(t.valor)||0),0);
    return{banks,apps,bankSum,appSum,diff:bankSum-appSum};
  }
  function computed(s){
    normalizeSession(s);
    const appRows=appRowsFor(s);
    const bankGroupMap=new Map(),linkedAppMap=new Map();
    s.groups.forEach(g=>{
      g.bankIds.forEach(id=>bankGroupMap.set(id,g));
      g.appLinks.forEach(l=>{const t=resolveLink(l,appRows);if(t)linkedAppMap.set(appKey(t),g);});
    });
    const ignoredMap=new Map();
    s.ignoredApp.forEach(l=>{const t=resolveLink(l,appRows);if(t)ignoredMap.set(appKey(t),l);});
    const bankConsidered=s.rows.filter(r=>r.status!=="ignorado").reduce((a,r)=>a+(Number(r.valor)||0),0);
    const bankRaw=s.rows.reduce((a,r)=>a+(Number(r.valor)||0),0);
    const appConsidered=appRows.filter(t=>!ignoredMap.has(appKey(t))).reduce((a,t)=>a+(Number(t.valor)||0),0);
    const linkedBankRows=s.rows.filter(r=>bankGroupMap.has(r.id));
    const linkedTotal=linkedBankRows.reduce((a,r)=>a+(Number(r.valor)||0),0);
    const pending=s.rows.filter(r=>r.status!=="ignorado"&&!bankGroupMap.has(r.id)).length;
    const ignored=s.rows.filter(r=>r.status==="ignorado").length;
    const appOnly=appRows.filter(t=>!linkedAppMap.has(appKey(t))&&!ignoredMap.has(appKey(t)));
    const appIgnored=appRows.filter(t=>ignoredMap.has(appKey(t))&&!linkedAppMap.has(appKey(t)));
    return{appRows,bankGroupMap,linkedAppMap,ignoredMap,bankConsidered,bankRaw,appConsidered,linkedTotal,pending,ignored,linked:linkedBankRows.length,groups:s.groups.length,appOnly,appIgnored,diff:bankConsidered-appConsidered};
  }
  function statusBadge(row,c){
    const g=c.bankGroupMap.get(row.id);
    if(g){
      const gt=groupTotals(g,currentSession(),c);
      return Math.abs(gt.diff)<0.005?'<span class="recon-badge ok">✓ Conciliado</span>':'<span class="recon-badge pend">⚠ Conciliado</span>';
    }
    if(row.status==="ignorado")return '<span class="recon-badge ign">Ignorado</span>';
    return '<span class="recon-badge pend">Pendente</span>';
  }
  function filterRows(rows,c){
    if(multiView==="pendentes")return rows.filter(r=>r.status!=="ignorado"&&!c.bankGroupMap.has(r.id));
    if(multiView==="conciliados")return rows.filter(r=>c.bankGroupMap.has(r.id));
    if(multiView==="ignorados")return rows.filter(r=>r.status==="ignorado");
    if(multiView==="divergencias")return rows.filter(r=>r.status!=="ignorado"&&!c.bankGroupMap.has(r.id));
    return rows;
  }

  function renderGroupAction(s,r,c){
    const g=c.bankGroupMap.get(r.id);
    if(g){
      const gt=groupTotals(g,s,c);
      const detail=gt.apps.slice(0,3).map(t=>`${h(t.local||t.descricao||"Lançamento")} · ${money(t.valor)}`).join("<br>");
      return `<div style="font-size:11px;margin-bottom:6px"><strong>${gt.banks.length} banco ↔ ${gt.apps.length} app</strong><br>${detail}${gt.apps.length>3?`<br>+ ${gt.apps.length-3} item(ns)`:``}<br><span style="font-weight:700;color:${Math.abs(gt.diff)<0.005?'#2EB872':'#E63757'}">Banco ${money(gt.bankSum)} · App ${money(gt.appSum)} · Dif. ${money(gt.diff)}</span></div>${s.closed?"":`<div style="display:flex;gap:5px;flex-wrap:wrap"><button class="recon-btn" onclick="reconGroupEdit('${h(g.id)}')">Editar grupo</button><button class="recon-btn red" onclick="reconGroupUnlink('${h(g.id)}')">Desvincular grupo</button></div>`}`;
    }
    if(r.status==="ignorado")return s.closed?"—":`<button class="recon-btn" onclick="reconRestoreBank('${h(r.id)}')">Restaurar</button>`;
    if(s.closed)return "—";
    return `<div style="display:flex;gap:5px;flex-wrap:wrap"><button class="recon-btn green" onclick="reconGroupStart('${h(r.id)}')">Vincular / agrupar</button><button class="recon-btn" onclick="reconCreateFromBank('${h(r.id)}')">Criar no app</button><button class="recon-btn red" onclick="reconIgnoreBank('${h(r.id)}')">Ignorar</button></div>`;
  }
  function renderBankRows(s,c){
    const rows=filterRows(s.rows,c);
    if(!rows.length)return `<tr><td colspan="5" style="padding:22px;text-align:center;color:var(--muted)">Nenhum item neste filtro.</td></tr>`;
    return rows.map(r=>`<tr><td>${statusBadge(r,c)}</td><td style="white-space:nowrap">${h(displayDate(r.data))}</td><td><div style="font-weight:650;color:var(--text)">${h(r.descricao||"Sem descrição")}</div></td><td style="text-align:right;font-weight:750;white-space:nowrap">${money(r.valor)}</td><td>${renderGroupAction(s,r,c)}</td></tr>`).join("");
  }
  function renderAppOnly(s,c){
    if(multiView==="conciliados")return "";
    const showIgnored=multiView==="ignorados"||multiView==="todos";
    const rows=[...c.appOnly.map(t=>({t,ignored:false})),...(showIgnored?c.appIgnored.map(t=>({t,ignored:true})):[])];
    if(!rows.length)return `<div class="recon-section"><div class="recon-title">Lançamentos somente no app</div><div class="recon-map" style="color:#2EB872;font-size:12px">✓ Nenhum lançamento pendente somente no app.</div></div>`;
    return `<div class="recon-section"><div class="recon-title">Lançamentos somente no app <span class="recon-sub">(${c.appOnly.length} pendente${c.appOnly.length===1?"":"s"})</span></div><div class="recon-sub" style="margin-bottom:8px">Itens ainda não usados em nenhum vínculo. Um mesmo lançamento não pode participar de dois grupos diferentes.</div><div class="recon-table-wrap"><table class="recon-table" style="min-width:760px"><thead><tr><th>Status</th><th>Data</th><th>Descrição</th><th>Fiador</th><th style="text-align:right">Valor</th><th>Ação</th></tr></thead><tbody>${rows.map(({t,ignored})=>`<tr><td>${ignored?'<span class="recon-badge ign">Não consta</span>':'<span class="recon-badge pend">Só no app</span>'}</td><td>${h(displayDate(t.data))}</td><td><strong>${h(t.local||t.descricao)}</strong><div class="recon-sub">${h(t.descricao||"")}</div></td><td>${h(t.fiador||"")}</td><td style="text-align:right;font-weight:750">${money(t.valor)}</td><td>${s.closed?"—":ignored?`<button class="recon-btn" onclick="reconRestoreApp('${h(appKey(t))}')">Restaurar</button>`:`<button class="recon-btn red" onclick="reconIgnoreApp('${h(appKey(t))}')">Não consta na fatura</button>`}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  function renderHistory(){
    const arr=stateSessions().slice().sort((a,b)=>String(b.closedAt||b.importedAt||b.createdAt||"").localeCompare(String(a.closedAt||a.importedAt||a.createdAt||"")));
    if(!arr.length)return "";
    return `<div class="recon-section"><div class="recon-title">Histórico de conciliações</div><div style="display:grid;gap:7px">${arr.map(s=>{
      normalizeSession(s);const snap=s.closedSnapshot;const diff=snap?Number(snap.diff)||0:computed(s).diff;
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px;flex-wrap:wrap"><div style="flex:1;min-width:210px"><div style="font-size:12px;font-weight:750;color:var(--text)">${h(monthShort(s.mes))}/${s.ano} · ${h(s.cartao)}</div><div class="recon-sub">${s.closed?`Fechada ${h(new Date(s.closedAt).toLocaleDateString("pt-BR"))}`:"Em andamento"}${s.fileName?` · ${h(s.fileName)}`:""}</div></div><div style="font-size:12px;font-weight:750;color:${Math.abs(diff)<0.005?'#2EB872':'#E63757'}">Dif. ${money(diff)}</div><button class="recon-btn" onclick="reconOpenSession('${h(s.id)}')">Abrir</button></div>`;
    }).join("")}</div></div>`;
  }

  function groupEditor(s,c){
    if(!editGroupId&&selectedBankIds.size===0)return "";
    const editing=editGroupId?s.groups.find(g=>g.id===editGroupId):null;
    const usedBanks=new Set(),usedApps=new Set();
    s.groups.forEach(g=>{
      if(editing&&g.id===editing.id)return;
      g.bankIds.forEach(id=>usedBanks.add(id));
      g.appLinks.forEach(l=>{const t=resolveLink(l,c.appRows);if(t)usedApps.add(appKey(t));});
    });
    const banks=s.rows.filter(r=>r.status!=="ignorado"&&!usedBanks.has(r.id));
    const apps=c.appRows.filter(t=>!c.ignoredMap.has(appKey(t))&&!usedApps.has(appKey(t)));
    const bankSum=[...selectedBankIds].map(id=>s.rows.find(r=>r.id===id)).filter(Boolean).reduce((a,r)=>a+(Number(r.valor)||0),0);
    const appSum=[...selectedAppKeys].map(k=>apps.find(t=>appKey(t)===k)||c.appRows.find(t=>appKey(t)===k)).filter(Boolean).reduce((a,t)=>a+(Number(t.valor)||0),0);
    const diff=bankSum-appSum;
    return `<div id="recon-group-editor" class="recon-map" style="border:1.5px solid var(--cyan);margin:10px 0 14px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div><div style="font-size:14px;font-weight:800;color:var(--text)">${editing?"Editar vínculo agrupado":"Novo vínculo agrupado"}</div><div class="recon-sub">Marque um ou vários itens de cada lado. Nada será conciliado até você confirmar.</div></div>
        <button class="recon-btn" onclick="reconGroupCancel()">Cancelar</button>
      </div>
      <div id="recon-group-summary" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0">
        <div class="recon-kpi"><div class="l">Banco selecionado</div><div class="v" id="recon-group-bank-sum">${money(bankSum)}</div><div class="recon-sub" id="recon-group-bank-count">${selectedBankIds.size} item(ns)</div></div>
        <div class="recon-kpi"><div class="l">App selecionado</div><div class="v" id="recon-group-app-sum">${money(appSum)}</div><div class="recon-sub" id="recon-group-app-count">${selectedAppKeys.size} item(ns)</div></div>
        <div class="recon-kpi"><div class="l">Diferença</div><div class="v" id="recon-group-diff" style="color:${Math.abs(diff)<0.005?'#2EB872':'#E63757'}">${money(diff)}</div><div class="recon-sub">Banco − app</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px" class="recon-multi-cols">
        <div><div class="recon-title">Itens da fatura</div><div style="max-height:310px;overflow:auto;border:1px solid var(--border);border-radius:9px">${banks.map(r=>`<label style="display:grid;grid-template-columns:24px 78px 1fr auto;gap:7px;align-items:center;padding:8px;border-bottom:1px solid var(--border);cursor:pointer"><input type="checkbox" ${selectedBankIds.has(r.id)?"checked":""} onchange="reconGroupToggleBank('${h(r.id)}',this.checked)"><span class="recon-sub">${h(displayDate(r.data))}</span><span style="font-size:11px;color:var(--text)">${h(r.descricao)}</span><strong style="font-size:11px">${money(r.valor)}</strong></label>`).join("")}</div></div>
        <div><div class="recon-title">Lançamentos do app</div><div style="max-height:310px;overflow:auto;border:1px solid var(--border);border-radius:9px">${apps.map(t=>`<label style="display:grid;grid-template-columns:24px 78px 1fr auto;gap:7px;align-items:center;padding:8px;border-bottom:1px solid var(--border);cursor:pointer"><input type="checkbox" ${selectedAppKeys.has(appKey(t))?"checked":""} onchange="reconGroupToggleApp('${h(appKey(t))}',this.checked)"><span class="recon-sub">${h(displayDate(t.data))}</span><span style="font-size:11px;color:var(--text)">${h(t.local||t.descricao)}<span class="recon-sub" style="display:block">${h(t.fiador||"")}</span></span><strong style="font-size:11px">${money(t.valor)}</strong></label>`).join("")}</div></div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="recon-btn green" onclick="reconGroupConfirm()">Conciliar selecionados</button></div>
    </div>`;
  }
  function render(){
    const body=document.getElementById("recon-body");if(!body)return;
    const s=currentSession();
    if(!s||!Array.isArray(s.rows)||!s.rows.length)return;
    normalizeSession(s);const c=computed(s);
    const diffColor=Math.abs(c.diff)<0.005?"#2EB872":"#E63757";
    const closeBox=s.closed?`<div style="padding:10px 12px;background:rgba(46,184,114,.10);border:1px solid rgba(46,184,114,.3);border-radius:10px;font-size:12px;color:#2EB872;font-weight:650;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><span>✓ Conciliação fechada em ${h(new Date(s.closedAt).toLocaleString("pt-BR"))}</span><button class="recon-btn" onclick="reconReopen()">Reabrir</button></div>`:"";
    body.innerHTML=`${closeBox}<div class="recon-grid">
      <div class="recon-kpi"><div class="l">Fatura considerada</div><div class="v">${money(c.bankConsidered)}</div><div class="recon-sub">Arquivo: ${money(c.bankRaw)}</div></div>
      <div class="recon-kpi"><div class="l">Lançado no app</div><div class="v">${money(c.appConsidered)}</div><div class="recon-sub">${c.appRows.length} lançamento(s)</div></div>
      <div class="recon-kpi"><div class="l">Conciliado</div><div class="v" style="color:#2EB872">${money(c.linkedTotal)}</div><div class="recon-sub">${c.groups} grupo(s) · ${c.linked} item(ns) banco</div></div>
      <div class="recon-kpi"><div class="l">Diferença</div><div class="v" style="color:${diffColor}">${money(c.diff)}</div><div class="recon-sub">Fatura − app</div></div>
      <div class="recon-kpi"><div class="l">Pendências</div><div class="v" style="color:${c.pending+c.appOnly.length?'#F89C2A':'#2EB872'}">${c.pending+c.appOnly.length}</div><div class="recon-sub">${c.pending} banco · ${c.appOnly.length} app</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0 10px">
      ${[["todos","Todos",s.rows.length+c.appOnly.length],["pendentes","Pendentes",c.pending],["conciliados","Conciliados",c.linked],["ignorados","Ignorados",c.ignored+c.appIgnored.length],["divergencias","Divergências",c.pending+c.appOnly.length]].map(x=>`<button class="recon-filter ${multiView===x[0]?"active":""}" onclick="reconSetView('${x[0]}')">${x[1]} · ${x[2]}</button>`).join("")}
      <div style="margin-left:auto">${!s.closed?`<button class="recon-btn green" onclick="reconCloseSession()">Concluir conciliação</button>`:""}</div>
    </div>
    ${groupEditor(s,c)}
    <div class="recon-section" style="margin-top:8px"><div class="recon-title">Itens da fatura do banco</div><div class="recon-sub" style="margin-bottom:8px">${h(s.fileName||"Arquivo importado")}${s.sheetName?` · aba ${h(s.sheetName)}`:""}. Use “Vincular / agrupar” para conciliar um ou vários itens de cada lado.</div><div class="recon-table-wrap"><table class="recon-table"><thead><tr><th>Status</th><th>Data</th><th>Banco</th><th style="text-align:right">Valor</th><th>Correspondência no app</th></tr></thead><tbody>${renderBankRows(s,c)}</tbody></table></div></div>
    ${renderAppOnly(s,c)}
    ${renderHistory()}`;
  }

  function recalcGroupSummary(){
    const s=currentSession();if(!s)return;const c=computed(s);
    const bankSum=[...selectedBankIds].map(id=>s.rows.find(r=>r.id===id)).filter(Boolean).reduce((a,r)=>a+(Number(r.valor)||0),0);
    const appSum=[...selectedAppKeys].map(k=>c.appRows.find(t=>appKey(t)===k)).filter(Boolean).reduce((a,t)=>a+(Number(t.valor)||0),0);
    const diff=bankSum-appSum;
    const set=(id,txt)=>{const e=document.getElementById(id);if(e)e.textContent=txt;};
    set("recon-group-bank-sum",money(bankSum));set("recon-group-bank-count",`${selectedBankIds.size} item(ns)`);
    set("recon-group-app-sum",money(appSum));set("recon-group-app-count",`${selectedAppKeys.size} item(ns)`);
    const de=document.getElementById("recon-group-diff");if(de){de.textContent=money(diff);de.style.color=Math.abs(diff)<0.005?"#2EB872":"#E63757";}
  }
  function reconGroupStart(bankId){
    const s=currentSession();if(!s||s.closed)return;normalizeSession(s);
    if(groupForBank(s,bankId)){toast("Este item já pertence a um grupo.","#F89C2A");return;}
    editGroupId=null;selectedBankIds=new Set([bankId]);selectedAppKeys=new Set();render();
    document.getElementById("recon-group-editor")?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  function reconGroupEdit(groupId){
    const s=currentSession();if(!s||s.closed)return;normalizeSession(s);
    const g=s.groups.find(x=>x.id===groupId);if(!g)return;
    const c=computed(s);editGroupId=groupId;selectedBankIds=new Set(g.bankIds);
    selectedAppKeys=new Set(g.appLinks.map(l=>{const t=resolveLink(l,c.appRows);return t?appKey(t):"";}).filter(Boolean));
    render();document.getElementById("recon-group-editor")?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  function reconGroupToggleBank(id,checked){if(checked)selectedBankIds.add(id);else selectedBankIds.delete(id);recalcGroupSummary();}
  function reconGroupToggleApp(key,checked){if(checked)selectedAppKeys.add(key);else selectedAppKeys.delete(key);recalcGroupSummary();}
  function reconGroupCancel(){editGroupId=null;selectedBankIds.clear();selectedAppKeys.clear();render();}
  function reconGroupConfirm(){
    const s=currentSession();if(!s||s.closed)return;normalizeSession(s);const c=computed(s);
    if(!selectedBankIds.size||!selectedAppKeys.size){toast("Selecione pelo menos um item do banco e um lançamento do app.","#F89C2A");return;}
    const oldGroup=editGroupId?s.groups.find(g=>g.id===editGroupId):null;
    const otherBank=new Set(),otherApp=new Set();
    s.groups.forEach(g=>{if(oldGroup&&g.id===oldGroup.id)return;g.bankIds.forEach(id=>otherBank.add(id));g.appLinks.forEach(l=>{const t=resolveLink(l,c.appRows);if(t)otherApp.add(appKey(t));});});
    if([...selectedBankIds].some(id=>otherBank.has(id))||[...selectedAppKeys].some(k=>otherApp.has(k))){toast("Um dos itens selecionados já pertence a outro vínculo.","#E63757");return;}
    const banks=[...selectedBankIds].map(id=>s.rows.find(r=>r.id===id)).filter(Boolean);
    const apps=[...selectedAppKeys].map(k=>c.appRows.find(t=>appKey(t)===k)).filter(Boolean);
    if(banks.length!==selectedBankIds.size||apps.length!==selectedAppKeys.size){toast("Algum item não foi encontrado. Reabra o vínculo e tente novamente.","#E63757");return;}
    const bankSum=banks.reduce((a,r)=>a+(Number(r.valor)||0),0),appSum=apps.reduce((a,t)=>a+(Number(t.valor)||0),0),diff=bankSum-appSum;
    if(Math.abs(diff)>=0.005){
      if(!confirm(`Os itens do banco somam ${money(bankSum)} e os itens do app somam ${money(appSum)}. A diferença é ${money(diff)}. Deseja vincular mesmo assim?`))return;
    }
    if(oldGroup){
      oldGroup.bankIds.forEach(id=>{if(!selectedBankIds.has(id)){const r=s.rows.find(x=>x.id===id);if(r){r.status="pendente";delete r.link;delete r.links;delete r.linkedAt;}}});
      oldGroup.bankIds=[...selectedBankIds];oldGroup.appLinks=apps.map(appSnapshot);oldGroup.updatedAt=new Date().toISOString();
    }else{
      s.groups.push({id:"grp_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),bankIds:[...selectedBankIds],appLinks:apps.map(appSnapshot),createdAt:new Date().toISOString()});
    }
    const g=oldGroup||s.groups[s.groups.length-1];
    banks.forEach(r=>{r.status="conciliado";r.links=g.appLinks.slice();r.link=g.appLinks[0];r.linkedAt=new Date().toISOString();delete r.ignoredAt;});
    editGroupId=null;selectedBankIds.clear();selectedAppKeys.clear();
    if(persist()){render();decorateCart();toast("✓ Vínculo agrupado salvo.","#2EB872");}
  }
  function reconGroupUnlink(groupId){
    const s=currentSession();if(!s||s.closed)return;normalizeSession(s);
    const g=s.groups.find(x=>x.id===groupId);if(!g)return;
    if(!confirm(`Desvincular este grupo (${g.bankIds.length} item(ns) do banco)?`))return;
    g.bankIds.forEach(id=>{const r=s.rows.find(x=>x.id===id);if(r){r.status="pendente";delete r.link;delete r.links;delete r.linkedAt;}});
    s.groups=s.groups.filter(x=>x.id!==groupId);
    if(persist()){render();decorateCart();}
  }
  function reconIgnoreBank(id){
    const s=currentSession();if(!s||s.closed)return;normalizeSession(s);
    if(groupForBank(s,id)){toast("Desvincule o grupo antes de ignorar este item.","#F89C2A");return;}
    const r=s.rows.find(x=>x.id===id);if(!r)return;r.status="ignorado";r.ignoredAt=new Date().toISOString();delete r.link;delete r.links;
    if(persist())render();
  }
  function reconRestoreBank(id){
    const s=currentSession();if(!s||s.closed)return;const r=s.rows.find(x=>x.id===id);if(!r)return;r.status="pendente";delete r.ignoredAt;if(persist())render();
  }
  function reconIgnoreApp(key){
    const s=currentSession();if(!s||s.closed)return;const c=computed(s);
    if(c.linkedAppMap.has(key)){toast("Este lançamento já pertence a um vínculo.","#F89C2A");return;}
    const t=c.appRows.find(x=>appKey(x)===key);if(!t)return;
    if(!s.ignoredApp.some(l=>{const x=resolveLink(l,c.appRows);return x&&appKey(x)===key;}))s.ignoredApp.push(appSnapshot(t));
    if(persist())render();
  }
  function reconRestoreApp(key){
    const s=currentSession();if(!s||s.closed)return;const c=computed(s);
    s.ignoredApp=s.ignoredApp.filter(l=>{const t=resolveLink(l,c.appRows);return !t||appKey(t)!==key;});if(persist())render();
  }
  function reconCloseSession(){
    const s=currentSession();if(!s||s.closed)return;const c=computed(s);
    if(c.pending||c.appOnly.length){if(!confirm(`Ainda existem ${c.pending} item(ns) pendente(s) do banco e ${c.appOnly.length} item(ns) somente no app. Deseja fechar a conciliação mesmo assim?`))return;}
    s.closed=true;s.closedAt=new Date().toISOString();s.closedSnapshot={bank:c.bankConsidered,app:c.appConsidered,linked:c.linkedTotal,diff:c.diff,pending:c.pending,appOnly:c.appOnly.length,linkedCount:c.linked,groupCount:c.groups,ignoredCount:c.ignored+c.appIgnored.length};
    if(persist()){render();decorateCart();toast("✓ Conciliação concluída.","#2EB872");}
  }
  function reconReopen(){
    const s=currentSession();if(!s||!s.closed)return;if(!confirm("Reabrir esta conciliação para novos ajustes?"))return;
    s.closed=false;s.closedAt=null;s.closedSnapshot=null;if(persist())render();
  }
  function reconSetView(v){multiView=v;render();}
  function reconContextChanged(){
    if(typeof old.contextChanged==="function")old.contextChanged();
    multiView="todos";editGroupId=null;selectedBankIds.clear();selectedAppKeys.clear();setTimeout(render,0);
  }
  function reconOpen(){
    if(typeof old.open==="function")old.open();
    multiView="todos";editGroupId=null;selectedBankIds.clear();selectedAppKeys.clear();setTimeout(render,0);
  }
  function reconOpenSession(id){
    if(typeof old.openSession==="function")old.openSession(id);
    multiView="todos";editGroupId=null;selectedBankIds.clear();selectedAppKeys.clear();setTimeout(render,0);
  }
  function reconResetCurrent(){
    if(typeof old.resetCurrent==="function")old.resetCurrent();
    editGroupId=null;selectedBankIds.clear();selectedAppKeys.clear();setTimeout(render,0);
  }
  function reconConfirmImport(){
    const before=currentSession(),beforeIds=before?(before.rows||[]).map(r=>r.id).join("|"):"";
    if(typeof old.confirmImport==="function")old.confirmImport();
    const after=currentSession(),afterIds=after?(after.rows||[]).map(r=>r.id).join("|"):"";
    if(after&&beforeIds!==afterIds){after.groups=[];(after.rows||[]).forEach(r=>{delete r.link;delete r.links;r.status=r.status==="ignorado"?"ignorado":"pendente";});persist();}
    editGroupId=null;selectedBankIds.clear();selectedAppKeys.clear();setTimeout(render,0);
  }

  function allGroupLinks(){
    const out=[];
    stateSessions().forEach(s=>{normalizeSession(s);s.groups.forEach(g=>g.appLinks.forEach(l=>out.push({link:l,group:g})));});
    return out;
  }
  function decorateCart(){
    try{
      const tbody=document.getElementById("cart-tbody");if(!tbody)return;
      const links=allGroupLinks();if(!links.length)return;
      const filtered=typeof getCartFiltered==="function"?getCartFiltered():[];
      let visible=filtered;
      if(typeof curCartShowAll!=="undefined"&&!curCartShowAll&&typeof PER_PAGE!=="undefined")visible=filtered.slice((curCartPage||0)*PER_PAGE,(curCartPage||0)*PER_PAGE+PER_PAGE);
      [...tbody.querySelectorAll("tr")].forEach((tr,i)=>{
        const t=visible[i];if(!t)return;
        const hit=links.find(x=>sameSnapshot(t,x.link)||(x.link.src===t._src&&x.link.idx===t._idx));
        const td=tr.children[11];
        if(hit&&td&&!td.querySelector(".recon-cart-mark")){
          const grouped=hit.group.bankIds.length>1||hit.group.appLinks.length>1;
          td.insertAdjacentHTML("beforeend",`<div class="recon-cart-mark">✓ Conciliado${grouped?" · grupo":""}</div>`);
        }
      });
    }catch(e){}
  }
  function installExtraCss(){
    if(document.getElementById("recon-multi-style"))return;
    const st=document.createElement("style");st.id="recon-multi-style";
    st.textContent=`@media(max-width:760px){.recon-multi-cols{grid-template-columns:1fr!important}#recon-group-summary{grid-template-columns:1fr!important}}`;
    document.head.appendChild(st);
  }
  function wrapApplyState(){
    try{
      if(typeof applyState==="function"&&!applyState.__reconMultiWrapped){
        const fn=applyState;
        const w=function(){const out=fn.apply(this,arguments);setTimeout(()=>{try{render();decorateCart();}catch(e){}},20);return out;};
        w.__reconMultiWrapped=true;applyState=w;
      }
    }catch(e){}
  }
  function wrapCartRender(){
    try{
      if(typeof renderCartTable==="function"&&!renderCartTable.__reconMultiWrapped){
        const fn=renderCartTable;
        const w=function(){const out=fn.apply(this,arguments);setTimeout(decorateCart,0);return out;};
        w.__reconMultiWrapped=true;renderCartTable=w;
      }
    }catch(e){}
  }

  Object.assign(window,{
    reconOpen,reconOpenSession,reconContextChanged,reconSetView,reconConfirmImport,reconResetCurrent,reconReopen,
    reconGroupStart,reconGroupEdit,reconGroupToggleBank,reconGroupToggleApp,reconGroupCancel,reconGroupConfirm,reconGroupUnlink,
    reconIgnoreBank,reconRestoreBank,reconIgnoreApp,reconRestoreApp,reconCloseSession
  });

  installExtraCss();wrapApplyState();wrapCartRender();
  setTimeout(()=>{try{const s=currentSession();if(s&&s.rows?.length)render();decorateCart();}catch(e){}},0);
})();