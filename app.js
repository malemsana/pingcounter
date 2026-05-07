require('dotenv').config({ path: ['.env', '.emv'] });
const fastify = require('fastify')({ logger: false, trustProxy: true });
const { Pool } = require('pg');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Load Badge Templates
let badgeTemplates = {};
try {
  badgeTemplates = JSON.parse(fs.readFileSync('./assets/badgeTemplates.json', 'utf8'));
} catch (e) {
  console.error('[Error] Failed to load badgeTemplates.json', e);
}

/**
 * 🛠️ CONFIGURATION
 */
const config = {
  port: process.env.PORT || 3000,
  postgres: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_Wvxo1yK9XOAe@ep-solitary-breeze-a8g3ekc4-pooler.eastus2.azure.neon.tech/neondb?sslmode=verify-full',
  shards: 4,
  flushInterval: 20000
};

// --- Clients ---
fastify.register(require('@fastify/cors'), { origin: true, methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PATCH'] });
// Static files and UI routes have been removed for decoupled architecture

// Custom JSON parser to allow empty bodies
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try {
    const json = body ? JSON.parse(body) : {};
    done(null, json);
  } catch (err) {
    err.statusCode = 400;
    done(err, undefined);
  }
});

const pg = new Pool({
  connectionString: config.postgres,
  ssl: { rejectUnauthorized: false }
});

// --- In-Memory State ---
const pingBuffer = new Map();
const sessionCache = new NodeCache({ stdTTL: 3600 });
let rateLimiter = {};
setInterval(() => { rateLimiter = {}; }, 1000);

// Global Error Handler
fastify.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const statusCode = error.statusCode || 500;
  reply.status(statusCode).send({ error: error.code || 'internal_server_error', message: error.message });
});

// --- Caches ---
const identityCache = new NodeCache({ stdTTL: 3600 });
const nameRegex = /^[a-zA-Z0-9_-]{1,64}$/;

// --- Logic Helpers ---
function hashPassword(password) {
  return crypto.scryptSync(password, 'pingcounter_salt', 64).toString('hex');
}

async function authenticate(request, reply) {
  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'unauthorized' });
    return null;
  }
  const token = authHeader.split(' ')[1];
  
  let userId = sessionCache.get(token);
  if (!userId) {
    const res = await pg.query('SELECT user_id FROM sessions WHERE token = $1 AND expires_at > NOW()', [token]);
    if (res.rows.length === 0) {
      reply.status(401).send({ error: 'unauthorized' });
      return null;
    }
    userId = res.rows[0].user_id;
    sessionCache.set(token, userId);
  }
  return userId;
}

async function resolveIdentity(apiKey, projectName, eventName) {
  const cacheKey = `id:${apiKey}:${projectName}:${eventName}`;
  let cached = identityCache.get(cacheKey);
  if (cached) return cached;

  const keyRes = await pg.query(
    'SELECT ak.project_id, ak.rate_limit, ak.scopes, p.project_name, p.auto_approve, p.allowed_origins, p.allowed_ips FROM api_keys ak JOIN projects p ON ak.project_id = p.id WHERE ak.key = $1',
    [apiKey]
  );

  if (keyRes.rows.length === 0 || keyRes.rows[0].project_name !== projectName) return null;
  const {
    project_id: projectId,
    rate_limit: rateLimit,
    scopes: rawScopes,
    auto_approve: autoApprove,
    allowed_origins: allowedOrigins,
    allowed_ips: allowedIps
  } = keyRes.rows[0];

  const scopes = (rawScopes || 'ping').split(',').map(s => s.trim());

  let event;
  const evRes = await pg.query('SELECT id, status FROM events WHERE project_id = $1 AND event_name = $2', [projectId, eventName]);

  if (evRes.rows.length === 0) {
    const evCountRes = await pg.query('SELECT COUNT(*) as count FROM events WHERE project_id = $1', [projectId]);
    if (parseInt(evCountRes.rows[0].count) >= 100) return null;

    const status = autoApprove ? 'active' : 'pending';
    const newEv = await pg.query(
      'INSERT INTO events (project_id, event_name, status) VALUES ($1, $2, $3) RETURNING id, status',
      [projectId, eventName, status]
    );
    event = newEv.rows[0];
  } else {
    event = evRes.rows[0];
  }

  const identity = {
    projectId,
    eventId: event.id,
    status: event.status,
    rateLimit,
    scopes,
    allowedOrigins: allowedOrigins ? allowedOrigins.split(',').map(o => o.trim()) : null,
    allowedIps: allowedIps ? allowedIps.split(',').map(i => i.trim()) : null
  };
  identityCache.set(cacheKey, identity);
  return identity;
}

