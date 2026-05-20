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

function isBroadcastLabel(text) {
  return /月\d{1,2}日\(.+?\)放送分/.test(text);
}

function isEndLabel(text) {
  return /終了予定/.test(text);
}

function getCurrentYearInJst() {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
  });

  return Number(formatter.format(new Date()));
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseBroadcastDate(broadcastLabel) {
  const text = normalizeText(broadcastLabel);
  const match = text.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);

  if (!match) {
    return '';
  }

  const year = match[1] ? Number(match[1]) : getCurrentYearInJst();
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!year || !month || !day) {
    return '';
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
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

    return links.map((link) => {
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

      return {
        episode_id: episodeId,
        program_title: program.title,
        episode_title: normalizeText(episode.title),
        episode_url: toAbsoluteUrl(href),
        broadcast_label: broadcastLabel,
        broadcast_date: parseBroadcastDate(broadcastLabel),
        end_label: endLabel,
        end_flag: false,
        series_url: program.url,
        members: program.members || '',
        memberFlags: program.memberFlags || {},
      };
    })
    .filter((episode) => {
      return (
        episode.episode_id &&
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
    console.log('No programs found');
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
