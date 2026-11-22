import * as pdfjs from '../vendor/pdfjs/pdf.mjs';

const pdfAssets = new URL('../vendor/pdfjs/', import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', pdfAssets).href;

export function openPdf(source) {
  return pdfjs.getDocument({
    cMapUrl: new URL('cmaps/', pdfAssets).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', pdfAssets).href,
    wasmUrl: new URL('wasm/', pdfAssets).href,
    ...source,
  });
}
