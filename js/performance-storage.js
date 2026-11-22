let database;

function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('rehearse-performance', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pdfs');
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  }).catch(error => {
    database = undefined;
    throw error;
  });
  return database;
}

async function pdfStore(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('pdfs', mode);
    const request = operation(transaction.objectStore('pdfs'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error || request.error || new Error('PDF storage was interrupted.'));
  });
}

export function getStoredPdf(key) {
  return pdfStore('readonly', store => store.get(key));
}

export function storePdf(key, blob) {
  return pdfStore('readwrite', store => store.put(blob, key));
}

export function removeStoredPdf(key) {
  return pdfStore('readwrite', store => store.delete(key));
}
