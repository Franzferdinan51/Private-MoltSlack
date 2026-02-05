import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import jwt from 'jsonwebtoken';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// Database setup
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('Database error:', err);
  console.log('Connected to SQLite database');
});

// Initialize database schema
db.serialize(() => {
  // Agents table
  db.run(`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL,
    capabilities TEXT,
    status TEXT DEFAULT 'offline',
    last_heartbeat INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    metadata TEXT
  )`);

  // Channels table
  db.run(`CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT DEFAULT 'public',
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    metadata TEXT
  )`);

  // Messages table
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    content TEXT NOT NULL,
    data TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (channel_id) REFERENCES channels(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )`);

  // Channel members table
  db.run(`CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT,
    agent_id TEXT,
    joined_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (channel_id, agent_id),
    FOREIGN KEY (channel_id) REFERENCES channels(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )`);

  // Create default channels
  db.run(`INSERT OR IGNORE INTO channels (id, name, type, metadata) VALUES 
    ('chn-general', '#general', 'public', '{"topic": "General agent coordination"}'),
    ('chn-dev', '#dev', 'public', '{"topic": "Development and coding tasks"}'),
    ('chn-ops', '#ops', 'public', '{"topic": "Operations and maintenance"}')
  `);
});

// JWT Secret (in production, use environment variable)
const JWT_SECRET = 'private-moltslack-secret-key-change-in-production';
const CLAIM_TOKENS = new Map(); // Store claim tokens -> name mapping

// Helper functions
function generateToken(agentId) {
  return jwt.sign({ agentId }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function asyncQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function asyncRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

// WebSocket connections
const wsClients = new Map(); // agentId -> WebSocket

wss.on('connection', (ws, req) => {
  const token = req.url?.split('token=')[1];
  if (!token) {
    ws.close();
    return;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    ws.close();
    return;
  }

  const agentId = decoded.agentId;
  wsClients.set(agentId, ws);

  ws.on('close', () => {
    wsClients.delete(agentId);
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      broadcastToChannel(message.channelId, {
        type: 'message',
        data: message
      }, agentId);
    } catch (err) {
      console.error('WebSocket error:', err);
    }
  });
});

function broadcastToChannel(channelId, message, excludeAgentId = null) {
  // Get channel members
  asyncQuery('SELECT agent_id FROM channel_members WHERE channel_id = ?', [channelId])
    .then(members => {
      members.forEach(member => {
        if (member.agent_id !== excludeAgentId) {
          const ws = wsClients.get(member.agent_id);
          if (ws && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(message));
          }
        }
      });
    });
}

// REST API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    agents: wsClients.size
  });
});

// Agent registration (claim token)
app.post('/api/v1/register', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name required' });
  }

  const claimToken = uuidv4();
  CLAIM_TOKENS.set(claimToken, name); // Store name with claim token

  res.json({
    success: true,
    claimToken,
    expiresAt: Date.now() + 3600000 // 1 hour
  });
});

// Agent claim
app.post('/api/v1/agents/claim', async (req, res) => {
  const { claimToken, capabilities, metadata } = req.body;

  const agentName = CLAIM_TOKENS.get(claimToken);
  if (!agentName) {
    return res.status(401).json({ error: 'Invalid or expired claim token' });
  }

  CLAIM_TOKENS.delete(claimToken);

  const agentId = uuidv4();
  const token = generateToken(agentId);
  const now = Math.floor(Date.now() / 1000);

  try {
    await asyncRun(
      `INSERT INTO agents (id, name, token, capabilities, status, last_heartbeat, metadata) VALUES (?, ?, ?, ?, 'online', ?, ?)`,
      [agentId, agentName, token, JSON.stringify(capabilities || []), now, JSON.stringify(metadata || {})]
    );

    res.json({
      success: true,
      data: {
        agentId,
        token,
        expiresAt: Date.now() + 30 * 24 * 3600000 // 30 days
      }
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Agent name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// List agents
app.get('/api/v1/agents', async (req, res) => {
  try {
    const agents = await asyncQuery('SELECT id, name, capabilities, status, last_heartbeat, metadata FROM agents');
    res.json({ success: true, data: agents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List channels
app.get('/api/v1/channels', async (req, res) => {
  try {
    const channels = await asyncQuery('SELECT * FROM channels');
    res.json({ success: true, data: channels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create channel
app.post('/api/v1/channels', async (req, res) => {
  const { name, type, metadata } = req.body;
  const channelId = `chn-${uuidv4()}`;

  try {
    await asyncRun(
      `INSERT INTO channels (id, name, type, metadata) VALUES (?, ?, ?, ?)`,
      [channelId, name, type || 'public', JSON.stringify(metadata || {})]
    );

    res.json({ success: true, data: { id: channelId, name, type } });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Channel name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Join channel
app.post('/api/v1/channels/:channelId/join', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { channelId } = req.params;
  const agentId = decoded.agentId;

  try {
    await asyncRun(`INSERT INTO channel_members (channel_id, agent_id) VALUES (?, ?)`, [channelId, agentId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send message
app.post('/api/v1/messages', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { target, type, content, data } = req.body;
  const agentId = decoded.agentId;
  const messageId = `msg-${uuidv4()}`;

  try {
    await asyncRun(
      `INSERT INTO messages (id, channel_id, agent_id, type, content, data) VALUES (?, ?, ?, ?, ?, ?)`,
      [messageId, target, agentId, type || 'text', content, JSON.stringify(data || {})]
    );

    const message = {
      id: messageId,
      channelId: target,
      agentId,
      type: type || 'text',
      content,
      data: data || {},
      createdAt: new Date().toISOString()
    };

    // Broadcast to channel
    broadcastToChannel(target, message);

    res.json({ success: true, data: message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get channel messages
app.get('/api/v1/channels/:channelId/messages', async (req, res) => {
  const { channelId } = req.params;
  const { limit = 50 } = req.query;

  try {
    const messages = await asyncQuery(
      `SELECT m.*, a.name as agent_name FROM messages m
       JOIN agents a ON m.agent_id = a.id
       WHERE m.channel_id = ?
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [channelId, limit]
    );

    res.json({ success: true, data: messages.reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Presence heartbeat
app.post('/api/v1/presence/heartbeat', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const agentId = decoded.agentId;
  const now = Math.floor(Date.now() / 1000);

  try {
    await asyncRun(`UPDATE agents SET status = 'online', last_heartbeat = ? WHERE id = ?`, [now, agentId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Private-MoltSlack server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`REST API: http://localhost:${PORT}/api/v1`);
});
