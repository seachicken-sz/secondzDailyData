"use strict";
const {openPage}=require("../../common/browser");
const {stableResult}=require("./dated-list");
async function collect(page,station,date){
  const base=new URL(station.url);
  if(base.origin!=="https://www.nack5.co.jp"||!/^\/on-air-music\/?$/.test(base.pathname)||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid NACK5 URL or date");
  const url=new URL("/on-air-music/"+date.replace(/-/g,"")+".html",base.origin);
  await openPage(page,url.href);
  if(new URL(page.url()).pathname!==url.pathname)throw new Error("Unexpected NACK5 result URL");
  const target=date.split("-").map(Number);
  return stableResult(page,date,()=>{
    const root=document.querySelector("#date-search-result");
    const values=["year","month","day"].map(n=>Number((document.querySelector('select[name="'+n+'"]')?.value||"").replace(/[年月日]/g,"")));
    const expected=location.pathname.match(/\/(\d{4})(\d{2})(\d{2})\.html$/)?.slice(1).map(Number);
    const clean=e=>e?.innerText||"";
    const rows=[...(root?.querySelectorAll(".music-wrap .music-txt-body")||[])].map(e=>({datetime:clean(e.querySelector(".on-air-time")),song_name:clean(e.querySelector("h3")),artist_name:clean(e.querySelector(".artist-name"))}));
    const paging=[...(root?.querySelectorAll("a,button")||[])].some(e=>e.getClientRects().length&&(/^(次へ|次のページ|もっと見る|次の\d+件|Next|Load more|[0-9]+)$/i.test(e.innerText.trim())||e.rel==="next"));
    return {ready:!!root&&!!expected&&values.every((v,i)=>v===expected[i]),rows,paging};
  },"NACK5");
}
module.exports={collect};
