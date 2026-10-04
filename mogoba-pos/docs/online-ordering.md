# Online ordering contract (v1)

Three parts share this contract:

| Part | Path | Role |
|---|---|---|
| Customer site | `order/` | Menu, cart, checkout, payment by GCash / Maya QR or cash, order tracking |
| Server | `server/` | Stores the published menu and orders, validates prices, talks to the register |
| Register (POS) | `www/` | Publishes menu and availability, receives orders, verifies payment, updates status |

Two transports carry the same JSON:

- **Server mode**: HTTP to `server/` (production).
- **Demo mode**: no server. The customer site and the register run on the same origin
  and exchange data through `localStorage` (keys below). Used for the client demo link.

Money is integer centavos. Times are epoch milliseconds. Text is plain (no HTML).

## Order statuses

| Status | Meaning | Set by |
|---|---|---|
| `pending` | Placed. Payment not yet checked (GCash / Maya) or order not yet accepted (cash) | customer |
| `accepted` | Staff accepted it. For GCash / Maya this means the payment was found in the app | register |
| `preparing` | Kitchen is making it | register |
| `ready` | Ready for pickup, or handed to the rider | register |
| `out_for_delivery` | Delivery only, rider on the way | register |
| `completed` | Picked up or delivered | register |
| `rejected` | Not accepted. `reason` is required (payment not found, sold out, closed, outside delivery area, other) | register |
| `cancelled` | Customer asked to cancel before `accepted` | customer or register |

Allowed transitions: `pending → accepted | rejected | cancelled`, `accepted → preparing | ready | cancelled`,
`preparing → ready`, `ready → out_for_delivery | completed`, `out_for_delivery → completed`.
Every change appends `{status, at, by}` to `timeline`.

Customer-facing labels: Waiting for confirmation, Confirmed, Preparing, Ready for pickup / Ready,
Out for delivery, Completed, Not accepted, Cancelled.

## Store snapshot (`GET /api/store`, demo key `mogoba.bridge.store`)

Published by the register on sign-in, on every menu or stock change, and when online settings change.

```json
{
  "v": 1,
  "updatedAt": 1791100000000,
  "name": "Mogoba Korean Food House",
  "address": "Rizal St, Aparri, Cagayan",
  "phone": "0936 575 7278",
  "accepting": true,
  "hours": [{ "day": 0, "open": "09:00", "close": "20:00" }],
  "prepMinutes": 20,
  "pickup": { "enabled": true },
  "delivery": { "enabled": true, "fee": 5000, "minOrder": 30000, "area": "Aparri town proper" },
  "payments": {
    "gcash": { "enabled": true, "accountName": "A. M.", "number": "0936 *** 7278", "qr": "data:image/png;base64,... or empty" },
    "maya":  { "enabled": true, "accountName": "A. M.", "number": "", "qr": "" },
    "cash":  { "enabled": true }
  },
  "cats": [{ "id": "dosirak", "name": "Dosirak", "ko": "도시락" }],
  "items": [
    {
      "id": "chicken-dosirak", "cat": "dosirak", "name": "Chicken Dosirak", "ko": "치킨 도시락",
      "img": "honeybutter", "price": 12000, "soldOut": false, "badge": "",
      "variantLabel": "Flavour",
      "variants": [{ "id": "honey", "name": "Honey Butter", "price": 12000, "soldOut": false }],
      "addons": [{ "gid": "addon", "name": "Add-ons", "options": [{ "id": "mozz", "name": "Mozzarella cheese", "price": 2000 }] }]
    }
  ]
}
```

`hours[].day` is 0 (Sunday) to 6. The store is open when `accepting` is true and the current
Asia/Manila time is inside today's hours. `img` is a file name in `assets/food/` without `.jpg`
(empty means no photo).

## Placing an order (`POST /api/orders`, demo key `mogoba.bridge.order.<code>`)

Request:

```json
{
  "clientId": "uuid-from-browser",
  "items": [{ "itemId": "chicken-dosirak", "variantId": "honey", "mods": [{ "gid": "addon", "oid": "mozz" }], "qty": 2, "note": "Extra spicy" }],
  "customer": { "name": "Juan Dela Cruz", "phone": "09171234567" },
  "fulfillment": { "type": "pickup", "time": "asap", "address": "", "landmark": "" },
  "payment": { "method": "gcash", "ref": "1234567890123", "sender": "Juan D.", "proof": "data:image/jpeg;base64,..." },
  "note": ""
}
```

Rules (server and demo both enforce):

1. Prices come from the store snapshot, never from the request. Unknown or sold-out items are rejected.
2. `qty` 1 to 50 per line, at most 30 lines.
3. `customer.name` 2 to 60 chars. `customer.phone` is a PH mobile: `09XXXXXXXXX` or `+639XXXXXXXXX` (stored as `09XXXXXXXXX`).
4. `fulfillment.type` is `pickup` or `delivery`. Delivery needs `address` (5+ chars), adds `delivery.fee`, and requires `subtotal >= delivery.minOrder`.
5. `fulfillment.time` is `asap` or an epoch ms time later today inside opening hours.
6. `payment.method` is `gcash`, `maya` or `cash`, and must be enabled.
   GCash and Maya require `ref`: digits only after removing spaces, 6 to 20 digits.
   The same `ref` + `method` cannot be used by another order that is not `rejected` (reply 409).
   `proof` is optional: a JPEG or PNG data URL up to 1.5 MB.
