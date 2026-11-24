"use strict";
const {openPage}=require("../../common/browser");
const {normalize,normalizeRows}=require("../normalize");
function broadcastTime(value){
  const m=normalize(value).match(/^(\d{1,2}):([0-5]\d)$/);
  if(!m||+m[1]>28)return null;
  const h=+m[1]<5?+m[1]+24:+m[1];
  return String(h).padStart(2,"0")+":"+m[2];
}
async function collect(page,station,date){
  const url=new URL(station.url);
  if(url.origin!=="https://fm-kyoto.jp"||!/^\/nowonair\/?$/.test(url.pathname)||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid alpha-station URL or date");
  await openPage(page,url.href);
  const readDate=()=>page.locator("#noa-container.loaded .noa_date").innerText({timeout:15000});
  const dateText=async()=>{const m=(await readDate()).match(/^(\d{4})\.(\d{2})\.(\d{2})\b/);if(!m)throw Error("Result date not confirmed");return m.slice(1).join("-");};
  await page.locator("#noa-container.loaded table.table_style02").waitFor({state:"visible",timeout:20000});
  let current=await dateText();
  for(let i=0;current!==date&&i<7;i++){
    if(current<date)throw Error("Requested broadcast day not yet available");
    const prev=new Date(Date.parse(current+"T00:00:00Z")-86400000).toISOString().slice(0,10);
    const control=page.locator("#noa-container .noa_pager_top .arrow_l").filter({visible:true,hasText:prev.replace(/-/g,".")});
    if(await control.count()!==1)throw Error("Date form not recognized: alpha-station previous date");
    const child=control.locator("a,button,[role=button]").filter({visible:true});
    if(await child.count()===1)await child.click({timeout:10000});else await control.click({timeout:10000});
    await page.waitForFunction(expected=>document.querySelector("#noa-container.loaded .noa_date")?.innerText.startsWith(expected),prev.replace(/-/g,"."),{timeout:20000});
    await page.waitForTimeout(1500);
    current=await dateText();
  }
  if(current!==date)throw Error("Result date not confirmed");
  const start=Date.now();let previous="",stableSince=start,last;
  while(Date.now()-start<30000){
    last=await page.evaluate(()=>{
      const root=document.querySelector("#noa-container.loaded");
      const table=root?.querySelector("table.table_style02");
      const text=e=>e?.innerText?.trim()||"";
      return {date:text(root?.querySelector(".noa_date")),headers:[...(table?.querySelectorAll("th")||[])].map(text),rows:[...(table?.rows||[])].filter(r=>r.cells[0]?.tagName==="TD").map(r=>({time:text(r.cells[0]),song_name:text(r.cells[1]),artist_name:[...(r.cells[2]?.childNodes||[])].filter(n=>n.nodeType===3).map(n=>n.textContent).join(" ").trim(),columns:r.cells.length}))};
    });
    const rows=last.rows.map(r=>({...r,time:broadcastTime(r.time)}));
    const valid=last.date.startsWith(date.replace(/-/g,"."))&&last.headers.join("|")==="Time|Title|Artist"&&rows.length>0&&rows.every(r=>r.columns===3&&r.time&&normalize(r.song_name)&&normalize(r.artist_name));
    const now=Date.now(),signature=JSON.stringify(last);
    if(signature!==previous){previous=signature;stableSince=now;}
    if(valid&&now-start>=6000&&now-stableSince>=3000){
      const items=normalizeRows(rows,date);
      console.log("ALPHA STATION result",date,"rows="+rows.length,"matched="+items.length);
      return {fetched_count:rows.length,items};
    }
    await page.waitForTimeout(1000);
  }
  throw Error("Date result validation failed: alpha-station; rows="+(last?.rows.length||0)+", date="+last?.date);
}
module.exports={collect,broadcastTime};
