"use strict";
const {openPage}=require("../../common/browser");
const {normalizeRows}=require("../normalize");
// Conservative first implementation: only a confirmed date and unambiguous
// TIME/TITLE/ARTIST table can be accepted. No private API requests.
async function collect(page,station,date) {
  await openPage(page,station.url);
  const target = date.split("-").map(Number);
  const form = await page.evaluate(() => {
    const forms=[...document.forms];
    return forms.map((f,i)=>({i,selects:[...f.querySelectorAll("select")].map(s=>[...s.options].map(o=>({value:o.value,text:o.textContent.trim()})))}));
  });
  const candidate=form.find(f=>f.selects.length===3 && f.selects.every((opts,i)=>opts.some(o=>Number(o.text.replace(/[^0-9]/g,""))===target[i])));
  if (!candidate) throw new Error("Date form not recognized");
  const locator=page.locator("form").nth(candidate.i);
  for(let i=0;i<3;i++){
    const opt=candidate.selects[i].find(o=>Number(o.text.replace(/[^0-9]/g,""))===target[i]);
    await locator.locator("select").nth(i).selectOption(opt.value);
  }
  const submit=locator.locator('input[type=submit],button[type=submit],button:not([type]),input[type=image]');
  if(await submit.count()!==1) throw new Error("Date submit not recognized");
  await submit.click();
  const datePattern=new RegExp(target[0]+"年\\s*0?"+target[1]+"月\\s*0?"+target[2]+"日");
  await page.waitForFunction(p=>[...document.querySelectorAll("h2,h3,h4,h5")].some(e=>new RegExp(p).test(e.textContent)),datePattern.source,{timeout:15000});
  const result=await page.evaluate(()=>{
    const clean=s=>s.replace(/\s+/g," ").trim();
    const tables=[...document.querySelectorAll("table")].filter(t=>[...t.rows].some(r=>/TIME/i.test(r.innerText)&&/TITLE/i.test(r.innerText)&&/ARTIST/i.test(r.innerText)));
    if(tables.length!==1) return null;
    const rows=[];
    for(const r of tables[0].rows){
      const c=[...r.cells].map(e=>clean(e.innerText));
      if(!c.length || !/^\d{1,2}:\d{2}$/.test(c[0])) continue;
      if(c.length<3 || !c[1] || !c[2]) return null;
      rows.push({time:c[0],song_name:c[1],artist_name:c[2]});
    }
    const paging=[...document.querySelectorAll("a,button")].some(e=>/^(次へ|次のページ|Next|次の\d+件)$/i.test(clean(e.innerText||"")));
    return {rows,paging};
  });
  if(!result || !result.rows.length || result.paging) throw new Error("Unverified song table or pagination");
  return {fetched_count:result.rows.length,items:normalizeRows(result.rows,date)};
}
module.exports={collect};
