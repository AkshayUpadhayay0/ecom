# Urban Ìbílé: clickable design prototype (v3)

A **design proposal** for client review: a video-led, clickable website with sample content. It has no backend and no database, runs from plain static files, works offline, and is marked `noindex`. Nothing is saved or sent anywhere; prices, sizes, delivery zones, orders and sign-in are all made up (shown in brackets).

Status: stages 1 and 2 are built (foundation, home, navigation, search with suggestions, cart drawer, prototype guide). Shop, product, Find My Size, cart, checkout and orders follow in the next stages and show a "built in a later stage" page for now.

## Open it locally

```
cd docs/design-proposal/v3
node scripts/serve.mjs          # then open http://localhost:4173
```

Opening `index.html` directly in Chrome or Edge also works (hash routes, plain scripts, no network). The local server is better because videos can seek. `phone.html` shows the prototype in a 390 px phone frame (`phone.html#/shop` opens it on the shop).

The small **Prototype guide** button (bottom corner) lists every flow with a link, a phone-preview link, and "Reset the prototype".

## Host it as a private link

Publish the folder `docs/design-proposal/v3` as a static site: no build command, publish directory = this folder.

- **Netlify**: drag the folder onto Netlify Drop, or connect the repository with publish directory `docs/design-proposal/v3`. `_headers` adds `X-Robots-Tag: noindex`.
- **Cloudflare Pages**: create a Pages project, build command empty, output directory `docs/design-proposal/v3`. `_headers` is honoured as well.
- **Vercel**: import the repository, root directory `docs/design-proposal/v3`, framework "Other", no build command. `vercel.json` adds the same headers.

**This is not access control.** The link is unlisted and the pages are `noindex` (meta tag, `robots.txt`, header), so search engines should not list it, but anyone who has the link can open it. To put it behind a login later with Cloudflare Access (free for small teams): add the site's domain to Cloudflare, open *Zero Trust → Access → Applications → Add an application → Self-hosted*, enter the prototype's hostname, add a policy that allows only the client's email addresses (one-time PIN by email), and save. Visitors then sign in before any file is served.

## Videos

- Poster first: every clip has a WebP poster that shows immediately; the video loads only when the frame is on screen, and plays only while visible.
- At most **4** clips play at once on desktop and **2** on a phone; the hero and the band share one slot. Pausing happens when a clip leaves the screen or the tab is hidden.
- **Reduced motion**, **Save-Data** and slow connections (2G/3G): posters only, no video downloads, a play button on each frame. `?savedata=1` forces this mode for demonstrations (`index.html?savedata=1`).
- **Runway loop** (home hero): two copies of the clip cross-fade just before it ends, so the walk loops without a jump, with a slow zoom (off for reduced motion). A phone gets the portrait clip, a desktop the landscape one.
- **Reel notes hook:** the hero reads `window.PROTO_HERO` in `assets/js/home.js` for pace (`playbackRate`, `crossfadeMs`), framing (`objectPosition`) and overlay text (`overlayText`). These are neutral defaults; the client's notes from the Instagram reel recording go there, nothing is guessed.
- Placeholders carry a small **Sample** tag.

### Replacing the stock clips with the client's own

Put the client's clips (with their licences) in `prototype-media/` (here, or at the repository root). **Name each file after the slot it replaces**: `hero-wide`, `hero-tall`, `band`, `p01` to `p10`, `fit-intro` (for example `prototype-media/hero-wide.mp4`). Then run:

```
node scripts/build-media.mjs --force
```

It compresses to H.264, no audio, 720p to 1080p, writes the posters, and prints the sizes (needs `ffmpeg` on the PATH). The client's originals are not committed (`prototype-media/` is git-ignored); the compressed results are. Add each licence to `CREDITS.md`.

## Size budget and results

Budget: whole folder at most **35 MB**, any clip at most **2.5 MB**, any poster at most **80 KB**, the home page at most **2.5 MB** before any video, hero poster visible within **2.5 s** on simulated slow 4G (1.6 Mbps, 150 ms, 4x slower CPU).

Measured (stages 1 and 2): folder **7.5 MB** (videos 7.0 MB, biggest clip 1.9 MB, biggest poster 51 KB); home transfers **0.29 MB** before the first video; hero poster visible in **1.4 s** on simulated slow 4G (title 1.5 s, video playing 2.9 s) and **0.11 s** unthrottled.

## Tests

The tests use the Playwright installed for `apps/web` (no extra install):

```
cd apps/web
pnpm exec playwright test -c ../../docs/design-proposal/v3/tests/playwright.config.mjs
```

They cover content, header states, side menu, search suggestions and the exact empty message, cart drawer, keyboard use, axe (WCAG A/AA), the video rules (limits, runway cross-fade, Save-Data, reduced motion) and the size and load budget. Screenshots at 390, 768 and 1440 px: `V3_SHOTS=<folder>` with the `shots` test.

## Folder map

```
index.html, phone.html      entry points
assets/css, assets/js       styles; data.js (sample data), video.js, ui.js (shell, search, cart),
                            home.js, app.js (hash router)
assets/fonts, assets/brand  Drafting Mono, Inter, logos (the client's, unmodified)
media/video, media/poster   compressed clips and posters (built by scripts/build-media.mjs)
scripts/                    build-media.mjs, media-manifest.json, serve.mjs
CREDITS.md                  every third-party asset and licence
```
