const { chromium } = require('playwright');

const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;
const GAS_WEB_APP_TOKEN = process.env.GAS_WEB_APP_TOKEN;

const JCOM_BASE_URL = 'https://tvguide.myjcom.jp';

const JCOM_CHANNELS = [
  '1024_32736',
  '1032_32737',
  '1040_32738',
  '1048_32739',
  '1056_32740',
  '1064_32741',
  '1072_32742',
  '23608_32391',
  '24632_32375',
  '29752_32295',
  '00052_0',
  '00021_0',
].join(',');

const TIMELESZ_SEARCH_TARGET = {
  key: 'timelesz',
  keyword: 'timelesz',
};

const MEMBER_SEARCH_TARGETS = [
  { key: 'sato', keyword: '佐藤勝利' },
  { key: 'kikuchi', keyword: '菊池風磨' },
  { key: 'matsushima', keyword: '松島聡' },
  { key: 'teranishi', keyword: '寺西拓人' },
  { key: 'hara', keyword: '原嘉孝' },
  { key: 'hashimoto', keyword: '橋本将生' },
  { key: 'inomata', keyword: '猪俣周杜' },
  { key: 'shinozuka', keyword: '篠塚大輝' },
];

const MEMBER_KEYS = [
  'all',
  'sato',
  'kikuchi',
  'matsushima',
  'teranishi',
  'hara',
  'hashimoto',
  'inomata',
  'shinozuka',
];

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

function normalizeForParse(value) {
  return String(value || '')
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/：/g, ':')
    .replace(/〜/g, '～')
    .replace(/－/g, '～')
    .replace(/-/g, '～')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitleForCompare(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[【】\[\]（）()]/g, '')
    .toLowerCase();
}

function findMatchedProgram(foundTitle, programs) {
  const found = normalizeTitleForCompare(foundTitle);

  if (!found) {
    return null;
  }

  return programs.find((program) => {
    const title = normalizeTitleForCompare(program.title);

    if (!title) {
      return false;
    }

    return found.includes(title) || title.includes(found);
  }) || null;
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

function toJcomAbsoluteUrl(href) {
  if (!href) {
    return '';
  }

  if (href.startsWith('http')) {
    return href;
  }

  return `${JCOM_BASE_URL}${href}`;
}

function extractProgramIdFromUrl(url) {
  const match = String(url || '').match(/\/series\/([^/?#]+)/);
  return match ? match[1] : '';
}

function buildJcomSearchUrl(keyword) {
  const url = new URL(`${JCOM_BASE_URL}/search/event/`);

  url.searchParams.set('keyword', keyword);
  url.searchParams.set('channelType', '2');
  url.searchParams.set('channel', JCOM_CHANNELS);

  return url.toString();
}

function parseJcomDay(dayText) {
  const text = normalizeForParse(dayText);
  const match = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);

  if (!match) {
    console.log({
      reason: 'parseJcomDay failed',
      dayText,
      normalized: text,
    });
    return null;
  }

  const year = getCurrentYearInJst();
  const month = Number(match[1]);
  const day = Number(match[2]);

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
      reason: 'parseJcomDay invalid',
      dayText,
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

function parseJcomTimeRange(timeText) {
  const text = normalizeForParse(timeText);

  const match = text.match(
    /(\d{1,2})\s*:\s*(\d{2})\s*～\s*(\d{1,2})\s*:\s*(\d{2})/
  );

  if (!match) {
    console.log({
      reason: 'parseJcomTimeRange failed',
      timeText,
      normalized: text,
    });
    return null;
  }

  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);

  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endHour) ||
    !Number.isInteger(endMinute) ||
    startHour < 0 ||
    startHour > 47 ||
    endHour < 0 ||
    endHour > 47 ||
    startMinute < 0 ||
    startMinute > 59 ||
    endMinute < 0 ||
    endMinute > 59
  ) {
    console.log({
      reason: 'parseJcomTimeRange invalid',
      timeText,
      normalized: text,
      startHour,
      startMinute,
      endHour,
      endMinute,
    });
    return null;
  }

  return {
    startHour,
    startMinute,
    endHour,
    endMinute,
  };
}

function buildDateTimeFromParts(dateParts, hour, minute) {
  const date = new Date(Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    0,
    0,
    0
  ));

  const dayOffset = Math.floor(hour / 24);
  const normalizedHour = hour % 24;

  date.setUTCDate(date.getUTCDate() + dayOffset);

  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join('-') + ` ${pad2(normalizedHour)}:${pad2(minute)}`;
}

