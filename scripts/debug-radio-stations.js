"use strict";
const {openBrowser}=require("./common/browser");
const {jstDates}=require("./common/datetime");
const stations={
  fm802:"https://funky802.com/site/onairlist/",
  fm_cocolo:"https://cocolo.jp/site/onairlist",
  tokai_radio:"https://www.tokairadio.co.jp/program/onair/",
  fm_yokohama:"https://www.fmyokohama.co.jp/songsearch",
  nack5:"https://www.nack5.co.jp/on-air-music/",
  interfm:"https://www.interfm.co.jp/search",
  crossfm:"https://www.crossfm.co.jp/msearch/w_index.php",
  fmfuji:"https://fmfuji.jp/noa/noasf.php",
  alpha_station:"https://fm-kyoto.jp/nowonair/"
};
async function inspect(page,id,stage){
  for(const frame of page.frames()){
    try{
      const data=await frame.evaluate(()=>{
        const clean=s=>String(s||"").replace(/\s+/g," ").trim();
        const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden";
        const desc=e=>({tag:e.tagName,id:e.id,cls:typeof e.className==="string"?e.className:"",name:e.getAttribute("name")});
        const chain=e=>{const a=[];for(let i=0;e&&i<5;i++,e=e.parentElement)a.push(desc(e));return a;};
        const fields=[...document.querySelectorAll("select,input,textarea")].filter(e=>visible(e)&&!["password","hidden","file"].includes(e.type)).slice(0,60).map(e=>({...desc(e),type:e.type,placeholder:e.placeholder,label:clean(Array.from(e.labels||[]).map(l=>l.innerText).join(" ")),min:e.min,max:e.max,value:e.tagName==="SELECT"||["date","time","number"].includes(e.type)?e.value:undefined,options:e.tagName==="SELECT"?Array.from(e.options).slice(0,40).map(o=>({value:o.value,label:clean(o.textContent)})):undefined,form:e.form?desc(e.form):null,chain:chain(e)}));
        const buttons=[...document.querySelectorAll("button,input[type=submit],input[type=button],input[type=image],a,[role=button]")].filter(visible).map(e=>({e,label:clean(e.innerText||e.value||e.getAttribute("alt")||e.getAttribute("aria-label")||e.querySelector("img")?.alt)})).filter(x=>/検索|絞り込|表示|次へ|前へ|今日|昨日|search|^go$|^next$|^previous$/i.test(x.label)||x.e.matches("button,input[type=submit],input[type=image]")).slice(0,35).map(({e,label})=>({...desc(e),label:label.slice(0,80),type:e.getAttribute("type"),chain:chain(e),form:e.form?desc(e.form):null}));
        const times=[...document.querySelectorAll("body *")].filter(e=>!e.children.length&&visible(e)&&/^(?:\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}時\d{1,2}分)$/.test(clean(e.textContent)));
        const rowShapes=times.slice(0,3).map(e=>{const a=[];for(let p=e.parentElement,i=0;p&&i<5;p=p.parentElement,i++)a.push({...desc(p),children:[...p.children].slice(0,12).map(desc)});return a;});
        const headings=[...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).slice(0,35).map(e=>({...desc(e),text:clean(e.textContent).slice(0,100)}));
        const labels=[...document.querySelectorAll("body *")].filter(e=>!e.children.length&&visible(e)&&/^(TIME|TITLE|ARTIST|ON AIR|曲名|楽曲名|アーティスト名?|放送時刻|オンエア時刻|検索結果)$/i.test(clean(e.textContent))).slice(0,30).map(e=>({label:clean(e.textContent),chain:chain(e)}));
        const tables=[...document.querySelectorAll("table")].slice(0,10).map(t=>({...desc(t),rows:t.rows.length,firstRows:[...t.rows].slice(0,3).map(r=>[...r.cells].map(desc))}));
        const dateLabels=[...document.querySelectorAll("body *")].filter(e=>!e.children.length&&visible(e)&&/^(?:\d{4}[年\/.-]\d{1,2}[月\/.-]\d{1,2}日?|\d{1,2}月\d{1,2}日)(?:\s*[（(].{1,5}[）)])?$/.test(clean(e.textContent))).slice(0,12).map(e=>({...desc(e),text:clean(e.textContent),chain:chain(e)}));
        const archiveLinks=[...document.querySelectorAll("a")].filter(visible).filter(e=>/過去|履歴|前日|昨日|archive|back number/i.test(clean(e.innerText))).slice(0,20).map(e=>({...desc(e),label:clean(e.innerText).slice(0,80),path:new URL(e.href,location.href).pathname}));
        const tableHeaders=[...document.querySelectorAll("table.songs,table.table_style02")].map(t=>({className:t.className,headers:[...t.querySelectorAll("th")].slice(0,10).map(e=>clean(e.innerText))}));
        return {title:document.title,dateLabels,archiveLinks,tableHeaders,headings,fields,buttons,labels,timeCount:times.length,rowShapes,tables,forms:[...document.forms].map(f=>({...desc(f),method:f.method,action:new URL(f.action,location.href).pathname})),frames:[...document.querySelectorAll("iframe")].map(desc)};
      });
      console.log("DOM",id,stage,new URL(frame.url()).origin,new URL(frame.url()).pathname,JSON.stringify(data));
    }catch(e){console.log("FRAME_ERROR",id,stage,String(e.message).slice(0,300));}
  }
}
async function search(frame,date){
  const plan=await frame.evaluate(date=>{
    const clean=s=>String(s||"").replace(/\s+/g," ").trim();
    const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden";
    const [y,m,d]=date.split("-").map(Number);
    const plans=[];
    for(const f of document.forms){
      const controls=[...f.querySelectorAll("select,input")].filter(visible);
      if(controls.some(e=>["password","file","email","tel"].includes(e.type)))continue;
      const choices=[];
      for(const e of controls){
        const name=(e.name+" "+e.id+" "+e.placeholder+" "+Array.from(e.labels||[]).map(l=>l.innerText).join(" ")).toLowerCase();
        if(e.type==="date"){choices.push({e,value:date,kind:/end|to|終了|まで/.test(name)?"endDate":"date"});continue;}
        if(e.tagName==="SELECT"){
          const kind=/year|年/.test(name)?"year":/month|月/.test(name)?"month":/day|日/.test(name)?"day":null;
          const n={year:y,month:m,day:d}[kind];
          if(kind){const o=[...e.options].find(o=>Number(clean(o.textContent).replace(/[年月日]/g,""))===n||Number(String(o.value).replace(/[年月日]/g,""))===n);if(o)choices.push({e,value:o.value,kind});}
        }
        if(e.type==="text"&&/artist|アーティスト/.test(name))choices.push({e,value:"timelesz",kind:"artist"});
      }
      const kinds=choices.map(x=>x.kind);
      if(!kinds.includes("date")&&!["year","month","day"].every(k=>kinds.includes(k))&&!kinds.includes("artist"))continue;
      if(new Set(kinds).size!==kinds.length)continue;
      const buttons=[...f.querySelectorAll("button,input[type=submit],input[type=button],input[type=image],a,[role=button]")].filter(visible).filter(e=>/^(検索(?:する)?|search|go|表示(?:する)?)$/i.test(clean(e.innerText||e.value||e.getAttribute("alt")||e.getAttribute("aria-label")||e.querySelector("img")?.alt)));
      if(buttons.length!==1)continue;
      plans.push({choices,button:buttons[0]});
    }
    if(plans.length!==1)return {reason:"No unique recognized search form",count:plans.length};
    const p=plans[0];
    p.choices.forEach((x,i)=>x.e.setAttribute("data-radio-debug-field",String(i)));
    p.button.setAttribute("data-radio-debug-submit","1");
    return {fields:p.choices.map(x=>({kind:x.kind,value:x.value,tag:x.e.tagName}))};
  },date);
  console.log("SEARCH_PLAN",JSON.stringify(plan));
  if(!plan.fields)return false;
  for(const [i,f] of plan.fields.entries()){
    const loc=frame.locator('[data-radio-debug-field="'+i+'"]');
    if(f.tag==="SELECT")await loc.selectOption(f.value,{timeout:5000});else await loc.fill(f.value,{timeout:5000});
  }
  await frame.locator('[data-radio-debug-submit="1"]').click({timeout:10000});
  return true;
}

