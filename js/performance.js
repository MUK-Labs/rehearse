import { openPdf } from './pdf.js';
import { buildPerformanceViews, normalizePerformanceRegions, normalizePublicUrl, parseSetlistCsv, wholePage } from './performance-model.js';
import { setupPerformanceMidi } from './performance-midi.js';
import { hasPerformanceOfflineShell, preparePerformanceOffline } from './performance-offline.js';
import { createScoreRenderer, renderScoreCanvas } from './performance-render.js';
import { getStoredPdf, removeStoredPdf, storePdf } from './performance-storage.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const pdfs = new Map();
const temporaryPdfs = new Map();
const storageKey = 'rehearse.performance.setlist.v1';
const sample = {
  id: 'quasi-campane',
  title: 'QuasiCampane',
  url: new URL('./library/QuasiCampane/score.pdf', location.href).href,
  regions: [],
};

let scores = [sample];
let csvUrl = '';
let scoreIndex = 0;
let selectedRegion = -1;
let pageNumber = 1;
let pageCount = 0;
let previewToken = 0;
let previewController;
let drag;
let views = [];
let viewIndex = 0;
let displayedIndex = -1;
let stageToken = 0;
let renderToken = 0;
let controlsTimer;
let wakeLock;
let importing = false;
let preparingOffline = false;
let stagePdfs = new Map();
let offlineCheck = 0;

const currentScore = () => scores[scoreIndex];
const renderer = createScoreRenderer(id => getDocument(scores.find(score => score.id === id)));

function status(message = '', error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({version: 1, csvUrl, scores}));
    return true;
  } catch {
    status('This browser could not save the setlist. Export a copy to keep your changes.', true);
    return false;
  }
}

function readSetlist(data) {
  if (data?.version !== 1 || !Array.isArray(data.scores)) throw new Error('Choose a Rehearse Performance setlist export.');
  const ids = new Set();
  return data.scores.map(score => {
    if (typeof score?.id !== 'string' || !score.id || ids.has(score.id) || typeof score.title !== 'string' || !score.title.trim()) {
      throw new Error('Each score needs a unique ID and a title.');
    }
    ids.add(score.id);
    const fileKey = typeof score.fileKey === 'string' && score.fileKey.startsWith('local:') ? score.fileKey : '';
    if (!score.url && !fileKey) throw new Error(`${score.title} is missing a PDF source.`);
    return {
      id: score.id,
      title: score.title,
      url: score.url ? normalizePublicUrl(score.url, location.href) : '',
      driveUrl: score.driveUrl ? normalizePublicUrl(score.driveUrl, location.href) : '',
      fileKey,
      regions: normalizePerformanceRegions(score.regions),
    };
  });
}

function option(value, text) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = text;
  return node;
}

function enableEditorActions() {
  const score = currentScore();
  const locked = importing || preparingOffline;
  $('start').disabled = locked || !scores.length;
  $('export').disabled = locked || !scores.length;
  $('offline').disabled = locked || !scores.length;
  for (const id of ['local-csv-button', 'local-pdfs-button', 'import-button', 'csv-url']) $(id).disabled = locked;
  $('setlist-form').querySelector('button').disabled = locked;
  $('score-pick').disabled = !scores.length || locked;
  $('score-up').disabled = scoreIndex <= 0 || locked;
  $('score-down').disabled = !score || scoreIndex >= scores.length - 1 || locked;
  $('remove-score').disabled = !score || locked;
  $('attach-button').disabled = !score || locked;
  const regions = score?.regions ?? [];
  $('region-pick').disabled = !regions.length || locked;
  $('region-up').disabled = selectedRegion <= 0 || locked;
  $('region-down').disabled = selectedRegion < 0 || selectedRegion >= regions.length - 1 || locked;
  $('remove-region').disabled = selectedRegion < 0 || locked;
  $('add-page').disabled = !pageCount || $('preview-page').hidden || locked;
  $('page-pick').disabled = !pageCount || locked;
  $('preview-prev').disabled = !pageCount || pageNumber <= 1 || locked;
  $('preview-next').disabled = !pageCount || pageNumber >= pageCount || locked;
}