function buildJcomStartAt(dayText, timeText) {
  const dateParts = parseJcomDay(dayText);
  const timeParts = parseJcomTimeRange(timeText);

  if (!dateParts || !timeParts) {
    return '';
  }

  return buildDateTimeFromParts(
    dateParts,
    timeParts.startHour,
    timeParts.startMinute
  );
}

function buildJcomEndAt(dayText, timeText) {
  const dateParts = parseJcomDay(dayText);
  const timeParts = parseJcomTimeRange(timeText);

  if (!dateParts || !timeParts) {
    return '';
  }

  let endHour = timeParts.endHour;

  if (endHour < timeParts.startHour) {
    endHour += 24;
  }

  return buildDateTimeFromParts(
    dateParts,
    endHour,
    timeParts.endMinute
  );
}

function createEmptyMemberFlags() {
  return MEMBER_KEYS.reduce((flags, key) => {
    flags[key] = false;
    return flags;
  }, {});
}

function applyAllMemberFlags(memberFlags) {
  MEMBER_KEYS.forEach((key) => {
    memberFlags[key] = true;
  });
}

function buildMembersText(memberFlags) {
  if (memberFlags.all) {
    return 'all';
  }

  return MEMBER_SEARCH_TARGETS
    .filter((member) => memberFlags[member.key])
    .map((member) => member.key)
    .join('、');
}

function toBoolean(value) {
  if (value === true) {
    return true;
  }

  const text = String(value || '').trim().toUpperCase();

  return text === 'TRUE' || text === '1' || text === 'YES';
}

function createFutureKey(future) {
  const futureUrl = String(future.future_url || '').trim();

  if (futureUrl) {
    return futureUrl;
  }

  return [
    future.program_id || '',
    future.start_at || '',
    future.future_title || '',
    future.channel || '',
  ].join('__');
}

function createFutureBase(rawItem, program) {
  const futureTitle = normalizeText(rawItem.title);
  const dayText = normalizeText(rawItem.day);
  const timeText = normalizeText(rawItem.time);
  const channel = normalizeText(rawItem.channel);

  const startAt = buildJcomStartAt(dayText, timeText);
  const endAt = buildJcomEndAt(dayText, timeText);
  const futureUrl = toJcomAbsoluteUrl(rawItem.href);
  const broadcastText = `${dayText} ${timeText}`.trim();

  return {
    program_id: program.program_id,
    program_title: program.title,
    future_title: futureTitle,
    future_url: futureUrl,
    broadcast_text: broadcastText,
    start_at: startAt,
    end_at: endAt,
    channel,
    future_flag: true,
    series_url: program.url,
  };
}

function finalizeMemberFlags(program, matchedMemberKeys, hitByTimelesz) {
  const memberFlags = createEmptyMemberFlags();

  const individualHitCount = matchedMemberKeys.size;
  const isProgramMasterAll = Boolean(program.all_flag);
  const isAllIndividualMembersHit = individualHitCount === MEMBER_SEARCH_TARGETS.length;
  const isTimeleszOnlyHit = Boolean(hitByTimelesz) && individualHitCount === 0;

  if (isProgramMasterAll || isAllIndividualMembersHit || isTimeleszOnlyHit) {
    applyAllMemberFlags(memberFlags);
    return memberFlags;
  }

  matchedMemberKeys.forEach((memberKey) => {
    if (memberFlags[memberKey] !== undefined) {
      memberFlags[memberKey] = true;
    }
  });

  return memberFlags;
}

function finalizeFutureEntry(entry) {
  const memberFlags = finalizeMemberFlags(
    entry.program,
    entry.matchedMemberKeys,
    entry.hitByTimelesz
  );

  return {
    ...entry.future,
    memberFlags,
    members: buildMembersText(memberFlags),
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

  const programs = Array.isArray(result.programs) ? result.programs : [];

  return programs
    .map((program) => ({
      ...program,
      program_id: extractProgramIdFromUrl(program.url),
      all_flag: Boolean(program.memberFlags?.all) || toBoolean(program.all),
    }))
    .filter((program) => program.program_id && program.title && program.url);
}

async function captureRawJcomItems(page, keyword) {
  const searchUrl = buildJcomSearchUrl(keyword);

  console.log(`J:COM Search: ${keyword} / ${searchUrl}`);

  await page.goto(searchUrl, {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  await page.waitForTimeout(1500);

  return page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll('#program_list .list_item.program_list:not(.api-base)')
    );

    return items.map((item) => {
      const link = item.querySelector('a.to_detail[href^="/detail/"]');
      const title = item.querySelector('.title')?.textContent || '';
      const day = item.querySelector('.day')?.textContent || '';
      const time = item.querySelector('.time')?.textContent || '';
      const channel = item.querySelector('.ch')?.textContent || '';

      return {
        href: link?.getAttribute('href') || '',
        title,
        day,
        time,
        channel,
      };
    });
  });
}

