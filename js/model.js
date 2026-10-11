/** Validate stored maps before using them as UI or URL input. Coordinates are fractions of the PDF page. */
export function validatePiece(piece) {
  if (!piece || typeof piece !== 'object') throw new Error('The piece map must be a JSON object.');
  if (!/^[A-Za-z0-9_-]+$/.test(piece.id || '')) throw new Error('Use only letters, numbers, hyphens and underscores in the piece id.');
  if (typeof piece.title !== 'string' || !piece.title.trim()) throw new Error('The piece needs a title.');
  if (!safePath(piece.pdf)) throw new Error('The PDF must be a relative file path inside the piece folder.');
  if (!Array.isArray(piece.parts) || !piece.parts.length) throw new Error('Add at least one MIDI part.');
  const ids = new Set();
  for (const part of piece.parts) {
    if (typeof part.id !== 'string' || !part.id || ids.has(part.id)) throw new Error('Part ids must be unique.');
    if (!safePath(part.midi)) throw new Error('Each MIDI must be a relative file path inside the piece folder.');
    if (typeof part.label !== 'string' || !part.label.trim()) throw new Error('Each part needs a label.');
    ids.add(part.id);
  }
  if (!Number.isFinite(piece.tempo) || piece.tempo < 20 || piece.tempo > 300) throw new Error('Set a tempo between 20 and 300 bpm.');
  if (piece.durationBeats != null && (!Number.isFinite(piece.durationBeats) || piece.durationBeats < 0)) throw new Error('The piece duration must be a finite, nonnegative number of beats.');
  if (!Array.isArray(piece.bars) || !piece.bars.length) throw new Error('Add at least one bar.');
  const numbers = new Set();
  let previous = -1;
  for (const bar of piece.bars) {
    if (!Number.isInteger(bar.number) || bar.number < 0 || numbers.has(bar.number)) throw new Error('Printed bar numbers must be unique nonnegative integers.');
    numbers.add(bar.number);
    if (!Number.isFinite(bar.beat) || bar.beat < 0 || bar.beat <= previous) throw new Error('Bar beats must be nonnegative and in ascending order.');
    previous = bar.beat;
    if (bar.page != null && (!Number.isInteger(bar.page) || bar.page < 1 || !fraction(bar.x) || !fraction(bar.y))) throw new Error('Bar positions must be within a page.');
  }
  if (!Array.isArray(piece.regions)) throw new Error('The map needs a regions array.');
  for (const region of piece.regions) {
    const parts = regionParts(region);
    if (!parts.length || parts.some(id => !ids.has(id))) throw new Error('A score area refers to an unknown part.');
    if (!Number.isInteger(region.page) || region.page < 1 || !fraction(region.x) || !fraction(region.y) || !fraction(region.width) || !fraction(region.height) || region.width === 0 || region.height === 0 || region.x + region.width > 1.000001 || region.y + region.height > 1.000001) throw new Error('Score areas must fit within their page.');
  }
  return piece;
}
const fraction = n => Number.isFinite(n) && n >= 0 && n <= 1;
export function safePath(path) {
  if (typeof path !== 'string' || !path || /^(?:[a-z]+:|\/)/i.test(path) || /[?#\\]/.test(path)) return false;
  try {return path.split('/').every(segment => {const decoded = decodeURIComponent(segment); return decoded !== '..' && decoded !== '.' && !/[\/\\]/.test(decoded);});}
  catch {return false;}
}
export function regionParts(region) { return region.parts || (region.part ? [region.part] : []); }
export function currentBar(bars, beat) { let found = bars[0]; for (const bar of bars) { if (bar.beat > beat + 0.00001) break; found = bar; } return found; }
export function inferBars(duration, signatures = [{ beat: 0, numerator: 4, denominator: 4 }]) {
  const meters = signatures.length ? [...signatures].sort((a,b) => a.beat - b.beat) : [{beat:0,numerator:4,denominator:4}];
  let beat = 0, index = 0;
  const bars = [];
  while (beat < Math.max(duration, 0.01) - 0.00001 && bars.length < 10000) {
    while (index + 1 < meters.length && meters[index + 1].beat <= beat + 0.00001) index++;
    const meter = meters[index];
    const length = meter.numerator * 4 / meter.denominator;
    if (!Number.isFinite(length) || length <= 0) throw new Error('Invalid MIDI time signature.');
    bars.push({number: bars.length + 1, beat, page:null});
    beat = Math.min(beat + length, meters[index + 1]?.beat ?? Infinity);
  }
  return bars;
}
