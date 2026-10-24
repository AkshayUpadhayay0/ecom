import type { RequestHandler } from 'express';

/**
 * Everything is PRIVATE by default: answers are never stored or revalidated by browsers or shared
 * caches, carry no ETag, and a conditional request (If-None-Match / If-Modified-Since) is treated
 * as an ordinary request, so a private endpoint can never answer "304 Not Modified" with an empty
 * body. Only the listed public prefixes (catalogue, site config, public media files) keep their own
 * caching rules (short max-age + weak ETag).
 *
 * Why not rely on Express' defaults: Express adds a weak ETag to every JSON body and answers 304
 * to a matching conditional request, which is right for the public catalogue and wrong for
 * admin, account, cart, order, payment and Blueprint data.
 */
export function privateByDefault(publicPrefixes: readonly string[]): RequestHandler {
  return (req, res, next) => {
    const isPublic = publicPrefixes.some(
      (prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`),
    );
    if (isPublic) {
      next();
      return;
    }
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    // Routes that choose their own header (e.g. the stats endpoint) still win: they set it later.
    res.setHeader('Cache-Control', 'no-store');
    // Express computes the ETag inside res.send; removing it as the headers are written is the
    // only per-response switch (the app-wide "etag" setting would also turn off the public ones).
    const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => typeof res;
    res.writeHead = ((...args: unknown[]) => {
      res.removeHeader('ETag');
      return writeHead(...args);
    }) as typeof res.writeHead;
    next();
  };
}
