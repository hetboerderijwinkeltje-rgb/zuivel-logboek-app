const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'logboeken.json');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_ENABLED = Boolean(process.env.LOGBOOK_PASSWORD);
const LOGBOOK_USER = process.env.LOGBOOK_USER || 'annemiek';
const LOGBOOK_PASSWORD = process.env.LOGBOOK_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || LOGBOOK_PASSWORD || 'local-dev-session-secret';
const SESSION_COOKIE = 'zuivellogboek_session';
const SESSION_MAX_AGE_SECONDS = Number(process.env.SESSION_MAX_AGE_SECONDS || 60 * 60 * 24 * 7);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function unbase64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isSecureRequest(req) {
  return req.headers['x-forwarded-proto'] === 'https';
}

function cookieParts(req, maxAge) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts;
}

function createSessionCookie(req) {
  const payload = base64url(JSON.stringify({
    user: LOGBOOK_USER,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  }));
  const token = `${payload}.${sign(payload)}`;
  const parts = cookieParts(req, SESSION_MAX_AGE_SECONDS);
  parts[0] = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
  return parts.join('; ');
}

function clearSessionCookie(req) {
  return cookieParts(req, 0).join('; ');
}

function hasValidSession(req) {
  if (!AUTH_ENABLED) return true;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeCompare(signature, sign(payload))) return false;
  try {
    const data = JSON.parse(unbase64url(payload));
    return data.user === LOGBOOK_USER && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function safeNext(value) {
  if (!value || typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function sendLoginPage(res, status = 200, message = '', next = '/') {
  const html = `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Inloggen - Zuivellogboek</title>
  <style>
    :root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#172033;background:#f4f7fb}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
    main{width:min(420px,100%);background:#fff;border:1px solid #d9e2ef;border-radius:10px;padding:24px;box-shadow:0 16px 40px rgba(15,23,42,.08)}
    h1{font-size:24px;margin:0 0 6px}
    p{color:#64748b;margin:0 0 20px}
    label{display:block;font-weight:700;margin:14px 0 6px}
    input{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:12px;font:inherit}
    button{width:100%;margin-top:18px;border:0;border-radius:8px;padding:12px 14px;background:#2563eb;color:#fff;font-weight:800;font:inherit;cursor:pointer}
    .error{border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;padding:10px;margin-bottom:14px}
  </style>
</head>
<body>
  <main>
    <h1>Zuivellogboek</h1>
    <p>Log in om de logboeken te bekijken en op te slaan.</p>
    ${message ? `<div class="error">${escapeHtml(message)}</div>` : ''}
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${escapeHtml(safeNext(next))}">
      <label for="username">Gebruiker</label>
      <input id="username" name="username" value="${escapeHtml(LOGBOOK_USER)}" autocomplete="username" required>
      <label for="password">Wachtwoord</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Inloggen</button>
    </form>
  </main>
</body>
</html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ logbooks: [] }, null, 2), 'utf8');
  }
}

async function readStore() {
  await ensureStore();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { logbooks: Array.isArray(parsed.logbooks) ? parsed.logbooks : [] };
  } catch {
    return { logbooks: [] };
  }
}

async function writeDailyBackup(store) {
  const backupDir = path.join(DATA_DIR, 'backups');
  const backupFile = path.join(backupDir, `logboeken-${new Date().toISOString().slice(0, 10)}.json`);
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(backupFile, JSON.stringify(store, null, 2), 'utf8');
}

async function writeStore(store) {
  await ensureStore();
  const tmp = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tmp, DATA_FILE);
  await writeDailyBackup(store);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function sendDownload(res, status, contentType, filename, data) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store'
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error('Request is te groot.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleAuthRoutes(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/session') {
    sendJson(res, 200, {
      authEnabled: AUTH_ENABLED,
      authenticated: hasValidSession(req),
      user: AUTH_ENABLED && hasValidSession(req) ? LOGBOOK_USER : null
    });
    return true;
  }

  if (!AUTH_ENABLED) return false;

  if (req.method === 'GET' && url.pathname === '/login') {
    if (hasValidSession(req)) sendRedirect(res, safeNext(url.searchParams.get('next')));
    else sendLoginPage(res, 200, '', url.searchParams.get('next') || '/');
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    const form = new URLSearchParams(await readBody(req));
    const username = form.get('username') || '';
    const password = form.get('password') || '';
    const next = safeNext(form.get('next') || '/');
    if (safeCompare(username, LOGBOOK_USER) && safeCompare(password, LOGBOOK_PASSWORD)) {
      res.writeHead(302, {
        Location: next,
        'Set-Cookie': createSessionCookie(req),
        'Cache-Control': 'no-store'
      });
      res.end();
      return true;
    }
    sendLoginPage(res, 401, 'Gebruiker of wachtwoord klopt niet.', next);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/logout') {
    res.writeHead(302, {
      Location: '/login',
      'Set-Cookie': clearSessionCookie(req),
      'Cache-Control': 'no-store'
    });
    res.end();
    return true;
  }

  return false;
}

function requireAuth(req, res, url) {
  if (!AUTH_ENABLED || hasValidSession(req)) return true;
  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 401, { error: 'Niet ingelogd.' });
    return false;
  }
  sendRedirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  return false;
}

function summaryFromState(id, state, existing = {}) {
  const fields = state?.fields || {};
  const product = fields.productSelect || 'yoghurt';
  const dateMap = {
    yoghurt: fields['y-date'],
    karnemelk: fields['km-date'] || fields['km-prod-date'],
    vla: fields['v-date'],
    melk: fields['m-date'],
    chocomelk: fields['c-date']
  };
  return {
    id,
    product,
    date: dateMap[product] || '',
    bereider: fields.bereider || '',
    title: `${product}${dateMap[product] ? ` - ${dateMap[product]}` : ''}`,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function summariesCsv(logbooks) {
  const rows = [['id', 'datum', 'product', 'bereider', 'aangemaakt', 'laatst_gewijzigd']];
  for (const item of logbooks) {
    const s = item.summary || {};
    rows.push([s.id, s.date, s.product, s.bereider, s.createdAt, s.updatedAt]);
  }
  return rows.map(row => row.map(csvEscape).join(';')).join('\r\n');
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const store = await readStore();

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/logbooks') {
    const list = store.logbooks
      .map(item => item.summary)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return sendJson(res, 200, { logbooks: list });
  }

  if (req.method === 'GET' && url.pathname === '/api/backup') {
    return sendDownload(res, 200, 'application/json; charset=utf-8', `zuivellogboek-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store, null, 2));
  }

  if (req.method === 'GET' && url.pathname === '/api/logbooks.csv') {
    return sendDownload(res, 200, 'text/csv; charset=utf-8', `zuivellogboek-overzicht-${new Date().toISOString().slice(0, 10)}.csv`, summariesCsv(store.logbooks));
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'logbooks' && parts[2]) {
    const found = store.logbooks.find(item => item.id === parts[2]);
    if (!found) return sendJson(res, 404, { error: 'Logboek niet gevonden.' });
    return sendJson(res, 200, found);
  }

  if (req.method === 'POST' && url.pathname === '/api/logbooks') {
    const payload = JSON.parse(await readBody(req) || '{}');
    const state = payload.state;
    if (!state || typeof state !== 'object') return sendJson(res, 400, { error: 'Geen geldig logboek ontvangen.' });
    const id = payload.id || crypto.randomUUID();
    const index = store.logbooks.findIndex(item => item.id === id);
    const existing = index >= 0 ? store.logbooks[index].summary : {};
    const item = { id, summary: summaryFromState(id, state, existing), state };
    if (index >= 0) store.logbooks[index] = item;
    else store.logbooks.push(item);
    await writeStore(store);
    return sendJson(res, 200, item);
  }

  if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'logbooks' && parts[2]) {
    const before = store.logbooks.length;
    store.logbooks = store.logbooks.filter(item => item.id !== parts[2]);
    if (store.logbooks.length === before) return sendJson(res, 404, { error: 'Logboek niet gevonden.' });
    await writeStore(store);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'API-route niet gevonden.' });
}

