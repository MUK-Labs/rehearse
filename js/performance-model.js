export function normalizePublicUrl(value, baseUrl) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a public HTTP or HTTPS URL.');
  const url = new URL(value.trim(), baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use a public HTTP or HTTPS URL without credentials.');
  }
  return url.href;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  const pushField = () => {
    row.push(field);
    field = '';
    closedQuote = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += character;
      }
    } else if (character === ',') {
      pushField();
    } else if (character === '\r' || character === '\n') {
      pushRow();
      if (character === '\r' && text[index + 1] === '\n') index++;
    } else if (closedQuote) {
      if (character !== ' ' && character !== '\t') {
        throw new Error(`Unexpected text after a quoted field in CSV row ${rows.length + 1}.`);
      }
    } else if (character === '"') {
      if (field.trim()) throw new Error(`Unexpected quote in CSV row ${rows.length + 1}.`);
      field = '';
      quoted = true;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error(`Unclosed quoted field in CSV row ${rows.length + 1}.`);
  if (row.length || field || closedQuote) pushRow();
  return rows;
}

function pdfSource(url) {
  const source = new URL(url);
  if (source.hostname !== 'drive.google.com') return {url};

  const pathId = /^\/file\/(?:u\/\d+\/)?d\/([\w-]+)(?:\/|$)/.exec(source.pathname)?.[1];
  const queryId = source.pathname === '/open' ? source.searchParams.get('id') : null;
  const id = pathId || queryId;
  if (!id || !/^[\w-]+$/.test(id)) return {url};

  const download = new URL('https://drive.usercontent.google.com/download');
  download.searchParams.set('id', id);
  download.searchParams.set('export', 'download');
  const resourceKey = source.searchParams.get('resourcekey');
  if (resourceKey) download.searchParams.set('resourcekey', resourceKey);
  return {url: download.href, driveUrl: url};
}

export function parseSetlistCsv(text, baseUrl) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''));
  const headerIndex = rows.findIndex(row => row.some(field => field.trim()));
  const headers = rows[headerIndex]?.map(field => field.trim().toLowerCase()) ?? [];
  const titleColumn = headers.findIndex(field => field === 'title' || field === 'name');
  const urlColumn = headers.findIndex(field => field === 'pdf_url' || field === 'url');
  if (titleColumn < 0 || urlColumn < 0) throw new Error('Use title and pdf_url as the CSV column headers.');

  const scores = [];
  const occurrences = new Map();
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (row.every(field => !field.trim())) continue;

    const title = row[titleColumn]?.trim();
    if (!title) throw new Error(`CSV row ${index + 1} needs a score title.`);
    let source;
    try {
      source = pdfSource(normalizePublicUrl(row[urlColumn], baseUrl));
    } catch {
      throw new Error(`CSV row ${index + 1} needs a valid public PDF URL.`);
    }

    // Keep separate entries for repeats while preserving identities when other rows move.
    const key = JSON.stringify([source.url, title]);
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    scores.push({id: `remote:${key}:${occurrence}`, title, ...source});
  }

  if (!scores.length) throw new Error('Add at least one score to the CSV.');
  return scores;
}

export function wholePage(page) {
  return {page, x: 0, y: 0, width: 1, height: 1};
}

const fraction = value => Number.isFinite(value) && value >= 0 && value <= 1;

export function normalizePerformanceRegions(regions) {
  if (!Array.isArray(regions)) return [];

  const normalized = [];
  for (const region of regions) {
    if (!region) continue;
    const {page, x, y, width, height} = region;
    if (!Number.isSafeInteger(page) || page < 1) continue;
    if (![x, y, width, height].every(fraction) || x === 1 || y === 1 || width === 0 || height === 0) continue;
    if (x + width > 1.000001 || y + height > 1.000001) continue;
    normalized.push({page, x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y)});
  }
  return normalized;
}

export function buildPerformanceViews(scores) {
  return scores.flatMap(score => {
    const {id: scoreId, pageCount} = score;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) return [];
    const regions = normalizePerformanceRegions(score.regions).filter(region => region.page <= pageCount);
    const views = regions.length ? regions : Array.from({length: pageCount}, (_, index) => wholePage(index + 1));
    return views.map(view => ({scoreId, ...view}));
  });
}