// --- Public Helpers ---
const badgeCache = new NodeCache({ stdTTL: 60 });

async function resolvePublicSlug(slug) {
  const cacheKey = `public:${slug}`;
  let cached = identityCache.get(cacheKey);
  if (cached) return cached;

  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) return null;

  const res = await pg.query('SELECT id, event_name FROM events WHERE public_slug = $1 AND public_event = true', [slug]);
  if (res.rows.length === 0) return null;

  const identity = { eventId: res.rows[0].id, eventName: res.rows[0].event_name };
  identityCache.set(cacheKey, identity);
  return identity;
}

function renderBadge(style, label, count) {
  const template = badgeTemplates[style] || badgeTemplates['classic'];
  const iconPath = '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>';
  const formattedCount = count.toLocaleString();

  const labelWidth = Math.max(50, label.length * 7.5);
  const countWidth = Math.max(30, formattedCount.toString().length * 8 + 30);
  const totalWidth = labelWidth + countWidth;

  const data = {
    labelWidth,
    countWidth,
    totalWidth,
    label,
    count: formattedCount,
    iconPath,
    labelCenterX: labelWidth / 2,
    countCenterX: labelWidth + (countWidth / 2),
    iconX: labelWidth + 4,
    countX: labelWidth + 24
  };

  let svg = template.svg;
  for (const [key, value] of Object.entries(data)) {
    svg = svg.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return svg;
}

// --- Ping Ingestion ---
const handlePing = async (request, reply) => {
  const { api_key, project, event } = request.params;

  if (!nameRegex.test(project) || !nameRegex.test(event)) {
    return reply.status(400).send({ error: "bad_request" });
  }

  const identity = await resolveIdentity(api_key, project, event);
  if (!identity) return reply.status(401).send({ error: "unauthorized" });

  // Security: Allowed Origins
  if (identity.allowedOrigins) {
    const origin = request.headers['origin'];
    if (!origin || !identity.allowedOrigins.some(o => origin.includes(o))) {
      return reply.status(403).send({ error: "forbidden", message: "Origin not allowed" });
    }
  }

  // Security: Allowed IPs
  if (identity.allowedIps) {
    const ip = request.ip;
    if (!identity.allowedIps.includes(ip)) {
      return reply.status(403).send({ error: "forbidden", message: "IP not allowed" });
    }
  }

  if (!identity.scopes.includes('ping') && !identity.scopes.includes('admin')) {
    return reply.status(403).send({ error: "forbidden", message: "Key lacks 'ping' scope" });
  }

  // Rate Limiting
  const limit = identity.rateLimit || 60;
  rateLimiter[api_key] = (rateLimiter[api_key] || 0) + 1;
  if (rateLimiter[api_key] > limit) {
    return reply.status(429).send({ error: "too_many_requests", message: "Rate limit exceeded" });
  }

  if (identity.status === 'active') {
    const key = identity.eventId;
    pingBuffer.set(key, (pingBuffer.get(key) || 0) + 1);
  } else if (identity.status === 'pending') {
    pg.query('UPDATE events SET pending_hits = pending_hits + 1 WHERE id = $1', [identity.eventId]);
  }

  return reply.status(204).send();
};

fastify.get('/p/:api_key/:project/:event', handlePing);
fastify.post('/p/:api_key/:project/:event', handlePing);

// --- Private Data API ---
fastify.get('/api/v1/data/:api_key/:project/:event', async (r, rp) => {
  const { api_key, project, event } = r.params;
  const identity = await resolveIdentity(api_key, project, event);
  if (!identity) return rp.status(401).send({ error: 'unauthorized' });

  // Security Rules
  if (identity.allowedOrigins) {
    const origin = r.headers['origin'];
    if (!origin || !identity.allowedOrigins.some(o => origin.includes(o))) {
      return rp.status(403).send({ error: "forbidden", message: "Origin not allowed" });
    }
  }
  if (identity.allowedIps) {
    if (!identity.allowedIps.includes(r.ip)) {
      return rp.status(403).send({ error: "forbidden", message: "IP not allowed" });
    }
  }

  if (!identity.scopes.includes('read') && !identity.scopes.includes('admin')) {
    return rp.status(403).send({ error: 'forbidden', message: "Key lacks 'read' scope" });
  }

  const data = await getEventData(identity.eventId, 30);
  return {
    project,
    event,
    total: data.total,
    today: data.today_total,
    live: data.live_today,
    history: data.history
  };
});

// --- Private Authenticated Badge API ---
fastify.get('/api/v1/badge/:api_key/:project/:event', async (r, rp) => {
  const { api_key, project, event } = r.params;
  const { style = 'classic', label } = r.query;
  
  const identity = await resolveIdentity(api_key, project, event);
  if (!identity) return rp.status(401).send({ error: 'unauthorized' });

  // Security Rules
  if (identity.allowedOrigins) {
    const origin = r.headers['origin'];
    if (!origin || !identity.allowedOrigins.some(o => origin.includes(o))) {
      return rp.status(403).send({ error: "forbidden", message: "Origin not allowed" });
    }
  }
  if (identity.allowedIps) {
    if (!identity.allowedIps.includes(r.ip)) {
      return rp.status(403).send({ error: "forbidden", message: "IP not allowed" });
    }
  }

  if (!identity.scopes.includes('read') && !identity.scopes.includes('admin')) {
    return rp.status(403).send({ error: 'forbidden', message: "Key lacks 'read' scope" });
  }

  const cacheKey = `auth_badge:${identity.eventId}:${style}:${label || ''}`;
  let svg = badgeCache.get(cacheKey);

  if (!svg) {
    const data = await getEventData(identity.eventId, 1);
    const badgeLabel = label || event;
    svg = renderBadge(style, badgeLabel, data.total);
    badgeCache.set(cacheKey, svg);
  }

  rp.header('Content-Type', 'image/svg+xml');
  rp.header('Cache-Control', 'private, max-age=60'); // Private cache
  return rp.send(svg);
});

// --- Auth ---
fastify.post('/auth/register', async (request, reply) => {
  const { email, password, full_name = '' } = request.body;
  if (!email || !password) return reply.status(400).send({ error: 'bad_request' });
  const hashed = hashPassword(password);
  try {
    const res = await pg.query('INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id, email, full_name', [email, hashed, full_name]);
    const token = crypto.randomBytes(32).toString('hex');
    await pg.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')", [token, res.rows[0].id]);
    sessionCache.set(token, res.rows[0].id);
    return { token, user: res.rows[0] };
  } catch (e) { return reply.status(409).send({ error: 'conflict' }); }
});

fastify.post('/auth/login', async (request, reply) => {
  const { email, password } = request.body;
  const hashed = hashPassword(password);
  const res = await pg.query('SELECT id, email FROM users WHERE email = $1 AND password_hash = $2', [email, hashed]);
  if (res.rows.length === 0) return reply.status(401).send({ error: 'unauthorized' });
  const token = crypto.randomBytes(32).toString('hex');
  await pg.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')", [token, res.rows[0].id]);
  sessionCache.set(token, res.rows[0].id);
  return { token, user: res.rows[0] };
});

// --- Management ---
fastify.get('/api/me', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const res = await pg.query('SELECT email, full_name FROM users WHERE id = $1', [uid]);
  return res.rows[0];
});

