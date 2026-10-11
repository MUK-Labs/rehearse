import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validatePiece, currentBar, inferBars, regionParts } from '../js/model.js';

// A small DOM adapter exercises application orchestration without needing a
// browser or replacing the separately tested MIDI/audio implementation.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parent = null;
    this.attributes = {}; this.dataset = {}; this.style = {}; this.handlers = {};
    this.textContent = ''; this._value = ''; this.disabled = false; this.hidden = false;
    this.checked = false; this.clientWidth = 1000;
    const classes = new Set();
    this.classList = {
      add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
      contains: value => classes.has(value),
      toggle: (value, force = !classes.has(value)) => {
        force ? classes.add(value) : classes.delete(value); return force;
      },
      toString: () => [...classes].join(' '),
    };
  }
  get className() { return this.classList.toString(); }
  set className(value) {
    this.className.split(' ').forEach(name => this.classList.remove(name));
    value.split(/\s+/).filter(Boolean).forEach(name => this.classList.add(name));
  }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) {
    this.children.forEach(child => { child.parent = null; }); this.children = []; this.append(...children);
    if (this.tagName === 'SELECT') this.value = children[0]?.value || '';
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  async dispatch(type, values = {}) {
    const event = { target: this, button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, ...values };
    for (const handler of this.handlers[type] || []) await handler(event);
  }
  click() { if (!this.disabled) return this.dispatch('click'); }
  contains(target) { return target === this || this.children.some(child => child.contains(target)); }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('.') ? node.classList.contains(selector.slice(1))
      : selector === 'input:checked' ? node.tagName === 'INPUT' && node.checked
      : selector.startsWith('option[value=') ? node.tagName === 'OPTION' && node.value === selector.match(/"([^"]+)"/)[1]
      : node.tagName.toLowerCase() === selector;
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1400, bottom: 1400 }; }
  getContext() { return {}; }
  setPointerCapture() {}
  scrollIntoView() {}
}

class Player {
  constructor() { this.playing = false; this.beat = 0; this.buffers = new Map([[60, {}]]); this.tempo = 120; this.parts = []; }
  setParts(parts) { this.parts = parts; this.duration = Math.max(...parts.map(part => part.duration)); this.beat = 0; }
  setTempo(tempo) { this.tempo = tempo; }
  setPartEnabled(id, enabled) { this.parts.find(part => part.id === id).enabled = enabled; }
  getBeat() { return this.beat; }
  async play(beat) { this.beat = beat; this.playing = true; return true; }
  pause() { this.playing = false; }
  stop() { this.playing = false; this.beat = 0; }
  seek(beat) { this.beat = beat; }
}