async function serveStatic(req, res, url) {
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relative);
  const resolvedRelative = path.relative(ROOT, filePath);
  const publicPath = resolvedRelative.replace(/\\/g, '/');
  const allowedStatic =
    publicPath === 'index.html' ||
    publicPath === 'styles.css' ||
    publicPath === 'app.js' ||
    publicPath === 'manifest.json' ||
    publicPath === 'service-worker.js' ||
    publicPath.startsWith('icons/');
  if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative) || !allowedStatic) {
    res.writeHead(403);
    return res.end('Verboden');
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': filePath.endsWith('service-worker.js') ? 'no-store' : 'no-cache'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Niet gevonden');
  }
}

function localAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true });
    if (await handleAuthRoutes(req, res, url)) return;
    if (!requireAuth(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Serverfout.' });
  }
});

function startServer(port = PORT, host = HOST) {
  return server.listen(port, host, () => {
    console.log(`Zuivellogboek server draait op http://127.0.0.1:${port}/`);
    console.log(`Data-map: ${DATA_DIR}`);
    console.log(`Login: ${AUTH_ENABLED ? `aan (${LOGBOOK_USER})` : 'uit'}`);
    for (const address of localAddresses()) {
      console.log(`Op je netwerk: http://${address}:${port}/`);
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { server, startServer };
