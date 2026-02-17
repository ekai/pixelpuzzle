const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const geoip = require('geoip-lite');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Session config - 30 min inactivity = session ends, pixels lock
const SESSION_DURATION_MS = 30 * 60 * 1000;
const MAX_PIXELS_PER_DAY = 5;
const GRID_SIZE = 200;

// Database setup
const db = new Database('pixels.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS pixels (
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    color TEXT NOT NULL,
    session_id TEXT NOT NULL,
    ip TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    locked INTEGER DEFAULT 0,
    PRIMARY KEY (x, y)
  );

  CREATE INDEX IF NOT EXISTS idx_pixels_session ON pixels(session_id);
  CREATE INDEX IF NOT EXISTS idx_pixels_ip ON pixels(ip);

  CREATE TABLE IF NOT EXISTS daily_draws (
    ip TEXT NOT NULL,
    date TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (ip, date)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    ip TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_activity INTEGER NOT NULL
  );
`);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Get client IP (works with proxies)
app.set('trust proxy', 1);

function getClientIP(req) {
  return req.ip || req.connection.remoteAddress || 'unknown';
}

// Recent visitors log (in-memory, max 50)
const recentVisitors = [];
const MAX_VISITORS = 50;

function getGeoLocation(ip) {
  if (!ip || ip === 'unknown') return { city: 'Unknown', country: 'Unknown' };
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.')) {
    return { city: 'Local', country: 'localhost' };
  }
  const geo = geoip.lookup(ip);
  if (!geo) return { city: 'Unknown', country: 'Unknown' };
  return {
    city: geo.city || 'Unknown',
    country: geo.country || 'Unknown',
    region: geo.region
  };
}

function logVisitor(ip) {
  const last = recentVisitors[0];
  if (last && last.ip === ip && Date.now() - last.timestamp < 10000) return;
  const loc = getGeoLocation(ip);
  recentVisitors.unshift({
    ip,
    city: loc.city,
    country: loc.country,
    region: loc.region,
    timestamp: Date.now()
  });
  if (recentVisitors.length > MAX_VISITORS) recentVisitors.pop();
}

app.use(session({
  secret: 'pixel-canvas-secret-' + Math.random().toString(36),
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: SESSION_DURATION_MS,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Ensure session has our custom fields
app.use((req, res, next) => {
  if (!req.session.pixelSessionId) {
    req.session.pixelSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    req.session.createdAt = Date.now();
  }
  req.session.lastActivity = Date.now();
  next();
});

// API: Recent visitors with geo
app.get('/api/recent-visitors', (req, res) => {
  res.json(recentVisitors.map(v => ({
    city: v.city,
    country: v.country,
    region: v.region,
    time: v.timestamp
  })));
});

// API: Get full grid state
app.get('/api/grid', (req, res) => {
  logVisitor(getClientIP(req));
  const pixels = db.prepare(`
    SELECT x, y, color, locked FROM pixels
  `).all();
  
  const grid = {};
  pixels.forEach(p => {
    grid[`${p.x},${p.y}`] = { color: p.color, locked: !!p.locked };
  });
  
  res.json({ grid, size: GRID_SIZE });
});

// API: Get user's pixels and daily count
app.get('/api/me', (req, res) => {
  const ip = getClientIP(req);
  const sessionId = req.session.pixelSessionId;
  const today = new Date().toISOString().slice(0, 10);

  const myPixels = db.prepare(`
    SELECT x, y, color, locked FROM pixels
    WHERE session_id = ? AND ip = ?
  `).all(sessionId, ip);

  const dailyRow = db.prepare(`
    SELECT count FROM daily_draws WHERE ip = ? AND date = ?
  `).get(ip, today);

  const drawnToday = dailyRow ? dailyRow.count : 0;
  const remaining = Math.max(0, MAX_PIXELS_PER_DAY - drawnToday);

  res.json({
    sessionId,
    myPixels,
    drawnToday,
    remaining,
    maxPerDay: MAX_PIXELS_PER_DAY
  });
});

// Check if (x,y) is adjacent to any pixel in the list
function isAdjacent(x, y, pixels) {
  if (pixels.length === 0) return true;
  for (const p of pixels) {
    const dx = Math.abs(p.x - x);
    const dy = Math.abs(p.y - y);
    if (dx <= 1 && dy <= 1 && (dx !== 0 || dy !== 0)) return true;
  }
  return false;
}

// API: Place or update a pixel
app.post('/api/pixel', (req, res) => {
  const ip = getClientIP(req);
  const sessionId = req.session.pixelSessionId;
  const { x, y, color } = req.body;

  if (typeof x !== 'number' || typeof y !== 'number' || !color) {
    return res.status(400).json({ error: 'Invalid x, y, or color' });
  }

  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
    return res.status(400).json({ error: 'Pixel out of bounds' });
  }

  const hexColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#000000';

  const existing = db.prepare(`
    SELECT * FROM pixels WHERE x = ? AND y = ?
  `).get(x, y);

  const myPixels = db.prepare(`
    SELECT x, y, locked FROM pixels WHERE session_id = ? AND ip = ?
  `).all(sessionId, ip);

  const today = new Date().toISOString().slice(0, 10);
  const dailyRow = db.prepare(`
    SELECT count FROM daily_draws WHERE ip = ? AND date = ?
  `).get(ip, today);
  const drawnToday = dailyRow ? dailyRow.count : 0;

  // Case 1: Updating our own pixel (same session, not locked)
  if (existing && existing.session_id === sessionId && existing.ip === ip) {
    if (existing.locked) {
      return res.status(403).json({ error: 'Pixel is locked' });
    }
    db.prepare(`
      UPDATE pixels SET color = ? WHERE x = ? AND y = ?
    `).run(hexColor, x, y);
    return res.json({ success: true, action: 'updated' });
  }

  // Case 2: Placing new pixel
  if (existing) {
    return res.status(409).json({ error: 'Pixel already taken' });
  }

  if (drawnToday >= MAX_PIXELS_PER_DAY) {
    return res.status(429).json({ error: 'Daily limit reached (5 pixels per day)' });
  }

  if (myPixels.length >= MAX_PIXELS_PER_DAY) {
    return res.status(400).json({ error: 'You already have 5 pixels this session' });
  }

  if (!isAdjacent(x, y, myPixels)) {
    return res.status(400).json({
      error: 'Pixel must be adjacent to your existing pixels (including diagonally)'
    });
  }

  db.prepare(`
    INSERT INTO pixels (x, y, color, session_id, ip, created_at, locked)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(x, y, hexColor, sessionId, ip, Date.now());

  db.prepare(`
    INSERT INTO daily_draws (ip, date, count) VALUES (?, ?, 1)
    ON CONFLICT(ip, date) DO UPDATE SET count = count + 1
  `).run(ip, today);

  res.json({ success: true, action: 'placed' });
});

