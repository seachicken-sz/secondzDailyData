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

  if (href.startsWith('/')) {
    return `${TVER_BASE_URL}${href}`;
  }

  return `${TVER_BASE_URL}/${href}`;
}

function extractEpisodeIdFromHref(href) {
  const match = String(href || '').match(/\/episodes\/([^/?#]+)/);
  return match ? match[1] : '';
}

function extractProgramIdFromUrl(url) {
  const match = String(url || '').match(/\/series\/([^/?#]+)/);
  return match ? match[1] : '';
}

function isEpisodeUrl(url) {
  return /\/episodes\/[^/?#]+/.test(String(url || ''));
}

function isSeriesUrl(url) {
  return /\/series\/[^/?#]+/.test(String(url || ''));
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
 * 前提:
 * - 深夜番組は元シート側で 24:15 / 25:58 のように28時間制で持つ
 * - Node.js側で 0:15 を勝手に 24:15 に変換しない
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

function createEmptyMemberFlags() {
  return {
    all: false,
    sato: false,
    kikuchi: false,
    matsushima: false,
    teranishi: false,
    hara: false,
    hashimoto: false,
    inomata: false,
    shinozuka: false,
  };
}

function mergeMemberFlags(...memberFlagItems) {
  const result = createEmptyMemberFlags();

  memberFlagItems.forEach((memberFlags) => {
    if (!memberFlags || typeof memberFlags !== 'object') {
      return;
    }

    Object.keys(result).forEach((key) => {
      result[key] = result[key] || Boolean(memberFlags[key]);
    });
  });

  return result;
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

async function fetchTalentsFromGas() {
  const url = new URL(GAS_WEB_APP_URL);

  url.searchParams.set('action', 'talents');
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

  return Array.isArray(result.talents) ? result.talents : [];
}

/**
 * program_master側の番組URLから、本編episodeを取得する。
 */
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
        source: 'program_master',
        program: program.title,
        week: program.week,
        time: program.time,
        broadcastLabel,
        startAt,
        startAtText,
      });

      return {
        source_type: 'program_master',
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
        memberFlags: program.memberFlags || createEmptyMemberFlags(),
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

/**
 * 出演者検索ページからepisodeリンク候補を取得する。
 *
 * TVer側のDOM変更に備えて、まずは a[href*="/episodes/"] を広めに拾う。
 */
async function captureEpisodeLinksFromTalentSearchPage(page, talent) {
  await page.goto(talent.url, {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  await page.waitForTimeout(2000);

  const rawItems = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll('a[href*="/episodes/"]')
    );

    return links.map((link, index) => {
      const href = link.getAttribute('href') || '';

      const card =
        link.closest('[class*="EpisodeListItem_container"]') ||
        link.closest('article') ||
        link.closest('li') ||
        link.closest('[class*="Episode"]') ||
        link.closest('[class*="Card"]') ||
        link.parentElement;

      const programTitle =
        card?.querySelector('[class*="EpisodeListItem_title"]')?.textContent ||
        '';

      const episodeTitle =
        card?.querySelector('[class*="EpisodeListItem_subTitle"]')?.textContent ||
        '';

      const imageAlt =
        link.querySelector('img')?.getAttribute('alt') ||
        card?.querySelector('img')?.getAttribute('alt') ||
        '';

      const linkText = link.textContent || '';
      const cardText = card?.textContent || linkText;

      const seriesHref =
        card?.querySelector('a[href*="/series/"]')?.getAttribute('href') ||
        '';

      const subInfoTexts = Array.from(
        card?.querySelectorAll('[class*="EpisodeListItem_subInfo"], [class*="subInfo"], [class*="SubInfo"], [class*="meta"], [class*="Meta"]') || []
      ).map((element) => element.textContent || '');

      return {
        href,
        index,
        programTitle,
        episodeTitle,
        imageAlt,
        linkText,
        cardText,
        seriesHref,
        subInfoTexts,
      };
    });
  });

  const uniqueByEpisodeId = new Map();

  rawItems.forEach((item) => {
    const episodeId = extractEpisodeIdFromHref(item.href);

    if (!episodeId) {
      return;
    }

    if (!uniqueByEpisodeId.has(episodeId)) {
      uniqueByEpisodeId.set(episodeId, item);
    }
  });

  return Array.from(uniqueByEpisodeId.values());
}

/**
 * 出演者検索結果で拾えた情報だけでは不足しやすいので、
 * episodeページへ入って詳細情報を補完する。
 */
async function captureEpisodeDetailFromEpisodePage(page, episodeUrl) {
  await page.goto(episodeUrl, {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  await page.waitForTimeout(1500);

  return page.evaluate(() => {
    const getMeta = (propertyOrName) => {
      return document
        .querySelector(`meta[property="${propertyOrName}"], meta[name="${propertyOrName}"]`)
        ?.getAttribute('content') || '';
    };

    const canonicalUrl =
      document.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
      location.href;

    const ogTitle = getMeta('og:title');
    const pageTitle = document.title || '';

    const bodyText = document.body?.textContent || '';
    const htmlText = document.documentElement?.innerHTML || '';

    // episodeページ下部の「番組TOPへ」ボタンを最優先で拾う
    const seriesLinkFromEpisodeDescription =
      document
        .querySelector('a[class*="EpisodeDescription_seriesLink"][href*="/series/"]')
        ?.getAttribute('href') || '';

    // 念のため「番組TOPへ」という文言のリンクも拾う
    const seriesLinkByText = Array.from(
      document.querySelectorAll('a[href*="/series/"]')
    ).find((link) => {
      return (link.textContent || '').includes('番組TOPへ');
    })?.getAttribute('href') || '';

    const seriesLinksFromAnchors = Array.from(
      document.querySelectorAll('a[href*="/series/"]')
    ).map((link) => link.getAttribute('href') || '');

    const seriesLinksFromHtml = Array.from(
      new Set(
        Array.from(
          htmlText.matchAll(/https?:\/\/tver\.jp\/series\/[^"'\\\s<>]+|\/series\/[^"'\\\s<>]+/g)
        ).map((match) => match[0])
      )
    );

    const headingTexts = Array.from(
      document.querySelectorAll('h1, h2, h3')
    ).map((element) => element.textContent || '');

    const subInfoTexts = Array.from(
      document.querySelectorAll('[class*="subInfo"], [class*="SubInfo"], [class*="meta"], [class*="Meta"]')
    ).map((element) => element.textContent || '');

    return {
      canonicalUrl,
      ogTitle,
      pageTitle,
      bodyText,
      htmlText,
      seriesLinkFromEpisodeDescription,
      seriesLinkByText,
      seriesLinks: [
        seriesLinkFromEpisodeDescription,
        seriesLinkByText,
        ...seriesLinksFromAnchors,
        ...seriesLinksFromHtml,
      ],
      headingTexts,
      subInfoTexts,
    };
  });
}

function pickFirstSeriesUrlFromDetail(detail) {
  const candidates = [
    detail.seriesLinkFromEpisodeDescription,
    detail.seriesLinkByText,
    ...(Array.isArray(detail.seriesLinks) ? detail.seriesLinks : []),
  ];

  const normalizedSeriesUrls = candidates
    .map((href) => toAbsoluteUrl(href))
    .filter(isSeriesUrl);

  const uniqueSeriesUrls = Array.from(new Set(normalizedSeriesUrls));

  return uniqueSeriesUrls[0] || '';
}

function pickBroadcastLabelFromTexts(texts) {
  return texts.map(normalizeText).find(isBroadcastLabel) || '';
}

function pickEndLabelFromTexts(texts) {
  return texts.map(normalizeText).find(isEndLabel) || '';
}

/**
 * og:title / document.title から番組名・エピソード名をなるべく分解する。
 */
function extractTitlePartsFromOgTitle(ogTitle, pageTitle) {
  const rawTitle = normalizeText(ogTitle || pageTitle);

  if (!rawTitle) {
    return {
      programTitle: '',
      episodeTitle: '',
    };
  }

  const withoutTver = rawTitle
    .replace(/\s*[-|｜]\s*TVer.*$/i, '')
    .replace(/\s*TVer.*$/i, '')
    .trim();

  const separators = [
    '｜',
    '|',
    ' - ',
    'ー',
    '〜',
  ];

  for (const separator of separators) {
    if (withoutTver.includes(separator)) {
      const parts = withoutTver
        .split(separator)
        .map((part) => normalizeText(part))
        .filter(Boolean);

      if (parts.length >= 2) {
        return {
          programTitle: parts[0],
          episodeTitle: parts.slice(1).join(' '),
        };
      }
    }
  }

  return {
    programTitle: '',
    episodeTitle: withoutTver,
  };
}

function pickEpisodeTitleFromSearchItem(item, detail) {
  const episodeTitleFromSearch = normalizeText(item.episodeTitle);

  if (episodeTitleFromSearch) {
    return episodeTitleFromSearch;
  }

  const titleParts = extractTitlePartsFromOgTitle(detail.ogTitle, detail.pageTitle);

  if (titleParts.episodeTitle) {
    return titleParts.episodeTitle;
  }

  const headingTexts = Array.isArray(detail.headingTexts) ? detail.headingTexts : [];
  const heading = headingTexts.map(normalizeText).find(Boolean);

  return heading || '';
}

function pickProgramTitleFromSearchItem(item, detail) {
  const programTitleFromSearch = normalizeText(item.programTitle);

  if (programTitleFromSearch) {
    return programTitleFromSearch;
  }

  const imageAlt = normalizeText(item.imageAlt);

  if (imageAlt) {
    return imageAlt;
  }

  const titleParts = extractTitlePartsFromOgTitle(detail.ogTitle, detail.pageTitle);

  if (titleParts.programTitle) {
    return titleParts.programTitle;
  }

  return '';
}

/**
 * 出演者検索で拾ったepisodeを詳細つきepisodeに変換する。
 *
 * 注意:
 * - program_masterにない番組はGAS側でprogram_masterへ追記する
 * - episode_masterにはsource_type/talent_name/talent_urlを保存しないが、
 *   GAS側の推測用としてPOSTする
 */
async function enrichTalentSearchEpisode(page, item, talent) {
  const episodeUrl = toAbsoluteUrl(item.href);
  const episodeId = extractEpisodeIdFromHref(episodeUrl);

  if (!episodeId) {
    return null;
  }

  const detail = await captureEpisodeDetailFromEpisodePage(page, episodeUrl);

  const canonicalEpisodeUrl = toAbsoluteUrl(detail.canonicalUrl || episodeUrl);
  const finalEpisodeUrl = isEpisodeUrl(canonicalEpisodeUrl)
    ? canonicalEpisodeUrl
    : episodeUrl;

  const seriesUrlFromItem = toAbsoluteUrl(item.seriesHref || '');
  const seriesUrlFromDetail = pickFirstSeriesUrlFromDetail(detail);

  const seriesUrlCandidates = [
    seriesUrlFromItem,
    seriesUrlFromDetail,
  ]
    .map((url) => toAbsoluteUrl(url))
    .filter(isSeriesUrl);

  const seriesUrl = Array.from(new Set(seriesUrlCandidates))[0] || '';
  const programId = extractProgramIdFromUrl(seriesUrl);

  if (!seriesUrl || !programId) {
    console.log({
      reason: 'series_url or program_id not found from talent episode',
      talent: talent.name,
      episodeUrl,
      episodeId,
      seriesUrlFromItem,
      seriesUrlFromDetail,
      seriesLinks: detail.seriesLinks,
      ogTitle: detail.ogTitle,
      pageTitle: detail.pageTitle,
    });
  }

  const textsForLabels = [
    ...(Array.isArray(item.subInfoTexts) ? item.subInfoTexts : []),
    ...(Array.isArray(detail.subInfoTexts) ? detail.subInfoTexts : []),
    item.cardText || '',
    detail.bodyText || '',
  ];

  const broadcastLabel = pickBroadcastLabelFromTexts(textsForLabels);
  const endLabel = pickEndLabelFromTexts(textsForLabels);

  const programTitle = pickProgramTitleFromSearchItem(item, detail);
  const episodeTitle = pickEpisodeTitleFromSearchItem(item, detail);

  // 出演者検索由来はprogram_master.timeがない可能性があるため、
  // start_at/start_at_textは放送ラベルだけでは確定できない。
  // GAS側・シート側で空欄許容。既存programと重複統合された場合はprogram_master由来が勝つ。
  const startAt = '';
  const startAtText = '';

  return {
    source_type: 'talent_search',
    talent_name: talent.name,
    talent_url: talent.url,

    episode_id: episodeId,
    program_id: programId,
    program_title: programTitle,
    episode_title: episodeTitle,
    episode_url: finalEpisodeUrl,
    broadcast_label: broadcastLabel,
    start_at: startAt,
    start_at_text: startAtText,
    end_label: endLabel,
    end_at: parseEndAt(endLabel),
    end_flag: false,

    // 検索結果の先頭が最新とは限らないので、出演者検索単独ではTRUEにしない。
    // 既存program_master由来と同じepisode_idで統合された場合は、そちらのnew_flagが使われる。
    new_flag: false,

    series_url: seriesUrl,
    members: '',
    memberFlags: createEmptyMemberFlags(),
  };
}

/**
 * talent_masterの出演者検索URLからepisodeを取得する。
 */
async function captureEpisodesForTalent(page, talent) {
  const rawItems = await captureEpisodeLinksFromTalentSearchPage(page, talent);

  console.log(`  raw talent episodes: ${rawItems.length}`);

  const episodes = [];

  for (const item of rawItems) {
    try {
      const episode = await enrichTalentSearchEpisode(page, item, talent);

      if (!episode) {
        continue;
      }

      if (
        !episode.episode_id ||
        !episode.program_id ||
        !episode.program_title ||
        !episode.episode_title ||
        !episode.episode_url ||
        !episode.series_url
      ) {
        console.log({
          reason: 'skip incomplete talent episode',
          talent: talent.name,
          episode,
        });
        continue;
      }

      episodes.push(episode);

    } catch (error) {
      console.error(`Failed talent episode detail: ${talent.name} / ${item.href}`);
      console.error(error);
    }
  }

  return episodes;
}

/**
 * 同一episode_idの重複を軽く統合する。
 * 最終的な出演者推測はGAS側で行う。
 *
 * ここではPOSTサイズ削減と、program_master由来の情報優先だけ行う。
 */
function mergeEpisodesBeforePost(episodes) {
  const grouped = new Map();

  episodes.forEach((episode) => {
    const episodeId = String(episode.episode_id || '').trim();

    if (!episodeId) {
      return;
    }

    if (!grouped.has(episodeId)) {
      grouped.set(episodeId, []);
    }

    grouped.get(episodeId).push(episode);
  });

  const merged = [];

  grouped.forEach((items) => {
    // program_master由来があれば基本情報はそれを優先。
    const programMasterItem = items.find((item) => item.source_type === 'program_master');
    const base = {
      ...(programMasterItem || items[0]),
    };

    const talentItems = items.filter((item) => item.source_type === 'talent_search');

    if (talentItems.length > 0) {
      // GAS側の推測に使うため、同一episode_idの出演者ヒット情報は配列で保持する。
      base.talentNames = talentItems
        .map((item) => item.talent_name)
        .filter(Boolean);

      base.talentUrls = talentItems
        .map((item) => item.talent_url)
        .filter(Boolean);

      // program_master由来がなく、出演者検索だけならsource_typeはtalent_searchのまま。
      // program_master由来もある場合はprogram_masterを維持しつつ、talentNamesで推測できる。
      if (!programMasterItem) {
        base.source_type = 'talent_search';
      }
    }

    // memberFlagsはprogram_master由来を優先しつつ、他候補もORする。
    base.memberFlags = mergeMemberFlags(...items.map((item) => item.memberFlags));

    // 1件でもnew_flag=trueならtrue。
    base.new_flag = items.some((item) => Boolean(item.new_flag));

    merged.push(base);
  });

  return merged;
}

async function postEpisodesToGas({
  episodes,
  crawledSeriesUrls,
  searchedProgramUrls,
  programSearchCompleted,
  talentSearchCompleted,
}) {
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
      searchedProgramUrls,
      programSearchCompleted,
      talentSearchCompleted,
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
  const talents = await fetchTalentsFromGas();

  console.log(`Programs: ${programs.length}`);
  console.log(`Talents: ${talents.length}`);

  if (programs.length === 0 && talents.length === 0) {
    console.log('No active programs or talents found');
    return;
  }

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage();

  const allEpisodes = [];
  const crawledSeriesUrls = [];

  // 今回program_master起点で検索対象にしたURL一覧。
  // GAS側で「検索対象だったが取得できなかった番組」の判定に使う。
  const searchedProgramUrls = programs
    .map((program) => program.url)
    .filter(Boolean);

  let programSearchCompleted = false;
  let talentSearchCompleted = false;

  for (const program of programs) {
    try {
      console.log(`Capture program: ${program.title} / ${program.url}`);

      const episodes = await captureEpisodesForProgram(page, program);

      console.log(`  episodes: ${episodes.length}`);

      allEpisodes.push(...episodes);

      // 掲載終了判定に使うため、program_master起点で取得成功した番組URLだけ入れる。
      // DOM変更などで0件になった場合の誤爆を避けるため、0件時は成功扱いにしない。
      if (episodes.length > 0) {
        crawledSeriesUrls.push(program.url);
      }

    } catch (error) {
      console.error(`Failed program: ${program.title} / ${program.url}`);
      console.error(error);
    }
  }

  programSearchCompleted = true;

  for (const talent of talents) {
    try {
      console.log(`Capture talent: ${talent.name} / ${talent.url}`);

      const episodes = await captureEpisodesForTalent(page, talent);

      console.log(`  talent episodes: ${episodes.length}`);

      allEpisodes.push(...episodes);

      // 重要:
      // 出演者検索由来のseries_urlはcrawledSeriesUrlsに入れない。
      // 出演者検索は番組ページの全episode一覧ではないため、
      // 掲載終了判定に使うとend_flag誤爆の原因になる。

    } catch (error) {
      console.error(`Failed talent: ${talent.name} / ${talent.url}`);
      console.error(error);
    }
  }

  talentSearchCompleted = true;

  await browser.close();

  const mergedEpisodes = mergeEpisodesBeforePost(allEpisodes);
  const uniqueCrawledSeriesUrls = Array.from(new Set(crawledSeriesUrls));

  console.log(JSON.stringify(mergedEpisodes, null, 2));

  const result = await postEpisodesToGas({
    episodes: mergedEpisodes,
    crawledSeriesUrls: uniqueCrawledSeriesUrls,
    searchedProgramUrls,
    programSearchCompleted,
    talentSearchCompleted,
  });

  console.log(`Total: ${result.total}`);
  console.log(`Appended: ${result.appended}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Ended: ${result.ended}`);

  if (result.appendedPrograms !== undefined) {
    console.log(`AppendedPrograms: ${result.appendedPrograms}`);
  }

  if (result.activatedPrograms !== undefined) {
    console.log(`ActivatedPrograms: ${result.activatedPrograms}`);
  }

  if (result.workActivatedPrograms !== undefined) {
    console.log(`WorkActivatedPrograms: ${result.workActivatedPrograms}`);
  }

  if (result.workDisabledPrograms !== undefined) {
    console.log(`WorkDisabledPrograms: ${result.workDisabledPrograms}`);
  }

  if (result.activeDisabledPrograms !== undefined) {
    console.log(`ActiveDisabledPrograms: ${result.activeDisabledPrograms}`);
  }

  if (result.memberUpdatedPrograms !== undefined) {
    console.log(`MemberUpdatedPrograms: ${result.memberUpdatedPrograms}`);
  }

  if (result.sentToTarget !== undefined) {
    console.log(`SentToTarget: ${result.sentToTarget}`);
  }

  if (result.updatedTargetExisting !== undefined) {
    console.log(`UpdatedTargetExisting: ${result.updatedTargetExisting}`);
  }

  if (result.skippedAlreadyExists !== undefined) {
    console.log(`SkippedAlreadyExists: ${result.skippedAlreadyExists}`);
  }

  if (result.skippedNotNew !== undefined) {
    console.log(`SkippedNotNew: ${result.skippedNotNew}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
