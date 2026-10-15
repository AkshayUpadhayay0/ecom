# Urban Ibile Blueprint API (v1)

Virtual fitting room for the website and the app. **Every endpoint needs a signed-in customer**
(`Authorization: Bearer <customer access token>`), except the Body Scan provider webhook. Errors use
the standard shape `{ "error": { "code", "message", "details"?, "requestId" } }`.

## Rules (Confirmed Requirements, 9 Oct design)

- Input is **body measurements in inches** (at most one decimal). Weight and height are not inputs.
- The product's measurement profile lists the measurements needed. Each is matched against the
  ACTIVE chart of its chart group: the size is the **smallest size whose max covers the value**
  (`SMALLEST_COVERING_SIZE`; min values are informational).
- The outfit's size is the **largest** size any measurement needs. A two-piece set is one size.
- Fit preference (`tailored`, `standard`, `oversized`, from the database) is stored and **never
  changes the size**.
- A decision is `LOCKED_RECOMMENDATION` (the computed size) or `OVERRIDE` (another size the product
  is made in). Decisions are append-only and never recalculated when charts change.
- Nothing here reserves stock (that happens at checkout).

## Pending Client Decisions

- **Out of range**: a value above the chart's largest max returns `422 BLUEPRINT_OUT_OF_RANGE`
  with the neutral message "We could not match this measurement to our size chart." No decision is
  created and no size is guessed. Constant `OUT_OF_RANGE_POLICY = 'REJECT'` in
  `blueprint-engine.ts` is where the client's final handling plugs in.
- **Below the chart**: by default a small value maps to the smallest size. Setting
  `blueprint.reject_below_chart_min = true` makes it out of range instead.
- **Input limits**: setting `blueprint.measurement_limits` (SAMPLE values: 5-90 in by default,
  head circumference 15-30 in) only catches typos; it is not a size rule.

## Endpoints

### `GET /blueprint/products/:productId/requirements`

```json
{
  "data": {
    "productId": "…",
    "required": true,
    "profile": { "code": "male_top", "name": "Male - top (shirt / kaftan)" },
    "measurements": [
      { "code": "chest", "label": "Chest", "helpText": "…", "unit": "in", "minInches": 5, "maxInches": 90 }
    ],
    "unit": "in",
    "fitOptions": [ { "code": "tailored", "label": "Tailored" }, { "code": "standard", "label": "Standard" }, { "code": "oversized", "label": "Oversized" } ],
    "bodyScan": { "available": true, "mocked": true }
  }
}
```

`required: false` (and no measurements) for products without a profile: the customer picks a size.

### `POST /blueprint/recommendations` (preview, saves nothing)

```json
{ "productId": "…", "method": "MANUAL_MEASUREMENTS", "fitPreference": "standard",
  "measurements": { "chest": 42, "shoulder": 17.5, "sleeve": 24, "top_length": 32 } }
```

For Body Scan: `"method": "BODY_SCAN", "bodyScanSessionId": "…"` and no `measurements`.

```json
{
  "data": {
    "productId": "…", "method": "MANUAL_MEASUREMENTS", "fitPreference": "standard",
    "recommendedSize": { "id": "…", "code": "L", "label": "Large" },
    "recommendedOffered": true,
    "recommendedInStock": false,
    "breakdown": [
      { "code": "chest", "label": "Chest", "valueInches": 42, "chart": { "id": "…", "group": "male_top", "version": 1 }, "requiredSize": { "id": "…", "code": "L", "label": "Large" } }
    ],
    "alternatives": [ { "id": "…", "code": "M", "label": "Medium", "availability": "in_stock" } ],
    "boundaryRule": "SMALLEST_COVERING_SIZE",
    "mocked": false
  }
}
```

Errors: `400 BLUEPRINT_MEASUREMENTS_INVALID` (missing, extra, non-positive, more than one decimal,
outside the input limits; `details.issues` lists each), `422 BLUEPRINT_OUT_OF_RANGE`
(`details.measurements[]` with `code`, `valueInches`, `side`), `409 BLUEPRINT_NOT_APPLICABLE`
(product has no profile), `409 BODY_SCAN_NOT_READY`, `503 BLUEPRINT_CHART_UNAVAILABLE`.

### `POST /blueprint/decisions`

Same body plus `"selectionMode": "LOCKED_RECOMMENDATION" | "OVERRIDE"` and `"chosenSizeId"`
(required for OVERRIDE). The server recomputes the recommendation; a client-sent recommendation is
ignored. `409 INVALID_SIZE` for an override to a size the product is not made in, an override to
the recommended size, or a locked recommendation that names a different size. Returns `201`:

```json
{
  "data": {
    "id": "…",
    "product": { "id": "…", "slug": "indigo-kaftan", "name": "Indigo Kaftan" },
    "method": "MANUAL_MEASUREMENTS",
    "fitPreference": "standard",
    "selectionMode": "OVERRIDE",
    "recommendedSize": { "code": "L", … },
    "selectedSize": { "code": "XL", … },
    "measurements": [ { "code": "chest", "valueInches": 42, "chart": { "group": "male_top", "version": 1, "id": "…" }, "requiredSize": { "code": "L", … } } ],
    "bodyScanSessionId": null,
    "chartSnapshot": { "boundaryRule": "SMALLEST_COVERING_SIZE", "charts": [ … ], "recommended": { "code": "L", "sortOrder": 3 }, … },
    "createdAt": "2026-10-16T09:00:00.000Z"
  }
}
```

### `GET /blueprint/decisions/:id` and `GET /me/blueprint/decisions?productId=&page=`

Own decisions only; another customer's id answers `404`.

## Body Scan (MOCKED)

> **MOCKED**: the only provider today is a MOCK adapter (`BODY_SCAN_PROVIDER=mock`) that returns
> fixed sample measurements immediately. Responses carry `"mocked": true` and the API logs a
> warning. The real provider/SDK and its capture rules are a team decision; no real provider is
> called and no images are ever stored. Production refuses the mock.

- `POST /body-scan/sessions` `{ "productId": "…" }` -> `201` session (`IN_PROGRESS`,
  `captureUrl` for a real provider, `null` for the mock).
- `GET /body-scan/sessions/:id` -> polls the provider; `COMPLETED` sessions include
  `measurements` (inches by code). Own sessions only.
- `POST /body-scan/webhooks/:provider` (provider -> API, no login): body signed with HMAC-SHA256 in
  header `x-body-scan-signature`; invalid signature `401`, accepted `204`.

```json
{ "data": { "id": "…", "productId": "…", "status": "COMPLETED", "provider": "mock", "mocked": true, "captureUrl": null,
  "measurements": { "chest": 41, "shoulder": 18, "sleeve": 25, "top_length": 33 }, "failureReason": null,
  "expiresAt": "…", "completedAt": "…" } }
```

Use the session in a recommendation or decision with `"method": "BODY_SCAN"`.
