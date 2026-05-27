const { chromium } = require('playwright');

const GAS_WEB_APP_URL = process.env.TVER_ENGAGEMENT_GAS_WEB_APP_URL;
const GAS_WEB_APP_TOKEN = process.env.GAS_WEB_APP_TOKEN;

const TARGETS_ACTION = 'targets';
const SAVE_ACTION = 'saveCaptureResult';

function getJstDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    yyyy: parts.year,
    mm: parts.month,
    dd: parts.day,
    hh: parts.hour,
    mi: parts.minute,
    ss: parts.second,
  };
}

function getJstIsoString(date = new Date()) {
  const { yyyy, mm, dd, hh, mi, ss } = getJstDateParts(date);
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+09:00`;
}

function getJstHourKey(date = new Date()) {
  const { yyyy, mm, dd, hh } = getJstDateParts(date);
  return `${yyyy}-${mm}-${dd} ${hh}:00`;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertEnv() {
  const missing = [];

  if (!GAS_WEB_APP_URL) missing.push('TVER_ENGAGEMENT_GAS_WEB_APP_URL');
  if (!GAS_WEB_APP_TOKEN) missing.push('GAS_WEB_APP_TOKEN');

  if (missing.length > 0) {
    throw new Error(`${missing.join(', ')} が未設定です`);
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 1000)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON parse failed: ${text.slice(0, 1000)}`);
  }
}

function buildGasUrl(action) {
  const url = new URL(GAS_WEB_APP_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', GAS_WEB_APP_TOKEN);
  return url.toString();
}

async function fetchTargetsFromGas() {
  const url = buildGasUrl(TARGETS_ACTION);

  const json = await fetchJson(url, {
    method: 'GET',
  });

  if (!json.ok) {
    throw new Error(`GAS targets failed: ${JSON.stringify(json)}`);
  }

  return {
    programs: Array.isArray(json.programs) ? json.programs : [],
    episodes: Array.isArray(json.episodes) ? json.episodes : [],
  };
}

async function postResultToGas(payload) {
  const url = buildGasUrl(SAVE_ACTION);

  const json = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      action: SAVE_ACTION,
      token: GAS_WEB_APP_TOKEN,
      ...payload,
    }),
  });

  if (!json.ok) {
    throw new Error(`GAS save failed: ${JSON.stringify(json)}`);
  }

  return json;
}