7. Orders are refused while the store is closed or not accepting.
8. `clientId` makes the call idempotent: the same `clientId` returns the existing order.

Response `201`:

```json
{ "code": "MGB-4821", "token": "32 hex chars", "order": { "...": "public order" } }
```

Errors: `{ "error": "Plain sentence the customer can act on.", "field": "payment.ref" }` with 400, 409, 423 (closed) or 429 (rate limited).

## Order record (stored, and returned to the register)

```json
{
  "code": "MGB-4821", "token": "...", "clientId": "...",
  "createdAt": 0, "updatedAt": 0, "status": "pending",
  "customer": { "name": "", "phone": "" },
  "fulfillment": { "type": "pickup", "time": "asap", "address": "", "landmark": "" },
  "lines": [{ "itemId": "", "variantId": "", "name": "", "variantName": "", "mods": [{ "gid": "", "oid": "", "name": "", "price": 0 }], "unit": 0, "qty": 1, "note": "" }],
  "subtotal": 0, "deliveryFee": 0, "total": 0,
  "payment": { "method": "gcash", "ref": "", "sender": "", "proof": "", "verified": false },
  "note": "", "reason": "", "etaAt": 0,
  "timeline": [{ "status": "pending", "at": 0, "by": "customer" }],
  "posOrderId": ""
}
```

`code` is `MGB-` plus 4 digits, unique. `token` guards the public tracking page.

## Tracking (`GET /api/orders/<code>?t=<token>`)

Returns the public order: everything above except `token`, `clientId` and `payment.proof`.
404 when the code or token does not match.

## Register endpoints (header `Authorization: Bearer <posKey>`)

- `PUT /api/pos/store` with a store snapshot. Replaces the published snapshot.
- `GET /api/pos/orders?since=<ms>` returns `{ "orders": [order records updated after since], "now": ms }`.
- `POST /api/pos/orders/<code>/status` with `{ "status", "reason", "etaAt", "posOrderId", "verified" }`. Validates the transition.
- `POST /api/sync` with `{ "device", "events": [{ "eid", "kind", "at", "data" }] }` returns `{ "ack": [eid...] }`. Stores each `eid` once.

## Demo mode keys (same origin, `localStorage`)

| Key | Value |
|---|---|
| `mogoba.bridge.store` | store snapshot JSON |
| `mogoba.bridge.order.<code>` | order record JSON (one key per order, so tabs never overwrite each other) |
| `mogoba.bridge.ping` | `Date.now()` written after any change, so other tabs get a `storage` event |

The register applies status changes by rewriting the order key. The customer site listens to
`storage` events and also polls every 5 seconds.

## v1.1 changes (from the research review)

These replace the matching v1 rules. Server, customer site and register all follow them.

1. **Reference numbers.** Normalize by removing spaces and dashes and upper-casing. Accept
   `[A-Z0-9]{6,20}`. A reference is unique per method forever, whatever the other order's
   status (reply 409 "This reference number was already used. Call the shop if this is a mistake.").
   Expected formats are GCash 13 digits and Maya 12 hex characters. The register shows a
   warning when a reference does not match, and never blocks on it.
2. **Prepayment.** Snapshot items may carry `"prepay": true` (bilao trays). Cash is not offered
   when the cart has a prepay item or when the total is above `payments.cash.maxTotal`
   (centavos, `0` means no limit). The server and the site both enforce it.
3. **Pause.** Snapshot field `pausedUntil` (ms, `0` when not paused). While `now < pausedUntil`
   the store takes no orders and the site shows "Paused, back at 4:30 PM".
4. **Register heartbeat.** In server mode the server adds `posSeenAt` (last time the register
   called `GET /api/pos/orders`) to `GET /api/store`. When it is more than 5 minutes old the
   site shows "Online orders are paused" with the shop phone, and the server refuses new
   orders with 423.
5. **Screenshot fingerprint.** `payment.proofSha` is the SHA-256 hex of the image bytes
   (server computes it; in demo mode the site computes it with SubtleCrypto). The register
   flags two orders with the same fingerprint.
6. **Verification.** Accepting a GCash or Maya order needs the amount received, typed by staff
   from the wallet app. Underpaid orders cannot be accepted, only rejected. Overpaid orders are
   accepted with a refund note. Verifying PHP 1,000 or more needs a manager PIN. The register
   stores `payment.amountReceived`, `payment.verifiedBy` and `payment.verifiedAt`; status
   updates may carry these in the `payment` object.
7. **Slow confirmation.** When an order stays `pending` for more than 5 minutes the tracking
   page shows "Taking longer than usual" with the shop phone.
