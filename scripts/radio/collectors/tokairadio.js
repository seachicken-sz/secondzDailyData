"use strict";
const {openPage}=require("../../common/browser");
const {stableResult}=require("./dated-list");
async function collect(page,station,date){
  const url=new URL(station.url);
  if(url.origin!=="https://www.tokairadio.co.jp"||!/^\/program\/onair\/?$/.test(url.pathname)||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid TOKAI RADIO URL or date");
  await openPage(page,url.href);
  const field=page.locator("select#time");
  await field.waitFor({state:"visible",timeout:20000});
  if(await field.count()!==1)throw new Error("Date form not recognized: TOKAI RADIO");
  await page.waitForFunction(date=>[...document.querySelectorAll("select#time option")].some(e=>e.value===date),date,{timeout:10000});
  if(await field.inputValue()!==date)await field.selectOption(date,{timeout:10000});
  if(await field.inputValue()!==date)throw new Error("Result date not confirmed");
  return stableResult(page,date,()=>{
    const clean=s=>String(s||"").normalize("NFKC").replace(/\s+/g,"").trim();
    const headline=[...document.querySelectorAll(".onair-headline > li > span")].map(e=>clean(e.innerText));
    const time=headline.findIndex(s=>/^(?:放送)?(?:日時|時間|時刻|オンエア日時|オンエア時間|TIME)$/i.test(s));
    const title=headline.findIndex(s=>/^(?:曲名|楽曲名|タイトル|TITLE|SONG)$/i.test(s));
    const artist=headline.findIndex(s=>/^(?:アーティスト名?|歌手名?|ARTIST)$/i.test(s));
    const root=document.querySelector(".js-result.onair-result");
    const rows=[...(root?.querySelectorAll("ul > li")||[])].map(e=>{
      const cells=[...e.children].filter(c=>c.tagName==="SPAN");
      return {datetime:cells[time]?.innerText||"",song_name:cells[title]?.innerText||"",artist_name:cells[artist]?.innerText||""};
    });
    const paging=[...(root?.querySelectorAll("a,button")||[])].some(e=>e.getClientRects().length&&(/^(次へ|次のページ|もっと見る|次の\d+件|Next|Load more|[0-9]+)$/i.test(e.innerText.trim())||e.rel==="next"));
    return {ready:!!root&&headline.length===3&&new Set([time,title,artist]).size===3&&[time,title,artist].every(i=>i>=0),rows,paging};
  },"TOKAI RADIO");
}
module.exports={collect};
