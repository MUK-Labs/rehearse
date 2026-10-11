import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMidi } from '../js/midi.js';
import { PianoPlayer } from '../js/audio.js';

const u16 = n => [n >> 8 & 255, n & 255];
const u32 = n => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const ascii = value => [...value].map(char => char.charCodeAt(0));
function midiFile(tracks, ppq = 96, format = tracks.length > 1 ? 1 : 0) {
  return Uint8Array.from([
    ...ascii('MThd'), ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(ppq),
    ...tracks.flatMap(track => [...ascii('MTrk'), ...u32(track.length), ...track]),
  ]);
}
const end = [0, 0xff, 0x2f, 0];

test('the actual QuasiCampane files share a beat timeline and keep performed timing', async () => {
  const right = parseMidi(await readFile(new URL('../library/QuasiCampane/md.mid', import.meta.url)));
  const left = parseMidi(await readFile(new URL('../library/QuasiCampane/ms.mid', import.meta.url)));
  assert.equal(right.notes.length, 99);
  // ms.mid has 374 note-ons, but E5 at tick 3284 has its note-off at the
  // same tick. There are 373 positive-duration notes to play.
  assert.equal(left.notes.length, 373);
  assert.equal(right.ppq, 96);
  assert.equal(left.duration, right.duration);
  assert.equal(right.duration, 6526 / 96);
  assert.equal(right.notes[1].time, 38 / 96);
  assert.equal(right.notes[0].midi, 83);
  assert.equal(left.notes[0].midi, 55);
  assert.deepEqual(right.warnings, []);
});

test('running status and velocity-zero note-off produce one correctly timed note', () => {
  const result = parseMidi(midiFile([[0, 0x90, 60, 100, 96, 60, 0, ...end]]));
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].duration, 1);
  assert.equal(result.notes[0].velocity, 100 / 127);
});

test('overlapping same-pitch notes are paired in onset order', () => {
  const result = parseMidi(midiFile([[
    0, 0x90, 60, 100, 48, 60, 90, 48, 0x80, 60, 0, 48, 60, 0, ...end,
  ]]));
  assert.deepEqual(result.notes.map(note => [note.time, note.duration]), [[0, 1], [0.5, 1]]);
});

test('CC64 extends a released note until pedal-up', () => {
  const result = parseMidi(midiFile([[
    0, 0xb0, 64, 127, 0, 0x90, 60, 100,
    96, 0x80, 60, 0, 96, 0xb0, 64, 0, ...end,
  ]]));
  assert.equal(result.notes[0].duration, 2);
});

test('format 1 metadata is merged and arbitrary PPQ becomes quarter beats', () => {
  const conductor = [0, 0xff, 0x51, 3, 0x09, 0x27, 0xc0, 0, 0xff, 0x58, 4, 3, 3, 24, 8, ...end];
  const notes = [0, 0x90, 72, 127, 0x83, 0x60, 0x80, 72, 0, ...end];
  const result = parseMidi(midiFile([conductor, notes], 480));
  assert.equal(result.notes[0].duration, 1);
  assert.deepEqual(result.tempos, [{ beat: 0, bpm: 100 }]);
  assert.deepEqual(result.timeSignatures, [{ beat: 0, numerator: 3, denominator: 8 }]);
});

test('truncated data, missing running status, format 2 and SMPTE fail clearly', () => {
  assert.throws(() => parseMidi(Uint8Array.from([77, 84])), /truncated/);
  assert.throws(() => parseMidi(midiFile([[0, 60, 90, ...end]])), /running status/);
  assert.throws(() => parseMidi(midiFile([[...end]], 96, 2)), /format 2/);
  assert.throws(() => parseMidi(midiFile([[...end]], 0xe728)), /SMPTE/);
  const brokenMeta = midiFile([[0, 0xff, 1, 127, 0]]);
  assert.throws(() => parseMidi(brokenMeta), /truncated/);
});

