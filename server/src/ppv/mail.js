// Swappable email adapter. PPV_MAIL = console (default, dev) | cloudflare | brevo | resend.
// Secrets come from env only, never from the repo.
const env = process.env;

async function postJson(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`mail ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

const adapters = {
  // Prints the message to the server log. Safe default: nothing leaves the machine.
  async console({ to, subject, text }) { console.log(`[ppv mail] to=${to} subject=${subject}\n${text}`); },

  // Cloudflare Email Service (Email Sending, REST). Needs PPV_CF_ACCOUNT_ID, PPV_CF_EMAIL_TOKEN, PPV_MAIL_FROM.
  async cloudflare({ to, subject, text }) {
    const acct = env.PPV_CF_ACCOUNT_ID, token = env.PPV_CF_EMAIL_TOKEN;
    if (!acct || !token) throw new Error('Cloudflare email is not configured');
    await postJson(`https://api.cloudflare.com/client/v4/accounts/${acct}/email/sending/send`,
      { authorization: `Bearer ${token}` }, { from: env.PPV_MAIL_FROM || 'ppv@ccam.my', to, subject, text });
  },

  async brevo({ to, subject, text }) {
    if (!env.PPV_BREVO_KEY) throw new Error('Brevo is not configured');
    await postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': env.PPV_BREVO_KEY },
      { sender: { email: env.PPV_MAIL_FROM || 'ppv@ccam.my' }, to: [{ email: to }], subject, textContent: text });
  },

  async resend({ to, subject, text }) {
    if (!env.PPV_RESEND_KEY) throw new Error('Resend is not configured');
    await postJson('https://api.resend.com/emails', { authorization: `Bearer ${env.PPV_RESEND_KEY}` },
      { from: env.PPV_MAIL_FROM || 'ppv@ccam.my', to: [to], subject, text });
  },
};

export const mailer = { send: (m) => (adapters[env.PPV_MAIL || 'console'] || adapters.console)(m), adapters };
