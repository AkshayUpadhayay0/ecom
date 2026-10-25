# Urban Ìbílé: clickable design prototype (v3)

A **design proposal** for client review: a complete, video-led, clickable website with sample content, from the home page to a confirmed order. It has no backend and no database, runs from plain static files, works offline, and is marked `noindex`. Nothing is saved or sent anywhere. Prices, sizes, delivery zones, names, addresses, orders and sign-in are all made up (shown in brackets, or marked "Sample"). There are no card fields and no real customer data.

The click path to send to the client is in [CLICK-PATH.md](CLICK-PATH.md).

## Screens

Home (runway hero, video band, category tiles, "New outfits" carousel) · side menu · search with suggestions · cart drawer · shop (video-led grid, type chips, sort menu, sold-out state, pagination) · search results · quick add · product (video first, sizes, Find My Size block, quantity, Add to cart, sticky on phone, Description / Material / Delivery / Returns, similar outfits) · Find My Size (measurements in inches, fit preference, recommendation with breakdown and stock, choose another size, out-of-range message) · height and weight **concept** screen (marked "Pending client decision: needs brand sizing rules"; calculates nothing) · sign in, register, account · cart · checkout (account, delivery with zone and fee, review, a neutral "Secure payment with Paystack" step) · confirmation · failed payment with retry · My orders with a Being prepared, Sent out, Delivered timeline.

The **Prototype guide** button (bottom corner) lists every flow with a link, the click path, a phone-preview link and "Reset the prototype".

## Open it locally

```
cd docs/design-proposal/v3
node scripts/serve.mjs          # then open http://localhost:4173
```

Opening `index.html` directly in Chrome or Edge also works (hash routes, plain scripts, no network). The local server is better: videos can seek and text files are served compressed, as on a real host. `phone.html` shows the prototype in a 390 px phone frame (`phone.html#/shop` opens it on the shop).

## Host it as a private link

Publish the folder `docs/design-proposal/v3` as a static site: no build command, publish directory = this folder.

- **Netlify**: drag the folder onto Netlify Drop, or connect the repository with publish directory `docs/design-proposal/v3`. `_headers` adds `X-Robots-Tag: noindex`.
- **Cloudflare Pages**: create a Pages project, build command empty, output directory `docs/design-proposal/v3`. `_headers` is honoured as well.
- **Vercel**: import the repository, root directory `docs/design-proposal/v3`, framework "Other", no build command. `vercel.json` adds the same headers.

**This is not access control.** The link is unlisted and the pages are `noindex` (meta tag, `robots.txt`, header), so search engines should not list it, but anyone who has the link can open it. To put it behind a login later with Cloudflare Access (free for small teams): add the site's domain to Cloudflare, open *Zero Trust → Access → Applications → Add an application → Self-hosted*, enter the prototype's hostname, add a policy that allows only the client's email addresses (one-time PIN by email), and save. Visitors then sign in before any file is served.

## Videos

- Poster first: every clip has a WebP poster that shows immediately; the video loads only when the frame is on screen, and plays only while visible.
- At most **4** clips play at once on desktop and **2** on a phone; the hero and the band share one slot. Clips pause when they leave the screen or the tab is hidden.
- **Reduced motion**, **Save-Data** and slow connections (2G/3G): posters only, no video downloads, a play button on each frame. `?savedata=1` forces this mode for demonstrations (`index.html?savedata=1`).
- **Runway loop** (home hero): two copies of the clip cross-fade just before it ends, so the walk loops without a jump, with a slow zoom (off for reduced motion). A phone gets the portrait clip, a desktop the landscape one. The hero's poster and title are also in the page source, so they paint before any script runs.
- **Reel notes hook:** the hero reads `window.PROTO_HERO` in `assets/js/home.js` for pace (`playbackRate`, `crossfadeMs`), framing (`objectPosition`) and overlay text (`overlayText`). These are neutral defaults; the client's notes from the Instagram reel recording go there. Nothing is guessed.
- Placeholders carry a small **Sample** tag.

### Replacing the stock clips with the client's own

Put the client's clips (with their licences) in `prototype-media/` (here, or at the repository root). **Name each file after the slot it replaces**: `hero-wide`, `hero-tall`, `band`, `p01` to `p10`, `fit-intro` (for example `prototype-media/hero-wide.mp4`). Then run:

```
node scripts/build-media.mjs --force
```

It compresses to H.264, no audio, 720p to 1080p, writes the posters, and prints the sizes (needs `ffmpeg` on the PATH). The client's originals are not committed (`prototype-media/` is git-ignored); the compressed results are. Add each licence to `CREDITS.md`. A clip in `prototype-media/` with any other name is ignored: use clips without on-screen text or logos.

## Size budget and measured results

Budget: whole folder at most **35 MB**, any clip at most **2.5 MB**, any poster at most **80 KB**, the home page at most **2.5 MB** before any video, hero poster visible within **2.5 s** on simulated slow 4G (1.6 Mbps, 150 ms latency, 4x slower CPU; median of 3 cold loads).

Measured on the final build:

| | |
|---|---|
| Whole folder | **7.6 MB** (videos 7.0 MB, 14 clips; biggest clip 1.9 MB; biggest poster 51 KB; all code and fonts about 0.2 MB) |
| Home, before any video | about **0.37 MB** transferred |
| Home on simulated slow 4G, phone | hero poster visible in about **1.4 s** (runs vary from 1.3 to 2.2 s), title about 2.0 s, video playing about 3.6 s |
| Home, no throttling, desktop | poster about **0.15 to 0.2 s**, video playing about 0.25 s |
| Product page on simulated slow 4G | poster visible in about **2.7 to 3.1 s** (a cold load of the whole app; the check allows 3.5 s) |

## Tests

The tests use the Playwright installed for `apps/web` (no extra install):

```
cd apps/web
pnpm exec playwright test -c ../../docs/design-proposal/v3/tests/playwright.config.mjs
```

168 tests, all passing on the final build (plus screenshot jobs that are skipped unless `V3_SHOTS` is set). They cover: content and the sample-only rules (no external requests, nothing stored, every price in brackets, no card fields, no real contact details); header states, side menu, search suggestions and the exact empty message; cart drawer and cart page; shop (chips, sort, 20-per-page pagination, sold-out, quick add); product page; Find My Size (validation, recommendation rule, stock, out-of-range, choosing another size, fit preference never changes the size); sign in and register; checkout through a confirmed order, a failed payment with retry, and the order timeline; the guide (every link opens a real screen); keyboard-only ordering; reduced motion; Save-Data; a slow connection; no sideways scrolling and a heading on all 23 screens at 390, 768 and 1440 px; axe (WCAG A/AA) on every screen and state; and the size and load budget (which runs last, alone). Screenshots: `V3_SHOTS=<folder>` with the `shots` test.

Tested in Chromium only (Playwright). Safari and Firefox were not tested.

## Folder map

```
index.html, phone.html      entry points
CLICK-PATH.md               the route from home to a confirmed order, to send to the client
assets/css, assets/js       styles; data.js (sample data), video.js, ui.js (shell, search, cart drawer),
                            home.js, shop.js (shop, search, quick add), product.js, fit.js (Find My Size,
                            concept), account.js, checkout.js (cart, checkout, orders), app.js (hash router)
assets/fonts, assets/brand  Drafting Mono, Inter, logos (the client's, unmodified)
media/video, media/poster   compressed clips and posters (built by scripts/build-media.mjs)
scripts/                    build-media.mjs, media-manifest.json, serve.mjs
tests/                      Playwright tests (see above)
CREDITS.md                  every third-party asset and licence
```
