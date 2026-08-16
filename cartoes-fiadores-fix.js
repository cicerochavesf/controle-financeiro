/* Cartões — consistência de fiadores no Extrato e KPIs.
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

  // Garante que a tabela de Cartões trate somente o nome exato Cícero como pessoal.
  if(typeof getCartFiltered==="function" && !getCartFiltered.__cfExactFiadorView){
    const originalGetCartFiltered=getCartFiltered;
    const patched=function(){
      const rows=originalGetCartFiltered.apply(this,arguments);
      if(Array.isArray(rows)) rows.forEach(t=>{ t.is_cicero=t.fiador==="Cícero"; });
      return rows;
    };
    patched.__cfExactFiadorView=true;
    getCartFiltered=patched;
  }

  // Extrato: lista os fiadores realmente existentes nos dados, inclusive históricos.
  if(typeof openExtrato==="function" && !openExtrato.__cfExactFiadorView){
    const originalOpenExtrato=openExtrato;
    const patched=function(){
      const out=originalOpenExtrato.apply(this,arguments);
      try{
        const sp=document.getElementById("extrato-person");
        if(!sp) return out;
        const names=new Set();
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

  // Reforça comparação exata no resultado do Extrato, principalmente para
  // separar "Despesas Casal" de "Despesas Casal PG" e de nomes legados.
  if(typeof getExtratoData==="function" && !getExtratoData.__cfExactFiadorView){
    const originalGetExtratoData=getExtratoData;
    const patched=function(){
      const rows=originalGetExtratoData.apply(this,arguments);
      const pessoa=document.getElementById("extrato-person")?.value||"";
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
      const panel=document.getElementById("panel-cartoes");
      if(panel?.classList.contains("active") && typeof renderCartTable==="function") renderCartTable();
    }catch(e){}
  },0);
})();
