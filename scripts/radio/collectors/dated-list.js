"use strict";
const {normalize,normalizeRows}=require("../normalize");
function datedTime(value,date){
  const text=normalize(value);
  const m=text.match(/^(\d{4})[年\/.-]\s*(\d{1,2})[月\/.-]\s*(\d{1,2})日?\s*(?:[（(][日月火水木金土](?:曜日)?[）)]\s*)?(\d{1,2}):(\d{2})(?::00)?$/);
  if(!m)return null;
  const actual=m[1]+"-"+m[2].padStart(2,"0")+"-"+m[3].padStart(2,"0");
  if(actual!==date||Number(m[4])>29||Number(m[5])>59)return null;
  return m[4]+":"+m[5];
}
async function stableResult(page,date,read,label){
  const start=Date.now();
  let previous="",stableSince=start,last;
  while(Date.now()-start<30000){
    last=await page.evaluate(read);
    if(last.paging)throw new Error("Unverified song table or pagination: "+label+" pagination detected");
    const rows=last.rows.map(r=>({time:datedTime(r.datetime,date),song_name:normalize(r.song_name),artist_name:normalize(r.artist_name)}));
    const valid=last.ready&&rows.length>0&&rows.every(r=>r.time&&r.song_name&&r.artist_name);
    const signature=JSON.stringify(last);
    const now=Date.now();
    if(signature!==previous){previous=signature;stableSince=now;}
    if(valid&&now-start>=6000&&now-stableSince>=3000){
      const items=normalizeRows(rows,date);
      console.log(label+" result",date,"rows="+rows.length,"matched="+items.length);
      return {fetched_count:rows.length,items};
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("Unverified song table or pagination: "+label+" date/header/rows invalid or unstable; rows="+(last?.rows.length||0)+", ready="+!!last?.ready);
}
module.exports={datedTime,stableResult};
