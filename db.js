'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'hamada.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  token TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES providers(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT,
  joined_at TEXT NOT NULL,
  orders_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  plate TEXT NOT NULL DEFAULT '',
  rating REAL NOT NULL DEFAULT 4.8,
  is_connected INTEGER NOT NULL DEFAULT 0,
  subscription_active INTEGER NOT NULL DEFAULT 1,
  subscription_start TEXT,
  subscription_end TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT,
  documents TEXT NOT NULL DEFAULT '[]',
  payment_method TEXT NOT NULL DEFAULT '',
  payment_confirmed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT 'delivery',
  from_area TEXT NOT NULL,
  to_area TEXT NOT NULL,
  km REAL NOT NULL DEFAULT 0,
  base REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  payment_method TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  type_index INTEGER NOT NULL DEFAULT 1,
  provider_id INTEGER,
  provider_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);

function nowIso() {
  return new Date().toISOString();
}

function migrate() {
  const columns = (table) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(rows.map((r) => r.name));
  };

  const addColumn = (table, name, ddl) => {
    if (!columns(table).has(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    }
  };

  addColumn('customers', 'password_hash', 'TEXT');
  addColumn('customers', 'blocked', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('customers', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('subscription_requests', 'password_hash', 'TEXT');
  addColumn('subscription_requests', 'device_id', "TEXT NOT NULL DEFAULT ''");
  addColumn('providers', 'blocked', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('orders', 'description', "TEXT NOT NULL DEFAULT ''");
  addColumn('orders', 'type_index', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('orders', 'customer_phone', "TEXT NOT NULL DEFAULT ''");

  const nullCustomers = db.prepare('SELECT COUNT(*) AS c FROM customers WHERE password_hash IS NULL').get().c;
  if (nullCustomers > 0) {
    db.prepare('UPDATE customers SET password_hash = ? WHERE password_hash IS NULL').run(
      hashPassword('12345678')
    );
    console.log(`Migration: تم تعيين كلمة مرور افتراضية (12345678) لـ ${nullCustomers} زبون موجود.`);
  }
}

function addActivity(adminName, action, target = '') {
  db.prepare(
    'INSERT INTO activity_log (admin_name, action, target, created_at) VALUES (?, ?, ?, ?)'
  ).run(adminName, action, target, nowIso());
}

function seed() {
  const adminCount = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
  if (adminCount > 0) return;

  const t = nowIso();

  db.prepare(
    'INSERT INTO admins (username, password_hash, full_name, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('admin', hashPassword('admin123'), 'مدير النظام', 'owner', t);

  const customers = [
    ['زبون حماده', '+222 33 123 45 67', '2026-01-15', 4],
    ['زينب منت عبدي', '+222 46 111 22 33', '2026-02-03', 2],
    ['محمد سالم', '+222 22 555 66 77', '2026-03-20', 1],
    ['خديجة بنت الشيخ', '+222 33 777 88 99', '2026-04-11', 3],
    ['عبد الرحمن', '+222 46 444 55 66', '2026-05-02', 0],
  ];
  const insC = db.prepare(
    'INSERT INTO customers (name, phone, password_hash, joined_at, orders_count) VALUES (?, ?, ?, ?, ?)'
  );
  for (const c of customers) insC.run(c[0], c[1], hashPassword('12345678'), c[2], c[3]);

  const providers = [
    ['أحمد ولد محمد', '+222 33 123 45 67', '35-4412', 4.8, 1, 1, '2026-01-01', '2027-01-01', '2025-12-20'],
    ['سيدي محمد', '+222 46 222 33 44', '44-1020', 4.6, 0, 1, '2026-02-01', '2027-02-01', '2026-01-25'],
    ['فاطمة منت احمد', '+222 22 999 00 11', '51-7719', 4.9, 1, 0, '2026-06-01', '2026-12-01', '2026-05-28'],
  ];
  const insP = db.prepare(
    `INSERT INTO providers
     (name, phone, password_hash, plate, rating, is_connected, subscription_active,
      subscription_start, subscription_end, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const p of providers) {
    insP.run(p[0], p[1], hashPassword('pass1234'), p[2], p[3], p[4], p[5], p[6], p[7], p[8]);
  }

  const requests = [
    ['علي ولد ابيه', '+222 33 555 11 22', 'bim'],
    ['مريم بنت يوسف', '+222 46 333 44 55', 'sadad'],
    ['ابراهيم', '+222 22 123 44 55', 'bankily'],
    ['سالم ولد خليفه', '+222 33 888 99 00', 'masrivi'],
  ];
  const docCategories = ['personal', 'id', 'registration', 'insurance', 'payment'];
  const insR = db.prepare(
    `INSERT INTO subscription_requests
     (name, phone, password_hash, device_id, documents, payment_method, payment_confirmed, status, review_note,
      reviewed_by, reviewed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let i = 0; i < requests.length; i++) {
    const [name, phone, pm] = requests[i];
    const docs = docCategories.map((cat) => ({
      category: cat,
      file: `${cat}_upload_${i + 1}.jpg`,
      status: 'accepted',
    }));
    let status = 'pending';
    let note = '';
    let reviewedBy = '';
    let reviewedAt = null;
    if (i === 1) {
      status = 'approved';
      note = 'تم التحقق من الوثائق والدفع';
      reviewedBy = 'مدير النظام';
      reviewedAt = t;
    } else if (i === 2) {
      status = 'rejected';
      note = 'إيصال الدفع غير واضح';
      reviewedBy = 'مدير النظام';
      reviewedAt = t;
    }
    insR.run(name, phone, hashPassword('pass1234'), `seed-device-${i + 1}`, JSON.stringify(docs), pm, 1, status, note, reviewedBy, reviewedAt, t);
  }

  const orders = [
    ['زبون حماده', 'تيارت', 'لكصر', 4.5, 150, 25, 262.5, 'new', 'bankily'],
    ['زينب منت عبدي', 'عرفات', 'الميناء', 6.2, 250, 25, 405, 'new', 'masrivi'],
    ['خديجة بنت الشيخ', 'لكصر', 'الرياض', 8.0, 100, 25, 300, 'accepted', 'sadad'],
    ['محمد سالم', 'توجنين', 'سبخة', 3.1, 150, 25, 227.5, 'en_route', 'bim'],
    ['زبون حماده', 'الميناء', 'تيارت', 5.5, 100, 25, 237.5, 'completed', 'bankily', '2026-08-15T10:30:00.000Z'],
    ['زينب منت عبدي', 'دار النعيم', 'عرفات', 7.7, 250, 25, 442.5, 'completed', 'masrivi', '2026-08-15T14:00:00.000Z'],
    ['خديجة بنت الشيخ', 'الرياض', 'لكصر', 2.2, 150, 25, 205, 'completed', 'sadad', '2026-08-14T09:15:00.000Z'],
    ['زبون حماده', 'تيارت', 'المطار القديم', 9.9, 150, 25, 397.5, 'rejected', 'bankily'],
    ['محمد سالم', 'عرفات', 'دار النعيم', 4.0, 100, 25, 200, 'completed', 'bim', '2026-08-13T18:45:00.000Z'],
    ['زبون حماده', 'لكصر', 'توجنين', 6.0, 100, 25, 250, 'accepted', 'bankily'],
  ];
  const insO = db.prepare(
    `INSERT INTO orders
     (customer_name, service, from_area, to_area, km, base, rate, total, status,
      payment_method, provider_id, provider_name, created_at, completed_at)
     VALUES (?, 'delivery', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const providerNames = ['أحمد ولد محمد', 'سيدي محمد', 'فاطمة منت احمد'];
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const status = o[7];
    const providerId = status === 'new' ? null : (i % 3) + 1;
    const providerName = providerId ? providerNames[providerId - 1] : '';
    const created = new Date(Date.now() - (i * 3600 * 1000)).toISOString();
    insO.run(o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7], o[8], providerId, providerName, created, o[9] || null);
  }

  addActivity('مدير النظام', 'تهيئة قاعدة البيانات الأولية', 'بدء تشغيل اللوحة');
  console.log('Seed: تم تعبئة قاعدة البيانات ببيانات تجريبية.');
}

function ensureSettings() {
  const defaults = {
    subscription_fee: '500',
    payment_phone: '+222 33 123 45 67',
    payment_note: 'قم بالإرسال من خلال بنكيلي أو مصرفي أو بيم بانك أو السداد إلى',
  };
  for (const [key, value] of Object.entries(defaults)) {
    const exists = db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(key);
    if (!exists) {
      db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
    }
  }
}

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

migrate();
ensureSettings();
seed();

module.exports = { db, hashPassword, verifyPassword, addActivity, nowIso, getSetting, setSetting };
