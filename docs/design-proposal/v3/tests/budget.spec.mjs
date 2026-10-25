// Size and load-time budget. Prints the numbers (see README) and fails if a budget is exceeded.
//   whole prototype <= 35 MB, any single clip <= 2.5 MB, poster <= 80 KB,
//   home before any video <= 2.5 MB, hero poster visible <= 2.5 s (median of 3) on simulated slow 4G.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MB = 1024 * 1024;
const KB = 1024;
const RUNS = 3;
const BUDGET = { totalMB: 35, clipMB: 2.5, posterKB: 80, homeBeforeVideoMB: 2.5, posterVisibleMs: 2500 };
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (['.cache', 'tests', 'node_modules', 'prototype-media'].includes(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [{ path: p, size: statSync(p).size }];
  });
}

test('the deployable folder stays inside the size budget', () => {
  const files = walk(ROOT);
  const total = files.reduce((n, f) => n + f.size, 0);
  const videos = files.filter((f) => f.path.endsWith('.mp4'));
  const posters = files.filter((f) => f.path.endsWith('.webp'));
  const biggestClip = Math.max(...videos.map((f) => f.size));
  const biggestPoster = Math.max(...posters.map((f) => f.size));
  console.log(`SIZE total ${(total / MB).toFixed(1)} MB (${files.length} files); videos ${(videos.reduce((n, f) => n + f.size, 0) / MB).toFixed(1)} MB; biggest clip ${(biggestClip / MB).toFixed(2)} MB; biggest poster ${(biggestPoster / KB).toFixed(0)} KB`);
  expect(total / MB).toBeLessThanOrEqual(BUDGET.totalMB);
  expect(biggestClip / MB).toBeLessThanOrEqual(BUDGET.clipMB);
  expect(biggestPoster / KB).toBeLessThanOrEqual(BUDGET.posterKB);
});

async function loadHome(browser, viewport, network) {
  const context = await browser.newContext({ viewport, baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (network) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...network });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const requests = new Map();
  let beforeVideo = 0;
  let videoStarted = false;
  cdp.on('Network.requestWillBeSent', (e) => requests.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFinished', (e) => {
    if ((requests.get(e.requestId) ?? '').endsWith('.mp4')) { videoStarted = true; return; }
    if (!videoStarted) beforeVideo += e.encodedDataLength;
  });
  const t0 = Date.now();
  await page.goto('/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => { const img = document.querySelector('.hero img'); return img && img.complete && img.naturalWidth > 0; }, null, { timeout: 30_000 });
  const posterMs = Date.now() - t0;
  await page.getByRole('heading', { level: 1 }).waitFor();
  const titleMs = Date.now() - t0;
  await page.waitForFunction(() => document.querySelector('.hero video.on'), null, { timeout: 60_000 });
  const videoMs = Date.now() - t0;
  await context.close();
  return { posterMs, titleMs, videoMs, beforeVideo };
}

for (const [label, viewport, network] of [
  ['phone, simulated slow 4G (1.6 Mbps, 150 ms, 4x slower CPU)', { width: 390, height: 844 }, { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }],
  ['desktop, no throttling', { width: 1440, height: 900 }, null],
]) {
  test(`home loads poster-first: ${label}`, async ({ browser }) => {
    const runs = [];
    for (let i = 0; i < RUNS; i += 1) runs.push(await loadHome(browser, viewport, network));
    const poster = median(runs.map((r) => r.posterMs));
    const title = median(runs.map((r) => r.titleMs));
    const video = median(runs.map((r) => r.videoMs));
    const before = median(runs.map((r) => r.beforeVideo));
    console.log(`LOAD ${label}: hero poster ${poster} ms, title ${title} ms, video playing ${video} ms (median of ${RUNS}; poster runs ${runs.map((r) => r.posterMs).join('/')}), transferred before the first video request ${(before / MB).toFixed(2)} MB`);
    expect(before / MB).toBeLessThanOrEqual(BUDGET.homeBeforeVideoMB);
    if (network) expect(poster).toBeLessThanOrEqual(BUDGET.posterVisibleMs);
  });
}
