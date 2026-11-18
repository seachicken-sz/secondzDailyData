"use strict";

const { chromium } = require("playwright");

const ARTIST_URL = "https://usen.oshireq.com/artist/984393";
const ARTIST_PATH = "/artist/984393";
const WEB_APP_URL = process.env.USEN_WEB_APP_URL;
const IMPORT_SECRET = process.env.USEN_IMPORT_SECRET;
const MIN_SONGS = 50;
const MAX_SONGS = 500;

async function captureSongs(page) {
  const response = await page.goto(ARTIST_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  if (!response || !response.ok()) {
    throw new Error("USENアーティストページ取得失敗: HTTP " + (response?.status() ?? "no response"));
  }
  const actual = new URL(page.url());
  if (actual.origin !== "https://usen.oshireq.com" || actual.pathname.replace(/\/$/, "") !== ARTIST_PATH) {
    throw new Error("USENアーティストページが別URLへ転送されました: " + actual.pathname);
  }
  await page.locator('a[href*="/song/"]').first().waitFor({
    state: "attached",
    timeout: 20000
  });

  const songs = await page.evaluate(() => {
    const collected = [];
    const seen = new Set();
    const anchors = [...document.querySelectorAll('a[href*="/song/"]')];
    for (const anchor of anchors) {
      const link = new URL(anchor.href, location.href);
      if (link.origin !== "https://usen.oshireq.com") continue;
      const match = link.pathname.match(/^\/song\/(\d{5,12})\/?$/);
      if (!match || seen.has(match[1])) continue;
      // 楽曲カードはアーティスト名も含めたテキストになることがある。
      // 取得対象アーティストの名前だけを先頭から除去する。
      const rawName = (anchor.innerText || anchor.textContent || "").replace(/\s+/g, " ").trim();
      const name = rawName.replace(/^timelesz\s*/i, "").trim();
      if (!name) throw new Error("楽曲名が空です: " + match[1]);
      seen.add(match[1]);
      collected.push({ songId: match[1], name });
    }
    return collected;
  });

  if (songs.length < MIN_SONGS || songs.length > MAX_SONGS) {
    throw new Error("取得曲数が異常です: " + songs.length + "曲（送信中止）");
  }
  const byId = new Set();
  for (const song of songs) {
    if (!/^\d{5,12}$/.test(song.songId) || !song.name || song.name.length > 200) {
      throw new Error("楽曲データが不正です: " + JSON.stringify(song));
    }
    if (byId.has(song.songId)) throw new Error("楽曲IDが重複しています: " + song.songId);
    byId.add(song.songId);
  }

  const titles = new Set(songs.map(song => song.name.toLowerCase().replace(/\s+/g, "")));
  if (!titles.has("消えない花火") || !titles.has("ぎゅっと")) {
    throw new Error("timeleszの楽曲一覧と確認できませんでした（送信中止）");
  }
  return songs;
}

async function sendToGas(songs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(WEB_APP_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: JSON.stringify({ secret: IMPORT_SECRET, songs }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error("GAS受信HTTPエラー: " + response.status);
    let result;
    try { result = await response.json(); }
    catch (_) { throw new Error("GASからJSONが返りません。Webアプリのデプロイを確認してください"); }
    if (!result.ok) throw new Error("GAS処理失敗: " + (result.error || "unknown"));
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  if (!WEB_APP_URL || !IMPORT_SECRET) {
    throw new Error("Actions Secrets USEN_WEB_APP_URL と USEN_IMPORT_SECRET を設定してください");
  }
  const url = new URL(WEB_APP_URL);
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !url.pathname.endsWith("/exec")) {
    throw new Error("USEN_WEB_APP_URL は公開済みGAS Webアプリの /exec URLを指定してください");
  }

  const browser = await chromium.launch({ headless: true });
  let songs;
  try {
    const context = await browser.newContext({
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();
    songs = await captureSongs(page);
  } finally {
    await browser.close();
  }

  console.log("USEN楽曲取得成功: " + songs.length + "曲");
  const result = await sendToGas(songs);
  console.log("GAS反映成功: fetched=" + result.fetched +
    " added=" + result.added +
    " notified=" + result.notified +
    " requestSongSent=" + result.requestSongSent +
    " updateNoticeSent=" + result.updateNoticeSent);
}

if (require.main === module) {
  main().catch(error => {
    console.error("USEN楽曲同期失敗: " + error.message);
    process.exitCode = 1;
  });
}

module.exports = { captureSongs, sendToGas };
