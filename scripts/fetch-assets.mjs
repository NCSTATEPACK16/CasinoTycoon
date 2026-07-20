// scripts/fetch-assets.mjs
// Downloads the Kenney Casino Kit (CC0) and curates five chip sprites into
// public/sprites/kenney-chips/ for the P11 jackpot chip-arc upgrade.
// Idempotent (skips if all curated files already exist). Network or page-
// structure failures print a manual-download fallback instead of leaving
// the build in a broken state — nothing else depends on this script running.
import { mkdir, readdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEST_DIR = path.join(__dirname, '..', 'public', 'sprites', 'kenney-chips');
const PAGE_URL = 'https://kenney.nl/assets/casino-kit';
const CURATED_FILES = [
  'chip_white.png',
  'chip_blue.png',
  'chip_red.png',
  'chip_green.png',
  'chip_black.png',
];

async function findZipUrl() {
  const res = await fetch(PAGE_URL);
  if (!res.ok) throw new Error(`Could not load ${PAGE_URL}: HTTP ${res.status}`);
  const html = await res.text();
  const match =
    html.match(/id="inline-download"[^>]*href="([^"]+\.zip)"/) ??
    html.match(/href="([^"]+\.zip)"[^>]*id="inline-download"/);
  if (!match) {
    throw new Error('Could not find the #inline-download zip link — kenney.nl page structure may have changed.');
  }
  return new URL(match[1], PAGE_URL).toString();
}

async function findFilesRecursive(dir, names) {
  const result = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(result, await findFilesRecursive(full, names));
    else if (names.includes(entry.name)) result[entry.name] = full;
  }
  return result;
}

async function main() {
  await mkdir(DEST_DIR, { recursive: true });
  const already = existsSync(DEST_DIR) ? await readdir(DEST_DIR) : [];
  if (CURATED_FILES.every((f) => already.includes(f))) {
    console.log('All curated Kenney chip sprites already present — skipping fetch.');
    return;
  }

  let zipUrl;
  try {
    zipUrl = await findZipUrl();
  } catch (err) {
    console.error(`fetch-assets failed: ${err.message}`);
    console.error(`Manual fallback: download the Casino Kit from ${PAGE_URL} yourself,`);
    console.error(`extract chip PNGs (${CURATED_FILES.join(', ')}) into ${DEST_DIR}.`);
    process.exitCode = 1;
    return;
  }

  const tmpZip = path.join(DEST_DIR, '_download.zip');
  const zipRes = await fetch(zipUrl);
  if (!zipRes.ok) throw new Error(`Could not download ${zipUrl}: HTTP ${zipRes.status}`);
  await writeFile(tmpZip, Buffer.from(await zipRes.arrayBuffer()));

  const tmpDir = path.join(DEST_DIR, '_extract');
  await mkdir(tmpDir, { recursive: true });
  await execFileAsync('unzip', ['-o', tmpZip, '-d', tmpDir]);

  const found = await findFilesRecursive(tmpDir, CURATED_FILES);
  let copied = 0;
  for (const name of CURATED_FILES) {
    const src = found[name];
    if (!src) {
      console.warn(`Warning: ${name} not found in the downloaded pack — skipping.`);
      continue;
    }
    await copyFile(src, path.join(DEST_DIR, name));
    copied++;
  }

  await rm(tmpZip, { force: true });
  await rm(tmpDir, { recursive: true, force: true });
  console.log(`Curated ${copied}/${CURATED_FILES.length} chip sprites into ${DEST_DIR}`);
}

main();
