// Video providers: turn an event + a short viewing token into a playable HLS URL.
//  hls       : MediaMTX (or any HLS origin) at event.provider_ref; token appended as ?pt= (origin checks it, or ignores it in test).
//  cfstream  : Cloudflare Stream signed URL (RS256 JWT). event.provider_ref = live input / video uid.
//              env: PPV_CF_STREAM_CODE (customer code), PPV_CF_STREAM_KEY_ID, PPV_CF_STREAM_PEM (base64 PEM private key)
import crypto from 'node:crypto';

const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

export function signStreamJwt(uid, expSec, keyId, pem) {
  const head = b64u({ alg: 'RS256', kid: keyId });
  const body = b64u({ sub: uid, kid: keyId, exp: expSec, nbf: Math.floor(Date.now() / 1000) - 30 });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), pem).toString('base64url');
  return `${head}.${body}.${sig}`;
}

export function playbackUrl(ev, { token, expMs }) {
  if (ev.provider === 'cfstream') {
    const code = process.env.PPV_CF_STREAM_CODE || '', kid = process.env.PPV_CF_STREAM_KEY_ID, pemB64 = process.env.PPV_CF_STREAM_PEM;
    if (!kid || !pemB64) return null;
    const jwt = signStreamJwt(ev.provider_ref, Math.floor(expMs / 1000), kid, Buffer.from(pemB64, 'base64').toString('utf8'));
    // customer code is optional: videodelivery.net accepts the same signed token
    return `https://${code ? `customer-${code}.cloudflarestream.com` : 'videodelivery.net'}/${jwt}/manifest/video.m3u8`;
  }
  if (!ev.provider_ref) return null;
  const sep = ev.provider_ref.includes('?') ? '&' : '?';
  return `${ev.provider_ref}${sep}pt=${encodeURIComponent(token)}`;
}
