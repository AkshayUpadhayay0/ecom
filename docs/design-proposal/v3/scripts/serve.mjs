// Tiny static server for opening the prototype locally (no dependencies):
//   node scripts/serve.mjs [port]      then open http://localhost:4173
// Supports Range requests, so videos can seek. Offline: nothing is fetched from the internet.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.json', '.txt', '.md']);
const gzipCache = new Map();

createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root) || file.includes(`${join(root, '.cache')}`) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  const size = statSync(file).size;
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'X-Robots-Tag': 'noindex', 'Accept-Ranges': 'bytes' };
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
  } else if (COMPRESSIBLE.has(extname(file)) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
    // like Netlify, Cloudflare Pages and Vercel: text files are served compressed
    let body = gzipCache.get(file);
    if (!body) { body = gzipSync(readFileSync(file)); gzipCache.set(file, body); }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': body.length });
    res.end(body);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    createReadStream(file).pipe(res);
  }
}).listen(port, () => console.log(`Prototype: http://localhost:${port}`));
