"use strict";
const { openBrowser, openPage } = require("./common/browser");
const { callGas } = require("./common/gas");
const URL = "https://app.stationhead.com/c/secondz";
function parseCount(raw) {
  const m = raw.replace(/,/g, "").match(/^(\d+(?:\.\d+)?)([KM])?$/i);
  if (!m) throw new Error("Invalid count: " + raw);
  const n = Number(m[1]) * ({K:1000,M:1000000}[m[2]?.toUpperCase()] || 1);
  if (!Number.isSafeInteger(Math.round(n)) || (!m[2] && !Number.isInteger(n))) throw new Error("Invalid count");
  return Math.round(n);
}
async function main() {
  if (process.env.STATIONHEAD_CAPTURE_AUTHORIZED !== "true") throw new Error("Stationhead permission required");
  const {browser,context} = await openBrowser();
  let row;
  try {
    const page = await context.newPage();
    await openPage(page, URL);
    if (new globalThis.URL(page.url()).pathname.replace(/\/$/,"") !== "/c/secondz") throw new Error("Unexpected channel");
    const read = async () => {
      const body = await page.locator("body").innerText();
      const get = label => {
        const n = "(\\d[\\d,]*(?:\\.\\d+)?[KM]?)";
        const matches = [...body.matchAll(new RegExp("(?:^|\\n|[ \\t])"+n+"\\s+"+label+"\\b","gi"))];
        if (matches.length !== 1) return null;
        return matches[0][1];
      };
      const members_text = get("Members"), online_text = get("Online");
      return members_text && online_text ? {members_text,online_text} : null;
    };
    let counts;
    for (let i=0;i<20;i++) {
      counts = await read();
      if (counts) break;
      await page.waitForTimeout(1000);
    }
    if (!counts) throw new Error("Members or Online display not found");
    const now = new Date();
    row = {measured_at: new Date(now.getTime()+9*3600000).toISOString().slice(0,19).replace("T"," "), channel_id:"secondz", members:parseCount(counts.members_text), members_text:counts.members_text, online:parseCount(counts.online_text), online_text:counts.online_text, status:"success"};
  } finally { await browser.close(); }
  console.log(JSON.stringify(row));
  await callGas(process.env.STATIONHEAD_GAS_URL,process.env.STATIONHEAD_GAS_TOKEN,"stationhead_history",{row});
}
if (require.main === module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={parseCount};
