import { openPdf } from './pdf.js';

const performanceScope = new URL('../', import.meta.url);
const workerScript = new URL('../performance-sw.js', import.meta.url);

function activeWorker(registration) {
  const worker = registration.installing || registration.waiting || registration.active;
  if (worker?.state === 'activated') return Promise.resolve(worker);
  if (!worker || worker.state === 'redundant') {
    return Promise.reject(new Error('Could not start the offline service worker.'));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('The offline service worker did not start.')), 15000);
    function finish(error) {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', check);
      if (error) reject(error);
      else resolve(worker);
    }
    function check() {
      if (worker.state === 'activated') finish();
      if (worker.state === 'redundant') finish(new Error('Could not start the offline service worker.'));
    }
    worker.addEventListener('statechange', check);
    check();
  });
}

async function send(worker, type, timeoutMs) {
  const channel = new MessageChannel();
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The offline cache did not respond.')), timeoutMs);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timeout);
        if (data.error) reject(new Error(data.error));
        else resolve(data.ready);
      };
      try {
        worker.postMessage({ type }, [channel.port2]);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  } finally {
    channel.port1.close();
  }
}

export async function hasPerformanceOfflineShell() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration(performanceScope.href);
    if (registration?.scope !== performanceScope.href || !registration.active) return false;
    return await send(registration.active, 'check-shell', 5000);
  } catch {
    return false;
  }
}

export async function preparePerformanceOffline(scores, { readPdf, storePdf, onProgress = () => {} }) {
  if (!navigator.serviceWorker) throw new Error('Offline preparation requires a browser with service worker support.');
  if (!scores.length) throw new Error('Add a score before preparing the set for offline use.');

  const failures = [];
  for (const [index, score] of scores.entries()) {
    const title = score.title || score.name || `Score ${index + 1}`;
    onProgress(`Checking ${index + 1} of ${scores.length} · ${title}…`);
    let task;
    try {
      const pdf = await readPdf(score);
      const blob = pdf instanceof Blob ? pdf : new Blob([pdf], { type: 'application/pdf' });
      task = openPdf({ data: new Uint8Array(await blob.arrayBuffer()) });
      const document = await task.promise;
      await document.getPage(1);
      if (score.regions?.some(region => region.page > document.numPages)) {
        throw new Error('A saved passage points beyond the last PDF page.');
      }
      await storePdf(score, blob);
    } catch (error) {
      failures.push(`${title} (${error.message})`);
    } finally {
      await task?.destroy().catch(() => {});
    }
  }
  if (failures.length) throw new Error(`Could not prepare ${failures.join(', ')}.`);

  onProgress('Saving Rehearse and its PDF renderer…');
  if (!(await hasPerformanceOfflineShell()) || navigator.onLine) {
    const registration = await navigator.serviceWorker.register(workerScript.href, { scope: performanceScope.href });
    const worker = await activeWorker(registration);
    const ready = await send(worker, 'prepare-shell', 120000);
    if (!ready) throw new Error('Rehearse did not finish saving its offline files.');
  }
  // If supported, ask the browser to keep this origin’s data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}
