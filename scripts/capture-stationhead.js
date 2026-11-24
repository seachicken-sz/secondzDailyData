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
  const {browser,context} = await openBrowser();
  let row;
  try {
    const page = await context.newPage();
    await openPage(page, URL);
    if (new globalThis.URL(page.url()).pathname.replace(/\/$/,"") !== "/c/secondz") throw new Error("Unexpected channel");
    const stats = page.locator("div.flex.items-center.gap-3.caption-2").filter({
      hasText: /members[\s\S]*online/i
    });
    let counts;
    try {
      await stats.waitFor({state:"visible",timeout:60000});
      const texts = await stats.locator(":scope > span").allTextContents();
      const get = label => {
        const pattern = new RegExp("^\\s*(\\d[\\d,]*(?:\\.\\d+)?[KM]?)\\s*" + label + "\\s*$","i");
        const matches = texts.map(text => text.match(pattern)).filter(Boolean);
        if (matches.length !== 1) throw new Error(label + " count missing or ambiguous");
        return matches[0][1];
      };
      counts = {members_text:get("members"),online_text:get("online")};
    } catch (error) {
      console.error("Stationhead page title:", await page.title().catch(() => ""));
      console.error("Stationhead page URL:", page.url());
      console.error("Stationhead stats candidates:", JSON.stringify(await page.locator("div.flex.items-center.gap-3.caption-2").allTextContents().catch(() => [])));
      console.error("Stationhead visible text:", (await page.locator("body").innerText({timeout:5000}).catch(() => "")).slice(0,2000));
      throw error;
    }
    const now = new Date();
    row = {measured_at: new Date(now.getTime()+9*3600000).toISOString().slice(0,19).replace("T"," "), channel_id:"secondz", members:parseCount(counts.members_text), members_text:counts.members_text, online:parseCount(counts.online_text), online_text:counts.online_text, status:"success"};
  } finally { await browser.close(); }
  console.log(JSON.stringify(row));
  await callGas(process.env.STATIONHEAD_GAS_URL,process.env.STATIONHEAD_GAS_TOKEN,"stationhead_history",{row});
}
if (require.main === module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={parseCount};
