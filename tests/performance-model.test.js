import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPerformanceViews, normalizePerformanceRegions, normalizePublicUrl, parseSetlistCsv, wholePage,
} from '../js/performance-model.js';

const catalog = 'https://example.org/concert/set.csv?published=1';

test('published CSV supports BOMs, aliases, quoted commas, escaped quotes and multiline titles', () => {
  const csv = '\uFEFF\r\nName,URL,Notes\r\n"Part I, ""Ritornello""\nReprise","../scores/music.pdf",First\r\nSolo,two.pdf,\r\n';
  const scores = parseSetlistCsv(csv, catalog);
  assert.deepEqual(scores.map(({title, url}) => [title, url]), [
    ['Part I, "Ritornello"\nReprise', 'https://example.org/scores/music.pdf'],
    ['Solo', 'https://example.org/concert/two.pdf'],
  ]);
});

test('entries stay distinct when a score repeats and retain ids when other rows move', () => {
  const read = rows => parseSetlistCsv(`title,pdf_url\n${rows.join('\n')}`, catalog);
  const firstOrder = read(['Start,one.pdf', 'End,one.pdf', 'Start,one.pdf']);
  const secondOrder = read(['Start,one.pdf', 'Start,one.pdf', 'End,one.pdf']);
  assert.equal(new Set(firstOrder.map(({id}) => id)).size, 3);
  assert.deepEqual(secondOrder.map(({id}) => id), [firstOrder[0].id, firstOrder[2].id, firstOrder[1].id]);
});

test('Drive share links retain their preview and carry a resource key to the download', () => {
  const shareUrl = 'https://drive.google.com/file/d/Unique_ID-1/view?usp=sharing&resourcekey=0-PublicKey';
  const [fromShare, fromOpen, direct] = parseSetlistCsv([
    'title,pdf_url',
    `Share,${shareUrl}`,
    'Open,https://drive.google.com/open?id=Unique_ID-2',
    'Download,https://drive.usercontent.google.com/download?id=Unique_ID-3',
  ].join('\n'), catalog);
  assert.equal(fromShare.driveUrl, shareUrl);
  assert.equal(fromShare.url, 'https://drive.usercontent.google.com/download?id=Unique_ID-1&export=download&resourcekey=0-PublicKey');
  assert.equal(fromOpen.url, 'https://drive.usercontent.google.com/download?id=Unique_ID-2&export=download');
  assert.equal(direct.url, 'https://drive.usercontent.google.com/download?id=Unique_ID-3');
});

test('invalid catalog rows fail with a useful message', () => {
  assert.throws(() => parseSetlistCsv('title,notes\nMusic,notes', catalog), /column headers/);
  assert.throws(() => parseSetlistCsv('title,pdf_url\n"Music,a.pdf', catalog), /Unclosed quoted field.*row 2/);
  assert.throws(() => parseSetlistCsv('title,pdf_url\n"Music"xx,a.pdf', catalog), /Unexpected text.*row 2/);
  assert.throws(() => parseSetlistCsv('title,pdf_url\n,a.pdf', catalog), /row 2.*title/);
  assert.throws(() => parseSetlistCsv('title,pdf_url\nMusic,javascript:alert()', catalog), /row 2.*public PDF URL/);
  assert.throws(() => parseSetlistCsv('title,pdf_url\n,', catalog), /at least one score/);
  assert.throws(() => normalizePublicUrl('https://user:password@example.org/'), /without credentials/);
});

test('views follow setlist and crop order, including repeated and out-of-order pages', () => {
  const crop = {page: 2, x: 0.1, y: 0.2, width: 0.5, height: 0.1};
  assert.deepEqual(buildPerformanceViews([
    {id: 'a', pageCount: 2, regions: [crop, wholePage(1), crop, wholePage(3)]},
    {id: 'b', pageCount: 2, regions: [wholePage(3)]},
  ]), [
    {scoreId: 'a', ...crop},
    {scoreId: 'a', ...wholePage(1)},
    {scoreId: 'a', ...crop},
    {scoreId: 'b', ...wholePage(1)},
    {scoreId: 'b', ...wholePage(2)},
  ]);
});

test('normalizing stored crops rejects unusable rectangles and clips rounding at the edge', () => {
  const edge = {page: 1, x: 0.5, y: 0.5, width: 0.5000001, height: 0.5, ignored: true};
  assert.deepEqual(normalizePerformanceRegions([
    null, {...edge, page: 0}, {...edge, page: '1'}, {...edge, width: 0.51},
    {...edge, x: 1, width: 0.0000001}, {...edge, height: 0}, edge,
  ]), [{page: 1, x: 0.5, y: 0.5, width: 0.5, height: 0.5}]);
});
