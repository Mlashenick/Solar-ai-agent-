// Solar AI Agent — zero-dependency Node server (Node 20.12+).
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as store from './lib/store.js';
import { think, score } from './lib/agent.js';
import { sendSms, sendEmail, syncHubspot, configured } from './lib/integrations.js';
import { demoLeads } from './lib/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(__dirname, '.env'))) process.loadEnvFile(path.join(__dirname, '.env'));
const env = process.env;

store.load();
if (!store.all().length) store.reset(demoLeads());

const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;

// ── helpers ───────────────────────────────────────────
function localHour() {
  return parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: env.TIMEZONE || 'America/Los_Angeles' }).format(new Date()));
}
const inQuietHours = () => { const h = localHour(); return h < +(env.QUIET_START || 9) || h >= +(env.QUIET_END || 18); };

function canContact(lead) {
  if (lead.optedOut) return 'Lead opted out';
  if (!lead.consent) return 'No consent on file — outreach requires prior express written consent';
  if (['booked', 'disqualified', 'opted_out'].includes(lead.status)) return `Lead is ${lead.status}`;
  if (!lead.demo && inQuietHours()) return `Outside contact hours (${env.QUIET_START || 9}:00–${env.QUIET_END || 18}:00)`;
  return null;
}

async function agentTurn(lead, channel) {
  const out = await think(lead, channel);
  lead.qual = { ...lead.qual, ...Object.fromEntries(Object.entries(out.qual || {}).filter(([, v]) => v)) };
  lead.status = out.status || lead.status;
  lead.optedOut = lead.optedOut || lead.status === 'opted_out';
  lead.score = score(lead.qual);
  lead.channel = channel;
  if (out.reply) {
    if (channel === 'email') {
      if (!lead.email) throw new Error('Lead has no email');
      await sendEmail(lead.email, `Quick question about solar for your ${lead.city || ''} home`.replace('  ', ' '), out.reply, { demo: lead.demo });
    } else {
      if (!lead.phone) throw new Error('Lead has no phone');
      await sendSms(lead.phone, out.reply, { demo: lead.demo });
    }
    lead.messages.push({ dir: 'out', channel, body: out.reply, at: new Date().toISOString() });
  }
  lead.updatedAt = new Date().toISOString();
  store.save();
  syncHubspot(lead).then((r) => { if (r?.id && lead.hubspotId !== r.id) { lead.hubspotId = r.id; store.save(); } }).catch((e) => console.error('HubSpot:', e.message));
  return lead;
}

async function inbound(lead, body, channel = 'sms') {
  lead.messages.push({ dir: 'in', channel, body, at: new Date().toISOString() });
  if (STOP.test(body)) {
    lead.optedOut = true; lead.status = 'opted_out'; store.save();
    syncHubspot(lead).catch((e) => console.error('HubSpot:', e.message));
    return lead; // Twilio sends the carrier STOP confirmation automatically.
  }
  if (lead.optedOut) { store.save(); return lead; }
  return agentTurn(lead, channel);
}

function validTwilio(req, params) {
  if (!env.TWILIO_AUTH_TOKEN || !env.PUBLIC_URL) return true;
  const url = env.PUBLIC_URL.replace(/\/$/, '') + req.url;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const sig = crypto.createHmac('sha1', env.TWILIO_AUTH_TOKEN).update(data).digest('base64');
  const given = req.headers['x-twilio-signature'] || '';
  return sig.length === given.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(given));
}

function authed(req) {
  if (!env.DASHBOARD_PASSWORD) return true;
  const [, b64] = (req.headers.authorization || '').split(' ');
  const pass = Buffer.from(b64 || '', 'base64').toString().split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(env.DASHBOARD_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const readBody = (req) => new Promise((ok, no) => {
  let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
  req.on('end', () => {
    try {
      const ct = req.headers['content-type'] || '';
      ok(!raw ? {} : ct.includes('json') ? JSON.parse(raw) : ct.includes('urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : {});
    } catch (e) { no(e); }
  });
});

const send = (res, code, data, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
};

// ── routes ────────────────────────────────────────────
const routes = [
  ['GET', '/api/status', () => ({ integrations: configured(), quietHours: inQuietHours(), leads: store.all().length, model: env.ANTHROPIC_MODEL || 'claude-sonnet-5' })],
  ['GET', '/api/leads', () => store.all().map(({ messages, ...l }) => ({ ...l, lastMessage: messages.at(-1) || null }))],
  ['POST', '/api/leads', ({ body }) => {
    if (!body.firstName || !(body.phone || body.email)) throw Object.assign(new Error('First name and phone or email required'), { code: 400 });
    return store.add({ ...body, phone: store.normPhone(body.phone), consent: !!body.consent, demo: false });
  }],
  ['GET', '/api/leads/:id', ({ lead }) => lead],
  ['POST', '/api/leads/:id/start', async ({ lead, body }) => {
    const why = canContact(lead); if (why) throw Object.assign(new Error(why), { code: 409 });
    return agentTurn(lead, body.channel === 'email' ? 'email' : 'sms');
  }],
  ['POST', '/api/leads/:id/simulate', ({ lead, body }) => inbound(lead, String(body.body || ''), lead.channel || 'sms')],
  ['POST', '/api/leads/:id/sync', async ({ lead }) => ({ ...(await syncHubspot(lead)) })],
  ['POST', '/api/campaign', async ({ body }) => {
    const channel = body.channel === 'email' ? 'email' : 'sms';
    const limit = Math.min(+body.limit || 10, 100);
    const targets = store.all().filter((l) => l.status === 'new' && !canContact(l)).slice(0, limit);
    const results = [];
    for (const l of targets) {
      try { await agentTurn(l, channel); results.push({ id: l.id, ok: true }); }
      catch (e) { results.push({ id: l.id, ok: false, error: e.message }); }
      await new Promise((r) => setTimeout(r, 1100)); // gentle pacing for carriers/APIs
    }
    return { channel, attempted: targets.length, results };
  }],
  ['POST', '/api/reset-demo', () => { store.reset([...store.all().filter((l) => !l.demo), ...demoLeads()]); return { ok: true }; }],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // Twilio inbound SMS webhook (no dashboard auth; signature-checked).
    if (req.method === 'POST' && url.pathname === '/webhooks/twilio/sms') {
      const p = await readBody(req);
      if (!validTwilio(req, p)) return send(res, 403, 'Bad signature', 'text/plain');
      let lead = store.byPhone(p.From);
      if (!lead) lead = store.add({ firstName: 'Unknown', phone: store.normPhone(p.From), consent: true, source: 'inbound-sms' });
      await inbound(lead, p.Body || '', 'sms');
      return send(res, 200, '<Response></Response>', 'text/xml');
    }
    if (url.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');

    if (!authed(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Solar AI Agent"' }); return res.end('Login required'); }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html'))
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'index.html')), 'text/html; charset=utf-8');

    for (const [method, pattern, fn] of routes) {
      if (method !== req.method) continue;
      const keys = [];
      const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
      const m = url.pathname.match(re);
      if (!m) continue;
      const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const ctx = { params, body: req.method === 'POST' ? await readBody(req) : {} };
      if (params.id) { ctx.lead = store.get(params.id); if (!ctx.lead) return send(res, 404, { error: 'Lead not found' }); }
      return send(res, 200, await fn(ctx));
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.code || 500, { error: e.message });
  }
});

const port = +(env.PORT || 3000);
server.listen(port, () => {
  const c = configured();
  console.log(`Solar AI Agent on :${port} — ` + Object.entries(c).map(([k, v]) => `${k}:${v ? 'live' : 'dry-run'}`).join(' '));
});
