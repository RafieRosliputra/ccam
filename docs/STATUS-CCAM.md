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

1. **Umami**: new website id for ccam not created yet (env `UMAMI_WEBSITE_ID` empty → analytics off).
2. **Events**: none created; create in `/admin` with the client selected.
3. **Photo storage**: currently `/mnt/ssd/ccam/photos` on m10 local disk. Moving to tnas NFS
   (`/mnt/ssd/client-1month/ccam` per the plan) needs a root-run mount script on m10.
4. **Backups**: existing m10 backup jobs do not cover `/mnt/ssd/ccam` yet — add before real client data.
5. **Moderator**: first container boot downloads Python deps/models; verify photo moderation once real photos flow.
6. Unused Worker script `ccam-under-construction` still exists in the account (no routes) — delete when convenient.