class Parameter {
  constructor() { this.value = 1; this.events = []; }
  setValueAtTime(...args) { this.events.push(['set', ...args]); }
  linearRampToValueAtTime(...args) { this.events.push(['linear', ...args]); }
  exponentialRampToValueAtTime(...args) { this.events.push(['exponential', ...args]); }
  cancelScheduledValues(...args) { this.events.push(['cancel', ...args]); }
  setTargetAtTime(...args) { this.events.push(['target', ...args]); }
}
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.state = 'running'; this.sources = []; this.destination = {}; }
  createGain() { return { gain: new Parameter(), connect() {}, disconnect() {} }; }
  createDynamicsCompressor() {
    return { threshold: {}, knee: {}, ratio: {}, connect() {}, disconnect() {} };
  }
  createBufferSource() {
    const source = { playbackRate: {}, connect() {}, disconnect() {}, starts: [], stops: [],
      start(...args) { this.starts.push(args); }, stop(...args) { this.stops.push(args); } };
    this.sources.push(source);
    return source;
  }
  async decodeAudioData() { return { duration: 20 }; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
function readyPlayer(parts, onEnded) {
  const context = new FakeAudioContext();
  const player = new PianoPlayer({ audioContext: context, onEnded });
  player._initializing = Promise.resolve();
  player.buffers = new Map([[60, { duration: 20 }]]);
  player.samplePitches = [60];
  player.master = context.createGain();
  player.setParts(parts);
  player.setTempo(60);
  return { player, context };
}
const note = (midi, time = 0, duration = 4) => ({ midi, time, duration, velocity: 0.8 });

test('parts schedule against the same audio clock, with sample transposition', async () => {
  const { player, context } = readyPlayer([{ id: 'right', notes: [note(72)] }, { id: 'left', notes: [note(48)] }]);
  try {
    await player.play(0);
    assert.equal(context.sources.length, 2);
    assert.equal(context.sources[0].starts[0][0], context.sources[1].starts[0][0]);
    assert.equal(context.sources[0].playbackRate.value, 2);
    assert.equal(context.sources[1].playbackRate.value, 0.5);
    context.currentTime = 1.015;
    assert.ok(Math.abs(player.getBeat() - 1) < 1e-9);
    assert.ok(Math.abs(player.pause() - 1) < 1e-9);
    assert.equal(player.playing, false);
  } finally { await player.dispose(); }
});

test('seek resumes a held note at its sample offset and discards earlier finished notes', async () => {
  const { player, context } = readyPlayer([{ id: 'part', notes: [note(60, 0, 0.5), note(60, 1, 4)] }]);
  try {
    await player.play(2);
    assert.equal(context.sources.length, 1);
    assert.ok(Math.abs(context.sources[0].starts[0][1] - 1) < 1e-9);
    context.currentTime = 0.515;
    player.seek(3);
    assert.equal(context.sources.length, 2);
    assert.ok(Math.abs(context.sources[1].starts[0][1] - 2) < 1e-9);
  } finally { await player.dispose(); }
});

test('mute cuts scheduled sources and re-enable catches held notes without moving the clock', async () => {
  const { player, context } = readyPlayer([{ id: 'right', notes: [note(72)] }, { id: 'left', notes: [note(48)] }]);
  try {
    await player.play(0);
    context.currentTime = 1.015;
    player.setPartEnabled('right', false);
    assert.equal(context.sources[0].stops.length, 2);
    assert.equal(context.sources[1].stops.length, 1);
    player.setPartEnabled('right', true);
    assert.equal(context.sources.length, 3);
    assert.ok(Math.abs(player.getBeat() - 1) < 1e-9);
    assert.ok(context.sources[2].starts[0][1] >= 2);
  } finally { await player.dispose(); }
});

test('changing tempo preserves the current beat, cancels old notes and uses the new clock rate', async () => {
  const { player, context } = readyPlayer([{ id: 'part', notes: [note(60, 0, 8)] }]);
  try {
    await player.play(0);
    context.currentTime = 2.015;
    player.setTempo(120);
    assert.ok(Math.abs(player.getBeat() - 2) < 1e-9);
    assert.equal(context.sources[0].stops.length, 2);
    context.currentTime = 3.03;
    assert.ok(Math.abs(player.getBeat() - 4) < 1e-9);
  } finally { await player.dispose(); }
});

test('natural end fires once and a paused pending play cannot start later', async () => {
  let ended = 0;
  const { player, context } = readyPlayer([{ id: 'part', notes: [note(60, 0, 1)] }], () => ended++);
  try {
    await player.play();
    context.currentTime = 1.02;
    player._schedule();
    player._schedule();
    assert.equal(ended, 1);
    assert.equal(player.getBeat(), 1);
    let finishLoading;
    player._initializing = new Promise(resolve => { finishLoading = resolve; });
    const pending = player.play(0);
    player.pause();
    finishLoading();
    assert.equal(await pending, false);
    assert.equal(player.playing, false);
  } finally { await player.dispose(); }
});

test('sample loading errors remain visible and do not start silent playback', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const player = new PianoPlayer({ audioContext: new FakeAudioContext(), sampleUrls: { 60: 'missing.mp3' } });
  player.setParts([{ id: 'part', notes: [note(60)] }]);
  try {
    await assert.rejects(player.play(), /Could not load the piano sound.*404/);
    assert.equal(player.playing, false);
  } finally {
    globalThis.fetch = previousFetch;
    await player.dispose();
  }
});

test('nonfinite part duration cannot create a transport that never finishes', () => {
  const player = new PianoPlayer();
  assert.throws(() => player.setParts([{ id: 'part', notes: [note(60)], duration: Infinity }]), /invalid duration/);
});
