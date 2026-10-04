# Mogoba online ordering server

A small Node HTTP server for Mogoba Korean Food House online orders. It does three things:

- Serves the customer site (`/order/`) and the register app (`/pos/`).
- Runs the ordering API in [`docs/online-ordering.md`](../docs/online-ordering.md): the
  published menu, placing and tracking orders, and the register endpoints.
- Stores register sync events (`/api/sync`), once per `eid`.

No dependencies and no build step. Node 22 only. Data is plain JSON files in `DATA_DIR`.

## Run it

```
POS_KEY="$(openssl rand -hex 24)" node server/server.mjs
```

Then open http://127.0.0.1:8790/order/ (customer) and http://127.0.0.1:8790/pos/ (register).
In the register, set the server URL and the same `POS_KEY` to publish the menu and receive
orders.

Tests:

```
node --test tests/server.test.mjs
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `POS_KEY` | none, required | Register key, sent as `Authorization: Bearer <key>`. At least 24 characters. The server refuses to start without it. |
| `PORT` | `8790` | Listen port. `0` picks a free one. |
| `HOST` | `127.0.0.1` | Listen address. Keep it local behind a reverse proxy. |
| `DATA_DIR` | `server/data` | Where orders, the menu, sync events and proofs are kept. |
| `BASE_PATH` | empty | Public path prefix, for example `/mogoba`. Stripped from incoming paths and used in redirects and in `/order/config.js`. Requests without the prefix also work, so a proxy may strip it or not. |
| `ALLOWED_ORIGINS` | empty | Comma list of extra origins allowed to call `/api` from a browser (for example the Android app's origin). Same origin is always allowed. |
| `TRUST_PROXY` | off | `1` to take the client IP from the last `X-Forwarded-For` entry. Turn on behind Caddy, otherwise every customer shares one rate limit. |
| `ORDER_RETENTION_DAYS` | `30` | Finished orders older than this move to `DATA_DIR/archive/`. |
| `ORDER_DIR`, `POS_DIR` | `order/`, `www/` | Static folders, if they live somewhere else. |

Store hours are always read in Asia/Manila time, whatever the host's time zone.

## API

As in the contract, plus two small additions:

| Method and path | Auth | Notes |
|---|---|---|
| `GET /api/store` | none | Published snapshot plus `posSeenAt` (last register poll). 404 until the register publishes. Supports `If-None-Match`. |
| `POST /api/orders` | none | Place an order. 201 new, 200 for a repeated `clientId`. 400, 409, 423, 429 as in the contract. |
| `GET /api/orders/<code>?t=<token>` | token | The public order record itself (no wrapper). |
| `POST /api/orders/<code>/cancel?t=<token>` | token | Addition. Customer cancel, only while `pending`. Returns `{ order }`. |
| `PUT /api/pos/store` | key | Replace the snapshot. Prices must be whole centavos. Returns `{ ok, updatedAt }`. |
| `GET /api/pos/orders?since=<ms>` | key | `{ orders, now }`. Each order includes `token` and `clientId`; `payment.proof` is a data URL while the order is `pending`, empty after. At most 8 MB of screenshots per poll: past that the reply has `more: true` and `now` is the last order's `updatedAt`. Use `now` as the next `since`. Each call is the register heartbeat. |
| `POST /api/pos/orders/<code>/status` | key | Returns `{ order }`. Bad transition 409, unknown status 400, rejected without reason 400. |
| `POST /api/sync` | key | `{ ack: [eid...] }`. Every well-formed eid is acknowledged, new or not. |
| `GET /api/health` | none | Addition. `{ ok, now, open, posSeenAt }` for monitoring. |

Errors are `{ "error": "Plain sentence.", "field": "payment.ref" }`.

Behaviour worth knowing:

- **Prices** are recomputed from the published snapshot. Anything the client sends about
  prices, names or totals is ignored.
- **Rate limits**: 8 placed orders and 30 refused attempts per 10 minutes per IP (IPv6 by
  its /64), and 5 placed orders per hour per phone number. A repeated `clientId` does not
  count. All answer 429 with `Retry-After`. Limits are kept in memory and reset on restart.
- **v1.1 rules**: references are normalized (spaces and dashes removed, upper case),
  `[A-Z0-9]{6,20}`, and unique per method forever, archived orders included (leading zeros
  ignored). Cash is refused for `prepay` items and above `payments.cash.maxTotal`. Orders
  get 423 while `now < pausedUntil`, and while the register has not polled in the last
  5 minutes (also right after a server restart, until its next poll).
- **Status** `same as current` is allowed and only updates `etaAt`, `posOrderId`,
  `verified`, `reason` or the payment check, with no timeline entry. Accepting a GCash or
  Maya order sets `payment.verified` to true unless the register sends `verified: false`.
  From `payment`, only `amountReceived`, `verifiedBy` and `verifiedAt` are taken; accepting
  with `amountReceived` below the total is 409.
  `out_for_delivery` is refused for pickup orders.
- **Proofs** are JPEG or PNG data URLs up to 1.5 MB (the data URL text), checked by their
  magic bytes, stored in `DATA_DIR/proofs/` and only ever returned to the register.
  `payment.proofSha` is the SHA-256 of the image bytes.
- **Requests**: JSON only (415 otherwise), 2 MB body limit (413), 2 minutes per request so
  slow mobile uploads finish.
- **Logs**: one line per request to stdout (time, method, path, status, duration). No query
  strings, IPs, names or phone numbers.

## Files in DATA_DIR

```
store.json              published menu and settings
orders.json             active orders
events.jsonl            register sync events, one line per eid
proofs/MGB-1234.jpg     payment screenshots
archive/orders-YYYY-MM.jsonl, archive/proofs/   finished orders past the retention window
```

Every write is serialized and goes to a temp file, is flushed, then renamed over the old one,
so a crash leaves the previous version intact. The folder is created `0700`: it holds names,
phone numbers and payment screenshots.

## systemd

`server/mogoba-pos.service` runs the server as user `mogoba` with data in
`/var/lib/mogoba-pos`.

```
sudo useradd --system --home /opt/mogoba-pos --shell /usr/sbin/nologin mogoba
sudo mkdir -p /opt/mogoba-pos && sudo cp -r order www server /opt/mogoba-pos/
sudo tee /etc/mogoba-pos.env >/dev/null <<EOF
POS_KEY=$(openssl rand -hex 24)
PORT=8790
HOST=127.0.0.1
BASE_PATH=/mogoba
TRUST_PROXY=1
EOF
sudo chmod 600 /etc/mogoba-pos.env
sudo cp server/mogoba-pos.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now mogoba-pos
journalctl -u mogoba-pos -f
```

The unit sets `DATA_DIR=/var/lib/mogoba-pos`; systemd creates it for the service user.

## Docker

`server/Dockerfile` builds on `node:22-alpine`, runs as the non-root `node` user and keeps
data in the `/data` volume. Build from the `mogoba-pos` folder:

```
docker build -f server/Dockerfile -t mogoba-pos .
docker volume create mogoba-data
docker run -d --name mogoba-pos --restart unless-stopped \
  -p 127.0.0.1:8790:8790 \
  -v mogoba-data:/data \
  -e POS_KEY="$(openssl rand -hex 24)" \
  -e BASE_PATH=/mogoba -e TRUST_PROXY=1 \
  mogoba-pos
