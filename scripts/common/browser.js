"use strict";
const {chromium} = require("playwright");
async function openBrowser() {
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext({locale:"ja-JP",timezoneId:"Asia/Tokyo"});
    return {browser,context};
  } catch (e) { await browser.close(); throw e; }
}
async function openPage(page,url) {
  const response = await page.goto(url,{waitUntil:"domcontentloaded",timeout:45000});
  if (!response || !response.ok()) throw new Error("Page HTTP "+response?.status());
  if (new URL(page.url()).origin !== new URL(url).origin) throw new Error("Unexpected redirect");
}
module.exports={openBrowser,openPage};