function updateScores() {
  $('score-pick').replaceChildren(...scores.map((score, index) => option(index, score.title)));
  $('score-pick').selectedIndex = scoreIndex;
  const score = currentScore();
  $('preview-title').textContent = score?.title || 'Score preview';
  const link = $('source-pdf');
  link.hidden = !score?.url;
  if (score?.url) link.href = score.driveUrl || score.url;
  updateRegions();
}

function updateRegions() {
  const regions = currentScore()?.regions ?? [];
  $('region-pick').replaceChildren(...regions.map((region, index) => {
    const label = region.width === 1 && region.height === 1 ? 'Whole page' : 'Selected region';
    return option(index, `${index + 1}. ${label} · page ${region.page}`);
  }));
  $('region-pick').selectedIndex = selectedRegion;
  drawBox(regions[selectedRegion]?.page === pageNumber ? regions[selectedRegion] : null);
  enableEditorActions();
}

function pdfKey(score) {
  return score.fileKey || `remote:${score.url}`;
}

async function fetchResource(url, label) {
  let response;
  try {
    response = await fetch(url, {credentials: 'omit', signal: AbortSignal.timeout(20000)});
  } catch {
    throw new Error(`Could not load ${label}. Check the link and whether the host allows access from Rehearse.`);
  }
  if (!response.ok) throw new Error(`Could not load ${label} (HTTP ${response.status}).`);
  return response;
}

async function readPdf(score) {
  const key = pdfKey(score);
  if (stagePdfs.has(key)) return stagePdfs.get(key);
  if (temporaryPdfs.has(key)) return temporaryPdfs.get(key);
  const stored = await getStoredPdf(key).catch(() => null);
  if (stored) return stored;
  if (!score.url) throw new Error(`Attach the local PDF for “${score.title}” on this device.`);

  try {
    const response = await fetchResource(score.url, `“${score.title}”`);
    const blob = await response.blob();
    if (!(await blob.slice(0, 1024).text()).includes('%PDF-')) {
      throw new Error('The link returned a web page or another type of file.');
    }
    return blob;
  } catch (error) {
    if (score.driveUrl) {
      throw new Error(`Google Drive did not provide a readable PDF for “${score.title}”. Open the original, download it, then choose Attach PDF.`);
    }
    throw new Error(`${error.message} Open the original or choose Attach PDF to use a local copy.`);
  }
}

function getDocument(score) {
  const key = pdfKey(score);
  const current = pdfs.get(key);
  if (current) return current.promise;
  const entry = {};
  entry.promise = readPdf(score).then(async blob => {
    const data = new Uint8Array(await blob.arrayBuffer());
    if (pdfs.get(key) !== entry) throw new DOMException('Score is no longer needed.', 'AbortError');
    entry.task = openPdf({data});
    return entry.task.promise;
  }).catch(error => {
    if (pdfs.get(key) === entry) pdfs.delete(key);
    entry.task?.destroy().catch(() => {});
    throw error;
  });
  pdfs.set(key, entry);
  return entry.promise;
}

function keepDocuments(needed) {
  const keys = new Set(needed.filter(Boolean).map(pdfKey));
  for (const [key, entry] of pdfs) {
    if (keys.has(key)) continue;
    pdfs.delete(key);
    entry.task?.destroy().catch(() => {});
  }
}

function previewMessage(message = '') {
  $('preview-message').textContent = message;
  $('preview-message').hidden = !message;
}

async function showPreview(page = 1) {
  const token = ++previewToken;
  previewController?.abort();
  previewController = new AbortController();
  const score = currentScore();
  pageNumber = page;
  pageCount = 0;
  $('preview-page').hidden = true;
  $('page-pick').replaceChildren();
  updateRegions();
  if (!score) {
    previewMessage('Load a setlist or add a PDF to begin.');
    return;
  }
  keepDocuments([score]);
  previewMessage('Opening the score…');
  try {
    const pdf = await getDocument(score);
    if (token !== previewToken || !stage.hidden) return;
    const canvas = await renderScoreCanvas(pdf, wholePage(page), {
      width: Math.max(1, $('preview-area').clientWidth - 32),
      height: 880,
      signal: previewController.signal,
    });
    if (token !== previewToken || !stage.hidden) return;
    canvas.id = 'preview-canvas';
    canvas.setAttribute('aria-label', `${score.title}, PDF page ${page}`);
    $('preview-canvas').replaceWith(canvas);
    pageCount = pdf.numPages;
    $('page-pick').replaceChildren(...Array.from({length: pageCount}, (_, index) => option(index + 1, `${index + 1} / ${pageCount}`)));
    $('page-pick').value = String(page);
    $('preview-page').hidden = false;
    previewMessage();
  } catch (error) {
    if (token !== previewToken || !stage.hidden) return;
    previewMessage(error.message);
  }
  updateRegions();
}