async function uniqueVisible(scope,selector){
  const loc=scope.locator(selector).filter({visible:true});
  if(await loc.count()!==1)throw new Error("Expected one visible control: "+selector);
  return loc;
}
async function submitFor(field){
  const form=field.locator("xpath=ancestor::form[1]");
  if(await form.count()!==1)throw new Error("Search form not found");
  const buttons=form.locator('button,input[type=submit],input[type=button]').filter({visible:true});
  const candidates=[];
  for(const b of await buttons.all()){
    const label=await b.evaluate(e=>(e.innerText||e.value||e.getAttribute("aria-label")||"").trim());
    if(/^(検索(?:する)?|表示(?:する)?|GO|Search)$/i.test(label))candidates.push(b);
  }
  if(candidates.length!==1)throw new Error("Search submit not unique: "+candidates.length);
  await candidates[0].click({timeout:10000});
}
async function stationSearch(page,id,date){
  const [y,m,d]=date.split("-").map(Number);
  if(id==="tokai_radio"){
    const field=await uniqueVisible(page,"select#time");
    await field.selectOption(date,{timeout:5000});
    return true;
  }
  if(id==="nack5"){
    const year=await uniqueVisible(page,'select[name="year"]');
    await year.selectOption(y+"年",{timeout:5000});
    await (await uniqueVisible(page,'select[name="month"]')).selectOption(m+"月",{timeout:5000});
    const day=await uniqueVisible(page,'select[name="day"]');
    await day.selectOption(d+"日",{timeout:5000});
    await submitFor(day);
    return true;
  }
  if(id==="crossfm"){
    const field=await uniqueVisible(page,'select[name="seldate"]');
    await field.selectOption(date,{timeout:5000});
    await (await uniqueVisible(page,'select[name="selhour"]')).selectOption("12",{timeout:5000});
    await submitFor(field);
    return true;
  }
  if(id==="fm_yokohama"){
    const link=page.getByText("日時で検索",{exact:true}).filter({visible:true});
    if(await link.count()!==1)throw new Error("Date search control not unique");
    await link.click({timeout:10000});
    await page.waitForTimeout(3000);
    for(const p of page.context().pages())await inspect(p,id,"date_form");
    return true;
  }
  if(id==="interfm"){
    const url=new URL(stations[id]);
    for(const [k,v] of Object.entries({a:"timelesz",sd:date,st:"00:00",ed:date,et:"23:59"}))url.searchParams.set(k,v);
    const response=await page.goto(url.href,{waitUntil:"domcontentloaded",timeout:35000});
    if(!response?.ok())throw new Error("Search HTTP "+response?.status());
    return true;
  }
  if(id==="alpha_station"){
    console.log("CURRENT_LIST_ONLY",id,"date and archive links need verification");
    return false;
  }
  return null;
}