const fixture = id => ({ id, title: id, pdf: `${id}.pdf`, tempo: 90,
  parts: [{ id: 'right', label: 'Right', midi: 'right.mid' }, { id: 'left', label: 'Left', midi: 'left.mid' }],
  bars: [{ number: 1, beat: 0, page: 1, x: .1, y: .2 }, { number: 2, beat: 4, page: 1, x: .5, y: .2 }],
  regions: [{ page: 1, parts: ['right'], x: .1, y: .2, width: .8, height: .1 },
    { page: 1, parts: ['right', 'left'], x: .1, y: .3, width: .8, height: .1 }],
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function harness({ pageGate, badPiece, query = '?piece=First' } = {}) {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const body = new Element('body'), ids = new Map();
  for (const match of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = new Element(match[1]); node.id = match[3]; node.disabled = /\bdisabled\b/.test(match[2]);
    node.hidden = /\bhidden\b/.test(match[2]); node.checked = /\bchecked\b/.test(match[2]);
    node.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || '';
    ids.set(node.id, node); body.append(node);
  }
  ids.get('piece-note').append(new Element('p'));
  const document = { body, title: '', getElementById: id => ids.get(id),
    createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('#text'), { textContent: text }),
    querySelectorAll: selector => body.querySelectorAll(selector), addEventListener() {},
  };
  const storage = new Map(); const pdfCalls = [];
  const pdfjs = { GlobalWorkerOptions: {}, getDocument: options => {
    pdfCalls.push(options);
    return { promise: Promise.resolve({ numPages: 1, async destroy() {},
      async getPage() {
        if (pageGate && options.url.endsWith('/First.pdf')) await pageGate.promise;
        return { getViewport: ({ scale }) => ({ width: 600 * scale, height: 840 * scale }), render: () => ({ promise: Promise.resolve() }) };
      },
    }) };
  } };
  const fetch = async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/library/index.json')) return { ok: true, json: async () => ({ pieces: ['First', 'Second', 'Broken'].map(id => ({ id, title: id })) }) };
    if (path.endsWith('/manifest.json')) return { ok: true, json: async () => ({ samples: [{ midi: 60, file: 'C4.mp3' }] }) };
    if (path.endsWith('/piece.json')) {
      const id = path.split('/').at(-2);
      if (id === badPiece) return { ok: false, status: 404 };
      return { ok: true, json: async () => fixture(id) };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
  };
  const location = { href: `https://example.test/rehearse/${query}` };
  const context = vm.createContext({ document, window: { addEventListener() {} }, pdfjs, PianoPlayer: Player,
    parseMidi: () => ({ duration: 16, notes: [{ midi: 60, time: 0, duration: 1, velocity: 1 }],
      tempos: [{ beat: 0, bpm: 96 }], timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }] }),
    validatePiece, currentBar, inferBars, regionParts, structuredClone, URL, Blob, console, fetch,
    location, history: { replaceState(_state, _title, url) { location.href = String(url); } },
    devicePixelRatio: 1, innerHeight: 900, requestAnimationFrame() {}, setTimeout() {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
  let source = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*$/gm, '').replaceAll('import.meta.url', "'https://example.test/rehearse/js/app.js'");
  source = source.replace(/\bboot\(\);\s*$/, 'globalThis.bootPromise = boot();');
  source += '\nglobalThis.app = { state, player, loadLibraryPiece, openPiece, setEditing, setMode };';
  vm.runInContext(source, context, { filename: 'app.js' });
  return { context, document, ids, storage, pdfCalls, app: context.app, boot: context.bootPromise };
}

test('boot renders the selected library score, maps and locally hosted piano configuration', async () => {
  const h = await harness(); await h.boot;
  assert.equal(h.ids.get('piece-title').textContent, 'First');
  assert.equal(h.ids.get('play').disabled, false);
  assert.equal(h.ids.get('score').children.length, 1);
  assert.equal(h.document.querySelectorAll('.bar-marker').length, 2);
  assert.match(h.app.player.sampleUrls[60], /\/rehearse\/assets\/piano\/C4\.mp3$/);
  assert.match(h.pdfCalls[0].wasmUrl, /\/rehearse\/vendor\/pdfjs\/wasm\/$/);
  assert.equal(h.document.body.classList.contains('fullscreen'), false);
  assert.equal(h.app.player.tempo, 90);
});

test('fullscreen and bpm URL options retain piece selection and initialize readable playback controls', async () => {
  const h = await harness({ query: '?piece=Second&fullscreen=1&bpm=72' });
  assert.equal(h.document.body.classList.contains('fullscreen'), true);
  await h.boot;
  assert.equal(h.app.state.piece.id, 'Second');
  assert.equal(h.app.player.tempo, 72);
  assert.equal(h.ids.get('tempo').value, '72');
  assert.equal(h.ids.get('tempo-range').value, '72');
  assert.equal(h.app.player.playing, false);
  await h.ids.get('edit-toggle').click();
  assert.equal(h.document.body.classList.contains('mapping'), true);
  assert.equal(h.document.body.classList.contains('fullscreen'), true);
  await h.ids.get('edit-close').click();
  assert.equal(h.document.body.classList.contains('mapping'), false);
  assert.equal(h.document.body.classList.contains('fullscreen'), true);
});

test('URL tempo wins over saved-map tempo on reload and survives changing library pieces', async () => {
  const h = await harness({ query: '?piece=First&fullscreen=1&bpm=72' }); await h.boot;
  const saved = structuredClone(h.app.state.piece); saved.tempo = 110;
  h.storage.set(h.app.state.storageKey, JSON.stringify({ source: h.app.state.sourceKey, piece: saved }));
  await h.app.loadLibraryPiece('First');
  assert.equal(h.app.player.tempo, 72);
  assert.equal(h.ids.get('tempo').value, '72');
  assert.equal(h.ids.get('tempo-range').value, '72');
  h.ids.get('tempo').value = '100'; await h.ids.get('tempo').dispatch('change');
  assert.equal(h.app.player.tempo, 100);
  await h.app.loadLibraryPiece('Second');
  assert.equal(h.app.player.tempo, 72);
  assert.equal(h.ids.get('tempo').value, '72');
  assert.equal(h.ids.get('tempo-range').value, '72');
  const url = new URL(h.context.location.href);
  assert.equal(url.searchParams.get('piece'), 'Second');
  assert.equal(url.searchParams.get('fullscreen'), '1');
  assert.equal(url.searchParams.get('bpm'), '72');
  assert.equal(h.app.player.playing, false);
});

test('invalid URL options preserve the normal layout and the piece tempo', async () => {
  for (const bpm of ['', 'nope', 'NaN', 'Infinity', '0', '-72', '19', '301']) {
    const h = await harness({ query: `?piece=First&fullscreen=true&bpm=${encodeURIComponent(bpm)}` }); await h.boot;
    assert.equal(h.document.body.classList.contains('fullscreen'), false);
    assert.equal(h.app.player.tempo, 90, `bpm=${bpm}`);
    assert.equal(h.ids.get('tempo').value, '90');
    assert.equal(h.ids.get('tempo-range').value, '90');
  }
});

test('score play markers, tempo and shared-region muting operate through the UI', async () => {
  const h = await harness(); await h.boot;
  await h.document.querySelectorAll('.bar-marker')[1].click();
  assert.equal(h.app.player.getBeat(), 4); assert.equal(h.app.player.playing, true);
  await h.ids.get('play').click(); assert.equal(h.app.player.playing, false);
  h.ids.get('tempo').value = '999'; await h.ids.get('tempo').dispatch('change');
  assert.equal(h.app.player.tempo, 300);
  await h.ids.get('parts').children[0].click();
  const regions = h.document.querySelectorAll('.part-region');
  assert.equal(regions[0].classList.contains('muted'), true);
  assert.equal(regions[1].classList.contains('muted'), false);
  await h.ids.get('parts').children[1].click();
  assert.equal(regions[1].classList.contains('muted'), true);
});

test('mapping stores normalized bar positions, advances selection and supports undo and region drawing', async () => {
  const h = await harness(); await h.boot;
  await h.ids.get('edit-toggle').click();
  const overlay = h.app.state.pages[0].overlay;
  await overlay.dispatch('pointerdown', { clientX: 250, clientY: 350 });
  assert.equal(h.app.state.piece.bars[0].x, .25); assert.equal(h.app.state.piece.bars[0].y, .25);
  assert.equal(h.app.state.editIndex, 1);
  assert.equal(JSON.parse([...h.storage.values()][0]).piece.bars[0].x, .25);
  await h.ids.get('undo').click(); assert.equal(h.app.state.piece.bars[0].x, .1);
  await h.ids.get('mode-regions').click();
  await overlay.dispatch('pointerdown', { clientX: 100, clientY: 700 });
  await overlay.dispatch('pointerup', { clientX: 700, clientY: 840 });
  const added = h.app.state.piece.regions.at(-1);
  assert.equal(added.x, .1); assert.equal(added.y, .5); assert.ok(Math.abs(added.width - .6) < 1e-9);
  assert.ok(Math.abs(added.height - .1) < 1e-9); assert.deepEqual(Array.from(added.parts), ['right']);
});

test('a failed piece load keeps the previous usable score controls available', async () => {
  const h = await harness({ badPiece: 'Broken' }); await h.boot;
  await h.app.loadLibraryPiece('Broken');
  assert.match(h.ids.get('status').textContent, /404/);
  assert.equal(h.ids.get('piece-title').textContent, 'First');
  assert.equal(h.ids.get('play').disabled, false);
});

test('local PDF and MIDI import infers bars and opens the map editor', async () => {
  const h = await harness(); await h.boot;
  h.ids.get('open-files').files = [new File(['PDF'], 'My score.pdf'), new File(['MIDI'], 'piano.mid')];
  await h.ids.get('open-files').dispatch('change');
  assert.equal(h.app.state.piece.title, 'My score');
  assert.equal(h.app.state.piece.tempo, 96);
  assert.equal(h.app.state.piece.bars.length, 4);
  assert.equal(h.app.state.piece.bars.every(bar => bar.page === null), true);
  assert.equal(h.app.state.editing, true);
  assert.equal(h.ids.get('piece-select').value, '__local');
  assert.equal(h.ids.get('play').disabled, false);
});

test('local map import reports missing files and preserves the loaded score', async () => {
  const h = await harness(); await h.boot;
  const map = fixture('Local');
  h.ids.get('open-files').files = [new File(['PDF'], 'Local.pdf'), new File(['MIDI'], 'right.mid'),
    new File([JSON.stringify(map)], 'piece.json')];
  await h.ids.get('open-files').dispatch('change');
  assert.match(h.ids.get('status').textContent, /left\.mid/);
  assert.equal(h.app.state.piece.id, 'First');
  assert.equal(h.ids.get('play').disabled, false);
});

test('a superseded PDF page request cannot append a stale page into the new score', async () => {
  const pageGate = deferred(); const h = await harness({ pageGate });
  // Wait until the first document is awaiting its page, then choose another piece.
  for (let tries = 0; !h.pdfCalls.length && tries < 20; tries++) await Promise.resolve();
  assert.equal(h.pdfCalls.length, 1);
  await h.app.loadLibraryPiece('Second');
  pageGate.resolve(); await h.boot;
  assert.equal(h.app.state.piece.id, 'Second');
  assert.equal(h.ids.get('score').children.length, 1);
  assert.equal(h.app.state.pages.length, 1);
});
