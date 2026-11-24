"use strict";
const clean=s=>String(s??"").normalize("NFKC").replace(/\s+/g," ").trim();
const dayShift=(d,n)=>new Date(Date.parse(d+"T00:00:00Z")+n*86400000).toISOString().slice(0,10);
const weekday=d=>["sun","mon","tue","wed","thu","fri","sat"][new Date(d+"T00:00:00Z").getUTCDay()];
function minute(s){const m=clean(s).match(/^(\d{1,2}):([0-5]\d)$/);if(!m||+m[1]>30)throw Error("Invalid time "+s);return +m[1]*60+ +m[2];}
function stamp(date,m){return new Date(Date.parse(date+"T00:00:00+09:00")+m*60000).toISOString();}
function radikoTime(t){const m=String(t).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);return m&&+m[4]<=29&&+m[5]<60&&+m[6]<60?Date.parse(m[1]+"-"+m[2]+"-"+m[3]+"T00:00:00+09:00")+(+m[4]*3600+ +m[5]*60+ +m[6])*1000:NaN;}
function linkFor(links,sid,startAt){
 for(const href of links||[]){try{const u=new URL(href);if(u.hostname!=="radiko.jp"||!["http:","https:"].includes(u.protocol))continue;
 const m=u.hash.match(/^#!\/ts\/([^/]+)\/(\d{14})$/),id=u.searchParams.get("sid")||m?.[1],t=u.searchParams.get("t")||m?.[2];
 if(id===sid&&radikoTime(t)===Date.parse(startAt))return {radiko_url:u.href,radiko_source:"official"};
 }catch{}}
 if(!sid)return {radiko_url:"",radiko_source:"unknown"};
 const t=new Date(Date.parse(startAt)+9*3600000).toISOString().slice(0,19).replace(/\D/g,"");
 return {radiko_url:"https://radiko.jp/share/?sid="+encodeURIComponent(sid)+"&t="+t,radiko_source:"generated"};
}
function normalize(raw,date,mode,sid,sourceUrl,{calendar=false,infer=false,terminal=false,weekly=false}={}){
 if(!Array.isArray(raw)||raw.length<2||raw.length>150)throw Error("Invalid schedule row count");
 const begin=calendar?0:300,limit=calendar?1440:1740;
 let rows=raw.map(r=>{
 const name=clean(r.name);if(!name||name.length>500)throw Error("Missing or invalid title");
 const times=clean(r.time).match(/\d{1,2}:[0-5]\d/g)||[];
 if(times.length!==(infer?1:2))throw Error("Invalid time range "+r.time);
 let start=minute(times[0]);if(!calendar&&start<300)start+=1440;
 let end=infer?null:minute(times[1]);if(end!==null&&end<start)end+=1440;
 if(start<begin||start>=limit||end!==null&&(end<=start||end>limit))throw Error("Out-of-range slot "+r.time);
 return {name,start,end,links:r.links||[],end_source:infer?"next_start_inferred":"explicit"};
 });
 if(rows.some((r,i)=>i>0&&r.start<rows[i-1].start))throw Error("Schedule order invalid");
 if(infer){if(rows.some((r,i)=>i>0&&r.start<=rows[i-1].start))throw Error("Duplicate start");rows.forEach((r,i)=>{r.end=rows[i+1]?.start??limit;if(i===rows.length-1)r.end_source=terminal?"next_day_marker":"broadcast_day_boundary_assumed";});}
 // Contained subprograms are not independent main slots; reject crossing overlaps.
 if(calendar){rows=rows.filter((r,i)=>!rows.some((p,j)=>i!==j&&p.start<=r.start&&p.end>=r.end&&(p.start<r.start||p.end>r.end)));}
 let cursor=begin;const gaps=[];
 for(const r of rows){if(r.start<cursor)throw Error("Overlapping main slots");if(r.start>cursor)gaps.push([cursor,r.start]);cursor=r.end;}
 if(cursor<limit)gaps.push([cursor,limit]);
 if(gaps.length&&(!calendar||gaps.some(([a,b])=>b-a>1)))throw Error("Schedule coverage gaps "+JSON.stringify(gaps));
 return {items:rows.map(r=>{const start_at=stamp(date,r.start),end_at=stamp(date,r.end);return {program_name:r.name,start_at,end_at,end_source:r.end_source,schedule_type:weekly?"weekly":"dated",source_url:sourceUrl,...linkFor(r.links,sid,start_at)};}),gaps,mode};
}
module.exports={clean,dayShift,weekday,minute,stamp,radikoTime,linkFor,normalize};
