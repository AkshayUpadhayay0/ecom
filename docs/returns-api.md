# Returns API (Phase 7b): Returns, Exchanges and Fault-Line

Base path `/api/v1`. Customer routes need a **customer** token, and admin routes (`/admin/...`)
need an **admin** token. A customer token on an admin route gets `401`. Other customers' orders,
items, requests and media answer `404`. Errors use the usual shape
`{ error: { code, message, details?, requestId } }`. Requests and orders are never deleted.

**No money moves through this API.** There is no refund execution and no provider refund call.
`REFUND_PROCESSING` is a status only. Every return response carries
`"refund": { "executed": false, "policy": "PENDING_CLIENT_DECISION" }`.

The 9 Oct design document (`docs/backend-design-9oct.docx`) was not in the repo when this was
built. The rules follow CLAUDE.md 8b and SKILL.md 9c.

## Customer

### Evidence photos (private): `POST /me/media/uploads` → upload → `POST /me/media/:id/complete`

```json
{ "fileName": "seam.jpg", "mimeType": "image/jpeg", "sizeBytes": 183422 }
```

- **What's accepted:** photos only (JPEG, PNG, WebP), at most `returns.evidence_max_bytes` (10 MB), and at most `returns.evidence_max_files` (5) per request or reply. These are TEAM DESIGN settings.
- **Ownership:** an evidence upload is always `private` and owned by the customer (`media_assets.owner_customer_id`). The client cannot choose the visibility.
- **Upload flow:** the response contains a short-lived upload URL; `PUT` the bytes there. Completing checks the size, the content type and the magic bytes. Rate limit: `CUSTOMER_UPLOAD_RATE_LIMIT_*`.
- **Viewing:** `GET /me/media/:id/url` returns a short-lived signed URL (`media.private_url_ttl_seconds`), only for the customer's own uploads and the evidence on their own requests. **No public URL is ever returned.**
- **Attaching:** only the customer's own, private, verified uploads that aren't attached anywhere yet. Anything else is `404`.

### Create: `POST /me/orders/:orderId/items/:itemId/returns`

```json
{
  "requestType": "EXCHANGE",
  "reasonCode": "does_not_fit",
  "explanation": "Too tight on the chest.",
  "quantity": 1,
  "exchangeSizeId": "uuid-of-XL",
  "evidenceMediaIds": ["uuid"],
  "conditionConfirmations": { "originalTags": true }
}
```

The body is strict: a `responsibility`, `payer` or any other unknown field gets `400`. The checks, in order:

