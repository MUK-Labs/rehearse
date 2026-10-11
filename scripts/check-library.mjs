#!/usr/bin/env node
/** Validate deployed library and sound references without network or PDF parsing. */
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePiece, safePath } from '../js/model.js';
import { parseMidi } from '../js/midi.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
function check(condition, message) { if (!condition) throw new Error(message); }

async function referencedFile(folder, path) {
  check(safePath(path), `Unsafe relative file reference: ${String(path)}`);
  const base = await realpath(folder);
  const target = await realpath(resolve(base, path));
  const within = relative(base, target);
  check(within && within !== '..' && !within.startsWith(`..${sep}`), `File escapes its folder: ${path}`);
  const info = await stat(target);
  check(info.isFile() && info.size > 0, `Missing or empty file: ${path}`);
  return readFile(target);
}

async function main() {
  const index = await json(resolve(root, 'library/index.json'));
  check(Array.isArray(index.pieces) && index.pieces.length, 'library/index.json needs a nonempty pieces array.');
  const ids = new Set();
  let partCount = 0;
  for (const entry of index.pieces) {
    check(/^[A-Za-z0-9_-]+$/.test(entry.id || ''), 'A library entry has an invalid id.');
    check(!ids.has(entry.id), `Duplicate library id: ${entry.id}`);
    check(typeof entry.title === 'string' && entry.title.trim(), `${entry.id}: library title is missing.`);
    ids.add(entry.id);
    const folder = resolve(root, 'library', entry.id);
    const piece = validatePiece(JSON.parse(await referencedFile(folder, 'piece.json')));
    check(piece.id === entry.id, `${entry.id}: piece id must match its folder.`);
    if (piece.pageCount != null) check(Number.isInteger(piece.pageCount) && piece.pageCount > 0, `${entry.id}: pageCount must be a positive integer.`);
    if (piece.durationBeats != null) check(Number.isFinite(piece.durationBeats) && piece.durationBeats > 0, `${entry.id}: durationBeats must be positive.`);
    for (const item of [...piece.bars, ...piece.regions]) {
      if (item.page != null && piece.pageCount != null) check(item.page <= piece.pageCount, `${entry.id}: a map position exceeds pageCount.`);
    }
    const pdf = await referencedFile(folder, piece.pdf);
    check(pdf.subarray(0, 1024).includes(Buffer.from('%PDF-')), `${entry.id}: ${piece.pdf} has no PDF header.`);
    const midiParts = await Promise.all(piece.parts.map(async part => {
      const midi = parseMidi(await referencedFile(folder, part.midi));
      check(midi.notes.length > 0, `${entry.id}: ${part.midi} contains no playable notes.`);
      for (const note of midi.notes) {
        check(Number.isFinite(note.time) && note.time >= 0 && note.duration > 0 && note.time + note.duration <= midi.duration + 1e-8, `${entry.id}: invalid note timing in ${part.midi}.`);
      }
      for (const warning of midi.warnings) console.warn(`Warning: ${entry.id}/${part.midi}: ${warning}`);
      return midi;
    }));
    const midiDuration = Math.max(...midiParts.map(midi => midi.duration));
    const duration = Math.max(midiDuration, piece.durationBeats || 0);
    check(piece.bars.every(bar => bar.beat < duration), `${entry.id}: a bar starts at or beyond the playback end.`);
    partCount += midiParts.length;
    console.log(`${entry.id}: ${piece.bars.length} bars, ${midiParts.length} MIDI parts, ${midiDuration.toFixed(3)} MIDI beats${duration > midiDuration ? ` (${duration} mapped beats)` : ''}.`);
  }

  const soundFolder = resolve(root, 'assets/piano');
  const sounds = await json(resolve(soundFolder, 'manifest.json'));
  check(Array.isArray(sounds.samples) && sounds.samples.length, 'The piano manifest needs samples.');
  const pitches = new Set();
  for (const sample of sounds.samples) {
    check(Number.isInteger(sample.midi) && sample.midi >= 0 && sample.midi <= 127 && !pitches.has(sample.midi), 'Piano sample pitches must be unique MIDI integers.');
    pitches.add(sample.midi);
    const data = await referencedFile(soundFolder, sample.file);
    check(typeof sample.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(sample.sha256), `Missing SHA-256 for ${sample.file}.`);
    const hash = createHash('sha256').update(data).digest('hex');
    check(hash === sample.sha256.toLowerCase(), `Piano sample hash mismatch: ${sample.file}`);
  }
  for (const path of ['index.html', 'styles.css', 'js/app.js', 'vendor/pdfjs/pdf.mjs', 'vendor/pdfjs/pdf.worker.mjs', 'vendor/pdfjs/LICENSE', 'THIRD_PARTY.md']) await referencedFile(root, path);
  console.log(`Checked ${ids.size} piece(s), ${partCount} MIDI file(s), and ${sounds.samples.length} verified piano samples.`);
}

main().catch(error => { console.error(`Library check failed: ${error.message}`); process.exitCode = 1; });
