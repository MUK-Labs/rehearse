const maxCanvasSide = 4096;
const maxCanvasPixels = 4 * 1024 * 1024;
const maxCachedCanvases = 4;

export async function renderScoreCanvas(pdf, view, {width, height, signal}) {
  signal?.throwIfAborted();
  const page = await pdf.getPage(view.page);
  signal?.throwIfAborted();

  const original = page.getViewport({scale: 1});
  const cropWidth = original.width * view.width;
  const cropHeight = original.height * view.height;
  const fit = Math.min(Math.max(1, width) / cropWidth, Math.max(1, height) / cropHeight);
  const scale = Math.min(
    fit * Math.min(globalThis.devicePixelRatio || 1, 2),
    maxCanvasSide / Math.max(cropWidth, cropHeight),
    Math.sqrt(maxCanvasPixels / (cropWidth * cropHeight))
  );
  const viewport = page.getViewport({scale});
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(cropWidth * scale));
  canvas.height = Math.max(1, Math.floor(cropHeight * scale));
  canvas.style.width = `${cropWidth * fit}px`;
  canvas.style.aspectRatio = `${cropWidth} / ${cropHeight}`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Score page ${view.page}`);

  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) throw new Error('The browser could not create a score canvas.');
  // Translate the full viewport into the cropped canvas so no offscreen full-page bitmap is needed.
  const transform = [1, 0, 0, 1, -viewport.width * view.x, -viewport.height * view.y];
  const task = page.render({canvasContext, viewport, transform});
  const cancel = () => task.cancel();
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    await task.promise;
    return canvas;
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

function viewKey({scoreId, page, x, y, width, height}) {
  return JSON.stringify([scoreId, page, x, y, width, height]);
}

export function createScoreRenderer(getPdf) {
  const entries = new Map();

  function remove(key, entry) {
    entries.delete(key);
    entry.controller.abort();
  }

  function get(view, {width, height}) {
    const crop = viewKey(view);
    const key = JSON.stringify([crop, width, height, globalThis.devicePixelRatio]);
    const existing = entries.get(key);
    if (existing) {
      entries.delete(key);
      entries.set(key, existing);
      return existing.promise;
    }

    const controller = new AbortController();
    const entry = {crop, controller};
    entry.promise = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return getPdf(view.scoreId);
      })
      .then(pdf => renderScoreCanvas(pdf, view, {width, height, signal: controller.signal}))
      .catch(error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
    entries.set(key, entry);
    if (entries.size > maxCachedCanvases) {
      const [oldestKey, oldestEntry] = entries.entries().next().value;
      remove(oldestKey, oldestEntry);
    }
    return entry.promise;
  }

  function retain(views) {
    const crops = new Set(views.map(viewKey));
    for (const [key, entry] of entries) {
      if (!crops.has(entry.crop)) remove(key, entry);
    }
  }

  return {get, retain, clear: () => retain([])};
}
