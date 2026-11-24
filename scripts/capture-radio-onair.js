"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {callGas}=require("./common/gas");
const {openBrowser}=require("./common/browser");
const {jstDates}=require("./common/datetime");
const collectors={jfn:require("./radio/collectors/jfn").collect,nack5:require("./radio/collectors/nack5").collect,tokairadio:require("./radio/collectors/tokairadio").collect,alpha_station:require("./radio/collectors/alpha-station").collect,alpha:require("./radio/collectors/alpha-station").collect};
const gas=(action,extra)=>callGas(process.env.RADIO_WEB_APP_URL,process.env.RADIO_SYNC_TOKEN,action,extra);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const errorText=e=>String(e?.message||e).slice(0,500);
const isTransient=e=>["TimeoutError","AbortError"].includes(e?.name)||e?.message==="fetch failed"||/^GAS HTTP (408|429|5\d\d)$/.test(e?.message||"");
async function retry(action,extra){
  for(let i=0;i<3;i++){
    try{return await gas(action,extra);}
    catch(e){
      if(i===2||!isTransient(e))throw e;
      console.warn("Retry",action,i+1,errorText(e));
      await wait(2000*2**i);
    }
  }
}
const checkpointPath=path.join("radio-recovery","pending.json");
function checkpoint(state){
  fs.mkdirSync(path.dirname(checkpointPath),{recursive:true,mode:0o700});
  fs.writeFileSync(checkpointPath+".tmp",JSON.stringify(state),{mode:0o600});
  fs.renameSync(checkpointPath+".tmp",checkpointPath);
}
function validateBatchResponse(response,entries){
  if(!Array.isArray(response.results)||response.results.length!==entries.length)throw new Error("Invalid batch response");
  return response.results.map((r,i)=>{
    const e=entries[i];
    if(!r||r.station_id!==e.station_id||r.target_date!==e.target_date||typeof r.ok!=="boolean")throw new Error("Invalid batch result identity");
    return r;
  });
}
async function flush(state,batch){
  let syncFailures=0;
  for(const [key,action,legacyAction] of [["data","upsertOnairBatch","upsertOnair"],["logs","recordFetchLogsBatch","recordFetchLog"]]){
    const pending=state[key];
    if(!pending.length)continue;
    if(batch){
      // Server returns a result for every item in input order.
      // Successful entries are removed from the recovery checkpoint.
      const entries=pending.slice();
      try{
        const response=await retry(action,{entries});
        const results=validateBatchResponse(response,entries);
        state[key]=entries.filter((e,i)=>{
          const r=results[i];
          console.log("SYNC",key,e.station_id,e.target_date,r.ok?"ok":"failed",r.ok?"":String(r.error||"Unknown error").slice(0,500));
          if(!r.ok)syncFailures++;
          return !r.ok;
        });
        checkpoint(state);
      }catch(e){
        syncFailures+=entries.length;
        console.error("BATCH_SYNC_ERROR",key,errorText(e));
      }
    }else{
      // Compatibility mode: do not repeat ambiguous legacy writes automatically.
      for(const entry of pending.slice()){
        try{
          await gas(legacyAction,entry);
          state[key]=state[key].filter(e=>e!==entry);
          checkpoint(state);
          console.log("LEGACY_SYNC",key,entry.station_id,entry.target_date,"ok");
        }catch(e){
          syncFailures++;
          console.error("LEGACY_SYNC_ERROR",key,entry.station_id,entry.target_date,errorText(e));
        }
      }
    }
  }
  return syncFailures;
}
async function main(){
  const config=await retry("list");
  const {items}=config;
  if(!Array.isArray(items))throw new Error("Invalid station list");
  const batch=config.batch_version===1;
  console.log("Sync mode:",batch?"batch v1":"legacy compatible");
  const state={version:1,data:[],logs:[]};
  if(process.argv[2]==="--resume"){
    const source=process.argv[3];
    if(!source)throw new Error("Missing recovery JSON");
    const saved=JSON.parse(fs.readFileSync(source,"utf8"));
    if(saved.version!==1||!Array.isArray(saved.data)||!Array.isArray(saved.logs))throw new Error("Invalid recovery JSON");
    if(!batch)throw new Error("Resume requires batch v1");
    state.data=saved.data;state.logs=saved.logs;
    checkpoint(state);
    const syncFailures=await flush(state,batch);
    if(syncFailures)throw new Error(syncFailures+" pending sync failures");
    fs.rmSync(checkpointPath,{force:true});
    return;
  }
  if(!items.length){console.log("No enabled and approved stations");return;}
  const {browser,context}=await openBrowser();
  const run_id=process.env.GITHUB_RUN_ID?process.env.GITHUB_RUN_ID+"-"+process.env.GITHUB_RUN_ATTEMPT:crypto.randomUUID();
  const run_url=process.env.GITHUB_RUN_ID?"https://github.com/"+process.env.GITHUB_REPOSITORY+"/actions/runs/"+process.env.GITHUB_RUN_ID:"";
  let failures=0,skipped=0,succeeded=0,fatal=null;
  checkpoint(state);
  try{
    for(const station of items){
      const dates=jstDates(Math.min(7,Math.max(1,Number(station.lookback_days)||3)));
      let blockedReason="";
      const collector=Object.hasOwn(collectors,station.collector_type)?collectors[station.collector_type]:null;
      for(const target_date of dates){
        const log={run_id,run_url,station_id:station.station_id,target_date};
        if(blockedReason||!collector){
          skipped++;
          const reason=blockedReason||"Collector not implemented";
          state.logs.push({...log,status:"skipped",error_message:reason});
          console.log(station.station_id,target_date,"skipped:",reason);
          checkpoint(state);
          continue;
        }
        let page;
        try{
          page=await context.newPage();
          const result=await collector(page,station,target_date);
          state.data.push({...log,...result});
          succeeded++;
          console.log("CAPTURE",station.station_id,target_date,"ok",result.fetched_count);
        }catch(e){
          failures++;
          const message=errorText(e);
          state.logs.push({...log,status:"error",error_message:message});
          console.error("CAPTURE_ERROR",station.station_id,target_date,message);
          if(/HTTP (401|403|429)|Date (form|submit) not recognized|Unverified song table/.test(message))blockedReason=("Earlier date failed: "+message).slice(0,500);
        }finally{
          if(page)await page.close().catch(e=>console.warn("Page close",errorText(e)));
          checkpoint(state);
        }
        await wait(4000);
      }
    }
  }catch(e){fatal=e;}
  finally{await browser.close().catch(e=>console.warn("Browser close",errorText(e)));}
  // Collection and sync have distinct error counters and no per-date network dependency.
  const syncFailures=await flush(state,batch);
  console.log({succeeded,skipped,failures,syncFailures,pendingData:state.data.length,pendingLogs:state.logs.length});
  if(!state.data.length&&!state.logs.length)fs.rmSync(checkpointPath,{force:true});
  if(fatal)throw fatal;
  if(failures||syncFailures)throw new Error(failures+" capture failures; "+syncFailures+" sync failures");
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
