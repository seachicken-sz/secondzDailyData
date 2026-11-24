"use strict";
const {openPage}=require("../../common/browser");
const {normalizeRows}=require("../normalize");

// Public HTML result route confirmed by the diagnostic workflow.
function resultUrl(station,date){
  const url=new URL(station.url);
  const match=url.pathname.match(/^\/search\/view\/([a-z0-9]+)\/?$/i);
  if(url.origin!=="https://noa.audee.jp" || !match)throw new Error("Invalid JFN station URL");
  if(station.station_code && station.station_code!==match[1])throw new Error("JFN station code mismatch");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid JFN date");
  return new URL("/search/view/"+match[1]+"/"+date.replace(/-/g,"")+"/list",url.origin).href;
}

async function collect(page,station,date){
  const url=resultUrl(station,date);
  await openPage(page,url);
  const target=date.split("-").map(Number);
  const datePattern=new RegExp("^\\s*"+target[0]+"年\\s*0?"+target[1]+"月\\s*0?"+target[2]+"日");
  const ready=await page.waitForFunction(({pattern,target})=>{
    const heading=document.querySelector("#mainArea h4");
    const header=document.querySelector("#searchResult #searchTitle");
    const selects=["#yearSelectMusic","#monthSelectMusic","#daySelectMusic"].map(id=>document.querySelector(id));
    return !!heading && new RegExp(pattern).test(heading.textContent) &&
      !!header && ["titTime","titTitle","titArtist"].every(id=>header.querySelector("#"+id)) &&
      selects.every((s,i)=>s&&s.options.length&&Number(s.value)===target[i]) &&
      !!document.querySelector("#searchResult .entry");
  },{pattern:datePattern.source,target},{timeout:20000}).catch(()=>null);
  if(!ready)throw new Error("Unverified song table or pagination: result date, header, initialized form or entries missing");
  if(new URL(page.url()).pathname!==new URL(url).pathname)throw new Error("Unexpected JFN result URL");

  // The live diagnostic showed rows increasing from 41 to 92 in five seconds.
  // Require a minimum observation window and stable row contents before saving.
  const begin=Date.now();
  let stableSince=begin,previous="",result;
  while(Date.now()-begin<30000){
    result=await page.evaluate(()=>{
      const clean=s=>String(s||"").replace(/\s+/g," ").trim();
      const rows=[...document.querySelectorAll("#searchResult .entry")].map(entry=>{
        const time=entry.querySelector(".entryTime");
        const title=entry.querySelector(".entryTitle");
        const artist=entry.querySelector(".entryArtist");
        // Read visible text, not image alt attributes or hidden auxiliary controls.
        return {time:clean(time?.innerText),song_name:clean(title?.innerText),artist_name:clean(artist?.innerText)};
      });
      const paging=[...document.querySelectorAll("#mainArea a,#mainArea button")].some(e=>e.getClientRects().length&&(/^(次へ|次のページ|Next|次の\d+件)$/i.test(clean(e.innerText))||e.getAttribute("rel")==="next"));
      return {rows,paging,dateText:clean(document.querySelector("#mainArea h4")?.innerText)};
    });
    if(!datePattern.test(result.dateText))throw new Error("Result date not confirmed");
    if(result.paging)throw new Error("Unverified song table or pagination: pagination detected");
    const signature=JSON.stringify(result.rows);
    const now=Date.now();
    if(signature!==previous){previous=signature;stableSince=now;}
    const valid=result.rows.length>0&&result.rows.every(r=>/^(?:[01]?\d|2[0-9]):[0-5]\d$/.test(r.time)&&r.song_name&&r.artist_name);
    if(valid&&now-begin>=6000&&now-stableSince>=3000){
      const items=normalizeRows(result.rows,date);
      console.log("JFN result",date,"rows="+result.rows.length,"matched="+items.length);
      return {fetched_count:result.rows.length,items};
    }
    await page.waitForTimeout(1000);
  }
  const invalid=result?.rows.filter(r=>!/^(?:[01]?\d|2[0-9]):[0-5]\d$/.test(r.time)||!r.song_name||!r.artist_name).length;
  throw new Error("Unverified song table or pagination: unstable or invalid rows; count="+(result?.rows.length||0)+", invalid="+invalid);
}
module.exports={collect};
