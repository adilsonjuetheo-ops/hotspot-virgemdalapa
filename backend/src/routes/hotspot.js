const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../config/database');
const { sendOTP, generateOTP } = require('../services/zenvia.service');
const { authorizeUser, getRouter } = require('../services/mikrotik.service');

const router = express.Router();

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas tentativas. Aguarde 10 minutos.' }
});

const connectLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas. Aguarde 10 minutos.' }
});

// DDDs válidos no Brasil
const VALID_DDDS = new Set([
  '11','12','13','14','15','16','17','18','19','21','22','24','27','28',
  '31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49',
  '51','53','54','55','61','62','63','64','65','66','67','68','69',
  '71','73','74','75','77','79','81','82','83','84','85','86','87','88','89',
  '91','92','93','94','95','96','97','98','99'
]);

// Celular brasileiro: 11 dígitos, DDD válido, nono dígito 9, sem sequência repetida
function isValidCellphone(digits) {
  if (digits.length !== 11) return false;
  if (!VALID_DDDS.has(digits.slice(0, 2))) return false;
  if (digits[2] !== '9') return false;
  if (/^(\d)\1+$/.test(digits.slice(2))) return false;
  return true;
}

// Configurações que podem ser expostas sem autenticação
const PUBLIC_SETTINGS = [
  'hotspot_title', 'hotspot_subtitle', 'hotspot_free_time',
  'otp_expiry_minutes', 'require_name', 'require_email',
  'otp_enabled', 'redirect_url'
];

// GET /api/hotspot/settings — retorna configurações públicas do portal
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => { if (PUBLIC_SETTINGS.includes(r.key)) settings[r.key] = r.value; });
  res.json(settings);
});

// POST /api/hotspot/send-otp — envia código SMS
router.post('/send-otp', otpLimiter, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefone obrigatório.' });

  const digits = phone.replace(/\D/g, '');
  if (!isValidCellphone(digits)) {
    return res.status(400).json({ error: 'Número de celular inválido. Confira o DDD e o número.' });
  }

  // Invalida OTPs anteriores do mesmo número
  db.prepare('UPDATE otp_codes SET used = 1 WHERE phone = ? AND used = 0').run(digits);

  const code = generateOTP();
  const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 5;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

  db.prepare('INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)').run(
    digits, code, expiresAt
  );

  try {
    await sendOTP(digits, code);
    res.json({ success: true, message: 'Código enviado com sucesso!' });
  } catch (error) {
    // Em desenvolvimento/teste, retorna o código no response
    if (process.env.NODE_ENV !== 'production') {
      return res.json({ success: true, message: 'SMS simulado (dev)', debug_code: code });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST /api/hotspot/connect — fluxo sem OTP: salva o lead e libera acesso direto
router.post('/connect', connectLimiter, async (req, res) => {
  const otpEnabled = db.prepare("SELECT value FROM settings WHERE key='otp_enabled'").get()?.value;
  if (otpEnabled === '1') {
    return res.status(400).json({ error: 'Validação por SMS obrigatória. Use o fluxo de código.' });
  }

  const { phone, name, email, mac, ip, router: routerId } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefone obrigatório.' });

  const digits = phone.replace(/\D/g, '');
  if (!isValidCellphone(digits)) {
    return res.status(400).json({ error: 'Número de celular inválido. Confira o DDD e o número.' });
  }

  const router = getRouter(parseInt(routerId) || null);

  const existingLead = db.prepare('SELECT id FROM leads WHERE phone = ?').get(digits);
  let leadId;

  if (existingLead) {
    db.prepare(`
      UPDATE leads SET name = COALESCE(?, name), email = COALESCE(?, email),
      mac_address = ?, ip_address = ?, router_id = ?, is_validated = 1
      WHERE id = ?
    `).run(name || null, email || null, mac || null, ip || null, router?.id || null, existingLead.id);
    leadId = existingLead.id;
  } else {
    const result = db.prepare(`
      INSERT INTO leads (name, phone, email, mac_address, ip_address, router_id, is_validated)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(name || null, digits, email || null, mac || null, ip || null, router?.id || null);
    leadId = result.lastInsertRowid;
  }

  const freeTime = parseInt(db.prepare("SELECT value FROM settings WHERE key='hotspot_free_time'").get()?.value) || 60;

  let mikrotikResult = null;
  try {
    mikrotikResult = await authorizeUser(router, mac, ip, digits, freeTime);
    db.prepare(`
      INSERT INTO sessions (lead_id, mac_address, ip_address, mikrotik_user, router_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(leadId, mac || null, ip || null, mikrotikResult?.username || null, router?.id || null);
  } catch (err) {
    console.error('Aviso MikroTik:', err.message);
    // Mesmo com erro no MikroTik, retorna sucesso para não bloquear o lead
  }

  res.json({
    success: true,
    message: 'Acesso liberado! Aproveite o Wi-Fi público da Prefeitura.',
    username: mikrotikResult?.username,
    password: mikrotikResult?.password,
    freeTimeMinutes: freeTime
  });
});

// POST /api/hotspot/verify — valida OTP e libera acesso
router.post('/verify', async (req, res) => {
  const { phone, code, name, email, mac, ip, router: routerId } = req.body;
  const mtRouter = getRouter(parseInt(routerId) || null);

  if (!phone || !code) {
    return res.status(400).json({ error: 'Telefone e código são obrigatórios.' });
  }

  const digits = phone.replace(/\D/g, '');
  const now = new Date().toISOString();

  const otpRecord = db.prepare(`
    SELECT * FROM otp_codes
    WHERE phone = ? AND code = ? AND used = 0 AND expires_at > ?
    ORDER BY id DESC LIMIT 1
  `).get(digits, code, now);

  if (!otpRecord) {
    return res.status(400).json({ error: 'Código inválido ou expirado.' });
  }

  // Marca OTP como usado
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otpRecord.id);

  // Salva/atualiza lead
  const existingLead = db.prepare('SELECT id FROM leads WHERE phone = ?').get(digits);
  let leadId;

  if (existingLead) {
    db.prepare(`
      UPDATE leads SET name = COALESCE(?, name), email = COALESCE(?, email),
      mac_address = ?, ip_address = ?, is_validated = 1
      WHERE id = ?
    `).run(name || null, email || null, mac || null, ip || null, existingLead.id);
    leadId = existingLead.id;
  } else {
    const result = db.prepare(`
      INSERT INTO leads (name, phone, email, mac_address, ip_address, is_validated)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(name || null, digits, email || null, mac || null, ip || null);
    leadId = result.lastInsertRowid;
  }

  // Autoriza no MikroTik
  const freeTime = parseInt(db.prepare("SELECT value FROM settings WHERE key='hotspot_free_time'").get()?.value) || 60;

  let mikrotikResult = null;
  try {
    mikrotikResult = await authorizeUser(mtRouter, mac, ip, digits, freeTime);
    db.prepare(`
      INSERT INTO sessions (lead_id, mac_address, ip_address, mikrotik_user, router_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(leadId, mac || null, ip || null, mikrotikResult?.username || null, mtRouter?.id || null);
  } catch (err) {
    console.error('Aviso MikroTik:', err.message);
    // Mesmo com erro no MikroTik, retorna sucesso para não bloquear o lead
  }

  res.json({
    success: true,
    message: 'Acesso liberado! Aproveite o Wi-Fi público da Prefeitura.',
    username: mikrotikResult?.username,
    password: mikrotikResult?.password,
    freeTimeMinutes: freeTime
  });
});

module.exports = router;
