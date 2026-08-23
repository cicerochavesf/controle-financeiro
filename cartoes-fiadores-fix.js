/* Cartões — consistência de fiadores no filtro principal, Extrato e KPIs.
   Na visão Cartões, somente o fiador exatamente "Cícero" é pessoal.
   Todos os demais nomes, inclusive "Despesas Casal" e "Despesas Casal PG",
   são terceiros e permanecem independentes. */
(function(){
  "use strict";
  if(window.__cfCartFiadoresFixLoaded) return;
  window.__cfCartFiadoresFixLoaded=true;

  function h(v){
    return String(v==null?"":v)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function money(v){
    const n=Number(v)||0;
    try{if(typeof fmt==="function") return fmt(n);}catch(e){}
    try{return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
    catch(e){return "R$ "+n.toFixed(2).replace(".",",");}
  }

  function periodFiadores(){
    const names=new Set(["Despesas Casal","Despesas Casal PG"]);
    const ano=Number(typeof curCartAno!=="undefined"?curCartAno:2026)||2026;
    const mes=typeof curCartMes!=="undefined"?curCartMes:"Todos";

    // Histórico: usa o fiador e o mês efetivos, respeitando override e exclusão.
    if(ano===2026){
      try{
        (ALL_CC||[]).forEach((t,i)=>{
          if(typeof ccDeletedTxns!=="undefined" && ccDeletedTxns?.has?.("cc_"+i)) return;
          const o=(typeof ccOverrides!=="undefined" && ccOverrides?.["cc_"+i])||null;
          const rowMes=o?.mes||t?.[0]||"";
          const fiador=o?.fiador||t?.[9]||"";
          if(mes!=="Todos" && rowMes!==mes) return;
          if(fiador) names.add(fiador);
        });
      }catch(e){}
    }

    // Lançamentos novos do ano/mês selecionado.
    try{
      (newCCTxns||[]).forEach((t,i)=>{
        if(typeof ccDeletedTxns!=="undefined" && ccDeletedTxns?.has?.("newcc_"+i)) return;
        if(Number(t?.ano||2026)!==ano) return;
        if(mes!=="Todos" && t?.mes!==mes) return;
        if(t?.fiador) names.add(t.fiador);
      });
    }catch(e){}

    return [...names].filter(Boolean).sort((a,b)=>a.localeCompare(b,"pt"));
  }

  // Filtro principal Pessoa / Fiador: "Despesas Casal" e "Despesas Casal PG"
  // ficam sempre disponíveis e são tratados como valores exatos independentes.
  function patchMainPersonFilter(){
    try{
      const fp=document.getElementById("filter-person");
      if(!fp) return;
      const names=periodFiadores();
      const preferred=(typeof curPerson!=="undefined"?curPerson:fp.value)||"Todos";
      fp.innerHTML='<option value="Todos">Todas as pessoas</option>'+names.map(f=>`<option value="${h(f)}">${h(f)}</option>`).join("");
      if(preferred!=="Casal" && names.includes(preferred)) fp.value=preferred;
      else {
        fp.value="Todos";
        try{if(typeof curPerson!=="undefined") curPerson="Todos";}catch(e){}
      }
    }catch(e){console.warn("Falha ao atualizar filtro de fiadores de Cartões:",e);}
  }

  // A filtragem de Pessoa/Fiador é feita aqui por igualdade exata.
  // Temporariamente remove o filtro de pessoa da função original para impedir
  // qualquer agrupamento legado e depois reaplica o nome selecionado exatamente.
  if(typeof getCartFiltered==="function" && !getCartFiltered.__cfExactFiadorView){
    const originalGetCartFiltered=getCartFiltered;
    const patched=function(){
      let wanted="Todos";
      try{wanted=(typeof curPerson!=="undefined"?curPerson:"Todos")||"Todos";}catch(e){}
      let rows;
      if(wanted!=="Todos"){
        try{curPerson="Todos";}catch(e){}
        try{rows=originalGetCartFiltered.apply(this,arguments);}
        finally{try{curPerson=wanted;}catch(e){}}
      }else{
        rows=originalGetCartFiltered.apply(this,arguments);
      }
      if(Array.isArray(rows)){
        rows.forEach(t=>{t.is_cicero=t.fiador==="Cícero";});
        if(wanted!=="Todos") rows=rows.filter(t=>t.fiador===wanted);
      }
      return rows;
    };
    patched.__cfExactFiadorView=true;
    getCartFiltered=patched;
  }

  // Reaplica o filtro sempre que os seletores de Cartões forem reconstruídos.
  if(typeof buildCardSel==="function" && !buildCardSel.__cfExactFiadorView){
    const originalBuildCardSel=buildCardSel;
    const patched=function(){
      const out=originalBuildCardSel.apply(this,arguments);
      patchMainPersonFilter();
      return out;
    };
    patched.__cfExactFiadorView=true;
    buildCardSel=patched;
  }

  // Reconstrói imediatamente antes de abrir o seletor nativo no celular.
  setTimeout(()=>{
    const fp=document.getElementById("filter-person");
    if(fp && !fp.__cfExactBound){
      fp.__cfExactBound=true;
      fp.addEventListener("pointerdown",patchMainPersonFilter);
      fp.addEventListener("focus",patchMainPersonFilter);
      fp.addEventListener("click",patchMainPersonFilter);
    }
    patchMainPersonFilter();
  },0);

  // Quando chegar estado novo do Firebase/local, atualiza a lista novamente.
  if(typeof applyState==="function" && !applyState.__cfFiadorFilterWrapped){
    const originalApplyState=applyState;
    const patched=function(){
      const out=originalApplyState.apply(this,arguments);
      setTimeout(patchMainPersonFilter,0);
      return out;
    };
    patched.__cfFiadorFilterWrapped=true;
    applyState=patched;
  }

  // Extrato: opções exatas e independentes; Casal e Casal PG sempre disponíveis.
  if(typeof openExtrato==="function" && !openExtrato.__cfExactFiadorView){
    const originalOpenExtrato=openExtrato;
    const patched=function(){
      const out=originalOpenExtrato.apply(this,arguments);
      try{
        const sp=document.getElementById("extrato-person");
        if(!sp) return out;
        const names=new Set(["Despesas Casal","Despesas Casal PG"]);
        try{(ALL_FIADORES||[]).forEach(f=>{if(f)names.add(f);});}catch(e){}
        try{(configFiadores||[]).forEach(f=>{if(f)names.add(f);});}catch(e){}
        try{(ALL_CC||[]).forEach(t=>{if(t&&t[9])names.add(t[9]);});}catch(e){}
        try{(newCCTxns||[]).forEach(t=>{if(t&&t.fiador)names.add(t.fiador);});}catch(e){}
        try{Object.values(ccOverrides||{}).forEach(o=>{if(o&&o.fiador)names.add(o.fiador);});}catch(e){}

        names.delete("");
        const others=[...names].filter(f=>f!=="Cícero").sort((a,b)=>a.localeCompare(b,"pt"));
        const preferred=(typeof curPerson!=="undefined" && names.has(curPerson))?curPerson:sp.value;
        sp.innerHTML=`<option value="Cícero">Cícero</option>`+
          others.map(f=>`<option value="${h(f)}">${h(f)}</option>`).join("");
        if([...sp.options].some(o=>o.value===preferred)) sp.value=preferred;
        else if([...sp.options].some(o=>o.value==="Cícero")) sp.value="Cícero";
        if(typeof renderExtrato==="function") renderExtrato();
      }catch(e){console.warn("Falha ao atualizar fiadores do Extrato:",e);}
      return out;
    };
    patched.__cfExactFiadorView=true;
    openExtrato=patched;
  }

  // Reforça comparação exata no resultado do Extrato.
  if(typeof getExtratoData==="function" && !getExtratoData.__cfExactFiadorView){
    const originalGetExtratoData=getExtratoData;
    const patched=function(){
      const pessoa=document.getElementById("extrato-person")?.value||"";
      let saved="";
      try{saved=typeof curPerson!=="undefined"?curPerson:"";}catch(e){}
      let rows;
      try{
        if(pessoa){try{curPerson="Todos";}catch(e){}}
        rows=originalGetExtratoData.apply(this,arguments);
      }finally{
        try{if(saved)curPerson=saved;}catch(e){}
      }
      return Array.isArray(rows)&&pessoa ? rows.filter(t=>t.fiador===pessoa) : rows;
    };
    patched.__cfExactFiadorView=true;
    getExtratoData=patched;
  }

  // KPIs de Cartões:
  // - Despesas Casal = somente o nome exato "Despesas Casal" (não inclui PG).
  // - Terceiros = tudo que não é exatamente Cícero, portanto inclui Casal e Casal PG.
  if(typeof renderCartKpis==="function" && !renderCartKpis.__cfExactFiadorView){
    const originalRenderCartKpis=renderCartKpis;
    const patched=function(filtered){
      const out=originalRenderCartKpis.apply(this,arguments);
      try{
        const rows=Array.isArray(filtered)?filtered:[];
        const casal=rows.filter(t=>t.fiador==="Despesas Casal").reduce((s,t)=>s+(Number(t.valor)||0),0);
        const terceiros=rows.filter(t=>t.fiador!=="Cícero").reduce((s,t)=>s+(Number(t.valor)||0),0);
        const cards=[...document.querySelectorAll("#cart-kpis .kpi")];
        const patch=(label,value,sub)=>{
          const card=cards.find(k=>(k.querySelector(".kpi-label")?.textContent||"").trim()===label);
          if(!card) return;
          const val=card.querySelector(".kpi-value"); if(val) val.textContent=money(value);
          const subEl=card.querySelector(".kpi-sub"); if(subEl&&sub) subEl.textContent=sub;
        };
        patch("Despesas Casal",casal,"somente Despesas Casal");
        patch("Terceiros",terceiros,"todos exceto Cícero");
      }catch(e){console.warn("Falha ao ajustar KPIs de fiadores:",e);}
      return out;
    };
    patched.__cfExactFiadorView=true;
    renderCartKpis=patched;
  }

  // Atualiza a tela se Cartões já estiver aberta.
  setTimeout(()=>{
    try{
      patchMainPersonFilter();
      const panel=document.getElementById("panel-cartoes");
      if(panel?.classList.contains("active") && typeof renderCartTable==="function") renderCartTable();
    }catch(e){}
  },0);
})();
