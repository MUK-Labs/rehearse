import * as pdfjs from '../vendor/pdfjs/pdf.mjs';
import { parseMidi } from './midi.js';
import { PianoPlayer } from './audio.js';
import { validatePiece, currentBar, inferBars, regionParts } from './model.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const state = {piece:null, original:null, enabled:new Map(), pages:[], editing:false, mode:'bars', editIndex:0, history:[], loadId:0, objects:[], storageKey:'', sourceKey:'', selected:null};
const player = new PianoPlayer({onEnded: () => { updateTransport(); setStatus('Finished. Choose a bar to rehearse again.'); }});
let pdfDocument = null;
let drag = null;
let pendingPlay = 0;

function setStatus(message = '', error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function option(value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; }
function setReady(ready) {
  for (const id of ['play','stop','bar-select','tempo','tempo-range','edit-toggle','download-map']) $(id).disabled = !ready;
}
async function getJSON(url) { const response = await fetch(url); if (!response.ok) throw new Error(`Could not open ${url} (${response.status}).`); return response.json(); }
async function getBytes(url) { const response = await fetch(url); if (!response.ok) throw new Error(`Could not open ${url} (${response.status}).`); return response.arrayBuffer(); }
function cancelPlayback() { pendingPlay++; player.pause(); $('play').classList.remove('loading'); updateTransport(); }

async function loadLibraryPiece(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) { setStatus('That piece id is invalid. Choose a piece from the library.', true); return; }
  const token = ++state.loadId;
  cancelPlayback(); setReady(false); setStatus('Opening the score…');
  try {
    const base = new URL(`../library/${encodeURIComponent(id)}/`, import.meta.url);
    const piece = validatePiece(await getJSON(new URL('piece.json', base)));
    if (piece.id !== id) throw new Error('The library folder and piece id do not match.');
    if (token !== state.loadId) return;
    await openPiece(piece, name => new URL(name, base).href, token, `library:${id}`);
    if (token !== state.loadId) return;
    const url = new URL(location.href); url.searchParams.set('piece', id); history.replaceState(null, '', url);
    $('piece-select').value = id;
  } catch (error) { if (token === state.loadId) recoverLoad(error); }
}

function recoverLoad(error) {
  // Keep an already open score usable after invalid input or a failed request.
  setReady(Boolean(state.piece && state.pages.length));
  if (state.piece) {
    const local = state.storageKey.includes(':local:');
    $('piece-select').value = local ? '__local' : state.piece.id;
  } else $('piece-select').selectedIndex = -1;
  setStatus(error.message,true);
}

