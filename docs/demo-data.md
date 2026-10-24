# Demo data (`pnpm seed:demo`)

Sample data for local development and client demos. Everything is marked as demo and removed again
with one command. **Refused in production and on any database other than the local development
database** (`ecom` on localhost; set `DEMO_SEED_DATABASE` if yours has another name).

## What it creates

- One active delivery zone **"Sample zone (temporary)"** with a SAMPLE fee (NGN 1,500).
- **24 products "Demo outfit 01" ... "Demo outfit 24"** with sizes and stock, created through the normal
  services (so the admin audit log records them, attributed to your first admin account):
  - 01-05 and 22: placeholder **videos** (FFmpeg test patterns, no real footage);
  - 06-20, 23, 24: **photo-only** (generated gradient photos, 1-3 each);
  - 21: **no media at all**;
  - 22: video **and** the male top **Blueprint** profile (try Find My Size);
  - 23 sold out, 24 low on stock.
- A **demo hero video** on the home page, only if the hero has no video yet.
- Markers: product slug `demo-outfit-NN` + keyword `demo-seed`, SKU prefix `DEMO-`, media file names
  `demo-seed-*` and `is_temporary`.

## Steps

1. Install FFmpeg (once, Windows), then open a **new** terminal:
   `winget install --id Gyan.FFmpeg -e` and check `ffmpeg -version`.
2. Make sure the database is migrated and you have an admin account (`pnpm db:migrate`, `pnpm db:seed`,
   `pnpm admin:create`).
3. Start the API and the worker (the worker transcodes the clips and photos): `pnpm dev` and `pnpm worker`.
4. Run `pnpm seed:demo`. Without FFmpeg, `pnpm seed:demo --no-video` creates everything with photos only.
5. The hero waits (up to 3 minutes) for the worker; if it times out, start `pnpm worker` and run
   `pnpm seed:demo` again: products already created are skipped, only the hero is attached.
6. Open http://localhost:3000 (`pnpm dev:web`).

Remove it all: `pnpm seed:demo:remove`. Products are soft-deleted (archived instead when an order or return
still uses them), media is detached, retired and purged, the demo hero is cleared and the zone is deleted
(deactivated when saved addresses use it). Only records carrying the markers above are touched.
