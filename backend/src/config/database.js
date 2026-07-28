const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '../../data/hotspot.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      mac_address TEXT,
      ip_address TEXT,
      hotspot_server TEXT,
      is_validated INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      mac_address TEXT,
      ip_address TEXT,
      mikrotik_user TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      FOREIGN KEY (lead_id) REFERENCES leads(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS routers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 8728,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      hotspot_server TEXT DEFAULT 'hotspot1',
      user_profile TEXT DEFAULT 'virgemdalapa-default',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Colunas novas em bancos antigos (ignora se já existem)
  try { db.exec('ALTER TABLE leads ADD COLUMN router_id INTEGER'); } catch (_) {}
  try { db.exec('ALTER TABLE sessions ADD COLUMN router_id INTEGER'); } catch (_) {}

  // Migra o MikroTik do .env para a tabela na primeira execução
  const routerCount = db.prepare('SELECT COUNT(*) as count FROM routers').get();
  if (routerCount.count === 0 && process.env.MIKROTIK_HOST) {
    db.prepare(`
      INSERT INTO routers (name, host, port, username, password, hotspot_server, user_profile)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Principal',
      process.env.MIKROTIK_HOST,
      parseInt(process.env.MIKROTIK_PORT) || 8728,
      process.env.MIKROTIK_USER || 'admin',
      process.env.MIKROTIK_PASSWORD || '',
      process.env.MIKROTIK_HOTSPOT_SERVER || 'hotspot1',
      process.env.MIKROTIK_USER_PROFILE || 'default'
    );
    console.log('MikroTik principal migrado do .env para a tabela routers.');
  }

  // Insere configurações padrão
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);
  insertSetting.run('hotspot_title', 'Acesse o Wi-Fi Grátis');
  insertSetting.run('hotspot_subtitle', 'Conecte-se agora e aproveite a internet pública da Prefeitura!');
  insertSetting.run('hotspot_free_time', '60');
  insertSetting.run('otp_expiry_minutes', '5');
  insertSetting.run('zenvia_from', 'VirgemLapa');
  insertSetting.run('require_name', '1');
  insertSetting.run('require_email', '0');
  insertSetting.run('otp_enabled', process.env.OTP_ENABLED === '1' ? '1' : '0');
  insertSetting.run('redirect_url', 'https://www.instagram.com/prefeituradevirgemdalapa?igsh=MXVwMXdmcjF0ZXdoYQ==');
  insertSetting.run('rate_limit_down', '5');
  insertSetting.run('rate_limit_up', '5');
  insertSetting.run('mac_cookie_days', '3');

  // Cria admin padrão se não existir
  const adminExists = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(
    process.env.ADMIN_USERNAME || 'admin'
  );
  if (!adminExists) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'trocar@123', 10);
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(
      process.env.ADMIN_USERNAME || 'admin',
      hash
    );
    console.log('Admin padrão criado:', process.env.ADMIN_USERNAME || 'admin');
  }

  console.log('Banco de dados inicializado.');
}

module.exports = { db, initDatabase };