function parseJapaneseCountText(text) {
  const raw = normalizeText(text)
    .replace(/,/g, '')
    .replace(/\s/g, '');

  if (!raw) return null;

  if (raw.includes('万')) {
    const n = Number(raw.replace('万', ''));
    return Number.isFinite(n) ? Math.round(n * 10000) : null;
  }

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getRawSampleFromText(text) {
  const normalized = normalizeText(text);
  return normalized.slice(0, 1000);
}

async function waitForPageReady(page, url) {
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page
    .waitForLoadState('networkidle', {
      timeout: 45000,
    })
    .catch(() => {
      console.warn(`[WARN] networkidle timeout: ${url}`);
    });

  await page.waitForTimeout(1500);
}

async function captureProgramFavorite(page, program) {
  console.log(`[INFO] program favorite open: ${program.programId} ${program.url}`);

  await waitForPageReady(page, program.url);

  const locator = page.locator('[class*="FavoriteButton_count"]').first();

  await locator.waitFor({
    state: 'visible',
    timeout: 30000,
  });

  const favoriteText = normalizeText(await locator.innerText());
  const favoriteCount = parseJapaneseCountText(favoriteText);

  if (favoriteCount === null) {
    throw new Error(`favorite_count parse failed: text=${favoriteText}`);
  }

  return {
    programId: program.programId,
    title: program.title,
    url: program.url,
    favoriteCount,
    favoriteText,
  };
}

async function captureEpisodeLike(page, episode) {
  console.log(`[INFO] episode like open: ${episode.episodeId} ${episode.url}`);

  await waitForPageReady(page, episode.url);

  const locator = page
    .locator('button[aria-label="いいね登録"] [class*="IconButton_label"]')
    .first();

  await locator.waitFor({
    state: 'visible',
    timeout: 30000,
  });

  const likeText = normalizeText(await locator.innerText());
  const likeCount = parseJapaneseCountText(likeText);

  if (likeCount === null) {
    throw new Error(`like_count parse failed: text=${likeText}`);
  }

  return {
    programId: episode.programId,
    episodeId: episode.episodeId,
    programTitle: episode.programTitle,
    episodeTitle: episode.episodeTitle,
    url: episode.url,
    likeCount,
    likeText,
  };
}

async function safeCaptureProgram(page, program) {
  try {
    const item = await captureProgramFavorite(page, program);

    console.log(
      `[OK] program ${item.programId}: favorite=${item.favoriteCount} text=${item.favoriteText}`
    );

    return {
      item,
      error: null,
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    let rawSample = '';

    try {
      rawSample = getRawSampleFromText(await page.locator('body').innerText({ timeout: 3000 }));
    } catch (_) {
      rawSample = '';
    }

    console.warn(`[WARN] program ${program.programId}: ${message}`);

    return {
      item: null,
      error: {
        targetType: 'program_favorite',
        targetId: program.programId,
        title: program.title,
        url: program.url,
        message,
        rawSample,
      },
    };
  }
}

async function safeCaptureEpisode(page, episode) {
  try {
    const item = await captureEpisodeLike(page, episode);

    console.log(
      `[OK] episode ${item.episodeId}: like=${item.likeCount} text=${item.likeText}`
    );

    return {
      item,
      error: null,
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    let rawSample = '';

    try {
      rawSample = getRawSampleFromText(await page.locator('body').innerText({ timeout: 3000 }));
    } catch (_) {
      rawSample = '';
    }

    console.warn(`[WARN] episode ${episode.episodeId}: ${message}`);

    return {
      item: null,
      error: {
        targetType: 'episode_like',
        targetId: episode.episodeId,
        title: episode.episodeTitle || episode.programTitle,
        url: episode.url,
        message,
        rawSample,
      },
    };
  }
}

async function main() {
  assertEnv();

  const capturedAt = getJstIsoString();
  const captureHourKey = getJstHourKey();

  console.log(`[INFO] capturedAt=${capturedAt}`);
  console.log(`[INFO] captureHourKey=${captureHourKey}`);

  const targets = await fetchTargetsFromGas();

  console.log(`[INFO] programs=${targets.programs.length}`);
  console.log(`[INFO] episodes=${targets.episodes.length}`);

  if (targets.programs.length === 0 && targets.episodes.length === 0) {
    throw new Error('取得対象が0件です');
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

  const programFavorites = [];
  const episodeLikes = [];
  const errors = [];

  for (const program of targets.programs) {
    const result = await safeCaptureProgram(page, program);

    if (result.item) {
      programFavorites.push(result.item);
    }

    if (result.error) {
      errors.push(result.error);
    }
  }

  for (const episode of targets.episodes) {
    const result = await safeCaptureEpisode(page, episode);

    if (result.item) {
      episodeLikes.push(result.item);
    }

    if (result.error) {
      errors.push(result.error);
    }
  }

  await browser.close();

  const successCount = programFavorites.length + episodeLikes.length;

  await postResultToGas({
    capturedAt,
    captureHourKey,
    programFavorites,
    episodeLikes,
    errors,
  });

  console.log(
    '[INFO] saved:',
    JSON.stringify(
      {
        programFavorites: programFavorites.length,
        episodeLikes: episodeLikes.length,
        errors: errors.length,
      },
      null,
      2
    )
  );

  if (successCount === 0) {
    throw new Error('全件の取得に失敗しました');
  }
}

main().catch((error) => {
  console.error('[FATAL]', error);
  process.exit(1);
});
