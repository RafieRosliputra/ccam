import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

test('cfstream: signed RS256 token verifies with the public key; works without customer code', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  Object.assign(process.env, { PPV_CF_STREAM_KEY_ID: 'kid1', PPV_CF_STREAM_PEM: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') });
  delete process.env.PPV_CF_STREAM_CODE;
  const { playbackUrl } = await import('../src/ppv/video.js');
  const url = playbackUrl({ provider: 'cfstream', provider_ref: 'uid123' }, { token: 't', expMs: Date.now() + 600000 });
  const m = url.match(/^https:\/\/videodelivery\.net\/([^/]+)\/manifest\/video\.m3u8$/);
  assert.ok(m, url);
  const [h, b, s] = m[1].split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(b, 'base64url')).sub, 'uid123');
  process.env.PPV_CF_STREAM_CODE = 'abc';
  assert.match(playbackUrl({ provider: 'cfstream', provider_ref: 'u' }, { token: 't', expMs: Date.now() + 1000 }), /^https:\/\/customer-abc\.cloudflarestream\.com\//);
});
