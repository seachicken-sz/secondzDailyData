"use strict";
const {normalize,normalizeRows}=require("../normalize");
function parseDatedTime(value,date){
  const text=normalize(value);
  const m=text.match(/^(\d{4})[年\/.-]\s*(\d{1,2})[月\/.-]\s*(\d{1,2})日?\s*(?:[（(][日月火水木金土](?:曜日)?[）)]\s*)?(\d{1,2}):(\d{2})(?::00)?$/);
  if(!m)return {reason:"format"};
  const actual=m[1]+"-"+m[2].padStart(2,"0")+"-"+m[3].padStart(2,"0");
  if(actual!==date)return {reason:"date_mismatch",actual};
  if(Number(m[4])>29||Number(m[5])>59)return {reason:"time_range"};
  return {time:m[4]+":"+m[5]};
}
function datedTime(value,date){return parseDatedTime(value,date).time||null;
}
async function stableResult(page,date,read,label){
  const start=Date.now();
  let previous="",stableSince=start,last,diagnostics;
  while(Date.now()-start<30000){
    last=await page.evaluate(read);
    if(last.paging)throw new Error("Unverified song table or pagination: "+label+" pagination detected");
    const rows=last.rows.map(r=>({time:datedTime(r.datetime,date),song_name:normalize(r.song_name),artist_name:normalize(r.artist_name)}));
    const failures={format:0,date_mismatch:0,time_range:0,missing_title:0,missing_artist:0};
    const observedDates=new Set();
    for(const r of last.rows){
      const parsed=parseDatedTime(r.datetime,date);
      if(parsed.reason)failures[parsed.reason]++;
      if(parsed.actual)observedDates.add(parsed.actual);
      if(!normalize(r.song_name))failures.missing_title++;
      if(!normalize(r.artist_name))failures.missing_artist++;
    }
    const countOK=!last.requiresCount||(Number.isInteger(last.expectedCount)&&last.expectedCount===rows.length);
    const selectionOK=last.selectedDate===undefined||last.selectedDate===date;
    diagnostics={...failures,observedDates:[...observedDates].slice(0,7),expectedCount:last.expectedCount,countOK,selectionOK};
    const valid=last.ready&&countOK&&selectionOK&&rows.length>0&&rows.every(r=>r.time&&r.song_name&&r.artist_name);
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
  throw new Error("Date result validation failed: "+label+"; rows="+(last?.rows.length||0)+", ready="+!!last?.ready+", "+JSON.stringify(diagnostics||{}));
}
module.exports={datedTime,stableResult};
