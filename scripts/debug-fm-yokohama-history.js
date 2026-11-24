"use strict";
const {openBrowser,openPage}=require("./common/browser");
const {jstDates}=require("./common/datetime");
const {programRange,validPrograms,validateRows}=require("./radio/collectors/fm-yokohama");
const {normalize}=require("./radio/normalize");
const url="https://www.fmyokohama.co.jp/songsearch/program-form.html";
function schedule(){
 const clean=e=>e?.innerText?.trim()||"";
 const root=document.querySelector(".program-wrap #result");
 const tables=[...(root?.querySelectorAll("table")||[])];
 const rows=[...(root?.querySelectorAll("tr")||[])].filter(r=>r.querySelector("td.title a")&&r.getClientRects().length).map((r,i)=>{
  const a=r.querySelector("td.title a");
  const t=r.querySelector("td.time");
  return {index:i,time:clean(t),name:clean(a),timeText:t?.textContent?.trim(),tableIndex:tables.indexOf(r.closest("table")),cells:[...r.cells].map(c=>({cls:c.className,rowSpan:c.rowSpan,colSpan:c.colSpan,text:clean(c).slice(0,100)})),linkCount:r.querySelectorAll("td.title a").length,linkShape:{tag:a.tagName,cls:a.className,hrefType:a.getAttribute("href")?.split(":")[0]?.slice(0,30),hasOnclick:a.hasAttribute("onclick")}};
 });
 return {present:!!root,selected:["ReqYear","ReqMon","ReqDay"].map(id=>document.getElementById(id)?.value||"").join("-"),rows,tables:tables.map(t=>({cls:t.className,rows:t.rows.length,headers:[...t.querySelectorAll("th")].map(clean),parentClass:t.parentElement?.className})),headingText:[...(root?.querySelectorAll("h1,h2,h3,h4,caption,.music-title,.table-title")||[])].map(clean).slice(0,20)};
}
function songs(){
 const clean=e=>e?.innerText?.trim()||"";
 const root=document.querySelector(".program-wrap #result2");
 const header=root?.querySelector(".table-title")||root?.closest(".table-wrap")?.querySelector(".table-title");
 const rows=[...(root?.querySelectorAll(".table-4 .program-left")||[])].filter(e=>e.getClientRects().length).map(e=>({time:clean(e.querySelector(".time")),song_name:clean(e.querySelector(".title")),artist_name:clean(e.querySelector(".artist"))}));
 return {present:!!root,title:clean(root?.querySelector(".music-title")),header:clean(header).replace(/\s+/g," ").toUpperCase(),selected:["ReqYear","ReqMon","ReqDay"].map(id=>document.getElementById(id)?.value||"").join("-"),rows,emptyText:rows.length===0?clean(root).slice(0,500):null,children:[...(root?.children||[])].map(e=>({tag:e.tagName,cls:e.className,childCount:e.children.length})),paging:[...(root?.querySelectorAll("a,button")||[])].filter(e=>e.getClientRects().length).filter(e=>/^(次へ|次のページ|もっと見る|Next|Load more|[0-9]+)$/i.test(clean(e))||e.rel==="next").map(clean)};
}
async function settle(page,reader){
 const start=Date.now();let last,previous="",changed=start;
 while(Date.now()-start<20000){
  last=await page.evaluate(reader);
  const now=Date.now(),key=JSON.stringify(last);
  if(key!==previous){previous=key;changed=now;}
  if(now-start>=5000&&now-changed>=3000&&last.present)return {stable:true,data:last};
  await page.waitForTimeout(1000);
 }
 return {stable:false,data:last};
}
async function openDate(page,date){
 await openPage(page,url);
 const [y,m,d]=date.split("-");
 for(const [id,value] of [["#ReqYear",y],["#ReqMon",m],["#ReqDay",d]]){
  const loc=page.locator(id).filter({visible:true});
  await loc.waitFor({state:"visible",timeout:10000});
  if(await loc.count()!==1)throw Error("Date selector not unique: "+id);
  await loc.selectOption(value,{timeout:10000});
 }
 const next=page.locator(".program-wrap .program-sort-btn a").filter({visible:true,hasText:/^次へ$/});
 if(await next.count()!==1)throw Error("Next control not unique");
 await next.click({timeout:10000});
 return settle(page,schedule);
}
async function main(){
 const dates=process.argv[2]?[process.argv[2]]:jstDates(3).slice(1);
 if(dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||d>=jstDates(1)[0]))throw Error("Use a past date YYYY-MM-DD");
 const {browser,context}=await openBrowser();
 let blocked=false;const summary=[];
 try{
  for(const date of dates){
   if(blocked)break;
   const page=await context.newPage();
   const entry={date,probes:[]};
   page.on("response",r=>{if(new URL(r.url()).hostname==="www.fmyokohama.co.jp"&&[401,403,429].includes(r.status()))blocked=true;});
   try{
    const result=await openDate(page,date);
    const s=result.data;
    if(blocked)throw Error("Access restriction detected");
    const issues=s.rows.flatMap((r,i)=>{
     const reasons=[];const t=programRange(r.time),prev=i?programRange(s.rows[i-1].time):null;
     if(!normalize(r.name))reasons.push("empty_name");
     if(t===null)reasons.push("invalid_time");
     if(i&&t!==null&&prev!==null&&t.start<prev.start)reasons.push("reverse_order");
     return reasons.length?[{index:i,time:r.time,name:r.name,previous:s.rows[i-1]?.time,reasons}]:[];
    });
    entry.programCount=s.rows.length;entry.valid=validPrograms(s,date);
    console.log("YOKOHAMA_PROGRAM_LIST",date,JSON.stringify({stable:result.stable,productionValid:entry.valid,issues,...s}));
    if(!result.stable||s.selected!==date||!s.rows.length)throw Error("Unverified date selection");
    const picks=new Set();
    const add=i=>{if(i>=0&&i<s.rows.length&&picks.size<7)picks.add(i);};
    add(s.rows.findIndex(r=>normalize(r.name)==="放送休止中"));
    add(s.rows.findIndex(r=>normalize(r.name)==="Lovely Day"));
    for(const issue of issues){add(issue.index);add(issue.index-1);}
    for(let i=0;i<s.rows.length;i++){
      const a=programRange(s.rows[i].time);
      if(!a)continue;
      const parent=s.rows.findIndex((r,j)=>{const b=programRange(r.time);return j!==i&&b&&b.start<=a.start&&b.end>=a.end&&(b.start<a.start||b.end>a.end);});
      if(parent>=0){add(parent);add(i);}
    }
    add(0);add(s.rows.length-1);add(Math.floor(s.rows.length/2));
    for(const i of picks){
     if(blocked)break;
     await page.waitForTimeout(4000);
     const links=page.locator(".program-wrap #result td.title a").filter({visible:true});
     const row=s.rows[i];
     if(await links.count()!==s.rows.length||normalize(await links.nth(i).innerText())!==normalize(row.name)){console.log("YOKOHAMA_PROBE_SKIP",date,i,"link mismatch");continue;}
     await links.nth(i).click({timeout:10000});
     const r=await settle(page,songs);
     if(blocked)throw Error("Access restriction detected");
     const v=r.data;
     const {start=null,end=null}=programRange(row.time)||{};
     const details={index:i,program:row.name,start:row.time,nextStart:s.rows[i+1]?.time,stable:r.stable,selected:v.selected,title:v.title,header:v.header,rows:v.rows.length,times:v.rows.map(x=>x.time),invalidRows:v.rows.filter(x=>!validateRows([x])).length,withinCurrentBounds:start!==null&&end!==null&&validateRows(v.rows,start,end),emptyText:v.emptyText,children:v.children,paging:v.paging};
     console.log("YOKOHAMA_PROGRAM_PROBE",date,JSON.stringify(details));
     entry.probes.push({index:i,rows:v.rows.length,stable:r.stable});
    }
   }catch(e){entry.error=String(e.message).slice(0,400);console.log("YOKOHAMA_DEBUG_ERROR",date,entry.error);if(/HTTP (401|403|429)/.test(entry.error))blocked=true;}
   finally{await page.close();}
   summary.push(entry);
   await new Promise(r=>setTimeout(r,4000));
  }
 }finally{await browser.close();}
 console.log("YOKOHAMA_DEBUG_SUMMARY",JSON.stringify({blocked,summary}));
 if(blocked||summary.some(e=>e.error))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
