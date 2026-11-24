"use strict";
const {openPage}=require("../../common/browser");
const {jstDates}=require("../../common/datetime");
const {normalize,normalizeRows}=require("../normalize");

const origin="https://www.fmyokohama.co.jp";
const delay=4000;
function timeSeconds(value){
  const m=normalize(value).match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
  return m&&+m[1]<24?+m[1]*3600+ +m[2]*60+ +(m[3]||0):null;
}
function programRange(value){
  const m=normalize(value).match(/^(\d{1,2}:[0-5]\d)\s*[~〜～–-]\s*(\d{1,2}:[0-5]\d)$/);
  if(!m)return null;
  const start=timeSeconds(m[1]),end=m[2]==="24:00"?86400:timeSeconds(m[2]);
  return start!==null&&end!==null&&start<end?{start,end}:null;
}
function validateRows(rows,start=0,end=86400){
  return rows.every(r=>{
    const t=timeSeconds(r.time);
    return t!==null&&t>=start&&t<end&&normalize(r.song_name)&&normalize(r.artist_name);
  });
}
async function stableRead(page,read,valid,label){
  const started=Date.now();let prior="",changed=started,last;
  while(Date.now()-started<30000){
    last=await page.evaluate(read);
    const now=Date.now(),signature=JSON.stringify(last);
    if(signature!==prior){prior=signature;changed=now;}
    if(valid(last)&&now-started>=4000&&now-changed>=2000)return last;
    await page.waitForTimeout(1000);
  }
  throw Error("Date result validation failed: FM Yokohama "+label+"; rows="+(last?.rows?.length||0)+", title="+String(last?.title||"").slice(0,80)+", selected="+String(last?.selected||""));
}
function readSongs(){
  const clean=e=>e?.innerText?.trim()||"";
  const root=document.querySelector(".program-wrap #result2");
  const header=root?.querySelector(".table-title")||root?.closest(".table-wrap")?.querySelector(".table-title");
  const rows=[...(root?.querySelectorAll(".table-4 .program-left")||[])].filter(e=>e.getClientRects().length).map(e=>({time:clean(e.querySelector(".time")),song_name:clean(e.querySelector(".title")),artist_name:clean(e.querySelector(".artist"))}));
  const selected=["ReqYear","ReqMon","ReqDay"].map(id=>document.getElementById(id)?.value||"").join("-");
  const paging=[...(root?.querySelectorAll("a,button")||[])].filter(e=>e.getClientRects().length).some(e=>/^(次へ|次のページ|もっと見る|Next|Load more|[0-9]+)$/i.test(clean(e))||e.rel==="next");
  const headerOnly=!!root&&rows.length===0&&!!root.querySelector(".music-title")&&!!root.querySelector(".table-wrap > .table-title")&&root.querySelector(".table-wrap").children.length===1&&clean(root.querySelector(".table-wrap")).replace(/\s+/g," ").toUpperCase()==="TIME TITLE ARTIST";
  const empty=headerOnly||!!root&&rows.length===0&&/該当する(?:曲|楽曲).{0,10}(?:ありません|ございません)|(?:曲|楽曲)(?:は|が)ありません|検索結果\s*[：:]?\s*0\s*件/.test(clean(root));
  return {present:!!root,header:clean(header).replace(/\s+/g," ").toUpperCase(),title:clean(root?.querySelector(".music-title")),selected,rows,paging,empty};
}
function readPrograms(){
  const clean=e=>e?.innerText?.trim()||"";
  const root=document.querySelector(".program-wrap #result");
  const rows=[...(root?.querySelectorAll("tr")||[])].filter(r=>r.querySelector("td.title a")&&r.getClientRects().length).map(r=>({time:clean(r.querySelector("td.time")),name:clean(r.querySelector("td.title a"))}));
  return {present:!!root,selected:["ReqYear","ReqMon","ReqDay"].map(id=>document.getElementById(id)?.value||"").join("-"),rows};
}
function validPrograms(result,date){
  const rows=result.rows;
  return result.present&&result.selected===date&&rows.length>0&&rows.length<=60&&rows.every((r,i)=>normalize(r.name)&&programRange(r.time)!==null&&(i===0||programRange(rows[i-1].time)!==null&&programRange(r.time).start>=programRange(rows[i-1].time).start));
}
async function selectDate(page,date){
  const [y,m,d]=date.split("-");
  for(const [selector,value] of [["#ReqYear",y],["#ReqMon",m],["#ReqDay",d]]){
    const field=page.locator(selector).filter({visible:true});
    await field.waitFor({state:"visible",timeout:15000});
    if(await field.count()!==1)throw Error("Date form not recognized: FM Yokohama");
    await field.selectOption(value,{timeout:10000});
  }
  const next=page.locator(".program-wrap .program-sort-btn a").filter({visible:true,hasText:/^次へ$/});
  if(await next.count()!==1)throw Error("Date submit not recognized: FM Yokohama");
  await next.click({timeout:10000});
  return stableRead(page,readPrograms,r=>validPrograms(r,date),"program list");
}
async function collect(page,station,date){
  const base=new URL(station.url);
  if(base.origin!==origin||!/^\/songsearch\/?$/.test(base.pathname)||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error("Invalid FM Yokohama URL or date");
  const today=jstDates(1)[0];
  if(date>today)throw Error("Requested date is in the future");
  let rows=[];
  if(date===today){
    await openPage(page,origin+"/songsearch/today.html");
    if(new URL(page.url()).pathname!=="/songsearch/today.html")throw Error("Unexpected FM Yokohama today URL");
    const result=await stableRead(page,readSongs,r=>r.present&&r.header==="TIME TITLE ARTIST"&&!r.paging&&r.rows.length>0&&validateRows(r.rows),"today");
    if(jstDates(1)[0]!==date)throw Error("FM Yokohama date changed during capture");
    const now=Date.now();
    if(result.rows.some(r=>Date.parse(date+"T00:00:00+09:00")+timeSeconds(r.time)*1000>now))throw Error("FM Yokohama today list contains future times");
    rows=result.rows;
  }else{
    await openPage(page,origin+"/songsearch/program-form.html");
    if(new URL(page.url()).pathname!=="/songsearch/program-form.html")throw Error("Unexpected FM Yokohama program URL");
    const schedule=await selectDate(page,date);
    const key=JSON.stringify(schedule.rows);
    for(let i=0;i<schedule.rows.length;i++){
      const entry=schedule.rows[i];
      const {start,end}=programRange(entry.time);
      if(normalize(entry.name)==="放送休止中")continue;
      await page.waitForTimeout(delay);
      const current=await page.evaluate(readPrograms);
      if(!validPrograms(current,date)||JSON.stringify(current.rows)!==key)throw Error("FM Yokohama program list changed");
      const links=page.locator(".program-wrap #result td.title a").filter({visible:true});
      if(await links.count()!==schedule.rows.length)throw Error("FM Yokohama program link count changed");
      const link=links.nth(i);
      if(normalize(await link.innerText())!==normalize(entry.name))throw Error("FM Yokohama program link mismatch");
      await link.click({timeout:10000});
      const result=await stableRead(page,readSongs,r=>{
        const title=normalize(r.title),name=normalize(entry.name);
        return r.present&&r.selected===date&&(title===name||title===name+" オンエア曲")&&!r.paging&&(r.empty||(r.header==="TIME TITLE ARTIST"&&r.rows.length>0&&validateRows(r.rows,start,end)));
      },"program "+entry.name);
      rows.push(...result.rows.map(r=>({...r,program_name:entry.name,program_start:start,program_end:end})));
      console.log("FM YOKOHAMA program",date,entry.name,"rows="+result.rows.length);
    }
  }
  if(date!==today)rows=deduplicatePrograms(rows,date);
  if(!rows.length)throw Error("Unverified song table: FM Yokohama no daily rows");
  const items=normalizeRows(rows,date);
  console.log("FM YOKOHAMA result",date,"rows="+rows.length,"matched="+items.length);
  return {fetched_count:rows.length,items};
}
function deduplicatePrograms(rows,date){
  const groups=new Map();
  for(const r of rows){
    const key=JSON.stringify([timeSeconds(r.time),normalize(r.song_name).toLowerCase(),normalize(r.artist_name).toLowerCase()]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(r);
  }
  return [...groups.values()].map(group=>{
    const parents=group.filter(a=>group.every(b=>a.program_start<=b.program_start&&a.program_end>=b.program_end));
    const names=new Set(parents.map(r=>normalize(r.program_name)));
    if(names.size===1)return parents[0];
    if(group.length===1)return group[0];
    console.log("FM YOKOHAMA ambiguous program",date,group[0].time,"candidates="+[...new Set(group.map(r=>r.program_name))].join(" | "));
    return {...group[0],program_name:""};
  });
}
module.exports={collect,timeSeconds,programRange,validateRows,validPrograms,deduplicatePrograms};
