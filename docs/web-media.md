# Website media (pictures)

## Which hosts are allowed
The website only renders pictures from the **media base URL** (`NEXT_PUBLIC_MEDIA_BASE_URL`, the same
value as the API's `R2_PUBLIC_BASE_URL`; objects are `<base>/media/...`), optional extra bases
(`NEXT_PUBLIC_MEDIA_ORIGINS`) and, for local storage, the API origin's
`/api/v1/media-local/public/media/` folder. Only the media **path** is allowed, never the whole host.
`src/config/media.ts` builds one allow-list used by `next.config.ts` (`images.remotePatterns`, CSP)
and by `MediaImage` at render time (an unknown host or path renders no picture). Nothing is hard-coded.

Set `NEXT_PUBLIC_MEDIA_BASE_URL` in `apps/web/.env.local` and **restart / rebuild** the web app
(it is inlined at build time).

## Why next/image's optimiser is not used
`MediaImage` (`src/components/media-image.tsx`) is a plain `<img>` with a `srcset` built from the
renditions the media pipeline already made (`w320/w640/w1280.webp`), plus `sizes`, lazy loading and
`ReactDOM.preload` for `priority` (LCP) images. Layout is unchanged (fills the positioned parent,
aspect ratio and dominant-colour background stay on the parent).

Trade-off: the Next optimiser would re-resize and re-encode every image on our web servers (CPU,
cache disk, cold-start latency at 5,000 concurrent users) and add AVIF; we give up AVIF and
arbitrary widths, and gain zero server image work: the CDN serves files directly.
Known limit: video posters are a single ~1280px JPEG, so cards load a larger file than needed.
Recommendation (API change, not done): generate poster renditions in the media pipeline.

## r2.dev is development only
The `pub-*.r2.dev` URL is rate-limited and has no caching control. Production uses a custom domain on
the bucket behind the Cloudflare CDN (see CLAUDE.md, Known launch blockers, item 6).

## Showing new or replaced media at once (on-demand revalidation)

Technical Recommendation, additive and off unless configured. The website caches public API data for
60 s. So that a video that just became ready (or was replaced, removed or published) shows up without
waiting, the API and the media worker call the website:

- `POST <website>/api/revalidate` with `Authorization: Bearer <secret>` and `{ "tags": ["catalog", "site"] }`.
- Server to server only. The route answers 404 when `REVALIDATE_SECRET` is unset, 401 for a wrong
  secret (timing-safe compare), 400 for tags it does not know. It is not linked from the site.
- Set the SAME secret (32+ characters) as `REVALIDATE_SECRET` on the website and as
  `WEB_REVALIDATE_SECRET` on the API and worker, plus `WEB_REVALIDATE_URL` (the route's URL) on the
  API and worker. Both API variables or neither.
- Triggers: any successful admin write to media, content, products, clothing types, variants,
  delivery zones or settings (API), and a media asset becoming ready (worker, after the commit).
  Calls within 250 ms become one request; failures are retried twice and then only logged. The 60 s
  cache stays as the safety net, so a failed call delays the site, it never breaks it.
- A failed replacement still never removes the live video: the old media stays attached until the new
  one is ready (`product_pending_media`).
- Tags: `catalog` (products, product detail, clothing types) and `site` (config, content blocks).
  Search is never cached.
