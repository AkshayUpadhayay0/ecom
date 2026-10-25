// Builds the prototype's web videos and posters (needs ffmpeg on the PATH, and the internet only
// the first time, to fetch the free stock originals into .cache/stock).
//
//   node scripts/build-media.mjs            build everything that is missing
//   node scripts/build-media.mjs --force    rebuild everything
//
// A file named prototype-media/<id>.mp4 (the client's own clip for that slot: hero-wide, hero-tall,
// band, p01 to p10, fit-intro; see scripts/media-manifest.json) is used instead of the stock source, whole (ss, t and crop from the manifest are
// ignored; only the size and quality settings apply).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '../../..');
const manifest = JSON.parse(readFileSync(join(root, 'scripts/media-manifest.json'), 'utf8'));
const force = process.argv.includes('--force');
const stockDir = join(root, '.cache/stock');
// The client's own clips: prototype-media/ next to this script's folder, or at the repository root.
const clientDirs = [join(root, 'prototype-media'), join(repoRoot, 'prototype-media')];
const videoDir = join(root, 'media/video');
const posterDir = join(root, 'media/poster');
for (const dir of [stockDir, videoDir, posterDir]) mkdirSync(dir, { recursive: true });

async function stockFile(id) {
  const found = readdirSync(stockDir).find((name) => name.startsWith(`${id}-`));
  if (found) return join(stockDir, found);
  const url = manifest.stock[id];
  console.log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const file = join(stockDir, url.split('/').pop());
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
}

for (const out of manifest.outputs) {
  const video = join(videoDir, `${out.id}.mp4`);
  const poster = join(posterDir, `${out.id}.webp`);
  if (!force && existsSync(video) && existsSync(poster)) continue;

  const clientClip = clientDirs.map((dir) => join(dir, `${out.id}.mp4`)).find((file) => existsSync(file));
  const useClient = Boolean(clientClip);
  const input = useClient ? clientClip : await stockFile(out.source);
  const filters = [];
  if (!useClient && out.crop) filters.push(`crop=${out.crop}`);
  filters.push(`scale=${out.size}`, 'fps=24');
  const trim = useClient ? [] : ['-ss', String(out.ss), '-t', String(out.t)];
  console.log(`${out.id}: ${useClient ? 'client clip' : `stock ${out.source}`}`);
  ffmpeg([
    ...trim,
    '-i',
    input,
    '-an',
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-profile:v',
    'main',
    '-crf',
    String(out.crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    video,
  ]);
  ffmpeg(['-ss', '0.4', '-i', video, '-frames:v', '1', '-vf', `scale=${out.poster}:-2`, '-c:v', 'libwebp', '-quality', '72', poster]);
}

let total = 0;
for (const out of manifest.outputs) {
  const v = statSync(join(videoDir, `${out.id}.mp4`)).size;
  const p = statSync(join(posterDir, `${out.id}.webp`)).size;
  total += v + p;
  console.log(`${out.id.padEnd(10)} video ${(v / 1024).toFixed(0).padStart(6)} KB   poster ${(p / 1024).toFixed(0).padStart(4)} KB`);
}
console.log(`media total ${(total / 1048576).toFixed(1)} MB`);