// --- Accounts ---
fastify.post('/api/account/profile', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const { full_name } = r.body;
  await pg.query('UPDATE users SET full_name = $1 WHERE id = $2', [full_name || '', uid]);
  return { success: true };
});

fastify.post('/api/account/password', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const { currentPassword, newPassword } = r.body;
  if (!currentPassword || !newPassword) return rp.status(400).send({ error: 'bad_request' });

  const currentHashed = hashPassword(currentPassword);
  const res = await pg.query('SELECT id FROM users WHERE id = $1 AND password_hash = $2', [uid, currentHashed]);
  if (res.rows.length === 0) return rp.status(401).send({ error: 'invalid_password' });

  const newHashed = hashPassword(newPassword);
  await pg.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHashed, uid]);
  return { success: true };
});

fastify.get('/api/account/usage', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;

  const projRes = await pg.query('SELECT id FROM projects WHERE user_id = $1', [uid]);
  const total_projects = projRes.rows.length;

  let total_pings = 0;
  if (total_projects > 0) {
    const projectIds = projRes.rows.map(p => p.id);
    const params = projectIds.map((_, i) => `$${i + 1}`).join(',');

    const countersRes = await pg.query(
      `SELECT SUM(c.count) as total FROM counters c JOIN events e ON c.event_id = e.id WHERE e.project_id IN (${params})`,
      projectIds
    );
    total_pings = parseInt(countersRes.rows[0].total || 0);

    const pendingRes = await pg.query(
      `SELECT SUM(pending_hits) as total FROM events WHERE project_id IN (${params})`,
      projectIds
    );
    total_pings += parseInt(pendingRes.rows[0].total || 0);

    const eventsRes = await pg.query(`SELECT id FROM events WHERE project_id IN (${params})`, projectIds);
    for (const ev of eventsRes.rows) {
      total_pings += (pingBuffer.get(ev.id) || 0);
    }
  }

  return {
    total_projects,
    total_pings,
    limits: {
      projects: 5,
      pings: 1000000
    }
  };
});

