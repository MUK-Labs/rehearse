import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePiece, safePath, regionParts, currentBar, inferBars } from '../js/model.js';

const fixture = JSON.parse(await readFile(new URL('../library/QuasiCampane/piece.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(fixture);

test('the supplied map preserves original bar numbering, the MIDI origin and shared areas', () => {
  assert.equal(validatePiece(fixture), fixture);
  assert.deepEqual(fixture.bars.map(bar => bar.number), Array.from({length:17}, (_,i) => 55+i));
  assert.deepEqual(fixture.bars.map(bar => bar.beat), Array.from({length:17}, (_,i) => i*4));
  assert.equal(fixture.durationBeats, 68);
  assert.deepEqual([...new Set(fixture.bars.map(bar => bar.page))], [1,2,3]);
  assert.ok(fixture.regions.some(region => regionParts(region).length > 1));
});

test('playback selects the correct bar before and after a page boundary', () => {
  assert.equal(currentBar(fixture.bars, 0).number, 55);
  assert.equal(currentBar(fixture.bars, 23.99).number, 60);
  assert.equal(currentBar(fixture.bars, 24).number, 61);
  assert.equal(currentBar(fixture.bars, 67.99).number, 71);
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
