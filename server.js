const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rides.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const allowed = { intensity: ['Easy', 'Moderate', 'Hard'], length: ['Short', 'Medium', 'Long'] };

function todayUtc() { return new Date().toISOString().slice(0, 10); }
function dateWindow() {
  const start = new Date(`${todayUtc()}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
}
function clean(value, max = 120) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function dateLabel(date) { return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)); }
async function readRides() { try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); } catch { return []; } }
async function saveRides(rides) { await fs.mkdir(DATA_DIR, { recursive: true }); await fs.writeFile(DATA_FILE, JSON.stringify(rides, null, 2)); }
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
async function notify(ride, subject, participant) {
  if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL || !ride.notifyEmail) return;
  await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.FROM_EMAIL, to: [ride.notifyEmail], subject, text: `${participant.name} (${participant.email}) ${subject.toLowerCase()} for your ${ride.date} ride.` }) });
}
async function body(req) { let raw = ''; for await (const chunk of req) raw += chunk; return JSON.parse(raw || '{}'); }
function publicRide(ride) { return { id: ride.id, date: ride.date, time: ride.time, intensity: ride.intensity, length: ride.length, creator: { name: ride.creator.name }, participants: ride.participants.map(({ email, ...p }) => p) }; }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/config') { const dates = dateWindow(); return send(res, 200, { dates, labels: Object.fromEntries(dates.map(date => [date, dateLabel(date)])), today: todayUtc() }); }
    if (req.method === 'GET' && url.pathname === '/api/rides') {
      const dates = dateWindow(); const rides = await readRides();
      return send(res, 200, rides.filter(r => dates.includes(r.date)).map(publicRide));
    }
    if (req.method === 'POST' && url.pathname === '/api/rides') {
      const input = await body(req); const name = clean(input.name, 80); const email = clean(input.email, 160).toLowerCase();
      const date = clean(input.date, 10); const time = clean(input.time, 5); const intensity = clean(input.intensity, 20); const length = clean(input.length, 20); const notifyEmail = clean(input.notifyEmail, 160).toLowerCase();
      if (!name || !validEmail(email) || !dateWindow().includes(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !allowed.intensity.includes(intensity) || !allowed.length.includes(length) || (notifyEmail && !validEmail(notifyEmail))) return send(res, 400, { error: 'Please complete every field with valid values.' });
      const rides = await readRides(); const ride = { id: crypto.randomUUID(), date, time, intensity, length, notifyEmail, createdAt: new Date().toISOString(), creator: { name, email }, participants: [{ name, email }] };
      rides.push(ride); await saveRides(rides); return send(res, 201, publicRide(ride));
    }
    const joinMatch = url.pathname.match(/^\/api\/rides\/([^/]+)\/join$/);
    if (req.method === 'POST' && joinMatch) {
      const input = await body(req); const name = clean(input.name, 80); const email = clean(input.email, 160).toLowerCase();
      if (!name || !validEmail(email)) return send(res, 400, { error: 'Name and a valid e-mail are required.' });
      const rides = await readRides(); const ride = rides.find(r => r.id === joinMatch[1]); if (!ride || !dateWindow().includes(ride.date)) return send(res, 404, { error: 'That ride is no longer available.' });
      if (!ride.participants.some(p => p.email === email)) { ride.participants.push({ name, email }); await saveRides(rides); await notify(ride, 'Someone joined your ride', { name, email }); }
      return send(res, 200, publicRide(ride));
    }
    const leaveMatch = url.pathname.match(/^\/api\/rides\/([^/]+)\/leave$/);
    if (req.method === 'POST' && leaveMatch) {
      const input = await body(req); const email = clean(input.email, 160).toLowerCase(); const rides = await readRides(); const ride = rides.find(r => r.id === leaveMatch[1]);
      if (!ride || !validEmail(email)) return send(res, 400, { error: 'Enter the e-mail used to join this ride.' });
      if (ride.creator.email === email) return send(res, 400, { error: 'The ride creator cannot leave. Ask a friend to create a replacement ride.' });
      const before = ride.participants.length; ride.participants = ride.participants.filter(p => p.email !== email); if (before === ride.participants.length) return send(res, 404, { error: 'No participant with that e-mail was found.' });
      await saveRides(rides); await notify(ride, 'Someone left your ride', { name: 'A participant', email }); return send(res, 200, publicRide(ride));
    }
    if (req.method === 'GET') { const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); const filePath = path.resolve(ROOT, file); if (!filePath.startsWith(ROOT) || !MIME[path.extname(filePath)]) return send(res, 404, { error: 'Not found' }); res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] }); return res.end(await fs.readFile(filePath)); }
    send(res, 404, { error: 'Not found' });
  } catch (error) { console.error(error); send(res, 500, { error: 'The server could not complete that request.' }); }
});
server.listen(PORT, () => console.log(`Ride Circle running at http://localhost:${PORT}`));
