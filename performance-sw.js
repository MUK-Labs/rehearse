// The scope covers PDF.js's worker URL. Only Performance and its shared assets are cached.
const root = new URL(self.registration.scope);
const cacheName = `rehearse-performance-shell-v1:${root.pathname}`;

// PDF.js loads these runtime files on demand, including for locally imported scores.
// Keep this list in sync with the vendored renderer when upgrading PDF.js.
const cMaps = `
78-EUC-H 78-EUC-V 78-H 78-RKSJ-H 78-RKSJ-V 78-V 78ms-RKSJ-H 78ms-RKSJ-V 83pv-RKSJ-H 90ms-RKSJ-H
90ms-RKSJ-V 90msp-RKSJ-H 90msp-RKSJ-V 90pv-RKSJ-H 90pv-RKSJ-V Add-H Add-RKSJ-H Add-RKSJ-V Add-V
Adobe-CNS1-0 Adobe-CNS1-1 Adobe-CNS1-2 Adobe-CNS1-3 Adobe-CNS1-4 Adobe-CNS1-5 Adobe-CNS1-6
Adobe-CNS1-UCS2 Adobe-GB1-0 Adobe-GB1-1 Adobe-GB1-2 Adobe-GB1-3 Adobe-GB1-4 Adobe-GB1-5 Adobe-GB1-UCS2
Adobe-Japan1-0 Adobe-Japan1-1 Adobe-Japan1-2 Adobe-Japan1-3 Adobe-Japan1-4 Adobe-Japan1-5 Adobe-Japan1-6
Adobe-Japan1-UCS2 Adobe-Korea1-0 Adobe-Korea1-1 Adobe-Korea1-2 Adobe-Korea1-UCS2 B5-H B5-V B5pc-H B5pc-V
CNS-EUC-H CNS-EUC-V CNS1-H CNS1-V CNS2-H CNS2-V ETHK-B5-H ETHK-B5-V ETen-B5-H ETen-B5-V ETenms-B5-H
ETenms-B5-V EUC-H EUC-V Ext-H Ext-RKSJ-H Ext-RKSJ-V Ext-V GB-EUC-H GB-EUC-V GB-H GB-V GBK-EUC-H GBK-EUC-V
GBK2K-H GBK2K-V GBKp-EUC-H GBKp-EUC-V GBT-EUC-H GBT-EUC-V GBT-H GBT-V GBTpc-EUC-H GBTpc-EUC-V GBpc-EUC-H
GBpc-EUC-V H HKdla-B5-H HKdla-B5-V HKdlb-B5-H HKdlb-B5-V HKgccs-B5-H HKgccs-B5-V HKm314-B5-H HKm314-B5-V
HKm471-B5-H HKm471-B5-V HKscs-B5-H HKscs-B5-V Hankaku Hiragana KSC-EUC-H KSC-EUC-V KSC-H KSC-Johab-H
KSC-Johab-V KSC-V KSCms-UHC-H KSCms-UHC-HW-H KSCms-UHC-HW-V KSCms-UHC-V KSCpc-EUC-H KSCpc-EUC-V Katakana
NWP-H NWP-V RKSJ-H RKSJ-V Roman UniCNS-UCS2-H UniCNS-UCS2-V UniCNS-UTF16-H UniCNS-UTF16-V UniCNS-UTF32-H
UniCNS-UTF32-V UniCNS-UTF8-H UniCNS-UTF8-V UniGB-UCS2-H UniGB-UCS2-V UniGB-UTF16-H UniGB-UTF16-V
UniGB-UTF32-H UniGB-UTF32-V UniGB-UTF8-H UniGB-UTF8-V UniJIS-UCS2-H UniJIS-UCS2-HW-H UniJIS-UCS2-HW-V
UniJIS-UCS2-V UniJIS-UTF16-H UniJIS-UTF16-V UniJIS-UTF32-H UniJIS-UTF32-V UniJIS-UTF8-H UniJIS-UTF8-V
UniJIS2004-UTF16-H UniJIS2004-UTF16-V UniJIS2004-UTF32-H UniJIS2004-UTF32-V UniJIS2004-UTF8-H
UniJIS2004-UTF8-V UniJISPro-UCS2-HW-V UniJISPro-UCS2-V UniJISPro-UTF8-V UniJISX0213-UTF32-H
UniJISX0213-UTF32-V UniJISX02132004-UTF32-H UniJISX02132004-UTF32-V UniKS-UCS2-H UniKS-UCS2-V
UniKS-UTF16-H UniKS-UTF16-V UniKS-UTF32-H UniKS-UTF32-V UniKS-UTF8-H UniKS-UTF8-V V WP-Symbol
`.trim().split(/\s+/);

