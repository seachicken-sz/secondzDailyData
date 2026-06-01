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

function normalizeUrlWithoutParams(url) {
  const text = String(url || '').trim();

  if (!text) {
    return '';
  }

  return text
    .split('#')[0]
    .split('?')[0]
    .replace(/\/+$/, '');
}

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
    return normalizeUrlWithoutParams(href);
  }

  if (href.startsWith('/')) {
    return normalizeUrlWithoutParams(`${TVER_BASE_URL}${href}`);
  }

  return normalizeUrlWithoutParams(`${TVER_BASE_URL}/${href}`);
}

/**
 * TVerのepisode URLだけを許可する。
 */
function toAbsoluteTverEpisodeUrl(href) {
  const absoluteUrl = toAbsoluteUrl(href);

  if (/^https?:\/\/tver\.jp\/episodes\/[^/?#]+$/.test(absoluteUrl)) {
    return absoluteUrl;
  }

  return '';
}

/**
 * TVerのseries URLだけを許可する。
 * TELASAなどの /series/ は除外する。
 */
function toAbsoluteTverSeriesUrl(href) {
  const absoluteUrl = toAbsoluteUrl(href);

  if (/^https?:\/\/tver\.jp\/series\/sr[a-zA-Z0-9]+$/.test(absoluteUrl)) {
    return absoluteUrl;
  }

  return '';
}

function extractEpisodeIdFromHref(href) {
  const episodeUrl = toAbsoluteTverEpisodeUrl(href);
  const match = episodeUrl.match(/^https?:\/\/tver\.jp\/episodes\/([^/?#]+)$/);

  return match ? match[1] : '';
}

function extractProgramIdFromUrl(url) {
  const seriesUrl = toAbsoluteTverSeriesUrl(url);
  const match = seriesUrl.match(/^https?:\/\/tver\.jp\/series\/(sr[a-zA-Z0-9]+)$/);

  return match ? match[1] : '';
}

function isEpisodeUrl(url) {
  return Boolean(toAbsoluteTverEpisodeUrl(url));
}

function isSeriesUrl(url) {
  return Boolean(toAbsoluteTverSeriesUrl(url));
}

function isBroadcastLabel(text) {
  const normalized = normalizeForParse(text);
  return /\d{1,2}\s*月\s*\d{1,2}\s*日(?:\(.+?\))?\s*放送分/.test(normalized);
}

function isYearBroadcastLabel(text) {
  const normalized = normalizeForParse(text);
  return /^\d{4}年放送$/.test(normalized);
}

function pickBroadcastLabelFromSubInfoTexts(texts) {
  const normalizedTexts = Array.isArray(texts)
    ? texts.map(normalizeText)
    : [];

  return normalizedTexts.find(isBroadcastLabel) ||
    normalizedTexts.find(isYearBroadcastLabel) ||
    '';
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

function buildStartAt(broadcastLabel, programTime) {
  const parts = buildBroadcastDateTimeParts(broadcastLabel, programTime);

  if (!parts) {
    return '';
  }

  return `${parts.actualYear}-${pad2(parts.actualMonth)}-${pad2(parts.actualDay)} ${parts.actualHour}:${pad2(parts.minute)}`;
}

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

function toBoolean(value) {
  if (value === true) {
    return true;
  }

  const text = String(value || '').trim().toUpperCase();

  return text === 'TRUE' ||
    text === '1' ||
    text === 'YES' ||
    text === 'Y' ||
    text === '対象' ||
    text === '有効';
}

function removeProgramTitlePrefix(rawTitle, programTitle) {
  const title = String(rawTitle || '').trim();
  const prefix = String(programTitle || '').trim();

  if (!prefix || !title.startsWith(prefix)) {
    return normalizeText(title);
  }

  return normalizeText(
    title
      .slice(prefix.length)
      .replace(/^[\s　]+/, '')
  );
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
  const programUrl = normalizeUrlWithoutParams(program.url);

  await page.goto(programUrl, {
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

  const useTitlePrefixFilter = toBoolean(program.title_prefix_filter_flag);
  const programTitle = normalizeText(program.title);

  let targetRawEpisodes = rawEpisodes;

  if (useTitlePrefixFilter) {
    if (!programTitle) {
      console.log({
        reason: 'skip title prefix filter program because title is empty',
        source: 'program_master',
        program,
      });

      return {
        episodes: [],
        rawEpisodeCount: rawEpisodes.length,
        targetRawEpisodeCount: 0,
      };
    }

    targetRawEpisodes = rawEpisodes.filter((episode) => {
      const rawTitle = String(episode.title || '').trim();
      return rawTitle.startsWith(programTitle);
    });

    console.log({
      source: 'program_master',
      program: program.title,
      titlePrefixFilter: true,
      rawEpisodes: rawEpisodes.length,
      matchedEpisodes: targetRawEpisodes.length,
      skippedPrefixMismatch: rawEpisodes.length - targetRawEpisodes.length,
    });
  }

  const episodes = targetRawEpisodes
    .map((episode, filteredIndex) => {
      const href = episode.href;
      const rawEpisodeTitle = String(episode.title || '').trim();

      const subInfoTexts = Array.isArray(episode.subInfoTexts)
        ? episode.subInfoTexts.map(normalizeText)
        : [];

      const broadcastLabel = pickBroadcastLabelFromSubInfoTexts(subInfoTexts);
      const endLabel = subInfoTexts.find(isEndLabel) || '';
      const episodeId = extractEpisodeIdFromHref(href);
      const programId = extractProgramIdFromUrl(programUrl);

      const startAt = isBroadcastLabel(broadcastLabel)
        ? buildStartAt(broadcastLabel, program.time)
        : '';

      const startAtText = isBroadcastLabel(broadcastLabel)
        ? buildStartAtText(broadcastLabel, program.time)
        : broadcastLabel;

      const episodeTitle = useTitlePrefixFilter
        ? removeProgramTitlePrefix(rawEpisodeTitle, programTitle)
        : normalizeText(rawEpisodeTitle);

      console.log({
        source: 'program_master',
        program: program.title,
        week: program.week,
        time: program.time,
        titlePrefixFilter: useTitlePrefixFilter,
        rawEpisodeTitle,
        episodeTitle,
        broadcastLabel,
        startAt,
        startAtText,
      });

      return {
        source_type: 'program_master',
        episode_id: episodeId,
        program_id: programId,
        program_title: program.title,
        episode_title: episodeTitle,
        episode_url: toAbsoluteUrl(href),
        broadcast_label: broadcastLabel,
        start_at: startAt,
        start_at_text: startAtText,
        end_label: endLabel,
        end_at: parseEndAt(endLabel),
        end_flag: false,

        // title_prefix_filter_flag = TRUE の場合は、
        // 前方一致で残った中の最上位だけ TRUE。
        // FALSE/空欄の場合は従来通り、一覧最上位だけ TRUE。
        new_flag: filteredIndex === 0,

        series_url: programUrl,
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

  return {
    episodes,
    rawEpisodeCount: rawEpisodes.length,
    targetRawEpisodeCount: targetRawEpisodes.length,
  };
}

/**
 * 出演者検索ページからepisodeリンク候補を取得する。
 *
 * program_title = EpisodeListItem_title
 * episode_title = EpisodeListItem_subTitle
 */
async function captureEpisodeLinksFromTalentSearchPage(page, talent) {
  const talentUrl = normalizeUrlWithoutParams(talent.url);

  await page.goto(talentUrl, {
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
        link.querySelector('[class*="EpisodeListItem_title"]')?.textContent ||
        card?.querySelector('[class*="EpisodeListItem_title"]')?.textContent ||
        '';
      
      const episodeTitle =
        link.querySelector('[class*="EpisodeListItem_subTitle"]')?.textContent ||
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
 * 出演者検索結果だけではseries_urlが不足しやすいので、
 * episodeページへ入り、「番組TOPへ」リンクからseries_urlを補完する。
 */
async function captureEpisodeDetailFromEpisodePage(page, episodeUrl) {
  const normalizedEpisodeUrl = normalizeUrlWithoutParams(episodeUrl);

  await page.goto(normalizedEpisodeUrl, {
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

    // episodeページ内の「番組TOPへ」リンク
    const seriesLinkFromEpisodeDescription =
      document
        .querySelector('a[class*="EpisodeDescription_seriesLink"][href*="/series/"]')
        ?.getAttribute('href') || '';

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

    // episodeページ内の正式な番組名・エピソード名
    // 例:
    // <h2 class="EpisodeDescription_seriesTitle__...">アポロの歌</h2>
    // <h1 class="EpisodeDescription_title__...">EP.1...</h1>
    const episodeDescriptionSeriesTitle =
      document.querySelector('[class*="EpisodeDescription_seriesTitle"]')?.textContent ||
      '';

    const episodeDescriptionTitle =
      document.querySelector('[class*="EpisodeDescription_title"]')?.textContent ||
      '';

    const subInfoTexts = Array.from(
      document.querySelectorAll(
        '[class*="EpisodeDescription_metaDetail"], [class*="EpisodeDescription_broadcastDateLabel"], [class*="EpisodeDescription_endAtLabel"], [class*="subInfo"], [class*="SubInfo"], [class*="meta"], [class*="Meta"]'
      )
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
      episodeDescriptionSeriesTitle,
      episodeDescriptionTitle,
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
    .map((href) => toAbsoluteTverSeriesUrl(href))
    .filter(Boolean);

  const uniqueSeriesUrls = Array.from(new Set(normalizedSeriesUrls));

  return uniqueSeriesUrls[0] || '';
}

function pickBroadcastLabelFromTexts(texts) {
  return texts.map(normalizeText).find(isBroadcastLabel) || '';
}

function pickEndLabelFromTexts(texts) {
  return texts.map(normalizeText).find(isEndLabel) || '';
}

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

function pickProgramTitleFromSearchItem(item, detail) {
  // episodeページ内の正式な番組名を最優先
  const programTitleFromDetail = normalizeText(detail.episodeDescriptionSeriesTitle);

  if (programTitleFromDetail) {
    return programTitleFromDetail;
  }

  // 次にtalent検索カード上の番組名
  const programTitleFromSearch = normalizeText(item.programTitle);

  if (programTitleFromSearch) {
    return programTitleFromSearch;
  }

  // 画像altは番組名になっていることが多い
  const imageAlt = normalizeText(item.imageAlt);

  if (imageAlt) {
    return imageAlt;
  }

  // 最後の保険
  const titleParts = extractTitlePartsFromOgTitle(detail.ogTitle, detail.pageTitle);

  if (titleParts.programTitle) {
    return titleParts.programTitle;
  }

  return '';
}

function pickEpisodeTitleFromSearchItem(item, detail) {
  const programTitleFromDetail = normalizeText(detail.episodeDescriptionSeriesTitle);
  const programTitleFromSearch = normalizeText(item.programTitle);
  const programTitle = programTitleFromDetail || programTitleFromSearch;

  // episodeページ内の正式なエピソード名を最優先
  // 例:
  // <h1 class="EpisodeDescription_title__...">EP.1...</h1>
  const episodeTitleFromDetail = normalizeText(detail.episodeDescriptionTitle);

  if (
    episodeTitleFromDetail &&
    episodeTitleFromDetail !== programTitle &&
    !isInvalidEpisodeTitleText(episodeTitleFromDetail)
  ) {
    return episodeTitleFromDetail;
  }

  // 次にtalent検索カード上のサブタイトル
  const episodeTitleFromSearch = normalizeText(item.episodeTitle);

  if (
    episodeTitleFromSearch &&
    !isInvalidEpisodeTitleText(episodeTitleFromSearch)
  ) {
    return episodeTitleFromSearch;
  }
  const titleParts = extractTitlePartsFromOgTitle(detail.ogTitle, detail.pageTitle);

  if (
    titleParts.episodeTitle &&
    titleParts.episodeTitle !== programTitle &&
    !isInvalidEpisodeTitleText(titleParts.episodeTitle)
  ) {
    return titleParts.episodeTitle;
  }

  return '';
}

/**
 * 出演者検索で拾ったepisodeを詳細つきepisodeに変換する。
 */
async function enrichTalentSearchEpisode(page, item, talent) {
  const episodeUrl = toAbsoluteUrl(item.href);
  const episodeId = extractEpisodeIdFromHref(episodeUrl);

  if (!episodeId) {
    return null;
  }

  const detail = await captureEpisodeDetailFromEpisodePage(page, episodeUrl);

const canonicalEpisodeUrl = toAbsoluteTverEpisodeUrl(detail.canonicalUrl || episodeUrl);
const finalEpisodeUrl = canonicalEpisodeUrl || toAbsoluteTverEpisodeUrl(episodeUrl);

 const seriesUrlFromItem = toAbsoluteTverSeriesUrl(item.seriesHref || '');
const seriesUrlFromDetail = pickFirstSeriesUrlFromDetail(detail);

const seriesUrlCandidates = [
  seriesUrlFromItem,
  seriesUrlFromDetail,
]
  .filter(Boolean);

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
  // 既存program_master由来と同一episode_idで統合された場合は、そちらの日時が使われる。
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
async function postEpisodesToGas({
  episodes,
  crawledSeriesUrls,
  noEpisodeSeriesUrls,
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
      noEpisodeSeriesUrls,
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
  const noEpisodeSeriesUrls = [];

  // 今回program_master起点で検索対象にしたURL一覧。
  // GAS側で「検索対象だったが取得できなかった番組」の判定に使う。
  const searchedProgramUrls = programs
    .map((program) => normalizeUrlWithoutParams(program.url))
    .filter(Boolean);

  let programSearchCompleted = false;
  let talentSearchCompleted = false;

  try {
    for (const program of programs) {
      try {
        console.log(`Capture program: ${program.title} / ${program.url}`);

const captureResult = await captureEpisodesForProgram(page, program);
const episodes = captureResult.episodes || [];

console.log(`  raw episodes: ${captureResult.rawEpisodeCount}`);
console.log(`  target raw episodes: ${captureResult.targetRawEpisodeCount}`);
console.log(`  episodes: ${episodes.length}`);

allEpisodes.push(...episodes);

const normalizedProgramUrl = normalizeUrlWithoutParams(program.url);

// 掲載終了判定に使う。
// 保存対象episodeが1件以上あるときだけ、既存episodeの終了判定に使う。
if (episodes.length > 0) {
  crawledSeriesUrls.push(normalizedProgramUrl);
}

// active_flag FALSE判定に使う。
// 番組ページの本編エピソードが0件だった場合だけ入れる。
if (captureResult.rawEpisodeCount === 0) {
  noEpisodeSeriesUrls.push(normalizedProgramUrl);
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

  } finally {
    await browser.close();
  }

  // ここではあえてepisode_id単位で統合しない。
  // GAS側で、program_master由来とtalent_search由来を突き合わせて
  // 出演者判定・program_master更新・episode_master保存を行うため。
  const episodesForPost = allEpisodes;
  const uniqueCrawledSeriesUrls = Array.from(new Set(crawledSeriesUrls));
  const uniqueNoEpisodeSeriesUrls = Array.from(new Set(noEpisodeSeriesUrls));

  console.log(JSON.stringify(episodesForPost, null, 2));

const result = await postEpisodesToGas({
  episodes: episodesForPost,
  crawledSeriesUrls: uniqueCrawledSeriesUrls,
  noEpisodeSeriesUrls: uniqueNoEpisodeSeriesUrls,
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

function isInvalidEpisodeTitleText(text) {
  const value = normalizeText(text);

  if (!value) {
    return true;
  }

  return value === 'カテゴリ' ||
    value === '配信中エピソード' ||
    value === 'すべて見る' ||
    value === '詳細を見る' ||
    value === '番組TOPへ' ||
    value === 'あとでみる' ||
    value === 'シェア' ||
    value === 'いいね登録' ||
    value === 'お気に入り登録' ||
    value.includes('見逃し無料配信') ||
    value.includes('TVer') ||
    value === 'ドラマ' ||
    value === 'バラエティ' ||
    value === 'アニメ' ||
    value === '報道・ドキュメンタリー' ||
    value === 'スポーツ';
}
