"use strict";
const {openBrowser}=require("./common/browser");
const {jstDates}=require("./common/datetime");
// Candidate IDs to verify against public station names and links.
const stations={
  tokyo_fm:["FMT","JP13","TOKYO FM"],
  fm_osaka:["FMO","JP27","FM大阪"],
  fm_fukuoka:["FMFUKUOKA","JP40","FM FUKUOKA"],
  fm_niigata:["FMNIIGATA","JP15","FM NIIGATA"],
  date_fm:["DATEFM","JP4","Date fm"],
  fm_aichi:["FMAICHI","JP23","FM AICHI"],
  kiss_fm:["KISSFMKOBE","JP28","Kiss FM KOBE"],
  e_radio:["E-RADIO","JP25","e-radio"],
  kmix:["K-MIX","JP22","K-MIX"],
  tokai_radio:["TOKAIRADIO","JP23","TOKAI RADIO"],
  nack5:["NACK5","JP11","NACK5"],
  alpha_station:["ALPHA-STATION","JP26","α-STATION"],
  fm_yokohama:["YFM","JP14","FMヨコハマ"]
};
async function inspect(page,stage,id){
  const data=await page.evaluate(()=>{
    const clean=s=>String(s||"").normalize("NFKC").replace(/\s+/g," ").trim();
    const visible=e=>!!e.getClientRects().length;
    const shape=e=>({tag:e.tagName,id:e.id,cls:typeof e.className==="string"?e.className:""});
    const time=/\b(?:[0-2]?\d):[0-5]\d\s*(?:[-~〜～–－])\s*(?:[0-2]?\d):[0-5]\d\b/;
    const date=/(?:\d{4}[年/.-])?\d{1,2}[月/.-]\d{1,2}日?/;
    const leaves=[...document.querySelectorAll("body *")].filter(e=>e.children.length===0&&visible(e));
    const slots=leaves.filter(e=>time.test(clean(e.innerText)));
    const sample=slots.slice(0,4).map(e=>{
      const chain=[];let p=e;
      for(let i=0;p&&i<5;i++,p=p.parentElement){
        chain.push({...shape(p),children:[...p.children].slice(0,10).map(c=>({...shape(c),textLength:clean(c.innerText).length}))});
      }
      return {time:clean(e.innerText).match(time)?.[0],chain};
    });
    const links=[...document.querySelectorAll("a[href]")].map(e=>({e,u:new URL(e.href,location.href)})).filter(x=>x.u.origin===location.origin);
    const listen=links.filter(({u})=>/^\/(?:share\/?|ts\/|mobile\/events\/|mobile\/programs\/)/.test(u.pathname));
    const linkShapes=listen.slice(0,8).map(({e,u})=>({path:u.pathname,params:Object.fromEntries([...u.searchParams].filter(([k])=>["sid","t","station_id","date","ft","to"].includes(k))),...shape(e),parent:shape(e.parentElement),range:clean(e.innerText).match(time)?.[0],date:clean(e.innerText).match(date)?.[0]}));
    const dates=leaves.filter(e=>date.test(clean(e.innerText))&&clean(e.innerText).length<=40).slice(0,80).map(e=>({text:clean(e.innerText),...shape(e),parent:shape(e.parentElement)}));
    const controls=[...document.querySelectorAll("select,input[type=date],button,a,[role=button],[role=tab]")].filter(visible).filter(e=>e.matches("select,input[type=date]")||/^(今日|昨日|明日|前日|翌日|前へ|次へ|過去|未来)$/.test(clean(e.innerText))||date.test(clean(e.innerText))&&clean(e.innerText).length<=25).slice(0,50).map(e=>({...shape(e),text:clean(e.innerText).slice(0,50),value:e.matches("select,input[type=date]")?e.value:undefined,options:e.matches("select")?[...e.options].slice(0,20).map(o=>({value:o.value,label:clean(o.textContent)})):undefined}));
    const dayLinks=links.filter(({u})=>u.pathname.includes("timetable")||u.pathname.startsWith("/index/")).filter(({e})=>visible(e)).slice(0,80).map(({e,u})=>({label:clean(e.innerText).slice(0,50),path:u.pathname,params:Object.fromEntries([...u.searchParams].filter(([k])=>["station_id","date","day","area_id"].includes(k)))}));
    const groups=[...new Set(dates.map(d=>d.text))];
    return {title:document.title,headings:[...document.querySelectorAll("h1,h2,h3")].filter(visible).slice(0,8).map(e=>({...shape(e),text:clean(e.innerText).slice(0,80)})),timeCount:slots.length,slotSample:sample,dateLabels:groups,dates:dates.slice(0,15),listenLinkCount:listen.length,listenLinkSamples:linkShapes,controls,dayLinks,bodyLength:clean(document.body?.innerText).length};
  });
  console.log("SCHEDULE_DOM",id,stage,JSON.stringify(data));
  return data;
}
async function visit(page,url,id,stage){
  const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:35000});
  const status=response?.status();
  console.log("NAVIGATION",id,stage,status,page.url().split("?")[0]);
  if(!response?.ok())throw Error("HTTP "+status);
  if(new URL(page.url()).origin!=="https://radiko.jp")throw Error("Unexpected origin");
  await page.waitForTimeout(4000);
  return inspect(page,stage,id);
}
async function main(){
  const selected=process.argv[2]||"sample";
  const ids=selected==="sample"?["tokyo_fm"]:selected==="all"?Object.keys(stations):[selected];
  if(ids.some(id=>!Object.hasOwn(stations,id)))throw Error("Unknown station");
  const {browser}=await openBrowser();
  const results=[];
  let blocked=false;
  try{
    for(const id of ids){
      if(blocked)break;
      const [sid,area,name]=stations[id];
      const context=await browser.newContext({locale:"ja-JP",timezoneId:"Asia/Tokyo"});
      const page=await context.newPage();
      const today=jstDates(1)[0];
      console.log("STATION_CANDIDATE",JSON.stringify({id,sid,area,name,today,yesterday:jstDates(2)[1],tomorrow:new Date(Date.parse(today+"T00:00:00Z")+86400000).toISOString().slice(0,10)}));
      const checks=[];
      const urls=selected==="sample"?[["desktop","https://radiko.jp/index/"+sid+"/"],["mobile","https://radiko.jp/mobile/timetable/"+area+"?station_id="+encodeURIComponent(sid)]]:[["mobile","https://radiko.jp/mobile/timetable/"+area+"?station_id="+encodeURIComponent(sid)]];
      try{
        for(const [stage,url] of urls){
          try{
            const a=await visit(page,url,id,stage);
            await page.waitForTimeout(3000);
            const b=await inspect(page,stage+"_settled",id);
            checks.push({stage,status:"inspected",timeCount:a.timeCount,settledTimeCount:b.timeCount,listenLinkCount:b.listenLinkCount,title:b.title});
          }catch(e){
            const error=String(e.message).slice(0,300);
            checks.push({stage,status:"error",error});
            if(/HTTP (401|403|429)/.test(error)){blocked=true;break;}
          }
          await page.waitForTimeout(4000);
        }
      }finally{await context.close();}
      results.push({id,checks});
    }
  }finally{await browser.close();}
  console.log("SCHEDULE_DEBUG_SUMMARY",JSON.stringify({blocked,results}));
  if(blocked||results.some(r=>r.checks.some(c=>c.status==="error")))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
