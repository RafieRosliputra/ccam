# CCAM status — LIVE (2026-11-10)

Production is live on Cloudflare + m10. `live.johorstudio.com` is untouched (standalone, old code `d94092f`,
29,825 B, Access intact).

## Hosts

| URL | What it serves | Verified |
|---|---|---|
| `https://ccam.my/` | platform landing: Live Photo hero, **Our services**, **Our clients**, How it works, footer "platform provided by JohorStudio.com" | 200, 32,685 B, title "CCAM Live", 2 client cards |
| `https://ccam.my/livescreen` | enter-event-code page + "Events live now" (platform's own events) | 200 |
| `https://ccam.my/admin` | admin (Cloudflare Access app **CCAM Admin UI**) | 302 → Access login |
| `https://ccam.my/admin/organizers` | EVENT ORGANIZER page: create/edit/on-off clients, brand editor, website import, logos, hero photos | 200 after Access login |
| `https://ccam.my/api/admin/*` | admin API (Access-protected, same app, destination `/api/admin`) | 302 → Access login; 200 with session |
| `https://passion.ccam.my/` | Passion brand: logo, magenta `#c50a76`, Raleway, 5 hero photos, footer credit, own events only | 200, 33,538 B |
| `https://johorstudio.ccam.my/` | JohorStudio brand (teal `#1f6f68`, 5 hero photos), own events only | 200, 33,196 B |
| `https://ccam.my/api/clients` | public list of live clients (platform only) | 200, johorstudio + passion |

`/admin` on a client host → 302 to `https://ccam.my/admin`. `/admin.html`, `/organizers.html`, `/panel.html`
raw files redirect to the clean (Access-protected) URLs. A client host only ever serves its own events
(gallery `/e/…`, code login `/auth/code`, QR `/c/…`, `/show`, `/d`, uploads, live-status, showcase, `/api/me`).

## Big screen (public link)

The big screen is a **public page**: `/show/<event id>` needs no login, so it can be dropped into OBS or opened on
any laptop/tablet on the venue wifi. It reads `/api/screen/<id>` (+ `/photos`, `/stream`, `/bg/<which>`) which expose
only the guest code, screen mode, pin, QR popup, backgrounds and visible photos — **never** the photographer or
organiser codes. Images use the public `/p/<public token>/<photo>/<size>` route.

Controls stay in the organiser panel(s): any signed-in organiser (`/panel`, client code) can switch photos/black/
backgrounds, pin a photo, show the QR popup or the "Upload your photos!" message; the server publishes each change
over SSE (`pub:<event id>`), so several organisers can drive the same screen and every open screen follows. The panel
also has **Copy big-screen link** (client domain). Verified: public screen loaded with no cookie (code 544 955,
`ANNUAL DINNER · Big screen`, footer `passion.ccam.my`), a panel POST set the screen to `black` and the open screen
received `{mode:'black'}` over SSE, then reset to `photos`.

## Link rule (important)

Every event link is built from the **owning client**, never from the host the page happens to be served on:
`eventBase(ev)` → `https://<organizer slug>.ccam.my` (or `https://ccam.my` for platform events). That covers
guest `/c/<code>`, photographer `/join/<code>`, organiser `/c/<code>?r=o`, gallery `/e/<token>` and download `/d/<token>`.
The big screen (`/show/<id>`) advertises `location.host` in its footer/QR popup (so `sarwa.ccam.my` shows
`sarwa.ccam.my`) and keeps the floating footer lifted ~3vw off the bottom edge (safe-area aware).

## Infra

- **m10 TrueNAS custom app `ccam`** (port **8101**), container `ccam` + `ccam-moderator` (port 8096 internal).
  Code `/mnt/ssd/ccam/app` (git clone of `github.com/RafieRosliputra/ccam`, read-only mount), data
  `/mnt/ssd/ccam/data`, photos `/mnt/ssd/ccam/photos`, models `/mnt/ssd/ccam/models`.
  Secrets `/mnt/ssd/ccam/ccam.env` (mail key reused; no Google OAuth in ccam).
- **Cloudflare tunnel `m10`** (`5d1680e1-a30b-4010-9d52-eeae3c7abac9`, config v56): `ccam.my` and `*.ccam.my`
  → `http://192.168.0.100:8101`; every pre-existing route untouched. Backup: workspace `demo/cf-backup/`.
- **DNS zone `ccam.my`**: placeholder `A 192.0.2.1` removed; `CNAME @`, `CNAME www`, `CNAME *` →
  `…cfargotunnel.com`, proxied. Worker routes `ccam.my/*` + `www.ccam.my/*` (the old "Under construction"
  script) removed. Always Use HTTPS ON.
- **Cloudflare Access**: app **CCAM Admin UI** id `065f09f0-cf28-4adb-b1ef-dd4ca356d097`,
  AUD `9673ec1951c2b696a7e648545706e7d96ecad063892b48c361b5eacfd0c849bd`, destinations
  `ccam.my/admin` + `ccam.my/api/admin`, reusable policy **CCAM admins** (Allow, Emails
  `rafierosliputra@gmail.com`, `johorstudio@gmail.com`).

## Analytics

Umami website **CCAM** id `3b65bef6-9a72-4bbc-addf-702dd7ddc453` (ana.johorstudio.com) — script injected on
index, livescreen, gallery, shoot, download and 404 pages (same website id for platform and client hosts;
`data-domains` is the request host). Two synthetic `test` events were sent while verifying collection.

## Backup

`/mnt/ssd/ccam` is now its own ZFS dataset `ssd/ccam` (1.5 GB: app clone, SQLite data, brand logos, photos,
moderator models). Periodic snapshot task **id 1**: `ccam-auto-%Y%m%d-%H%M`, 00:17 and 12:17, keep **15 days**;
first snapshot `ssd/ccam@ccam-auto-20261110-2103`. The existing `/mnt/ssd/ssd-backup.sh` replica
(`zfs send -R ssd` → `a/ssd-backup`) now includes `ssd/ccam` automatically, so there is also a 12-hourly
off-pool copy. The temporary pre-dataset copy was verified and removed.

## Seeds

- Platform brand persisted in `meta['brand:platform']` (name CCAM, graphite `#0b0f14`, accent `#f97316`).
- `johorstudio` (live): JohorStudio colours + Archivo + 5 hero photos taken from the live site.
- `passion` (live): brand kit from `passion-sound-event.com` (magenta `#c50a76`, purple `#8f288c`, gold accent,
  Raleway, WhatsApp `60127212813`, 3 logos downloaded, 5 hero photos).
- No events yet — Rafi creates them in `/admin` and picks the client in the "Client (white-label domain)" field.

## Tests

`cd server && npm test` → **43/43** (13 API + 21 platform/tenant + 9 brand import). Also verified from outside
with curl (above), and in a real browser through Access (organizer list returns both clients).

## Remaining / follow-ups

1. **Events**: none created; create in `/admin` with the client selected.
2. **Photo storage**: currently `/mnt/ssd/ccam/photos` on the m10 dataset. Moving to tnas NFS
   (`/mnt/ssd/client-1month/ccam` per the plan) needs a root-run mount script on m10.
3. **Moderator**: verify photo moderation once real photos flow (container is running; first boot downloads models).
4. Optional: give the Umami website a friendlier domain list if client-host analytics need filtering.

## Big-screen modules (plugin system)

The big screen now has **three photo modules** and is extensible:

| Module | What it does |
|---|---|
| `slides` (built-in) | the original one-photo-at-a-time slideshow (Ken Burns, polaroid background). Every photo carries its uploader name at the bottom-left (`by <name>`), 5 px above the footer, same pill design as the NEW tag; a genuinely new photo briefly shows the pulsing **NEW** badge there instead |
| `carousel` | exactly **two columns (left/right)** scrolling in opposite directions, filling the screen. A new photo slides straight into a column (no pop-up). After ~5 s without a new photo, a random photo **grows out of its own carousel tile** (its rectangle animates from the tile to full screen, so it is obvious where it came from), then a ~30% zoom anchored on the face area (`object-position` + `transform-origin`, so landscape and portrait photos both keep the faces in view), with the uploader tag 5 px above the footer; then it shrinks back into the tile. A pinned photo pauses the columns and stays popped-out until released |
| `cinema` | a huge hero photo with a slowly moving filmstrip underneath. A new photo flies into the strip and then takes over the hero; a pinned photo pops up full screen and returns to the strip |

Modules are **plugin files**: `/modules/<id>.js`, each exporting
`export default function create(ctx) { return { mount, refresh, add, remove, pin, destroy } }` where
`ctx = { photos(), img(p,size), pick, R, reduce, photoById(id), closeOverlay, settings() }`.
`server/public/modules/` holds the built-ins; **admins can upload their own** from
`ccam.my/admin` → event → Big screen → **Upload module** (file name becomes the module id, max 200 KB).
Uploaded files live in `DATA_DIR/modules/` and are served at `/modules/<id>.js`.

- Layers are named CSS variables so a module author can re-order them: `--z-module` (3), `--z-overlay` (5),
  `--z-footer` (6), `--z-tag` (7), `--z-banner` (9). Override them inside the module's own `<style>`, e.g.
  `:root { --z-module: 9; }`. The **Main upload banner** (the big "Upload your photos!" message) is above the
  modules by default; hide it per event in the panel: Big screen → **Main upload banner** → **Banner: shown/hidden**
  (API: `POST /api/{admin|client}/events/<id>/bubble` with `{on:false}`).
- Panel: **Photo module** buttons (Slideshow / Carousel / Cinema / uploaded ones). The choice is stored on the
  event (`settings.module`, survives restart) and published over SSE (`module`), so every screen for that event
  switches. Uploaded modules are marked with `*`.
- API: `GET /api/modules` (public list), `GET /modules/<id>.js`, `POST /api/admin/modules/upload`
  (header `x-name`, body = JS), `DELETE /api/admin/modules/<id>`, `POST /api/{admin|client}/events/<id>/module`.
- Security: uploads are admin-only (Cloudflare Access). A module is arbitrary JS executed on public screens,
  so only upload modules you trust; the screen loads them as ES modules in its own origin.
