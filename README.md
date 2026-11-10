# CCAM (ccam.my)

Live event photo platform: `ccam.my` is the platform itself (Live Photo service), and every event organiser /
client gets their own branded subdomain (`passion.ccam.my`, `johorstudio.ccam.my`) with the same service and
all guest / photographer / organiser / big-screen / download links on their own domain.

| Folder | Isi |
|---|---|
| `server/` | Node 24, zero npm deps: API, platform + client pages, SSE live updates. `npm test` |
| `moderator/` | Python: AI filter for guest photos (NSFW, politics, documents, violence). CPU on m10 |
| `deploy/` | TrueNAS custom app `ccam` (port 8101): `compose.yaml`, setup/update scripts |
| `docs/` | deploy runbook + implementation status |

## Hosts

| Host | Purpose |
|---|---|
| `ccam.my`, `www.ccam.my` | platform landing (Live Photo) + admin (`/admin`) + `/livescreen`; footer "platform provided by JohorStudio.com" |
| `<slug>.ccam.my` | client brand: own logo/colours/font/name, own events only; `/admin` redirects to `ccam.my/admin` |
| unknown `<slug>.ccam.my` | 404 (or 503 when the client is switched off) |

Everything is one app + one database: the tenant is chosen from the request `Host`. Client brands live in the
`organizers` table; events carry `organizer_id` so a client only ever sees its own events.

## Admin

`https://ccam.my/admin` (Cloudflare Access) → Events, and `https://ccam.my/admin/organizers` → **Event Organizer**
(create client, brand editor, website brand import, logos, hero photos, on/off switch).

## Deploy

See `docs/DEPLOY-CCAM.md`. The app is the TrueNAS custom app `ccam` on m10 (port 8101); Cloudflare tunnel
`ccam.my` + `*.ccam.my` → `http://192.168.0.100:8101`.
