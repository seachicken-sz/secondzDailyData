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
 case "tokyo_fm":return stations[id]+"?date="+compact;
 case "nack5":return stations[id]+compact+".html";
 case "date_fm":return stations[id]+"#"+compact;
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
// Candidate extraction only: retain evidence and report uncertainty instead of treating
// inferred rows or weekly schedules as verified broadcast-date data.
async function extract(page,id,date){
 return page.evaluate(({id,date})=>{
  const clean=s=>String(s||"").normalize("NFKC").replace(/\s+/g," ").trim();
  const vis=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden";
  const shape=e=>e?{tag:e.tagName,id:e.id,cls:typeof e.className==="string"?e.className:""}:null;
  const selectors={
   tokyo_fm:".table_inner",
   fm_osaka:".timetable-week .day .program",
   fm_fukuoka:"li.radiko",
   fm_niigata:".right-content",
   date_fm:".timetable_item",
   fm_aichi: "table tr",
   kiss_fm:".timetable tr",
   e_radio:"section table tr",
   kmix:".tableBtn",
   tokai_radio:"p.time",
   fm_yokohama:".program-wrap #result tr",
   nack5:".program-item-header, .program-column-first",
   alpha_station:".timetable-content-item"
  };
  const timeRx=/(?:[0-2]?\d|30):[0-5]\d/g;
  const linkInfo=a=>{try{
   const u=new URL(a.href,location.href);if(u.hostname!=="radiko.jp")return null;
   const m=u.hash.match(/^#!\/ts\/([^/]+)\/(\d{14})$/);
   const sid=u.searchParams.get("sid")||m?.[1],t=u.searchParams.get("t")||m?.[2];
   return sid&&/^\d{14}$/.test(t||"")?{sid,t,url:u.href}:null;
  }catch{return null;}};
  const selected=[...document.querySelectorAll(".active,.selected,.current,[aria-selected=true],[aria-current],input:checked")].filter(e=>vis(e)||e.matches("input:checked")).map(e=>({text:clean(e.innerText||e.labels?.[0]?.innerText).slice(0,70),...shape(e)})).filter(e=>/\d{1,4}[./月-]\d{1,2}|^\d{8}$/.test(e.text)).slice(0,20);
  const roots=[...document.querySelectorAll(selectors[id]||"body")].filter(vis);
  const candidates=[];
  for(const raw of roots){
   let e=raw;
   if(id==="tokai_radio")e=raw.parentElement;
   if(id==="fm_fukuoka")e=raw.closest("ul")?.parentElement||raw;
   if(id==="nack5")e=raw.parentElement;
   if(e.closest(".tt_corner,.corner,.corners,.corner-pro,.program-corner,.programDetail"))continue;
   if(id==="kiss_fm"&&!raw.querySelector(":scope > td.time"))continue;
   if(id==="fm_yokohama"&&!raw.querySelector("td.title a"))continue;
   const timeNodes=[...e.querySelectorAll(":scope > .time,:scope > .program-start,:scope > .program-end,:scope > td.time,:scope > th,:scope > .program-head .time,:scope > .content > .time,:scope > .program-on-air-time,:scope > .program-time")].filter(vis);
   if(id==="tokai_radio")timeNodes.push(raw);
   const timeTexts=timeNodes.map(n=>clean(n.innerText));
   const ownLinks=[...e.querySelectorAll("a[href]")].filter(vis).map(linkInfo).filter(Boolean);
   const titleNodes=[...e.querySelectorAll("h2,h3,h4,.program-title,.program-name,.program_title,.program_name,.title,.p_title,td.title,.programTitle")].filter(vis).filter(n=>!n.closest(".tt_corner,.corner,.corners,.corner-pro,.program-corner,.programDetail"));
   const titles=[...new Set(titleNodes.map(n=>clean(n.innerText)).filter(Boolean))].slice(0,5);
   const leaves=[...e.querySelectorAll("*")].filter(n=>n.children.length===0&&vis(n)&&!n.closest(".tt_corner,.corner,.corners,.corner-pro,.program-corner,.programDetail")).map(n=>({text:clean(n.innerText).slice(0,100),...shape(n)})).filter(n=>n.text).slice(0,18);
   const times=timeTexts.flatMap(t=>t.match(timeRx)||[]);
   if(!times.length&&!ownLinks.length&&!leaves.some(n=>/^\d{1,2}:\d{2}/.test(n.text)))continue;
   candidates.push({shape:shape(e),parent:shape(e.parentElement),timeTexts,times,titles,links:[...new Map(ownLinks.map(x=>[x.url,x])).values()],leaves,children:[...e.children].slice(0,10).map(shape)});
  }
  // Deduplicate identical DOM candidates; do not deduplicate by title alone.
  const rows=[...new Map(candidates.map(c=>[JSON.stringify(c),c])).values()].slice(0,150);
  const radios=[...document.querySelectorAll("input[type=radio],.timetable-nav-item")].map(e=>({shape:shape(e),text:clean(e.innerText||e.labels?.[0]?.innerText).slice(0,80),checked:e.checked,visible:vis(e)})).slice(0,40);
  const anchorEvidence=[...document.querySelectorAll("a[href]")].filter(vis).map(a=>({link:linkInfo(a),chain:[shape(a.parentElement),shape(a.parentElement?.parentElement),shape(a.parentElement?.parentElement?.parentElement),shape(a.parentElement?.parentElement?.parentElement?.parentElement)]})).filter(x=>x.link).slice(0,80);
  const minute=s=>{const m=String(s||"").match(/^(\d{1,2}):([0-5]\d)$/);return m&&+m[1]<=29?+m[1]*60+ +m[2]:null;};
  const candidateSlots=rows.flatMap(r=>{
   if(r.times.length!==2||r.titles.length!==1)return [];
   let start=minute(r.times[0]),end=minute(r.times[1]);
   if(start===null||end===null)return [];
   if(id!=="fm_yokohama"&&start<300)start+=1440;
   if(end<start)end+=1440;
   if(end<=start||end>1740)return [];
   return [{name:r.titles[0],start,end,radiko:r.links.length===1?r.links[0]:null}];
  });
  const sorted=[...candidateSlots].sort((a,b)=>a.start-b.start||b.end-a.end);
  let cursor=id==="fm_yokohama"?0:300;const gaps=[],overlaps=[];
  for(const r of sorted){if(r.start>cursor)gaps.push([cursor,r.start]);if(r.start<cursor)overlaps.push([r.start,Math.min(cursor,r.end),r.name]);cursor=Math.max(cursor,r.end);}
  const limit=id==="fm_yokohama"?1440:1740;if(cursor<limit)gaps.push([cursor,limit]);
  return {requestedDate:date,selected,radios,rootCount:roots.length,candidateCount:rows.length,candidateSlots:sorted,gaps,overlaps,anchorEvidence,rows,classification:"diagnostic_only"};
 },{id,date});
}
async function reportExtraction(page,id,label,date){
 const evidence=await extract(page,id,date);
 console.log("OFFICIAL_PROGRAM_CANDIDATES",id,label,JSON.stringify(evidence));
 return {candidateCount:evidence.candidateCount,slotCount:evidence.candidateSlots.length,gaps:evidence.gaps.length,overlaps:evidence.overlaps.length};
}
async function visit(page,id,label,url,date){
 const r=await page.goto(url,{waitUntil:"domcontentloaded",timeout:35000});
 console.log("OFFICIAL_NAV",id,label,r?.status(),page.url());
 if(!r?.ok())throw Error("HTTP "+r?.status());
 if(new URL(page.url()).hostname.replace(/^www\./,"")!==new URL(url).hostname.replace(/^www\./,""))throw Error("Unexpected host");
 await page.waitForTimeout(4000);
 const a=await snapshot(page);
 await page.waitForTimeout(2000);
 const b=await snapshot(page);
 console.log("OFFICIAL_DOM",id,label,JSON.stringify({...b,initialTimeCount:a.timeCount,requestedUrl:url}));
 const extraction=await reportExtraction(page,id,label,date);
 return {label,status:"inspected",timeCount:b.timeCount,radikoCount:b.radikoCount,dateLabels:b.dates.map(d=>d.text).slice(0,25),stable:a.timeCount===b.timeCount,...extraction};
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
   const plans=[["base",stations[id],today]];
   for(const [label,d] of [["yesterday",yesterday],["today",today],["tomorrow",tomorrow]]){const url=datedUrl(id,d);if(url&&!(id==="date_fm"&&label==="yesterday"))plans.push([label,url,d]);}
   if(id==="e_radio")plans.push(["schedule","https://www.e-radio.co.jp/timetable/",today]);
   if(id==="fm_aichi")plans.push(["weekday","https://fma.co.jp/pc/01pro/tt/?p="+(new Date(yesterday+"T00:00:00Z").getUTCDay()||7),yesterday]);
   if(id==="alpha_station")plans.push(["weekly","https://fm-kyoto.jp/timetable_weekly/",null]);
   let blocked=false;
   for(const [label,url,date] of plans){
    const page=await context.newPage();
    try{checks.push(await visit(page,id,label,url,date));}
    catch(e){const error=String(e.message).slice(0,300);checks.push({label,status:"error",error});if(/HTTP (401|403|429)/.test(error)){blocked=true;break;}}
    finally{await page.close();await new Promise(r=>setTimeout(r,4000));}
   }
   if(!blocked&&["fm_osaka","alpha_station","fm_yokohama","tokai_radio"].includes(id)){
    const page=await context.newPage();
    try{
     if(id==="fm_yokohama"){
      await page.goto("https://www.fmyokohama.co.jp/songsearch/program-form.html",{waitUntil:"domcontentloaded",timeout:35000});
      const [y,m,day]=yesterday.split("-");
      for(const [selector,v] of [["#ReqYear",y],["#ReqMon",m],["#ReqDay",day]])await page.locator(selector).filter({visible:true}).selectOption(v,{timeout:10000});
      await page.locator(".program-wrap .program-sort-btn a").filter({visible:true,hasText:/^次へ$/}).click({timeout:10000});
     }else{
      const response=await page.goto(stations[id],{waitUntil:"domcontentloaded",timeout:35000});
      if(!response?.ok())throw Error("HTTP "+response?.status());
      await page.waitForTimeout(4000);
      const target=id==="alpha_station"?tomorrow:yesterday;
      const [,m,day]=target.split("-");
      const label=String(Number(m))+"/"+String(Number(day));
      let control;
      if(id==="fm_osaka")control=page.locator("label").filter({visible:true,has:page.locator(".date").filter({hasText:new RegExp("^"+label+"$")})});
      if(id==="alpha_station")control=page.locator(".timetable-nav-item").filter({visible:true,has:page.locator(".timetable-nav-item-date").filter({hasText:new RegExp("^"+label+"$")})});
      if(id==="tokai_radio"){
       const weekday=["SUN","MON","TUE","WED","THU","FRI","SAT"][new Date(yesterday+"T00:00:00Z").getUTCDay()];
       control=page.locator("a.fontEn").filter({visible:true,hasText:new RegExp("^"+weekday+"$")});
      }
      if(!control||await control.count()!==1)throw Error("Date control not unique");
      await control.click({timeout:10000});
     }
     await page.waitForTimeout(6000);
     const date=id==="alpha_station"?tomorrow:yesterday;
     const snap=await snapshot(page);
     console.log("OFFICIAL_DOM",id,"date_ui",JSON.stringify(snap));
     checks.push({label:"date_ui",status:"inspected",...await reportExtraction(page,id,"date_ui",date)});
    }catch(e){checks.push({label:"date_ui",status:"error",error:String(e.message).slice(0,300)});}
    finally{await page.close();await new Promise(r=>setTimeout(r,4000));}
   }
   results.push({id,checks});
  }
 }finally{await browser.close();}
 console.log("OFFICIAL_SCHEDULE_SUMMARY",JSON.stringify({today,yesterday,tomorrow,results}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
