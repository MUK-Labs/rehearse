import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePiece, safePath, regionParts, currentBar, inferBars } from '../js/model.js';

// Unit cases use a fixed example; `npm run check` validates editable library maps.
const fixture = {
  id: 'TestScore', title: 'Test score', pdf: 'score.pdf', tempo: 27,
  durationBeats: 12, pageCount: 2,
  parts: [
    {id:'md', label:'Right hand', midi:'md.mid'},
    {id:'ms', label:'Left hand', midi:'ms.mid'},
  ],
  bars: [
    {number:55, beat:0, page:1, x:0.1, y:0.2},
    {number:56, beat:4, page:1, x:0.5, y:0.2},
    {number:57, beat:8, page:2, x:0.1, y:0.2},
  ],
  regions: [
    {parts:['md'], page:1, x:0.1, y:0.2, width:0.8, height:0.1},
    {parts:['ms'], page:1, x:0.1, y:0.4, width:0.8, height:0.1},
  ],
};
const copy = () => structuredClone(fixture);

test('maps accept separate, shared and unmapped score areas', () => {
  assert.equal(validatePiece(fixture), fixture);
  const shared = copy();
  shared.regions[0].parts = ['md','ms'];
  assert.equal(validatePiece(shared), shared);
  const single = copy();
  single.regions = [{part:'md', page:1, x:0.1, y:0.2, width:0.8, height:0.1}];
  assert.equal(validatePiece(single), single);
  const unmapped = copy();
  unmapped.regions = [];
  assert.equal(validatePiece(unmapped), unmapped);
});

test('playback selects the correct bar before and after a page boundary', () => {
  assert.equal(currentBar(fixture.bars, 0).number, 55);
  assert.equal(currentBar(fixture.bars, 7.99).number, 56);
  assert.equal(currentBar(fixture.bars, 7.99).page, 1);
  assert.equal(currentBar(fixture.bars, 8).number, 57);
  assert.equal(currentBar(fixture.bars, 8).page, 2);
  assert.equal(currentBar(fixture.bars, 11.99).number, 57);
});

test('new-file bar inference handles compound meter and a meter change', () => {
  const bars = inferBars(11, [
    {beat:0, numerator:6, denominator:8},
    {beat:6, numerator:5, denominator:4},
  ]);
  assert.deepEqual(bars.map(bar => bar.beat), [0,3,6]);
  assert.ok(bars.every(bar => bar.page === null));
});

test('explicit pickup and irregular bar positions remain valid', () => {
  const piece = copy();
  piece.bars = [
    {number:0, beat:0, page:null},
    {number:1, beat:1, page:1, x:0.2, y:0.2},
    {number:2, beat:4.5, page:1, x:0.5, y:0.2},
  ];
  assert.equal(validatePiece(piece), piece);
  assert.equal(currentBar(piece.bars, 0.75).number, 0);
  assert.equal(currentBar(piece.bars, 1).number, 1);
});

test('invalid part references and off-page or empty rectangles fail', () => {
  for (const region of [
    {part:'missing', page:1, x:0.1, y:0.1, width:0.5, height:0.1},
    {parts:['md','missing'], page:1, x:0.1, y:0.1, width:0.5, height:0.1},
    {part:'md', page:1, x:0.9, y:0.1, width:0.2, height:0.1},
    {part:'md', page:1, x:0.1, y:0.1, width:0, height:0.1},
  ]) {
    const piece = copy(); piece.regions = [region];
    assert.throws(() => validatePiece(piece), /unknown part|fit within/);
  }
});

test('maps reject ambiguous bar identity, reversed timing and duplicate parts', () => {
  const duplicateBar = copy(); duplicateBar.bars[1].number = 55;
  assert.throws(() => validatePiece(duplicateBar), /unique/);
  const reversed = copy(); reversed.bars[1].beat = 0;
  assert.throws(() => validatePiece(reversed), /ascending/);
  const duplicatePart = copy(); duplicatePart.parts[1].id = duplicatePart.parts[0].id;
  assert.throws(() => validatePiece(duplicatePart), /unique/);
  const offPage = copy(); offPage.bars[0].x = 1.1;
  assert.throws(() => validatePiece(offPage), /within a page/);
});

test('asset references remain inside the piece folder rather than remote URLs', () => {
  for (const path of ['score.pdf', 'audio/part one.mid']) assert.equal(safePath(path), true);
  for (const path of ['', '../score.pdf', './score.pdf', '/score.pdf', 'https://example.com/score.pdf', 'a/../score.pdf', 'a\\score.pdf', 'score.pdf?x=1', 'score.pdf#page=2']) assert.equal(safePath(path), false, path);
});

test('single and shared region ownership use the same all-muted rule', () => {
  const enabled = new Set(['md']);
  assert.deepEqual(regionParts({part:'ms'}), ['ms']);
  assert.equal(regionParts({part:'ms'}).every(id => !enabled.has(id)), true);
  assert.equal(regionParts({parts:['md','ms']}).every(id => !enabled.has(id)), false);
  enabled.clear();
  assert.equal(regionParts({parts:['md','ms']}).every(id => !enabled.has(id)), true);
});