// API: Lock session (called when user explicitly ends session or on timeout)
app.post('/api/lock', (req, res) => {
  const sessionId = req.session.pixelSessionId;
  const ip = getClientIP(req);

  db.prepare(`
    UPDATE pixels SET locked = 1 WHERE session_id = ? AND ip = ?
  `).run(sessionId, ip);

  req.session.destroy();
  res.json({ success: true });
});

// Lock inactive sessions (run periodically)
function lockInactiveSessions() {
  const cutoff = Date.now() - SESSION_DURATION_MS;
  db.prepare(`
    UPDATE pixels SET locked = 1
    WHERE session_id IN (
      SELECT session_id FROM sessions WHERE last_activity < ?
    )
  `).run(cutoff);
  // We don't have a sessions table we're actively updating - we use express-session
  // So we need another approach: lock pixels whose session hasn't been seen
  // For simplicity, we'll lock based on a "last_activity" we could store in pixels
  // Actually - we're using express-session. The session expires on the server.
  // When a user comes back with an expired session, they get a new sessionId.
  // So old pixels with old sessionIds are effectively "orphaned" - we need to lock them.
  // The problem: we don't know when a session expired without storing it.
  // Simpler approach: store last_activity in a small table keyed by session_id.
  // On each /api/me or /api/pixel, update last_activity.
  // A cron job locks pixels where last_activity < cutoff.
}

// Update session activity
app.use('/api', (req, res, next) => {
  if (req.session && req.session.pixelSessionId) {
    db.prepare(`
      INSERT INTO sessions (session_id, ip, created_at, last_activity)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET last_activity = excluded.last_activity
    `).run(
      req.session.pixelSessionId,
      getClientIP(req),
      req.session.createdAt || Date.now(),
      Date.now()
    );
  }
  next();
});

// Cron: lock inactive sessions every minute
setInterval(() => {
  const cutoff = Date.now() - SESSION_DURATION_MS;
  db.prepare(`
    UPDATE pixels SET locked = 1
    WHERE locked = 0 AND session_id IN (
      SELECT session_id FROM sessions WHERE last_activity < ?
    )
  `).run(cutoff);
}, 60 * 1000);

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Pixel Canvas running at http://localhost:${PORT}`);
});
