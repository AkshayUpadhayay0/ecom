# Website redesign (apps/web)

Approved direction: `docs/design-proposal/` (prototype and design notes). Built in four stages; this
file records what each stage changed and how to verify it.

## Stage A: foundation (done)

- **Tokens** (`src/brand/tokens.css`, `src/app/globals.css`): motion tokens (`--ui-motion-*`, zeroed for
  reduced motion and, through `<html data-save-data>`, for Save-Data / slow connections), type scale
  (`.type-display`, `.type-band`, `.type-heading`), header height, section spacing.
- **Header** (`components/header/`): menu button left, centred wordmark, Search / Account / Cart right.
  Transparent over the home hero (the hero carries `data-hero`), solid after it scrolls under the bar
  (IntersectionObserver, no scroll listener) and on every other page.
- **Side menu**: native dialog from the left, full height. Shop, clothing types, Account or Sign in, the
  language switcher (only while `NEXT_PUBLIC_ENABLE_PIDGIN` is on), and support and policy links only
  when the client supplied them (`lib/site-links.ts`). Focus trap, Esc and focus return come from the
  dialog.
- **Search overlay**: Enter opens `/search?q=`, which searches the whole catalogue (name, clothing type
  and keywords) and shows the exact message `No outfits found. Try another word.`. The search page has
  its own box with the debounced behaviour.
- **Footer**: one line. The About block, the seal and the link list are no longer rendered; the data is
  kept. Admin → Content marks `footer.about` "Not shown on the website".
- **Policy pages** `/policies/privacy|terms|returns`: plain text from the `policy.*` content blocks; a
  block that is still pending is a 404 and is not linked.
- **Primary button**: brand Red, white text. White on Red is 4.04:1, which only passes as large text, so
  the text is 19 px bold or larger. `components/ui/button-classes.test.ts` enforces it.
- The old header actions component and the cart-button text count were replaced; behaviour (auth BFF,
  cart drawer, Find My Size, i18n, video pool) is unchanged.

### Checks

`pnpm --filter @urban-ibile/web test`, `pnpm --filter @urban-ibile/web test:e2e` (includes axe on the
open menu and search overlay), and `pnpm --filter @urban-ibile/web lighthouse`: Lighthouse mobile (the
Lighthouse default, simulated slow 4G) on the seeded e2e stack; fails below accessibility 100 or
performance 85. The e2e media is tiny generated test media, so performance is optimistic: check real
media too. Reports are written to `apps/web/test-results/lighthouse/`.