```

Keep the `POS_KEY` somewhere safe; the register needs the same value. Inside the container
the server listens on `0.0.0.0`, so publish the port on `127.0.0.1` only.

## Caddy

Serve it at `https://ivnautomation.xyz/mogoba/`:

```
ivnautomation.xyz {
	redir /mogoba /mogoba/ 308
	handle /mogoba/* {
		request_body {
			max_size 3MB
		}
		reverse_proxy 127.0.0.1:8790
	}
}
```

Run the server with `BASE_PATH=/mogoba` and `TRUST_PROXY=1`. Caddy keeps the path, passes
the `Host` header and sets `X-Forwarded-For`. The customer site is then
`https://ivnautomation.xyz/mogoba/order/` and the register `https://ivnautomation.xyz/mogoba/pos/`.
Caddy adds HTTPS and HSTS; the server adds `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options` and a Content Security Policy with `frame-ancestors 'none'`.

## Backup

The data folder is small and every file is replaced atomically, so a plain copy is a
consistent backup of each file. Daily, keeping 30 days:

```
# /etc/cron.d/mogoba-pos-backup
15 3 * * * root umask 077; tar czf /var/backups/mogoba-pos-$(date +\%F).tgz -C /var/lib mogoba-pos && find /var/backups -name 'mogoba-pos-*.tgz' -mtime +30 -delete
```

With Docker, back up the volume instead:

```
docker run --rm -v mogoba-data:/data:ro -v /var/backups:/out alpine \
  tar czf /out/mogoba-pos-$(date +%F).tgz -C / data
```

Backups contain customer phone numbers and payment screenshots: keep them `0600` and off
public storage. To restore, stop the server, unpack over the data folder, start it again.
