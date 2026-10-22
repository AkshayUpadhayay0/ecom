# Urban Ibile Public API (v1)

Customer-facing endpoints for the website (framework pending) and the React Native app. No login
is needed. All paths start with `/api/v1`. Money is in **minor units** (kobo, integers); currency
`NGN`. Dates are ISO-8601 UTC.

- **Errors** always look like `{ "error": { "code", "message", "details"?, "requestId" } }`.
  Common codes: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `RATE_LIMITED` (429),
  `SERIAL_NOT_VALID` (403, hidden pages).
- **Rate limits**: per IP, `PUBLIC_RATE_LIMIT_MAX` requests per `PUBLIC_RATE_LIMIT_WINDOW_MS`
  (default 120 / minute) for `/catalog` and `/site`. Hidden-page unlocks have their own, stricter
  limits (per IP and per page, failed attempts only). Headers: `RateLimit`, `RateLimit-Policy`.
- **Caching**: `/catalog/*` and `/site/config` send `Cache-Control: public, max-age=60` and a weak
  `ETag`. Send `If-None-Match` to get `304 Not Modified` when nothing changed. Hidden pages send
  `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.
- **Media URLs** point at the public CDN bucket only. Media that is not processed, private,
  retired or purged is never returned.
- **What is never returned**: stock quantities, costs, admin fields, storage keys, internal media
  ids, serials.

---

## Catalogue

### `GET /catalog/products`

| Query | Default | Notes |
| --- | --- | --- |
| `page` | 1 | 1-based |
| `pageSize` | setting `catalog.page_size` (20) | max 50 |
| `sort` | `newest` | `newest`, `price_asc`, `price_desc`, `name` |
| `clothingType` | - | clothing type slug |

Only active products with at least one active size are listed. No cap on the number of products.

```json
{
  "data": [
    {
      "id": "6c0f1d6e-2f0c-4d8e-9a39-5a1f0f0b8c21",
      "slug": "indigo-kaftan",
      "name": "Indigo Kaftan",
      "clothingType": { "slug": "shirt", "name": "Shirt" },
      "priceMinor": 3500000,
      "currency": "NGN",
      "inStock": true,
      "media": {
        "posterUrl": "https://media.example.com/media/video/…/a1/poster.jpg",
        "previewUrl": "https://media.example.com/media/video/…/a1/preview.mp4",
        "mp4": [
          { "label": "480p", "url": "https://media.example.com/…/480p.mp4", "width": 854, "height": 480 },
          { "label": "720p", "url": "https://media.example.com/…/720p.mp4", "width": 1280, "height": 720 }
        ],
        "dominantColor": "#2a4d69"
      }
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 112, "totalPages": 6 }
}
```

`media` is `null` when the product has no ready public video. `inStock` is a flag only.
Variants carry no own price, so there is no "from" price (all sizes cost `priceMinor`).

### `GET /catalog/search?q=`

Searches the **whole** catalogue: product name, product keywords, clothing type name and keywords.
Case-insensitive; `q` is trimmed, 1-100 characters; `%` and `_` are matched literally. Same
`page`, `pageSize`, `sort` and item shape as the catalogue.

```json
{ "data": [ … ], "meta": { "page": 1, "pageSize": 20, "total": 2, "totalPages": 1 }, "query": "agbada" }
```

No match is **not** an error:

```json
{ "data": [], "meta": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }, "query": "velvet", "code": "NO_RESULTS" }
```

The UI shows "No outfits found. Try another word." for `code: "NO_RESULTS"`.

### `GET /catalog/products/:idOrSlug`

`idOrSlug` is the product id (uuid) or slug. Inactive, unknown or unsellable products: `404`.

```json
{
  "data": {
    "id": "6c0f1d6e-…",
    "slug": "indigo-kaftan",
    "name": "Indigo Kaftan",
    "clothingType": { "slug": "shirt", "name": "Shirt" },
    "priceMinor": 3500000,
    "currency": "NGN",
    "inStock": true,
    "media": { "posterUrl": "…", "previewUrl": "…", "mp4": [ … ], "dominantColor": "#2a4d69" },
    "description": "Hand-dyed indigo kaftan.",
    "videos": [
      {
        "posterUrl": "…", "previewUrl": "…", "dominantColor": "#2a4d69",
        "mp4": [ { "label": "480p", … }, { "label": "720p", … }, { "label": "1080p", … } ],
        "durationMs": 12400, "width": 1080, "height": 1920
      }
    ],
    "images": [
      { "dominantColor": "#b0703a", "width": 1600, "height": 2000,
        "variants": [ { "width": 320, "height": 400, "url": "…/w320.webp" }, … ] }
    ],
    "sizes": [
      { "id": "…", "sizeCode": "M", "label": "Medium", "availability": "out_of_stock" },
      { "id": "…", "sizeCode": "L", "label": "Large", "availability": "low_stock" },
      { "id": "…", "sizeCode": "XL", "label": "Extra Large", "availability": "in_stock" }
    ],
    "blueprint": {
      "required": true,
      "profile": {
        "code": "male_top",
        "name": "Male - top (shirt / kaftan)",
        "measurements": [
          { "code": "chest", "label": "Chest", "helpText": "…" },
          { "code": "shoulder", "label": "Shoulder", "helpText": "…" }
        ]
      }
    }
  }
}
```

- `sizes[].id` is the size id that add-to-cart sends as `sizeId` (products without a measurement profile).
- `availability`: `out_of_stock` when nothing can be bought, `low_stock` when what is left is at
  or below the size's low-stock threshold (set by admins), else `in_stock`.
- `blueprint.required` is `true` when the product uses Blueprint; the customer then enters the
  listed measurements and the Blueprint engine (Phase 5) recommends a size. The raw size chart is
  never returned.

### `GET /catalog/clothing-types`

```json
{ "data": [ { "slug": "shirt", "name": "Shirt" }, { "slug": "trouser", "name": "Trouser" } ] }
```

## Site

### `GET /site/config`

```json
{
  "data": {
    "settings": {
      "catalog.page_size": 20,
      "cart.max_quantity_per_item": 10,
      "support.email": null,
      "support.phone": null,
      "support.whatsapp": null,
      "social.links": null,
      "brand.palette": null,
      "policy.returns_content_key": null
    },
    "hero": {
      "video": { "posterUrl": "…", "previewUrl": "…", "mp4": [ … ], "dominantColor": "#…", "durationMs": 9000, "width": 1920, "height": 1080 },
      "translations": { "en": { "title": "…", "body": "…", "ctaLabel": "Shop now" } }
    },
    "deliveryZones": [
      { "code": "lagos", "name": "Lagos", "feeMinor": 250000, "estDaysMin": 1, "estDaysMax": 2 }
    ],
    "defaultLanguage": "en",
    "languages": ["en", "pcm"]
  }
}
```

`settings` is an explicit allow-list; `null` means "not provided yet". `hero` is `null` when the
hero block is unpublished; `hero.video` is `null` until a ready public video is assigned. Only
active delivery zones (which always have a fee) are listed. Product names are never translated.

## Hidden pages

The QR code carries a **route token** that only identifies the page; it unlocks nothing. A serial
unlocks it. Access is remembered in an HttpOnly cookie (`ui_hp`, path `/api/v1/hidden-pages`,
`SameSite=Lax`, `Secure` in production) and, when signed in (Bearer customer token), on the
account. Copying the page URL to another browser does not unlock it.

### `GET /hidden-pages/:routeToken`

State only (never content). Unknown or unpublished token: `404`.

```json
{ "data": { "locked": true, "pageNumber": 3, "title": "Hidden page 3" } }
```

### `POST /hidden-pages/:routeToken/unlock`

Body `{ "serial": "…" }` (trimmed; otherwise exact). On success the cookie is set and:

```json
{ "data": { "locked": false, "pageNumber": 3, "title": "Hidden page 3" } }
```

Every failure (unknown, inactive, wrong page, General serial on the exclusive-only page) is the
same, after a short delay:

```json
{ "error": { "code": "SERIAL_NOT_VALID", "message": "This serial number cannot unlock this page.", "requestId": "…" } }
```

Too many failed attempts: `429 RATE_LIMITED`.

### `GET /hidden-pages/:routeToken/content`

The content only when a valid grant covers this page, otherwise the same locked answer as above.

```json
{ "data": { "locked": false, "pageNumber": 3, "title": "Hidden page 3", "page": { "title": "The Lagos Story", "body": "…" } } }
```
