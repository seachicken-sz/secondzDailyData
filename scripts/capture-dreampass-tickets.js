const { chromium } = require("playwright");

const WEB_APP_URL = process.env.DREAMPASS_WEB_APP_URL;
const SYNC_TOKEN = process.env.DREAMPASS_SYNC_TOKEN;
const BASE = "https://www.dreampass.jp";

function titleKey(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function buildTitleIndex(targets) {
  const index = new Map();
  for (const target of targets) {
    const names = [target.title, ...String(target.matchTitles || "").split(/[\n|｜]+/)];
    for (const name of names) {
      const key = titleKey(name);
      if (!key) continue;
      const previous = index.get(key);
      if (previous && previous.title !== target.title) {
        throw new Error("照合名が複数作品に重複しています: " + name);
      }
      index.set(key, target);
    }
  }
  return index;
}

async function callGas(action, extra = {}) {
  const response = await fetch(WEB_APP_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, token: SYNC_TOKEN, ...extra }),
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error("GAS HTTPエラー: " + response.status);
  let data;
  try {
    data = await response.json();
  } catch (_) {
    throw new Error("GASがJSONを返しません。公開設定とデプロイを確認してください");
  }
  if (!data.ok) throw new Error(data.error || "GASエラー");
  return data;
}

async function openPage(page, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });
      if (!response || !response.ok()) {
        throw new Error("ドリパス HTTPエラー: " + response?.status());
      }
      const actual = new URL(page.url());
      if (actual.origin !== BASE ||
          actual.pathname.replace(/\/$/, "") !== new URL(url).pathname.replace(/\/$/, "")) {
        throw new Error("別のページへ転送されました");
      }
      await page.locator(".main").first().waitFor({ state: "attached", timeout: 15000 });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
      await page.waitForTimeout(2000);
    }
  }
}

async function readListing(page, url) {
  await openPage(page, url);
  return page.evaluate(() => {
    const root = document.querySelector(".main");
    const heading = [...root.querySelectorAll("h1,h2,h3")].find(el =>
      (el.textContent || "").replace(/\s/g, "").includes("販売中のチケット一覧")
    );
    if (!heading) throw new Error("販売中一覧の見出しがありません");

    const after = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const past = [...root.querySelectorAll("a")].find(el =>
      after(heading, el) && /過去のチケット一覧/.test(el.textContent || "")
    );
    // 一覧本体とサイドバー・過去一覧の境界が不明なら更新しない。
    if (!past) throw new Error("チケット一覧の終端を判定できません");

    const events = new Map();
    for (const link of root.querySelectorAll("a[href]")) {
      if (!after(heading, link) || !after(link, past)) continue;
      const parsed = new URL(link.href);
      const match = parsed.pathname.match(/^\/e(\d+)\/?$/);
      if (parsed.origin !== location.origin || !match) continue;
      events.set(match[1], location.origin + "/e" + match[1]);
    }

    const pages = new Set();
    for (const link of root.querySelectorAll(".pagination a[href], .pager a[href], a[rel='next']")) {
      const parsed = new URL(link.href);
      if (parsed.origin !== location.origin) continue;
      if (!/^\/events(?:\/\d+)?\/?$/.test(parsed.pathname)) continue;
      if (parsed.search && !/^\?page=\d+$/.test(parsed.search)) {
        throw new Error("未対応のページ送りです: " + parsed.pathname);
      }
      parsed.hash = "";
      pages.add(parsed.href);
    }

    const range = document.createRange();
    range.setStartAfter(heading);
    range.setEndBefore(past);
    const content = range.cloneContents().textContent || "";
    if (!events.size && !/チケット.*(?:ありません|ございません)|販売中.*(?:ありません|ございません)/.test(content)) {
      throw new Error("イベントを抽出できません。前回データを保持します");
    }
    return { events: [...events], pages: [...pages] };
  });
}