function selectScore(index) {
  scoreIndex = index;
  selectedRegion = -1;
  updateScores();
  void showPreview();
}

function invalidateOfflineStatus() {
  offlineCheck++;
  $('offline-status').textContent = '';
}

function setScores(nextScores) {
  scores = nextScores;
  invalidateOfflineStatus();
  save();
  selectScore(nextScores.length ? 0 : -1);
}

function mergeCsvScores(imported) {
  return imported.map(score => {
    const saved = scores.find(existing => existing.id === score.id);
    return {...score, regions: saved?.regions ?? [], fileKey: saved?.fileKey ?? ''};
  });
}

async function runImport(operation) {
  importing = true;
  enableEditorActions();
  status();
  try {
    await operation();
  } catch (error) {
    status(error.message, true);
  } finally {
    importing = false;
    enableEditorActions();
  }
}

function loadCsvUrl(value) {
  return runImport(async () => {
    const url = normalizePublicUrl(value, location.href);
    const response = await fetchResource(url, 'the setlist CSV');
    const imported = parseSetlistCsv(await response.text(), response.url || url);
    csvUrl = url;
    $('csv-url').value = url;
    setScores(mergeCsvScores(imported));
  });
}

async function inspectFile(file) {
  const task = openPdf({data: new Uint8Array(await file.arrayBuffer())});
  try {
    await task.promise;
  } catch {
    throw new Error(`“${file.name}” could not be opened as a PDF.`);
  } finally {
    await task.destroy().catch(() => {});
  }
}

async function saveFile(key, blob) {
  try {
    await storePdf(key, blob);
    temporaryPdfs.delete(key);
    return true;
  } catch {
    temporaryPdfs.set(key, blob);
    return false;
  }
}

function makeFileKey() {
  return `local:${crypto.randomUUID()}`;
}

function drawBox(box) {
  const node = $('crop-box');
  node.hidden = !box;
  if (box) {
    Object.assign(node.style, {
      left: `${box.x * 100}%`,
      top: `${box.y * 100}%`,
      width: `${box.width * 100}%`,
      height: `${box.height * 100}%`,
    });
  }
}

function point(event) {
  const rect = $('crop-layer').getBoundingClientRect();
  const fraction = value => Math.min(1, Math.max(0, value));
  return {
    x: fraction((event.clientX - rect.left) / rect.width),
    y: fraction((event.clientY - rect.top) / rect.height),
  };
}

function cropRectangle(start, end) {
  return {
    page: pageNumber,
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  };
}

function appendRegion(box) {
  currentScore().regions.push(box);
  selectedRegion = currentScore().regions.length - 1;
  invalidateOfflineStatus();
  save();
  updateRegions();
}

$('crop-layer').addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary || !pageCount || importing || preparingOffline) return;
  drag = {pointer: event.pointerId, start: point(event)};
  $('crop-layer').setPointerCapture(event.pointerId);
  event.preventDefault();
});
$('crop-layer').addEventListener('pointermove', event => {
  if (drag?.pointer === event.pointerId) drawBox(cropRectangle(drag.start, point(event)));
});
$('crop-layer').addEventListener('pointerup', event => {
  if (drag?.pointer !== event.pointerId) return;
  const box = cropRectangle(drag.start, point(event));
  drag = null;
  if (box.width >= 0.01 && box.height >= 0.01) appendRegion(box);
  else updateRegions();
});
$('crop-layer').addEventListener('lostpointercapture', () => {
  if (drag) {
    drag = null;
    updateRegions();
  }
});

