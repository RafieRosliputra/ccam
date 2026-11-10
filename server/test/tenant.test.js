// Tests for the CCAM platform + client branding: host matrix, platform landing, tenant branding,
// "Our clients", livescreen, organiser admin, event ownership scoping, logos, hero images.
// Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccam-tenant-'));

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
const aux = http.createServer((req, res) => {
  if (req.url === '/certs') return res.end(JSON.stringify({ keys: [jwk] }));
  res.statusCode = 404; res.end();
});
await new Promise((r) => aux.listen(0, '127.0.0.1', r));
const auxUrl = `http://127.0.0.1:${aux.address().port}`;

Object.assign(process.env, {
  DATA_DIR: path.join(tmp, 'data'), PHOTOS_DIR: path.join(tmp, 'photos'), COOKIE_SECURE: '0',
  PUBLIC_URL: 'https://ccam.my', SCAN_INTERVAL: '3600', ACCESS_AUD: 'aud-ccam',
  ACCESS_TEAM_DOMAIN: 'johorstudio.cloudflareaccess.com', ACCESS_CERTS_URL: `${auxUrl}/certs`,
  ADMIN_EMAILS: 'rafierosliputra@gmail.com', MODERATOR_URL: '',
  TENANT_ZONE: 'ccam.my', ADMIN_HOST: 'ccam.my', APEX_MODE: 'app',
});

const { handler } = await import('../src/server.js');
const db = await import('../src/db.js');
const storage = await import('../src/storage.js');
const tenant = await import('../src/tenant.js');

function jwt(email, { aud = 'aud-ccam', exp = Math.floor(Date.now() / 1000) + 3600 } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = enc({ email, aud: [aud], iss: 'https://johorstudio.cloudflareaccess.com', exp });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const AUTH = { 'cf-access-jwt-assertion': jwt('rafierosliputra@gmail.com') };

let server, port;
before(async () => {
  db.openDb();
  storage.ensureStorage();
  server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server.closeAllConnections(); server.close(); aux.close(); db.closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); });

