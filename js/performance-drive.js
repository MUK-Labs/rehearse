const fileIdPattern = /^[a-zA-Z0-9_-]+$/;

export function parseDriveFile(value) {
  if (typeof value !== 'string') return null;

  let source;
  try {
    source = new URL(value);
  } catch {
    return null;
  }
  if (source.protocol !== 'https:' || source.port || source.username || source.password) return null;

  let id;
  let directDownload = false;
  if (source.hostname === 'drive.google.com') {
    const path = source.pathname.replace(/\/$/, '');
    const pathId = /^\/file\/(?:u\/\d+\/)?d\/([^/]+)(?:\/|$)/.exec(path)?.[1];
    if (path === '/open' || path === '/uc') id = source.searchParams.get('id');
    else id = pathId;
    directDownload = path === '/uc';
  } else if (source.hostname === 'drive.usercontent.google.com' && /^\/download\/?$/.test(source.pathname)) {
    id = source.searchParams.get('id');
    directDownload = true;
  }

  const resourceKey = source.searchParams.get('resourcekey');
  if (!id || !fileIdPattern.test(id) || (resourceKey && !fileIdPattern.test(resourceKey))) return null;

  if (directDownload) {
    source = new URL(`https://drive.google.com/file/d/${id}/view`);
    if (resourceKey) source.searchParams.set('resourcekey', resourceKey);
  }
  return {id, resourceKey: resourceKey || null, url: source.href};
}

async function driveResponseError(response) {
  const body = await response.json().catch(() => null);
  const details = body?.error?.details;
  const entries = body?.error?.errors;
  const reasons = new Set([
    ...(Array.isArray(details) ? details.map(item => item?.reason) : []),
    ...(Array.isArray(entries) ? entries.map(item => item?.reason) : []),
  ]);
  if (reasons.has('API_KEY_INVALID') || reasons.has('API_KEY_EXPIRED')) {
    return new Error('Google rejected the Drive API key. Check the key under Google Drive setup.');
  }
  if (reasons.has('SERVICE_DISABLED') || reasons.has('accessNotConfigured') || reasons.has('API_KEY_SERVICE_BLOCKED')) {
    return new Error('Enable the Google Drive API in the key’s project and allow the key to use it.');
  }
  if (reasons.has('API_KEY_HTTP_REFERRER_BLOCKED') || reasons.has('API_KEY_IP_ADDRESS_BLOCKED')) {
    return new Error('Google blocked this website from using the Drive API key. Check its website restrictions.');
  }
  if (response.status === 429 || ['downloadQuotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].some(reason => reasons.has(reason))) {
    return new Error('Google Drive reached a download or API quota. Try again later.');
  }
  if (response.status === 401) {
    return new Error('Google Drive could not authenticate this request. Check the API key and file’s sharing settings.');
  }
  if (response.status === 403 || response.status === 404) {
    return new Error('Google Drive could not download this file. Check that anyone with the full link can download it.');
  }
  if (response.status === 400) {
    return new Error('Google Drive rejected the request. Check the Drive link and API key.');
  }
  return new Error(`Google Drive could not download this PDF (HTTP ${response.status}). Try again.`);
}

function driveNetworkError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new Error('The Google Drive download timed out. Try again.');
  }
  return new Error('Could not reach the Google Drive API. Check your connection and try again.');
}

export async function downloadDrivePdf(file, apiKey, fetcher = fetch) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!fileIdPattern.test(key)) throw new Error('Enter your Google Drive API key under Google Drive setup.');
  if (!file || typeof file.id !== 'string' || !fileIdPattern.test(file.id) ||
    (file.resourceKey && (typeof file.resourceKey !== 'string' || !fileIdPattern.test(file.resourceKey)))) {
    throw new Error('This score needs a valid Google Drive file link.');
  }

  const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`;
  const headers = {'X-Goog-Api-Key': key};
  if (file.resourceKey) headers['X-Goog-Drive-Resource-Keys'] = `${file.id}/${file.resourceKey}`;

  let response;
  try {
    response = await fetcher(url, {
      headers,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    throw driveNetworkError(error);
  }
  if (!response.ok) throw await driveResponseError(response);
  if (response.status === 206) throw new Error('Google Drive returned an incomplete PDF. Try again.');

  let blob;
  try {
    blob = await response.blob();
  } catch (error) {
    throw driveNetworkError(error);
  }
  if (!(await blob.slice(0, 1024).text()).includes('%PDF-')) {
    throw new Error('Google Drive returned a file that is not a readable PDF.');
  }
  return blob.type === 'application/pdf' ? blob : new Blob([blob], {type: 'application/pdf'});
}
