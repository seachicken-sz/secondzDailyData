const { chromium } = require("playwright");

const WEB_APP_URL = process.env.DREAMPASS_WEB_APP_URL;
const SYNC_TOKEN = process.env.DREAMPASS_SYNC_TOKEN;

async function callGas(action, extra = {}) {
  const response = await fetch(WEB_APP_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      token: SYNC_TOKEN,
      ...extra
    }),
    signal: AbortSignal.timeout(90000)
  });

  if (!response.ok) {
    throw new Error(`GAS HTTPエラー: ${response.status}`);
  }

  let result;
  try {
    result = await response.json();
  } catch (_) {
    throw new Error("GASからJSONが返りません。デプロイ設定を確認してください");
  }

  if (!result.ok) {
    throw new Error(result.error || "GAS処理に失敗しました");
  }

  return result;
}

async function capture(page, item) {
  const response = await page.goto(item.url, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  if (!response || !response.ok()) {
    throw new Error(`作品ページHTTPエラー: ${response?.status()}`);
  }

  const expectedPath = new URL(item.url).pathname;
  if (new URL(page.url()).pathname !== expectedPath) {
    throw new Error("別のページへ転送されました");
  }

  await page.locator(".rightMovie .hMovie").waitFor({
    state: "attached",
    timeout: 15000
  });

  const result = await page.evaluate(() => {
    const movie = document.querySelector(".rightMovie");
    const heading = movie?.querySelector(".hMovie");
    if (!movie || !heading) throw new Error("作品情報がありません");

    const actionText = movie.querySelector("#actionPrev")
      ?.textContent.trim() || "";
    const candidateText = movie.querySelector(".btnNego")
      ?.textContent.trim() || "";
    const inactiveText = movie.querySelector(".requestNonActive")
      ?.textContent.trim() || "";

    let status;
    if (candidateText === "上映候補" ||
        inactiveText.includes("上映候補入り")) {
      status = "上映候補入り";
    } else if (actionText === "上映リクエスト受付中") {
      status = "投票中";
    } else {
      throw new Error("未対応の状態です。前回値を保持します");
    }

    // 1位の表示。「2位との差」などの順位は抽出しない。
    const digest = movie.querySelector(".rank_digest")
      ?.textContent || "";
    let match = digest.match(/現在\s*([\d,]+)\s*位/);

    // 通常順位は作品見出しより前の順位表示から取得。
    // コメントや関連作品内の順位は対象に含めない。
    if (!match) {
      const range = document.createRange();
      range.selectNodeContents(document.body);
      range.setEndBefore(heading);
      const precedingText = range.cloneContents().textContent || "";
      const matches = [...precedingText.matchAll(/([\d,]+)\s*位/g)];
      if (matches.length) match = matches[matches.length - 1];
    }

    const rank = match ? Number(match[1].replace(/,/g, "")) : null;

    if (status === "投票中" && !Number.isInteger(rank)) {
      throw new Error("投票中ですが順位を取得できません");
    }

    return { status, rank };
  });

  return { url: item.url, ...result };
}

async function main() {
  if (!WEB_APP_URL || !SYNC_TOKEN) {
    throw new Error("必要なActions Secretsが設定されていません");
  }

  const { items } = await callGas("list");
  if (!Array.isArray(items) || !items.length) {
    throw new Error("title_listに巡回対象がありません");
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  let failures = 0;

  try {
    const context = await browser.newContext({
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo"
    });
    const page = await context.newPage();

    // 同じURLが複数行あっても巡回は1回。
    const targets = [...new Map(
      items.map(item => [item.url, item])
    ).values()];

    for (const item of targets) {
      let result;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          result = await capture(page, item);
          break;
        } catch (error) {
          if (attempt === 2) {
            failures++;
            console.error(`${item.title}: ${error.message}`);
          } else {
            await page.waitForTimeout(2000);
          }
        }
      }

      if (result) {
        results.push(result);
        console.log(
          `${item.title}: ${result.status} / ${result.rank ?? "順位なし"}`
        );
      }

      await page.waitForTimeout(1000);
    }
  } finally {
    await browser.close();
  }

  if (results.length) {
    const saved = await callGas("update", { items: results });
    console.log(`スプレッドシート更新: ${saved.updated}行`);
  }

  // 成功分は更新したうえで、失敗があればActionsも失敗として知らせる。
  if (failures) {
    throw new Error(`${failures}作品の取得に失敗しました。前回値は保持しています`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