async function visit(page,url){
  const r=await page.goto(url,{waitUntil:"domcontentloaded",timeout:35000});
  if(!r?.ok())throw new Error("Page HTTP "+r?.status());
  await page.waitForTimeout(3000);
}
async function facts(page,id,stage){
  const result=await page.evaluate(()=>{
    const clean=s=>String(s||"").replace(/\s+/g," ").trim();
    const visible=e=>!!e.getClientRects().length;
    const desc=e=>({tag:e.tagName,id:e.id,cls:typeof e.className==="string"?e.className:""});
    const shape=e=>({ ...desc(e), children:[...e.children].slice(0,12).map(c=>({...desc(c),children:[...c.children].slice(0,6).map(desc)}))});
    const dateRx=/\d{4}[年\/.-]\d{1,2}[月\/.-]\d{1,2}日?/;
    const timeRx=/(?:[0-2]?\d:[0-5]\d|\d{1,2}時\d{1,2}分)/;
    const dates=[...document.querySelectorAll("body *")].filter(e=>visible(e)&&e.children.length===0&&dateRx.test(clean(e.innerText))).slice(0,12).map(e=>({date:clean(e.innerText).match(dateRx)[0],shape:desc(e.parentElement)}));
    const times=[...document.querySelectorAll("body *")].filter(e=>visible(e)&&e.children.length===0&&timeRx.test(clean(e.innerText)));
    const rows=[...document.querySelectorAll("table.songs tr,table.table_style02 tr")].filter(e=>e.querySelector("td"));
    const rowTimes=rows.map(r=>clean(r.cells[0]?.innerText)).filter(t=>timeRx.test(t));
    const links=[...document.querySelectorAll("a[href]")].filter(visible).filter(e=>/次|前|ページ|^[0-9]+$|next|prev/i.test(clean(e.innerText))).slice(0,30).map(e=>{const u=new URL(e.href,location.href);return {label:clean(e.innerText).slice(0,30),path:u.pathname,params:Object.fromEntries([...u.searchParams].filter(([k])=>["mode","page","seldate","selhour"].includes(k)))};});
    const areas=[...document.querySelectorAll('[id*="onair" i],[class*="onair" i],[id*="song" i],[class*="song" i],[id*="music" i],[class*="music" i]')].filter(visible).slice(0,25).map(e=>({...shape(e),textLength:clean(e.innerText).length}));
    const status=[...document.querySelectorAll("body *")].filter(e=>!e.children.length&&visible(e)&&/該当|件中|件表示|検索結果|曲がありません|取得でき|エラー|no results|no songs/i.test(clean(e.innerText))).slice(0,10).map(e=>clean(e.innerText).slice(0,100));
    return {dates,timeCount:times.length,firstTime:rowTimes[0],lastTime:rowTimes.at(-1),tableRows:rows.length,tableTimeRows:rowTimes.length,timeShapes:times.slice(0,4).map(e=>({time:clean(e.innerText).match(timeRx)?.[0],parent:shape(e.parentElement),grandparent:e.parentElement?.parentElement?shape(e.parentElement.parentElement):null})),links,areas,status};
  });
  console.log("RESULT_FACTS",id,stage,JSON.stringify(result));
}

