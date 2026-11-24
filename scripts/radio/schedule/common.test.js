"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {normalize,radikoTime,linkFor,stamp}=require("./common");
test("extended hours",()=>assert.equal(radikoTime("20261124240000"),Date.parse(stamp("2026-11-24",1440))));
test("explicit coverage",()=>{const r=normalize([{name:"A",time:"05:00-24:00"},{name:"B",time:"24:00-29:00"}],"2026-11-24","test","FMT","https://example.com");assert.equal(r.items.length,2);assert.equal(r.items[1].start_at,"2026-11-24T15:00:00.000Z");});
test("inferred boundary",()=>{const r=normalize([{name:"A",time:"05:00"},{name:"B",time:"28:00"}],"2026-11-24","test","","https://example.com",{infer:true});assert.equal(r.items[1].end_source,"broadcast_day_boundary_assumed");});
test("reject gap",()=>assert.throws(()=>normalize([{name:"A",time:"05:00-06:00"},{name:"B",time:"07:00-29:00"}],"2026-11-24","test","","https://example.com")));
test("nested calendar",()=>assert.equal(normalize([{name:"A",time:"00:00-12:00"},{name:"sub",time:"05:00-06:00"},{name:"B",time:"12:00-24:00"}],"2026-11-24","test","","https://example.com",{calendar:true}).items.length,2));
test("official link",()=>assert.equal(linkFor(["https://radiko.jp/share/?sid=FMT&t=20261124240000"],"FMT",stamp("2026-11-24",1440)).radiko_source,"official"));
