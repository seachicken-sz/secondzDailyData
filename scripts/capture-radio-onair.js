"use strict";
const {callGas}=require("./common/gas");
const {openBrowser}=require("./common/browser");
const {jstDates}=require("./common/datetime");
const collectors={jfn:require("./radio/collectors/jfn").collect};
const gas=(action,extra)=>callGas(process.env.RADIO_WEB_APP_URL,process.env.RADIO_SYNC_TOKEN,action,extra);
async function main(){
  const {items}=await gas("list");
  if(!Array.isArray(items)) throw new Error("Invalid station list");
  if(!items.length){console.log("No enabled and approved stations");return;}
  const {browser,context}=await openBrowser();
  const run_id=process.env.GITHUB_RUN_ID ? process.env.GITHUB_RUN_ID+"-"+process.env.GITHUB_RUN_ATTEMPT : crypto.randomUUID();
  const run_url=process.env.GITHUB_RUN_ID ? "https://github.com/"+process.env.GITHUB_REPOSITORY+"/actions/runs/"+process.env.GITHUB_RUN_ID : "";
  let failures=0;
  try{
    for(const station of items){
      const dates=jstDates(Math.min(7,Math.max(1,Number(station.lookback_days)||3)));
      for(const target_date of dates){
        const log={run_id,run_url,station_id:station.station_id,target_date};
        let page;
        try{
          const collector=collectors[station.collector_type];
          if(!collector) throw new Error("Collector not implemented");
          page=await context.newPage();
          const result=await collector(page,station,target_date);
          const saved=await gas("upsertOnair",{...log,...result});
          console.log(station.station_id,target_date,saved);
        }catch(e){
          failures++;
          const message=String(e.message).slice(0,500);
          console.error(station.station_id,target_date,message);
          await gas("recordFetchLog",{...log,status:"error",error_message:message});
          if(/HTTP (401|403|429)/.test(message)) break;
        }finally{if(page)await page.close();}
        await new Promise(r=>setTimeout(r,4000));
      }
    }
  }finally{await browser.close();}
  if(failures)throw new Error(failures+" capture failures");
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
