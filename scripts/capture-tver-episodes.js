const { chromium } = require('playwright');

const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;
const GAS_WEB_APP_TOKEN = process.env.GAS_WEB_APP_TOKEN;

const TVER_BASE_URL = 'https://tver.jp';

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`${name} is not set`);
  }
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 日付・時刻パース用の正規化。
 * - 全角数字を半角へ
 * - 全角コロンを半角へ
 * - ゼロ幅スペースなど不可視文字を除去
 * - 連続空白を1つにする
 */
function normalizeForParse(value) {
  return String(value || '')
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/：/g, ':')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toAbsoluteUrl(href) {
  if (!href) {
    return '';
  }

  if (href.startsWith('http')) {
    return href;
  }

  return `${TVER_BASE_URL}${href}`;
}

function extractEpisodeIdFromHref(href) {
  const match = String(href || '').match(/\/episodes\/([^/?#]+)/);
  return match ? match[1] : '';
}

function extractProgramIdFromUrl(url) {
  const match = String(url || '').match(/\/series\/([^/?#]+)/);
  return match ? match[1] : '';
}

function isBroadcastLabel(text) {
  const normalized = normalizeForParse(text);
  return /\d{1,2}\s*月\s*\d{1,2}\s*日(?:\(.+?\))?\s*放送分/.test(normalized);
}

function isEndLabel(text) {
  return /終了予定/.test(normalizeForParse(text));
}

function getCurrentYearInJst() {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
  });

  const text = formatter.format(new Date());
  const match = text.match(/\d{4}/);

  if (!match) {
    throw new Error(`Failed to parse current year: ${text}`);
  }

  return Number(match[0]);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseBroadcastDateParts(broadcastLabel) {
  const text = normalizeForParse(broadcastLabel);

  const match = text.match(/(?:(\d{4})年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);

  if (!match) {
    console.log({
      reason: 'parseBroadcastDateParts failed',
      broadcastLabel,
      normalized: text,
    });
    return null;
  }

  const year = match[1] ? Number(match[1]) : getCurrentYearInJst();
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    console.log({
      reason: 'parseBroadcastDateParts invalid date',
      broadcastLabel,
      normalized: text,
      year,
      month,
      day,
    });
    return null;
  }

  return {
    year,
    month,
    day,
  };
}

/**
 * program_master.time を読む。
 *
 * 対応例:
 * - 1:00
 * - 01:00
 * - 14:00
 * - 14:00:00
 * - 25:05
 * - 28:00:00
 * - Sat Dec 30 1899 11:56:00 GMT+0900 (Japan Standard Time)
 */
function parseProgramTime(timeText) {
  const text = normalizeForParse(timeText);

  // 通常の時刻文字列。
  let match = text.match(/^(\d{1,2})\s*:\s*(\d{2})(?::\d{2})?$/);

  // Google Sheetsの時刻がDate文字列として渡った場合の救済。
  if (!match) {
    match = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  }

  if (!match) {
    console.log({
      reason: 'parseProgramTime failed',
      timeText,
      normalized: text,
    });
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 47 ||
    minute < 0 ||
    minute > 59
  ) {
    console.log({
      reason: 'parseProgramTime invalid time',
      timeText,
      normalized: text,
      hour,
      minute,
    });
    return null;
  }

  return {
    hour,
    minute,
  };
}

/**
 * broadcast_label の年月日 + program_master.time から start_at を作る。
 *
 * 28時間制:
 * - 24:00以上は翌日に送る
 * - 25:00 => 翌日01:00
 * - 28:00 => 翌日04:00
 */
function buildStartAt(broadcastLabel, programTime) {
  const dateParts = parseBroadcastDateParts(broadcastLabel);
  const timeParts = parseProgramTime(programTime);

  if (!dateParts || !timeParts) {
    console.log({
      reason: 'buildStartAt failed',
      broadcastLabel,
      programTime,
      dateParts,
      timeParts,
    });
    return '';
  }

  const date = new Date(Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    0,
    0,
    0
  ));

  const dayOffset = Math.floor(timeParts.hour / 24);
  const normalizedHour = timeParts.hour % 24;

  date.setUTCDate(date.getUTCDate() + dayOffset);

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  return `${year}-${pad2(month)}-${pad2(day)} ${pad2(normalizedHour)}:${pad2(timeParts.minute)}`;
}

/**
 * start_at の表示用テキストを作る。
 *
 * 0:00〜4:59 は前日の日付で表示する。
 * 曜日は日付計算ではなく program_master.week を使う。
 *
 * 例:
 * start_at = 2026-05-16 01:00
 * week = 金
 * => 5月15日(金) 1:00 放送
 */
function buildStartAtText(startAt, week) {
  const text = normalizeForParse(startAt);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);

  if (!match) {
    if (startAt) {
      console.log({
        reason: 'buildStartAtText failed',
        startAt,
        normalized: text,
        week,
      });
    }
    return '';
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    console.log({
      reason: 'buildStartAtText invalid',
      startAt,
      normalized: text,
      year,
      month,
      day,
      hour,
      minute,
      week,
    });
    return '';
  }

  const displayDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));

  // 深夜0時〜4時台は前日の放送日として表示する
  if (hour >= 0 && hour < 5) {
    displayDate.setUTCDate(displayDate.getUTCDate() - 1);
  }

  const displayMonth = displayDate.getUTCMonth() + 1;
  const displayDay = displayDate.getUTCDate();
  const displayHour = String(hour);

  return `${displayMonth}月${displayDay}日(${week || ''}) ${displayHour}:${pad2(minute)} 放送`;
}

function parseEndAt(endLabel) {
  const text = normalizeForParse(endLabel);

  const match = text.match(
    /(?:(\d{4})年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\(.+?\))?\s*(\d{1,2})\s*:\s*(\d{2})/
  );

  if (!match) {
    return '';
  }

  const year = match[1] ? Number(match[1]) : getCurrentYearInJst();
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    console.log({
      reason: 'parseEndAt invalid',
      endLabel,
      normalized: text,
      year,
      month,
      day,
      hour,
      minute,
    });
    return '';
  }

  return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`;
}

async function fetchProgramsFromGas() {
  const url = new URL(GAS_WEB_APP_URL);

  url.searchParams.set('action', 'programs');
  url.searchParams.set('token', GAS_WEB_APP_TOKEN);

  const response = await fetch(url.toString());
  const text = await response.text();

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Invalid GAS response: ${text}`);
  }

  if (!result.ok) {
    throw new Error(`GAS error: ${JSON.stringify(result)}`);
  }

  return Array.isArray(result.programs) ? result.programs : [];
}