function move(items, from, to) {
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
}

function moveScore(delta) {
  move(scores, scoreIndex, scoreIndex + delta);
  scoreIndex += delta;
  invalidateOfflineStatus();
  save();
  updateScores();
}

function moveRegion(delta) {
  move(currentScore().regions, selectedRegion, selectedRegion + delta);
  selectedRegion += delta;
  invalidateOfflineStatus();
  save();
  updateRegions();
}

$('score-pick').addEventListener('change', event => selectScore(Number(event.currentTarget.value)));
$('score-up').addEventListener('click', () => moveScore(-1));
$('score-down').addEventListener('click', () => moveScore(1));
$('remove-score').addEventListener('click', () => {
  const [removed] = scores.splice(scoreIndex, 1);
  if (removed.fileKey && !scores.some(score => score.fileKey === removed.fileKey)) {
    temporaryPdfs.delete(removed.fileKey);
    void removeStoredPdf(removed.fileKey).catch(() => {});
  }
  invalidateOfflineStatus();
  save();
  selectScore(Math.min(scoreIndex, scores.length - 1));
});
$('region-pick').addEventListener('change', event => {
  selectedRegion = Number(event.currentTarget.value);
  void showPreview(currentScore().regions[selectedRegion].page);
});
$('region-up').addEventListener('click', () => moveRegion(-1));
$('region-down').addEventListener('click', () => moveRegion(1));
$('remove-region').addEventListener('click', () => {
  currentScore().regions.splice(selectedRegion, 1);
  selectedRegion = -1;
  invalidateOfflineStatus();
  save();
  updateRegions();
});
$('add-page').addEventListener('click', () => appendRegion(wholePage(pageNumber)));
$('page-pick').addEventListener('change', event => void showPreview(Number(event.currentTarget.value)));
$('preview-prev').addEventListener('click', () => void showPreview(pageNumber - 1));
$('preview-next').addEventListener('click', () => void showPreview(pageNumber + 1));

$('setlist-form').addEventListener('submit', event => {
  event.preventDefault();
  void loadCsvUrl($('csv-url').value);
});
for (const [button, input] of [
  ['local-csv-button', 'local-csv'], ['local-pdfs-button', 'local-pdfs'],
  ['attach-button', 'attach-pdf'], ['import-button', 'import'],
]) {
  $(button).addEventListener('click', () => $(input).click());
}

$('local-csv').addEventListener('change', event => {
  const input = event.currentTarget;
  const [file] = input.files;
  input.value = '';
  if (file) void runImport(async () => {
    const imported = parseSetlistCsv(await file.text(), document.baseURI);
    csvUrl = '';
    $('csv-url').value = '';
    setScores(mergeCsvScores(imported));
  });
});

$('local-pdfs').addEventListener('change', event => {
  const input = event.currentTarget;
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  void runImport(async () => {
    for (const file of files) await inspectFile(file);
    const first = scores.length;
    let savedAll = true;
    for (const file of files) {
      const fileKey = makeFileKey();
      if (!(await saveFile(fileKey, file))) savedAll = false;
      scores.push({id: fileKey, fileKey, title: file.name.replace(/\.pdf$/i, ''), regions: []});
    }
    invalidateOfflineStatus();
    save();
    selectScore(first);
    if (!savedAll) status('Some PDFs will be available only while this tab stays open.', true);
  });
});

$('attach-pdf').addEventListener('change', event => {
  const input = event.currentTarget;
  const [file] = input.files;
  const score = currentScore();
  input.value = '';
  if (!file || !score) return;
  void runImport(async () => {
    await inspectFile(file);
    const fileKey = score.fileKey || makeFileKey();
    keepDocuments([]);
    const saved = await saveFile(fileKey, file);
    score.fileKey = fileKey;
    invalidateOfflineStatus();
    save();
    selectScore(scoreIndex);
    if (!saved) status('The attached PDF will be available only while this tab stays open.', true);
  });
});

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({version: 1, csvUrl, scores}, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'rehearse-setlist.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (scores.some(score => score.fileKey)) status('Setlist exported. Attach any local PDFs again when you open it on another device.');
});
$('import').addEventListener('change', event => {
  const input = event.currentTarget;
  const [file] = input.files;
  input.value = '';
  if (file) void runImport(async () => {
    const data = JSON.parse(await file.text());
    const restored = readSetlist(data);
    csvUrl = typeof data.csvUrl === 'string' ? data.csvUrl : '';
    $('csv-url').value = csvUrl;
    setScores(restored);
  });
});