async function step(id,name,fn){
  try{await fn();console.log("PROBE_OK",id,name);return true;}
  catch(e){console.log("PROBE_ERROR",id,name,String(e.message).slice(0,400));return false;}
}
async function snapshot(page,id,stage){
  await inspect(page,id,stage);
  await facts(page,id,stage);
  const info=await page.evaluate(()=>{
    const clean=s=>String(s||"").normalize("NFKC").replace(/\s+/g," ").trim();
    const visible=e=>!!e.getClientRects().length;
    const root=document.querySelector("#noa-container");
    const current=root?[...root.children].filter(e=>!e.matches("table,.arrow_l,.arrow_r")&&!e.querySelector("table")).map(e=>({tag:e.tagName,cls:e.className,text:clean(e.innerText).slice(0,100)})):null;
    const table=document.querySelector("table.songs, #noa-container table.table_style02");
    const rows=[...(table?.rows||[])].filter(r=>r.cells[0]?.tagName==="TD");
    const times=rows.map(r=>clean(r.cells[0]?.innerText)).filter(t=>/^\d{1,2}:\d{2}$/.test(t));
    const artistCells=rows.slice(0,3).map(r=>({children:[...(r.cells[2]?.children||[])].map(e=>({tag:e.tagName,cls:e.className})),directTextLength:[...(r.cells[2]?.childNodes||[])].filter(n=>n.nodeType===3).map(n=>clean(n.textContent)).join("").length}));
    const options=[...document.querySelectorAll('select[name="selhour"] option')].map(o=>({value:o.value,label:clean(o.textContent)}));
    const controls=[...document.querySelectorAll("a,button,input,[role=button],.arrow_l,.arrow_r")].filter(visible).filter(e=>/^(検索(?:する)?|番組名で検索|日時で検索|次へ|前へ)$/.test(clean(e.innerText||e.value||e.getAttribute("alt")))||e.matches(".arrow_l,.arrow_r")).slice(0,25).map(e=>({tag:e.tagName,id:e.id,cls:e.className,label:clean(e.innerText||e.value).slice(0,60),type:e.getAttribute("type"),children:[...e.children].map(c=>({tag:c.tagName,cls:c.className,alt:c.getAttribute("alt")}))}));
    const programRows=[...document.querySelectorAll('[id="program-list"]')].slice(0,3).map(e=>({children:[...e.children].map(c=>({tag:c.tagName,cls:c.className})),parentClass:e.parentElement?.className}));
    return {current,options,times,artistCells,controls,programRows,programRowCount:document.querySelectorAll('[id="program-list"]').length};
  });
  console.log("TARGET_FACTS",id,stage,JSON.stringify(info));
}
async function searchClick(page){
  const candidates=page.locator('a,button,input[type="submit"],input[type="button"],input[type="image"],[role="button"]').filter({visible:true});
  const matches=[];
  for(const loc of await candidates.all()){
    const yes=await loc.evaluate(e=>/^(検索(?:する)?|Search|GO)$/i.test(String(e.innerText||e.value||e.getAttribute("alt")||e.getAttribute("aria-label")||e.querySelector("img")?.alt||"").trim()));
    if(yes)matches.push(loc);
  }
  console.log("SEARCH_CONTROL_COUNT",matches.length);
  if(matches.length!==1)throw Error("Search control not unique");
  await matches[0].click({timeout:10000});
  await page.waitForTimeout(4000);
}
async function probe(page,id,date){
  const [y,m,d]=date.split("-");
  if(id==="alpha_station"){
    await visit(page,stations[id]);
    await snapshot(page,id,"today");
    let ok=true;
    for(let i=1;i<=2;i++){
      const success=await step(id,"previous_"+i,async()=>{
        const target=jstDates(3)[i].replace(/-/g,".");
        const loc=page.locator("#noa-container .arrow_l").filter({visible:true,hasText:target});
        const first=loc.first();
        if(!await loc.count())throw Error("Previous date control missing: "+target);
        const child=first.locator("a,button,[role=button]").filter({visible:true});
        if(await child.count()===1)await child.click({timeout:10000});else await first.click({timeout:10000});
        await page.waitForTimeout(5000);
        await snapshot(page,id,"previous_"+i);
      });
      if(!success){ok=false;break;}
    }
    return ok;
  }
  if(id==="crossfm"){
    await visit(page,stations[id]);
    const report=async(stage)=>{
      await snapshot(page,id,stage);
      const result=await page.evaluate(()=>{
        const clean=s=>String(s||"").replace(/\s+/g," ").trim();
        const table=document.querySelector("table.songs");
        const rows=[...(table?.rows||[])].filter(r=>r.cells[0]?.tagName==="TD");
        const heading=[...document.querySelectorAll(".p-genre")].find(e=>/オンエア曲/.test(e.innerText));
        const parent=table?.parentElement||heading?.parentElement;
        const links=[...(parent?.querySelectorAll("a,button,input")||[])].filter(e=>!e.closest("table.songs")&&e.getClientRects().length).map(e=>({tag:e.tagName,label:clean(e.innerText||e.value||e.getAttribute("alt")||e.querySelector("img")?.alt).slice(0,80),cls:e.className,href:e.tagName==="A"?e.getAttribute("href")?.slice(0,200):null}));
        return {heading:clean(heading?.innerText),date:document.querySelector('[name="seldate"]')?.value,hour:document.querySelector('[name="selhour"]')?.value,tablePresent:!!table,headers:[...(table?.querySelectorAll("th")||[])].map(e=>clean(e.innerText)),rows:rows.length,invalidRows:rows.filter(r=>r.cells.length!==4||!/^\d{1,2}:\d{2}$/.test(clean(r.cells[0]?.innerText))).length,emptyMessage:rows.length===0?clean(parent?.innerText).slice(0,500):null,links:links.slice(0,30)};
      });
      console.log("CROSS_RESULT",stage,JSON.stringify(result));
    };
    await report("initial");
    let ok=true;
    for(const hour of ["00","05","06","12","13","14","15","23"]){
      const success=await step(id,"hour"+hour,async()=>{
        await (await uniqueVisible(page,'select[name="seldate"]')).selectOption(date,{timeout:5000});
        await (await uniqueVisible(page,'select[name="selhour"]')).selectOption(hour,{timeout:5000});
        await submitFor(await uniqueVisible(page,'select[name="seldate"]'));
        await page.waitForTimeout(4000);
        await report("hour"+hour);
      });
      if(!success){ok=false;break;}
      await page.waitForTimeout(3000);
    }
    return ok;
  }
  if(id==="fm_yokohama"){
    await visit(page,stations[id]);
    const programOK=await step(id,"program_search",async()=>{
      const link=page.getByText("番組名で検索",{exact:true}).filter({visible:true});
      if(await link.count()!==1)throw Error("Program search link not unique");
      await link.click({timeout:10000});
      await page.waitForTimeout(3000);
      for(const [sel,v] of Object.entries({"#ReqYear":y,"#ReqMon":m,"#ReqDay":d}))await (await uniqueVisible(page,sel)).selectOption(v,{timeout:5000});
      const next=page.getByText("次へ",{exact:true}).filter({visible:true});
      if(await next.count()!==1)throw Error("Next control not unique");
      await next.click({timeout:10000});
      await page.waitForTimeout(5000);
      await snapshot(page,id,"program_after_next");
      const details=await page.evaluate(()=>{
        const clean=s=>String(s||"").replace(/\s+/g," ").trim();
        const root=document.querySelector(".program-wrap");
        const controls=[...(root?.querySelectorAll("a,button,select,input,[role=button]")||[])].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,id:e.id,cls:e.className,name:e.name,label:clean(e.innerText||e.value||e.getAttribute("aria-label")).slice(0,100),options:e.tagName==="SELECT"?[...e.options].map(o=>({value:o.value,label:clean(o.textContent)})):undefined,parentClass:e.parentElement?.className}));
        return {controls:controls.slice(0,80),programInfo:[...(root?.querySelectorAll(".program-info,.program,.table-title")||[])].slice(0,30).map(e=>({cls:e.className,text:clean(e.innerText).slice(0,120),children:[...e.children].map(c=>({tag:c.tagName,cls:c.className}))}))};
      });
      console.log("PROGRAM_CHOICES",JSON.stringify(details));
      const selects=page.locator(".program-wrap select").filter({visible:true});
      const choices=[];
      for(const loc of await selects.all()){
        const data=await loc.evaluate(e=>({name:e.name+" "+e.id,options:[...e.options].filter(o=>!o.disabled&&o.value&&!/選択|指定なし/.test(o.textContent)).map(o=>({value:o.value,label:o.textContent.trim()}))}));
        if(/program|bangumi|番組/i.test(data.name)&&data.options.length)choices.push({loc,option:data.options[0]});
      }
      if(choices.length!==1){console.log("PROGRAM_SELECTION_PENDING","Inspect PROGRAM_CHOICES for link or radio controls");return;}
      const p=choices[0];await p.loc.selectOption(p.option.value,{timeout:5000});
      console.log("PROGRAM_SELECTED",p.option.label.slice(0,100));
      await searchClick(page);
      await snapshot(page,id,"program_result");
    });
    const todayOK=await step(id,"today_list",async()=>{
      await visit(page,new URL("/songsearch/today.html",stations[id]).href);
      await snapshot(page,id,"today_list");
      const info=await page.evaluate(()=>({rows:document.querySelectorAll(".table-4 .program-left").length,times:[...document.querySelectorAll(".table-4 .program-left .time")].map(e=>e.innerText.trim()).filter(Boolean),headings:[...document.querySelectorAll(".table-title,.program-info")].slice(0,20).map(e=>e.innerText.trim().slice(0,100))}));
      console.log("TODAY_LIST",JSON.stringify(info));
    });
    return programOK&&todayOK;
  }
  throw Error("Unsupported diagnostic station");
}