async function captureEpisodesForProgram(page, program) {
  await page.goto(program.url, {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  await page.waitForTimeout(1500);

  const rawEpisodes = await page.evaluate(() => {
    const seasonBlocks = Array.from(
      document.querySelectorAll('[class*="SeasonEpisodeList_season"]')
    );

    const mainSeasonBlock = seasonBlocks.find((block) => {
      const title = block
        .querySelector('[class*="SeasonEpisodeList_title"]')
        ?.textContent
        ?.trim();

      return title === '本編';
    });

    if (!mainSeasonBlock) {
      return [];
    }

    const links = Array.from(
      mainSeasonBlock.querySelectorAll('a[href^="/episodes/"]')
    );

    return links.map((link, index) => {
      const href = link.getAttribute('href') || '';

      const title =
        link.querySelector('[class*="EpisodeListItem_title"]')?.textContent ||
        '';

      const subInfoTexts = Array.from(
        link.querySelectorAll('[class*="EpisodeListItem_subInfo"]')
      ).map((element) => element.textContent || '');

      return {
        href,
        title,
        subInfoTexts,
        index,
      };
    });
  });

  return rawEpisodes
    .map((episode) => {
      const href = episode.href;

      const subInfoTexts = Array.isArray(episode.subInfoTexts)
        ? episode.subInfoTexts.map(normalizeText)
        : [];

      const broadcastLabel = subInfoTexts.find(isBroadcastLabel) || '';
      const endLabel = subInfoTexts.find(isEndLabel) || '';
      const episodeId = extractEpisodeIdFromHref(href);
      const programId = extractProgramIdFromUrl(program.url);
      const startAt = buildStartAt(broadcastLabel, program.time);
      const startAtText = buildStartAtText(startAt, program.week);

      console.log({
        program: program.title,
        week: program.week,
        time: program.time,
        broadcastLabel,
        startAt,
        startAtText,
      });

      return {
        episode_id: episodeId,
        program_id: programId,
        program_title: program.title,
        episode_title: normalizeText(episode.title),
        episode_url: toAbsoluteUrl(href),
        broadcast_label: broadcastLabel,
        start_at: startAt,
        start_at_text: startAtText,
        end_label: endLabel,
        end_at: parseEndAt(endLabel),
        end_flag: false,
        new_flag: episode.index === 0,
        series_url: program.url,
        members: program.members || '',
        memberFlags: program.memberFlags || {},
      };
    })
    .filter((episode) => {
      return (
        episode.episode_id &&
        episode.program_id &&
        episode.program_title &&
        episode.episode_title &&
        episode.broadcast_label
      );
    });
}

async function postEpisodesToGas(episodes, crawledSeriesUrls) {
  const response = await fetch(GAS_WEB_APP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      token: GAS_WEB_APP_TOKEN,
      action: 'upsertEpisodes',
      episodes,
      crawledSeriesUrls,
    }),
  });

  const text = await response.text();

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Invalid GAS response: ${text}`);
  }

  if (!result.ok) {
    throw new Error(`GAS error: ${JSON.stringify(result)}`);
  }

  return result;
}

async function main() {
  requireEnv('GAS_WEB_APP_URL', GAS_WEB_APP_URL);
  requireEnv('GAS_WEB_APP_TOKEN', GAS_WEB_APP_TOKEN);

  const programs = await fetchProgramsFromGas();

  if (programs.length === 0) {
    console.log('No active programs found');
    return;
  }

  console.log(`Programs: ${programs.length}`);

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage();

  const allEpisodes = [];
  const crawledSeriesUrls = [];

  for (const program of programs) {
    try {
      console.log(`Capture: ${program.title} / ${program.url}`);

      const episodes = await captureEpisodesForProgram(page, program);

      console.log(`  episodes: ${episodes.length}`);

      allEpisodes.push(...episodes);
      crawledSeriesUrls.push(program.url);

    } catch (error) {
      console.error(`Failed: ${program.title} / ${program.url}`);
      console.error(error);
    }
  }

  await browser.close();

  console.log(JSON.stringify(allEpisodes, null, 2));

  const uniqueCrawledSeriesUrls = Array.from(new Set(crawledSeriesUrls));

  const result = await postEpisodesToGas(allEpisodes, uniqueCrawledSeriesUrls);

  console.log(`Total: ${result.total}`);
  console.log(`Appended: ${result.appended}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Ended: ${result.ended}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
