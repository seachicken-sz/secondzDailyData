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
  // Both date search and program search have three selects. Prefer the
  // form following the visible date-search heading, not the program form.
  const candidates=form.filter(f=>f.selects.length===3 && f.selects.every((opts,i)=>opts.some(o=>Number(o.text.replace(/[^0-9]/g,""))===target[i])));
  const dateForms=await page.evaluate(()=>{
    return [...document.forms].map((f,i)=>{
      const heading=[...document.querySelectorAll("h2,h3,h4,h5")].filter(h=>h.compareDocumentPosition(f)&Node.DOCUMENT_POSITION_FOLLOWING || f.contains(h)).pop();
      return {i,heading:heading?.textContent.trim()||""};
    });
  });
  const candidate=candidates.find(f=>dateForms.some(d=>d.i===f.i && /日付で検索/.test(d.heading))) || (candidates.length===1?candidates[0]:null);
  if (!candidate) throw new Error("Date form not recognized");
  const locator=page.locator("form").nth(candidate.i);
  for(let i=0;i<3;i++){
    const opt=candidate.selects[i].find(o=>Number(o.text.replace(/[^0-9]/g,""))===target[i]);
    await locator.locator("select").nth(i).selectOption(opt.value);
  }
  // The HTML form may wrap only the selects (legacy table markup).
  // Search the nearest enclosing section, never an unrelated GO button.
  const selection=await locator.evaluate(f=>{
    const clean=s=>String(s||"").replace(/\s+/g," ").trim();
    const selector='a,button,input[type=submit],input[type=button],input[type=image],[role=button],[onclick],img';
    const visible=e=>!!(e.getClientRects().length && getComputedStyle(e).visibility!=="hidden");
    const info=e=>({
      tag:e.tagName,id:e.id,cls:typeof e.className==="string"?e.className:"",
      label:clean([e.innerText,e.getAttribute("value"),e.getAttribute("alt"),e.getAttribute("aria-label"),e.getAttribute("title"),...Array.from(e.querySelectorAll("img")).map(i=>i.alt)].filter(Boolean).join(" ")),
      image:(e.getAttribute("src")||e.querySelector("img")?.getAttribute("src")||"").split("/").pop().split("?")[0],
      onclick:!!e.getAttribute("onclick")
    });
    const isGo=x=>/^(GO|検索|日付で検索)(\s+(GO|検索|日付で検索))*$/i.test(x.label)||/^(?:btn[_-]?)?go(?:[_-][a-z0-9]+)?\.(gif|png|jpg|svg)$/i.test(x.image);
    const levels=[];
    for(let scope=f;scope&&scope!==document.body;scope=scope.parentElement){
      const otherSelects=[...scope.querySelectorAll("select")].filter(s=>!f.contains(s));
      if(otherSelects.length)break;
      const elements=[...scope.querySelectorAll(selector)].filter(visible);
      const matching=elements.filter(e=>isGo(info(e)));
      const unique=matching.filter(e=>!matching.some(other=>other!==e&&other.contains(e)));
      levels.push({tag:scope.tagName,id:scope.id,cls:scope.className,controls:elements.slice(0,12).map(info)});
      if(unique.length===1){
        unique[0].setAttribute("data-radio-date-submit","1");
        return {found:true,levels};
      }
      if(unique.length>1)break;
      const native=elements.filter(e=>e.matches('input[type=submit],button[type=submit],input[type=image]')&&e.form===f);
      if(native.length===1){
        native[0].setAttribute("data-radio-date-submit","1");
        return {found:true,levels};
      }
    }
    return {found:false,levels,form:{id:f.id,name:f.name,children:[...f.children].map(e=>e.tagName)},outside:[...document.querySelectorAll(selector)].filter(visible).map(info).filter(isGo).slice(0,12)};
  });
  if(!selection.found){
    console.error("JFN date control DOM:",JSON.stringify(selection));
    throw new Error("Date submit not recognized: see JFN date control DOM in Actions log");
  }
  await page.locator('[data-radio-date-submit="1"]').click();
  const datePattern=new RegExp(target[0]+"年\\s*0?"+target[1]+"月\\s*0?"+target[2]+"日");
  await page.waitForFunction(p=>[...document.querySelectorAll("h2,h3,h4,h5")].some(e=>new RegExp(p).test(e.textContent)),datePattern.source,{timeout:15000}).catch(async()=>{const headings=await page.locator("h2,h3,h4,h5").allTextContents();throw new Error("Result date not confirmed: "+JSON.stringify(headings).slice(0,350));});
  const result=await page.evaluate(()=>{
    const clean=s=>s.replace(/\s+/g," ").trim();
    const tables=[...document.querySelectorAll("table")].filter(t=>[...t.rows].some(r=>/TIME/i.test(r.innerText)&&/TITLE/i.test(r.innerText)&&/ARTIST/i.test(r.innerText)));
    if(!tables.length) return null;
    const rows=[];
    for(const r of new Set(tables.flatMap(t=>[...t.rows]))){
      const c=[...r.cells].map(e=>clean(e.innerText));
      if(!c.length || !/^\d{1,2}:\d{2}$/.test(c[0])) continue;
      if(r.cells.length===1 && r.cells[0].colSpan>1) continue;
      if(c.length<3 || !c[1] || !c[2]) return null;
      rows.push({time:c[0],song_name:c[1],artist_name:c[2]});
    }
    const paging=[...document.querySelectorAll("a,button")].some(e=>/^(次へ|次のページ|Next|次の\d+件)$/i.test(clean(e.innerText||"")));
    return {rows,paging};
  });
  if(!result || !result.rows.length || result.paging) {
    const info=await page.evaluate(()=>({tables:[...document.querySelectorAll("table")].map(t=>({rows:t.rows.length,header:[...t.rows].slice(0,2).map(r=>[...r.cells].map(c=>c.tagName+":"+c.cellIndex))})),timeCells:[...document.querySelectorAll("td,li,span")].filter(e=>/^\d{1,2}:\d{2}$/.test(e.textContent.trim())).length}));
    throw new Error("Unverified song table or pagination: "+JSON.stringify({rows:result?.rows.length,paging:result?.paging,...info}).slice(0,400));
  }
  return {fetched_count:result.rows.length,items:normalizeRows(result.rows,date)};
}
module.exports={collect};