| Check | Error |
| --- | --- |
| The order belongs to you | `404` |
| The order is paid and `delivered` | `409 RETURN_NOT_ALLOWED` |
| Known reason (`does_not_fit`, `wrong_item`, `damaged_faulty`, `changed_mind`, `other`) | `400 VALIDATION_ERROR` |
| No open request for the item | `409 RETURN_ALREADY_OPEN` |
| Quantity ≤ purchased minus quantities in other requests (rejected and cancelled ones don't count) | `409 QUANTITY_LIMIT_EXCEEDED` (`details.remaining`) |
| Policy window (from `delivered_at`), if `request_window_days` is set | `409 RETURN_WINDOW_CLOSED` |
| Policy conditions (`require_original_tags`, `require_unworn_unwashed`), if set to `true` | `409 RETURN_CONDITION_NOT_MET` |
| Evidence present when the reason requires it (`wrong_item`, `damaged_faulty`) | `400 EVIDENCE_REQUIRED` |
| Evidence ids are your own private uploads | `404` |
| EXCHANGE: the product is made in `exchangeSizeId` (an active variant) | `409 SIZE_NOT_OFFERED` |

- **Policy:** the active `return_policies` row is read and its id is stored on the request. **A NULL rule is "not enforced yet": no default is ever invented.** Today's v1 policy has every rule NULL.
- **Responsibility is decided by the backend** at creation: `responsibility_set_by = SYSTEM`, with a `fault_basis`.

  | Reason + Blueprint decision | Responsibility | Cause | Payer |
  | --- | --- | --- | --- |
  | does_not_fit + OVERRIDE (scenario A) | CUSTOMER_FAULT | CUSTOMER_OVERRODE_RECOMMENDATION | CUSTOMER |
  | changed_mind (scenario C) | CUSTOMER_FAULT | CHANGED_MIND | CUSTOMER |
  | does_not_fit + LOCKED_RECOMMENDATION (scenario B, before review) | REVIEW_REQUIRED | – | UNDECIDED |
  | wrong_item, damaged_faulty, other, or does_not_fit without a decision | REVIEW_REQUIRED | – | UNDECIDED |

- **Customer wording:** the customer sees neutral wording only, `returnCosts: { payer, label }` (for example "Return delivery is paid by you."). Never "fault".

### `GET /me/returns`, `GET /me/returns/:id`

The detail view has the status and its label, the product and size, the reason, the explanation, the evidence ids, and the exchange size.

- **`returnInstructions`:** the return address and instructions, shown once the request is approved. Both are **PLACEHOLDER** settings until the client supplies them.
- **`replacement`:** carrier, tracking and sent time.
- **`timeline`:** only events the customer may see. Admin notes, inspection notes and responsibility events are never included.

### `POST /me/returns/:id/reply` and `POST /me/returns/:id/cancel`

- **Reply:** `{ "message": "...", "evidenceMediaIds": [] }`, allowed only while the request is `AWAITING_CUSTOMER`. The **same** request goes back to `UNDER_REVIEW`; a second request is never created.
- **Cancel:** `{ "reason": "optional" }`, allowed from `SUBMITTED`, `UNDER_REVIEW`, `AWAITING_CUSTOMER`, `APPROVED` or `AWAITING_RETURN`, so not once the item is in transit. A held exchange replacement is released.

## Admin

| Route | Role | Notes |
| --- | --- | --- |
| `GET /admin/returns` | admin | `status`, `requestType`, `responsibility`, `reasonCode`, `from`, `to`, `open`, `q` (request number, order number, customer name, email, phone), pagination |
| `GET /admin/returns/:id` | admin | Full review view (below) |
| `POST /admin/returns/:id/approve` `{ expectedStatus, note? }` | admin | → `APPROVED` → `AWAITING_RETURN` in one transaction. EXCHANGE reserves the replacement (out of stock: `409 INSUFFICIENT_STOCK`, not approved). Emails the instructions. |
| `POST /admin/returns/:id/reject` `{ expectedStatus, reason }` | admin | → `REJECTED`; releases any hold |
| `POST /admin/returns/:id/request-info` `{ expectedStatus, message }` | admin | → `AWAITING_CUSTOMER` |
| `POST /admin/returns/:id/mark-received` `{ expectedStatus, note? }` | admin | → `RETURN_RECEIVED` |
| `POST /admin/returns/:id/status` `{ expectedStatus, toStatus, note?, carrier?, trackingReference? }` | admin | Every other move: `UNDER_REVIEW`, `RETURN_IN_TRANSIT`, `EXCHANGE_PROCESSING`, `EXCHANGE_SENT` (carrier and tracking), `REFUND_PROCESSING`, `COMPLETED` |
| `POST /admin/returns/:id/inspect` `{ outcome, notes?, restockQuantity? }` | admin | At `RETURN_RECEIVED`; recorded once |
| `PATCH /admin/returns/:id/responsibility` `{ responsibility, faultCause, payer?, note }` | **super_admin** | Any change of who pays; note required |
| `POST /admin/returns/:id/notes` `{ body }` | admin | Internal, append-only |

- **Data-driven workflow:** the allowed moves live in `return_status_transitions`, stored per actor, with optional request type, reason-required and inspection-required flags. A new status means inserting rows, with no code change. The detail view lists `allowedTransitions`.
- **Concurrency:** every action sends `expectedStatus`. If the request changed meanwhile: `409 RETURN_STATUS_CONFLICT` with `details.currentStatus`; when two admins act at once, one wins. A move that isn't allowed gets `409 INVALID_STATUS_TRANSITION` with `details.allowed`. Moving on to `EXCHANGE_PROCESSING` or `REFUND_PROCESSING` before the inspection gets `409 RETURN_NOT_ALLOWED`.
- **Audit:** every change writes a `return_request_events` row (append-only) and an `admin_audit_logs` row in the same transaction.

### Exchange stock (TEAM DESIGN, decided 16 Oct 2026)

1. **At creation** the replacement variant (same product, `exchangeSizeId`) is stored.
2. **At APPROVED** one conditional UPDATE reserves it (the same as checkout), with a `stock_reservations` row owned by `return_request_id`. It never expires on its own, and the ledger gets `reservation +q`.
3. **On REJECTED or CANCELLED** the hold is released (`reservation_release −q`).
4. **At EXCHANGE_SENT** the hold is committed: on-hand and reserved both go down (`reservation_release −q`, `sale −q`).

Ledger rows reference `reference_type = 'return_request'`. The replacement stays linked to the original request and order item.

### Inspection and restock

- **RESELLABLE:** in one transaction, on-hand stock goes up by `restockQuantity` (default: the returned quantity; more than that gets `409 QUANTITY_LIMIT_EXCEEDED`) and a `stock_movements` row of type `return` is written. `trg_stock_return_guard` enforces the right variant, the inspection and the quantity limit; a guard refusal becomes `409 RETURN_NOT_ALLOWED`.
- **NOT_RESELLABLE:** never re-enters stock.
- **Once only:** a second inspection gets `409 RETURN_ALREADY_INSPECTED`.

### Responsibility (super_admin)

- **Allowed causes:**
  - BRAND_FAULT: `BLUEPRINT_FAILURE`, `WRONG_ITEM_DELIVERED`, `DEFECTIVE_ITEM`;
  - CUSTOMER_FAULT: `CUSTOMER_OVERRODE_RECOMMENDATION`, `CHANGED_MIND`;
  - REVIEW_REQUIRED: no cause.
- **`BLUEPRINT_FAILURE`** is allowed only when the item's decision was a `LOCKED_RECOMMENDATION` (scenario B; decided 16 Oct 2026).
- **Payer** defaults to CUSTOMER_FAULT → CUSTOMER, BRAND_FAULT → BRAND, REVIEW_REQUIRED → UNDECIDED, and can be overridden with the note.
- **Records:** `responsibility_set_by = ADMIN`, plus an internal event and an audit row with before and after. Responsibility is never the workflow status.
- **Errors:** an invalid combination gets `400 INVALID_RESPONSIBILITY`.

### Review view (`GET /admin/returns/:id`)

It shows the customer, the order (status, payment, delivered time) and the exact item (product, SKU, purchased size and quantity, unit price), plus:

- the request type, reason, explanation and the policy applied, with the condition confirmations;
- **evidence**, as short-lived signed URLs;
- the **Blueprint record**: method, recommended vs selected size, selection mode, fit preference, chart group and version, and each measurement with its required size;
- responsibility, cause, payer, who set it and why; the decision and who reviewed it;
- the exchange: replacement SKU, hold status, carrier and tracking;
- the inspection with its restocked quantity;
- the full timeline (customer and internal events, with actor names), the allowed transitions and the refund note.

## Emails

The outbox queues one email per event (`email_outbox.dedupe_key = return:<eventId>:<template>`). They're in English with a per-language string table, sent by the MOCK log provider in dev:

| Template | Sent when |
| --- | --- |
| `return_received` | The request is created |
| `return_info_requested` | Request more information (every round) |
| `return_approved` | Approved, with the **placeholder** return address and instructions |
| `return_rejected` | Rejected, with the reason |
| `return_item_received` | The item is marked received |
| `return_exchange_sent` | The replacement is sent, with carrier and tracking |

## Configuration

- **Settings** (admin-editable):
  - `returns.evidence_max_files` (5) and `returns.evidence_max_bytes` (10 MB): TEAM DESIGN;
  - `returns.return_address` and `returns.return_instructions`: PLACEHOLDER, Pending Client Decision.
- **Environment:** `CUSTOMER_UPLOAD_RATE_LIMIT_*` and `RETURNS_RATE_LIMIT_*` (create, reply and cancel).

## Open decisions

| Decision | Status |
| --- | --- |
| Return window and item conditions (`return_policies` values) | Pending Client Decision (team proposal); all NULL = not enforced |
| Return address and dispatch instructions | Pending Client Decision (placeholder settings) |
| Refund method and timing; refund execution | Pending Client Decision; nothing is refunded by the system |
| Who pays return shipping per scenario, and how it is charged | Payer is **recorded** (A: customer, B: brand, C: customer); collection is not built |
| When exchange replacement stock is reserved | TEAM DESIGN: at APPROVED (decided 16 Oct 2026) |
| Evidence retention period | Pending (team); evidence is kept |
| What a customer may do when a measurement is out of the chart range | Open (CLAUDE.md) |