async function openPiece(original, resolveFile, token, key) {
  validatePiece(original);
  setEditing(false);
  const sourceKey = JSON.stringify(original);
  const storageKey = `rehearse:map:v1:${key}`;
  let piece = clone(original);
  let restored = false;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.source === sourceKey) { piece = validatePiece(saved.piece); restored = true; }
  } catch { /* Invalid or unavailable browser storage does not prevent loading. */ }
  const parsedParts = await Promise.all(piece.parts.map(async part => ({...part, ...parseMidi(await getBytes(resolveFile(part.midi)))})));
  if (token !== state.loadId) return;
  const documentTask = pdfjs.getDocument({url:resolveFile(piece.pdf), cMapUrl:new URL('../vendor/pdfjs/cmaps/', import.meta.url).href, cMapPacked:true, standardFontDataUrl:new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href, wasmUrl:new URL('../vendor/pdfjs/wasm/', import.meta.url).href});
  const doc = await documentTask.promise;
  if (token !== state.loadId) { await doc.destroy(); return; }
  for (const item of [...piece.bars, ...piece.regions]) if (item.page > doc.numPages) { await doc.destroy(); throw new Error('A map position points beyond the last PDF page.'); }
  const duration = Math.max(...parsedParts.map(p => p.duration), piece.durationBeats || 0);
  if (piece.bars.some(bar => bar.beat >= duration && bar.beat !== 0)) { await doc.destroy(); throw new Error('A bar starts beyond the end of the MIDI. Correct its MIDI beat in piece.json.'); }
  const previousPdf = pdfDocument;
  pdfDocument = doc;
  if (previousPdf) previousPdf.destroy().catch(() => {});
  state.original = clone(original); state.sourceKey = sourceKey; state.storageKey = storageKey;
  state.piece = piece; state.enabled = new Map(piece.parts.map(p => [p.id, true])); state.pages = []; state.history = []; state.editIndex = 0; state.selected = null;
  player.setParts(parsedParts.map(part => ({id:part.id, notes:part.notes, duration})));
  player.setTempo(piece.tempo);
  $('tempo').value = piece.tempo; $('tempo-range').max = Math.max(240,piece.tempo); $('tempo-range').value = piece.tempo;
  $('piece-title').textContent = piece.title; document.title = `${piece.title} · Rehearse`;
  $('pdf-link').href = resolveFile(piece.pdf);
  const notes = typeof piece.notes === 'string' ? piece.notes : Array.isArray(piece.notes) ? piece.notes.join(' ') : '';
  $('piece-note').hidden = !notes; $('piece-note').querySelector('p').textContent = notes;
  renderPartControls(); refreshBarOptions(); $('score').replaceChildren();
  for (let number = 1; number <= doc.numPages; number++) {
    if (token !== state.loadId) return;
    const page = await doc.getPage(number);
    if (token !== state.loadId) return;
    const view = page.getViewport({scale:1});
    const scale = Math.min(2200, Math.max(1200, $('score').clientWidth * Math.min(devicePixelRatio || 1,2))) / view.width;
    const viewport = page.getViewport({scale});
    const section = document.createElement('div'); section.className = 'score-page'; section.dataset.page = number; section.setAttribute('aria-label', `Score page ${number}`);
    section.style.aspectRatio = `${view.width} / ${view.height}`;
    const canvas = document.createElement('canvas'); canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height); canvas.setAttribute('aria-label', `PDF score, page ${number}`);
    const overlay = document.createElement('div'); overlay.className = 'page-overlay';
    const label = document.createElement('span'); label.className = 'page-number'; label.textContent = `${number} / ${doc.numPages}`;
    section.append(canvas, overlay, label); $('score').append(section); state.pages.push({section, overlay, number});
    attachMapGestures(overlay, number);
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  }
  if (token !== state.loadId) return;
  renderOverlays(); syncEditor(); setReady(true); updateTransport();
  const unmapped = piece.bars.filter(bar => bar.page == null).length;
  setStatus(unmapped ? `${unmapped} bar starts need placing. Open Edit map to position the play buttons.` : restored ? 'Your saved score map is loaded.' : '');
}

