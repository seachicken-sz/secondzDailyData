"use strict";
const {openBrowser}=require("./common/browser");
const {jstDates}=require("./common/datetime");
const {callGas}=require("./common/gas");
const {specs,collect}=require("./radio/schedule/collectors");
const {dayShift}=require("./radio/schedule/common");
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const gas=(action,extra)=>callGas(process.env.RADIO_WEB_APP_URL,process.env.RADIO_SYNC_TOKEN,action,extra);
async function main(){
 const dry=process.env.RADIO_SCHEDULE_DRY_RUN!=="false",selected=process.env.RADIO_SCHEDULE_STATION||"all";
 if(selected!=="all"&&!Object.hasOwn(specs,selected))throw Error("Unknown station");
 const today=jstDates(1)[0];
 const config=dry?{items:Object.keys(specs).map(station_id=>({station_id}))}:await gas("listRadioSchedules");
 if(!Array.isArray(config.items))throw Error("Invalid station list");
 const ids=config.items.map(x=>x.station_id).filter(id=>Object.hasOwn(specs,id)&&(selected==="all"||selected===id));
 const {browser,context}=await openBrowser();
 const run_id=process.env.GITHUB_RUN_ID?process.env.GITHUB_RUN_ID+"-"+process.env.GITHUB_RUN_ATTEMPT:crypto.randomUUID();
 const run_url=process.env.GITHUB_RUN_ID?"https://github.com/"+process.env.GITHUB_REPOSITORY+"/actions/runs/"+process.env.GITHUB_RUN_ID:"";
 let ok=0,failed=0,syncFailed=0;
 try{for(const id of ids){
 const s=specs[id],entries=[];
 // Past two days only where supported; current + following six days.
 const offsets=[...(s.past?[-2,-1]:[]),0,1,2,3,4,5,6];
 for(const offset of offsets){
  const target_date=dayShift(today,offset),page=await context.newPage();
  const identity={station_id:id,target_date,run_id,run_url};
  try{const result=await collect(page,id,target_date,today);entries.push({...identity,status:"success",items:result.items});ok++;console.log("SCHEDULE_OK",id,target_date,result.items.length,JSON.stringify(result.gaps),result.items[0].schedule_type);}
  catch(e){const error_message=String(e.message||e).slice(0,500);entries.push({...identity,status:"error",error_message});failed++;console.error("SCHEDULE_ERROR",id,target_date,error_message);if(/HTTP (401|403|429)/.test(error_message))break;}
  finally{await page.close();await wait(4000);}
 }
 if(!dry&&entries.length){try{let r;for(let i=0;i<3;i++){try{r=await gas("upsertRadioSchedules",{entries});break;}catch(e){if(i===2)throw e;await wait(4000*(i+1));}}
 if(!Array.isArray(r.results)||r.results.length!==entries.length)throw Error("Invalid sync response");
 r.results.forEach((x,i)=>{if(!x.ok||x.station_id!==entries[i].station_id||x.target_date!==entries[i].target_date){syncFailed++;console.error("SCHEDULE_SYNC_ERROR",id,entries[i].target_date,x.error||"identity mismatch");}});
 }catch(e){syncFailed+=entries.length;console.error("SCHEDULE_BATCH_ERROR",id,e.message);}}
 }}finally{await browser.close();}
 console.log("SCHEDULE_SUMMARY",JSON.stringify({dry,stations:ids.length,ok,failed,syncFailed}));if(failed||syncFailed)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