fastify.get('/api/projects', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const res = await pg.query('SELECT id, project_name FROM projects WHERE user_id = $1', [uid]);
  return res.rows;
});

/**
 * FIXED: Auto-generate the first API key when creating a project.
 */
fastify.post('/api/projects', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const { name } = r.body;
  if (!nameRegex.test(name)) return rp.status(400).send({ error: 'bad_request' });

  const projCount = await pg.query('SELECT COUNT(*) as count FROM projects WHERE user_id = $1', [uid]);
  if (parseInt(projCount.rows[0].count) >= 5) {
    return rp.status(403).send({ error: 'forbidden', message: 'Project limit reached (max 5)' });
  }

  try {
    const res = await pg.query('INSERT INTO projects (user_id, project_name) VALUES ($1, $2) RETURNING id, project_name', [uid, name]);
    const projectId = res.rows[0].id;

    // Auto-create first key
    const key = `pc_${crypto.randomBytes(32).toString('hex')}`;
    await pg.query('INSERT INTO api_keys (project_id, key, rate_limit, scopes) VALUES ($1, $2, $3, $4)', [projectId, key, 60, 'admin']);

    return res.rows[0];
  } catch (e) { return rp.status(409).send({ error: 'conflict' }); }
});

fastify.delete('/api/projects/:project', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const pName = r.params.project;

  // Verify ownership
  const proj = await pg.query('SELECT id FROM projects WHERE user_id = $1 AND project_name = $2', [uid, pName]);
  if (proj.rows.length === 0) return rp.status(404).send({ error: 'not_found' });
  const pid = proj.rows[0].id;

  // Manual cascade due to app-level requirements or safe-keeping if FKs aren't set to CASCADE
  // In our schema (app.js:20), they ARE set to CASCADE, but being explicit is fine.
  await pg.query('DELETE FROM projects WHERE id = $1', [pid]);

  identityCache.flushAll();
  return { success: true };
});

fastify.get('/api/badge-templates', async (r, rp) => {
  return Object.keys(badgeTemplates);
});

fastify.get('/api/badge-preview', async (r, rp) => {
  const { style, label, count } = r.query;
  const svg = renderBadge(style || 'classic', label || 'Ping', parseInt(count) || 0);
  return rp.type('image/svg+xml').send(svg);
});

fastify.get('/api/projects/:project/settings', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const res = await pg.query(
    'SELECT project_name, auto_approve, allowed_origins, allowed_ips FROM projects WHERE user_id = $1 AND project_name = $2',
    [uid, r.params.project]
  );
  if (!res.rows[0]) return rp.status(404).send({ error: 'not_found' });
  return res.rows[0];
});

