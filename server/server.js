const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const { Pool } = require('pg');
const { spawn } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Database (PostgreSQL on Railway, or in-memory fallback for local dev) ─────
let pool = null;
const memStore = [];

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
  `).then(() => console.log('[DB] PostgreSQL ready'))
    .catch(e => console.error('[DB] Init error:', e.message));
} else {
  console.log('[DB] No DATABASE_URL — using in-memory store (restart loses data)');
}

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

// ── SSH Tunnel (local dev only — Railway doesn't need this) ───────────────────
let tunnelUrl = '';

function startTunnel() {
  if (process.env.PORT) return;  // Running on Railway — no tunnel needed

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
    }
  });

  ssh.stderr.on('data', d => {
    const s = d.toString().trim();
    if (s) console.log('[Tunnel]', s);
  });

  ssh.on('close', code => {
    console.log('[Tunnel] Process exited (code', code + ') — restarting in 5s');
    tunnelUrl = '';
    setTimeout(startTunnel, 5000);
  });
}

startTunnel();

// ── SSE clients ────────────────────────────────────────────────────────────────
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(payload); } catch {} }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), db: !!pool, tunnelUrl: tunnelUrl || null });
});

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

app.get('/api/sos', async (req, res) => {
  try { res.json(await getAllMessages()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const messages = await getAllMessages().catch(() => []);
  res.write(`event: init\ndata: ${JSON.stringify(messages)}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.listen(PORT, '0.0.0.0', () => console.log(`MeshAlert server running on port ${PORT}`));
