const { chromium } = require('playwright');

const GAS_WEB_APP_RANK_URL = process.env.GAS_WEB_APP_RANK_URL;
const GAS_WEB_APP_TOKEN = process.env.GAS_WEB_APP_TOKEN;

const TVER_BASE_URL = 'https://tver.jp';

//取得先URL
const RANKING_TARGETS = [
  {
    type: 'all',
    sheetName: 'ranking_all',
    url: 'https://tver.jp/rankings/episode/all',
  },
  {
    type: 'drama',
    sheetName: 'ranking_drama',
    url: 'https://tver.jp/rankings/episode/drama',
  },
  {
    type: 'variety',
    sheetName: 'ranking_variety',
    url: 'https://tver.jp/rankings/episode/variety',
  },
  {
    type: 'talk',
    sheetName: 'ranking_talk',
    url: 'https://tver.jp/rankings/episode/talk',
  },
  {
    type: 'vtr',
    sheetName: 'ranking_vtr',
    url: 'https://tver.jp/rankings/episode/vtr',
  },
  {
    type: 'local',
    sheetName: 'ranking_local',
    url: 'https://tver.jp/rankings/episode/local',
  },
];

function getJstIsoString(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jst.getUTCDate()).padStart(2, '0');
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const mi = String(jst.getUTCMinutes()).padStart(2, '0');
  const ss = String(jst.getUTCSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+09:00`;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEpisodeId(episodePathOrUrl) {
  const text = String(episodePathOrUrl || '');
  const match = text.match(/\/episodes\/([^/?#]+)/);
  return match ? match[1] : '';
}

function parseBroadcaster(subInfoText) {
  const text = normalizeText(subInfoText);

  if (!text) {
    return '';
  }

  // 例: テレビ朝日 5月26日(火)放送分
  const match = text.match(/^(.+?)\s+\d{1,2}月\d{1,2}日.+放送分$/);
  if (match) {
    return normalizeText(match[1]);
  }

  // 想定外でも先頭の空白区切りを放送局っぽく扱う
  return normalizeText(text.split(/\s+/)[0]);
}

async function autoScroll(page, maxItems = 50) {
  const itemSelector = 'a[href^="/episodes/"]';

  let previousCount = 0;
  let sameCountTimes = 0;

  for (let i = 0; i < 12; i += 1) {
    const count = await page.locator(itemSelector).count();

    if (count >= maxItems) {
      break;
    }

    if (count === previousCount) {
      sameCountTimes += 1;
    } else {
      sameCountTimes = 0;
    }

    if (sameCountTimes >= 3) {
      break;
    }

    previousCount = count;

    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(1200);
  }
}

async function captureRankingTarget(page, target, capturedAt) {
  console.log(`[INFO] Open: ${target.type} ${target.url}`);

  await page.goto(target.url, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {
    console.warn(`[WARN] networkidle timeout: ${target.type}`);
  });

  await page.waitForSelector('a[href^="/episodes/"]', {
    timeout: 30000,
  });

  await autoScroll(page, 50);

const rows = await page.$$eval(
  'a[href*="/episodes/"]',
  (anchors) => {
    const normalize = (value) =>
      String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const uniqueAnchors = [];
    const seen = new Set();

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';

      if (!href.includes('/episodes/')) {
        continue;
      }

      const episodeMatch = href.match(/\/episodes\/([^/?#]+)/);
      const episodeId = episodeMatch ? episodeMatch[1] : '';

      if (!episodeId || seen.has(episodeId)) {
        continue;
      }

      seen.add(episodeId);
      uniqueAnchors.push(a);
    }

    return uniqueAnchors.slice(0, 50).map((a, index) => {
      const href = a.getAttribute('href') || '';

      const rankImg =
        a.querySelector('img[alt$="位"]') ||
        a.querySelector('img[class*="ranking"]') ||
        a.querySelector('img[class*="Ranking"]');

      const rankAlt = rankImg ? rankImg.getAttribute('alt') || '' : '';
      const rankMatch = rankAlt.match(/(\d+)位/);

      const rawLines = String(a.innerText || '')
        .split('\n')
        .map((line) => normalize(line))
        .filter(Boolean)
        .filter((line) => line !== 'あとでみる');

      const broadcastLine =
        rawLines.find((line) => /放送分$/.test(line)) || '';

      const endLine =
        rawLines.find((line) => /終了予定|配信終了/.test(line)) || '';

      const contentLines = rawLines.filter((line) => {
        if (line === broadcastLine) return false;
        if (line === endLine) return false;
        if (/^\d+位$/.test(line)) return false;
        return true;
      });

      const programTitle =
        normalize(
          a.querySelector('[class*="EpisodeListItem_title"]')?.textContent ||
          a.querySelector('[class*="title"]')?.textContent ||
          contentLines[0] ||
          ''
        );

      const episodeTitle =
        normalize(
          a.querySelector('[class*="EpisodeListItem_subTitle"]')?.textContent ||
          a.querySelector('[class*="subtitle"]')?.textContent ||
          a.querySelector('[class*="subTitle"]')?.textContent ||
          contentLines[1] ||
          ''
        );

      return {
        fallbackRank: index + 1,
        rank: rankMatch ? Number(rankMatch[1]) : index + 1,
        program_title: programTitle,
        episode_title: episodeTitle,
        subInfos: broadcastLine ? [broadcastLine] : [],
        episodePath: href,
        debugText: rawLines.join(' | '),
      };
    });
  }
);

console.log(`[DEBUG] ${target.type}: rows=${rows.length}`);
console.log(`[DEBUG] ${target.type}: sample=${JSON.stringify(rows.slice(0, 3), null, 2)}`);
  const items = rows
    .map((row) => {
      const episodeId = extractEpisodeId(row.episodePath);
      const broadcaster = parseBroadcaster(row.subInfos?.[0] || '');

      return {
        rank: row.rank || row.fallbackRank,
        program_title: normalizeText(row.program_title),
        episode_title: normalizeText(row.episode_title),
        broadcaster,
        episodeId,
        capturedAt,
      };
    })
    .filter((item) => item.episodeId && item.program_title);

  if (items.length === 0) {
    throw new Error(`ランキング項目が0件です: ${target.type}`);
  }

  if (items.length < 50) {
    console.warn(`[WARN] ${target.type}: ${items.length}件のみ取得`);
  } else {
    console.log(`[INFO] ${target.type}: ${items.length}件取得`);
  }

  return items;
}

async function postToGas(target, items, capturedAt) {
  if (!GAS_WEB_APP_RANK_URL) {
    throw new Error('GAS_WEB_APP_RANK_URL が未設定です');
  }

  if (!GAS_WEB_APP_TOKEN) {
    throw new Error('GAS_WEB_APP_TOKEN が未設定です');
  }

  const payload = {
    type: 'tverRanking',
    token: GAS_WEB_APP_TOKEN,
    rankingType: target.type,
    sheetName: target.sheetName,
    capturedAt,
    items,
  };

  const res = await fetch(GAS_WEB_APP_RANK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`GAS送信失敗: status=${res.status} body=${text}`);
  }

  console.log(`[INFO] GAS response ${target.type}: ${text}`);
}

function getTargetFilter() {
  const typeArg = process.argv.find((arg) => arg.startsWith('--type='));
  if (!typeArg) {
    return null;
  }

  return typeArg.replace('--type=', '').trim();
}

async function main() {
  const capturedAt = getJstIsoString();
  const targetFilter = getTargetFilter();

  const targets = targetFilter
    ? RANKING_TARGETS.filter((target) => target.type === targetFilter)
    : RANKING_TARGETS;

  if (targets.length === 0) {
    throw new Error(`対象rankingTypeがありません: ${targetFilter}`);
  }

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: {
      width: 1280,
      height: 1600,
    },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
  });

  const page = await context.newPage();

  const results = [];
  const errors = [];

  for (const target of targets) {
    try {
      const items = await captureRankingTarget(page, target, capturedAt);
      await postToGas(target, items, capturedAt);

      results.push({
        rankingType: target.type,
        sheetName: target.sheetName,
        count: items.length,
      });
    } catch (error) {
      console.error(`[ERROR] ${target.type}:`, error);
      errors.push({
        rankingType: target.type,
        message: error.message,
      });
    }
  }

  await browser.close();

  console.log('[INFO] results:', JSON.stringify(results, null, 2));

  if (errors.length > 0) {
    console.error('[WARN] errors:', JSON.stringify(errors, null, 2));
  }

  if (results.length === 0) {
    throw new Error('全カテゴリの取得または保存に失敗しました');
  }
}

main().catch((error) => {
  console.error('[FATAL]', error);
  process.exit(1);
});
