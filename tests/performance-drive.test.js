import assert from 'node:assert/strict';
import test from 'node:test';

import {downloadDrivePdf, parseDriveFile} from '../js/performance-drive.js';

test('reads Drive viewer links and keeps their resource keys', () => {
  const viewer = 'https://drive.google.com/file/d/score_ID-1/view?usp=sharing&resourcekey=0-key';
  assert.deepEqual(parseDriveFile(viewer), {id: 'score_ID-1', resourceKey: '0-key', url: viewer});

  const open = 'https://drive.google.com/open?id=score_ID-1';
  assert.deepEqual(parseDriveFile(open), {id: 'score_ID-1', resourceKey: null, url: open});
  assert.equal(parseDriveFile('https://drive.google.com/file/u/1/d/score_ID-1/view').id, 'score_ID-1');
});

test('converts Drive download links into viewer links without losing the resource key', () => {
  for (const endpoint of ['https://drive.google.com/uc', 'https://drive.usercontent.google.com/download']) {
    assert.deepEqual(parseDriveFile(`${endpoint}?export=download&id=score_ID-1&resourcekey=0-key`), {
      id: 'score_ID-1', resourceKey: '0-key', url: 'https://drive.google.com/file/d/score_ID-1/view?resourcekey=0-key',
    });
  }
});

test('does not identify lookalikes or unsafe URLs as Drive files', () => {
  for (const url of [
    'https://drive.google.com.example.com/file/d/id/view',
    'https://other.example/drive.usercontent.google.com/download?id=id',
    'http://drive.google.com/file/d/id/view',
    'https://drive.google.com:8888/file/d/id/view',
    'https://user:password@drive.google.com/file/d/id/view',
    'https://drive.google.com/drive/folders/id',
    'https://drive.google.com/open?id=%2Fid',
    'https://drive.google.com/open?id=id&resourcekey=0%2Fkey',
    'not a URL',
  ]) assert.equal(parseDriveFile(url), null, url);
});

test('sends the key and resource key only in headers to the Drive API', async () => {
  const file = parseDriveFile('https://drive.google.com/open?id=score_ID-1&resourcekey=0-key');
  const pdf = '%PDF-1.7\n';
  const blob = await downloadDrivePdf(file, ' test-key ', async (url, options) => {
    assert.equal(url, 'https://www.googleapis.com/drive/v3/files/score_ID-1?alt=media&supportsAllDrives=true');
    assert.deepEqual(options.headers, {'X-Goog-Api-Key': 'test-key', 'X-Goog-Drive-Resource-Keys': 'score_ID-1/0-key'});
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(pdf, {headers: {'Content-Type': 'application/octet-stream'}});
  });
  assert.equal(blob.type, 'application/pdf');
  assert.equal(await blob.text(), pdf);
});

test('reports Drive API failures without exposing the key or server text', async () => {
  const file = {id: 'score_ID-1', resourceKey: null};
  const key = 'test-key';
  for (const [status, reason, explanation] of [
    [400, 'API_KEY_INVALID', /rejected the Drive API key/],
    [403, 'SERVICE_DISABLED', /Enable the Google Drive API/],
    [403, 'API_KEY_HTTP_REFERRER_BLOCKED', /website restrictions/],
    [403, 'downloadQuotaExceeded', /quota/],
    [404, 'notFound', /full link/],
  ]) {
    const fetcher = async () => Response.json({error: {message: key, details: [{reason}]}}, {status});
    await assert.rejects(downloadDrivePdf(file, key, fetcher), error => {
      assert.match(error.message, explanation);
      assert.doesNotMatch(error.message, /test-key/);
      return true;
    });
  }
});

test('rejects missing credentials and refuses non-PDF responses', async () => {
  const file = {id: 'score_ID-1', resourceKey: null};
  const fetcher = async () => new Response('<html>Sign in</html>');
  await assert.rejects(downloadDrivePdf(file, '', fetcher), /Enter your Google Drive API key/);
  await assert.rejects(downloadDrivePdf(file, 'test-key', fetcher), /not a readable PDF/);
});