async function readEvent(page, eventId, url) {
  await openPage(page, url);
  return page.evaluate(({ eventId, url }) => {
    const root = document.querySelector(".main");
    const box = root.querySelector(".leftTicket");
    const eventTitle = [...root.querySelectorAll("h1")]
      .map(el => (el.textContent || "").trim()).find(Boolean);
    const titles = [...root.querySelectorAll(".eventProducts h3 a[href]")]
      .filter(el => /^\/m\d+\/?$/.test(new URL(el.href).pathname))
      .map(el => (el.textContent || "").trim()).filter(Boolean);

    if (!box || !eventTitle || !titles.length) {
      throw new Error("イベントの上映作品・チケット情報を取得できません: " + url);
    }

    const text = (box.innerText || "").replace(/\s+/g, " ");
    const purchase = [...box.querySelectorAll("a[href]")].some(el =>
      new URL(el.href).pathname === "/events/" + eventId + "/payment/new" &&
      el.getClientRects().length > 0
    );
    const label = box.querySelector(".hCount")?.textContent || "";
    let saleStatus = "要確認";
    if (/完売|売り切れ/.test(text)) saleStatus = "完売";
    else if (/販売開始|販売間近/.test(label + text)) saleStatus = "販売前";
    else if (purchase) saleStatus = "販売中";
    else if (/販売終了|募集終了|受付終了/.test(text) && !/販売終了まで/.test(label)) {
      saleStatus = "販売終了";
    }

    const pending = [...box.querySelectorAll(".pending, .btn")]
      .map(el => (el.textContent || "").trim());
    let screeningStatus = pending.find(value => value === "未成立" || value === "成立") || "";
    if (!screeningStatus && /上映決定/.test(text)) screeningStatus = "成立";

    const theater = root.querySelector(".bgAccess .lineAccess")?.textContent.trim() || "";
    const startAt = root.querySelector(".bgAccess .iconTime")?.textContent.trim() || "";
    if (!theater || !startAt) throw new Error("会場または上映日時がありません: " + url);

    return {
      titles: [...new Set(titles)],
      eventId,
      eventTitle,
      url,
      theater,
      startAt,
      saleStatus,
      screeningStatus
    };
  }, { eventId, url });
}

async function main() {
  if (!WEB_APP_URL || !SYNC_TOKEN) throw new Error("Actions Secretsが未設定です");
  const startedAt = new Date().toISOString();
  const { items: targets, revision } = await callGas("ticketTargets");
  if (!Array.isArray(targets) || !targets.length) throw new Error("照合対象がありません");
  const titleIndex = buildTitleIndex(targets);

  const browser = await chromium.launch({ headless: true });
  const items = [];
  let eventCount = 0;
  try {
    const context = await browser.newContext({ locale: "ja-JP", timezoneId: "Asia/Tokyo" });
    const page = await context.newPage();
    const queue = [BASE + "/events"];
    const visited = new Set();
    const events = new Map();

    while (queue.length) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      if (visited.size >= 20) throw new Error("一覧が20ページを超えました");
      const listing = await readListing(page, url);
      visited.add(url);
      for (const [id, eventUrl] of listing.events) events.set(id, eventUrl);
      for (const next of listing.pages) if (!visited.has(next)) queue.push(next);
    }

    eventCount = events.size;
    // 全イベントの「上映情報」で照合。コメント・サイドバーは検索しない。
    for (const [id, url] of events) {
      const event = await readEvent(page, id, url);
      const matched = new Map();
      for (const title of event.titles) {
        const target = titleIndex.get(titleKey(title));
        if (target) matched.set(target.title, target);
      }
      for (const target of matched.values()) {
        const { titles, ...record } = event;
        items.push({ title: target.title, ...record });
        console.log(target.title + " / " + event.saleStatus + " / " + url);
      }
      await page.waitForTimeout(500);
    }
  } finally {
    await browser.close();
  }

  // 途中で1件でも失敗した場合はここに到達せず、前回結果を保持する。
  const saved = await callGas("ticketUpdate", {
    items,
    revision,
    capturedAt: startedAt,
    scanComplete: true,
    eventCount
  });
  console.log("一覧イベント数: " + eventCount + " / 保存件数: " + saved.updated);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { titleKey, buildTitleIndex, readListing, readEvent, main };
