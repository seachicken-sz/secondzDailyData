"use strict";
const {openBrowser}=require("./common/browser");
const {jstDates}=require("./common/datetime");
const stations={
 tokyo_fm:"https://www.tfm.co.jp/timetable/",
 fm_osaka:"https://www.fmosaka.net/timetable",
 fm_fukuoka:"https://www.fmfukuoka.co.jp/timetable/",
 fm_niigata:"https://www.fmniigata.com/timetable/",
 date_fm:"https://datefm.jp/timetable/",
 fm_aichi:"https://fma.co.jp/pc/01pro/tt/",
 kiss_fm:"https://www.kiss-fm.co.jp/timetable/",
 e_radio:"https://www.e-radio.co.jp/timetabledetail/",
 kmix:"https://k-mix.co.jp/program",
 tokai_radio:"https://www.tokairadio.co.jp/timetable/",
 fm_yokohama:"https://www.fmyokohama.co.jp/timetable",
 nack5:"https://www.nack5.co.jp/timetable/",
 alpha_station:"https://fm-kyoto.jp/timetable"
};
function datedUrl(id,d){
 const compact=d.replace(/-/g,"");
 switch(id){
 case "fm_fukuoka":return stations[id]+"index.php?ymd="+compact;
 case "fm_niigata":return stations[id]+compact;
 case "kiss_fm":return stations[id]+d+"/";
 case "kmix":return stations[id]+"?date="+d;
 default:return null;
 }
}
async function snapshot(page){
 return page.evaluate(()=>{
  const clean=s=>String(s||"").normalize("NFKC").replace(/\s+/g," ").trim();
  const vis=e=>!!e.getClientRects().length;
  const shape=e=>e?{tag:e.tagName,id:e.id,cls:typeof e.className==="string"?e.className:""}:null;
  const range=/^(?:[0-2]?\d|30):[0-5]\d\s*[-~〜～–－]\s*(?:[0-2]?\d|30):[0-5]\d$/;
  const start=/^(?:[0-2]?\d|30):[0-5]\d$/;
  const day=/^(?:(?:20\d{2}[年/.-])?\d{1,2}[月/.-]\d{1,2}日?(?:\s*[（(]?[月火水木金土日A-Za-z]+[）)]?)?|[月火水木金土日](?:曜(?:日)?)?|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?|今日|昨日|明日|前日|翌日|前へ|次へ|Daily|Weekly)$/i;
  const all=[...document.querySelectorAll("body *")].filter(vis);
  const leaves=all.filter(e=>e.children.length===0);
  const times=leaves.filter(e=>range.test(clean(e.innerText))||start.test(clean(e.innerText)));
  function sample(e){
   const chain=[];let p=e;
   for(let i=0;p&&i<5;i++,p=p.parentElement){
    chain.push({...shape(p),children:[...p.children].slice(0,8).map(c=>({...shape(c),textLength:clean(c.innerText).length,span:c.matches("td,th")?{row:c.rowSpan,col:c.colSpan}:undefined}))});
   }
   return {time:clean(e.innerText),chain};
  }
  const safeLink=e=>{
   try{const u=new URL(e.href,location.href);if(!/^https?:$/.test(u.protocol))return null;return {host:u.hostname,path:u.pathname,params:Object.fromEntries([...u.searchParams].filter(([k,v])=>/^(?:sid|t|ft|to|date|ymd|day|p|station_id)$/i.test(k)&&v.length<=40)),hash:u.hash.slice(0,80)};}catch{return null;}
  };
  const links=[...document.querySelectorAll("a[href]")].filter(vis).map(e=>({e,url:safeLink(e)})).filter(x=>x.url);
  const radiko=links.filter(x=>/(^|\.)radiko\.jp$/.test(x.url.host));
  const dates=leaves.filter(e=>day.test(clean(e.innerText))).slice(0,100).map(e=>({text:clean(e.innerText),...shape(e),parent:shape(e.parentElement),selected:e.closest("[aria-selected=true],[aria-current],.active,.selected,.current")?true:false}));
  const controls=all.filter(e=>e.matches("select,input[type=date],button,a,[role=tab],[role=button]")&&(e.matches("select,input[type=date]")||day.test(clean(e.innerText)))).slice(0,100).map(e=>({...shape(e),text:clean(e.innerText).slice(0,40),href:e.matches("a")?safeLink(e):undefined,value:e.matches("select,input[type=date]")?e.value:undefined,options:e.matches("select")?[...e.options].slice(0,20).map(o=>({value:o.value,label:clean(o.textContent)})):undefined}));
  const programLinks=links.filter(x=>/timetable|program|schedule/i.test(x.url.path)).slice(0,25).map(x=>({label:clean(x.e.innerText).slice(0,40),url:x.url}));
  const timeGroups={};for(const e of times){const key=[shape(e),shape(e.parentElement),shape(e.parentElement?.parentElement)].map(x=>x?x.tag+"."+x.cls:"").join(" > ");timeGroups[key]=(timeGroups[key]||0)+1;}
  return {title:document.title,headings:all.filter(e=>e.matches("h1,h2,h3")).slice(0,8).map(e=>({...shape(e),text:clean(e.innerText).slice(0,60)})),dates,controls,timeCount:times.length,timeGroups,firstTimes:times.slice(0,4).map(sample),lastTimes:times.slice(-2).map(e=>clean(e.innerText)),radikoCount:radiko.length,radikoSamples:radiko.slice(0,6).map(x=>({label:clean(x.e.innerText).slice(0,40),url:x.url,parent:shape(x.e.parentElement),grandparent:shape(x.e.parentElement?.parentElement)})),programLinks,tables:all.filter(e=>e.matches("table")).slice(0,8).map(e=>({...shape(e),rows:e.rows.length,spans:[...e.querySelectorAll("td[rowspan],td[colspan]")].length})),bodyLength:clean(document.body.innerText).length};
 });
}
async function visit(page,id,label,url){
 const r=await page.goto(url,{waitUntil:"domcontentloaded",timeout:35000});
 console.log("OFFICIAL_NAV",id,label,r?.status(),page.url());
 if(!r?.ok())throw Error("HTTP "+r?.status());
 if(new URL(page.url()).hostname.replace(/^www\./,"")!==new URL(url).hostname.replace(/^www\./,""))throw Error("Unexpected host");
 await page.waitForTimeout(4000);
 const a=await snapshot(page);
 await page.waitForTimeout(2000);
 const b=await snapshot(page);
 console.log("OFFICIAL_DOM",id,label,JSON.stringify({...b,initialTimeCount:a.timeCount,requestedUrl:url}));
 return {label,status:"inspected",timeCount:b.timeCount,radikoCount:b.radikoCount,dateLabels:b.dates.map(d=>d.text).slice(0,25),stable:a.timeCount===b.timeCount};
}
async function main(){
 const selected=process.argv[2]||"all";
 const ids=selected==="all"?Object.keys(stations):[selected];
 if(ids.some(id=>!Object.hasOwn(stations,id)))throw Error("Unknown station");
 const {browser,context}=await openBrowser();
 const today=jstDates(1)[0],yesterday=jstDates(2)[1],tomorrow=new Date(Date.parse(today+"T00:00:00Z")+86400000).toISOString().slice(0,10);
 const results=[];
 try{
  for(const id of ids){
   const checks=[];
   const plans=[["base",stations[id]]];
   for(const [label,d] of [["yesterday",yesterday],["today",today],["tomorrow",tomorrow]]){const url=datedUrl(id,d);if(url)plans.push([label,url]);}
   if(id==="alpha_station")plans.push(["weekly","https://fm-kyoto.jp/timetable_weekly/"]);
   for(const [label,url] of plans){
    const page=await context.newPage();
    try{checks.push(await visit(page,id,label,url));}
    catch(e){const error=String(e.message).slice(0,300);checks.push({label,status:"error",error});if(/HTTP (401|403|429)/.test(error))break;}
    finally{await page.close();await new Promise(r=>setTimeout(r,4000));}
   }
   results.push({id,checks});
  }
 }finally{await browser.close();}
 console.log("OFFICIAL_SCHEDULE_SUMMARY",JSON.stringify({today,yesterday,tomorrow,results}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