function showStageControls() {
  stage.classList.remove('stage-quiet');
  clearTimeout(controlsTimer);
  if (!views.length || !$('stage-error').hidden) return;
  controlsTimer = setTimeout(() => stage.classList.add('stage-quiet'), 2200);
}

async function requestWakeLock() {
  if (!navigator.wakeLock || stage.hidden || document.hidden || wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (stage.hidden || wakeLock) {
      await lock.release();
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    // Some devices disallow keeping the screen awake.
  }
}

function stageMessage(message = '') {
  $('stage-error').hidden = !message;
  $('stage-error').textContent = message;
}

function nearbyViews() {
  return views.slice(Math.max(0, viewIndex - 1), viewIndex + 2);
}

async function showStageView() {
  const request = ++renderToken;
  const view = views[viewIndex];
  if (stage.hidden || !view) return;
  const neighbors = nearbyViews();
  const neededIds = new Set(neighbors.map(item => item.scoreId));
  const {clientWidth: width, clientHeight: height} = $('stage-score');
  const size = {width, height};
  renderer.retain(neighbors);
  keepDocuments(scores.filter(score => neededIds.has(score.id)));
  $('stage-prev').disabled = viewIndex === 0;
  $('stage-next').disabled = viewIndex === views.length - 1;
  try {
    const canvas = await renderer.get(view, size);
    if (request !== renderToken || stage.hidden) return;
    const score = scores.find(item => item.id === view.scoreId);
    canvas.setAttribute('aria-label', `${score.title}, PDF page ${view.page}`);
    $('stage-score').replaceChildren(canvas);
    const firstView = displayedIndex < 0;
    displayedIndex = viewIndex;
    $('stage-position').textContent = `${score.title} · Page ${view.page} · ${viewIndex + 1} / ${views.length}`;
    stageMessage();
    if (firstView) showStageControls();
    for (const neighbor of neighbors) {
      if (neighbor !== view) void renderer.get(neighbor, size).catch(() => {});
    }
  } catch (error) {
    if (request !== renderToken || stage.hidden) return;
    stageMessage(`Could not display this view. ${error.message}`);
    showStageControls();
    if (displayedIndex >= 0) $('stage-position').textContent = `Showing view ${displayedIndex + 1} / ${views.length}`;
  }
}

function turn(delta) {
  if (stage.hidden || !views.length) return;
  const next = Math.max(0, Math.min(views.length - 1, viewIndex + delta));
  if (next === viewIndex) return;
  viewIndex = next;
  void showStageView();
}

async function startPerformance() {
  const token = ++stageToken;
  const sessionPdfs = new Map();
  stagePdfs = sessionPdfs;
  previewToken++;
  previewController?.abort();
  views = [];
  viewIndex = 0;
  displayedIndex = -1;
  stage.hidden = false;
  document.body.classList.add('performing');
  $('stage-prev').disabled = $('stage-next').disabled = true;
  $('stage-position').textContent = 'Checking the setlist…';
  stageMessage();
  $('stage-score').replaceChildren();
  stage.tabIndex = -1;
  stage.focus();
  document.querySelector('.performance-toolbar').inert = true;
  document.querySelector('.performance-main').inert = true;
  showStageControls();
  if (stage.requestFullscreen) {
    void stage.requestFullscreen().then(() => {
      if (token !== stageToken && stage.hidden && document.fullscreenElement === stage) {
        return document.exitFullscreen();
      }
    }).catch(() => {});
  }
  void requestWakeLock();

  try {
    const checked = [];
    for (const [index, score] of scores.entries()) {
      $('stage-position').textContent = `Checking ${index + 1} / ${scores.length} · ${score.title}…`;
      const key = pdfKey(score);
      if (!sessionPdfs.has(key)) sessionPdfs.set(key, await readPdf(score));
      if (token !== stageToken) return;
      keepDocuments([scores[0], score]);
      const pdf = await getDocument(score);
      if (token !== stageToken) return;
      const invalid = score.regions.find(region => region.page > pdf.numPages);
      if (invalid) throw new Error(`“${score.title}” has a saved passage beyond the last page. Remove or replace that passage before performing.`);
      checked.push({...score, pageCount: pdf.numPages});
    }
    views = buildPerformanceViews(checked);
    if (!views.length) throw new Error('There are no score pages to display.');
    void showStageView();
  } catch (error) {
    if (token !== stageToken) return;
    $('stage-position').textContent = '';
    stageMessage(error.message);
    showStageControls();
  }
}

function exitPerformance() {
  if (stage.hidden) return;
  stageToken++;
  renderToken++;
  clearTimeout(controlsTimer);
  renderer.clear();
  views = [];
  stagePdfs.clear();
  stage.hidden = true;
  document.body.classList.remove('performing');
  document.querySelector('.performance-toolbar').inert = false;
  document.querySelector('.performance-main').inert = false;
  $('stage-score').replaceChildren();
  void wakeLock?.release().catch(() => {});
  if (document.fullscreenElement === stage) void document.exitFullscreen().catch(() => {});
  $('start').focus({preventScroll: true});
  void showPreview(pageNumber);
}

$('start').addEventListener('click', () => void startPerformance());
$('stage-exit').addEventListener('click', exitPerformance);
$('stage-prev').addEventListener('click', () => turn(-1));
$('stage-next').addEventListener('click', () => turn(1));
stage.addEventListener('pointermove', showStageControls);
$('stage-score').addEventListener('pointerdown', showStageControls);
stage.addEventListener('focusin', showStageControls);
document.addEventListener('fullscreenchange', () => {
  if (!stage.hidden && !document.fullscreenElement) exitPerformance();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void requestWakeLock();
});
document.addEventListener('keydown', event => {
  if (stage.hidden || event.altKey || event.metaKey || event.ctrlKey || event.repeat) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    exitPerformance();
    return;
  }
  if (event.key === ' ' && document.activeElement === $('stage-exit')) return;
  const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key);
  const previous = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key);
  if (next || previous) {
    event.preventDefault();
    turn(next ? 1 : -1);
  }
});

