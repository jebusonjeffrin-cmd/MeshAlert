const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { Pool }  = require('pg');
const { spawn } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Database ──────────────────────────────────────────────────────────────────
let pool = null;
const memStore   = [];
const memUsers   = []; // fallback users store

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  pool.query(`
    CREATE TABLE IF NOT EXISTS sos_messages (
      message_id   TEXT PRIMARY KEY,
      data         JSONB NOT NULL,
      received_at  BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dashboard_users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'admin',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `).then(() => console.log('[DB] PostgreSQL ready'))
    .catch(e => console.error('[DB] Init error:', e.message));
} else {
  console.log('[DB] No DATABASE_URL — using in-memory store');
}

// ── SOS helpers ───────────────────────────────────────────────────────────────
async function saveMessage(msg) {
  if (pool) {
    await pool.query(
      'INSERT INTO sos_messages (message_id,data,received_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [msg.messageId, msg, Date.now()],
    );
  } else {
    if (!memStore.find(m => m.messageId === msg.messageId)) memStore.unshift(msg);
  }
}

async function getAllMessages() {
  if (pool) {
    const { rows } = await pool.query('SELECT data FROM sos_messages ORDER BY received_at DESC LIMIT 1000');
    return rows.map(r => r.data);
  }
  return memStore;
}

async function isDuplicate(messageId) {
  if (pool) {
    const { rows } = await pool.query('SELECT 1 FROM sos_messages WHERE message_id=$1', [messageId]);
    return rows.length > 0;
  }
  return memStore.some(m => m.messageId === messageId);
}

async function deleteMessage(messageId) {
  if (pool) {
    await pool.query('DELETE FROM sos_messages WHERE message_id=$1', [messageId]);
  } else {
    const idx = memStore.findIndex(m => m.messageId === messageId);
    if (idx !== -1) memStore.splice(idx, 1);
  }
}

// ── User helpers ──────────────────────────────────────────────────────────────
async function findUser(username) {
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM dashboard_users WHERE username=$1', [username]);
    return rows[0] || null;
  }
  return memUsers.find(u => u.username === username) || null;
}

async function countUsers() {
  if (pool) {
    const { rows } = await pool.query('SELECT COUNT(*) FROM dashboard_users');
    return parseInt(rows[0].count, 10);
  }
  return memUsers.length;
}

async function createUser(username, password, role = 'admin') {
  const hash = await bcrypt.hash(password, 12);
  if (pool) {
    await pool.query(
      'INSERT INTO dashboard_users (username, password_hash, role) VALUES ($1,$2,$3)',
      [username, hash, role]
    );
  } else {
    memUsers.push({ username, password_hash: hash, role, created_at: new Date() });
  }
}

// ── JWT helpers ───────────────────────────────────────────────────────────────
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7)
    : req.query._token || req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = payload;
  next();
}

// ── SSH Tunnel ────────────────────────────────────────────────────────────────
let tunnelUrl = '';

function startTunnel() {
  if (process.env.PORT) return;
  const ssh = spawn('ssh', [
    '-R', '80:localhost:3001',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    'nokey@localhost.run',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  ssh.stdout.on('data', d => {
    const match = d.toString().match(/https:\/\/[a-z0-9]+\.lhr\.life/);
    if (match) {
      tunnelUrl = match[0];
      console.log('[Tunnel] ✅ URL:', tunnelUrl);
      broadcast('tunnel', { url: tunnelUrl });
    }
  });
  ssh.stderr.on('data', d => { const s = d.toString().trim(); if (s) console.log('[Tunnel]', s); });
  ssh.on('close', code => {
    console.log('[Tunnel] exited (', code, ') — restarting in 5s');
    tunnelUrl = '';
    setTimeout(startTunnel, 5000);
  });
}
startTunnel();

// ── SSE ───────────────────────────────────────────────────────────────────────
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(payload); } catch {} }
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const userCount = await countUsers().catch(() => 0);
  res.json({ ok: true, ts: Date.now(), db: !!pool, tunnelUrl: tunnelUrl || null, setupRequired: userCount === 0 });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

// First-time setup: creates the first admin account (only works when 0 users exist)
app.post('/api/auth/setup', async (req, res) => {
  try {
    if (await countUsers() > 0) return res.status(403).json({ error: 'Setup already complete' });
    const { username, password } = req.body;
    if (!username || !password || password.length < 6)
      return res.status(400).json({ error: 'Username and password (min 6 chars) required' });
    await createUser(username.trim().toLowerCase(), password);
    const token = signToken({ username: username.trim().toLowerCase(), role: 'admin' });
    res.json({ ok: true, token });
  } catch (e) {
    console.error('[Setup] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Credentials required' });
    const user = await findUser(username.trim().toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken({ username: user.username, role: user.role });
    res.json({ ok: true, token, username: user.username, role: user.role });
  } catch (e) {
    console.error('[Login] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify token
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// ── SOS (POST from phone — no auth required) ──────────────────────────────────
app.post('/api/sos', async (req, res) => {
  try {
    const msg = req.body;
    if (!msg?.messageId) return res.status(400).json({ error: 'Invalid message' });
    if (await isDuplicate(msg.messageId)) return res.json({ ok: true, duplicate: true });
    msg._receivedAt = Date.now();
    await saveMessage(msg);
    console.log(`[SOS] ${msg.emergencyType ?? msg.type} from ${msg.senderName} — hops: ${msg.hops?.length ?? 0}`);
    broadcast('sos', msg);
    res.json({ ok: true });
  } catch (e) {
    console.error('[SOS] Error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Protected SOS routes ──────────────────────────────────────────────────────
app.get('/api/sos', requireAuth, async (_req, res) => {
  try { res.json(await getAllMessages()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sos/export', requireAuth, async (req, res) => {
  try {
    const msgs = await getAllMessages();
    const rows = [
      ['messageId','senderName','senderId','emergencyType','latitude','longitude','message','bloodGroup','hops','ttl','timestamp'].join(','),
      ...msgs.map(m => [
        m.messageId ?? '',
        `"${(m.senderName ?? '').replace(/"/g,'""')}"`,
        m.senderId ?? '',
        m.emergencyType ?? m.type ?? '',
        m.payload?.latitude ?? '',
        m.payload?.longitude ?? '',
        `"${(m.payload?.message ?? '').replace(/"/g,'""')}"`,
        m.payload?.bloodGroup ?? '',
        Array.isArray(m.hops) ? m.hops.length : (m.hops ?? 0),
        m.ttl ?? '',
        m.timestamp ? new Date(m.timestamp).toISOString() : '',
      ].join(',')),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="meshalert-${Date.now()}.csv"`);
    res.send(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/sos/:id', requireAuth, async (req, res) => {
  try {
    await deleteMessage(req.params.id);
    broadcast('delete', { messageId: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/sos', requireAuth, async (_req, res) => {
  try {
    if (pool) await pool.query('DELETE FROM sos_messages');
    else memStore.length = 0;
    broadcast('deleteAll', {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/events', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const messages = await getAllMessages().catch(() => []);
  res.write(`event: init\ndata: ${JSON.stringify(messages)}\n\n`);
  if (tunnelUrl) res.write(`event: tunnel\ndata: ${JSON.stringify({ url: tunnelUrl })}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.listen(PORT, '0.0.0.0', () => console.log(`MeshAlert server on port ${PORT}`));
