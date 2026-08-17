'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { db, verifyPassword, addActivity, nowIso, getSetting, setSetting } = require('./db.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PRICE_MIN = 100;
const PRICE_MAX = 250;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 20e6) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createSession(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    adminId,
    expires
  );
  return token;
}

function createCustomerSession(customerId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO customer_sessions (token, customer_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    customerId,
    expires
  );
  return token;
}

function createOwnerSession(ownerId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO owner_sessions (token, owner_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    ownerId,
    expires
  );
  return token;
}

function tokenFromReq(req) {
  const header = req.headers['authorization'] || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function cleanupExpired() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM customer_sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM owner_sessions WHERE expires_at < ?').run(now);
}

function authFromReq(req) {
  const token = tokenFromReq(req);
  if (!token) return null;
  cleanupExpired();
  const row = db
    .prepare(
      `SELECT s.token, s.admin_id, a.username, a.full_name, a.role, a.password_hash
       FROM sessions s JOIN admins a ON a.id = s.admin_id
       WHERE s.token = ?`
    )
    .get(token);
  return row || null;
}

function customerFromReq(req) {
  const token = tokenFromReq(req);
  if (!token) return null;
  cleanupExpired();
  const row = db
    .prepare(
      `SELECT s.token AS session_token, s.customer_id, c.id, c.name, c.phone, c.joined_at, c.orders_count,
              c.blocked, c.is_active
       FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
       WHERE s.token = ?`
    )
    .get(token);
  return row || null;
}

function ownerFromReq(req) {
  const token = tokenFromReq(req);
  if (!token) return null;
  cleanupExpired();
  const row = db
    .prepare(
      `SELECT s.token AS session_token, s.owner_id, p.id, p.name, p.phone, p.plate, p.rating,
              p.is_connected, p.subscription_active, p.subscription_end, p.blocked
       FROM owner_sessions s JOIN providers p ON p.id = s.owner_id
       WHERE s.token = ?`
    )
    .get(token);
  return row || null;
}

const ordersStatuses = ['new', 'accepted', 'en_route', 'completed', 'rejected'];