fastify.put('/api/projects/:project/settings', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const { auto_approve, allowed_origins, allowed_ips } = r.body;
  
  const res = await pg.query(
    'UPDATE projects SET auto_approve = $1, allowed_origins = $2, allowed_ips = $3 WHERE user_id = $4 AND project_name = $5 RETURNING project_name',
    [auto_approve, allowed_origins, allowed_ips, uid, r.params.project]
  );
  
  if (res.rowCount === 0) return rp.status(404).send({ error: 'not_found' });
  identityCache.flushAll();
  return { success: true };
});

fastify.get('/api/projects/:project/overview', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const pName = r.params.project;

  const proj = await pg.query('SELECT id FROM projects WHERE user_id = $1 AND project_name = $2', [uid, pName]);
  if (!proj.rows[0]) return rp.status(404).send({ error: 'not_found' });
  const pid = proj.rows[0].id;

  try {
    const [evStats, keyStats] = await Promise.all([
      pg.query('SELECT status, COUNT(*) as count FROM events WHERE project_id = $1 GROUP BY status', [pid]),
      pg.query('SELECT COUNT(*) as count FROM api_keys WHERE project_id = $1', [pid])
    ]);

    return {
      total_active_events: parseInt(evStats.rows.find(row => row.status === 'active')?.count || 0),
      total_pending_events: parseInt(evStats.rows.find(row => row.status === 'pending')?.count || 0),
      total_keys: parseInt(keyStats.rows[0]?.count || 0)
    };
  } catch (err) {
    r.log.error(err);
    throw err;
  }
});

// --- Keys ---
fastify.get('/api/projects/:project/keys', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const res = await pg.query(
    'SELECT ak.key, ak.rate_limit, ak.scopes, ak.created_at FROM api_keys ak JOIN projects p ON ak.project_id = p.id WHERE p.user_id = $1 AND p.project_name = $2',
    [uid, r.params.project]
  );
  return res.rows;
});

fastify.post('/api/projects/:project/keys', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const proj = await pg.query('SELECT id FROM projects WHERE user_id = $1 AND project_name = $2', [uid, r.params.project]);
  if (!proj.rows[0]) return rp.status(404).send({ error: 'not_found' });

  const key = `pc_${crypto.randomBytes(32).toString('hex')}`;
  const limit = r.body?.rate_limit || 60;
  const scopes = r.body?.scopes || 'ping';

  await pg.query('INSERT INTO api_keys (project_id, key, rate_limit, scopes) VALUES ($1, $2, $3, $4)', [proj.rows[0].id, key, limit, scopes]);
  return { key, rate_limit: limit, scopes };
});

fastify.put('/api/projects/:project/keys/:key', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const proj = await pg.query('SELECT id FROM projects WHERE user_id = $1 AND project_name = $2', [uid, r.params.project]);
  if (!proj.rows[0]) return rp.status(404).send({ error: 'not_found' });

  const scopes = r.body?.scopes || 'ping';

  const res = await pg.query(
    'UPDATE api_keys SET scopes = $1 WHERE project_id = $2 AND key = $3 RETURNING *',
    [scopes, proj.rows[0].id, r.params.key]
  );

  if (!res.rows[0]) return rp.status(404).send({ error: 'not_found' });
  identityCache.flushAll();
  return { success: true };
});

fastify.delete('/api/projects/:project/keys/:key', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const proj = await pg.query('SELECT id FROM projects WHERE user_id = $1 AND project_name = $2', [uid, r.params.project]);
  if (!proj.rows[0]) return rp.status(404).send({ error: 'not_found' });

  const res = await pg.query(
    'DELETE FROM api_keys WHERE project_id = $1 AND key = $2 RETURNING key',
    [proj.rows[0].id, r.params.key]
  );
  if (!res.rows[0]) return rp.status(404).send({ error: 'not_found' });
  identityCache.flushAll();
  return { success: true };
});

// --- Events Management ---
fastify.get('/api/projects/:project/events', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const res = await pg.query(
    'SELECT e.id, e.event_name, e.status, e.pending_hits, e.public_event, e.public_slug FROM events e JOIN projects p ON e.project_id = p.id WHERE p.user_id = $1 AND p.project_name = $2 ORDER BY e.created_at DESC',
    [uid, r.params.project]
  );
  return res.rows;
});

