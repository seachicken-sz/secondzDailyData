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

function getJapaneseWeekdayFromDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return weekdays[date.getUTCDay()];
}

/**
 * TVerの「5月21日(木)放送分」から、論理放送日を取得する。
 */
function parseBroadcastDateParts(broadcastLabel) {
  const text = normalizeForParse(broadcastLabel);

  const match = text.match(/(?:(\d{4})年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\((.+?)\))?/);

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
  const weekday = match[4] ? String(match[4]).trim() : '';

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
      weekday,
    });
    return null;
  }

  return {
    year,
    month,
    day,
    weekday,
  };
}

/**
 * program_master.time を読む。
 *
 * 今回の前提:
 * - 深夜番組は元シート側で 24:15 / 25:58 のように28時間制で持つ
 * - Node.js側で 0:15 を勝手に 24:15 に変換しない
 *
 * 対応例:
 * - 0:15
 * - 1:00
 * - 01:00
 * - 14:00
 * - 14:00:00
 * - 24:15
 * - 25:58
 * - 28:00:00
 * - Sat Dec 30 1899 11:56:00 GMT+0900 (Japan Standard Time)
 */
function parseProgramTime(timeText) {
  const text = normalizeForParse(timeText);

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
 * TVerの「〇月〇日(曜)放送分」を論理放送日として、
 * program_master.time を28時間制の表示時刻として扱う。
 *
 * 例:
 * broadcastLabel = 5月21日(木)放送分
 * programTime = 24:15
 *
 * => start_at_text = 5月21日(木) 24:15 放送
 * => start_at = 2026-05-22 0:15
 *
 * programTime = 0:15 の場合は、
 * => start_at_text = 5月21日(木) 0:15 放送
 * => start_at = 2026-05-21 0:15
 *
 * つまり、深夜番組を24時台扱いしたい場合は、元シート側で 24:15 と入れる。
 */
function buildBroadcastDateTimeParts(broadcastLabel, programTime) {
  const dateParts = parseBroadcastDateParts(broadcastLabel);
  const timeParts = parseProgramTime(programTime);

  if (!dateParts || !timeParts) {
    console.log({
      reason: 'buildBroadcastDateTimeParts failed',
      broadcastLabel,
      programTime,
      dateParts,
      timeParts,
    });
    return null;
  }

  const displayHour = timeParts.hour;
  const actualDayOffset = Math.floor(displayHour / 24);
  const actualHour = displayHour % 24;

  const actualDate = new Date(Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    actualHour,
    timeParts.minute,
    0
  ));

  actualDate.setUTCDate(actualDate.getUTCDate() + actualDayOffset);

  const actualYear = actualDate.getUTCFullYear();
  const actualMonth = actualDate.getUTCMonth() + 1;
  const actualDay = actualDate.getUTCDate();

  const weekday = dateParts.weekday ||
    getJapaneseWeekdayFromDateParts(dateParts.year, dateParts.month, dateParts.day);

  return {
    logicalYear: dateParts.year,
    logicalMonth: dateParts.month,
    logicalDay: dateParts.day,
    weekday,
    displayHour,
    minute: timeParts.minute,
    actualYear,
    actualMonth,
    actualDay,
    actualHour,
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
  const parts = buildBroadcastDateTimeParts(broadcastLabel, programTime);

  if (!parts) {
    return '';
  }

  return `${parts.actualYear}-${pad2(parts.actualMonth)}-${pad2(parts.actualDay)} ${parts.actualHour}:${pad2(parts.minute)}`;
}

/**
 * start_at の表示用テキストを作る。
 *
 * start_atから逆算せず、broadcast_labelの論理放送日を正として作る。
 */
function buildStartAtText(broadcastLabel, programTime) {
  const parts = buildBroadcastDateTimeParts(broadcastLabel, programTime);

  if (!parts) {
    return '';
  }

  return `${parts.logicalMonth}月${parts.logicalDay}日(${parts.weekday}) ${parts.displayHour}:${pad2(parts.minute)} 放送`;
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

  return `${year}-${pad2(month)}-${pad2(day)} ${hour}:${pad2(minute)}`;
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
      const startAtText = buildStartAtText(broadcastLabel, program.time);

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
