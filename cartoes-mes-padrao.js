/* Cartões — mês padrão ao entrar na visão.
   Sempre que o usuário navega para Cartões, abre o mês calendário seguinte
   ao mês atual. Ex.: agosto/2026 -> setembro/2026; dezembro/2026 -> janeiro/2027. */
(function(){
  "use strict";
  if(window.__cfCartMesPadraoLoaded) return;
  window.__cfCartMesPadraoLoaded=true;

  const MESES=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  function periodoSeguinte(){
    const agora=new Date();
    const prox=new Date(agora.getFullYear(),agora.getMonth()+1,1);
    return {ano:prox.getFullYear(),mes:MESES[prox.getMonth()]};
  }

  function aplicarMesPadrao(){
    const p=periodoSeguinte();
    try{curCartAno=p.ano;}catch(e){}
    try{curCartMes=p.mes;}catch(e){}
    try{curCartPage=0;}catch(e){}

    // Garante que a virada dez -> jan também tenha o ano disponível na interface.
    try{
      if(Array.isArray(anos)&&!anos.includes(p.ano)){
        anos.push(p.ano);
        anos.sort((a,b)=>a-b);
      }
    }catch(e){}

    return p;
  }

  if(typeof switchTab==="function"&&!switchTab.__cfCartMesPadrao){
    const original=switchTab;
    const patched=function(t,btn,source){
      const ehCartoes=t==="cartoes";
      if(ehCartoes) aplicarMesPadrao();
      const out=original.apply(this,arguments);
      if(ehCartoes){
        // Reforço após o render original, caso algum seletor tenha sido reconstruído.
        setTimeout(()=>{
          const p=aplicarMesPadrao();
          try{
            const sel=document.getElementById("filter-cartmes");
            if(sel&&[...sel.options].some(o=>o.value===p.mes)) sel.value=p.mes;
          }catch(e){}
          try{if(typeof buildCardSel==="function")buildCardSel();}catch(e){}
          try{if(typeof renderCartTable==="function")renderCartTable();}catch(e){}
        },0);
      }
      return out;
    };
    patched.__cfCartMesPadrao=true;
    switchTab=patched;
  }
})();