function orderById(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

function requestById(id) {
  return db.prepare('SELECT * FROM subscription_requests WHERE id = ?').get(id);
}

function providerById(id) {
  return db.prepare('SELECT * FROM providers WHERE id = ?').get(id);
}

function customerById(id) {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function customerByPhone(phone) {
  const digits = phoneDigits(phone);
  const rows = db.prepare('SELECT * FROM customers').all();
  return rows.find((c) => phoneDigits(c.phone) === digits) || null;
}

function providerByPhone(phone) {
  const digits = phoneDigits(phone);
  const rows = db.prepare('SELECT * FROM providers').all();
  return rows.find((p) => phoneDigits(p.phone) === digits) || null;
}

function parseDocs(reqRow) {
  try {
    const arr = JSON.parse(reqRow.documents || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function approveSubscription(reqRow, note, adminName, docsOverride = null) {
  let provider = providerByPhone(reqRow.phone);
  const start = nowIso();
  const end = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  if (!provider) {
    const { hashPassword } = require('./db.js');
    const finalHash = reqRow.password_hash || hashPassword('pass1234');
    const info = db.prepare(
      `INSERT INTO providers
       (name, phone, password_hash, is_connected, subscription_active,
        subscription_start, subscription_end, created_at)
       VALUES (?, ?, ?, 0, 1, ?, ?, ?)`
    ).run(reqRow.name, reqRow.phone, finalHash, start, end, nowIso());
    provider = providerById(info.lastInsertRowid);
  } else {
    db.prepare(
      'UPDATE providers SET subscription_active = 1, subscription_start = ?, subscription_end = ? WHERE id = ?'
    ).run(start, end, provider.id);
  }
  const docs = (docsOverride || parseDocs(reqRow)).map((d) => ({ ...d, status: 'accepted' }));
  db.prepare(
    `UPDATE subscription_requests
     SET status = 'approved', documents = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(docs), String(note || ''), adminName, nowIso(), reqRow.id);
  return provider;
}

async function handleApi(req, res, url, method, ctx) {
  const parts = url.pathname.split('/').filter(Boolean);
  const admin = ctx.admin;

  if (parts[0] === 'api') {
    if (parts[1] === 'settings') {
      if (method === 'GET') {
        return sendJson(res, 200, {
          subscription_fee: Number(getSetting('subscription_fee', '500')) || 500,
          payment_phone: getSetting('payment_phone', '+222 33 123 45 67'),
          payment_note: getSetting('payment_note', 'قم بالإرسال من خلال بنكيلي أو مصرفي أو بيم بانك أو السداد إلى'),
        });
      }
      if (method === 'POST') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const body = await readBody(req);
        const fee = Number(body.subscription_fee);
        if (!Number.isFinite(fee) || fee <= 0) {
          return sendJson(res, 400, { error: 'قيمة الاشتراك غير صالحة' });
        }
        const phone = String(body.payment_phone || '').trim();
        if (phoneDigits(phone).length < 8) {
          return sendJson(res, 400, { error: 'رقم الهاتف غير صحيح' });
        }
        const note = String(body.payment_note || '').trim();
        if (!note) {
          return sendJson(res, 400, { error: 'نص تعليمات التحويل مطلوب' });
        }
        setSetting('subscription_fee', String(fee));
        setSetting('payment_phone', phone);
        setSetting('payment_note', note);
        addActivity(admin.full_name, 'تحديث الإعدادات', 'قيمة الاشتراك ورقم ونص الدفع');
        return sendJson(res, 200, {
          subscription_fee: fee,
          payment_phone: phone,
          payment_note: note,
        });
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    if (parts[1] === 'customer') {
      if (method === 'POST' && parts[2] === 'register') {
        const body = await readBody(req);
        const name = String(body.name || '').trim();
        const phone = String(body.phone || '').trim();
        const password = String(body.password || '');
        if (!name) return sendJson(res, 400, { error: 'الاسم مطلوب' });
        if (phoneDigits(phone).length < 8) return sendJson(res, 400, { error: 'رقم الهاتف غير صحيح' });
        if (!password) return sendJson(res, 400, { error: 'كلمة المرور مطلوبة' });
        if (customerByPhone(phone)) return sendJson(res, 400, { error: 'هذا الرقم مسجل بالفعل' });
        const { hashPassword } = require('./db.js');
        const info = db.prepare(
          'INSERT INTO customers (name, phone, password_hash, joined_at, orders_count) VALUES (?, ?, ?, ?, 0)'
        ).run(name, phone, hashPassword(password), nowIso());
        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
        const token = createCustomerSession(customer.id);
        return sendJson(res, 200, {
          token,
          customer: { id: customer.id, name: customer.name, phone: customer.phone, joined_at: customer.joined_at, orders_count: customer.orders_count },
        });
      }
      if (method === 'POST' && parts[2] === 'login') {
        const body = await readBody(req);
        const phone = String(body.phone || '').trim();
        const password = String(body.password || '');
        const customer = customerByPhone(phone);
        if (!customer || !verifyPassword(password, customer.password_hash)) {
          return sendJson(res, 401, { error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
        }
        if (customer.blocked) {
          return sendJson(res, 403, { error: 'حسابك محظور من الإدارة' });
        }
        if (customer.is_active === 0) {
          return sendJson(res, 403, { error: 'حسابك موقوف مؤقتاً، يرجى التواصل مع الإدارة' });
        }
        const token = createCustomerSession(customer.id);
        return sendJson(res, 200, {
          token,
          customer: { id: customer.id, name: customer.name, phone: customer.phone, joined_at: customer.joined_at, orders_count: customer.orders_count },
        });
      }
      if (method === 'POST' && parts[2] === 'logout') {
        const token = tokenFromReq(req);
        if (token) db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(token);
        return sendJson(res, 200, { ok: true });
      }
      if (parts[2] === 'orders') {
        if (!ctx.customer) return sendJson(res, 401, { error: 'يجب تسجيل الدخول كزبون' });
        if (ctx.customer.blocked) return sendJson(res, 403, { error: 'حسابك محظور من الإدارة' });
        if (ctx.customer.is_active === 0) {
          return sendJson(res, 403, { error: 'حسابك موقوف مؤقتاً، يرجى التواصل مع الإدارة' });
        }
        if (method === 'GET') {
          const rows = db
            .prepare('SELECT * FROM orders WHERE customer_phone = ? ORDER BY created_at DESC')
            .all(ctx.customer.phone);
          return sendJson(res, 200, rows);
        }
        if (method === 'POST') {
          const body = await readBody(req);
          const from_area = String(body.from_area || '').trim();
          const to_area = String(body.to_area || '').trim();
          if (!from_area || !to_area) return sendJson(res, 400, { error: 'حدد نقطتي الانطلاق والوصول' });
          const total = Number(body.total || 0);
          if (!Number.isFinite(total) || total < PRICE_MIN || total > PRICE_MAX) {
            return sendJson(res, 400, { error: `سعر الرحلة يجب أن يكون بين ${PRICE_MIN} و ${PRICE_MAX} أوقية` });
          }
          const info = db.prepare(
            `INSERT INTO orders
             (customer_name, customer_phone, service, from_area, to_area, km, base, rate, total,
              status, payment_method, description, type_index, created_at)
             VALUES (?, ?, 'delivery', ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`
          ).run(
            ctx.customer.name,
            ctx.customer.phone,
            from_area,
            to_area,
            0,
            Number(body.base || 0),
            0,
            total,
            String(body.payment_method || 'cash'),
            String(body.description || ''),
            Number(body.type_index || 1),
            nowIso()
          );
          const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
          addActivity('تطبيق الزبون', 'طلب توصيل جديد', `${ctx.customer.name} → ${from_area} إلى ${to_area}`);
          return sendJson(res, 200, order);
        }
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    if (parts[1] === 'owner') {
      if (method === 'POST' && parts[2] === 'login') {
        const body = await readBody(req);
        const phone = String(body.phone || '').trim();
        const password = String(body.password || '');
        const provider = providerByPhone(phone);
        if (!provider || !verifyPassword(password, provider.password_hash)) {
          return sendJson(res, 401, { error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
        }
        if (provider.blocked) {
          return sendJson(res, 403, { error: 'حسابك محظور من الإدارة' });
        }
        if (!provider.subscription_active) {
          return sendJson(res, 403, { error: 'اشتراكك غير مفعل، يرجى التواصل مع الإدارة' });
        }
        const token = createOwnerSession(provider.id);
        return sendJson(res, 200, {
          token,
          owner: {
            id: provider.id,
            name: provider.name,
            phone: provider.phone,
            plate: provider.plate,
            rating: provider.rating,
            is_connected: provider.is_connected,
            subscription_active: provider.subscription_active,
            subscription_end: provider.subscription_end,
          },
        });
      }
      if (method === 'POST' && parts[2] === 'logout') {
        const token = tokenFromReq(req);
        if (token) db.prepare('DELETE FROM owner_sessions WHERE token = ?').run(token);
        return sendJson(res, 200, { ok: true });
      }
      if (parts[2] === 'orders' && method === 'GET') {
        if (!ctx.owner) return sendJson(res, 401, { error: 'يجب تسجيل الدخول كصاحب توصيل' });
        if (ctx.owner.blocked) return sendJson(res, 403, { error: 'حسابك محظور من الإدارة' });
        const rows = db
          .prepare('SELECT * FROM orders WHERE provider_id = ? ORDER BY created_at DESC')
          .all(ctx.owner.id);
        return sendJson(res, 200, rows);
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    if (parts[1] === 'auth') {
      if (method === 'POST' && parts[2] === 'login') {
        const body = await readBody(req);
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
        if (!row || !verifyPassword(password, row.password_hash)) {
          return sendJson(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        const token = createSession(row.id);
        addActivity(row.full_name, 'تسجيل دخول', row.full_name);
        return sendJson(res, 200, {
          token,
          admin: { id: row.id, username: row.username, full_name: row.full_name, role: row.role },
        });
      }
      if (parts[2] === 'logout' && method === 'POST') {
        const header = req.headers['authorization'] || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        return sendJson(res, 200, { ok: true });
      }
      if (parts[2] === 'me' && method === 'GET') {
        return sendJson(res, 200, {
          admin: { id: admin.id, username: admin.username, full_name: admin.full_name, role: admin.role },
        });
      }
      if (parts[2] === 'password' && method === 'POST') {
        const body = await readBody(req);
        const current = String(body.current || '');
        const next = String(body.next || '');
        if (!verifyPassword(current, admin.password_hash)) {
          return sendJson(res, 400, { error: 'كلمة المرور الحالية غير صحيحة' });
        }
        if (next.length < 6) {
          return sendJson(res, 400, { error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
        }
        const { hashPassword } = require('./db.js');
        db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(next), admin.admin_id);
        addActivity(admin.full_name, 'تغيير كلمة المرور', admin.full_name);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    if (parts[1] === 'stats' && method === 'GET') {
      if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayIso = todayStart.toISOString();
      const stats = {
        customers: db.prepare('SELECT COUNT(*) AS c FROM customers').get().c,
        providers: db.prepare('SELECT COUNT(*) AS c FROM providers').get().c,
        active_providers: db.prepare('SELECT COUNT(*) AS c FROM providers WHERE is_connected = 1').get().c,
        pending_requests: db.prepare("SELECT COUNT(*) AS c FROM subscription_requests WHERE status = 'pending'").get().c,
        approved_requests: db.prepare("SELECT COUNT(*) AS c FROM subscription_requests WHERE status = 'approved'").get().c,
        orders_total: db.prepare('SELECT COUNT(*) AS c FROM orders').get().c,
        orders_today: db.prepare('SELECT COUNT(*) AS c FROM orders WHERE created_at >= ?').get(todayIso).c,
        orders_completed: db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'completed'").get().c,
        revenue: db.prepare("SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE status = 'completed'").get().s,
        revenue_today: db.prepare(
          "SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE status = 'completed' AND completed_at >= ?"
        ).get(todayIso).s,
      };
      return sendJson(res, 200, stats);
    }

    if (parts[1] === 'orders') {
      if (method === 'GET' && parts[2] === 'available') {
        if (!ctx.owner) return sendJson(res, 401, { error: 'يجب تسجيل الدخول كصاحب توصيل' });
        if (ctx.owner.blocked) return sendJson(res, 403, { error: 'حسابك محظور من الإدارة' });
        const rows = db
          .prepare("SELECT * FROM orders WHERE status = 'new' ORDER BY created_at DESC")
          .all();
        return sendJson(res, 200, rows);
      }
      if (method === 'POST' && parts[2] === 'accept') {
        if (!ctx.owner) return sendJson(res, 401, { error: 'يجب تسجيل الدخول كصاحب توصيل' });
        if (ctx.owner.blocked) return sendJson(res, 403, { error: 'حسابك محظور من الإدارة' });
        const body = await readBody(req);
        const id = Number(body.order_id);
        const row = orderById(id);
        if (!row) return sendJson(res, 404, { error: 'الطلب غير موجود' });
        if (row.status !== 'new') return sendJson(res, 400, { error: 'هذا الطلب لم يعد متاحاً' });
        db.prepare('UPDATE orders SET status = ?, provider_id = ?, provider_name = ? WHERE id = ?').run(
          'accepted',
          ctx.owner.id,
          ctx.owner.name,
          id
        );
        addActivity(ctx.owner.name, 'قبول طلب', `طلب #${id}`);
        return sendJson(res, 200, orderById(id));
      }
      if (method === 'POST' && parts[2] === 'owner-status') {
        if (!ctx.owner) return sendJson(res, 401, { error: 'يجب تسجيل الدخول كصاحب توصيل' });
        if (ctx.owner.blocked) return sendJson(res, 403, { error: 'حسابك محظور من الإدارة' });
        const body = await readBody(req);
        const id = Number(body.order_id);
        const next = String(body.status || '');
        const row = orderById(id);
        if (!row) return sendJson(res, 404, { error: 'الطلب غير موجود' });
        if (row.provider_id !== ctx.owner.id) return sendJson(res, 403, { error: 'هذا الطلب ليس مسنداً إليك' });
        if (!['en_route', 'completed', 'rejected'].includes(next)) {
          return sendJson(res, 400, { error: 'حالة غير صالحة' });
        }
        const completedAt = next === 'completed' ? nowIso() : row.completed_at;
        db.prepare('UPDATE orders SET status = ?, completed_at = ? WHERE id = ?').run(next, completedAt, id);
        if (next === 'completed') {
          db.prepare('UPDATE customers SET orders_count = orders_count + 1 WHERE phone = ?').run(row.customer_phone);
        }
        addActivity(ctx.owner.name, 'تحديث حالة طلب', `طلب #${id} ← ${next}`);
        return sendJson(res, 200, orderById(id));
      }
      if (method === 'GET') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const status = url.searchParams.get('status') || '';
        const q = (url.searchParams.get('q') || '').trim();
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 500);
        let sql = 'SELECT * FROM orders WHERE 1=1';
        const params = [];
        if (status && ordersStatuses.includes(status)) {
          sql += ' AND status = ?';
          params.push(status);
        }
        if (q) {
          sql += ' AND (customer_name LIKE ? OR from_area LIKE ? OR to_area LIKE ?)';
          params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        const rows = db.prepare(sql).all(...params);
        return sendJson(res, 200, rows);
      }
      if (method === 'POST' && parts.length === 3 && parts[2] === 'status') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const body = await readBody(req);
        const id = Number(body.id);
        const next = String(body.status || '');
        const row = orderById(id);
        if (!row) return sendJson(res, 404, { error: 'الطلب غير موجود' });
        if (!ordersStatuses.includes(next)) return sendJson(res, 400, { error: 'حالة غير صالحة' });
        const completedAt = next === 'completed' ? nowIso() : row.completed_at;
        db.prepare('UPDATE orders SET status = ?, completed_at = ? WHERE id = ?').run(
          next,
          completedAt,
          id
        );
        if (next === 'completed') {
          db.prepare('UPDATE customers SET orders_count = orders_count + 1 WHERE name = ?').run(row.customer_name);
        }
        addActivity(admin.full_name, 'تغيير حالة الطلب', `طلب #${id} ← ${next}`);
        return sendJson(res, 200, orderById(id));
      }
      if (method === 'POST' && parts.length === 3 && parts[2] === 'assign') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const body = await readBody(req);
        const id = Number(body.id);
        const providerId = Number(body.provider_id);
        const row = orderById(id);
        const prov = providerById(providerId);
        if (!row) return sendJson(res, 404, { error: 'الطلب غير موجود' });
        if (!prov) return sendJson(res, 404, { error: 'صاحب التوصيل غير موجود' });
        db.prepare('UPDATE orders SET provider_id = ?, provider_name = ? WHERE id = ?').run(
          providerId,
          prov.name,
          id
        );
        addActivity(admin.full_name, 'إسناد طلب', `طلب #${id} → ${prov.name}`);
        return sendJson(res, 200, orderById(id));
      }
      if (method === 'POST' && parts.length === 3 && parts[2] === 'update') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const body = await readBody(req);
        const id = Number(body.id);
        const row = orderById(id);
        if (!row) return sendJson(res, 404, { error: 'الطلب غير موجود' });
        const customerName = String(body.customer_name || '').trim();
        const fromArea = String(body.from_area || '').trim();
        const toArea = String(body.to_area || '').trim();
        const total = Number(body.total);
        const status = String(body.status || '');
        if (!customerName || !fromArea || !toArea) {
          return sendJson(res, 400, { error: 'اسم الزبون ونقطتا الانطلاق والوصول مطلوبة' });
        }
        if (!Number.isFinite(total) || total < PRICE_MIN || total > PRICE_MAX) {
          return sendJson(res, 400, { error: `سعر الرحلة يجب أن يكون بين ${PRICE_MIN} و ${PRICE_MAX} أوقية` });
        }
        if (!ordersStatuses.includes(status)) return sendJson(res, 400, { error: 'حالة غير صالحة' });
        const completedAt = status === 'completed' ? row.completed_at || nowIso() : null;
        const paymentMethod = String(body.payment_method || '').trim();
        db.prepare(
          `UPDATE orders SET customer_name = ?, from_area = ?, to_area = ?, km = 0, total = ?,
           status = ?, completed_at = ?, payment_method = ? WHERE id = ?`
        ).run(customerName, fromArea, toArea, total, status, completedAt, paymentMethod, id);
        if (row.status !== 'completed' && status === 'completed') {
          db.prepare('UPDATE customers SET orders_count = orders_count + 1 WHERE phone = ? OR name = ?').run(
            row.customer_phone || '',
            row.customer_name
          );
        } else if (row.status === 'completed' && status !== 'completed') {
          db.prepare('UPDATE customers SET orders_count = MAX(orders_count - 1, 0) WHERE phone = ? OR name = ?').run(
            row.customer_phone || '',
            row.customer_name
          );
        }
        addActivity(admin.full_name, 'تعديل رحلة', `طلب #${id}`);
        return sendJson(res, 200, orderById(id));
      }
      if (method === 'POST' && parts.length === 3 && parts[2] === 'delete') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const body = await readBody(req);
        const id = Number(body.id);
        const row = orderById(id);
        if (!row) return sendJson(res, 404, { error: 'الطلب غير موجود' });
        if (row.status === 'completed') {
          db.prepare('UPDATE customers SET orders_count = MAX(orders_count - 1, 0) WHERE phone = ? OR name = ?').run(
            row.customer_phone || '',
            row.customer_name
          );
        }
        db.prepare('DELETE FROM orders WHERE id = ?').run(id);
        addActivity(admin.full_name, 'حذف رحلة', `طلب #${id}`);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    if (parts[1] === 'subscription') {
      if (parts[2] === 'by-device' && method === 'GET') {
        const deviceId = String(url.searchParams.get('device_id') || '').trim();
        if (!deviceId) return sendJson(res, 400, { error: 'device_id مطلوب' });
        const row = db
          .prepare(
            `SELECT * FROM subscription_requests
             WHERE device_id = ? AND status IN ('pending','needs_resubmission','approved','rejected')
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(deviceId);
        if (!row) return sendJson(res, 200, { request: null });
        const docs = parseDocs(row).map((d) => ({
          category: d.category,
          file: d.file,
          status: d.status || 'pending',
          ...(d.note ? { note: d.note } : {}),
        }));
        const { documents, password_hash, ...rest } = row;
        return sendJson(res, 200, { request: { ...rest, documents: docs } });
      }
      if (parts[2] === 'resubmit' && method === 'POST') {
        const body = await readBody(req);
        const deviceId = String(body.device_id || '').trim();
        let documents = body.documents;
        if (!Array.isArray(documents)) documents = [];
        if (!deviceId) return sendJson(res, 400, { error: 'device_id مطلوب' });
        const row = db
          .prepare(
            `SELECT * FROM subscription_requests
             WHERE device_id = ? AND status = 'needs_resubmission'
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(deviceId);
        if (!row) return sendJson(res, 400, { error: 'لا يوجد طلب بانتظار استكمال الأوراق' });
        const docs = parseDocs(row);
        for (const up of documents) {
          const cat = String(up.category || '');
          const data = String(up.data || '');
          if (!cat || !data) continue;
          const d = docs.find((x) => x.category === cat);
          if (d) {
            if (d.status === 'rejected') {
              d.data = data;
              d.file = `${cat}.jpg`;
              d.status = 'pending';
              delete d.note;
            }
          } else {
            docs.push({ category: cat, file: `${cat}.jpg`, data, status: 'pending' });
          }
        }
        db.prepare(
          `UPDATE subscription_requests
           SET documents = ?, status = 'pending', review_note = '', reviewed_by = '', reviewed_at = NULL
           WHERE id = ?`
        ).run(JSON.stringify(docs), row.id);
        addActivity('تطبيق صاحب التوصيل', 'إعادة رفع أوراق', row.name);
        return sendJson(res, 200, { id: Number(row.id), status: 'pending' });
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    if (parts[1] === 'subscription-requests') {
      if (method === 'POST' && parts[2] === 'create') {
        const body = await readBody(req);
        const name = String(body.name || '').trim();
        const phone = String(body.phone || '').trim();
        const password = String(body.password || '');
        const paymentMethod = String(body.payment_method || '').trim();
        const deviceId = String(body.device_id || '').trim();
        if (!name) return sendJson(res, 400, { error: 'الاسم مطلوب' });
        if (phoneDigits(phone).length < 8) return sendJson(res, 400, { error: 'رقم الهاتف غير صحيح' });
        if (!password) return sendJson(res, 400, { error: 'كلمة المرور مطلوبة' });
        let documents = body.documents;
        if (!Array.isArray(documents)) documents = [];
        const alreadyApproved = db.prepare(
          "SELECT id FROM subscription_requests WHERE phone = ? AND status = 'approved'"
        ).get(phone);
        if (alreadyApproved) {
          return sendJson(res, 400, { error: 'هذا الرقم مقبول مسبقاً كصاحب توصيل' });
        }
        let pendingSql =
          "SELECT * FROM subscription_requests WHERE phone = ? AND status IN ('pending','needs_resubmission')";
        const pendingParams = [phone];
        if (deviceId) {
          pendingSql =
            "SELECT * FROM subscription_requests WHERE (phone = ? OR device_id = ?) AND status IN ('pending','needs_resubmission')";
          pendingParams.push(deviceId);
        }
        const pending = db.prepare(pendingSql).all(...pendingParams);
        if (pending.length > 0) {
          return sendJson(res, 400, { error: 'لديك طلب اشتراك قيد المراجعة بالفعل' });
        }
        const { hashPassword } = require('./db.js');
        const info = db.prepare(
          `INSERT INTO subscription_requests
           (name, phone, password_hash, device_id, documents, payment_method, payment_confirmed, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 'pending', ?)`
        ).run(name, phone, hashPassword(password), deviceId, JSON.stringify(documents), paymentMethod, nowIso());
        addActivity('تطبيق صاحب التوصيل', 'طلب اشتراك جديد', name);
        return sendJson(res, 200, { id: Number(info.lastInsertRowid), status: 'pending' });
      }
      if (method === 'GET') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const status = url.searchParams.get('status') || '';
        let sql = 'SELECT * FROM subscription_requests WHERE 1=1';
        const params = [];
        if (['pending', 'approved', 'rejected', 'needs_resubmission'].includes(status)) {
          sql += ' AND status = ?';
          params.push(status);
        }
        sql += ' ORDER BY created_at DESC';
        const rows = db.prepare(sql).all(...params);
        return sendJson(res, 200, rows);
      }
      if (method === 'POST') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const body = await readBody(req);
        if (parts[2] === 'delete-all') {
          const total = db.prepare('SELECT COUNT(*) AS c FROM subscription_requests').get().c;
          db.prepare('DELETE FROM subscription_requests').run();
          addActivity(admin.full_name, 'حذف كل طلبات الاشتراك', `${total} طلب`);
          return sendJson(res, 200, { ok: true, deleted: total });
        }
        const id = Number(parts[2]);
        const action = parts[3];
        const reqRow = requestById(id);
        if (!reqRow) return sendJson(res, 404, { error: 'طلب الاشتراك غير موجود' });
        if (action === 'delete') {
          db.prepare('DELETE FROM subscription_requests WHERE id = ?').run(id);
          addActivity(admin.full_name, 'حذف طلب اشتراك', reqRow.name);
          return sendJson(res, 200, { ok: true });
        }
        if (reqRow.status !== 'pending') {
          return sendJson(res, 400, { error: 'هذا الطلب تمت معالجته مسبقاً' });
        }
        if (action === 'approve') {
          approveSubscription(reqRow, String(body.note || ''), admin.full_name);
          addActivity(admin.full_name, 'قبول اشتراك', reqRow.name);
          return sendJson(res, 200, { provider: providerByPhone(reqRow.phone), request: requestById(id) });
        }
        if (action === 'docs-review') {
          const docs = parseDocs(reqRow);
          const updates = Array.isArray(body.docs) ? body.docs : [];
          for (const u of updates) {
            const cat = String(u.category || '');
            const st = String(u.status || '');
            if (!cat || !['accepted', 'rejected'].includes(st)) continue;
            const d = docs.find((x) => x.category === cat);
            if (d) {
              d.status = st;
              if (st === 'rejected') {
                const un = String(u.note || '').trim();
                d.note = un || d.note || '';
              } else {
                delete d.note;
              }
            }
          }
          const decided = docs.filter((d) => d.status === 'accepted' || d.status === 'rejected');
          let status = 'pending';
          let note = String(body.note || '');
          if (docs.length > 0 && decided.length === docs.length) {
            if (decided.every((d) => d.status === 'accepted')) {
              approveSubscription(reqRow, note, admin.full_name, docs);
              addActivity(admin.full_name, 'قبول اشتراك (مراجعة وثائق)', reqRow.name);
              return sendJson(res, 200, { provider: providerByPhone(reqRow.phone), request: requestById(id) });
            }
            status = 'needs_resubmission';
            if (!note) note = 'بعض الأوراق لم تُعتمد، يرجى إعادة رفعها';
          }
          db.prepare(
            `UPDATE subscription_requests
             SET documents = ?, status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?
             WHERE id = ?`
          ).run(JSON.stringify(docs), status, note, admin.full_name, nowIso(), id);
          addActivity(admin.full_name, 'مراجعة وثائق', reqRow.name);
          return sendJson(res, 200, requestById(id));
        }
        if (action === 'reject') {
          db.prepare(
            `UPDATE subscription_requests
             SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = ?
             WHERE id = ?`
          ).run(String(body.note || 'لم يتم توضيح السبب'), admin.full_name, nowIso(), id);
          addActivity(admin.full_name, 'رفض اشتراك', reqRow.name);
          return sendJson(res, 200, requestById(id));
        }
        return sendJson(res, 404, { error: 'not found' });
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    if (parts[1] === 'providers') {
      if (method === 'GET') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const rows = db.prepare('SELECT * FROM providers ORDER BY id').all();
        return sendJson(res, 200, rows);
      }
      if (method === 'POST') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const id = Number(parts[2]);
        const action = parts[3];
        const prov = providerById(id);
        if (!prov) return sendJson(res, 404, { error: 'صاحب التوصيل غير موجود' });
        const body = await readBody(req);
        if (action === 'toggle-connection') {
          const next = prov.is_connected ? 0 : 1;
          db.prepare('UPDATE providers SET is_connected = ? WHERE id = ?').run(next, id);
          addActivity(admin.full_name, next ? 'تفعيل اتصال' : 'تعطيل اتصال', prov.name);
          return sendJson(res, 200, providerById(id));
        }
        if (action === 'toggle-subscription') {
          const next = prov.subscription_active ? 0 : 1;
          db.prepare('UPDATE providers SET subscription_active = ? WHERE id = ?').run(next, id);
          addActivity(admin.full_name, next ? 'تفعيل اشتراك' : 'إيقاف اشتراك', prov.name);
          return sendJson(res, 200, providerById(id));
        }
        if (action === 'update') {
          const name = String(body.name || '').trim();
          const phone = String(body.phone || '').trim();
          const plate = String(body.plate || '').trim();
          if (!name || phoneDigits(phone).length < 8) {
            return sendJson(res, 400, { error: 'الاسم ورقم الهاتف الصحيح مطلوبان' });
          }
          const dup = providerByPhone(phone);
          if (dup && dup.id !== prov.id) {
            return sendJson(res, 400, { error: 'هذا الرقم مسجل لصاحب توصيل آخر' });
          }
          db.prepare('UPDATE providers SET name = ?, phone = ?, plate = ? WHERE id = ?').run(
            name,
            phone,
            plate,
            id
          );
          addActivity(admin.full_name, 'تعديل بيانات', prov.name);
          return sendJson(res, 200, providerById(id));
        }
        if (action === 'toggle-block') {
          const next = prov.blocked ? 0 : 1;
          db.prepare('UPDATE providers SET blocked = ? WHERE id = ?').run(next, id);
          if (next) db.prepare('DELETE FROM owner_sessions WHERE owner_id = ?').run(id);
          addActivity(admin.full_name, next ? 'حظر حساب' : 'رفع الحظر', prov.name);
          return sendJson(res, 200, providerById(id));
        }
        if (action === 'delete') {
          db.prepare('UPDATE orders SET provider_id = NULL WHERE provider_id = ?').run(id);
          db.prepare('DELETE FROM owner_sessions WHERE owner_id = ?').run(id);
          db.prepare('DELETE FROM providers WHERE id = ?').run(id);
          addActivity(admin.full_name, 'حذف صاحب توصيل', prov.name);
          return sendJson(res, 200, { ok: true });
        }
        return sendJson(res, 404, { error: 'not found' });
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    if (parts[1] === 'customers') {
      if (method === 'GET') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const rows = db.prepare('SELECT * FROM customers ORDER BY joined_at DESC').all();
        return sendJson(res, 200, rows);
      }
      if (method === 'POST') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const id = Number(parts[2]);
        const action = parts[3];
        const cust = customerById(id);
        if (!cust) return sendJson(res, 404, { error: 'الزبون غير موجود' });
        const body = await readBody(req);
        if (action === 'update') {
          const name = String(body.name || '').trim();
          const phone = String(body.phone || '').trim();
          if (!name || phoneDigits(phone).length < 8) {
            return sendJson(res, 400, { error: 'الاسم ورقم الهاتف الصحيح مطلوبان' });
          }
          const dup = customerByPhone(phone);
          if (dup && dup.id !== cust.id) {
            return sendJson(res, 400, { error: 'هذا الرقم مسجل لزبون آخر' });
          }
          db.prepare('UPDATE customers SET name = ?, phone = ? WHERE id = ?').run(name, phone, id);
          addActivity(admin.full_name, 'تعديل بيانات زبون', name);
          return sendJson(res, 200, customerById(id));
        }
        if (action === 'toggle-active') {
          const next = cust.is_active ? 0 : 1;
          db.prepare('UPDATE customers SET is_active = ? WHERE id = ?').run(next, id);
          if (!next) db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(id);
          addActivity(admin.full_name, next ? 'تفعيل حساب زبون' : 'تعطيل حساب زبون', cust.name);
          return sendJson(res, 200, customerById(id));
        }
        if (action === 'toggle-block') {
          const next = cust.blocked ? 0 : 1;
          db.prepare('UPDATE customers SET blocked = ? WHERE id = ?').run(next, id);
          if (next) db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(id);
          addActivity(admin.full_name, next ? 'حظر حساب زبون' : 'رفع الحظر عن زبون', cust.name);
          return sendJson(res, 200, customerById(id));
        }
        if (action === 'delete') {
          db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(id);
          db.prepare('DELETE FROM customers WHERE id = ?').run(id);
          addActivity(admin.full_name, 'حذف زبون', cust.name);
          return sendJson(res, 200, { ok: true });
        }
        return sendJson(res, 404, { error: 'not found' });
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    if (parts[1] === 'activity') {
      if (method === 'GET' && parts[2] === 'since') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const after = Number(url.searchParams.get('after') || '0');
        const rows = db
          .prepare(
            'SELECT id, admin_name, action, target, created_at FROM activity_log WHERE id > ? ORDER BY id ASC'
          )
          .all(after);
        const current = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM activity_log').get().m;
        return sendJson(res, 200, { current, rows });
      }
      if (method === 'GET') {
        if (!admin) return sendJson(res, 401, { error: 'غير مصرح' });
        const rows = db
          .prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 50')
          .all();
        return sendJson(res, 200, rows);
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  return sendJson(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('غير موجود');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      const ctx = {
        admin: authFromReq(req),
        customer: customerFromReq(req),
        owner: ownerFromReq(req),
      };
      return await handleApi(req, res, url, method, ctx);
    }
    serveStatic(req, res, url);
  } catch (err) {
    const status = err.message === 'invalid JSON' || err.message === 'payload too large' ? 400 : 500;
    sendJson(res, status, { error: err.message });
  }
});

function lanAddresses() {
  const os = require('node:os');
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) out.push({ name, address: iface.address });
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('=== لوحة تحكم حماده للتوصيل ===');
  console.log(`السيرفر يعمل على: http://localhost:${PORT}`);
  console.log('الدخول الافتراضي: admin / admin123');
  console.log('للتجربة على الهاتف (نفس شبكة الواي فاي) استخدم أحد العناوين:');
  for (const a of lanAddresses()) {
    console.log(`  → http://${a.address}:${PORT}  (${a.name})`);
  }
  console.log(`في تطبيق الهاتف ضع هذا العنوان في ملف: lib/services/api_config.dart`);
});
