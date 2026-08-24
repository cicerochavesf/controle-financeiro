/* Lançamentos — período responsivo no celular/tablet.
   - Mantém todos os meses acessíveis por rolagem horizontal.
   - Ao entrar na visão, posiciona a faixa no semestre atual.
   - Ao rolar a página, ano + meses viram uma barra compacta fixa no topo.
*/
(function(){
  "use strict";
  if(window.__cfLancPeriodoStickyLoaded) return;
  window.__cfLancPeriodoStickyLoaded=true;

  const mq=window.matchMedia("(max-width: 1180px)");
  let wrapper=null;
  let ticking=false;
  let initialPositionPending=true;

  function isResponsive(){ return mq.matches; }

  function monthButton(month){
    const tabs=document.getElementById("month-tabs");
    if(!tabs) return null;
    return [...tabs.querySelectorAll(".mtab")].find(btn=>{
      const oc=btn.getAttribute("onclick")||"";
      const m=oc.match(/selectMes\((\d+)\)/);
      return m && Number(m[1])===Number(month);
    })||null;
  }

  function currentSemesterStart(){
    const m=new Date().getMonth()+1;
    return m<=6?1:7;
  }

  function ensureStructure(){
    const panel=document.getElementById("panel-lancamentos");
    const years=document.getElementById("year-tabs");
    const months=document.getElementById("month-tabs");
    if(!panel||!years||!months) return null;

    wrapper=document.getElementById("lanc-period-sticky");
    if(!wrapper){
      const sentinel=document.createElement("div");
      sentinel.id="lanc-period-sentinel";
      sentinel.setAttribute("aria-hidden","true");
      sentinel.style.cssText="height:1px;margin-bottom:-1px;pointer-events:none";

      wrapper=document.createElement("div");
      wrapper.id="lanc-period-sticky";
      wrapper.className="lanc-period-sticky";

      panel.insertBefore(sentinel,years);
      panel.insertBefore(wrapper,years);
      wrapper.appendChild(years);
      wrapper.appendChild(months);
    }
    return wrapper;
  }

  function positionAtCurrentSemester(behavior){
    if(!isResponsive()) return;
    const tabs=document.getElementById("month-tabs");
    const btn=monthButton(currentSemesterStart());
    if(!tabs||!btn) return;
    const left=Math.max(0,btn.offsetLeft-tabs.offsetLeft);
    try{tabs.scrollTo({left,behavior:behavior||"auto"});}
    catch(e){tabs.scrollLeft=left;}
    initialPositionPending=false;
  }

  function keepSelectedMonthVisible(){
    if(!isResponsive()) return;
    const tabs=document.getElementById("month-tabs");
    const active=tabs?.querySelector(".mtab.active");
    if(!tabs||!active) return;
    const aLeft=active.offsetLeft-tabs.offsetLeft;
    const aRight=aLeft+active.offsetWidth;
    const viewLeft=tabs.scrollLeft;
    const viewRight=viewLeft+tabs.clientWidth;
    if(aLeft<viewLeft || aRight>viewRight){
      const target=Math.max(0,aLeft-(tabs.clientWidth-active.offsetWidth)/2);
      try{tabs.scrollTo({left:target,behavior:"smooth"});}
      catch(e){tabs.scrollLeft=target;}
    }
  }

  function updateStickyState(){
    ticking=false;
    wrapper=ensureStructure();
    if(!wrapper) return;
    if(!isResponsive()){
      wrapper.classList.remove("is-stuck");
      return;
    }
    const panel=document.getElementById("panel-lancamentos");
    if(!panel?.classList.contains("active")){
      wrapper.classList.remove("is-stuck");
      return;
    }
    const rect=wrapper.getBoundingClientRect();
    const stuck=rect.top<=1 && window.scrollY>8;
    wrapper.classList.toggle("is-stuck",stuck);
  }

  function requestStickyUpdate(){
    if(ticking) return;
    ticking=true;
    requestAnimationFrame(updateStickyState);
  }

  function afterPeriodRender(){
    ensureStructure();
    requestStickyUpdate();
    if(initialPositionPending){
      requestAnimationFrame(()=>positionAtCurrentSemester("auto"));
    }
  }

  // Ano e meses podem ser reconstruídos várias vezes pelo app; preserva o wrapper
  // e reposiciona a faixa sem alterar a lógica original dos lançamentos.
  if(typeof buildMonthTabs==="function" && !buildMonthTabs.__cfPeriodoSticky){
    const original=buildMonthTabs;
    const patched=function(){
      const out=original.apply(this,arguments);
      setTimeout(afterPeriodRender,0);
      return out;
    };
    patched.__cfPeriodoSticky=true;
    buildMonthTabs=patched;
  }

  if(typeof buildYearTabs==="function" && !buildYearTabs.__cfPeriodoSticky){
    const original=buildYearTabs;
    const patched=function(){
      const out=original.apply(this,arguments);
      setTimeout(afterPeriodRender,0);
      return out;
    };
    patched.__cfPeriodoSticky=true;
    buildYearTabs=patched;
  }

  if(typeof selectMes==="function" && !selectMes.__cfPeriodoSticky){
    const original=selectMes;
    const patched=function(){
      const out=original.apply(this,arguments);
      setTimeout(keepSelectedMonthVisible,20);
      return out;
    };
    patched.__cfPeriodoSticky=true;
    selectMes=patched;
  }

  if(typeof switchTab==="function" && !switchTab.__cfPeriodoSticky){
    const original=switchTab;
    const patched=function(t){
      const out=original.apply(this,arguments);
      if(t==="lancamentos"){
        initialPositionPending=true;
        setTimeout(()=>{
          afterPeriodRender();
          positionAtCurrentSemester("auto");
        },30);
      }else{
        wrapper?.classList.remove("is-stuck");
      }
      return out;
    };
    patched.__cfPeriodoSticky=true;
    switchTab=patched;
  }

  const style=document.createElement("style");
  style.id="cf-lanc-periodo-sticky-style";
  style.textContent=`
@media(max-width:1180px){
  #panel-lancamentos .lanc-period-sticky{
    position:sticky;
    top:0;
    z-index:58;
    background:var(--bg);
    padding:2px 0 4px;
    margin-bottom:0;
    transition:padding .16s ease,box-shadow .16s ease,background .16s ease;
  }
  #panel-lancamentos .lanc-period-sticky #year-tabs{
    margin-bottom:8px;
  }
  #panel-lancamentos .lanc-period-sticky #month-tabs{
    margin-bottom:12px;
    scroll-behavior:smooth;
    overscroll-behavior-x:contain;
  }
  #panel-lancamentos .lanc-period-sticky.is-stuck{
    display:flex;
    align-items:center;
    gap:6px;
    padding:5px 8px;
    margin-left:-10px;
    margin-right:-10px;
    border-bottom:1px solid var(--border);
    box-shadow:0 7px 18px rgba(0,0,0,.12);
    background:color-mix(in srgb,var(--bg) 94%,transparent);
    backdrop-filter:blur(12px);
    -webkit-backdrop-filter:blur(12px);
  }
  #panel-lancamentos .lanc-period-sticky.is-stuck #year-tabs{
    flex:0 0 auto;
    margin:0;
    gap:0;
    overflow:visible;
  }
  #panel-lancamentos .lanc-period-sticky.is-stuck #year-tabs .year-tab:not(.active),
  #panel-lancamentos .lanc-period-sticky.is-stuck #year-tabs .year-tab.add-year{
    display:none!important;
  }
  #panel-lancamentos .lanc-period-sticky.is-stuck #year-tabs .year-tab.active{
    padding:5px 9px;
    min-width:auto;
    border-radius:9px;
    font-size:10px;
    line-height:1.15;
    box-shadow:none;
  }
  #panel-lancamentos .lanc-period-sticky.is-stuck #month-tabs{
    flex:1 1 auto;
    min-width:0;
    margin:0;
    padding:0 2px 1px;
    gap:4px;
    flex-wrap:nowrap;
    overflow-x:auto;
  }
  #panel-lancamentos .lanc-period-sticky.is-stuck #month-tabs .mtab{
    padding:5px 9px;
    border-radius:8px;
    font-size:10px;
    line-height:1.15;
  }
}
@media(min-width:1181px){
  #panel-lancamentos .lanc-period-sticky{position:static!important;padding:0!important;background:transparent!important}
}
`;
  document.head.appendChild(style);

  window.addEventListener("scroll",requestStickyUpdate,{passive:true});
  window.addEventListener("resize",()=>{
    initialPositionPending=true;
    setTimeout(()=>{afterPeriodRender();positionAtCurrentSemester("auto");},40);
  },{passive:true});
  try{mq.addEventListener("change",()=>{initialPositionPending=true;afterPeriodRender();});}catch(e){}

  setTimeout(()=>{
    afterPeriodRender();
    const panel=document.getElementById("panel-lancamentos");
    if(panel?.classList.contains("active")) positionAtCurrentSemester("auto");
  },0);
})();
