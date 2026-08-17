const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rides.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const allowed = { intensity: ['Locker', 'Mittel', 'Hart'], length: ['Kurz', 'Mittel', 'Lang'] };

function todayUtc() { return new Date().toISOString().slice(0, 10); }
function dateWindow() {
  const start = new Date(`${todayUtc()}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
}
function clean(value, max = 120) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function dateLabel(date) { return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)); }
const db = { url: (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''), key: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(), table: (process.env.SUPABASE_TABLE || 'rides').trim() };
function dbEnabled() { return Boolean(db.url && db.key); }
async function dbRequest(method, query, payload, prefer) {
  const response = await fetch(`${db.url}/rest/v1/${db.table}${query}`, { method, headers: { apikey: db.key, Authorization: `Bearer ${db.key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${method} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}
async function readRides() {
  if (dbEnabled()) return (await dbRequest('GET', '?select=data')).map(row => row.data).filter(Boolean).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); } catch { return []; }
}
async function saveRidesFile(rides) { await fs.mkdir(DATA_DIR, { recursive: true }); await fs.writeFile(DATA_FILE, JSON.stringify(rides, null, 2)); }
async function persistRide(rides, ride, isNew = false) {
  if (!dbEnabled()) return saveRidesFile(rides);
  if (isNew) return dbRequest('POST', '', { id: ride.id, data: ride }, 'return=minimal');
  return dbRequest('PATCH', `?id=eq.${encodeURIComponent(ride.id)}`, { data: ride }, 'return=minimal');
}
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
function mailConfig() { return { key: (process.env.RESEND_API_KEY || '').trim(), from: (process.env.FROM_EMAIL || '').trim() }; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function mailBody(ride, headline, intro) {
  const rows = [['Datum', dateLabel(ride.date)], ['Uhrzeit', `${ride.time} Uhr`], ['Intensität', ride.intensity], ['Länge', ride.length], ['Mitfahrende', String(ride.participants.length)]];
  const list = rows.map(([label, value]) => `<tr><td style="padding:6px 0;color:#8a938f;font-size:13px;width:120px">${escapeHtml(label)}</td><td style="padding:6px 0;color:#14221f;font-size:13px">${escapeHtml(value)}</td></tr>`).join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:32px 16px;background:#f7f8f4;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border:1px solid #e3e8e1;border-radius:12px">
<tr><td style="padding:32px">
<p style="margin:0 0 24px;font-size:11px;letter-spacing:2px;color:#8a938f">RIDE CIRCLE</p>
<h1 style="margin:0 0 10px;font-size:21px;line-height:1.3;color:#14221f;font-weight:700">${escapeHtml(headline)}</h1>
<p style="margin:0 0 26px;font-size:14px;line-height:1.6;color:#73807b">${escapeHtml(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef1ec">${list}</table>
</td></tr></table>
<p style="margin:18px 0 0;font-size:11px;color:#a2aaa5">Du erhältst diese Nachricht, weil du Benachrichtigungen für diese Ausfahrt aktiviert hast.</p>
</td></tr></table></body></html>`;
}
async function notify(ride, kind, participant) {
  const { key, from } = mailConfig();
  const to = ride.notifyEmail;
  if (!to) return;
  if (!key) return console.warn('Benachrichtigung übersprungen: RESEND_API_KEY ist nicht gesetzt.');
  if (!validEmail(from)) return console.warn('Benachrichtigung übersprungen: FROM_EMAIL fehlt oder ist ungültig.');
  if (!validEmail(to)) return console.warn('Benachrichtigung übersprungen: keine gültige Empfängeradresse hinterlegt.');
  const joined = kind === 'join';
  const subject = joined ? `${participant.name} fährt mit` : `${participant.name} fährt nicht mit`;
  const intro = joined ? `${participant.name} hat sich für deine Ausfahrt eingetragen.` : `${participant.name} hat sich von deiner Ausfahrt abgemeldet.`;
  const text = `${intro}\n\nDatum: ${dateLabel(ride.date)}\nUhrzeit: ${ride.time} Uhr\nIntensität: ${ride.intensity}\nLänge: ${ride.length}\nMitfahrende: ${ride.participants.length}`;
  try {
    const response = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text, html: mailBody(ride, subject, intro) }) });
    const detail = await response.text();
    if (!response.ok) return console.error(`Resend hat die Benachrichtigung abgelehnt (${response.status}): ${detail}`);
    console.log(`Benachrichtigung an ${to} gesendet: ${detail}`);
  } catch (error) {
    console.error('Versand der Benachrichtigung fehlgeschlagen:', error.message);
  }
}
async function body(req) { let raw = ''; for await (const chunk of req) raw += chunk; return JSON.parse(raw || '{}'); }
function publicRide(ride) { return { id: ride.id, date: ride.date, time: ride.time, intensity: ride.intensity, length: ride.length, creator: { name: ride.creator.name }, participants: ride.participants.map(({ email, ...p }) => p) }; }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const { key, from } = mailConfig(); let storageReachable = null; let storageError = null;
      if (dbEnabled()) { try { await dbRequest('GET', '?select=data&limit=1'); storageReachable = true; } catch (error) { console.error(error.message); storageReachable = false; storageError = error.message; } }
      return send(res, 200, { storage: dbEnabled() ? 'supabase' : `file:${DATA_DIR}`, table: db.table, storageReachable, storageError, durable: dbEnabled(), mail: { apiKeyConfigured: Boolean(key), fromConfigured: validEmail(from) } });
    }
    if (req.method === 'GET' && url.pathname === '/api/config') { const dates = dateWindow(); return send(res, 200, { dates, labels: Object.fromEntries(dates.map(date => [date, dateLabel(date)])), today: todayUtc() }); }
    if (req.method === 'GET' && url.pathname === '/api/rides') {
      const dates = dateWindow(); const rides = await readRides();
      return send(res, 200, rides.filter(r => dates.includes(r.date)).map(publicRide));
    }
    if (req.method === 'POST' && url.pathname === '/api/rides') {
      const input = await body(req); const name = clean(input.name, 80); const email = clean(input.email, 160).toLowerCase();
      const date = clean(input.date, 10); const time = clean(input.time, 5); const intensity = clean(input.intensity, 20); const length = clean(input.length, 20);
      if (!name || !validEmail(email) || !dateWindow().includes(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !allowed.intensity.includes(intensity) || !allowed.length.includes(length)) return send(res, 400, { error: 'Bitte fülle alle Felder korrekt aus.' });
      const notifyEmail = input.notify ? email : '';
      const rides = await readRides(); const ride = { id: crypto.randomUUID(), date, time, intensity, length, notifyEmail, createdAt: new Date().toISOString(), creator: { name, email }, participants: [{ name, email }] };
      rides.push(ride); await persistRide(rides, ride, true); return send(res, 201, publicRide(ride));
    }
    const joinMatch = url.pathname.match(/^\/api\/rides\/([^/]+)\/join$/);
    if (req.method === 'POST' && joinMatch) {
      const input = await body(req); const name = clean(input.name, 80); const email = clean(input.email, 160).toLowerCase();
      if (!name || !validEmail(email)) return send(res, 400, { error: 'Name und eine gültige E-Mail-Adresse sind erforderlich.' });
      const rides = await readRides(); const ride = rides.find(r => r.id === joinMatch[1]); if (!ride || !dateWindow().includes(ride.date)) return send(res, 404, { error: 'Diese Ausfahrt ist nicht mehr verfügbar.' });
      if (!ride.participants.some(p => p.email === email)) { ride.participants.push({ name, email }); await persistRide(rides, ride); await notify(ride, 'join', { name, email }); }
      return send(res, 200, publicRide(ride));
    }
    const leaveMatch = url.pathname.match(/^\/api\/rides\/([^/]+)\/leave$/);
    if (req.method === 'POST' && leaveMatch) {
      const input = await body(req); const email = clean(input.email, 160).toLowerCase(); const rides = await readRides(); const ride = rides.find(r => r.id === leaveMatch[1]);
      if (!ride || !validEmail(email)) return send(res, 400, { error: 'Bitte gib die E-Mail-Adresse an, mit der du dich eingetragen hast.' });
      if (ride.creator.email === email) return send(res, 400, { error: 'Die erstellende Person kann die Ausfahrt nicht verlassen.' });
      const leaving = ride.participants.find(p => p.email === email); if (!leaving) return send(res, 404, { error: 'Mit dieser E-Mail-Adresse ist niemand eingetragen.' });
      ride.participants = ride.participants.filter(p => p.email !== email);
      await persistRide(rides, ride); await notify(ride, 'leave', leaving); return send(res, 200, publicRide(ride));
    }
    if (req.method === 'GET') { const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); const filePath = path.resolve(ROOT, file); if (!filePath.startsWith(ROOT) || !MIME[path.extname(filePath)]) return send(res, 404, { error: 'Not found' }); res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] }); return res.end(await fs.readFile(filePath)); }
    send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    const storageIssue = error.message.startsWith('Supabase');
    send(res, storageIssue ? 503 : 500, { error: storageIssue ? 'Die Datenbank ist nicht erreichbar. Details unter /api/health.' : 'Die Anfrage konnte nicht verarbeitet werden.' });
  }
});
server.listen(PORT, () => console.log(`Ride Circle running at http://localhost:${PORT}`));