fastify.post('/api/projects/:project/events', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const { event_name } = r.body;
  if (!event_name || !nameRegex.test(event_name)) {
    return rp.status(400).send({ error: 'bad_request', message: 'Invalid or missing event name' });
  }

  const proj = await pg.query('SELECT id FROM projects WHERE user_id = $1 AND project_name = $2', [uid, r.params.project]);
  if (!proj.rows[0]) return rp.status(404).send({ error: 'not_found' });

  const evCountRes = await pg.query('SELECT COUNT(*) as count FROM events WHERE project_id = $1', [proj.rows[0].id]);
  if (parseInt(evCountRes.rows[0].count) >= 100) {
    return rp.status(403).send({ error: 'forbidden', message: 'Event limit reached (max 100)' });
  }

  try {
    const res = await pg.query(
      'INSERT INTO events (project_id, event_name, status) VALUES ($1, $2, $3) RETURNING id, event_name, status',
      [proj.rows[0].id, event_name, 'active']
    );
    identityCache.flushAll();
    return res.rows[0];
  } catch (e) {
    if (e.code === '23505') {
      return rp.status(409).send({ error: 'conflict', message: 'Event already exists' });
    }
    throw e;
  }
});

fastify.post('/api/projects/:project/events/:event/approve', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;

  const evRes = await pg.query(
    'SELECT e.id, e.pending_hits FROM events e JOIN projects p ON e.project_id = p.id WHERE p.user_id = $1 AND p.project_name = $2 AND e.event_name = $3',
    [uid, r.params.project, r.params.event]
  );

  if (evRes.rowCount === 0) return rp.status(404).send({ error: 'not_found' });
  const event = evRes.rows[0];
  const hitsToMigrate = parseInt(event.pending_hits || 0);

  if (hitsToMigrate > 0) {
    const today = new Date().toISOString().split('T')[0];
    await pg.query(
      'INSERT INTO counters (event_id, date, count) VALUES ($1, $2, $3) ON CONFLICT (event_id, date) DO UPDATE SET count = counters.count + EXCLUDED.count',
      [event.id, today, hitsToMigrate]
    );
  }

  await pg.query(
    'UPDATE events SET status = $1, pending_hits = 0 WHERE id = $2',
    ['active', event.id]
  );

  identityCache.flushAll();
  return { success: true };
});

/**
 * NEW: Toggle Public Event feature
 */
fastify.post('/api/projects/:project/events/:event/public', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const { isPublic } = r.body;

  let slug = null;
  if (isPublic) {
    slug = `${r.params.project}-${r.params.event}-${crypto.randomBytes(3).toString('hex')}`.toLowerCase();
  }

  const res = await pg.query(
    'UPDATE events e SET public_event = $1, public_slug = $2 FROM projects p WHERE e.project_id = p.id AND p.user_id = $3 AND p.project_name = $4 AND e.event_name = $5 RETURNING public_slug',
    [isPublic, slug, uid, r.params.project, r.params.event]
  );

  if (res.rowCount === 0) return rp.status(404).send({ error: 'not_found' });
  identityCache.flushAll();
  return { success: true, slug: res.rows[0].public_slug };
});

fastify.delete('/api/projects/:project/events/:event', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const res = await pg.query(
    'DELETE FROM events WHERE id IN (SELECT e.id FROM events e JOIN projects p ON e.project_id = p.id WHERE p.user_id = $1 AND p.project_name = $2 AND e.event_name = $3)',
    [uid, r.params.project, r.params.event]
  );
  if (res.rowCount === 0) return rp.status(404).send({ error: 'not_found' });
  return { success: true };
});

// --- Stats Helper ---
async function getEventData(eid, days = 30) {
  const totalRes = await pg.query('SELECT SUM(count) as total FROM counters WHERE event_id = $1', [eid]);
  const historyTotal = parseInt(totalRes.rows[0].total || 0);

  const historyData = await pg.query(`
    SELECT to_char(date, 'YYYY-MM-DD') as date, count 
    FROM counters 
    WHERE event_id = $1 AND date >= CURRENT_DATE - $2::integer
    ORDER BY date ASC 
  `, [eid, days - 1]);

  let history = historyData.rows.map(row => ({ date: row.date, count: parseInt(row.count) }));

  const today = new Date().toISOString().split('T')[0];
  const live = pingBuffer.get(eid) || 0;

  const todayIndex = history.findIndex(h => h.date === today);
  const dbToday = todayIndex > -1 ? history[todayIndex].count : 0;
  const todayTotal = dbToday + live;

  if (live > 0) {
    if (todayIndex > -1) {
      history[todayIndex].count += live;
    } else {
      history.push({ date: today, count: live });
    }
  }

  return { total: historyTotal + live, live_today: live, today_total: todayTotal, history };
}

