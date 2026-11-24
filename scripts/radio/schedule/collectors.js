"use strict";
const {clean,weekday,normalize}=require("./common");
const specs={
 tokyo_fm:{url:"https://www.tfm.co.jp/timetable/",sid:"FMT",past:true,root:".table_program",time:":scope > .table_time",name:":scope > .table_main > .table_ttl"},
 fm_osaka:{url:"https://www.fmosaka.net/timetable",sid:"FMO",past:true,root:".timetable-week .day .program",time:":scope > .program-start,:scope > .program-end",name:":scope > .program-name"},
 fm_fukuoka:{url:"https://www.fmfukuoka.co.jp/timetable/",sid:"FMFUKUOKA",past:true,infer:true,root:"li.radiko",time:":scope > .time",name:":scope > .program > .p_title"},
 fm_niigata:{url:"https://www.fmniigata.com/timetable/",sid:"FMNIIGATA",infer:true,root:".timetable-item",time:":scope > .date",name:":scope > .right-content .title"},
 date_fm:{url:"https://datefm.jp/timetable/",sid:"",root:".timetable_item",time:":scope > .time",name:":scope > .detail .title,:scope > .detail .program-name,:scope > .detail h2,:scope > .detail h3,:scope > .detail h4"},
 fm_aichi:{url:"https://fma.co.jp/pc/01pro/tt/",sid:"FMAICHI",infer:true,weekly:true,root:"table.tt tr:has(> th):has(> td)",time:":scope > th",name:":scope > td .main_color"},
 kiss_fm:{url:"https://www.kiss-fm.co.jp/timetable/",sid:"KISSFMKOBE",past:true,root:".timetable tr:has(> td.time)",time:":scope > td.time",name:".pg_name"},
 e_radio:{url:"https://www.e-radio.co.jp/timetable/",sid:"E-RADIO",weekly:true},
 kmix:{url:"https://k-mix.co.jp/program",sid:"K-MIX",past:true,root:".tableProgram",time:":scope > .tableProgram__time",name:":scope > .tableProgram__Main > .tableTtl .programTitle,:scope > .tableProgram__Main > .tableTtl h2,:scope > .tableProgram__Main > .tableTtl h3"},
 tokai_radio:{url:"https://www.tokairadio.co.jp/timetable/",sid:"TOKAIRADIO",weekly:true,root:".week.active > section:has(> p.time)",time:":scope > p.time",name:":scope > .ttDtl h2"},
 fm_yokohama:{url:"https://www.fmyokohama.co.jp/timetable",sid:"",past:true,root:".program:has(> .program-head .time)",time:":scope > .program-head .time",name:":scope > .program-head h2,:scope > .program-head h3,:scope > .program-head h4,:scope > .program-head .title,:scope > .program-head .program-title,:scope > .program-head .program-name"},
 nack5:{url:"https://www.nack5.co.jp/timetable/",sid:"NACK5",root:".program-item",time:":scope > .program-item-header .program-on-air-time",name:":scope > .program-item-body:not(.program-insert) .program-title,:scope > .program-item-body:not(.program-insert) .program-name,:scope > .program-item-body:not(.program-insert) h2,:scope > .program-item-body:not(.program-insert) .title"},
 alpha_station:{url:"https://fm-kyoto.jp/timetable",sid:"ALPHA-STATION",root:".timetable-content-item",time:":scope > .content > .time",name:":scope > .content h2,:scope > .content h3,:scope > .content .title,:scope > .content .program-name"}
};
async function go(page,url){const r=await page.goto(url,{waitUntil:"domcontentloaded",timeout:45000});if(!r?.ok())throw Error("HTTP "+r?.status());if(new URL(page.url()).hostname.replace(/^www\./,"")!==new URL(url).hostname.replace(/^www\./,""))throw Error("Unexpected redirect");}
async function click(page,loc){const l=loc.filter({visible:true});if(await l.count()!==1)throw Error("Date control not unique");await l.click({timeout:12000});}
async function read(page,id,s,date,calendar){
 return page.evaluate(({id,s,date,calendar})=>{
 const txt=e=>String(e?.innerText||e?.textContent||"").normalize("NFKC").replace(/\s+/g," ").trim();
 const vis=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden";
 const day=["sun","mon","tue","wed","thu","fri","sat"][new Date(date+"T00:00:00Z").getUTCDay()],compact=date.replace(/-/g,""),md=+date.slice(5,7)+"/"+ +date.slice(8);
 let evidence=false,terminal=false,rows=[];
 const active=(sel)=>[...document.querySelectorAll(sel)].filter(vis);
 if(id==="e_radio"){
  const panel=document.querySelector("#javascript_tab > #"+day+".day");
  if(!panel)return {evidence:false,rows:[],terminal:false};
  evidence=true;
  rows=[...panel.querySelectorAll(".timetable_all > .timetable_main")].map(e=>{
    const time=txt(e.querySelector(":scope > .time_area"));
    const names=[...e.querySelectorAll(":scope > .detail_area > ul > li .name")];
    return {time,name:txt(names[0]),links:[],detailCount:names.length};
  });
 }else{
  let spec=s;
  if(calendar)spec={root:".program-wrap #result tr:has(td.title a)",time:":scope > td.time",name:"td.title a"};
  const roots=active(spec.root);
  rows=roots.map(e=>{
   const times=[...e.querySelectorAll(spec.time)].map(txt).filter(Boolean);
   let names=[...e.querySelectorAll(spec.name)].filter(vis).filter(n=>!n.closest(".tt_corner,.corner,.corners,.corner-pro,.program-corner,.programDetail")).map(txt).filter(Boolean);
   if(id==="date_fm"&&!names.length||id==="alpha_station"&&!names.length)names=[...e.querySelectorAll("h2,h3,h4,.program-title,.program-name,.program_title,.program_name,.title,.p_title,.programTitle")].filter(vis).map(txt).filter(Boolean);
   names=[...new Set(names)];if(id==="tokai_radio")names=names.slice(0,1);
   return {time:[...new Set(times)].join(" "),name:names.length===1?names[0]:"",links:[...e.querySelectorAll("a[href]")].filter(vis).map(a=>a.href),marker:id==="fm_aichi"&&/曜日の番組表/.test(txt(e.querySelector("td")))};
  });
  if(id==="fm_aichi"&&rows.at(-1)?.marker&&rows.at(-1).time==="05:00"){terminal=true;rows.pop();}
  if(id==="tokyo_fm")evidence=active("a.week_link.active").some(a=>a.getAttribute("href")?.includes(compact));
  if(id==="fm_osaka")evidence=[...document.querySelectorAll("input:checked")].some(a=>txt(a.labels?.[0]).startsWith(md+" "));
  if(id==="fm_fukuoka"||id==="fm_niigata")evidence=location.href.includes(compact)&&rows.length>0;
  if(id==="kiss_fm")evidence=location.pathname.includes(date)&&document.body.innerText.includes(+date.slice(0,4)+"年"+ +date.slice(5,7)+"月"+ +date.slice(8)+"日");
  if(id==="kmix")evidence=active("a.weekLink.-active").some(a=>a.getAttribute("href")?.includes(date));
  if(id==="date_fm")evidence=location.hash==="#"+compact;
  if(id==="fm_aichi")evidence=new URL(location.href).searchParams.get("p")===String(new Date(date+"T00:00:00Z").getUTCDay()||7)&&terminal;
  if(id==="tokai_radio")evidence=!!document.querySelector(".week."+day+".active");
  if(id==="nack5")evidence=active("li.current").some(a=>txt(a).startsWith(md+"("));
  if(id==="alpha_station")evidence=active(".timetable-nav-item.active").some(a=>txt(a).includes(md));
  if(id==="fm_yokohama")evidence=calendar?["ReqYear","ReqMon","ReqDay"].map(k=>document.getElementById(k)?.value||"").join("-")===date:active(".article-nav .current").some(a=>txt(a).toLowerCase().includes(day));
 }
 return {evidence,rows,terminal};
 },{id,s,date,calendar});
}
async function collect(page,id,date,today){
 const s=specs[id];if(!s)throw Error("Unsupported station");
 if(date<today&&!s.past&&!s.weekly)throw Error("Past schedule unavailable");
 const d=date.replace(/-/g,""),day=weekday(date),md=+date.slice(5,7)+"/"+ +date.slice(8);
 let url=s.url,calendar=id==="fm_yokohama"&&date<today;
 if(id==="tokyo_fm")url+="?date="+d;
 if(id==="fm_fukuoka")url+="index.php?ymd="+d;
 if(id==="fm_niigata")url+=d;
 if(id==="kiss_fm")url+=date+"/";
 if(id==="kmix")url+="?date="+date;
 if(id==="nack5")url+=d+".html";
 if(id==="fm_aichi")url+="?p="+(new Date(date+"T00:00:00Z").getUTCDay()||7);
 if(id==="fm_yokohama")url=calendar?"https://www.fmyokohama.co.jp/songsearch/program-form.html":s.url+"/"+day;
 await go(page,url);await page.waitForTimeout(4000);
 if(id==="fm_osaka")await click(page,page.locator("label").filter({has:page.locator(".date").filter({hasText:new RegExp("^"+md+"$")})}));
 if(id==="date_fm")await click(page,page.locator("a[href$='#"+d+"']"));
 if(id==="alpha_station")await click(page,page.locator(".timetable-nav-item").filter({has:page.locator(".timetable-nav-item-date").filter({hasText:new RegExp("^"+md+"$")})}));
 if(id==="tokai_radio")await click(page,page.locator("a.fontEn").filter({hasText:new RegExp("^"+day.toUpperCase()+"$")}));
 if(calendar){const [y,m,k]=date.split("-");for(const [sel,v] of [["#ReqYear",y],["#ReqMon",m],["#ReqDay",k]])await page.locator(sel).filter({visible:true}).selectOption(v,{timeout:10000});await click(page,page.locator(".program-wrap .program-sort-btn a").filter({hasText:/^次へ$/}));}
 let prev="",stable=0,last;
 for(let i=0;i<15;i++){last=await read(page,id,s,date,calendar);const sig=JSON.stringify(last);stable=sig===prev?stable+1:0;prev=sig;if(stable>=2&&last.evidence&&last.rows.length>1)break;await page.waitForTimeout(2000);}
 if(!last?.evidence||stable<2)throw Error("Date or stable schedule not verified");
 if(s.infer&&id==="fm_aichi"&&!last.terminal)throw Error("Missing next day marker");
 const result=normalize(last.rows,date,id,s.sid,page.url(),{calendar,infer:!!s.infer,terminal:last.terminal,weekly:!!s.weekly||id==="fm_yokohama"&&!calendar});
 if(["fm_fukuoka","fm_niigata"].includes(id)&&result.items.some(x=>x.radiko_source!=="official"))throw Error("Official dated radiko link mismatch");
 if(id==="e_radio"&&last.rows.some(x=>x.detailCount>1))console.log("E_RADIO parent slot with nested entries",date,last.rows.filter(x=>x.detailCount>1).length);
 return result;
}
module.exports={specs,collect};
