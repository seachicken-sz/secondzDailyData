"use strict";
const {openBrowser,openPage}=require("./common/browser");
const {jstDates}=require("./common/datetime");
const {collect}=require("./radio/collectors/jfn");

async function snapshot(page,label){
  const structure=await page.evaluate(()=>{
    const clean=s=>String(s||"").replace(/\s+/g," ").trim();
    const describe=e=>({tag:e.tagName,id:e.id,cls:typeof e.className==="string"?e.className:"",children:e.children.length});
    const chain=e=>{const a=[];for(let i=0;e&&i<5;i++,e=e.parentElement)a.push(describe(e));return a;};
    const visible=e=>!!e.getClientRects().length;
    const headings=[...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).map(e=>({...describe(e),text:clean(e.textContent).slice(0,100)}));
    const times=[...document.querySelectorAll("body *")].filter(e=>!e.children.length&&visible(e)&&/^\d{1,2}:\d{2}$/.test(clean(e.textContent)));
    const forms=[...document.forms].map(f=>({chain:chain(f),selects:[...f.querySelectorAll("select")].map(s=>({name:s.name,id:s.id,value:s.value,options:s.options.length})),controls:[...f.querySelectorAll("a,button,input,[onclick]")].map(e=>({...describe(e),type:e.getAttribute("type")}))}));
    const controls=[...document.querySelectorAll("a,button,input[type=button],input[type=submit],input[type=image],img,[onclick]")].filter(visible).filter(e=>/^(GO|検索)$/i.test(clean(e.innerText||e.getAttribute("alt")||e.value))||/go\./i.test(e.getAttribute("src")||"")).slice(0,20).map(e=>({chain:chain(e),onclick:!!e.getAttribute("onclick"),target:e.getAttribute("target")}));
    const labels=[...document.querySelectorAll("body *")].filter(e=>!e.children.length&&visible(e)&&/^(TIME|TITLE|ARTIST|オンエアされた楽曲一覧)$/i.test(clean(e.textContent))).slice(0,20).map(e=>({label:clean(e.textContent),chain:chain(e)}));
    const rowShapes=times.slice(0,3).map(e=>{const a=[];for(let p=e.parentElement,i=0;p&&i<4;p=p.parentElement,i++)a.push({...describe(p),children:[...p.children].slice(0,12).map(describe)});return a;});
    return {headings,forms,controls,labels,timeCount:times.length,timeChains:times.slice(0,3).map(chain),rowShapes,tableCount:document.querySelectorAll("table").length,frames:[...document.querySelectorAll("iframe")].map(describe),paging:[...document.querySelectorAll("a,button")].filter(visible).filter(e=>/^(次へ|次のページ|Next|次の\d+件)$/i.test(clean(e.innerText))).map(describe)};
  });
  console.log("DOM_SNAPSHOT "+label+" "+JSON.stringify({url:page.url(),...structure}));
}
async function main(){
  const {browser,context}=await openBrowser();
  try{
    const page=await context.newPage();
    const url="https://noa.audee.jp/search/view/au/";
    const date=jstDates(2)[1];
    context.on("page",p=>console.log("NEW_PAGE",p.url()));
    await openPage(page,url);
    await snapshot(page,"before");
    // Reuse the production collector unchanged. Observe actual clicks and navigation.
    await page.exposeFunction("radioDebugClick",v=>console.log("CLICK",JSON.stringify(v)));
    await page.addInitScript(()=>document.addEventListener("click",e=>{
      const t=e.target.closest("a,button,input,[onclick],img")||e.target;
      window.radioDebugClick({tag:t.tagName,id:t.id,cls:typeof t.className==="string"?t.className:"",alt:t.getAttribute("alt"),target:t.getAttribute("target")}).catch(()=>{});
    },true));
    page.on("framenavigated",f=>{if(f===page.mainFrame())console.log("NAVIGATION",f.url());});
    page.on("response",r=>{if(r.request().resourceType()==="document")console.log("DOCUMENT",r.status(),r.url());});
    try{const r=await collect(page,{url},date);console.log("COLLECTOR_SUCCESS",r.fetched_count);}
    catch(e){console.log("COLLECTOR_ERROR",e.message);}
    await snapshot(page,"after");
    await page.waitForTimeout(5000);
    await snapshot(page,"after_5s");
    for(const p of context.pages())if(p!==page&&!p.isClosed()){await p.waitForLoadState("domcontentloaded",{timeout:10000}).catch(()=>{});await snapshot(p,"popup");}
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
