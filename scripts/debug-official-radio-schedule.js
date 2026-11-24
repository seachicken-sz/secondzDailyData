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
   tokyo_fm:".table_program",
   fm_osaka:".timetable-week .day .program",
   fm_fukuoka:"li.radiko",
   fm_niigata:".timetable-item",
   date_fm:".timetable_item",
   fm_aichi: "table tr:has(> th):has(> td)",
   kiss_fm:".timetable tr",
   e_radio:"section table tr",
   kmix:".tableProgram",
   tokai_radio:"p.time",
   fm_yokohama:".program-wrap #result tr, .program:has(> .program-head .time)",
   nack5:".program-item",
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
   if(e.closest(".tt_corner,.corner,.corners,.corner-pro,.program-corner,.programDetail"))continue;
   if(id==="kiss_fm"&&!raw.querySelector(":scope > td.time"))continue;
   if(id==="fm_yokohama"&&raw.matches("tr")&&!raw.querySelector("td.title a"))continue;
   const timeNodes=[...e.querySelectorAll(":scope > .time,:scope > .program-start,:scope > .program-end,:scope > td.time,:scope > th,:scope > .program-head .time,:scope > .content > .time,:scope > .program-on-air-time,:scope > .program-time")].filter(vis);
   const exactTime={tokyo_fm:":scope > .table_time",kmix:":scope > .tableProgram__time",fm_niigata:":scope > .date",fm_fukuoka:":scope > .time",nack5:":scope > .program-item-header .program-on-air-time"};
   if(exactTime[id]){timeNodes.length=0;timeNodes.push(...e.querySelectorAll(exactTime[id]));}
   if(id==="tokai_radio"){timeNodes.length=0;timeNodes.push(raw);}
   if(id==="fm_fukuoka"&&!timeNodes.length)timeNodes.push(raw.querySelector(".time")||raw);
   if(id==="nack5"&&!timeNodes.length){
    const more=[...e.querySelectorAll("[class*='time' i],[class*='start' i],[class*='end' i]")].filter(vis).filter(n=>!n.closest(".tt_corner,.corner,.corners,.corner-pro,.program-corner,.programDetail,.table_sub")&&/^(?:[0-2]?\d):[0-5]\d(?:\s*[-~〜～–]?\s*(?:[0-2]?\d):[0-5]\d)?$/.test(clean(n.innerText)));
    const smallest=more.filter(n=>!more.some(m=>m!==n&&n.contains(m)&&clean(m.innerText)===clean(n.innerText)));
    timeNodes.push(...smallest);
   }
   const timeTexts=[...new Set(timeNodes.map(n=>clean(n.innerText)))];
   const ownLinks=[...e.querySelectorAll("a[href]")].filter(vis).map(linkInfo).filter(Boolean);
   const titleSelector=({tokyo_fm:":scope > .table_main > .table_ttl",kmix:":scope > .tableProgram__Main > .tableTtl .programTitle, :scope > .tableProgram__Main > .tableTtl h2, :scope > .tableProgram__Main > .tableTtl h3",fm_niigata:":scope > .right-content .title",fm_fukuoka:":scope > .program > .p_title",kiss_fm:".pg_name",fm_aichi:".main_color",tokai_radio:":scope > .ttDtl h2",nack5:":scope > .program-item-body:not(.program-insert) .program-title, :scope > .program-item-body:not(.program-insert) .program-name, :scope > .program-item-body:not(.program-insert) h2, :scope > .program-item-body:not(.program-insert) .title"}[id])||"h2,h3,h4,.program-title,.program-name,.program_title,.program_name,.title,.p_title,td.title,.programTitle,[class*='programName'],[class*='programTitle'],[class*='table_title'],[class*='tableTitle']";
   const titleNodes=[...e.querySelectorAll(titleSelector)].filter(vis).filter(n=>!n.closest(".tt_corner,.corner,.corners,.corner-pro,.program-corner,.programDetail"));
   let titles=[...new Set(titleNodes.map(n=>clean(n.innerText)).filter(Boolean))].slice(0,5);
   if(id==="tokai_radio"&&titles.length)titles=titles.slice(0,1);
   if(id==="fm_yokohama"&&!e.matches("tr")){
    const h=e.querySelector(":scope > .program-head");
    titles=h?[...new Set([...h.querySelectorAll("h2,h3,h4,.title,.program-title,.program-name")].map(n=>clean(n.innerText)).filter(Boolean))]:[];
   }
   if(id==="e_radio"){
    const cell=e.querySelector(":scope > td");
    const name=cell?clean([...cell.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(" ")):"";
    titles=name?[name]:[];
   }
   const leaves=[...e.querySelectorAll("*")].filter(n=>n.children.length===0&&vis(n)&&!n.closest(".tt_corner,.corner,.corners,.corner-pro,.program-corner,.programDetail")).map(n=>({text:clean(n.innerText).slice(0,100),...shape(n)})).filter(n=>n.text).slice(0,18);
   const times=timeTexts.flatMap(t=>t.match(timeRx)||[]);
   if(!times.length&&!ownLinks.length&&!leaves.some(n=>/^\d{1,2}:\d{2}/.test(n.text)))continue;
   candidates.push({shape:shape(e),parent:shape(e.parentElement),timeTexts,times,titles,links:[...new Map(ownLinks.map(x=>[x.url,x])).values()],leaves,children:[...e.children].slice(0,10).map(shape)});
  }
  // Deduplicate identical DOM candidates; do not deduplicate by title alone.
  const rows=[...new Map(candidates.map(c=>[JSON.stringify(c),c])).values()].slice(0,150);
  const describe=n=>({...shape(n),text:clean(n.innerText).slice(0,160),directText:clean([...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent).join(" ")).slice(0,100),visible:vis(n),children:[...n.children].slice(0,12).map(c=>({...shape(c),text:clean(c.innerText).slice(0,100),visible:vis(c)}))});
  const hierarchy=n=>{const chain=[];for(let j=0;n&&j<7;j++,n=n.parentElement)chain.push(describe(n));return chain;};
  const detailEvidence=roots.slice(0,3).map(hierarchy);
  const structureEvidence=["tokai_radio","nack5","fm_yokohama"].includes(id)?roots.slice(0,4).map(root=>{
   const r=id==="tokai_radio"?root.parentElement:root;
   return {root:shape(r),nodes:[...r.querySelectorAll("h1,h2,h3,h4,[class*='title' i],[class*='name' i],.program-head,.ttDtl,.program-item-body")].slice(0,35).map(n=>({shape:shape(n),parent:shape(n.parentElement),text:clean(n.innerText).slice(0,120)}))};
  }):[];
  const weeklyEvidence=id==="e_radio"?[...document.querySelectorAll("body *")].filter(n=>n.children.length===0&&/^\d{1,2}:\d{2}\s*[-~〜～–]\s*\d{1,2}:\d{2}$/.test(clean(n.textContent))).slice(0,120).map(n=>{
   let p=n;const chain=[];for(let i=0;p&&i<5;i++,p=p.parentElement)chain.push({shape:shape(p),text:clean(p.innerText||p.textContent).slice(0,220),children:[...p.children].slice(0,10).map(c=>({shape:shape(c),text:clean(c.innerText||c.textContent).slice(0,120)}))});
   return {time:clean(n.textContent),visible:vis(n),chain};
  }):[];
  const linkHierarchy=[...document.querySelectorAll("a[href]")].filter(vis).filter(a=>linkInfo(a)).slice(0,3).map(hierarchy);
  const dateEvidence={
   url:location.href,
   formDate:["ReqYear","ReqMon","ReqDay"].map(k=>document.getElementById(k)?.value||"").join("-"),
   activeControls:[...document.querySelectorAll("a.active,a.-active,li.active,li.current,[aria-selected=true],input:checked")].filter(n=>vis(n)||n.matches("input:checked")).map(n=>({shape:shape(n),text:clean(n.innerText||n.labels?.[0]?.innerText).slice(0,80),href:n.matches("a")?n.getAttribute("href"):undefined})).filter(x=>/\d{1,2}[./月-]\d{1,2}|MON|TUE|WED|THU|FRI|SAT|SUN|曜日/i.test(x.text)).slice(0,30),
   timetableSections:[...document.querySelectorAll("[id*='2026'],[data-date],.timetable-contents,.timetable-content,.timetable-week,.timetable_item")].slice(0,12).map(n=>({shape:shape(n),date:n.getAttribute("data-date"),visible:vis(n)}))
  };
  const detailed=["fm_aichi","e_radio"].includes(id);
  const tableEvidence=[...document.querySelectorAll("table")].filter(t=>detailed||vis(t)).slice(0,detailed?25:10).map(t=>({shape:shape(t),parent:shape(t.parentElement),visible:vis(t),rowCount:t.rows.length,rows:[...t.rows].slice(0,detailed?100:8).map(r=>({visible:vis(r),cells:[...r.cells].map(c=>({shape:shape(c),text:clean(c.innerText||c.textContent).slice(0,180),rowSpan:c.rowSpan,colSpan:c.colSpan,children:[...c.children].slice(0,8).map(x=>({...shape(x),text:clean(x.innerText||x.textContent).slice(0,100)}))}))}))}));
  const dateControls=[...document.querySelectorAll("a,button,input,select,[role=tab]")].filter(n=>vis(n)&&(/曜日|前日|翌日|昨日|明日|今日|次へ|前へ|\d{1,2}[./月]\d{1,2}|MON|TUE|WED|THU|FRI|SAT|SUN/i.test(clean(n.innerText||n.value))||n.matches("select,input[type=radio]"))).slice(0,60).map(n=>({...shape(n),text:clean(n.innerText||n.value).slice(0,80),href:n.getAttribute("href"),target:n.getAttribute("data-target"),controls:n.getAttribute("aria-controls")}));
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
   const radiko=r.links.length===1?r.links[0]:null;
   let startAt=null,endAt=null,radikoTimeMatches=null;
   if(date){
    const base=Date.parse(date+"T00:00:00+09:00");
    const iso=m=>new Date(base+m*60000+9*3600000).toISOString().slice(0,19)+"+09:00";
    startAt=iso(start);endAt=iso(end);
    if(radiko){
     const t=radiko.t,m=t.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
     const rt=m&&+m[4]<=29&&+m[5]<60&&+m[6]<60?Date.parse(m[1]+"-"+m[2]+"-"+m[3]+"T00:00:00+09:00")+(+m[4]*3600+ +m[5]*60+ +m[6])*1000:NaN;
     radikoTimeMatches=rt===Date.parse(startAt);
    }
   }
   return [{name:r.titles[0],start,end,startAt,endAt,radiko,radikoTimeMatches,endSource:"explicit"}];
  });
  // Start-only tables are reported separately; the next start is not an observed end.
  const startOnly=rows.filter(r=>r.times.length===1&&r.titles.length===1).map(r=>({name:r.titles[0],start:minute(r.times[0]),radiko:r.links.length===1?r.links[0]:null})).filter(r=>r.start!==null).map(r=>({...r,start:id!=="fm_yokohama"&&r.start<300?r.start+1440:r.start}));
  const terminalAichi=id==="fm_aichi"&&rows.length===startOnly.length+1&&rows.at(-1)?.times[0]==="05:00"&&rows.at(-1)?.leaves.some(n=>/曜日の番組表/.test(n.text));
  const strictStartOrder=startOnly.every((r,i)=>i===0||r.start>startOnly[i-1].start);
  const completeStarts=["fm_fukuoka","fm_niigata","fm_aichi"].includes(id)&&startOnly.length>1&&startOnly[0].start===300&&strictStartOrder&&startOnly.at(-1).start<1740&&(rows.length===startOnly.length||terminalAichi)&&roots.length===rows.length;
  const inferredSlots=startOnly.map((r,i)=>{
   const end=startOnly[i+1]?.start??(completeStarts?1740:null);
   const base=date?Date.parse(date+"T00:00:00+09:00"):NaN;
   const iso=m=>Number.isFinite(base)&&m!==null?new Date(base+m*60000+9*3600000).toISOString().slice(0,19)+"+09:00":null;
   const t=r.radiko?.t,m=t?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
   const rt=m&&+m[4]<=29&&+m[5]<60&&+m[6]<60?Date.parse(m[1]+"-"+m[2]+"-"+m[3]+"T00:00:00+09:00")+(+m[4]*3600+ +m[5]*60+ +m[6])*1000:NaN;
   return {...r,end,startAt:iso(r.start),endAt:iso(end),radikoTimeMatches:r.radiko&&date?rt===base+r.start*60000:null,endSource:i===startOnly.length-1?(terminalAichi?"next_day_marker":completeStarts?"broadcast_day_boundary_assumed":"unknown"):"next_start_inferred"};
  });
  const inferenceValidation={strictStartOrder,completeStarts,terminalAichi,missingTitles:rows.length-startOnly.length,radikoMatched:inferredSlots.filter(r=>r.radikoTimeMatches===true).length,radikoMismatch:inferredSlots.filter(r=>r.radikoTimeMatches===false).length};
  const sorted=[...candidateSlots].sort((a,b)=>a.start-b.start||b.end-a.end);
  let cursor=id==="fm_yokohama"?0:300;const gaps=[],overlaps=[];
  for(const r of sorted){if(r.start>cursor)gaps.push([cursor,r.start]);if(r.start<cursor)overlaps.push([r.start,Math.min(cursor,r.end),r.name]);cursor=Math.max(cursor,r.end);}
  const limit=id==="fm_yokohama"?1440:1740;if(cursor<limit)gaps.push([cursor,limit]);
  return {requestedDate:date,selected,radios,dateEvidence,dateControls,rootCount:roots.length,candidateCount:rows.length,candidateSlots:sorted,inferredSlots,inferenceValidation,gaps,overlaps,anchorEvidence,rows,detailEvidence,linkHierarchy,tableEvidence,structureEvidence,weeklyEvidence,classification:"diagnostic_only"};
 },{id,date});
}
async function reportExtraction(page,id,label,date){
 const evidence=await extract(page,id,date);
 const {detailEvidence,linkHierarchy,tableEvidence,structureEvidence,weeklyEvidence,...compact}=evidence;
 console.log("OFFICIAL_PROGRAM_CANDIDATES",id,label,JSON.stringify(compact));
 // Separate hierarchy logs to keep each log line manageable.
 for(const [index,chain] of detailEvidence.entries())console.log("OFFICIAL_ROOT_HIERARCHY",id,label,index,JSON.stringify(chain));
 for(const [index,chain] of linkHierarchy.entries())console.log("OFFICIAL_LINK_HIERARCHY",id,label,index,JSON.stringify(chain));
 for(const [i,t] of tableEvidence.entries())console.log("OFFICIAL_TABLE_EVIDENCE",id,label,i,JSON.stringify(t));
 for(const [i,t] of structureEvidence.entries())console.log("OFFICIAL_TITLE_STRUCTURE",id,label,i,JSON.stringify(t));
 for(const [i,t] of weeklyEvidence.entries())console.log("E_RADIO_WEEKLY_STRUCTURE",label,i,JSON.stringify(t));
 console.log("OFFICIAL_INFERENCE_VALIDATION",id,label,JSON.stringify(evidence.inferenceValidation));
 return {candidateCount:evidence.candidateCount,slotCount:evidence.candidateSlots.length,inferredCount:evidence.inferredSlots.length,gaps:evidence.gaps.length,overlaps:evidence.overlaps.length,radikoMatched:evidence.candidateSlots.filter(r=>r.radikoTimeMatches===true).length,radikoMismatch:evidence.candidateSlots.filter(r=>r.radikoTimeMatches===false).length,inferenceValidation:evidence.inferenceValidation,weeklyEvidenceCount:weeklyEvidence.length,signature:JSON.stringify([...evidence.candidateSlots,...evidence.inferredSlots].map(r=>[r.name,r.start,r.end]))};
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
 const ids=selected==="all"?Object.keys(stations):selected==="remaining"?["fm_fukuoka","fm_niigata","fm_aichi","tokai_radio","nack5","fm_yokohama","e_radio"]:[selected];
 if(ids.some(id=>!Object.hasOwn(stations,id)))throw Error("Unknown station");
 const {browser,context}=await openBrowser();
 const today=jstDates(1)[0],yesterday=jstDates(2)[1],tomorrow=new Date(Date.parse(today+"T00:00:00Z")+86400000).toISOString().slice(0,10);
 const results=[];
 try{
  for(const id of ids){
   const checks=[];
   const plans=[["base",stations[id],today]];
   for(const [label,d] of [["yesterday",yesterday],["today",today],["tomorrow",tomorrow]]){const url=datedUrl(id,d);if(url&&!(id==="date_fm"&&label==="yesterday"))plans.push([label,url,d]);}
   if(id==="e_radio"){plans.length=0;plans.push(["weekly","https://www.e-radio.co.jp/timetable/",null],["remaining_today",stations[id],today]);}
   if(id==="fm_aichi")for(const [label,d] of [["weekday_yesterday",yesterday],["weekday_tomorrow",tomorrow]])plans.push([label,"https://fma.co.jp/pc/01pro/tt/?p="+(new Date(d+"T00:00:00Z").getUTCDay()||7),d]);
   if(id==="alpha_station")plans.push(["weekly","https://fm-kyoto.jp/timetable_weekly/",null]);
   let blocked=false;
   for(const [label,url,date] of plans){
    const page=await context.newPage();
    try{checks.push(await visit(page,id,label,url,date));}
    catch(e){const error=String(e.message).slice(0,300);checks.push({label,status:"error",error});if(/HTTP (401|403|429)/.test(error)){blocked=true;break;}}
    finally{await page.close();await new Promise(r=>setTimeout(r,4000));}
   }
   if(!blocked&&["fm_osaka","alpha_station","fm_yokohama","tokai_radio","date_fm"].includes(id)){
    const page=await context.newPage();
    try{
     if(id==="fm_yokohama"){
      const response=await page.goto("https://www.fmyokohama.co.jp/songsearch/program-form.html",{waitUntil:"domcontentloaded",timeout:35000});
      if(!response?.ok())throw Error("HTTP "+response?.status());
      const [y,m,day]=yesterday.split("-");
      for(const [selector,v] of [["#ReqYear",y],["#ReqMon",m],["#ReqDay",day]])await page.locator(selector).filter({visible:true}).selectOption(v,{timeout:10000});
      await page.locator(".program-wrap .program-sort-btn a").filter({visible:true,hasText:/^次へ$/}).click({timeout:10000});
     }else{
      const response=await page.goto(stations[id],{waitUntil:"domcontentloaded",timeout:35000});
      if(!response?.ok())throw Error("HTTP "+response?.status());
      await page.waitForTimeout(4000);
      const target=["alpha_station","date_fm"].includes(id)?tomorrow:yesterday;
      const [,m,day]=target.split("-");
      const label=String(Number(m))+"/"+String(Number(day));
      let control;
      if(id==="fm_osaka")control=page.locator("label").filter({visible:true,has:page.locator(".date").filter({hasText:new RegExp("^"+label+"$")})});
      if(id==="alpha_station")control=page.locator(".timetable-nav-item").filter({visible:true,has:page.locator(".timetable-nav-item-date").filter({hasText:new RegExp("^"+label+"$")})});
      if(id==="date_fm"){
       const compact=target.replace(/-/g,"");
       control=page.locator("a[href$='#"+compact+"']").filter({visible:true});
       console.log("DATE_FM_CONTROLS",compact,await control.count());
      }
      if(id==="tokai_radio"){
       const weekday=["SUN","MON","TUE","WED","THU","FRI","SAT"][new Date(yesterday+"T00:00:00Z").getUTCDay()];
       control=page.locator("a.fontEn").filter({visible:true,hasText:new RegExp("^"+weekday+"$")});
      }
      if(!control||await control.count()!==1)throw Error("Date control not unique");
      await control.click({timeout:10000});
     }
     await page.waitForTimeout(6000);
     const date=["alpha_station","date_fm"].includes(id)?tomorrow:yesterday;
     const snap=await snapshot(page);
     console.log("OFFICIAL_DOM",id,"date_ui",JSON.stringify(snap));
     checks.push({label:"date_ui",status:"inspected",...await reportExtraction(page,id,"date_ui",date)});
    }catch(e){checks.push({label:"date_ui",status:"error",error:String(e.message).slice(0,300)});}
    finally{await page.close();await new Promise(r=>setTimeout(r,4000));}
   }
   const baseCheck=checks.find(c=>c.label==="base");
   for(const c of checks){if(c.signature!==undefined){c.sameSlotsAsBase=!!baseCheck&&c.signature===baseCheck.signature;}}
   for(const c of checks)delete c.signature;
   results.push({id,checks});
  }
 }finally{await browser.close();}
 console.log("OFFICIAL_SCHEDULE_SUMMARY",JSON.stringify({today,yesterday,tomorrow,results}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