async function main(){
  const selected=process.argv[2]||"all";
  const ids=selected==="all"?["crossfm","fm_yokohama"]:[selected];
  if(ids.some(id=>!["alpha_station","crossfm","fm_yokohama"].includes(id)))throw new Error("Unknown station");
  const {browser}=await openBrowser();
  const results=[];
  try{
    for(const id of ids){
      const context=await browser.newContext({locale:"ja-JP",timezoneId:"Asia/Tokyo"});
      const page=await context.newPage();
      console.log("STATION_START",id);
      page.on("framenavigated",f=>{if(f===page.mainFrame())console.log("NAVIGATION",id,f.url().split("?")[0]);});
      page.on("response",r=>{if(r.request().resourceType()==="document")console.log("DOCUMENT",id,r.status(),r.url().split("?")[0]);});
      try{
        const searched=await probe(page,id,jstDates(2)[1]);
        results.push({id,status:searched?"probes_completed":"partial_or_failed"});
      }catch(e){console.log("STATION_ERROR",id,String(e.message).slice(0,500));results.push({id,status:"error"});}
      finally{await context.close();}
      await new Promise(r=>setTimeout(r,3000));
    }
  }finally{await browser.close();}
  console.log("DIAGNOSTIC_SUMMARY",JSON.stringify(results));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
