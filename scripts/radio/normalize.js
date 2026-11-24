"use strict";
function normalize(s) {return String(s || "").normalize("NFKC").replace(/\s+/g," ").trim();}
function normalizeRows(rows,date) {
  return rows.filter(r=>normalize(r.artist_name).toLowerCase()==="timelesz").map(r=>{
    const m=normalize(r.time).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m || +m[1]>29 || +m[2]>59 || +(m[3]||0)>59 || !normalize(r.song_name)) throw new Error("Invalid song row");
    const d=new Date(Date.parse(date+"T00:00:00+09:00")+(+m[1]*3600 + +m[2]*60 + +(m[3]||0))*1000);
    return {artist_name:normalize(r.artist_name),song_name:normalize(r.song_name),onair_at:d.toISOString(),program_name:normalize(r.program_name)};
  });
}
module.exports={normalize,normalizeRows};