function renderPartControls() {
  $('parts').replaceChildren(); $('region-parts').replaceChildren();
  state.piece.parts.forEach((part,index) => {
    const button = document.createElement('button'); button.className = 'part-button'; button.setAttribute('aria-pressed', 'true'); button.title = `Toggle ${part.label}`;
    const dot = document.createElement('span'); dot.className = 'part-dot'; dot.setAttribute('aria-hidden','true'); button.append(dot, document.createTextNode(part.label));
    button.addEventListener('click', () => { const enabled = !state.enabled.get(part.id); state.enabled.set(part.id, enabled); player.setPartEnabled(part.id,enabled); button.setAttribute('aria-pressed',String(enabled)); renderRegionStates(); });
    $('parts').append(button);
    const label = document.createElement('label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = part.id; checkbox.checked = index === 0; label.append(checkbox, document.createTextNode(` ${part.label}`)); $('region-parts').append(label);
  });
}
function refreshBarOptions() {
  const selected = $('bar-select').value;
  $('bar-select').replaceChildren(...state.piece.bars.map(bar => option(bar.number, bar.number)));
  if (state.piece.bars.some(bar => String(bar.number) === selected)) $('bar-select').value = selected;
  $('edit-bar').replaceChildren(...state.piece.bars.map((bar,index) => option(index, `${bar.number}${bar.page == null ? ' · not placed' : ` · page ${bar.page}`}`)));
}
function renderOverlays() {
  if (!state.piece) return;
  for (const {overlay,number} of state.pages) {
    overlay.replaceChildren();
    state.piece.regions.forEach(region => {
      if (region.page !== number) return;
      const node = document.createElement('div'); node.className = 'part-region'; node.dataset.parts = JSON.stringify(regionParts(region));
      Object.assign(node.style, {left:`${region.x*100}%`,top:`${region.y*100}%`,width:`${region.width*100}%`,height:`${region.height*100}%`}); overlay.append(node);
    });
    state.piece.bars.forEach((bar,index) => {
      if (bar.page !== number) return;
      const button = document.createElement('button'); button.className = 'bar-marker'; button.dataset.bar = bar.number; button.title = `Play from bar ${bar.number}`; button.setAttribute('aria-label', `Play from bar ${bar.number}`);
      button.classList.toggle('selected', state.editing && state.editIndex === index); button.style.left = `${bar.x*100}%`; button.style.top = `${bar.y*100}%`;
      const label = document.createElement('span'); label.className = 'bar-label'; label.textContent = bar.number; label.setAttribute('aria-hidden','true'); button.append(label,document.createTextNode('▶'));
      button.addEventListener('click',event => {event.stopPropagation(); if (!state.editing) startPlayback(bar.beat);}); overlay.append(button);
    });
  }
  renderRegionStates(); updateActiveBar(false);
}
function renderRegionStates() {
  document.querySelectorAll('.part-region').forEach(node => node.classList.toggle('muted', JSON.parse(node.dataset.parts).every(id => !state.enabled.get(id))));
}
function updateTransport() {
  $('play').textContent = player.playing ? 'Ⅱ' : '▶'; $('play').setAttribute('aria-label',player.playing ? 'Pause' : 'Play'); updateActiveBar(false);
}
function updateActiveBar(follow = true) {
  if (!state.piece) return;
  const bar = currentBar(state.piece.bars,player.getBeat());
  const changed = state.selected !== bar.number;
  state.selected = bar.number;
  $('bar-select').value = bar.number;
  let active;
  document.querySelectorAll('.bar-marker').forEach(node => { const selected = Number(node.dataset.bar) === bar.number; node.classList.toggle('active',selected); if (selected) { active = node; node.setAttribute('aria-current','true'); } else node.removeAttribute('aria-current'); });
  if (changed && follow && player.playing && !state.editing && $('follow').checked && active) {
    const rect = active.getBoundingClientRect();
    if (rect.top < document.querySelector('.toolbar').offsetHeight + 25 || rect.bottom > innerHeight-100) active.scrollIntoView({behavior:'smooth',block:'center'});
  }
}
async function startPlayback(beat = player.getBeat()) {
  if (!state.piece || $('play').disabled) return;
  if (state.editing) setEditing(false);
  const request = ++pendingPlay;
  const start = beat >= player.duration ? 0 : beat;
  $('play').classList.add('loading'); setStatus(player.buffers.size ? '' : 'Loading the piano…');
  try {
    const started = await player.play(start);
    if (request !== pendingPlay) return;
    $('play').classList.remove('loading'); updateTransport(); if (started) setStatus('');
  } catch (error) { if (request === pendingPlay) { $('play').classList.remove('loading'); updateTransport(); setStatus(error.message,true); } }
}
function changeTempo(value) {
  if (!state.piece) return;
  const bpm = Math.max(20,Math.min(300,Math.round(Number(value)||state.piece.tempo)));
  player.setTempo(bpm); $('tempo').value = bpm; $('tempo-range').max = Math.max(240,bpm); $('tempo-range').value = bpm;
}
$('play').addEventListener('click', () => { if (player.playing || $('play').classList.contains('loading')) cancelPlayback(); else startPlayback(); });
$('stop').addEventListener('click', () => { cancelPlayback(); player.stop(); updateTransport(); });
$('bar-select').addEventListener('change', () => {const bar = state.piece.bars.find(b => b.number === Number($('bar-select').value)); player.seek(bar.beat); updateActiveBar(true);});
$('tempo').addEventListener('change',event => changeTempo(event.target.value));
$('tempo-range').addEventListener('input',event => changeTempo(event.target.value));
$('piece-select').addEventListener('change',event => {if (event.target.value !== '__local') loadLibraryPiece(event.target.value);});
$('menu-toggle').addEventListener('click', () => {const open = $('file-menu').hidden; $('file-menu').hidden = !open; $('menu-toggle').setAttribute('aria-expanded',String(open));});
document.addEventListener('click',event => {if (!$('file-menu').contains(event.target) && !$('menu-toggle').contains(event.target)) {$('file-menu').hidden = true; $('menu-toggle').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',event => {
  if (event.key === 'Escape') { setEditing(false); $('file-menu').hidden = true; $('menu-toggle').setAttribute('aria-expanded','false'); }
  if (event.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName) && !event.target.isContentEditable) {event.preventDefault(); $('play').click();}
});
document.addEventListener('visibilitychange', () => { if (document.hidden && player.playing) { cancelPlayback(); setStatus('Paused while the page was in the background.'); } });
function animate() { if (player.playing) updateActiveBar(); requestAnimationFrame(animate); } requestAnimationFrame(animate);

function setEditing(editing) {
  state.editing = editing && Boolean(state.piece);
  if (!state.editing && drag) { drag.preview.remove(); drag = null; }
  if (state.editing) cancelPlayback();
  document.body.classList.toggle('mapping',state.editing); $('editor').hidden = !state.editing; $('edit-toggle').setAttribute('aria-expanded',String(state.editing));
  renderOverlays(); if (state.editing) syncEditor();
}
$('edit-toggle').addEventListener('click',() => setEditing(!state.editing)); $('edit-close').addEventListener('click',() => setEditing(false));
function checkpoint() { state.history.push(clone(state.piece)); if (state.history.length > 40) state.history.shift(); }
function persist() {
  try { localStorage.setItem(state.storageKey,JSON.stringify({source:state.sourceKey,piece:state.piece})); }
  catch { setStatus('Browser storage is unavailable. Download your map to keep these changes.'); }
  refreshBarOptions(); syncEditor(); renderOverlays();
}
function syncEditor() {
  if (!state.piece) return;
  state.editIndex = Math.max(0,Math.min(state.editIndex,state.piece.bars.length-1));
  const bar = state.piece.bars[state.editIndex];
  $('edit-title').value = state.piece.title; $('edit-bar').value = state.editIndex; $('edit-number').value = bar.number; $('edit-beat').value = bar.beat;
  $('mapped-count').textContent = `${state.piece.bars.filter(b => b.page != null).length} of ${state.piece.bars.length} bar starts placed`;
  $('undo').disabled = !state.history.length; $('remove-bar').disabled = state.piece.bars.length <= 1;
  $('region-list').replaceChildren();
  state.piece.regions.forEach((region,index) => {
    const row = document.createElement('div'); row.className = 'region-row';
    const label = document.createElement('span'); label.textContent = `Page ${region.page} · ${regionParts(region).map(id => state.piece.parts.find(p => p.id === id)?.label || id).join(' + ')}`;
    const button = document.createElement('button'); button.textContent = '×'; button.setAttribute('aria-label',`Remove area ${index+1}, ${label.textContent}`); button.addEventListener('click',() => {checkpoint(); state.piece.regions.splice(index,1); persist();}); row.append(label,button); $('region-list').append(row);
  });
}
function setMode(mode) {state.mode = mode; $('bar-tools').hidden = mode !== 'bars'; $('region-tools').hidden = mode !== 'regions'; $('mode-bars').setAttribute('aria-pressed',String(mode==='bars')); $('mode-regions').setAttribute('aria-pressed',String(mode==='regions'));}
$('mode-bars').addEventListener('click',() => setMode('bars')); $('mode-regions').addEventListener('click',() => setMode('regions'));
$('edit-bar').addEventListener('change',() => {state.editIndex = Number($('edit-bar').value); syncEditor(); renderOverlays();});
$('edit-title').addEventListener('change',() => {const title = $('edit-title').value.trim(); if (!title) return syncEditor(); checkpoint(); state.piece.title = title; $('piece-title').textContent = title; document.title = `${title} · Rehearse`; persist();});
function editBarValue(field, value) {
  const next = clone(state.piece); const selected = next.bars[state.editIndex]; selected[field] = Number(value); next.bars.sort((a,b) => a.beat-b.beat);
  try {validatePiece(next); if (next.bars.some(b => b.beat >= player.duration)) throw new Error('The bar must begin before the end of the MIDI.');}
  catch(error) {setStatus(error.message,true); syncEditor(); return;}
  checkpoint(); state.piece = next; state.editIndex = next.bars.indexOf(selected); persist(); setStatus('');
}
$('edit-number').addEventListener('change',e => editBarValue('number',e.target.value)); $('edit-beat').addEventListener('change',e => editBarValue('beat',e.target.value));
$('add-bar').addEventListener('click',() => {
  const bars = state.piece.bars; const prior = bars[state.editIndex]; const next = bars[state.editIndex+1];
  const beat = next ? (prior.beat+next.beat)/2 : prior.beat+Math.min(4,(player.duration-prior.beat)/2);
  if (beat <= prior.beat || beat >= player.duration) return setStatus('There is no remaining MIDI time for another bar.',true);
  checkpoint(); bars.splice(state.editIndex+1,0,{number:Math.max(...bars.map(b=>b.number))+1,beat,page:null}); state.editIndex++; persist();
});
$('remove-bar').addEventListener('click',() => {if (state.piece.bars.length<2) return; checkpoint(); state.piece.bars.splice(state.editIndex,1); persist();});
$('undo').addEventListener('click',() => {if (!state.history.length) return; state.piece = state.history.pop(); $('piece-title').textContent = state.piece.title; document.title = `${state.piece.title} · Rehearse`; persist();});
$('reset-map').addEventListener('click',() => {checkpoint(); state.piece = clone(state.original); $('piece-title').textContent = state.piece.title; document.title = `${state.piece.title} · Rehearse`; persist(); setStatus('Restored the loaded map. Undo is available.');});

function point(event, element) {const rect = element.getBoundingClientRect(); return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};}
function attachMapGestures(overlay, page) {
  overlay.addEventListener('pointerdown',event => {
    if (!state.editing || event.button !== 0) return;
    event.preventDefault(); const start = point(event,overlay);
    if (state.mode === 'bars') {
      checkpoint(); Object.assign(state.piece.bars[state.editIndex],{page,...start}); state.editIndex = Math.min(state.editIndex+1,state.piece.bars.length-1); persist(); return;
    }
    const parts = [...$('region-parts').querySelectorAll('input:checked')].map(input => input.value);
    if (!parts.length) return setStatus('Select at least one part for this score area.',true);
    const preview = document.createElement('div'); preview.className = 'draw-preview'; overlay.append(preview);
    drag = {overlay,page,start,parts,preview,id:event.pointerId}; overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener('pointermove',event => {
    if (!drag || drag.overlay !== overlay || drag.id !== event.pointerId) return;
    const end = point(event,overlay); const box = rectangle(drag.start,end);
    Object.assign(drag.preview.style,{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.width*100}%`,height:`${box.height*100}%`});
  });
  overlay.addEventListener('pointerup',event => {
    if (!drag || drag.overlay !== overlay || drag.id !== event.pointerId) return;
    const box = rectangle(drag.start,point(event,overlay)); const parts = drag.parts; drag.preview.remove(); drag = null;
    if (box.width < .005 || box.height < .005) return;
    checkpoint(); state.piece.regions.push({page,parts,...box}); persist(); setStatus('');
  });
  overlay.addEventListener('pointercancel',() => {if (drag?.overlay===overlay) {drag.preview.remove(); drag=null;}});
}
function rectangle(a,b) {return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};}
function downloadMap() {
  if (!state.piece) return;
  const output = clone(state.piece); output.tempo = player.tempo;
  try {validatePiece(output);} catch(error) {return setStatus(error.message,true);}
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(output,null,2)}\n`],{type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'piece.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  setStatus('Map downloaded. Put piece.json beside the PDF and MIDI files in the piece’s library folder.');
}
$('download-map').addEventListener('click',downloadMap); $('save-map').addEventListener('click',downloadMap);

$('open-files').addEventListener('change',async event => {
  const files = [...event.target.files]; event.target.value = ''; if (!files.length) return;
  const token = ++state.loadId; cancelPlayback(); setReady(false); $('file-menu').hidden = true; $('menu-toggle').setAttribute('aria-expanded','false'); setStatus('Opening your files…');
  try {
    const pdfs = files.filter(file => /\.pdf$/i.test(file.name)); const midis = files.filter(file => /\.midi?$/i.test(file.name)); const maps = files.filter(file => /\.json$/i.test(file.name));
    if (pdfs.length !== 1 || !midis.length || maps.length>1) throw new Error('Select one PDF, at least one MIDI, and optionally one piece.json together.');
    if (new Set(files.map(file=>file.name)).size!==files.length) throw new Error('The selected files must have unique names.');
    let piece;
    if (maps.length) piece = validatePiece(JSON.parse(await maps[0].text()));
    else {
      const parsed = await Promise.all(midis.map(async file=>parseMidi(await file.arrayBuffer())));
      const duration = Math.max(...parsed.map(p=>p.duration));
      const title = pdfs[0].name.replace(/\.pdf$/i,'');
      piece = {id:title.replace(/[^A-Za-z0-9_-]/g,'') || 'MyPiece',title,pdf:pdfs[0].name,tempo:Math.max(20,Math.min(300,Math.round(parsed[0].tempos[0]?.bpm||120))),parts:midis.map((file,index)=>({id:`part${index+1}`,label:file.name.replace(/\.midi?$/i,''),midi:file.name})),bars:inferBars(duration,parsed[0].timeSignatures),regions:[]};
    }
    validatePiece(piece);
    const names = new Map(files.map(file=>[file.name,file]));
    for (const path of [piece.pdf,...piece.parts.map(part=>part.midi)]) if (!names.has(path)) throw new Error(`Select the file named “${path}” referenced by the map.`);
    const objectMap = new Map(); for (const file of files) {const url = URL.createObjectURL(file); objectMap.set(file.name,url); state.objects.push(url);}
    await openPiece(piece,name=>objectMap.get(name),token,`local:${files.map(f=>`${f.name}:${f.size}:${f.lastModified}`).sort().join('|')}`);
    if (token !== state.loadId) return;
    $('piece-select').querySelector('option[value="__local"]')?.remove(); $('piece-select').append(option('__local',`${piece.title} · local`)); $('piece-select').value = '__local';
    const url = new URL(location.href); url.searchParams.delete('piece'); history.replaceState(null,'',url);
    if (piece.bars.some(bar=>bar.page == null)) setEditing(true);
  } catch(error) {if (token===state.loadId) recoverLoad(error);}
});
window.addEventListener('beforeunload',()=> {player.stop(); state.objects.forEach(url=>URL.revokeObjectURL(url));});

async function boot() {
  try {
    const [library, sounds] = await Promise.all([getJSON(new URL('../library/index.json',import.meta.url)),getJSON(new URL('../assets/piano/manifest.json',import.meta.url))]);
    if (!library.pieces?.length) throw new Error('The library is empty. Add a piece to library/index.json.');
    player.sampleUrls = Object.fromEntries(sounds.samples.map(sample=>[sample.midi,new URL(`../assets/piano/${sample.file}`,import.meta.url).href]));
    $('piece-select').replaceChildren(...library.pieces.map(piece=>option(piece.id,piece.title)));
    const id = new URL(location.href).searchParams.get('piece') || library.pieces[0].id;
    if (!library.pieces.some(piece=>piece.id===id)) {setStatus(`“${id}” is not in this library. Choose a piece above.`,true); $('piece-select').selectedIndex=-1; return;}
    await loadLibraryPiece(id);
  } catch(error) {setStatus(error.message,true);}
}
boot();