const fonts = `
FoxitDingbats.pfb FoxitFixed.pfb FoxitFixedBold.pfb FoxitFixedBoldItalic.pfb FoxitFixedItalic.pfb
FoxitSerif.pfb FoxitSerifBold.pfb FoxitSerifBoldItalic.pfb FoxitSerifItalic.pfb FoxitSymbol.pfb
LiberationSans-Bold.ttf LiberationSans-BoldItalic.ttf LiberationSans-Italic.ttf
LiberationSans-Regular.ttf
`.trim().split(/\s+/);

const decoders = `
jbig2.wasm jbig2_nowasm_fallback.js openjpeg.wasm openjpeg_nowasm_fallback.js qcms_bg.wasm
quickjs-eval.js quickjs-eval.wasm
`.trim().split(/\s+/);

const assets = new Set([
  'performance.html',
  'styles.css',
  'performance.css',
  'js/pdf.js',
  'js/performance.js',
  'js/performance-model.js',
  'js/performance-render.js',
  'js/performance-midi.js',
  'js/performance-offline.js',
  'js/performance-storage.js',
  'vendor/pdfjs/pdf.mjs',
  'vendor/pdfjs/pdf.worker.mjs',
  ...cMaps.map(name => `vendor/pdfjs/cmaps/${name}.bcmap`),
  ...fonts.map(name => `vendor/pdfjs/standard_fonts/${name}`),
  ...decoders.map(name => `vendor/pdfjs/wasm/${name}`),
  'library/QuasiCampane/score.pdf',
].map(path => new URL(path, root).href));

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function checkShell() {
  if (!await caches.has(cacheName)) return false;
  const cache = await caches.open(cacheName);
  const keys = new Set((await cache.keys()).map(request => request.url));
  return [...assets].every(url => keys.has(url));
}

let preparing;
function prepareShell() {
  if (!preparing) {
    preparing = (async () => {
      const cache = await caches.open(cacheName);
      // addAll commits the new shell as one batch, preserving a previous offline copy on failure.
      await cache.addAll([...assets].map(url => new Request(url, { cache: 'reload' })));
      return checkShell();
    })().finally(() => { preparing = null; });
  }
  return preparing;
}

self.addEventListener('message', event => {
  const port = event.ports[0];
  if (!port) return;
  const { type } = event.data || {};
  if (type !== 'prepare-shell' && type !== 'check-shell') return;
  const operation = type === 'prepare-shell' ? prepareShell() : checkShell();
  event.waitUntil(operation.then(ready => port.postMessage({ ready })).catch(() => {
    port.postMessage({ error: 'Could not save or verify the offline files. Check your connection and try again.' });
  }));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const key = new URL(request.url);
  if (request.mode === 'navigate') key.search = '';
  if (!assets.has(key.href)) return;

  // Keep Pages updates visible online. Fall back to the last prepared copy off-network.
  event.respondWith(fetch(request).catch(async error => {
    const cached = await caches.match(key.href, { cacheName });
    if (cached) return cached;
    throw error;
  }));
});
