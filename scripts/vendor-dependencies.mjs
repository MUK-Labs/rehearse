#!/usr/bin/env node
// Maintenance only: re-create the locally hosted, pinned runtime assets.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pdfVersion = '6.4.299';
const pdfSha512 = '015975dfccc02ed7da00fbc00ee944d0f65385b6330814bbf672f8a4e48bffa4a6ff8007e40db5043f551edf7b3a50aecc9b82a66799b40b648a78ac17855bd6';
const manifest = JSON.parse(await readFile(join(root, 'assets/piano/manifest.json'), 'utf8'));

async function download(url, algorithm, expectedHash) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualHash = createHash(algorithm).update(bytes).digest('hex');
  if (actualHash !== expectedHash) throw new Error(`Checksum mismatch for ${url}`);
  return bytes;
}

const temporary = await mkdtemp(join(tmpdir(), 'rehearse-vendor-'));
try {
  const archive = join(temporary, 'pdfjs.tgz');
  await writeFile(archive, await download(
    `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-${pdfVersion}.tgz`,
    'sha512', pdfSha512,
  ));
  execFileSync('tar', ['-xzf', archive, '-C', temporary]);
  const pdfDest = join(root, 'vendor/pdfjs');
  await mkdir(pdfDest, { recursive: true });
  for (const path of ['build/pdf.mjs', 'build/pdf.worker.mjs', 'LICENSE', 'package.json', 'cmaps', 'standard_fonts', 'wasm']) {
    await cp(join(temporary, 'package', path), join(pdfDest, path.replace(/^build\//, '')), { recursive: true });
  }

  const samples = [...manifest.samples, {
    file: 'README',
    sha256: '04ddba91bcafcb4c53dee7b004479f79af47bb92574f06bbe741b00c3ca64e0e',
  }];
  // Limit concurrent requests, while keeping maintenance downloads reasonably fast.
  for (let i = 0; i < samples.length; i += 4) {
    await Promise.all(samples.slice(i, i + 4).map(async ({ file, sha256 }) => {
      const url = `https://raw.githubusercontent.com/Tonejs/audio/${manifest.sourceCommit}/salamander/${file}`;
      const bytes = await download(url, 'sha256', sha256);
      await writeFile(join(root, 'assets/piano', file === 'README' ? 'UPSTREAM_README.txt' : file), bytes);
    }));
  }
  console.log(`Vendored PDF.js ${pdfVersion} and ${manifest.samples.length} piano samples, with checksum verification.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
