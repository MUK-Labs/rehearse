/**
 * A shared-clock, sampled acoustic-piano transport. Sources are scheduled ahead
 * against AudioContext time; every part is measured in quarter-note beats.
 * No external runtime and no network dependency beyond the supplied sample URLs.
 */
export class PianoPlayer {
  constructor({ sampleUrls = {}, onEnded = () => {}, audioContext = null } = {}) {
    this.sampleUrls = sampleUrls;
    this.onEnded = onEnded;
    this.context = audioContext;
    this.tempo = 80;
    this.parts = [];
    this.buffers = new Map();
    this.voices = new Set();
    this._playing = false;
    this._position = 0;
    this._duration = 0;
    this._generation = 0;
    this._timer = null;
    this._initializing = null;
    this._lookAhead = 0.16;
  }

  get playing() { return this._playing; }
  get duration() { return this._duration; }

  /** Call from a click/tap so the browser can unlock audio immediately. */
  async initialize() {
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('This browser does not support Web Audio.');
      this.context = new AudioContextClass();
    }
    // Resume before awaiting downloads: the user gesture is still active here.
    const resume = this.context.state !== 'running' ? this.context.resume() : Promise.resolve();
    if (!this._initializing) {
      this._initializing = this._loadSamples().catch(error => {
        this._initializing = null; // A temporary download error can be retried.
        throw error;
      });
    }
    await Promise.all([resume, this._initializing]);
    if (this.context.state !== 'running') throw new Error('Audio is suspended. Press Play again to enable sound.');
  }

  async _loadSamples() {
    const entries = Object.entries(this.sampleUrls);
    if (!entries.length) throw new Error('No piano samples are configured.');
    const decoded = await Promise.all(entries.map(async ([pitch, url]) => {
      const midi = Number(pitch);
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new Error('Invalid piano sample pitch.');
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        if (!buffer?.duration) throw new Error('Empty audio sample');
        return [midi, buffer];
      } catch (error) {
        throw new Error(`Could not load the piano sound (${url}). ${error.message}`);
      }
    }));
    this.buffers = new Map(decoded);
    this.samplePitches = decoded.map(([pitch]) => pitch).sort((a, b) => a - b);
    if (!this.master) {
      this.master = this.context.createGain();
      this.master.gain.value = 0.65;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -10;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 4;
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
    }
  }

  /** Parts: [{id, notes:[{midi,time,duration,velocity}], duration?, enabled?}]. */
  setParts(parts) {
    this.stop();
    const ids = new Set();
    this.parts = parts.map(part => {
      if (part.id == null || ids.has(part.id)) throw new Error('Each MIDI part needs a unique ID.');
      if (part.duration != null && (!Number.isFinite(part.duration) || part.duration < 0)) {
        throw new Error('A MIDI part has an invalid duration.');
      }
      ids.add(part.id);
      const notes = part.notes.map(note => {
        if (!Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127 ||
            !Number.isFinite(note.time) || note.time < 0 ||
            !Number.isFinite(note.duration) || note.duration <= 0) {
          throw new Error('A MIDI part contains an invalid note.');
        }
        return { ...note, velocity: Number.isFinite(note.velocity) ? Math.max(0, Math.min(1, note.velocity)) : 0.75 };
      }).sort((a, b) => a.time - b.time);
      return { id: part.id, notes, enabled: part.enabled !== false, cursor: 0,
        duration: notes.reduce((duration, note) => Math.max(duration, note.time + note.duration), Number(part.duration) || 0) };
    });
    this._duration = Math.max(0, ...this.parts.map(part => part.duration));
  }

  /** All parts enter at the same beat and AudioContext timestamp. */
  async play(startBeat = this._position) {
    const generation = ++this._generation;
    await this.initialize();
    if (generation !== this._generation) return false;
    this._begin(this._clamp(startBeat));
    return true;
  }

  _clamp(beat) {
    return Math.min(this.duration, Math.max(0, Number(beat) || 0));
  }

  _begin(beat) {
    this._clearTimer();
    this._stopVoices();
    this._position = beat;
    this._anchorBeat = beat;
    this._anchorTime = this.context.currentTime + 0.015;
    this._playing = beat < this.duration;
    for (const part of this.parts) this._resetCursor(part, beat);
    if (!this._playing) return;
    this._schedule();
    this._timer = setInterval(() => this._schedule(), 25);
  }

  _resetCursor(part, beat) {
    // Include notes held across the chosen entry point, not just new onsets.
    part.cursor = 0;
    while (part.cursor < part.notes.length &&
      part.notes[part.cursor].time + part.notes[part.cursor].duration <= beat) part.cursor++;
  }

  getBeat() {
    if (!this._playing) return this._position;
    return this._clamp(this._anchorBeat + Math.max(0, this.context.currentTime - this._anchorTime) * this.tempo / 60);
  }

  pause() {
    this._generation++;
    this._position = this.getBeat();
    this._playing = false;
    this._clearTimer();
    this._stopVoices();
    return this._position;
  }

  stop() {
    this.pause();
    this._position = 0;
  }

  seek(beat) {
    const position = this._clamp(beat);
    this._generation++;
    if (this._playing) this._begin(position);
    else this._position = position;
    return position;
  }

  setTempo(bpm) {
    const tempo = Number(bpm);
    if (!Number.isFinite(tempo) || tempo < 10 || tempo > 400) throw new Error('Tempo must be between 10 and 400 BPM.');
    const beat = this.getBeat();
    this.tempo = tempo;
    if (this._playing) this._begin(beat);
  }

  setPartEnabled(id, enabled) {
    const part = this.parts.find(item => item.id === id);
    if (!part) throw new Error(`Unknown MIDI part: ${id}`);
    if (part.enabled === Boolean(enabled)) return;
    part.enabled = Boolean(enabled);
    if (!part.enabled) this._stopVoices(id);
    else if (this._playing) {
      this._resetCursor(part, this.getBeat());
      this._schedule();
    }
  }

  _schedule() {
    if (!this._playing) return;
    const beat = this.getBeat();
    if (beat >= this.duration) {
      this._position = this.duration;
      this._playing = false;
      this._clearTimer();
      this.onEnded();
      return;
    }
    const horizon = this._anchorBeat + (this.context.currentTime + this._lookAhead - this._anchorTime) * this.tempo / 60;
    for (const part of this.parts) {
      if (!part.enabled) continue;
      while (part.cursor < part.notes.length && part.notes[part.cursor].time <= horizon) {
        const note = part.notes[part.cursor++];
        if (note.time + note.duration > beat) this._scheduleNote(part.id, note);
      }
    }
  }

  _scheduleNote(partId, note) {
    const secondsPerBeat = 60 / this.tempo;
    const nominalStart = this._anchorTime + (note.time - this._anchorBeat) * secondsPerBeat;
    const when = Math.max(this.context.currentTime + 0.002, this._anchorTime, nominalStart);
    const end = this._anchorTime + (note.time + note.duration - this._anchorBeat) * secondsPerBeat;
    if (end <= when || note.velocity <= 0) return;
    const pitch = this.samplePitches.reduce((best, candidate) =>
      Math.abs(candidate - note.midi) < Math.abs(best - note.midi) ? candidate : best);
    const buffer = this.buffers.get(pitch);
    const rate = 2 ** ((note.midi - pitch) / 12);
    const offset = Math.max(0, when - nominalStart) * rate;
    if (offset >= buffer.duration) return; // A long-held piano note has naturally decayed.
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const amplitude = Math.pow(note.velocity, 1.5);
    const attackEnd = Math.min(when + 0.008, end);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(amplitude, attackEnd);
    gain.gain.setValueAtTime(amplitude, end);
    gain.gain.exponentialRampToValueAtTime(0.0001, end + 0.15);
    source.connect(gain);
    gain.connect(this.master);
    const voice = { source, gain, partId, when };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
    };
    source.start(when, offset);
    source.stop(end + 0.16);
  }

  _stopVoices(partId = null) {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      if (partId !== null && voice.partId !== partId) continue;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.002);
      try { voice.source.stop(now + 0.012); } catch { /* Already ended. */ }
      this.voices.delete(voice);
    }
  }

  _clearTimer() {
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = null;
  }

  async dispose() {
    this.stop();
    if (this.context?.state !== 'closed') await this.context?.close();
  }
}
