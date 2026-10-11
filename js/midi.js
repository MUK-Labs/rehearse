/**
 * Small Standard MIDI File reader. All musical times are quarter-note beats,
 * regardless of the source file's PPQ. Supports format 0/1 and sustain (CC64).
 * Tempo events are returned as metadata; rehearsal playback chooses one BPM.
 */
export function parseMidi(input) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : null;
  if (!bytes) throw new TypeError('MIDI data must be an ArrayBuffer or typed array.');
  let pos = 0;
  const requireBytes = (count, limit = bytes.length) => {
    if (pos + count > limit) throw new Error('This MIDI file is truncated.');
  };
  const u8 = () => { requireBytes(1); return bytes[pos++]; };
  const u16 = () => (u8() << 8) | u8();
  const u32 = () => u8() * 0x1000000 + (u8() << 16) + (u8() << 8) + u8();
  const text = () => String.fromCharCode(u8(), u8(), u8(), u8());
  const vlq = (limit) => {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      requireBytes(1, limit);
      const byte = u8();
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('Invalid variable-length value in MIDI file.');
  };
  if (text() !== 'MThd') throw new Error('This is not a Standard MIDI File.');
  const headerLength = u32();
  if (headerLength < 6) throw new Error('Invalid MIDI header.');
  requireBytes(headerLength);
  const format = u16();
  const trackCount = u16();
  const ppq = u16();
  if (format > 1) throw new Error('MIDI format 2 is not supported. Export a format 0 or 1 file.');
  if (ppq & 0x8000) throw new Error('SMPTE-timed MIDI is not supported. Export with musical beat timing.');
  if (!ppq || !trackCount || (format === 0 && trackCount !== 1)) throw new Error('Invalid MIDI timing or track count.');
  pos += headerLength - 6;

  const events = [];
  const tempos = [];
  const timeSignatures = [];
  const trackNames = [];
  const warnings = [];
  let lastTick = 0;
  for (let track = 0; track < trackCount; track++) {
    if (text() !== 'MTrk') throw new Error('A MIDI track is missing or invalid.');
    const length = u32();
    requireBytes(length);
    const limit = pos + length;
    let tick = 0;
    let runningStatus = 0;
    while (pos < limit) {
      tick += vlq(limit);
      lastTick = Math.max(lastTick, tick);
      requireBytes(1, limit);
      let status = u8();
      if (status < 0x80) {
        if (!runningStatus) throw new Error('Invalid running status in MIDI file.');
        pos--;
        status = runningStatus;
      }
      if (status === 0xff) {
        runningStatus = 0;
        requireBytes(1, limit);
        const type = u8();
        const size = vlq(limit);
        requireBytes(size, limit);
        if (type === 0x51 && size === 3) {
          const micros = bytes[pos] * 65536 + bytes[pos + 1] * 256 + bytes[pos + 2];
          if (micros) tempos.push({ beat: tick / ppq, bpm: 60000000 / micros });
        }
        if (type === 0x58 && size >= 2) {
          const numerator = bytes[pos];
          const denominator = 2 ** bytes[pos + 1];
          if (numerator && denominator <= 128) timeSignatures.push({ beat: tick / ppq, numerator, denominator });
        }
        if (type === 0x03) trackNames[track] = new TextDecoder().decode(bytes.subarray(pos, pos + size));
        pos += size;
        if (type === 0x2f) { pos = limit; break; }
      } else if (status === 0xf0 || status === 0xf7) {
        runningStatus = 0;
        const size = vlq(limit);
        requireBytes(size, limit);
        pos += size;
      } else if (status >= 0x80 && status < 0xf0) {
        runningStatus = status;
        const kind = status >> 4;
        const channel = status & 0x0f;
        const size = kind === 0xc || kind === 0xd ? 1 : 2;
        requireBytes(size, limit);
        const a = u8();
        const b = size === 2 ? u8() : 0;
        if (a > 127 || b > 127) throw new Error('Invalid MIDI event data.');
        if (kind === 0x8 || kind === 0x9 || kind === 0xb) events.push({ tick, track, channel, kind, a, b });
      } else {
        throw new Error('Unsupported system event in MIDI file.');
      }
    }
  }

  // Merge tracks before interpreting channel pedal state. Note pairing remains
  // per track/channel/pitch, so layered same-channel tracks cannot steal notes.
  events.sort((a, b) => a.tick - b.tick);
  const active = new Map();
  const sustained = Array.from({ length: 16 }, () => []);
  const pedal = Array(16).fill(false);
  const notes = [];
  const finish = (note, tick) => {
    const duration = (tick - note.tick) / ppq;
    // A note-on/off at the same tick has no audible duration. Do not invent a
    // grace-note length (the supplied ms.mid contains one such MIDI artifact).
    if (duration > 0) notes.push({
      midi: note.midi, time: note.tick / ppq, duration,
      velocity: note.velocity, channel: note.channel, track: note.track,
    });
  };
  const releasePedal = (channel, tick) => {
    sustained[channel].forEach(note => finish(note, tick));
    sustained[channel] = [];
  };
  for (const event of events) {
    const { tick, track, channel, kind, a, b } = event;
    const key = `${track}:${channel}:${a}`;
    if (kind === 0x9 && b > 0) {
      const queue = active.get(key) || [];
      queue.push({ tick, midi: a, velocity: b / 127, channel, track });
      active.set(key, queue);
    } else if (kind === 0x8 || (kind === 0x9 && b === 0)) {
      const queue = active.get(key);
      const note = queue?.shift();
      if (queue && !queue.length) active.delete(key);
      if (note) {
        if (pedal[channel]) sustained[channel].push(note);
        else finish(note, tick);
      }
    } else if (kind === 0xb && a === 64) {
      pedal[channel] = b >= 64;
      if (!pedal[channel]) releasePedal(channel, tick);
    } else if (kind === 0xb && (a === 120 || a === 123)) {
      for (const [noteKey, queue] of active) {
        if (queue[0]?.channel !== channel) continue;
        for (const note of queue) {
          if (a === 123 && pedal[channel]) sustained[channel].push(note);
          else finish(note, tick);
        }
        active.delete(noteKey);
      }
      if (a === 120) releasePedal(channel, tick);
    } else if (kind === 0xb && a === 121) {
      pedal[channel] = false;
      releasePedal(channel, tick);
    }
  }
  if (active.size) warnings.push('Some notes had no note-off; they end at the end of the MIDI file.');
  for (const queue of active.values()) queue.forEach(note => finish(note, lastTick));
  sustained.forEach(queue => queue.forEach(note => finish(note, lastTick)));
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  const normalize = (list, fallback) => {
    const result = [fallback];
    for (const event of list.sort((a, b) => a.beat - b.beat)) {
      if (result.at(-1).beat === event.beat) result[result.length - 1] = event;
      else result.push(event);
    }
    return result;
  };
  return {
    format, ppq, trackCount, trackNames, notes, duration: lastTick / ppq,
    tempos: normalize(tempos, { beat: 0, bpm: 120 }),
    timeSignatures: normalize(timeSignatures, { beat: 0, numerator: 4, denominator: 4 }),
    warnings,
  };
}
