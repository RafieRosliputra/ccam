# Deploy / operate CCAM (m10 `ccam` app, port 8101)

Code: `github.com/RafieRosliputra/ccam` (branch `main`).
Server: m10 (`ssh -i ~/.ssh/truenas_claude truenas_admin@100.101.43.120`), TrueNAS custom app **`ccam`**.

## Update the code (no Cloudflare work)

```bash
cd ~/ai/ccam.my/ccam-app && git push origin main            # from the Mac, after tests pass
ssh -i ~/.ssh/truenas_claude truenas_admin@100.101.43.120 \
  'cd /mnt/ssd/ccam/app && git pull -q && git log --oneline -1'
# static files (HTML/CSS/JS) are read from disk on every request — no restart needed.
# server/src changes need a restart:
ssh -i ~/.ssh/truenas_claude truenas_admin@100.101.43.120 'midclt call app.redeploy ccam'
```

Health check: `curl -s http://127.0.0.1:8101/auth/config` on m10, or `curl -sI https://ccam.my/`.

## Env / secrets

`/mnt/ssd/ccam/ccam.env` (chmod 600): `ADMIN_EMAIL`, `WHATSAPP`, `CONTACT_URL`, `MAIL_API_KEY`.
Everything else is in the app's compose config (`/mnt/ssd/ccam/app/deploy/compose.yaml` and the TrueNAS app
config): `PUBLIC_URL=https://ccam.my`, `ADMIN_HOST=ccam.my`, `PLATFORM_HOSTS=ccam.my,www.ccam.my`,
`TENANT_ZONE=ccam.my`, `BRANDS_DIR=/data/brands`, `ACCESS_AUD=<CCAM Admin UI AUD>`, `MODERATOR_URL=http://moderator:8096`.

Changing compose-level env: edit `deploy/compose.yaml`, then apply with the API (custom apps reject unknown
top-level fields):

```bash
# on m10: build {"custom_compose_config": {...}} from the desired compose and
midclt call app.update ccam "$(cat /tmp/ccam_app_update.json)"
midclt call app.job_wait <job id>   # or: midclt call core.job_wait <job id> 120
```

## Cloudflare (already done once — keep for reference)

Tunnel `m10` public hostnames: `ccam.my` and `*.ccam.my` → `HTTP 192.168.0.100:8101` (leave Host Header empty).
DNS: `CNAME @`, `CNAME www`, `CNAME *` → `5d1680e1-a30b-4010-9d52-eeae3c7abac9.cfargotunnel.com`, proxied.
Always Use HTTPS ON. Access app **CCAM Admin UI** must cover `ccam.my/admin` and `ccam.my/api/admin`
(AUD is the value in `ACCESS_AUD`). Do not put Access on the public pages.

## Rollback

```bash
ssh -i ~/.ssh/truenas_claude truenas_admin@100.101.43.120 \
  'cd /mnt/ssd/ccam/app && git checkout -f <previous-commit> && midclt call app.redeploy ccam'
```
Data is additive (SQLite + files under `/mnt/ssd/ccam`), so rolling the code back never deletes events.
Cloudflare routes can stay; without the app the tunnel returns its catch-all 404.

## Clients

`https://ccam.my/admin/organizers` (Access login) → **+ New event organizer** → name + slug → **Read website**
to import brand → logos/colours/font/hero photos → **Deploy (go live)**. `https://<slug>.ccam.my` is live
immediately (wildcard DNS + tunnel are already in place). Turn off / delete from the same card.