// --- Stats Endpoint ---
fastify.get('/api/projects/:project/events/:event/stats', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const ev = await pg.query(
    'SELECT e.id FROM events e JOIN projects p ON e.project_id = p.id WHERE p.user_id = $1 AND p.project_name = $2 AND e.event_name = $3',
    [uid, r.params.project, r.params.event]
  );
  if (!ev.rows[0]) return rp.status(404).send({ error: 'not_found' });

  const eid = ev.rows[0].id;
  const days = parseInt(r.query.days) || 30;

  return await getEventData(eid, days);
});

fastify.get('/api/projects/:project/events/:event/history', async (r, rp) => {
  const uid = await authenticate(r, rp); if (!uid) return;
  const ev = await pg.query(
    'SELECT e.id FROM events e JOIN projects p ON e.project_id = p.id WHERE p.user_id = $1 AND p.project_name = $2 AND e.event_name = $3',
    [uid, r.params.project, r.params.event]
  );
  if (!ev.rows[0]) return rp.status(404).send({ error: 'not_found' });
  const data = await getEventData(ev.rows[0].id, 30);
  return { history: data.history };
});

// --- Public Endpoints ---
fastify.get('/public/:slug', async (r, rp) => {
  const identity = await resolvePublicSlug(r.params.slug);
  if (!identity) return rp.status(404).send({ error: 'not_found' });
  const data = await getEventData(identity.eventId, 30);
  return { event: identity.eventName, ...data };
});

fastify.get('/badge/:slug', async (r, rp) => {
  const { style = 'classic', label } = r.query;
  const slug = r.params.slug;
  const cacheKey = `badge:${slug}:${style}:${label || ''}`;
  let svg = badgeCache.get(cacheKey);

  if (!svg) {
    const identity = await resolvePublicSlug(slug);
    if (!identity) return rp.status(404).send({ error: 'not_found' });
    const data = await getEventData(identity.eventId, 1);
    const badgeLabel = label || identity.eventName;
    svg = renderBadge(style, badgeLabel, data.total);
    badgeCache.set(cacheKey, svg);
  }

  rp.header('Content-Type', 'image/svg+xml');
  rp.header('Cache-Control', 'public, max-age=60');
  return rp.send(svg);
});

// --- Background Flush Worker ---
async function runWorker() {
  try {
    if (pingBuffer.size > 0) {
      const batch = new Map(pingBuffer);
      pingBuffer.clear();
      
      const today = new Date().toISOString().split('T')[0];
      for (const [eid, count] of batch.entries()) {
        await pg.query('INSERT INTO counters (event_id, date, count) VALUES ($1, $2, $3) ON CONFLICT (event_id, date) DO UPDATE SET count = counters.count + EXCLUDED.count', [eid, today, count]);
      }
    }
  } catch (e) { console.error('Worker Error:', e); }
  setTimeout(runWorker, config.flushInterval);
}

// --- Graceful Shutdown ---
async function gracefulShutdown() {
  console.log('\n[System] Shutting down... flushing ping buffer.');
  if (pingBuffer.size > 0) {
    const today = new Date().toISOString().split('T')[0];
    for (const [eid, count] of pingBuffer.entries()) {
      try {
        await pg.query('INSERT INTO counters (event_id, date, count) VALUES ($1, $2, $3) ON CONFLICT (event_id, date) DO UPDATE SET count = counters.count + EXCLUDED.count', [eid, today, count]);
      } catch (e) { console.error('Shutdown flush error:', e); }
    }
  }
  console.log('[System] Shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// --- Start Server ---
fastify.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
  if (err) process.exit(1);
  console.log(`Ping Counter API listening on ${config.port}`);
  runWorker();
});