function call(method, pathname, { host = 'ccam.my', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: { host, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text: buf.toString('utf8'), json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const admin = (method, pathname, opts = {}) => call(method, pathname, { ...opts, headers: { ...AUTH, ...(opts.headers || {}) } });
const asJson = (method, pathname, body, host = 'ccam.my') =>
  admin(method, pathname, { host, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

async function createOrg(over = {}) {
  const r = await asJson('POST', '/api/admin/organizers', { name: 'Passion Sound & Event', slug: 'passion', ...over });
  assert.equal(r.status, 201, r.text);
  return r.json.organizer;
}
async function goLive(id) {
  const r = await asJson('POST', `/api/admin/organizers/${id}/status`, { status: 'live' });
  assert.equal(r.status, 200, r.text);
  return r.json.organizer;
}

// ---------------- host matrix ----------------
test('resolveHost: ccam.my is the platform/admin, <slug>.ccam.my are clients', () => {
  assert.equal(tenant.resolveHost('ccam.my').kind, 'platform');
  assert.equal(tenant.resolveHost('ccam.my').admin, true);
  assert.equal(tenant.resolveHost('www.ccam.my').kind, 'platform');
  assert.equal(tenant.resolveHost('www.ccam.my').admin, false);
  assert.equal(tenant.resolveHost('passion.ccam.my').kind, 'unknown'); // not created yet
  assert.equal(tenant.resolveHost('localhost').kind, 'platform');
  assert.equal(tenant.resolveHost('127.0.0.1').kind, 'platform');
  assert.equal(tenant.resolveHost('a.b.ccam.my').kind, 'platform'); // nested labels are not clients
});

test('colour helpers derive a usable palette', () => {
  const b = tenant.deriveBrand({ colorPrimary: '#c8102e' });
  assert.match(b.colorPrimaryDark, /^#[0-9a-f]{6}$/i);
  assert.match(b.colorPrimarySoft, /^#[0-9a-f]{6}$/i);
  assert.equal(b.font, 'Archivo');
});

// ---------------- platform landing ----------------
test('platform landing is branded CCAM with the platform footer', async () => {
  const r = await call('GET', '/', { host: 'ccam.my' });
  assert.equal(r.status, 200);
  assert.match(r.text, /<title>CCAM Live/);
  assert.match(r.text, /data-tenant="platform"/);
  assert.match(r.text, /window\.__BRAND=/);
  assert.match(r.text, /"kind":"platform"/);
  assert.match(r.text, /"disclaimer":"platform provided by JohorStudio\.com"/);
  assert.match(r.text, /clientGrid/);
  assert.match(r.text, /servicesSection/);
});

test('livescreen page exists on every host', async () => {
  const p = await call('GET', '/livescreen', { host: 'ccam.my' });
  assert.equal(p.status, 200);
  assert.match(p.text, /Enter your event code/);
  assert.match(p.text, /id="boxes"/);
  const t = await call('GET', '/livescreen', { host: 'passion.ccam.my' });
  assert.equal(t.status, 404); // unknown client until created
});

// ---------------- organiser admin ----------------
test('organiser CRUD + validation', async () => {
  const org = await createOrg();
  assert.equal(org.status, 'draft');
  assert.equal(org.url, 'https://passion.ccam.my');
  let r = await asJson('POST', '/api/admin/organizers', { name: 'Other', slug: 'passion' });
  assert.equal(r.status, 409);
  r = await asJson('POST', '/api/admin/organizers', { name: 'Other', slug: 'admin' });
  assert.equal(r.status, 409);
  r = await asJson('POST', '/api/admin/organizers', { name: 'Other', slug: 'Bad Slug!' });
  assert.equal(r.status, 400);
  r = await asJson('POST', '/api/admin/organizers', { name: '' , slug: 'x-corp' });
  assert.equal(r.status, 400);
  const list = await admin('GET', '/api/admin/organizers');
  assert.equal(list.json.organizers.length, 1);
  assert.equal(list.json.zone, 'ccam.my');
  assert.equal(list.json.adminHost, 'ccam.my');
});

test('draft client host is not served yet (503)', async () => {
  const r = await call('GET', '/', { host: 'passion.ccam.my' });
  assert.equal(r.status, 503);
  assert.match(r.text, /not available/i);
  const api = await call('GET', '/api/brand', { host: 'passion.ccam.my' });
  assert.equal(api.status, 503);
});

test('unknown client subdomain = 404 page, static assets still load', async () => {
  const r = await call('GET', '/', { host: 'nobody.ccam.my' });
  assert.equal(r.status, 404);
  assert.match(r.text, /does not exist/i);
  assert.equal((await call('GET', '/css/site.css', { host: 'nobody.ccam.my' })).status, 200);
});

test('live client gets branded HTML, footer credit and no platform link', async () => {
  const org = (await admin('GET', '/api/admin/organizers')).json.organizers.find((o) => o.slug === 'passion');
  await asJson('PUT', `/api/admin/organizers/${org.id}`, {
    brand: {
      name: 'Passion Sound & Event', colorPrimary: '#c50a76', colorAccent: '#f5ba22',
      website: 'https://passion-sound-event.com/', whatsapp: '60127212813',
      contactUrl: 'https://passion-sound-event.com/contact-us/', logo: '/brand/passion/logo.png', hidePlatformLinks: true,
    },
  });
  await goLive(org.id);
  const r = await call('GET', '/', { host: 'passion.ccam.my' });
  assert.equal(r.status, 200);
  assert.match(r.text, /<title>Passion Sound &amp; Event Live|<title>Passion Sound & Event Live/);
  assert.match(r.text, /--teal:#c50a76/);
  assert.match(r.text, /data-tenant="passion"/);
  assert.match(r.text, /"disclaimer":"platform provided by JohorStudio\.com"/);
  const css = await call('GET', '/js/brand.js', { host: 'passion.ccam.my' });
  assert.equal(css.status, 200);
});

test('/api/brand returns the host brand', async () => {
  const tenantRes = await call('GET', '/api/brand', { host: 'passion.ccam.my' });
  assert.equal(tenantRes.status, 200);
  assert.equal(tenantRes.json.name, 'Passion Sound & Event');
  assert.equal(tenantRes.json.kind, 'tenant');
  assert.equal(tenantRes.json.zone, 'ccam.my');
  assert.equal(tenantRes.json.colors.primary, '#c50a76');
  const platformRes = await call('GET', '/api/brand', { host: 'ccam.my' });
  assert.equal(platformRes.json.name, 'CCAM');
  assert.equal(platformRes.json.kind, 'platform');
});

test('/api/clients lists live clients on the platform only', async () => {
  const p = await call('GET', '/api/clients', { host: 'ccam.my' });
  assert.equal(p.status, 200);
  assert.equal(p.json.clients.length, 1);
  assert.equal(p.json.clients[0].slug, 'passion');
  assert.equal(p.json.clients[0].url, 'https://passion.ccam.my');
  assert.equal(p.json.clients[0].logo, '/brand/passion/logo.png');
  const t = await call('GET', '/api/clients', { host: 'passion.ccam.my' });
  assert.equal(t.json.clients.length, 0);
});

test('admin paths are blocked on client hosts', async () => {
  const page = await call('GET', '/admin', { host: 'passion.ccam.my' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, 'https://ccam.my/admin');
  const api = await admin('GET', '/api/admin/organizers', { host: 'passion.ccam.my' });
  assert.equal(api.status, 403);
  const raw = await call('GET', '/admin.html', { host: 'ccam.my' });
  assert.equal(raw.status, 302);
  assert.equal(raw.headers.location, '/admin');
});

test('switch client off: pages 503, platform/clients list drops it', async () => {
  const org = (await admin('GET', '/api/admin/organizers')).json.organizers.find((o) => o.slug === 'passion');
  const off = await asJson('POST', `/api/admin/organizers/${org.id}/status`, { status: 'off' });
  assert.equal(off.status, 200);
  assert.equal((await call('GET', '/', { host: 'passion.ccam.my' })).status, 503);
  const clients = await call('GET', '/api/clients', { host: 'ccam.my' });
  assert.equal(clients.json.clients.length, 0);
  await goLive(org.id);
});

// ---------------- logos ----------------
test('logo upload/serve/remove', async () => {
  const org = (await admin('GET', '/api/admin/organizers')).json.organizers.find((o) => o.slug === 'passion');
  let r = await admin('POST', `/api/admin/organizers/${org.id}/logo`, { body: PNG, headers: { 'x-kind': 'logo' } });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.organizer.brand.logo, /^\/brand\/passion\/logo\.png$/);
  const img = await call('GET', '/brand/passion/logo.png', { host: 'passion.ccam.my' });
  assert.equal(img.status, 200);
  assert.match(String(img.headers['content-type']), /image\/png/);
  const bad = await admin('POST', `/api/admin/organizers/${org.id}/logo`, { body: Buffer.from('nope'), headers: { 'x-kind': 'logo' } });
  assert.equal(bad.status, 415);
  r = await admin('DELETE', `/api/admin/organizers/${org.id}/logo/logo`);
  assert.equal(r.json.organizer.brand.logo, '');
});

// ---------------- hero images ----------------
test('hero photos come from the brand, never the legacy JohorStudio set', async () => {
  const platform = await call('GET', '/data/hero.json', { host: 'ccam.my' });
  assert.equal(platform.status, 200);
  assert.deepEqual(platform.json.photos, []); // platform brand has no hero photos by default

  const org = (await admin('GET', '/api/admin/organizers')).json.organizers.find((o) => o.slug === 'passion');
  const hero = ['https://passion-sound-event.com/ho12.jpg', 'https://passion-sound-event.com/ho2.jpg'];
  await asJson('PUT', `/api/admin/organizers/${org.id}`, { brand: { heroImages: hero.join(',') } });
  const tenantRes = await call('GET', '/data/hero.json', { host: 'passion.ccam.my' });
  assert.equal(tenantRes.json.photos.length, 2);
  assert.equal(tenantRes.json.photos[0].sm, hero[0]);
  assert.equal(tenantRes.json.photos[0].title, 'Passion Sound & Event');
});

test('heroImages accepts at most 5 https/local URLs', async () => {
  const org = (await admin('GET', '/api/admin/organizers')).json.organizers.find((o) => o.slug === 'passion');
  const r = await asJson('PUT', `/api/admin/organizers/${org.id}`, {
    brand: { heroImages: ['https://a.test/1.jpg', 'javascript:alert(1)', 'https://a.test/2.jpg', 'https://a.test/3.jpg',
      'https://a.test/4.jpg', 'https://a.test/5.jpg', 'https://a.test/6.jpg'].join(',') },
  });
  const list = r.json.organizer.brand.heroImages.split(',');
  assert.equal(list.length, 5);
  assert.ok(!list.some((u) => u.startsWith('javascript:')));
});

// ---------------- platform brand ----------------
test('platform brand is editable', async () => {
  const r = await asJson('PUT', '/api/admin/brand/platform', { brand: { name: 'CCAM Platform', colorPrimary: '#0b5cff' } });
  assert.equal(r.status, 200, r.text);
  const page = await call('GET', '/', { host: 'ccam.my' });
  assert.match(page.text, /<title>CCAM Platform Live/);
  assert.match(page.text, /--teal:#0b5cff/);
  await asJson('PUT', '/api/admin/brand/platform', { brand: { name: '', colorPrimary: '' } });
});

// ---------------- event ownership scoping ----------------
test('platform events and client events never mix hosts', async () => {
  const org = (await admin('GET', '/api/admin/organizers')).json.organizers.find((o) => o.slug === 'passion');
  const platformEv = await asJson('POST', '/api/admin/events', { date: '20261110', title: 'CCAM Event' });
  assert.equal(platformEv.status, 201, platformEv.text);
  const clientEv = await asJson('POST', '/api/admin/events', { date: '20261110', title: 'Passion Gala', organizerId: org.id });
  assert.equal(clientEv.status, 201, clientEv.text);
  assert.equal(clientEv.json.event.organizerId, org.id);
  // admin-made links must point at the client's own domain, not the admin host
  assert.match(clientEv.json.event.codeUrl, /^https:\/\/passion\.ccam\.my\/c\/[0-9]{6}$/);
  assert.match(clientEv.json.event.url, /^https:\/\/passion\.ccam\.my\/e\//);
  assert.match(clientEv.json.event.joinUrl, /^https:\/\/passion\.ccam\.my\/join\/[0-9]{6}$/);
  assert.match(clientEv.json.event.organiserUrl, /^https:\/\/passion\.ccam\.my\/c\/[0-9]{6}\?r=o$/);
  const bad = await asJson('POST', '/api/admin/events', { date: '20261110', title: 'Nope', organizerId: 'nope' });
  assert.equal(bad.status, 400);

  db.updateEvent(platformEv.json.event.id, { starts_at: Date.now(), ends_at: Date.now() + 3600e3 });
  db.updateEvent(clientEv.json.event.id, { starts_at: Date.now(), ends_at: Date.now() + 3600e3 });

  const pTok = platformEv.json.event.token, cTok = clientEv.json.event.token;
  assert.equal((await call('GET', `/api/e/${pTok}`, { host: 'ccam.my' })).status, 200);
  assert.equal((await call('GET', `/api/e/${pTok}`, { host: 'passion.ccam.my' })).status, 404);
  assert.equal((await call('GET', `/api/e/${cTok}`, { host: 'passion.ccam.my' })).status, 200);
  assert.equal((await call('GET', `/api/e/${cTok}`, { host: 'ccam.my' })).status, 404);
  const adminView = await admin('GET', `/api/admin/events/${clientEv.json.event.id}`);
  assert.match(adminView.json.event.codeUrl, /^https:\/\/passion\.ccam\.my\//);
  assert.match(adminView.json.event.url, /^https:\/\/passion\.ccam\.my\/e\//);

  // a code only works on the host that owns the event
  const code = platformEv.json.event.codes.public;
  const wrongHost = await call('POST', '/auth/code', { host: 'passion.ccam.my', body: JSON.stringify({ code, want: 'guest' }), headers: { 'content-type': 'application/json' } });
  assert.equal(wrongHost.status, 401);
  const rightHost = await call('POST', '/auth/code', { host: 'ccam.my', body: JSON.stringify({ code, want: 'guest' }), headers: { 'content-type': 'application/json' } });
  assert.equal(rightHost.status, 200);

  const livePlatform = await call('GET', '/api/live-status', { host: 'ccam.my' });
  const liveTenant = await call('GET', '/api/live-status', { host: 'passion.ccam.my' });
  assert.deepEqual(livePlatform.json.live.map((e) => e.name), ['CCAM Event']);
  assert.deepEqual(liveTenant.json.live.map((e) => e.name), ['Passion Gala']);

  // an event can be moved to a client
  const moved = await asJson('PATCH', `/api/admin/events/${platformEv.json.event.id}`, { organizerId: org.id });
  assert.equal(moved.json.event.organizerId, org.id);
  assert.equal((await call('GET', `/api/e/${pTok}`, { host: 'passion.ccam.my' })).status, 200);
});

test('big screen is a public link: no login, no secret codes', async () => {
  const org = (await admin('GET', '/api/admin/organizers')).json.organizers.find((o) => o.slug === 'passion');
  const created = await asJson('POST', '/api/admin/events', { date: '20261110', title: 'Screen Event', organizerId: org.id });
  assert.equal(created.status, 201, created.text);
  const id = created.json.event.id;
  db.updateEvent(id, { starts_at: Date.now(), ends_at: Date.now() + 3600e3 });

  const screen = await call('GET', `/api/screen/${id}`, { host: 'passion.ccam.my' });
  assert.equal(screen.status, 200);
  assert.equal(screen.json.event.title, 'Screen Event');
  assert.equal(screen.json.event.token, created.json.event.token);
  assert.equal(screen.json.event.codes.public, created.json.event.codes.public);
  assert.equal(screen.json.event.codes.photographer, undefined);
  assert.equal(screen.json.event.codes.client, undefined);
  assert.ok(screen.json.event.settings);
  assert.ok('screenMode' in screen.json.event);

  const photos = await call('GET', `/api/screen/${id}/photos?filter=visible`, { host: 'passion.ccam.my' });
  assert.equal(photos.status, 200);
  assert.ok(Array.isArray(photos.json.photos));
  // works from any host (a laptop on the venue wifi opening the same link)
  assert.equal((await call('GET', `/api/screen/${id}`, { host: 'ccam.my' })).status, 200);
  assert.equal((await call('GET', `/api/screen/${id}`, { host: 'localhost' })).status, 200);
  assert.equal((await call('GET', '/api/screen/00000000-0000-0000-0000-000000000000')).status, 404);
  await admin('DELETE', `/api/admin/events/${id}`);
});

test('tenant contact details replace the platform contact', async () => {
  const cfg = await call('GET', '/auth/config', { host: 'passion.ccam.my' });
  assert.equal(cfg.json.whatsapp, '60127212813');
  assert.equal(cfg.json.contactUrl, 'https://passion-sound-event.com/contact-us/');
  const platformCfg = await call('GET', '/auth/config', { host: 'ccam.my' });
  assert.notEqual(platformCfg.json.whatsapp, '60127212813');
});

// ---------------- brand import guards ----------------
test('brand import refuses non-https and private hosts', async () => {
  const org = (await admin('GET', '/api/admin/organizers')).json.organizers.find((o) => o.slug === 'passion');
  assert.equal((await asJson('POST', `/api/admin/organizers/${org.id}/import`, { url: 'http://passion-sound-event.com' })).status, 400);
  assert.equal((await asJson('POST', `/api/admin/organizers/${org.id}/import`, { url: 'https://127.0.0.1/' })).status, 400);
  assert.equal((await asJson('POST', `/api/admin/organizers/${org.id}/import`, {})).status, 400);
});

test('delete client removes the subdomain and the clients entry', async () => {
  const org = (await admin('GET', '/api/admin/organizers')).json.organizers.find((o) => o.slug === 'passion');
  assert.equal((await admin('DELETE', `/api/admin/organizers/${org.id}`)).status, 200);
  assert.equal((await call('GET', '/', { host: 'passion.ccam.my' })).status, 404);
  const clients = await call('GET', '/api/clients', { host: 'ccam.my' });
  assert.equal(clients.json.clients.length, 0);
});