new ResizeObserver(() => {
  if (!stage.hidden && views.length) void showStageView();
}).observe($('stage-score'));

$('offline').addEventListener('click', async () => {
  preparingOffline = true;
  enableEditorActions();
  try {
    if (!save()) throw new Error('Offline preparation needs to save the setlist in this browser.');
    await preparePerformanceOffline(scores, {
      readPdf,
      storePdf: (score, blob) => storePdf(pdfKey(score), blob),
      onProgress: message => { $('offline-status').textContent = message; },
    });
    $('offline-status').textContent = 'This setlist is ready offline in this browser.';
  } catch (error) {
    $('offline-status').textContent = error.message;
  } finally {
    preparingOffline = false;
    enableEditorActions();
  }
});

async function restoreOfflineStatus() {
  const token = ++offlineCheck;
  const cached = await hasPerformanceOfflineShell();
  if (!cached || token !== offlineCheck || !scores.length) return;
  const available = await Promise.all(scores.map(score => getStoredPdf(pdfKey(score)).catch(() => null)));
  if (token === offlineCheck && available.every(Boolean)) {
    $('offline-status').textContent = 'This setlist is available offline in this browser.';
  }
}

setupPerformanceMidi({
  connect: $('connect-midi'),
  previous: $('learn-previous'),
  next: $('learn-next'),
  status: $('midi-status'),
  turn,
});

try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved) {
    scores = readSetlist(saved);
    csvUrl = typeof saved.csvUrl === 'string' ? saved.csvUrl : '';
  }
} catch {
  // The bundled sample still opens if browser storage is unavailable.
}
const requestedSetlist = new URL(location.href).searchParams.get('setlist');
$('csv-url').value = requestedSetlist || csvUrl;
selectScore(scores.length ? 0 : -1);
if (requestedSetlist && requestedSetlist !== csvUrl) void loadCsvUrl(requestedSetlist);
else void restoreOfflineStatus();