function addRawItemsToFutureMap({
  rawItems,
  programs,
  futureByKey,
  crawledProgramIds,
  sourceType,
  memberKey = '',
  keyword = '',
}) {
  rawItems.forEach((rawItem) => {
    const futureTitle = normalizeText(rawItem.title);
    const matchedProgram = findMatchedProgram(futureTitle, programs);

    if (!matchedProgram) {
      console.log({
        reason: 'J:COM item skipped by program_master title filter',
        sourceType,
        memberKey,
        keyword,
        foundTitle: futureTitle,
      });
      return;
    }

    const future = createFutureBase(rawItem, matchedProgram);

    if (!future.program_id || !future.future_title || !future.start_at) {
      console.log({
        reason: 'J:COM item skipped by required fields',
        sourceType,
        memberKey,
        keyword,
        future,
      });
      return;
    }

    const key = createFutureKey(future);

    if (!key) {
      return;
    }

    crawledProgramIds.add(future.program_id);

    const existing = futureByKey.get(key);

    if (existing) {
      if (sourceType === 'timelesz') {
        existing.hitByTimelesz = true;
      }

      if (sourceType === 'member' && memberKey) {
        existing.matchedMemberKeys.add(memberKey);
      }

      futureByKey.set(key, existing);
      return;
    }

    const entry = {
      future,
      program: matchedProgram,
      matchedMemberKeys: new Set(),
      hitByTimelesz: sourceType === 'timelesz',
    };

    if (sourceType === 'member' && memberKey) {
      entry.matchedMemberKeys.add(memberKey);
    }

    futureByKey.set(key, entry);
  });
}

async function captureFuturePrograms(page, programs) {
  const futureByKey = new Map();
  const crawledProgramIds = new Set();

  try {
    const rawItems = await captureRawJcomItems(page, TIMELESZ_SEARCH_TARGET.keyword);

    console.log(`  ${TIMELESZ_SEARCH_TARGET.keyword}: ${rawItems.length}`);

    addRawItemsToFutureMap({
      rawItems,
      programs,
      futureByKey,
      crawledProgramIds,
      sourceType: 'timelesz',
      keyword: TIMELESZ_SEARCH_TARGET.keyword,
    });

  } catch (error) {
    console.error(`Failed J:COM timelesz search: ${TIMELESZ_SEARCH_TARGET.keyword}`);
    console.error(error);
  }

  for (const member of MEMBER_SEARCH_TARGETS) {
    try {
      const rawItems = await captureRawJcomItems(page, member.keyword);

      console.log(`  ${member.keyword}: ${rawItems.length}`);

      addRawItemsToFutureMap({
        rawItems,
        programs,
        futureByKey,
        crawledProgramIds,
        sourceType: 'member',
        memberKey: member.key,
        keyword: member.keyword,
      });

    } catch (error) {
      console.error(`Failed J:COM member search: ${member.keyword}`);
      console.error(error);
    }
  }

  const futures = Array.from(futureByKey.values()).map(finalizeFutureEntry);

  return {
    futures,
    crawledProgramIds: Array.from(crawledProgramIds),
  };
}

async function postFutureProgramsToGas(futures, crawledProgramIds) {
  const response = await fetch(GAS_WEB_APP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      token: GAS_WEB_APP_TOKEN,
      action: 'upsertFutureEpisodes',
      futures,
      crawledProgramIds,
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

  console.log(`Active programs: ${programs.length}`);

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage();

  const { futures, crawledProgramIds } = await captureFuturePrograms(page, programs);

  await browser.close();

  console.log(JSON.stringify(futures, null, 2));

  const result = await postFutureProgramsToGas(futures, crawledProgramIds);

  console.log(`Total: ${result.total}`);
  console.log(`Appended: ${result.appended}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Disabled: ${result.disabled}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
