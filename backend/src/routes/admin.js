const express = require('express');
const { db } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { getActiveSessions, disconnectUser, testConnection, updateAllUserProfiles, getRouter } = require('../services/mikrotik.service');

const router = express.Router();
router.use(requireAuth);

// GET /api/admin/dashboard
router.get('/dashboard', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const totalLeads = db.prepare('SELECT COUNT(*) as count FROM leads WHERE is_validated = 1').get();
  const todayLeads = db.prepare("SELECT COUNT(*) as count FROM leads WHERE is_validated = 1 AND DATE(created_at) = ?").get(today);
  const thisMonthLeads = db.prepare("SELECT COUNT(*) as count FROM leads WHERE is_validated = 1 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')").get();
  const totalSessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get();

  // Leads por dia (últimos 7 dias)
  const dailyLeads = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM leads WHERE is_validated = 1
    AND created_at >= datetime('now', '-7 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();

  res.json({
    totalLeads: totalLeads.count,
    todayLeads: todayLeads.count,
    thisMonthLeads: thisMonthLeads.count,
    totalSessions: totalSessions.count,
    dailyLeads
  });
});

// GET /api/admin/leads
router.get('/leads', (req, res) => {
  const { page = 1, limit = 50, search = '', startDate, endDate } = req.query;
  const offset = (page - 1) * limit;

  let where = 'WHERE is_validated = 1';
  const params = [];

  if (search) {
    where += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (startDate) {
    where += ' AND DATE(created_at) >= ?';
    params.push(startDate);
  }
  if (endDate) {
    where += ' AND DATE(created_at) <= ?';
    params.push(endDate);
  }

  const total = db.prepare(`SELECT COUNT(*) as count FROM leads ${where}`).get(...params);
  const leads = db.prepare(`
    SELECT id, name, phone, email, mac_address, ip_address, created_at,
      (SELECT r.name FROM routers r WHERE r.id = leads.router_id) as router_name
    FROM leads ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ leads, total: total.count, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/admin/leads/export — exporta CSV
router.get('/leads/export', (req, res) => {
  const leads = db.prepare(`
    SELECT name, phone, email, mac_address, ip_address, created_at
    FROM leads WHERE is_validated = 1
    ORDER BY created_at DESC
  `).all();

  const headers = 'Nome,Telefone,Email,MAC,IP,Data Cadastro\n';
  const rows = leads.map(l =>
    `"${l.name || ''}","${l.phone}","${l.email || ''}","${l.mac_address || ''}","${l.ip_address || ''}","${l.created_at}"`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads_virgemdalapa.csv"');
  res.send('﻿' + headers + rows); // BOM para Excel reconhecer UTF-8
});

// GET /api/admin/sessions
router.get('/sessions', async (req, res) => {
  const dbSessions = db.prepare(`
    SELECT s.*, l.name, l.phone, l.email, r.name as router_name
    FROM sessions s
    LEFT JOIN leads l ON s.lead_id = l.id
    LEFT JOIN routers r ON s.router_id = r.id
    ORDER BY s.started_at DESC
    LIMIT 100
  `).all();

  let mikrotikSessions = [];
  try {
    mikrotikSessions = await getActiveSessions();
  } catch (_) {}

  res.json({ sessions: dbSessions, activeSessions: mikrotikSessions });
});

// DELETE /api/admin/sessions/:mac — desconecta usuário
router.delete('/sessions/:mac', async (req, res) => {
  try {
    await disconnectUser(req.params.mac);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/settings
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

// PUT /api/admin/settings
router.put('/settings', async (req, res) => {
  const allowed = [
    'hotspot_title', 'hotspot_subtitle', 'hotspot_free_time', 'redirect_url',
    'rate_limit_down', 'rate_limit_up', 'mac_cookie_days',
    'otp_expiry_minutes', 'zenvia_from', 'require_name', 'require_email',
    'mikrotik_host', 'mikrotik_port', 'mikrotik_user', 'mikrotik_password',
    'mikrotik_hotspot_server', 'zenvia_token'
  ];

  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  const updateMany = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      if (allowed.includes(key) && value !== undefined) {
        update.run(key, String(value));
        // Atualiza variáveis de ambiente em memória para MikroTik/Zenvia
        const envMap = {
          mikrotik_host: 'MIKROTIK_HOST',
          mikrotik_port: 'MIKROTIK_PORT',
          mikrotik_user: 'MIKROTIK_USER',
          mikrotik_password: 'MIKROTIK_PASSWORD',
          mikrotik_hotspot_server: 'MIKROTIK_HOTSPOT_SERVER',
          zenvia_token: 'ZENVIA_TOKEN',
          zenvia_from: 'ZENVIA_FROM',
          otp_expiry_minutes: 'OTP_EXPIRY_MINUTES',
          hotspot_free_time: 'HOTSPOT_FREE_TIME'
        };
        if (envMap[key]) process.env[envMap[key]] = String(value);
      }
    }
  });

  updateMany(req.body);

  // Se velocidade ou reconexão mudaram, aplica no perfil do MikroTik na hora
  let message = 'Configurações salvas.';
  const profileKeys = ['rate_limit_down', 'rate_limit_up', 'mac_cookie_days'];
  if (profileKeys.some(k => req.body[k] !== undefined)) {
    const getSetting = (key, fallback) => parseInt(db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value) || fallback;
    const down = Math.min(Math.max(getSetting('rate_limit_down', 5), 1), 1000);
    const up = Math.min(Math.max(getSetting('rate_limit_up', 5), 1), 1000);
    const days = Math.min(Math.max(getSetting('mac_cookie_days', 3), 1), 30);
    const results = await updateAllUserProfiles({ rateLimit: `${up}M/${down}M`, macCookieDays: days });
    const ok = results.filter(r => r.success).map(r => r.router);
    const fail = results.filter(r => !r.success).map(r => `${r.router} (${r.error})`);
    message = `Configurações salvas. ${down} Mega down / ${up} Mega up, reconexão por ${days} dia(s).`;
    if (ok.length) message += ` Aplicado em: ${ok.join(', ')}.`;
    if (fail.length) message += ` Falhou em: ${fail.join(', ')}.`;
  }

  res.json({ success: true, message });
});

// ===================== ROTEADORES (MULTI-MIKROTIK) =====================

// GET /api/admin/routers — lista (sem expor a senha)
router.get('/routers', (req, res) => {
  const routers = db.prepare(`
    SELECT id, name, host, port, username, hotspot_server, user_profile, active, created_at
    FROM routers ORDER BY id
  `).all();
  res.json({ routers });
});

// POST /api/admin/routers — adiciona
router.post('/routers', (req, res) => {
  const { name, host, port, username, password, hotspot_server, user_profile } = req.body;
  if (!name || !host || !username || !password) {
    return res.status(400).json({ error: 'Nome, IP, usuário e senha são obrigatórios.' });
  }
  const result = db.prepare(`
    INSERT INTO routers (name, host, port, username, password, hotspot_server, user_profile)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, host, parseInt(port) || 8728, username, password,
    hotspot_server || 'hotspot1', user_profile || 'virgemdalapa-default');
  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/admin/routers/:id — edita (senha só se enviada)
router.put('/routers/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Roteador não encontrado.' });
  const { name, host, port, username, password, hotspot_server, user_profile, active } = req.body;
  db.prepare(`
    UPDATE routers SET name = ?, host = ?, port = ?, username = ?, password = ?,
    hotspot_server = ?, user_profile = ?, active = ? WHERE id = ?
  `).run(
    name || existing.name,
    host || existing.host,
    parseInt(port) || existing.port,
    username || existing.username,
    password || existing.password,
    hotspot_server || existing.hotspot_server,
    user_profile || existing.user_profile,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    req.params.id
  );
  res.json({ success: true });
});

// DELETE /api/admin/routers/:id
router.delete('/routers/:id', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM routers').get();
  if (total.count <= 1) {
    return res.status(400).json({ error: 'Não é possível remover o único MikroTik cadastrado.' });
  }
  db.prepare('DELETE FROM routers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/admin/routers/:id/test — testa conexão de um roteador
router.post('/routers/:id/test', async (req, res) => {
  const mtRouter = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id);
  const result = await testConnection(mtRouter);
  res.json(result);
});

// POST /api/admin/mikrotik/test — testa o roteador padrão (compatibilidade)
router.post('/mikrotik/test', async (req, res) => {
  const result = await testConnection(getRouter(null));
  res.json(result);
});

// DELETE /api/admin/leads/:id
router.delete('/leads/:id', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE lead_id = ?').run(req.params.id);
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
