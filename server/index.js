const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { init, all, get, run, transaction, backup, restore, listBackups, dailyBackup, makeFactoryBaseline, DATA_DIR } = require('./db');
const license = require('./license');

const JWT_SECRET = process.env.JWT_SECRET || 'arp-grocery-secret-key-2026';
const PORT = process.env.PORT || 3000;

function seedAdmin() {
  if (get('SELECT COUNT(*) AS c FROM users').c === 0) {
    let branchId = null;
    if (get('SELECT COUNT(*) AS c FROM branches').c === 0) {
      const b = run('INSERT INTO branches (name, code, address, phone) VALUES (?,?,?,?)', ['الفرع الرئيسي', 'BR-001', '', '']);
      branchId = b.lastInsertRowid;
    } else {
      branchId = get('SELECT id FROM branches ORDER BY id LIMIT 1').id;
    }
    const hash = bcrypt.hashSync('admin123', 10);
    run('INSERT INTO users (username, password_hash, full_name, role, branch_id) VALUES (?,?,?,?,?)',
      ['admin', hash, 'مدير النظام', 'admin', branchId]);
    console.log('>> تم إنشاء حساب المدير الافتراضي: admin / admin123');
  }
}

const app = express();
app.use(express.json({ limit: '5mb' }));

/* ==================== LICENSE GATE ==================== */
license.attachDb(get, run);
const GATE_OPEN = new Set(['/activate.html', '/api/license/status', '/api/license/trial', '/api/license/activate', '/api/health', '/favicon.ico']);
app.use((req, res, next) => {
  if (GATE_OPEN.has(req.path) || req.path.startsWith('/api/bot/')) return next();
  if (license.isOpen()) return next();
  if (req.path.startsWith('/api')) {
    const s = license.status();
    return res.status(403).json({
      error: s.mode === 'expired'
        ? 'انتهت فترة التجربة المجانية — أدخل كود التفعيل لمتابعة استخدام البرنامج'
        : 'البرنامج غير مُفعّل — أدخل كود التفعيل أو ابدأ التجربة المجانية',
      gate: true, mode: s.mode,
    });
  }
  return res.redirect('/activate.html');
});

app.get('/api/license/status', (req, res) => res.json(license.status()));
app.post('/api/license/trial', (req, res) => res.json(license.startTrial()));
app.post('/api/license/activate', (req, res) => {
  const r = license.activate((req.body || {}).code);
  if (!r.ok) return res.status(400).json({ error: 'كود التفعيل غير صحيح لهذا الجهاز — تأكد من كتابته كما هو' });
  res.json(r);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'غير مسموح، سجل الدخول أولاً' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'الجلسة انتهت، سجل الدخول من جديد' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'هذه العملية تحتاج صلاحية مدير' });
  next();
}

function userPerms(userId) {
  const u = get('SELECT permissions FROM users WHERE id = ?', [userId]);
  if (!u || !u.permissions) return {};
  try { return JSON.parse(u.permissions); } catch { return {}; }
}
function userHasPerm(userId, role, key) {
  if (role === 'admin') return true;
  const p = userPerms(userId);
  return !!(p.actions && p.actions[key]) || !!(p.pages && p.pages.includes(key));
}
const permOrAdmin = key => (req, res, next) => {
  if (userHasPerm(req.user.id, req.user.role, key)) return next();
  res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' });
};

function nextInvoice(prefix) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let table = 'sales';
  let col = 'invoice_no';

  if (prefix === 'RET') { table = 'returns'; col = 'return_no'; }
  else if (prefix === 'JOB') { table = 'maintenance_jobs'; col = 'job_no'; }
  else if (prefix === 'UD' || prefix === 'DEV') { table = 'used_devices'; col = 'code'; }
  else if (prefix === 'PUR') { table = 'purchases'; col = 'invoice_no'; }
  else if (prefix === 'INV') { table = 'sales'; col = 'invoice_no'; }

  // Extract highest numeric sequence from existing records to continue incrementing across restarts/days
  const rows = all(`SELECT ${col} AS no FROM ${table} WHERE ${col} IS NOT NULL`);
  let maxSeq = 0;
  for (const r of rows) {
    if (!r.no) continue;
    const match = String(r.no).match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  let n = maxSeq + 1;
  while (true) {
    const no = `${prefix}-${today}-${String(n).padStart(4, '0')}`;
    const exists = get(`SELECT id FROM ${table} WHERE ${col} = ?`, [no]);
    if (!exists) return no;
    n++;
  }
}

function settingsObj() {
  const rows = all('SELECT * FROM settings');
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

function loyaltyExpiry(days) {
  return new Date(Date.now() + Number(days || 2) * 86400000).toISOString().slice(0, 10);
}

function genLoyaltyCode(partyId) {
  while (true) {
    const code = '9' + String(partyId).padStart(4, '0') + String(Date.now()).slice(-4) + Math.floor(Math.random() * 90 + 10);
    if (!get('SELECT id FROM coupons WHERE code = ?', [code])) return code;
  }
}

function resolveCustomer(phone, name) {
  const p = String(phone || '').trim();
  if (!p) return null;
  const existing = get("SELECT * FROM parties WHERE type = 'customer' AND phone = ?", [p]);
  if (existing) return existing;
  const r = run("INSERT INTO parties (type, name, phone) VALUES ('customer',?,?)", [name || p, p]);
  return get('SELECT * FROM parties WHERE id = ?', [r.lastInsertRowid]);
}

function loyaltyAfterSale(partyId) {
  const s = settingsObj();
  const threshold = Number(s.loyalty_threshold) || 5;
  const percent = Number(s.loyalty_percent) || 10;
  const days = Number(s.loyalty_days) || 2;
  const salesCount = get('SELECT COUNT(*) AS c FROM sales WHERE party_id = ?', [partyId]).c;
  const activeLoyalty = get("SELECT * FROM coupons WHERE party_id = ? AND source = 'loyalty' AND active = 1", [partyId]);
  if (salesCount >= threshold) {
    const exp = loyaltyExpiry(days);
    if (activeLoyalty) {
      run('UPDATE coupons SET expires_at = ? WHERE id = ?', [exp, activeLoyalty.id]);
      return { issued: false, code: activeLoyalty.code, discount_type: activeLoyalty.discount_type, value: activeLoyalty.value, expires_at: exp, sales_count: salesCount, threshold };
    }
    const code = genLoyaltyCode(partyId);
    run("INSERT INTO coupons (code, discount_type, value, min_total, max_uses, active, expires_at, party_id, source) VALUES (?,?,?,?,?,?,?,?,?)",
      [code, 'percent', percent, 0, 0, 1, exp, partyId, 'loyalty']);
    return { issued: true, code, discount_type: 'percent', value: percent, expires_at: exp, sales_count: salesCount, threshold };
  }
  if (activeLoyalty) run('UPDATE coupons SET active = 0 WHERE id = ?', [activeLoyalty.id]);
  return { issued: false, code: null, sales_count: salesCount, threshold };
}

/* ==================== AUTH ==================== */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  if (!user.active) return res.status(403).json({ error: 'هذا الحساب موقوف' });
  const branch = get('SELECT * FROM branches WHERE id = ?', [user.branch_id]);
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, branch_id: user.branch_id }, JWT_SECRET, { expiresIn: '12h' });
  res.json({
    token,
    user: {
      id: user.id, username: user.username, full_name: user.full_name,
      role: user.role, branch: branch ? branch.name : 'الفرع الرئيسي', branch_id: user.branch_id,
    },
  });
});

app.get('/api/me', auth, (req, res) => {
  const user = get('SELECT u.*, b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  const { password_hash, ...safe } = user;
  res.json({ user: safe });
});

/* ==================== USERS ==================== */
app.get('/api/users', auth, adminOnly, (req, res) => {
  res.json(all('SELECT id, username, full_name, role, branch_id, active, permissions, created_at FROM users'));
});
app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, full_name, role, branch_id } = req.body || {};
  if (!username || !password || !full_name) return res.status(400).json({ error: 'بيانات ناقصة' });
  const exists = get('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
  const hash = bcrypt.hashSync(String(password), 10);
  run('INSERT INTO users (username, password_hash, full_name, role, branch_id) VALUES (?,?,?,?,?)', [
    username, hash, full_name, role || 'cashier', branch_id || null,
  ]);
  res.json({ ok: true });
});
app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const { password, full_name, role, branch_id, active, permissions } = req.body || {};
  const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (user.role === 'admin' && role && role !== 'admin') return res.status(400).json({ error: 'لا يمكن تغيير صلاحية المدير الرئيسي' });
  if (password) {
    const hash = bcrypt.hashSync(String(password), 10);
    run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
  }
  let permsJson = user.permissions;
  if (permissions !== undefined) {
    permsJson = permissions && typeof permissions === 'object' ? JSON.stringify(permissions) : null;
  }
  run('UPDATE users SET full_name = ?, role = ?, branch_id = ?, active = ?, permissions = ? WHERE id = ?', [
    full_name ?? user.full_name, role ?? user.role, branch_id ?? user.branch_id,
    active === undefined ? user.active : active ? 1 : 0, permsJson, user.id,
  ]);
  res.json({ ok: true });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const user = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (user.role === 'admin') return res.status(400).json({ error: 'لا يمكن حذف حساب مدير' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'لا يمكن حذف حسابك الحالي' });
  const linked = get(`SELECT
    (SELECT COUNT(*) FROM sales WHERE user_id = ?) +
    (SELECT COUNT(*) FROM shifts WHERE user_id = ?) +
    (SELECT COUNT(*) FROM returns WHERE user_id = ?) +
    (SELECT COUNT(*) FROM stocktakes WHERE user_id = ?) +
    (SELECT COUNT(*) FROM price_history WHERE user_id = ?) +
    (SELECT COUNT(*) FROM payments WHERE user_id = ?) +
    (SELECT COUNT(*) FROM salary_closings WHERE user_id = ?) AS n`,
    [id, id, id, id, id, id, id]);
  if ((linked?.n || 0) > 0) {
    return res.status(400).json({ error: 'لا يمكن حذف المستخدم لارتباطه بسجلات (فواتير/ورديات/مرتجعات...) — استخدم زر الإيقاف بدلاً من الحذف' });
  }
  run('DELETE FROM users WHERE id = ?', [id]);
  res.json({ ok: true });
});

/* ==================== BRANCHES ==================== */
app.get('/api/branches', auth, (req, res) => {
  res.json(all('SELECT * FROM branches'));
});
app.post('/api/branches', auth, adminOnly, (req, res) => {
  const { name, code, address, phone } = req.body || {};
  if (!name || !code) return res.status(400).json({ error: 'بيانات ناقصة' });
  run('INSERT INTO branches (name, code, address, phone) VALUES (?,?,?,?)', [name, code, address || '', phone || '']);
  res.json({ ok: true });
});

/* ==================== CATEGORIES ==================== */
app.get('/api/categories', auth, (req, res) => {
  res.json(all(`SELECT c.*, p.name AS parent_name,
                (SELECT COUNT(*) FROM products pr WHERE pr.category_id = c.id) AS products_count
                FROM categories c LEFT JOIN categories p ON p.id = c.parent_id ORDER BY c.name`));
});

const CAT_MAX_DEPTH = 3;
function catChain(id, cats) {
  // returns [root, ..., node] chain or null on broken link / cycle
  const chain = [];
  let cur = cats.find(c => c.id === Number(id));
  let guard = 0;
  while (cur && guard++ < 10) {
    chain.unshift(cur);
    if (!cur.parent_id) return chain;
    cur = cats.find(c => c.id === cur.parent_id);
  }
  return chain.length ? chain : null;
}

app.post('/api/categories', auth, permOrAdmin('products.edit'), (req, res) => {
  const { name, parent_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  let pid = null;
  if (parent_id) {
    const cats = all('SELECT * FROM categories');
    const chain = catChain(parent_id, cats);
    if (!chain) return res.status(400).json({ error: 'القسم الأب غير موجود' });
    if (chain.length >= CAT_MAX_DEPTH) {
      return res.status(400).json({ error: `لا يمكن التفرع أكثر من ${CAT_MAX_DEPTH} مستويات (قسم رئيسي ← فرعي ← نوع فرعي)` });
    }
    pid = chain[chain.length - 1].id;
  }
  const dup = get('SELECT id FROM categories WHERE TRIM(name) = ? AND COALESCE(parent_id,0) = COALESCE(?,0)', [name.trim(), pid]);
  if (dup) {
    return res.status(400).json({ error: pid ? 'يوجد فئة أو نوع فرعي بنفس الاسم تحت هذا القسم الأب' : 'يوجد قسم رئيسي بنفس الاسم بالفعل' });
  }
  run('INSERT INTO categories (name, parent_id) VALUES (?,?)', [String(name).trim(), pid]);
  res.json({ ok: true });
});
app.put('/api/categories/:id', auth, permOrAdmin('products.edit'), (req, res) => {
  const c = get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'القسم غير موجود' });
  const b = req.body || {};
  const name = b.name === undefined ? c.name : String(b.name).trim();
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const cats = all('SELECT * FROM categories');
  let pid = b.parent_id === undefined ? c.parent_id : (b.parent_id || null);
  if (pid) {
    if (Number(pid) === c.id) return res.status(400).json({ error: 'لا يمكن أن يكون القسم فرعاً من نفسه' });
    const pchain = catChain(pid, cats);
    if (!pchain) return res.status(400).json({ error: 'القسم الأب غير موجود' });
    if (pchain.some(x => x.id === c.id)) return res.status(400).json({ error: 'لا يمكن النقل داخل أحد فروعه' });
    // height of this node's subtree
    const height = (node) => {
      let h = 1;
      for (const ch of cats.filter(x => x.parent_id === node.id)) h = Math.max(h, 1 + height(ch));
      return h;
    };
    if (pchain.length + height(c) > CAT_MAX_DEPTH) {
      return res.status(400).json({ error: `النقل غير ممكن — سيتجاوز الحد ${CAT_MAX_DEPTH} مستويات` });
    }
  }
  const dup = get('SELECT id FROM categories WHERE TRIM(name) = ? AND COALESCE(parent_id,0) = COALESCE(?,0) AND id != ?', [name.trim(), pid, c.id]);
  if (dup) {
    return res.status(400).json({ error: pid ? 'يوجد فئة أو نوع فرعي بنفس الاسم تحت هذا القسم الأب' : 'يوجد قسم رئيسي بنفس الاسم بالفعل' });
  }
  run('UPDATE categories SET name = ?, parent_id = ? WHERE id = ?', [name, pid, c.id]);
  res.json({ ok: true });
});
app.delete('/api/categories/:id', auth, permOrAdmin('products.edit'), (req, res) => {
  const c = get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'القسم غير موجود' });
  const subs = get('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?', [c.id]).n;
  if (subs > 0) return res.status(400).json({ error: `لا يمكن الحذف — يحتوي ${subs} فئة فرعية. احذف الفئات الفرعية أولاً` });
  const prods = get('SELECT COUNT(*) AS n FROM products WHERE category_id = ?', [c.id]).n;
  if (prods > 0) return res.status(400).json({ error: `لا يمكن الحذف — يوجد ${prods} منتج بهذا القسم` });
  run('DELETE FROM categories WHERE id = ?', [c.id]);
  res.json({ ok: true });
});
app.post('/api/categories/move-subs', auth, permOrAdmin('products.edit'), (req, res) => {
  const { from, to } = req.body || {};
  const src = get('SELECT * FROM categories WHERE id = ?', [from]);
  const dst = get('SELECT * FROM categories WHERE id = ?', [to]);
  if (!src || !dst) return res.status(400).json({ error: 'قسم غير موجود' });
  if (dst.parent_id) return res.status(400).json({ error: 'القسم الهدف يجب أن يكون قسماً رئيسياً' });
  run('UPDATE categories SET parent_id = ? WHERE parent_id = ?', [dst.id, src.id]);
  res.json({ ok: true });
});

/* ==================== PRODUCTS ==================== */
app.get('/api/products', auth, (req, res) => {
  const q = req.query.q || '';
  const cat = req.query.category_id || '';
  const lowStock = req.query.low_stock === '1' || req.query.low_stock === 'true';
  let sql = `SELECT p.*, c.name AS category_name, pc.name AS parent_cat_name, gc.name AS grand_cat_name,
             (SELECT GROUP_CONCAT(serial_number, ',') FROM product_serials ps WHERE ps.product_id = p.id AND ps.status = 'available') AS available_serials_str
             FROM products p LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN categories pc ON pc.id = c.parent_id
             LEFT JOIN categories gc ON gc.id = pc.parent_id
             WHERE 1=1`;
  const params = [];
  if (q) {
    sql += ` AND (p.name LIKE ? OR p.barcode LIKE ? OR EXISTS (SELECT 1 FROM product_serials ps WHERE ps.product_id = p.id AND ps.status = 'available' AND ps.serial_number LIKE ?))`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (cat) {
    const selfCat = get('SELECT id, parent_id FROM categories WHERE id = ?', [Number(cat)]);
    if (selfCat && !selfCat.parent_id) {
      // قسم رئيسي: يضم كل السلالة تحته (فروع وأنواع)
      const cats = all('SELECT id, parent_id FROM categories');
      const kidsOf = (id) => cats.filter(c => Number(c.parent_id) === Number(id)).map(c => c.id);
      const ids = [Number(cat)];
      for (let i = 0; i < ids.length; i++) ids.push(...kidsOf(ids[i]));
      sql += ` AND p.category_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    } else {
      // فئة فرعية / نوع فرعي: تطابق مباشر بالضبط
      sql += ' AND p.category_id = ?';
      params.push(Number(cat));
    }
  }
  if (lowStock) {
    sql += ' AND p.stock <= p.min_stock AND p.active = 1';
  }
  sql += ' ORDER BY p.name';
  const products = all(sql, params).map(p => ({
    ...p,
    available_serials: p.available_serials_str ? p.available_serials_str.split(',').map(s => s.trim()).filter(Boolean) : []
  }));
  res.json(products);
});
function generateAutoBarcode() {
  let guard = 0;
  while (guard++ < 100) {
    const code = '20' + String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const exists = get('SELECT id FROM products WHERE barcode = ?', [code]);
    if (!exists) return code;
  }
  return '20' + Date.now();
}

app.post('/api/products', auth, permOrAdmin('products.edit'), (req, res) => {
  const { barcode, auto_barcode, name, category_id, purchase_price, sale_price, min_stock, unit, has_serials } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'اسم المنتج مطلوب' });

  let finalBarcode = barcode ? String(barcode).trim() : null;
  if (auto_barcode || !finalBarcode) {
    finalBarcode = generateAutoBarcode();
  } else {
    const exists = get('SELECT id FROM products WHERE barcode = ?', [finalBarcode]);
    if (exists) return res.status(400).json({ error: 'الباركود موجود بالفعل لمنتج آخر' });
  }

  const r = run(`INSERT INTO products (barcode, name, category_id, purchase_price, sale_price, stock, min_stock, unit, has_serials)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
    [finalBarcode, String(name).trim(), category_id || null, Number(purchase_price) || 0, Number(sale_price) || 0, 0, Number(min_stock) || 0, unit || 'قطعة', has_serials ? 1 : 0]);
  res.json({ ok: true, id: r.lastInsertRowid, barcode: finalBarcode });
});

app.put('/api/products/:id', auth, permOrAdmin('products.edit'), (req, res) => {
  const p = get('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'المنتج غير موجود' });
  const b = req.body || {};

  let finalBarcode = p.barcode;
  if (b.auto_barcode) {
    finalBarcode = generateAutoBarcode();
  } else if (b.barcode !== undefined && String(b.barcode).trim()) {
    finalBarcode = String(b.barcode).trim();
    if (finalBarcode !== p.barcode) {
      const exists = get('SELECT id FROM products WHERE barcode = ? AND id != ?', [finalBarcode, p.id]);
      if (exists) return res.status(400).json({ error: 'الباركود موجود لمنتج آخر' });
    }
  }

  const newSale = b.sale_price === undefined ? p.sale_price : Number(b.sale_price);
  const newCat = b.category_id === undefined ? p.category_id : (b.category_id || null);
  const newHasSerials = b.has_serials === undefined ? p.has_serials : (b.has_serials ? 1 : 0);

  run(`UPDATE products SET barcode=?, name=?, category_id=?, purchase_price=?, sale_price=?, stock=?, min_stock=?, unit=?, active=?, has_serials=?
       WHERE id=?`,
    [finalBarcode, b.name ?? p.name, newCat,
     b.purchase_price ?? p.purchase_price, newSale, b.stock ?? p.stock,
     b.min_stock ?? p.min_stock, b.unit ?? p.unit, b.active === undefined ? p.active : b.active ? 1 : 0, newHasSerials, p.id]);

  if (Math.abs(newSale - p.sale_price) > 0.001) {
    run('INSERT INTO price_history (product_id, old_price, new_price, user_id, note) VALUES (?,?,?,?,?)',
      [p.id, p.sale_price, newSale, req.user.id, 'تعديل يدوي']);
  }
  res.json({ ok: true, barcode: finalBarcode });
});

app.delete('/api/products/:id', auth, permOrAdmin('products.edit'), (req, res) => {
  const id = Number(req.params.id);
  const p = get('SELECT * FROM products WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'المنتج غير موجود' });

  const sales = get('SELECT COUNT(*) AS c FROM sale_items WHERE product_id = ?', [id]).c;
  if (sales > 0) return res.status(400).json({ error: `لا يمكن حذف المنتج "${p.name}" لارتباطه بـ ${sales} حركة مبيعات — يمكنك إيقافه بدلاً من الحذف` });

  const purchases = get('SELECT COUNT(*) AS c FROM purchase_items WHERE product_id = ?', [id]).c;
  if (purchases > 0) return res.status(400).json({ error: `لا يمكن حذف المنتج "${p.name}" لارتباطه بـ ${purchases} حركة مشتريات — يمكنك إيقافه بدلاً من الحذف` });

  const rets = get('SELECT COUNT(*) AS c FROM return_items WHERE product_id = ?', [id]).c;
  if (rets > 0) return res.status(400).json({ error: `لا يمكن حذف المنتج "${p.name}" لارتباطه بـ ${rets} حركة مرتجعات — يمكنك إيقافه بدلاً من الحذف` });

  run('DELETE FROM price_history WHERE product_id = ?', [id]);
  run('DELETE FROM stocktake_items WHERE product_id = ?', [id]);
  run('DELETE FROM products WHERE id = ?', [id]);
  res.json({ ok: true, message: 'تم حذف المنتج بنجاح' });
});

app.post('/api/products/bulk-price', auth, permOrAdmin('products.edit'), (req, res) => {
  const { percent, category_id, target } = req.body || {};
  const pct = Number(percent) || 0;
  const tgt = target === 'purchase' ? 'purchase_price' : 'sale_price';
  if (pct === 0) return res.status(400).json({ error: 'أدخل نسبة التغيير' });
  let sql = `SELECT * FROM products WHERE 1=1`;
  const params = [];
  if (category_id) { sql += ' AND category_id = ?'; params.push(category_id); }
  const products = all(sql, params);
  const doBulk = transaction(() => {
    let count = 0;
    for (const p of products) {
      const oldP = p[tgt];
      const newP = Math.round(oldP * (1 + pct / 100) * 100) / 100;
      if (newP < 0) continue;
      run(`UPDATE products SET ${tgt} = ? WHERE id = ?`, [newP, p.id]);
      run('INSERT INTO price_history (product_id, old_price, new_price, user_id, note) VALUES (?,?,?,?,?)',
        [p.id, oldP, newP, req.user.id, `تعديل جماعي ${pct > 0 ? '+' : ''}${pct}%`]);
      count++;
    }
    return count;
  });
  const count = doBulk();
  res.json({ ok: true, count });
});

app.get('/api/price-history', auth, permOrAdmin('products.edit'), (req, res) => {
  const product_id = req.query.product_id || '';
  let sql = `SELECT ph.*, p.name AS product_name, u.full_name AS cashier
             FROM price_history ph
             JOIN products p ON p.id = ph.product_id
             LEFT JOIN users u ON u.id = ph.user_id
             WHERE 1=1`;
  const params = [];
  if (product_id) { sql += ' AND ph.product_id = ?'; params.push(product_id); }
  sql += ' ORDER BY ph.id DESC LIMIT 300';
  res.json(all(sql, params));
});
app.post('/api/products/:id/stock', auth, permOrAdmin('products.edit'), (req, res) => {
  const p = get('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'المنتج غير موجود' });
  const { delta } = req.body || {};
  const qty = Number(delta) || 0;
  run('UPDATE products SET stock = stock + ? WHERE id = ?', [qty, p.id]);
  res.json({ ok: true });
});

/* ---------- EXPORT PRODUCTS TO EXCEL/CSV (ADMIN ONLY) ---------- */
app.get('/api/products/export', auth, adminOnly, (req, res) => {
  const products = all(`
    SELECT p.*, c.name AS category_name, pc.name AS parent_cat_name, gc.name AS grand_cat_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    LEFT JOIN categories gc ON gc.id = pc.parent_id
    ORDER BY p.id ASC
  `);

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val).replace(/"/g, '""');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str}"`;
    }
    return str;
  };

  const headers = [
    'الباركود',
    'اسم المنتج',
    'القسم الرئيسي',
    'الفئة الفرعية',
    'النوع الفرعي',
    'سعر الشراء',
    'سعر البيع',
    'المخزون الحالي',
    'الحد الأدنى للمخزون',
    'الوحدة',
    'تتبع السيريال (1/0)',
    'الحالة (1/0)'
  ];

  const rows = [headers.join(',')];

  for (const p of products) {
    const row = [
      escapeCsv(p.barcode || ''),
      escapeCsv(p.name || ''),
      escapeCsv(p.grand_cat_name ? p.grand_cat_name : (p.parent_cat_name ? p.parent_cat_name : (p.category_name || ''))),
      escapeCsv(p.grand_cat_name ? p.parent_cat_name : (p.parent_cat_name ? p.category_name : '')),
      escapeCsv(p.grand_cat_name ? p.category_name : ''),
      escapeCsv(p.purchase_price || 0),
      escapeCsv(p.sale_price || 0),
      escapeCsv(p.stock || 0),
      escapeCsv(p.min_stock || 0),
      escapeCsv(p.unit || 'قطعة'),
      escapeCsv(p.has_serials ? 1 : 0),
      escapeCsv(p.active ? 1 : 0)
    ];
    rows.push(row.join(','));
  }

  const bom = '\uFEFF';
  const csvContent = bom + rows.join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="products_export.csv"');
  res.send(csvContent);
});

/* ---------- IMPORT PRODUCTS FROM EXCEL/CSV (ADMIN ONLY) ---------- */
app.post('/api/products/import', auth, adminOnly, (req, res) => {
  const { items, replaceStock } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'لا توجد بيانات صالحة للاسترداد' });
  }

  const categoriesList = all('SELECT * FROM categories');

  const getOrCreateCat = (mainName, subName, typeName) => {
    if (!mainName || !String(mainName).trim()) return null;
    const mName = String(mainName).trim();
    let mainCat = categoriesList.find(c => !c.parent_id && c.name.toLowerCase() === mName.toLowerCase());
    if (!mainCat) {
      const r = run('INSERT INTO categories (name, parent_id) VALUES (?, NULL)', [mName]);
      mainCat = { id: r.lastInsertRowid, name: mName, parent_id: null };
      categoriesList.push(mainCat);
    }
    let targetCatId = mainCat.id;

    if (subName && String(subName).trim()) {
      const sName = String(subName).trim();
      let subCat = categoriesList.find(c => Number(c.parent_id) === Number(mainCat.id) && c.name.toLowerCase() === sName.toLowerCase());
      if (!subCat) {
        const r = run('INSERT INTO categories (name, parent_id) VALUES (?, ?)', [sName, mainCat.id]);
        subCat = { id: r.lastInsertRowid, name: sName, parent_id: mainCat.id };
        categoriesList.push(subCat);
      }
      targetCatId = subCat.id;

      if (typeName && String(typeName).trim()) {
        const tName = String(typeName).trim();
        let typeCat = categoriesList.find(c => Number(c.parent_id) === Number(subCat.id) && c.name.toLowerCase() === tName.toLowerCase());
        if (!typeCat) {
          const r = run('INSERT INTO categories (name, parent_id) VALUES (?, ?)', [tName, subCat.id]);
          typeCat = { id: r.lastInsertRowid, name: tName, parent_id: subCat.id };
          categoriesList.push(typeCat);
        }
        targetCatId = typeCat.id;
      }
    }
    return targetCatId;
  };

  const importTx = transaction(() => {
    let created = 0;
    let updated = 0;

    for (const item of items) {
      let barcode = item.barcode ? String(item.barcode).trim() : '';
      const name = item.name ? String(item.name).trim() : '';
      if (!name) continue;

      const categoryId = getOrCreateCat(item.main_category, item.sub_category, item.type_category);
      const purchasePrice = Number(item.purchase_price) || 0;
      const salePrice = Number(item.sale_price) || 0;
      const stock = Number(item.stock) || 0;
      const minStock = Number(item.min_stock) || 0;
      const unit = item.unit ? String(item.unit).trim() : 'قطعة';
      const hasSerials = (item.has_serials === 1 || item.has_serials === '1' || item.has_serials === true || String(item.has_serials).trim() === 'نعم') ? 1 : 0;
      const active = (item.active === 0 || item.active === '0' || item.active === false || String(item.active).trim() === 'موقوف') ? 0 : 1;

      let existing = null;
      if (barcode) {
        existing = get('SELECT * FROM products WHERE barcode = ?', [barcode]);
      } else {
        existing = get('SELECT * FROM products WHERE name = ?', [name]);
      }

      if (existing) {
        let finalStock = existing.stock;
        if (replaceStock || item.stock !== undefined) {
          finalStock = stock;
        }
        const finalBarcode = barcode || existing.barcode;
        run(`UPDATE products SET barcode=?, name=?, category_id=?, purchase_price=?, sale_price=?, stock=?, min_stock=?, unit=?, has_serials=?, active=? WHERE id=?`,
          [finalBarcode, name, categoryId !== null ? categoryId : existing.category_id, purchasePrice, salePrice, finalStock, minStock, unit, hasSerials, active, existing.id]);
        updated++;
      } else {
        if (!barcode) barcode = generateAutoBarcode();
        run(`INSERT INTO products (barcode, name, category_id, purchase_price, sale_price, stock, min_stock, unit, has_serials, active)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [barcode, name, categoryId, purchasePrice, salePrice, stock, minStock, unit, hasSerials, active]);
        created++;
      }
    }
    return { created, updated, total: created + updated };
  });

  try {
    const result = importTx();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ أثناء استرداد شيت المنتجات: ' + (err.message || err) });
  }
});

/* ==================== PARTIES (suppliers/customers) ==================== */
app.get('/api/parties', auth, (req, res) => {
  const type = req.query.type || '';
  const sel = `SELECT p.*,
    (SELECT amount FROM payments WHERE party_id = p.id AND pay_type = 'opening' LIMIT 1) AS opening_amount,
    (SELECT type FROM payments WHERE party_id = p.id AND pay_type = 'opening' LIMIT 1) AS opening_type
    FROM parties p`;
  if (type) return res.json(all(sel + ' WHERE p.type = ? ORDER BY p.name', [type]));
  res.json(all(sel + ' ORDER BY p.name'));
});
app.post('/api/parties', auth, permOrAdmin('parties.edit'), (req, res) => {
  const { type, name, phone, address, opening_balance, opening_direction } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (!['supplier', 'customer'].includes(type)) return res.status(400).json({ error: 'نوع غير صحيح' });
  const ob = Math.round((Number(opening_balance) || 0) * 100) / 100;
  // الرصيد الافتتاحي: عميل "عليه" => +balance | عميل "له" => -balance | مورد "مستحق له" => -balance | مورد "دفعنا له" => +balance
  let delta = 0;
  if (ob > 0) {
    delta = opening_direction === 'prepaid' ? -ob : ob;
    if (type === 'supplier') delta = -delta;
  }
  const r = run('INSERT INTO parties (type, name, phone, address, balance) VALUES (?,?,?,?,?)', [type, name, phone || '', address || '', delta]);
  if (delta !== 0) {
    run('INSERT INTO payments (party_id, type, pay_type, amount, note, user_id) VALUES (?,?,?,?,?,?)',
      [r.lastInsertRowid, delta > 0 ? 'out' : 'in', 'opening', ob, 'رصيد افتتاحي', req.user.id]);
  }
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/parties/:id', auth, permOrAdmin('parties.edit'), (req, res) => {
  const p = get('SELECT * FROM parties WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'غير موجود' });
  const b = req.body || {};
  run('UPDATE parties SET name=?, phone=?, address=? WHERE id=?', [b.name ?? p.name, b.phone ?? p.phone, b.address ?? p.address, p.id]);

  /* تعديل/إضافة/إلغاء الرصيد الافتتاحي — الفرق يُطبق على رصيد الحساب */
  if (b.opening_balance !== undefined) {
    const r2 = (v) => Math.round(v * 100) / 100;
    const ob = Math.max(0, r2(Number(b.opening_balance) || 0));
    const dir = b.opening_direction;
    const old = get("SELECT * FROM payments WHERE party_id = ? AND pay_type = 'opening' LIMIT 1", [p.id]);
    const oldDelta = old ? (old.type === 'out' ? Number(old.amount) : -Number(old.amount)) : 0;
    let newDelta = 0;
    if (ob > 0) {
      newDelta = dir === 'prepaid' ? -ob : ob;
      if (p.type === 'supplier') newDelta = -newDelta;
    }
    if (old && ob <= 0) {
      run('DELETE FROM payments WHERE id = ?', [old.id]);
      run('UPDATE parties SET balance = balance - ? WHERE id = ?', [oldDelta, p.id]);
    } else if (ob > 0) {
      const rowType = newDelta > 0 ? 'out' : 'in';
      if (old) run('UPDATE payments SET type = ?, amount = ? WHERE id = ?', [rowType, ob, old.id]);
      else run('INSERT INTO payments (party_id, type, pay_type, amount, note, user_id) VALUES (?,?,?,?,?,?)',
        [p.id, rowType, 'opening', ob, 'رصيد افتتاحي', req.user.id]);
      const diff = r2(newDelta - oldDelta);
      if (diff !== 0) run('UPDATE parties SET balance = balance + ? WHERE id = ?', [diff, p.id]);
    }
  }
  res.json({ ok: true });
});
app.post('/api/parties/:id/payment', auth, permOrAdmin('parties.edit'), (req, res) => {
  const { amount, type, note, pay_type } = req.body || {};
  const amt = Number(amount) || 0;
  if (!amt) return res.status(400).json({ error: 'المبلغ مطلوب' });
  const t = type === 'in' ? 'in' : 'out';
  const pt = ['arabon', 'debt', 'other'].includes(pay_type) ? pay_type : 'other';
  const m = ['cash', 'card', 'wallet', 'transfer'].includes(req.body?.method) ? req.body.method : 'cash';
  run('INSERT INTO payments (party_id, type, pay_type, amount, note, user_id, method) VALUES (?,?,?,?,?,?,?)', [req.params.id, t, pt, amt, note || '', req.user.id, m]);
  // in = payment received from customer / paid to supplier -> reduces balance
  const delta = t === 'in' ? -amt : amt;
  run('UPDATE parties SET balance = balance + ? WHERE id = ?', [delta, req.params.id]);
  res.json({ ok: true });
});

/* ==================== EMPLOYEES ==================== */
const EMP_ROLES = ['general', 'cashier', 'accountant', 'marketing', 'maint_worker'];
const EMP_PAY_TYPES = ['fixed', 'commission'];

function saveCommissions(empId, commissions) {
  run('DELETE FROM employee_commissions WHERE employee_id = ?', [empId]);
  for (const c of Array.isArray(commissions) ? commissions : []) {
    const scope = c.scope === 'maintenance' ? 'maintenance' : 'category';
    let cid = null;
    if (scope === 'category') {
      cid = Number(c.category_id) || null;
      if (!cid) continue;
    }
    const pct = Math.max(0, Math.min(100, Number(c.percent) || 0));
    if (!pct) continue;
    run('INSERT INTO employee_commissions (employee_id, scope, category_id, percent) VALUES (?,?,?,?)',
      [empId, scope, cid, pct]);
  }
}

app.get('/api/employees', auth, (req, res) => {
  const list = all('SELECT * FROM employees ORDER BY active DESC, name');
  const m = monthKey();
  const today = new Date().toISOString().slice(0, 10);
  const comms = all('SELECT * FROM employee_commissions');
  const cats = all('SELECT id, name, parent_id FROM categories');
  const catName = (id) => { const c = cats.find(x => x.id === id); return c ? c.name : null; };
  for (const e of list) {
    e.salary_closed = !!get('SELECT id FROM salary_closings WHERE employee_id = ? AND month = ?', [e.id, m]);
    const vac = get(`SELECT end_date, type FROM vacations
                     WHERE employee_id = ? AND start_date <= ? AND end_date >= ?
                     ORDER BY end_date DESC LIMIT 1`, [e.id, today, today]);
    if (vac) { e.on_vacation = 1; e.vacation_until = vac.end_date; }
    else { e.on_vacation = 0; e.vacation_until = null; }
    e.commissions = comms.filter(c => c.employee_id === e.id).map(c => ({
      scope: c.scope,
      category_id: c.category_id,
      category_name: c.scope === 'category' ? catName(c.category_id) : null,
      percent: c.percent,
    }));
  }
  res.json(list);
});
app.post('/api/employees', auth, permOrAdmin('parties.edit'), (req, res) => {
  const { name, phone, address, job_title, salary, hire_date, national_id, emp_role, pay_type, commissions } = req.body || {};
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const role = EMP_ROLES.includes(emp_role) ? emp_role : 'general';
  const pt = EMP_PAY_TYPES.includes(pay_type) ? pay_type : 'fixed';
  const r = run('INSERT INTO employees (name, phone, address, job_title, salary, emp_role, pay_type, hire_date, national_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [name, phone || '', address || '', job_title || '', Number(salary) || 0, role, pt, hire_date || null, national_id || '']);
  if (pt === 'commission' && Array.isArray(commissions)) saveCommissions(r.lastInsertRowid, commissions);
  res.json({ ok: true });
});
app.put('/api/employees/:id', auth, permOrAdmin('parties.edit'), (req, res) => {
  const e = get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!e) return res.status(404).json({ error: 'غير موجود' });
  const b = req.body || {};
  const role = b.emp_role === undefined ? e.emp_role : (EMP_ROLES.includes(b.emp_role) ? b.emp_role : 'general');
  const pt = b.pay_type === undefined ? e.pay_type : (EMP_PAY_TYPES.includes(b.pay_type) ? b.pay_type : 'fixed');
  run('UPDATE employees SET name=?, phone=?, address=?, job_title=?, salary=?, emp_role=?, pay_type=?, hire_date=?, national_id=?, active=? WHERE id=?',
    [b.name ?? e.name, b.phone ?? e.phone, b.address ?? e.address, b.job_title ?? e.job_title,
     b.salary ?? e.salary, role, pt, b.hire_date ?? e.hire_date, b.national_id ?? e.national_id,
     b.active ?? e.active, e.id]);
  if (Array.isArray(b.commissions)) saveCommissions(e.id, pt === 'commission' ? b.commissions : []);
  res.json({ ok: true });
});
app.post('/api/employees/:id/advance', auth, permOrAdmin('parties.edit'), (req, res) => {
  const { amount, type, note } = req.body || {};
  const amt = Number(amount) || 0;
  if (!amt) return res.status(400).json({ error: 'المبلغ مطلوب' });
  const e = get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!e) return res.status(404).json({ error: 'غير موجود' });
  const t = type === 'in' ? 'in' : 'out'; // out = سلفة تُصرف للموظف، in = سداد/خصم من الراتب
  const delta = t === 'out' ? amt : -amt;
  const m = ['cash', 'card', 'wallet', 'transfer'].includes(req.body?.method) ? req.body.method : 'cash';
  run('UPDATE employees SET balance = balance + ? WHERE id = ?', [delta, e.id]);
  run('INSERT INTO payments (employee_id, type, pay_type, amount, note, user_id, method) VALUES (?,?,?,?,?,?,?)', [e.id, t, 'other', amt, note || '', req.user.id, m]);
  res.json({ ok: true, balance: e.balance + delta });
});

/* ==================== SALARY CLOSINGS ==================== */
function monthKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// monthly commission of an employee: sales-category profits + maintenance labor
function employeeCommission(e, m) {
  const entries = all('SELECT * FROM employee_commissions WHERE employee_id = ?', [e.id]);
  if (!entries.length) return { total: 0, sales: 0, maintenance: 0 };
  const cats = all('SELECT id, parent_id FROM categories');

  let sales = 0;
  const catEntries = entries.filter(c => c.scope === 'category' && c.category_id);
  if (catEntries.length) {
    // expand every selected category to its full subtree for the profit query
    const kidsMap = {};
    for (const c of cats) {
      const pid = c.parent_id || null;
      (kidsMap[pid] = kidsMap[pid] || []).push(c.id);
    }
    const allIds = new Set();
    for (const c of catEntries) {
      const stack = [Number(c.category_id)];
      while (stack.length) {
        const id = stack.pop();
        if (allIds.has(id)) continue;
        allIds.add(id);
        stack.push(...(kidsMap[id] || []));
      }
    }
    const ph = [...allIds].map(() => '?').join(',');
    const rows = all(`SELECT p.category_id AS cid,
                             COALESCE(SUM(si.total - si.qty * COALESCE(p.purchase_price,0)),0) AS pf
                      FROM sale_items si
                      JOIN sales s ON s.id = si.sale_id
                      JOIN products p ON p.id = si.product_id
                      WHERE substr(s.created_at,1,7) = ? AND p.category_id IN (${ph})
                      GROUP BY p.category_id`, [m, ...allIds]);
    const parentMap = {};
    for (const c of cats) parentMap[c.id] = c.parent_id || null;
    const selPct = new Map(catEntries.map(c => [Number(c.category_id), Number(c.percent)]));
    for (const r of rows) {
      const pf = Number(r.pf) || 0;
      if (!pf) continue;
      // credit the DEEPEST selected ancestor (or the node itself) to prevent double counting
      let cur = Number(r.cid);
      let guard = 0;
      while (cur && guard++ < 10) {
        if (selPct.has(cur)) { sales += pf * selPct.get(cur) / 100; break; }
        cur = parentMap[cur];
      }
    }
    sales = Math.max(0, Math.round(sales * 100) / 100);
  }

  let maintenance = 0;
  if ((e.emp_role || '') === 'maint_worker') {
    const mEntries = entries.filter(c => c.scope === 'maintenance');
    if (mEntries.length) {
      const labor = Number(get(`SELECT COALESCE(SUM(labor_cost),0) AS s FROM maintenance_jobs
                                WHERE substr(created_at,1,7) = ? AND status != 'cancelled'`, [m]).s) || 0;
      for (const c of mEntries) maintenance += labor * (Number(c.percent) / 100);
      maintenance = Math.max(0, Math.round(maintenance * 100) / 100);
    }
  }
  return { total: Math.round((sales + maintenance) * 100) / 100, sales, maintenance };
}

app.post('/api/employees/:id/salary-close', auth, permOrAdmin('parties.edit'), (req, res) => {
  const e = get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!e) return res.status(404).json({ error: 'غير موجود' });
  const { month, amount, note } = req.body || {};
  const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : monthKey();
  const existing = get('SELECT id FROM salary_closings WHERE employee_id = ? AND month = ?', [e.id, m]);
  if (existing) return res.status(400).json({ error: 'تم تقفيل مرتب هذا الشهر مسبقاً' });
  const salary = Number(e.salary) || 0;
  const bal = Number(e.balance) || 0;
  // commission (sales categories + maintenance labor) for the closed month
  const comm = employeeCommission(e, m);
  const base = e.pay_type === 'commission' ? comm.total : salary;
  // unpaid vacations of this month are deducted automatically from the salary
  const vacCut = Math.round((get(`SELECT COALESCE(SUM(deduction),0) AS s FROM vacations
      WHERE employee_id = ? AND type = 'unpaid' AND substr(start_date,1,7) = ?`, [e.id, m]).s || 0) * 100) / 100;
  const auto = Math.max(0, Math.round((base - bal - vacCut) * 100) / 100);
  const amt = amount === undefined || amount === null || amount === '' ? auto : Number(amount);
  if (!(amt >= 0)) return res.status(400).json({ error: 'المبلغ غير صحيح' });
  const settled = Math.min(Math.max(bal, 0), Math.max(base, 0));
  const notes = [];
  if (note) notes.push(note);
  if (comm.sales > 0.001) notes.push('عمولة مبيعات: ' + comm.sales.toFixed(2));
  if (comm.maintenance > 0.001) notes.push('عمولة صيانة: ' + comm.maintenance.toFixed(2));
  if (vacCut > 0.001) notes.push('خصم إجازات بدون مرتب: ' + vacCut.toFixed(2));
  const fullNote = notes.join(' — ');
  const doClose = transaction(() => {
    run('INSERT INTO salary_closings (employee_id, month, amount, note, user_id) VALUES (?,?,?,?,?)', [e.id, m, amt, fullNote.slice(0, 300), req.user.id]);
    if (settled > 0.001) {
      run('UPDATE employees SET balance = balance - ? WHERE id = ?', [settled, e.id]);
      run('INSERT INTO payments (employee_id, type, pay_type, amount, note, user_id) VALUES (?,?,?,?,?,?)',
        [e.id, 'in', 'other', settled, 'خصم سلفة من مرتب ' + m, req.user.id]);
    }
    return settled;
  });
  const done = doClose();
  res.json({ ok: true, month: m, amount: amt, vac_cut: vacCut, sales_commission: comm.sales, maintenance_commission: comm.maintenance, balance: Math.round((Number(e.balance) - done) * 100) / 100 });
});

// commission preview for the salary-close modal
app.get('/api/employees/:id/commission', auth, permOrAdmin('parties.edit'), (req, res) => {
  const e = get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!e) return res.status(404).json({ error: 'غير موجود' });
  const m = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : monthKey();
  const comm = employeeCommission(e, m);
  res.json({ month: m, sales: comm.sales, maintenance: comm.maintenance, total: comm.total });
});

app.get('/api/employees/:id/salary-closings', auth, (req, res) => {
  res.json(all('SELECT * FROM salary_closings WHERE employee_id = ? ORDER BY month DESC', [req.params.id]));
});

/* ==================== VACATIONS ==================== */
const VAC_TYPES = ['paid', 'unpaid', 'sick'];
function vacDays(a, b) {
  const ms = new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00');
  return Math.floor(ms / 86400000) + 1;
}

app.get('/api/employees/:id/vacations', auth, (req, res) => {
  const e = get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!e) return res.status(404).json({ error: 'الموظف غير موجود' });
  const list = all(`SELECT v.*, u.full_name AS created_by_name
                    FROM vacations v LEFT JOIN users u ON u.id = v.created_by
                    WHERE v.employee_id = ? ORDER BY v.start_date DESC`, [req.params.id]);
  res.json({ list });
});

app.post('/api/employees/:id/vacations', auth, permOrAdmin('parties.edit'), (req, res) => {
  const e = get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!e) return res.status(404).json({ error: 'الموظف غير موجود' });
  const { start_date, end_date, type, note } = req.body || {};
  const okDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  if (!okDate(start_date) || !okDate(end_date)) return res.status(400).json({ error: 'أدخل تاريخ بداية ونهاية صحيحين' });
  if (end_date < start_date) return res.status(400).json({ error: 'تاريخ النهاية يجب أن يكون بعد أو مساوياً تاريخ البداية' });
  const t = VAC_TYPES.includes(type) ? type : 'paid';
  const overlap = get(`SELECT id FROM vacations WHERE employee_id = ? AND start_date <= ? AND end_date >= ?`,
    [e.id, end_date, start_date]);
  if (overlap) return res.status(400).json({ error: 'يوجد تعارض مع إجازة مسجلة في نفس الفترة' });

  // days + salary deduction for unpaid vacations (rate = monthly salary / calendar days of the start month)
  const days = vacDays(start_date, end_date);
  let deduction = 0;
  if (t === 'unpaid') {
    const dim = new Date(Number(start_date.slice(0, 4)), Number(start_date.slice(5, 7)), 0).getDate();
    deduction = Math.round(((Number(e.salary) || 0) / dim) * days * 100) / 100;
  }
  run('INSERT INTO vacations (employee_id, start_date, end_date, type, note, days, deduction, created_by) VALUES (?,?,?,?,?,?,?,?)',
    [e.id, start_date, end_date, t, String(note || '').slice(0, 300), days, deduction, req.user.id]);
  res.json({ ok: true, days, deduction });
});

app.delete('/api/vacations/:id', auth, permOrAdmin('parties.edit'), (req, res) => {
  const v = get('SELECT * FROM vacations WHERE id = ?', [req.params.id]);
  if (!v) return res.status(404).json({ error: 'الإجازة غير موجودة' });
  run('DELETE FROM vacations WHERE id = ?', [v.id]);
  res.json({ ok: true });
});

/* ==================== MOVEMENTS (party/employee statement) ==================== */
function payLabel(p) {
  if (p.pay_type === 'opening') return 'رصيد افتتاحي';
  if (p.type === 'in') {
    if (p.pay_type === 'arabon') return 'دفعة (عربون)';
    if (p.pay_type === 'debt') return 'دفعة (سداد مديونية)';
    return 'دفعة (قبض)';
  }
  if (p.pay_type === 'arabon') return 'دفعة (عربون للمورد)';
  if (p.pay_type === 'debt') return 'دفعة (سداد مستحقات)';
  return 'دفعة (صرف)';
}

app.get('/api/payments/:id', auth, (req, res) => {
  const p = get(`SELECT p.*, pa.name AS party_name, e.name AS employee_name
                 FROM payments p
                 LEFT JOIN parties pa ON pa.id = p.party_id
                 LEFT JOIN employees e ON e.id = p.employee_id
                 WHERE p.id = ?`, [req.params.id]);
  if (!p) return res.status(404).json({ error: 'الدفعة غير موجودة' });
  res.json(p);
});

app.get('/api/parties/:id/movements', auth, (req, res) => {
  const party = get('SELECT * FROM parties WHERE id = ?', [req.params.id]);
  if (!party) return res.status(404).json({ error: 'غير موجود' });

  const sales = all(`SELECT id, created_at, invoice_no AS ref, customer_name AS note, (total - paid) AS effect, total AS amount
                     FROM sales WHERE party_id = ? ORDER BY id`, [party.id]);
  const purchases = all(`SELECT id, created_at, invoice_no AS ref, '' AS note, -(total - paid) AS effect, total AS amount
                         FROM purchases WHERE supplier_id = ? ORDER BY id`, [party.id]);
  const returns = all(`SELECT rt.id, rt.created_at, rt.return_no AS ref, rt.refund_method, '' AS note,
                       CASE WHEN rt.refund_method = 'credit' THEN -rt.subtotal ELSE 0 END AS effect, rt.subtotal AS amount
                       FROM returns rt JOIN sales s ON s.id = rt.sale_id WHERE s.party_id = ? ORDER BY rt.id`, [party.id]);
  const payments = all(`SELECT id, created_at, amount, note, type, pay_type FROM payments WHERE party_id = ? ORDER BY id`, [party.id]);

  const movements = [];
  for (const r of sales) movements.push({ id: r.id, date: r.created_at, kind: 'sale', label: 'فاتورة بيع', ref: r.ref, note: r.note || '', amount: r.amount, effect: r.effect });
  for (const r of purchases) movements.push({ id: r.id, date: r.created_at, kind: 'purchase', label: 'فاتورة شراء', ref: r.ref, note: r.note || '', amount: r.amount, effect: r.effect });
  for (const r of returns) movements.push({ id: r.id, date: r.created_at, kind: 'return', label: 'مرتجع' + (r.refund_method === 'credit' ? ' (خصم من المستحق)' : ' (استرداد)'), ref: r.ref, note: r.note || '', amount: r.amount, effect: r.effect });
  for (const r of payments) movements.push({
    id: r.id,
    date: r.created_at,
    kind: r.type === 'in' ? 'pay_in' : 'pay_out',
    pay_type: r.pay_type,
    label: payLabel(r),
    ref: '',
    note: r.note || '',
    amount: r.amount,
    effect: r.type === 'in' ? -Number(r.amount) : Number(r.amount),
  });

  movements.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let bal = 0;
  for (const m of movements) { bal += Number(m.effect) || 0; m.running = Math.round(bal * 100) / 100; }

  const sum = (arr) => Math.round(arr.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
  res.json({
    entity: party,
    movements,
    summary: {
      sales_count: sales.length,
      sales_total: sum(sales),
      purchases_count: purchases.length,
      purchases_total: sum(purchases),
      returns_count: returns.length,
      returns_total: sum(returns),
      payments_in_count: payments.filter(p => p.type === 'in').length,
      payments_in_total: sum(payments.filter(p => p.type === 'in')),
      payments_out_count: payments.filter(p => p.type === 'out').length,
      payments_out_total: sum(payments.filter(p => p.type === 'out')),
    },
  });
});

app.get('/api/employees/:id/movements', auth, (req, res) => {
  const emp = get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'غير موجود' });
  const payments = all(`SELECT id, created_at, amount, note, type, pay_type FROM payments WHERE employee_id = ? ORDER BY id`, [emp.id]);
  const movements = payments.map(p => ({
    id: p.id,
    date: p.created_at,
    kind: p.type === 'out' ? 'advance' : 'repay',
    label: p.type === 'out' ? 'سلفة' : 'سداد / خصم من الراتب',
    ref: '',
    note: p.note || '',
    amount: p.amount,
    effect: p.type === 'out' ? Number(p.amount) : -Number(p.amount),
  }));
  let bal = 0;
  for (const m of movements) { bal += Number(m.effect) || 0; m.running = Math.round(bal * 100) / 100; }
  const sum = (arr) => Math.round(arr.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
  res.json({
    entity: emp,
    movements,
    summary: {
      advance_count: payments.filter(p => p.type === 'out').length,
      advance_total: sum(payments.filter(p => p.type === 'out')),
      repay_count: payments.filter(p => p.type === 'in').length,
      repay_total: sum(payments.filter(p => p.type === 'in')),
    },
  });
});

/* ==================== COUPONS ==================== */
app.get('/api/coupons', auth, permOrAdmin('coupons'), (req, res) => {
  res.json(all(`SELECT cp.*, pa.name AS customer_name
                FROM coupons cp LEFT JOIN parties pa ON pa.id = cp.party_id
                ORDER BY cp.id DESC`));
});
app.post('/api/coupons', auth, permOrAdmin('coupons'), (req, res) => {
  const { code, discount_type, value, min_total, max_uses, expires_at, party_id } = req.body || {};
  const c = String(code || '').trim().toUpperCase();
  if (!c) return res.status(400).json({ error: 'كود الكوبون مطلوب' });
  if (!discount_type || !(Number(value) > 0)) return res.status(400).json({ error: 'نوع الخصم وقيمته مطلوبان' });
  const exists = get('SELECT id FROM coupons WHERE code = ?', [c]);
  if (exists) return res.status(400).json({ error: 'الكوبون موجود بالفعل' });
  if (discount_type === 'percent' && Number(value) > 100) return res.status(400).json({ error: 'نسبة الخصم لا تزيد عن 100%' });
  run('INSERT INTO coupons (code, discount_type, value, min_total, max_uses, expires_at, party_id) VALUES (?,?,?,?,?,?,?)',
    [c, discount_type, Number(value), Number(min_total) || 0, Number(max_uses) || 0, expires_at || null, party_id || null]);
  res.json({ ok: true });
});
app.put('/api/coupons/:id', auth, permOrAdmin('coupons'), (req, res) => {
  const cp = get('SELECT * FROM coupons WHERE id = ?', [req.params.id]);
  if (!cp) return res.status(404).json({ error: 'غير موجود' });
  const b = req.body || {};
  if (b.discount_type === 'percent' && Number(b.value) > 100) return res.status(400).json({ error: 'نسبة الخصم لا تزيد عن 100%' });
  const newParty = b.party_id === undefined ? cp.party_id : (b.party_id === '' || b.party_id === null ? null : Number(b.party_id));
  run('UPDATE coupons SET discount_type=?, value=?, min_total=?, max_uses=?, expires_at=?, party_id=?, active=? WHERE id=?',
    [b.discount_type ?? cp.discount_type, b.value ?? cp.value, b.min_total ?? cp.min_total,
     b.max_uses ?? cp.max_uses, b.expires_at ?? cp.expires_at, newParty,
     b.active === undefined ? cp.active : b.active ? 1 : 0, cp.id]);
  res.json({ ok: true });
});
app.post('/api/coupons/validate', auth, (req, res) => {
  const { code, total, party_id } = req.body || {};
  const c = get('SELECT * FROM coupons WHERE code = ?', [String(code || '').trim().toUpperCase()]);
  if (!c || !c.active) return res.json({ valid: false, error: 'كوبون غير صالح' });
  if (c.party_id) {
    if (!party_id) return res.json({ valid: false, error: 'أدخل رقم هاتف العميل أولاً لتطبيق الكوبون الخاص' });
    if (Number(c.party_id) !== Number(party_id)) return res.json({ valid: false, error: 'هذا الكوبون خاص بعميل آخر' });
  }
  if (c.expires_at && c.expires_at < new Date().toISOString().slice(0, 10)) {
    if (c.source === 'loyalty') run('UPDATE coupons SET active = 0 WHERE id = ?', [c.id]);
    return res.json({ valid: false, error: 'الكوبون منتهي الصلاحية' });
  }
  if (c.max_uses > 0 && c.used_count >= c.max_uses) return res.json({ valid: false, error: 'تم استهلاك الكوبون بالكامل' });
  const t = Number(total) || 0;
  if (t < c.min_total) return res.json({ valid: false, error: `الحد الأدنى للاستخدام: ${Number(c.min_total).toFixed(2)}` });
  let discount = c.discount_type === 'percent' ? t * c.value / 100 : c.value;
  if (discount > t) discount = t;
  res.json({ valid: true, discount, coupon: c });
});

/* ==================== STOCKTAKES ==================== */
app.post('/api/stocktakes', auth, permOrAdmin('stocktake'), (req, res) => {
  const open = get('SELECT * FROM stocktakes WHERE status = ?', ['open']);
  if (open) return res.status(400).json({ error: 'يوجد جرد مفتوح بالفعل — أغلقه أولاً' });
  const ref = 'ST-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Date.now().toString().slice(-4);
  const products = all('SELECT id, name, stock FROM products WHERE active = 1');
  const doSt = transaction(() => {
    const r = run('INSERT INTO stocktakes (ref_no, user_id, branch_id) VALUES (?,?,?)', [ref, req.user.id, req.user.branch_id || null]);
    for (const p of products) {
      run('INSERT INTO stocktake_items (stocktake_id, product_id, system_stock, actual_stock, diff) VALUES (?,?,?,?,?)',
        [r.lastInsertRowid, p.id, p.stock, p.stock, 0]);
    }
    return r.lastInsertRowid;
  });
  res.json({ ok: true, id: doSt(), ref_no: ref });
});
app.get('/api/stocktakes', auth, (req, res) => {
  res.json(all(`SELECT st.*, u.full_name AS cashier, b.name AS branch_name,
                (SELECT COUNT(*) FROM stocktake_items si WHERE si.stocktake_id = st.id) AS items_count,
                (SELECT SUM(CASE WHEN si.diff != 0 THEN 1 ELSE 0 END) FROM stocktake_items si WHERE si.stocktake_id = st.id) AS diffs_count
                FROM stocktakes st JOIN users u ON u.id = st.user_id LEFT JOIN branches b ON b.id = st.branch_id
                ORDER BY st.id DESC LIMIT 100`));
});
app.get('/api/stocktakes/:id', auth, (req, res) => {
  const st = get('SELECT * FROM stocktakes WHERE id = ?', [req.params.id]);
  if (!st) return res.status(404).json({ error: 'غير موجود' });
  st.items = all(`SELECT si.*, p.name, p.unit, p.purchase_price, p.category_id
                  FROM stocktake_items si JOIN products p ON p.id = si.product_id
                  WHERE si.stocktake_id = ? ORDER BY p.name`, [st.id]);
  res.json(st);
});
app.put('/api/stocktakes/:id/items', auth, permOrAdmin('stocktake'), (req, res) => {
  const st = get('SELECT * FROM stocktakes WHERE id = ? AND status = ?', [req.params.id, 'open']);
  if (!st) return res.status(400).json({ error: 'الجرد غير موجود أو مغلق' });
  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'بيانات غير صحيحة' });
  const doUp = transaction(() => {
    for (const it of items) {
      const actual = Number(it.actual_stock);
      if (isNaN(actual)) continue;
      const row = get('SELECT * FROM stocktake_items WHERE stocktake_id = ? AND product_id = ?', [st.id, it.product_id]);
      if (row) run('UPDATE stocktake_items SET actual_stock = ?, diff = actual_stock - system_stock WHERE id = ?', [actual, row.id]);
    }
  });
  doUp();
  res.json({ ok: true });
});
app.post('/api/stocktakes/:id/close', auth, permOrAdmin('stocktake'), (req, res) => {
  const st = get('SELECT * FROM stocktakes WHERE id = ? AND status = ?', [req.params.id, 'open']);
  if (!st) return res.status(400).json({ error: 'الجرد غير موجود أو مغلق' });
  const doClose = transaction(() => {
    const items = all('SELECT * FROM stocktake_items WHERE stocktake_id = ?', [st.id]);
    for (const it of items) {
      const actual = it.actual_stock === null ? it.system_stock : Number(it.actual_stock);
      const diff = actual - it.system_stock;
      run('UPDATE stocktake_items SET actual_stock = ?, diff = ? WHERE id = ?', [actual, diff, it.id]);
      run('UPDATE products SET stock = ? WHERE id = ?', [actual, it.product_id]);
    }
    run('UPDATE stocktakes SET status = ?, closed_at = datetime(\'now\',\'localtime\') WHERE id = ?', ['closed', st.id]);
    return items.reduce((s, it) => {
      const a = it.actual_stock === null ? it.system_stock : Number(it.actual_stock);
      const diff = a - it.system_stock;
      const p = get('SELECT purchase_price FROM products WHERE id = ?', [it.product_id]);
      return s + diff * (p?.purchase_price || 0);
    }, 0);
  });
  const cost = doClose();
  res.json({ ok: true, diff_cost: cost });
});

/* ==================== SALES ==================== */
const PAY_METHODS = ['cash', 'card', 'wallet', 'credit'];
app.post('/api/sales', auth, (req, res) => {
  const { items, discount, paid, payment_method, payments, party_id, coupon_code, customer_phone, customer_name, customer_cash, credit, delivery_fee, delivery_address } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'الفاتورة فارغة' });
  const isCashCustomer = !!customer_cash;
  const phone = String(customer_phone || '').trim();
  if (!isCashCustomer && !phone) return res.status(400).json({ error: 'رقم هاتف العميل مطلوب — أدخله أو اختر "عميل نقدي"' });

  let payList;
  if (Array.isArray(payments) && payments.length) {
    payList = payments
      .map(p => ({ method: PAY_METHODS.includes(p.method) ? p.method : 'cash', amount: Math.round((Number(p.amount) || 0) * 100) / 100 }))
      .filter(p => p.amount > 0);
    if (payList.length === 0) payList = null;
  } else {
    payList = [{ method: PAY_METHODS.includes(payment_method) ? payment_method : 'cash', amount: paid === '' || paid === null || paid === undefined ? null : Math.round((Number(paid) || 0) * 100) / 100 }];
  }

  const doSale = transaction(() => {
    const customer = isCashCustomer ? null : resolveCustomer(phone, customer_name);
    const partyId = customer ? customer.id : (party_id || null);

    let subtotal = 0;
    for (const it of items) {
      const p = get('SELECT * FROM products WHERE id = ?', [it.product_id]);
      if (!p) return { error: `المنتج غير موجود` };
      if (!p.active) return { error: `المنتج "${p.name}" موقوف حالياً ولا يمكن بيعه` };
      const qty = Number(it.qty) || 0;
      if (qty <= 0) return { error: 'الكمية غير صحيحة' };
      if (p.stock < qty) return { error: `الكمية المطلوبة لـ "${p.name}" غير متوفرة (المخزون: ${p.stock})` };
      const serials = Array.isArray(it.serials) ? it.serials.map(s => String(s).trim()).filter(Boolean) : [];
      if (p.has_serials === 1 || serials.length > 0) {
        if (p.has_serials === 1 && serials.length !== qty) {
          return { error: `المنتج "${p.name}" يتطلب تحديد ${qty} سيريالات (تم تحديد ${serials.length})` };
        }
        for (const sn of serials) {
          const avail = get('SELECT id FROM product_serials WHERE product_id = ? AND serial_number = ? AND status = ?', [p.id, sn, 'available']);
          if (!avail) return { error: `السيريال "${sn}" غير متوفر للمنتج "${p.name}"` };
        }
      }
      const unitPrice = it.price !== undefined && it.price !== null && it.price !== '' ? Math.round((Number(it.price) || 0) * 100) / 100 : p.sale_price;
      subtotal += Math.round(qty * unitPrice * 100) / 100;
    }

    let d = Number(discount) || 0;
    let couponId = null;
    let couponNote = '';
    if (coupon_code) {
      const c = get('SELECT * FROM coupons WHERE code = ?', [String(coupon_code).trim().toUpperCase()]);
      if (!c || !c.active) return { error: 'كوبون غير صالح' };
      if (c.party_id && (!partyId || Number(c.party_id) !== Number(partyId))) return { error: 'هذا الكوبون خاص بعميل آخر' };
      if (c.expires_at && c.expires_at < new Date().toISOString().slice(0, 10)) return { error: 'الكوبون منتهي الصلاحية' };
      if (c.max_uses > 0 && c.used_count >= c.max_uses) return { error: 'تم استهلاك الكوبون' };
      if (subtotal < c.min_total) return { error: `الحد الأدنى للاستخدام: ${c.min_total}` };
      let cdisc = c.discount_type === 'percent' ? subtotal * c.value / 100 : c.value;
      if (cdisc > subtotal) cdisc = subtotal;
      d = Math.max(d, cdisc);
      couponId = c.id;
      couponNote = c.code;
      run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [c.id]);
    }

    if (d < 0 || d > subtotal) return { error: 'خصم غير صحيح' };
    const dFee = Math.max(0, Math.round((Number(delivery_fee) || 0) * 100) / 100);
    const total = Math.round((subtotal - d + dFee) * 100) / 100;

    let lines = (payList || []).map(p => ({ method: p.method, amount: p.amount === null ? total : p.amount })).filter(p => p.method !== 'credit');
    const paidAmt = Math.round(lines.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const hasCredit = !!credit || (Array.isArray(payments) && payments.some(p => p.method === 'credit')) || payment_method === 'credit';
    if (hasCredit) {
      if (paidAmt >= total) return { error: 'في البيع بالآجل لا يمكن أن يكون المدفوع مساوياً لإجمالي الفاتورة أو أكثر منه — المتبقي هو المديونية' };
      if (!partyId) return { error: 'البيع بالآجل يتطلب عميلاً مسجلاً في النظام — عميل نقدي لا يمكن أن يكون عليه مديونية' };
    } else if (paidAmt < total) {
      return { error: 'المبلغ المدفوع أقل من قيمة الفاتورة — أكمل المبلغ أو استخدم "آجل" للمتبقي' };
    }
    lines = lines.filter(p => p.amount > 0);
    const methodsUsed = [...new Set(lines.map(p => p.method))];
    const pmStored = methodsUsed.length > 1 ? 'mixed' : (methodsUsed[0] || (hasCredit ? 'credit' : 'cash'));
    const paymentsJson = lines.length > 1 ? JSON.stringify(lines) : null;

    const invoice = nextInvoice('INV');
    const r = run('INSERT INTO sales (invoice_no, user_id, branch_id, party_id, customer_phone, customer_name, subtotal, discount, delivery_fee, delivery_address, total, paid, payment_method, payments_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [invoice, req.user.id, req.user.branch_id || null, partyId, phone, customer_name || '', subtotal, d, dFee, String(delivery_address || '').slice(0, 300), total, paidAmt, pmStored, paymentsJson]);

    for (const it of items) {
      const p = get('SELECT * FROM products WHERE id = ?', [it.product_id]);
      const qty = Number(it.qty) || 0;
      const unitPrice = it.price !== undefined && it.price !== null && it.price !== '' ? Math.round((Number(it.price) || 0) * 100) / 100 : p.sale_price;
      const serials = Array.isArray(it.serials) ? it.serials.map(s => String(s).trim()).filter(Boolean) : [];
      const serialsJson = serials.length > 0 ? JSON.stringify(serials) : null;

      run('INSERT INTO sale_items (sale_id, product_id, name, barcode, qty, price, total, serials_json) VALUES (?,?,?,?,?,?,?,?)',
        [r.lastInsertRowid, p.id, p.name, p.barcode, qty, unitPrice, Math.round(qty * unitPrice * 100) / 100, serialsJson]);
      run('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, p.id]);

      if (serials.length > 0) {
        for (const sn of serials) {
          run(`UPDATE product_serials SET status = 'sold', sale_id = ?, sale_price = ?, updated_at = datetime('now','localtime') WHERE product_id = ? AND serial_number = ? AND status = 'available'`,
            [r.lastInsertRowid, unitPrice, p.id, sn]);
        }
      }
    }

    if (partyId) {
      const party = get('SELECT * FROM parties WHERE id = ?', [partyId]);
      if (party && party.type === 'customer') {
        const due = Math.round((total - paidAmt) * 100) / 100;
        if (due > 0) run('UPDATE parties SET balance = balance + ? WHERE id = ?', [due, party.id]);
      }
    }

    const loyalty = partyId ? loyaltyAfterSale(partyId) : null;
    return { id: r.lastInsertRowid, invoice_no: invoice, coupon: couponNote, loyalty, due: Math.max(0, Math.round((total - paidAmt) * 100) / 100), payments: lines, customer: { id: partyId, name: customer_name || (customer && customer.name) || phone, phone } };
  });

  const result = doSale();
  if (result && result.error) return res.status(400).json({ error: result.error });
  res.json({
    ok: true, invoice_no: result.invoice_no, sale_id: result.id, coupon: result.coupon || null,
    loyalty: result.loyalty, customer: result.customer, due: result.due, payments: result.payments,
  });
});

app.get('/api/customers/lookup', auth, (req, res) => {
  const phone = String(req.query.phone || '').trim();
  if (!phone) return res.json({ customer: null, sales_count: 0 });
  const customer = get("SELECT * FROM parties WHERE type = 'customer' AND phone = ?", [phone]);
  if (!customer) return res.json({ customer: null, sales_count: 0 });
  const sales_count = get('SELECT COUNT(*) AS c FROM sales WHERE party_id = ?', [customer.id]).c;
  res.json({ customer, sales_count });
});

app.get('/api/sales', auth, (req, res) => {
  const from = req.query.from || '';
  const to = req.query.to || '';
  const user_id = req.query.user_id || '';
  const branch_id = req.query.branch_id || '';
  const q = (req.query.q || '').trim();
  let sql = `SELECT s.*, u.full_name AS cashier, b.name AS branch_name,
             (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items_count
             FROM sales s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN branches b ON b.id = s.branch_id
             WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND date(s.created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(s.created_at) <= date(?)'; params.push(to); }
  if (user_id) { sql += ' AND s.user_id = ?'; params.push(user_id); }
  if (branch_id) { sql += ' AND s.branch_id = ?'; params.push(branch_id); }
  if (q) {
    sql += ' AND (s.invoice_no LIKE ? OR s.customer_name LIKE ? OR s.customer_phone LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY s.id DESC LIMIT 500';
  res.json(all(sql, params));
});

app.get('/api/sales/:id', auth, (req, res) => {
  const s = get(`SELECT s.*, u.full_name AS cashier, b.name AS branch_name
                 FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN branches b ON b.id = s.branch_id
                 WHERE s.id = ?`, [req.params.id]);
  if (!s) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  s.items = all('SELECT * FROM sale_items WHERE sale_id = ?', [s.id]);
  res.json(s);
});

/* تعديل فاتورة بيع (أدمن فقط): أصناف/كميات/أسعار + خصم + مدفوع — مع تصحيح المخزون ورصيد العميل */
app.put('/api/sales/:id/edit', auth, adminOnly, (req, res) => {
  const sale = get('SELECT * FROM sales WHERE id = ?', [req.params.id]);
  if (!sale) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  const { items, discount, paid } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'لا يمكن حفظ فاتورة فارغة' });
  const r2 = (v) => Math.round(v * 100) / 100;

  /* ===== مرحلة الفحص بالكامل قبل أي كتابة ===== */
  const oldItems = all('SELECT * FROM sale_items WHERE sale_id = ?', [sale.id]);
  const oldQtyMap = {};
  for (const oi of oldItems) if (oi.product_id) oldQtyMap[oi.product_id] = (oldQtyMap[oi.product_id] || 0) + Number(oi.qty);

  let subtotal = 0;
  for (const it of items) {
    const p = get('SELECT * FROM products WHERE id = ?', [it.product_id]);
    if (!p) return res.status(400).json({ error: 'منتج غير موجود في الفاتورة' });
    const qty = Number(it.qty) || 0;
    const price = Number(it.price);
    if (qty <= 0) return res.status(400).json({ error: `كمية غير صحيحة لـ "${p.name}"` });
    if (!(price >= 0)) return res.status(400).json({ error: `سعر غير صحيح لـ "${p.name}"` });
    const avail = Number(p.stock) + (oldQtyMap[p.id] || 0);
    if (avail < qty) return res.status(400).json({ error: `الكمية المطلوبة لـ "${p.name}" غير متوفرة (المتاح: ${avail})` });
    subtotal += qty * price;
  }
  subtotal = r2(subtotal);
  let d = Number(discount);
  d = isNaN(d) ? Number(sale.discount) || 0 : r2(Math.max(0, Math.min(d, subtotal)));
  const total = r2(subtotal - d + (Number(sale.delivery_fee) || 0));
  let newPaid = (paid === undefined || paid === null || paid === '') ? Number(sale.paid) : r2(Number(paid) || 0);
  if (newPaid < 0) newPaid = 0;
  if (newPaid < total && !sale.party_id) return res.status(400).json({ error: 'المدفوع أقل من الإجمالي والفاتورة بدون عميل مسجل — أكمل المدفوع أو أضف عميلاً للآجل' });

  const oldDue = Math.max(0, r2(Number(sale.total) - Number(sale.paid)));
  const newDue = Math.max(0, r2(total - newPaid));

  /* ===== مرحلة الكتابة (داخل ترانزاكشن) ===== */
  const doEdit = transaction(() => {
    for (const oi of oldItems) {
      if (oi.product_id) run('UPDATE products SET stock = stock + ? WHERE id = ?', [oi.qty, oi.product_id]);
    }
    run('DELETE FROM sale_items WHERE sale_id = ?', [sale.id]);
    for (const it of items) {
      const p = get('SELECT * FROM products WHERE id = ?', [it.product_id]);
      const qty = Number(it.qty) || 0;
      run('INSERT INTO sale_items (sale_id, product_id, name, barcode, qty, price, total) VALUES (?,?,?,?,?,?,?)',
        [sale.id, p.id, p.name, p.barcode, qty, Number(it.price), r2(qty * Number(it.price))]);
      run('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, p.id]);
    }
    if (sale.party_id && newDue !== oldDue) {
      const party = get('SELECT * FROM parties WHERE id = ?', [sale.party_id]);
      if (party && party.type === 'customer') run('UPDATE parties SET balance = balance + ? WHERE id = ?', [r2(newDue - oldDue), party.id]);
    }
    run('UPDATE sales SET subtotal = ?, discount = ?, total = ?, paid = ? WHERE id = ?', [subtotal, d, total, newPaid, sale.id]);
    return { subtotal, discount: d, total, paid: newPaid, due: newDue };
  });
  const result = doEdit();
  res.json({ ok: true, ...result });
});

/* ==================== PURCHASES ==================== */
app.post('/api/purchases', auth, permOrAdmin('purchases.create'), (req, res) => {
  const { supplier_id, items, discount, paid, payment_method } = req.body || {};
  if (!supplier_id) return res.status(400).json({ error: 'اختر المورد' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'الفاتورة فارغة' });

  const doPurchase = transaction(() => {
    let subtotal = 0;
    const inputSerialsSet = new Set();
    for (const it of items) {
      const p = get('SELECT * FROM products WHERE id = ?', [it.product_id]);
      if (!p) return { error: 'منتج غير موجود' };
      const qty = Number(it.qty) || 0;
      const price = it.price !== undefined ? Number(it.price) : p.purchase_price;
      if (qty <= 0) return { error: 'كمية غير صحيحة' };
      subtotal += qty * price;

      const serials = Array.isArray(it.serials) ? it.serials.map(s => String(s).trim()).filter(Boolean) : [];
      if (p.has_serials === 1 && serials.length !== qty) {
        return { error: `المنتج "${p.name}" مفعّل بنظام السيريال ويتطلب إدخال ${qty} سيريالات فريدة (تم إدخال ${serials.length})` };
      }
      for (const sn of serials) {
        if (inputSerialsSet.has(sn)) {
          return { error: `السيريال (${sn}) مكرر داخل نفس الفاتورة!` };
        }
        inputSerialsSet.add(sn);

        const dupInDb = get('SELECT ps.id, p.name FROM product_serials ps JOIN products p ON p.id = ps.product_id WHERE ps.serial_number = ?', [sn]);
        if (dupInDb) {
          return { error: `السيريال (${sn}) مكرر ومسجل بالفعل لـ "${dupInDb.name}"! لا يمكن تسجيل نفس السيريال لأكثر من قطعة.` };
        }
      }
    }
    const d = Number(discount) || 0;
    if (d < 0 || d > subtotal) return { error: 'خصم غير صحيح' };
    const total = subtotal - d;
    const paidAmt = paid === '' || paid === null || paid === undefined ? total : Number(paid);

    const invoice = nextInvoice('PUR');
    const r = run('INSERT INTO purchases (invoice_no, supplier_id, branch_id, subtotal, discount, total, paid, user_id) VALUES (?,?,?,?,?,?,?,?)',
      [invoice, supplier_id, req.user.branch_id || null, subtotal, d, total, paidAmt, req.user.id]);

    for (const it of items) {
      const p = get('SELECT * FROM products WHERE id = ?', [it.product_id]);
      const qty = Number(it.qty) || 0;
      const itemPrice = it.price !== undefined ? Number(it.price) : p.purchase_price;
      const serials = Array.isArray(it.serials) ? it.serials.map(s => String(s).trim()).filter(Boolean) : [];
      const serialsJson = serials.length > 0 ? JSON.stringify(serials) : null;

      run('INSERT INTO purchase_items (purchase_id, product_id, name, barcode, qty, price, total, serials_json) VALUES (?,?,?,?,?,?,?,?)',
        [r.lastInsertRowid, p.id, p.name, p.barcode, qty, itemPrice, qty * itemPrice, serialsJson]);
      run('UPDATE products SET stock = stock + ?, purchase_price = ? WHERE id = ?', [qty, itemPrice, p.id]);

      if (serials.length > 0) {
        run('UPDATE products SET has_serials = 1 WHERE id = ?', [p.id]);
        for (const sn of serials) {
          run('INSERT INTO product_serials (product_id, serial_number, status, purchase_id, purchase_price) VALUES (?,?,?,?,?)',
            [p.id, sn, 'available', r.lastInsertRowid, itemPrice]);
        }
      }
    }

    const due = total - paidAmt;
    if (due !== 0) run('UPDATE parties SET balance = balance - ? WHERE id = ?', [due, supplier_id]);
    if (paidAmt > 0) run('INSERT INTO payments (party_id, type, pay_type, amount, note, user_id, method) VALUES (?,?,?,?,?,?,?)', [supplier_id, 'out', 'debt', paidAmt, 'فاتورة شراء ' + invoice, req.user.id, payment_method || 'cash']);

    return { id: r.lastInsertRowid, invoice_no: invoice };
  });

  const result = doPurchase();
  if (result && result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, invoice_no: result.invoice_no, purchase_id: result.id });
});

app.get('/api/purchases', auth, (req, res) => {
  const from = req.query.from || '';
  const to = req.query.to || '';
  let sql = `SELECT pu.*, pa.name AS supplier_name
             FROM purchases pu JOIN parties pa ON pa.id = pu.supplier_id
             WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND date(pu.created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(pu.created_at) <= date(?)'; params.push(to); }
  sql += ' ORDER BY pu.id DESC LIMIT 300';
  res.json(all(sql, params));
});

app.get('/api/purchases/:id', auth, (req, res) => {
  const p = get(`SELECT pu.*, pa.name AS supplier_name FROM purchases pu JOIN parties pa ON pa.id = pu.supplier_id WHERE pu.id = ?`, [req.params.id]);
  if (!p) return res.status(404).json({ error: 'غير موجود' });
  p.items = all('SELECT * FROM purchase_items WHERE purchase_id = ?', [p.id]);
  res.json(p);
});

/* ==================== PRODUCT SERIALS ==================== */
app.get('/api/serials/verify', auth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ found: false });

  const ps = get(`SELECT ps.*, p.name AS product_name, p.barcode AS product_barcode, p.sale_price, p.stock
                  FROM product_serials ps
                  JOIN products p ON p.id = ps.product_id
                  WHERE UPPER(ps.serial_number) = UPPER(?)
                  ORDER BY ps.id DESC LIMIT 1`, [q]);

  if (!ps) {
    return res.json({ found: false });
  }

  if (ps.status === 'sold') {
    let sale = null;
    if (ps.sale_id) {
      sale = get('SELECT invoice_no, created_at FROM sales WHERE id = ?', [ps.sale_id]);
    }
    return res.json({
      found: true,
      status: 'sold',
      serial_number: ps.serial_number,
      product_id: ps.product_id,
      product_name: ps.product_name,
      invoice_no: sale ? sale.invoice_no : null,
      sold_at: ps.updated_at || (sale ? sale.created_at : null)
    });
  }

  res.json({
    found: true,
    status: ps.status,
    serial_number: ps.serial_number,
    product_id: ps.product_id,
    product_name: ps.product_name,
    product_barcode: ps.product_barcode,
    sale_price: ps.sale_price,
    stock: ps.stock
  });
});

app.get('/api/products/:id/serials', auth, (req, res) => {
  const pid = Number(req.params.id);
  const status = req.query.status || '';
  let sql = 'SELECT * FROM product_serials WHERE product_id = ?';
  const params = [pid];
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY id DESC';
  res.json(all(sql, params));
});

app.get('/api/serials/search', auth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const sql = `SELECT ps.*, p.name AS product_name, p.barcode AS product_barcode
               FROM product_serials ps
               JOIN products p ON p.id = ps.product_id
               WHERE ps.serial_number LIKE ?
               ORDER BY ps.id DESC LIMIT 50`;
  res.json(all(sql, ['%' + q + '%']));
});

/* تعديل فاتورة شراء (أدمن فقط): أصناف/كميات/أسعار + خصم + مدفوع + المورد — مع تصحيح المخزون ورصيد المورد */
app.put('/api/purchases/:id/edit', auth, adminOnly, (req, res) => {
  const pu = get('SELECT * FROM purchases WHERE id = ?', [req.params.id]);
  if (!pu) return res.status(404).json({ error: 'فاتورة الشراء غير موجودة' });
  const b = req.body || {};
  const items = b.items;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'لا يمكن حفظ فاتورة فارغة' });
  const r2 = (v) => Math.round(v * 100) / 100;
  const newSupplierId = Number(b.supplier_id) || Number(pu.supplier_id);
  if (!get("SELECT id FROM parties WHERE id = ? AND type = 'supplier'", [newSupplierId])) return res.status(400).json({ error: 'المورد غير موجود' });

  /* ===== فحص كامل قبل أي كتابة ===== */
  let subtotal = 0;
  for (const it of items) {
    const p = get('SELECT * FROM products WHERE id = ?', [it.product_id]);
    if (!p) return res.status(400).json({ error: 'منتج غير موجود في الفاتورة' });
    const qty = Number(it.qty) || 0;
    const price = Number(it.price);
    if (qty <= 0) return res.status(400).json({ error: `كمية غير صحيحة لـ "${p.name}"` });
    if (!(price >= 0)) return res.status(400).json({ error: `سعر غير صحيح لـ "${p.name}"` });
    subtotal += qty * price;
  }
  subtotal = r2(subtotal);
  let d = Number(b.discount);
  d = isNaN(d) ? Number(pu.discount) || 0 : r2(Math.max(0, Math.min(d, subtotal)));
  const total = r2(subtotal - d);
  let newPaid = (b.paid === undefined || b.paid === null || b.paid === '') ? Number(pu.paid) : r2(Number(b.paid) || 0);
  if (newPaid < 0) newPaid = 0;

  /* ===== كتابة ===== */
  const doEdit = transaction(() => {
    // 1) التراجع عن أثر الفاتورة القديمة على رصيد المورد القديم وحذف صف الدفعة الآلي
    const oldDue = r2(Number(pu.total) - Number(pu.paid));
    if (oldDue !== 0) run('UPDATE parties SET balance = balance + ? WHERE id = ?', [oldDue, pu.supplier_id]);
    run("DELETE FROM payments WHERE party_id = ? AND pay_type = 'debt' AND note = ?", [pu.supplier_id, 'فاتورة شراء ' + pu.invoice_no]);
    // 2) التراجع عن أثر المخزون القديم
    const oldItems = all('SELECT * FROM purchase_items WHERE purchase_id = ?', [pu.id]);
    for (const oi of oldItems) {
      if (oi.product_id) run('UPDATE products SET stock = stock - ? WHERE id = ?', [oi.qty, oi.product_id]);
    }
    // 3) إعادة بناء الأصناف وتطبيق المخزون الجديد
    run('DELETE FROM purchase_items WHERE purchase_id = ?', [pu.id]);
    for (const it of items) {
      const p = get('SELECT * FROM products WHERE id = ?', [it.product_id]);
      const qty = Number(it.qty) || 0;
      run('INSERT INTO purchase_items (purchase_id, product_id, name, barcode, qty, price, total) VALUES (?,?,?,?,?,?,?)',
        [pu.id, p.id, p.name, p.barcode, qty, Number(it.price), r2(qty * Number(it.price))]);
      run('UPDATE products SET stock = stock + ?, purchase_price = ? WHERE id = ?', [qty, Number(it.price), p.id]);
    }
    // 4) تحديث الرأس وإعادة تطبيق أثر المورد
    run('UPDATE purchases SET supplier_id = ?, subtotal = ?, discount = ?, total = ?, paid = ? WHERE id = ?',
      [newSupplierId, subtotal, d, total, newPaid, pu.id]);
    const newDue = r2(total - newPaid);
    if (newDue !== 0) run('UPDATE parties SET balance = balance - ? WHERE id = ?', [newDue, newSupplierId]);
    if (newPaid > 0) run('INSERT INTO payments (party_id, type, pay_type, amount, note, user_id) VALUES (?,?,?,?,?,?)',
      [newSupplierId, 'out', 'debt', newPaid, 'فاتورة شراء ' + pu.invoice_no, req.user.id]);
    return { total, paid: newPaid, due: Math.max(0, newDue), supplier_id: newSupplierId };
  });
  const result = doEdit();
  res.json({ ok: true, ...result });
});

/* ==================== RETURNS ==================== */
function buildReturnablePayload(sale) {
  const items = all('SELECT * FROM sale_items WHERE sale_id = ?', [sale.id]);
  const returned = all(`SELECT ri.product_id, COALESCE(SUM(ri.qty),0) AS qty FROM return_items ri JOIN returns r ON r.id = ri.return_id WHERE r.sale_id = ? GROUP BY ri.product_id`, [sale.id]);
  const returnedMap = {};
  for (const r of returned) returnedMap[r.product_id] = r.qty;
  const ratio = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;
  const refundPrice = (price) => Math.round(price * ratio * 100) / 100;
  const list = items.map(i => {
    const soldSerials = all(`SELECT serial_number FROM product_serials WHERE product_id = ? AND sale_id = ? AND status = 'sold'`, [i.product_id, sale.id]).map(s => s.serial_number);
    const prod = get('SELECT has_serials FROM products WHERE id = ?', [i.product_id]);
    return {
      product_id: i.product_id,
      name: i.name,
      barcode: i.barcode,
      price: i.price,
      refund_price: refundPrice(i.price),
      sold_qty: i.qty,
      returned_qty: returnedMap[i.product_id] || 0,
      max_returnable: i.qty - (returnedMap[i.product_id] || 0),
      total: i.total,
      has_serials: prod ? prod.has_serials : 0,
      sold_serials: soldSerials,
    };
  });
  return { sale, items: list };
}

app.get('/api/sales/by-invoice/:invoice_no/returnable', auth, (req, res) => {
  const q = String(req.params.invoice_no || '').trim();
  if (!q) return res.status(400).json({ error: 'أدخل رقم الفاتورة' });
  let sale = get('SELECT * FROM sales WHERE invoice_no = ?', [q]);
  if (!sale) {
    sale = get('SELECT * FROM sales WHERE invoice_no LIKE ? ORDER BY id DESC LIMIT 1', [`%${q}%`]);
  }
  if (!sale) return res.status(404).json({ error: `الفاتورة رقم "${q}" غير موجودة` });
  res.json(buildReturnablePayload(sale));
});

app.get('/api/sales/:id/returnable', auth, (req, res) => {
  const sale = get('SELECT * FROM sales WHERE id = ?', [req.params.id]);
  if (!sale) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  res.json(buildReturnablePayload(sale));
});

app.post('/api/sales/:id/return', auth, (req, res) => {
  const { items, refund_method } = req.body || {};
  const sale = get('SELECT * FROM sales WHERE id = ?', [req.params.id]);
  if (!sale) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'اختر أصناف للإرجاع' });

  const doReturn = transaction(() => {
    const saleItems = all('SELECT * FROM sale_items WHERE sale_id = ?', [sale.id]);
    const returned = all(`SELECT ri.product_id, COALESCE(SUM(ri.qty),0) AS qty FROM return_items ri JOIN returns r ON r.id = ri.return_id WHERE r.sale_id = ? GROUP BY ri.product_id`, [sale.id]);
    const returnedMap = {};
    for (const r of returned) returnedMap[r.product_id] = r.qty;

    let subtotal = 0;
    const detail = [];
    const ratio = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;
    for (const it of items) {
      const si = saleItems.find(x => x.product_id === it.product_id);
      if (!si) return { error: 'صنف غير موجود في الفاتورة الأصلية' };
      const qty = Number(it.qty) || 0;
      const max = si.qty - (returnedMap[si.product_id] || 0);
      if (qty <= 0 || qty > max) return { error: `كمية غير صحيحة لـ "${si.name}" — أقصى إرجاع ${max}` };

      const prod = get('SELECT has_serials FROM products WHERE id = ?', [si.product_id]);
      const serials = Array.isArray(it.serials) ? it.serials.map(s => String(s).trim()).filter(Boolean) : [];
      if (prod && prod.has_serials === 1) {
        if (serials.length !== qty) {
          return { error: `المنتج "${si.name}" يتطلب تحديد ${qty} سيريالات للإرجاع (تم تحديد ${serials.length})` };
        }
        for (const sn of serials) {
          const avail = get('SELECT id FROM product_serials WHERE product_id = ? AND serial_number = ? AND sale_id = ? AND status = ?', [si.product_id, sn, sale.id, 'sold']);
          if (!avail) return { error: `السيريال "${sn}" غير مسجل كمبيوع في هذه الفاتورة لـ "${si.name}"` };
        }
      }

      let unitPrice = Math.round(si.price * ratio * 100) / 100;
      if (it.price !== undefined && it.price !== null && it.price !== '') {
        unitPrice = Math.round((Number(it.price) || 0) * 100) / 100;
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) return { error: `سعر المرتجع لـ "${si.name}" غير صحيح` };
        if (unitPrice > Math.round(Number(si.price) * 100) / 100 + 0.001) {
          return { error: `مرفوض: سعر المرتجع لـ "${si.name}" (${unitPrice}) لا يمكن أن يتخطى سعر البيع في فاتورة المبيع الأصلية (${si.price})` };
        }
      }
      subtotal += Math.round(qty * unitPrice * 100) / 100;
      detail.push({ si, qty, unitPrice, serials });
    }

    const invoice = nextInvoice('RET');
    const r = run('INSERT INTO returns (return_no, sale_id, user_id, branch_id, subtotal, refund_method) VALUES (?,?,?,?,?,?)',
      [invoice, sale.id, req.user.id, req.user.branch_id || null, subtotal, refund_method || 'cash']);

    for (const d of detail) {
      const lineTotal = Math.round(d.qty * d.unitPrice * 100) / 100;
      run('INSERT INTO return_items (return_id, product_id, name, barcode, qty, price, total) VALUES (?,?,?,?,?,?,?)',
        [r.lastInsertRowid, d.si.product_id, d.si.name, d.si.barcode, d.qty, d.unitPrice, lineTotal]);
      run('UPDATE products SET stock = stock + ? WHERE id = ?', [d.qty, d.si.product_id]);

      if (d.serials && d.serials.length > 0) {
        for (const sn of d.serials) {
          run(`UPDATE product_serials SET status = 'available', sale_id = NULL, sale_price = NULL, updated_at = datetime('now','localtime') WHERE product_id = ? AND serial_number = ? AND sale_id = ?`, [d.si.product_id, sn, sale.id]);
        }
      }
    }

    const method = refund_method || 'cash';
    if (method === 'credit' && sale.party_id) {
      const party = get('SELECT * FROM parties WHERE id = ?', [sale.party_id]);
      if (party && party.type === 'customer') {
        run('UPDATE parties SET balance = balance - ? WHERE id = ?', [subtotal, party.id]);
      }
    }

    return { id: r.lastInsertRowid, return_no: invoice, subtotal, method };
  });

  const result = doReturn();
  if (result && result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, return_no: result.return_no, return_id: result.id, subtotal: result.subtotal, refund_method: result.method });
});

app.get('/api/returns', auth, (req, res) => {
  const from = req.query.from || '';
  const to = req.query.to || '';
  const q = (req.query.q || '').trim();
  let sql = `SELECT rt.*, u.full_name AS cashier, b.name AS branch_name, s.invoice_no AS sale_invoice
             FROM returns rt
             JOIN users u ON u.id = rt.user_id
             LEFT JOIN branches b ON b.id = rt.branch_id
             LEFT JOIN sales s ON s.id = rt.sale_id
             WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND date(rt.created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(rt.created_at) <= date(?)'; params.push(to); }
  if (q) {
    sql += ' AND (rt.return_no LIKE ? OR s.invoice_no LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY rt.id DESC LIMIT 300';
  res.json(all(sql, params));
});

app.get('/api/returns/:id', auth, (req, res) => {
  const rt = get(`SELECT rt.*, u.full_name AS cashier, s.invoice_no AS sale_invoice
                  FROM returns rt JOIN users u ON u.id = rt.user_id LEFT JOIN sales s ON s.id = rt.sale_id
                  WHERE rt.id = ?`, [req.params.id]);
  if (!rt) return res.status(404).json({ error: 'غير موجود' });
  rt.items = all('SELECT * FROM return_items WHERE return_id = ?', [rt.id]);
  res.json(rt);
});

/* ==================== REPORTS ==================== */
app.get('/api/reports/dashboard', auth, permOrAdmin('reports'), (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const data = {
    today_sales: get(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM sales WHERE date(created_at) = date('now','localtime')`),
    month_sales: get(`SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now','localtime')`),
    today_purchases: get(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM purchases WHERE date(created_at) = date('now','localtime')`),
    month_purchases: get(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM purchases WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now','localtime')`),
    returns_today: get(`SELECT COALESCE(SUM(subtotal),0) AS total, COUNT(*) AS count FROM returns WHERE date(created_at) = date('now','localtime')`),
    returns_month: get(`SELECT COALESCE(SUM(subtotal),0) AS total, COUNT(*) AS count FROM returns WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now','localtime')`),
    recent_returns: all(`SELECT rt.*, u.full_name AS cashier, s.invoice_no AS sale_invoice
                         FROM returns rt JOIN users u ON u.id = rt.user_id LEFT JOIN sales s ON s.id = rt.sale_id
                         ORDER BY rt.id DESC LIMIT 8`),
    recent_purchases: all(`SELECT pu.*, pa.name AS supplier_name
                           FROM purchases pu JOIN parties pa ON pa.id = pu.supplier_id
                           ORDER BY pu.id DESC LIMIT 8`),
    low_stock_count: get('SELECT COUNT(*) AS c FROM products WHERE stock <= min_stock AND active = 1').c,
    low_stock: all(`SELECT * FROM products WHERE stock <= min_stock AND active = 1 ORDER BY stock LIMIT 50`),
    product_count: get('SELECT COUNT(*) AS c FROM products WHERE active = 1').c,
    category_count: get('SELECT COUNT(*) AS c FROM categories').c,
    top_products: all(`SELECT si.name, SUM(si.qty) AS qty, SUM(si.total) AS total
                       FROM sale_items si GROUP BY si.name ORDER BY qty DESC LIMIT 5`),
    recent_sales: all(`SELECT s.*, u.full_name AS cashier FROM sales s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 8`),
    maintenance: (() => {
      const open = get(`SELECT COUNT(*) AS count, COALESCE(SUM(MAX(total - paid, 0)),0) AS remaining
                        FROM maintenance_jobs WHERE status NOT IN ('delivered','cancelled')`);
      const todayPay = get(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count
                            FROM maintenance_payments WHERE date(created_at) = date('now','localtime')`);
      const todayJobs = get(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total
                             FROM maintenance_jobs WHERE date(created_at) = date('now','localtime')`);
      return { open_count: open.count, open_remaining: Math.round((open.remaining || 0) * 100) / 100,
               today_collected: Math.round((todayPay.total || 0) * 100) / 100, today_payments: todayPay.count,
               today_jobs: todayJobs.count, today_total: Math.round((todayJobs.total || 0) * 100) / 100 };
    })(),
    payments_due: all(`SELECT * FROM parties WHERE balance > 0 ORDER BY balance DESC LIMIT 8`),
    unpaid_salaries: new Date().getDate() >= 27 ? all(`SELECT e.id, e.name, e.salary,
                          COALESCE((SELECT 1 FROM salary_closings sc WHERE sc.employee_id = e.id AND sc.month = ?), 0) AS closed
                          FROM employees e WHERE e.active = 1 AND e.salary > 0 ORDER BY e.name`, [monthKey()]) : [],
  };
  res.json(data);
});

app.get('/api/reports/summary', auth, permOrAdmin('reports'), (req, res) => {
  const from = req.query.from || '2020-01-01';
  const to = req.query.to || '2030-01-01';
  const sales = get(`SELECT COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(discount),0) AS discount, COUNT(*) AS count
                     FROM sales WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)`, [from, to]);
  const purchases = get(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM purchases WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)`, [from, to]);
  const cogs = get(`SELECT COALESCE(SUM(si.qty * p.purchase_price),0) AS cogs
                    FROM sale_items si JOIN products p ON p.id = si.product_id
                    WHERE si.sale_id IN (SELECT id FROM sales WHERE date(created_at) >= date(?) AND date(created_at) <= date(?))`, [from, to]);
  const returnsAgg = get(`SELECT COALESCE(SUM(subtotal),0) AS total, COUNT(*) AS count FROM returns WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)`, [from, to]);
  const cogsReturned = get(`SELECT COALESCE(SUM(ri.qty * p.purchase_price),0) AS c
                    FROM return_items ri JOIN returns rt ON rt.id = ri.return_id JOIN products p ON p.id = ri.product_id
                    WHERE date(rt.created_at) >= date(?) AND date(rt.created_at) <= date(?)`, [from, to]);
  const debts = get(`SELECT COALESCE(SUM(total - paid),0) AS d, COUNT(*) AS c FROM sales
                     WHERE date(created_at) >= date(?) AND date(created_at) <= date(?) AND total > paid`, [from, to]);
  const salariesPaid = get(`SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS c FROM salary_closings
                     WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)`, [from, to]);
  const expensesAgg = get(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM expenses
                     WHERE date(spent_at) >= date(?) AND date(spent_at) <= date(?)`, [from, to]);
  const usedDevsSold = get(`SELECT COALESCE(SUM(sale_price),0) AS revenue, COALESCE(SUM(purchase_price),0) AS cogs, COALESCE(SUM(sale_price - purchase_price),0) AS profit, COUNT(*) AS count
                     FROM used_devices WHERE status = 'sold' AND date(sale_date) >= date(?) AND date(sale_date) <= date(?)`, [from, to]);
  const usedDevsPurchased = get(`SELECT COALESCE(SUM(purchase_price),0) AS total, COUNT(*) AS count
                          FROM used_devices WHERE date(purchase_date) >= date(?) AND date(purchase_date) <= date(?)`, [from, to]);

  const netSales = Math.round((sales.revenue - returnsAgg.total + usedDevsSold.revenue) * 100) / 100;
  const netCogs = Math.round((cogs.cogs - cogsReturned.c + usedDevsSold.cogs) * 100) / 100;
  const grossProfit = Math.round((netSales - netCogs) * 100) / 100;
  const netProfit = Math.round((grossProfit - expensesAgg.t - salariesPaid.s) * 100) / 100;

  res.json({
    sales: { revenue: sales.revenue, subtotal: sales.subtotal, discount: sales.discount, count: sales.count, profit: sales.revenue - cogs.cogs },
    purchases,
    returns: { total: returnsAgg.total, count: returnsAgg.count },
    used_devices: {
      sold_revenue: usedDevsSold.revenue,
      sold_cogs: usedDevsSold.cogs,
      profit: usedDevsSold.profit,
      sold_count: usedDevsSold.count,
      purchases_total: usedDevsPurchased.total,
      purchases_count: usedDevsPurchased.count
    },
    customer_debts: { total: Math.round(debts.d * 100) / 100, count: debts.c },
    salaries_paid: { total: salariesPaid.s, count: salariesPaid.c },
    expenses: { total: expensesAgg.t, count: expensesAgg.c },
    financial: { net_sales: netSales, net_cogs: netCogs, gross_profit: grossProfit, net_profit: netProfit },
  });
});

app.get('/api/reports/inventory', auth, permOrAdmin('reports'), (req, res) => {
  const items = all(`SELECT id, name, barcode, stock, purchase_price, sale_price
                     FROM products WHERE active = 1 AND stock > 0 ORDER BY name`);
  let cost = 0, retail = 0;
  for (const it of items) {
    cost += (Number(it.stock) || 0) * (Number(it.purchase_price) || 0);
    retail += (Number(it.stock) || 0) * (Number(it.sale_price) || 0);
  }
  cost = Math.round(cost * 100) / 100;
  retail = Math.round(retail * 100) / 100;
  res.json({ items, count: items.length, cost, retail, potential: Math.round((retail - cost) * 100) / 100 });
});

app.get('/api/reports/parties-summary', auth, permOrAdmin('reports'), (req, res) => {
  const customers = get(`SELECT COUNT(*) AS c,
      COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS debts,
      COALESCE(SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END), 0) AS debtors
    FROM parties WHERE type = 'customer'`);
  const suppliers = get(`SELECT COUNT(*) AS c,
      COALESCE(SUM(CASE WHEN balance < 0 THEN -balance ELSE 0 END), 0) AS dues,
      COALESCE(SUM(CASE WHEN balance < 0 THEN 1 ELSE 0 END), 0) AS creditors
    FROM parties WHERE type = 'supplier'`);
  res.json({
    customers: { count: customers.c, debts_total: Math.round(customers.debts * 100) / 100, debtors: customers.debtors },
    suppliers: { count: suppliers.c, dues_total: Math.round(suppliers.dues * 100) / 100, creditors: suppliers.creditors },
  });
});

app.get('/api/reports/party-movements', auth, permOrAdmin('reports'), (req, res) => {
  const { from, to } = req.query;
  const type = ['customer', 'supplier'].includes(req.query.type) ? req.query.type : null;
  const okDate = v => !v || /^\d{4}-\d{2}-\d{2}$/.test(String(v));
  if (!okDate(from) || !okDate(to)) return res.status(400).json({ error: 'صيغة التاريخ غير صحيحة' });

  const tFilter = type ? "AND pa.type = '" + type + "'" : '';
  const dFrom = from ? `AND date(x.date) >= date('${from}')` : '';
  const dTo = to ? `AND date(x.date) <= date('${to}')` : '';

  let rows = all(`
    SELECT * FROM (
      SELECT s.created_at AS date, pa.name AS party_name, pa.type AS party_type,
             'فاتورة بيع' AS label, s.invoice_no AS ref, '' AS note,
             s.total AS amount, (s.total - s.paid) AS effect
        FROM sales s JOIN parties pa ON pa.id = s.party_id WHERE s.party_id IS NOT NULL ${tFilter}
      UNION ALL
      SELECT pu.created_at, pa.name, 'supplier',
             'فاتورة شراء', pu.invoice_no, '', pu.total, -(pu.total - pu.paid)
        FROM purchases pu JOIN parties pa ON pa.id = pu.supplier_id WHERE ${type ? "pa.type = '" + type + "'" : '1=1'}
      UNION ALL
      SELECT rt.created_at, pa.name, pa.type,
             'مرتجع' || CASE WHEN rt.refund_method = 'credit' THEN ' (خصم من المستحق)' ELSE ' (استرداد)' END,
             rt.return_no, '', rt.subtotal,
             CASE WHEN rt.refund_method = 'credit' THEN -rt.subtotal ELSE 0 END
        FROM returns rt JOIN sales s ON s.id = rt.sale_id JOIN parties pa ON pa.id = s.party_id WHERE s.party_id IS NOT NULL ${tFilter}
      UNION ALL
      SELECT p.created_at, pa.name, pa.type,
             CASE WHEN p.type = 'in' THEN 'دفعة قبض من العميل' ELSE 'دفعة صرف للمورد' END,
             '', p.note, p.amount,
             CASE WHEN p.type = 'in' THEN -p.amount ELSE p.amount END
        FROM payments p JOIN parties pa ON pa.id = p.party_id WHERE p.party_id IS NOT NULL ${tFilter}
    ) x WHERE 1=1 ${dFrom} ${dTo}
    ORDER BY date DESC, ref DESC LIMIT 300`);

  rows = rows.map(r => ({ ...r, effect: Math.round((Number(r.effect) || 0) * 100) / 100 }));
  const totalEffect = Math.round(rows.reduce((a, r) => a + r.effect, 0) * 100) / 100;
  res.json({ list: rows, total_effect: totalEffect });
});

app.get('/api/reports/by-cashier', auth, permOrAdmin('reports'), (req, res) => {
  const from = req.query.from || '2020-01-01';
  const to = req.query.to || '2030-01-01';
  res.json(all(`SELECT u.id, u.full_name, COUNT(s.id) AS invoices, COALESCE(SUM(s.total),0) AS total
                FROM users u LEFT JOIN sales s ON s.user_id = u.id AND date(s.created_at) >= date(?) AND date(s.created_at) <= date(?)
                GROUP BY u.id ORDER BY total DESC`, [from, to]));
});

app.get('/api/reports/daily', auth, permOrAdmin('reports'), (req, res) => {
  const from = req.query.from || '2020-01-01';
  const to = req.query.to || '2030-01-01';
  res.json(all(`SELECT date(created_at) AS day, COUNT(*) AS count, COALESCE(SUM(total),0) AS total
                FROM sales WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
                GROUP BY day ORDER BY day`, [from, to]));
});

app.get('/api/reports/purchases', auth, permOrAdmin('reports'), (req, res) => {
  const from = req.query.from || '2020-01-01';
  const to = req.query.to || '2030-01-01';
  const list = all(`SELECT pu.*, pa.name AS supplier_name, u.full_name AS user_name
                    FROM purchases pu
                    JOIN parties pa ON pa.id = pu.supplier_id
                    LEFT JOIN users u ON u.id = pu.user_id
                    WHERE date(pu.created_at) >= date(?) AND date(pu.created_at) <= date(?)
                    ORDER BY pu.id DESC`, [from, to]);
  const totals = get(`SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid),0) AS paid, COALESCE(SUM(total - paid),0) AS due, COUNT(*) AS count
                      FROM purchases WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)`, [from, to]);
  res.json({ list, summary: totals });
});

app.get('/api/reports/serials', auth, permOrAdmin('reports'), (req, res) => {
  const status = req.query.status || '';
  let sql = `SELECT ps.*, p.name AS product_name, p.barcode AS product_barcode,
                    pu.invoice_no AS purchase_invoice, s.invoice_no AS sale_invoice
             FROM product_serials ps
             JOIN products p ON p.id = ps.product_id
             LEFT JOIN purchases pu ON pu.id = ps.purchase_id
             LEFT JOIN sales s ON s.id = ps.sale_id
             WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND ps.status = ?'; params.push(status); }
  sql += ' ORDER BY ps.id DESC LIMIT 1000';
  res.json(all(sql, params));
});

app.get('/api/reports/used-devices', auth, permOrAdmin('reports'), (req, res) => {
  const from = req.query.from || '2020-01-01';
  const to = req.query.to || '2030-01-01';
  const bought = all(`SELECT ud.*, u.full_name AS user_name FROM used_devices ud LEFT JOIN users u ON u.id = ud.user_id WHERE date(ud.purchase_date) >= date(?) AND date(ud.purchase_date) <= date(?) ORDER BY ud.id DESC`, [from, to]);
  const sold = all(`SELECT ud.*, u.full_name AS user_name FROM used_devices ud LEFT JOIN users u ON u.id = ud.user_id WHERE ud.status = 'sold' AND date(ud.sale_date) >= date(?) AND date(ud.sale_date) <= date(?) ORDER BY ud.id DESC`, [from, to]);
  const available = all(`SELECT * FROM used_devices WHERE status = 'available' ORDER BY id DESC`);
  const boughtSum = get(`SELECT COALESCE(SUM(purchase_price),0) AS total, COUNT(*) AS count FROM used_devices WHERE date(purchase_date) >= date(?) AND date(purchase_date) <= date(?)`, [from, to]);
  const soldSum = get(`SELECT COALESCE(SUM(sale_price),0) AS revenue, COALESCE(SUM(purchase_price),0) AS cogs, COALESCE(SUM(sale_price - purchase_price),0) AS profit, COUNT(*) AS count FROM used_devices WHERE status = 'sold' AND date(sale_date) >= date(?) AND date(sale_date) <= date(?)`, [from, to]);
  res.json({ bought, sold, available, summary: { bought: boughtSum, sold: soldSum } });
});

app.get('/api/reports/employees', auth, permOrAdmin('reports'), (req, res) => {
  const from = req.query.from || '2020-01-01';
  const to = req.query.to || '2030-01-01';
  const closings = all(`SELECT sc.*, e.name AS employee_name, u.full_name AS user_name FROM salary_closings sc JOIN employees e ON e.id = sc.employee_id LEFT JOIN users u ON u.id = sc.user_id WHERE date(sc.created_at) >= date(?) AND date(sc.created_at) <= date(?) ORDER BY sc.id DESC`, [from, to]);
  const payments = all(`SELECT p.*, e.name AS employee_name, u.full_name AS user_name FROM payments p JOIN employees e ON e.id = p.employee_id LEFT JOIN users u ON u.id = p.user_id WHERE p.employee_id IS NOT NULL AND date(p.created_at) >= date(?) AND date(p.created_at) <= date(?) ORDER BY p.id DESC`, [from, to]);
  const vacations = all(`SELECT v.*, e.name AS employee_name FROM vacations v JOIN employees e ON e.id = v.employee_id WHERE date(v.created_at) >= date(?) AND date(v.created_at) <= date(?) ORDER BY v.id DESC`, [from, to]);
  res.json({ closings, payments, vacations });
});

app.get('/api/reports/stocktakes', auth, permOrAdmin('reports'), (req, res) => {
  const list = all(`SELECT st.*, u.full_name AS user_name,
                    (SELECT COUNT(*) FROM stocktake_items sti WHERE sti.stocktake_id = st.id) AS items_count,
                    (SELECT COALESCE(SUM(diff),0) FROM stocktake_items sti WHERE sti.stocktake_id = st.id) AS total_diff
                    FROM stocktakes st LEFT JOIN users u ON u.id = st.user_id ORDER BY st.id DESC LIMIT 100`);
  res.json(list);
});

app.get('/api/reports/categories-sales', auth, permOrAdmin('reports'), (req, res) => {
  const from = req.query.from || '2020-01-01';
  const to = req.query.to || '2030-01-01';
  const list = all(`SELECT c.id, c.name AS category_name, pc.name AS parent_name,
                    COUNT(DISTINCT si.sale_id) AS invoices_count,
                    COALESCE(SUM(si.qty),0) AS qty_sold,
                    COALESCE(SUM(si.total),0) AS total_sales,
                    COALESCE(SUM(si.qty * (si.price - p.purchase_price)),0) AS estimated_profit
                    FROM sale_items si
                    JOIN sales s ON s.id = si.sale_id
                    JOIN products p ON p.id = si.product_id
                    LEFT JOIN categories c ON c.id = p.category_id
                    LEFT JOIN categories pc ON pc.id = c.parent_id
                    WHERE date(s.created_at) >= date(?) AND date(s.created_at) <= date(?)
                    GROUP BY c.id ORDER BY total_sales DESC`, [from, to]);
  res.json(list);
});

/* ==================== EXPENSES ==================== */
const EXPENSE_CATEGORIES = ['cleaning', 'internet', 'maintenance', 'rent', 'utilities', 'other'];
app.get('/api/expenses', auth, permOrAdmin('expenses'), (req, res) => {
  const { from, to, category } = req.query;
  const params = [];
  let where = '1=1';
  if (from) { where += ' AND date(e.spent_at) >= date(?)'; params.push(from); }
  if (to) { where += ' AND date(e.spent_at) <= date(?)'; params.push(to); }
  if (category) { where += ' AND e.category = ?'; params.push(category); }
  const list = all(`SELECT e.*, u.full_name AS user_name FROM expenses e LEFT JOIN users u ON u.id = e.user_id WHERE ${where} ORDER BY e.id DESC LIMIT 500`, params);
  const agg = get(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM expenses e WHERE ${where}`, params);
  res.json({ list, total: Math.round(agg.total * 100) / 100, count: agg.count });
});
app.post('/api/expenses', auth, permOrAdmin('expenses'), (req, res) => {
  const { category, amount, note, spent_at } = req.body || {};
  if (!EXPENSE_CATEGORIES.includes(category)) return res.status(400).json({ error: 'تصنيف المصروف غير صحيح' });
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  if (amt <= 0) return res.status(400).json({ error: 'أدخل مبلغاً صحيحاً أكبر من صفر' });
  const m = ['cash', 'card', 'wallet', 'transfer'].includes(req.body?.method) ? req.body.method : 'cash';
  const when = spent_at || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const r = run('INSERT INTO expenses (category, amount, note, spent_at, user_id, method) VALUES (?,?,?,?,?,?)',
    [category, amt, String(note || '').slice(0, 300), when, req.user.id, m]);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.delete('/api/expenses/:id', auth, permOrAdmin('expenses'), (req, res) => {
  run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* ==================== SETTINGS ==================== */
app.get('/api/settings', auth, (req, res) => {
  const rows = all('SELECT * FROM settings');
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json(obj);
});
app.put('/api/settings', auth, adminOnly, (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, String(v)]);
  }
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'ARP Grocery' }));

/* ==================== MAINTENANCE ==================== */
function recalcJob(jobId) {
  const job = get('SELECT * FROM maintenance_jobs WHERE id = ?', [jobId]);
  if (!job) return;
  const pc = get('SELECT COALESCE(SUM(total),0) AS s FROM job_parts WHERE job_id = ?', [jobId]).s;
  run('UPDATE maintenance_jobs SET parts_cost = ?, total = ?, updated_at = datetime("now","localtime") WHERE id = ?',
    [Math.round(pc * 100) / 100, Math.round((pc + (job.labor_cost || 0)) * 100) / 100, jobId]);
}

app.get('/api/maintenance/jobs', auth, (req, res) => {
  const q = req.query.q || '';
  const status = req.query.status || '';
  let sql = `SELECT j.*, u.full_name AS created_by FROM maintenance_jobs j LEFT JOIN users u ON u.id = j.user_id WHERE 1=1`;
  const params = [];
  if (q) { sql += ' AND (j.customer_name LIKE ? OR j.customer_phone LIKE ? OR j.device LIKE ? OR j.job_no LIKE ? OR EXISTS (SELECT 1 FROM job_parts jp WHERE jp.job_id = j.id AND jp.part_name LIKE ?))'; params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (status) { sql += ' AND j.status = ?'; params.push(status); }
  sql += ' ORDER BY j.id DESC LIMIT 300';
  res.json(all(sql, params));
});
app.get('/api/maintenance/jobs/:id', auth, (req, res) => {
  const job = get('SELECT j.*, u.full_name AS created_by FROM maintenance_jobs j LEFT JOIN users u ON u.id = j.user_id WHERE j.id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'أمر الصيانة غير موجود' });
  job.parts = all(`SELECT jp.*, sp.stock AS part_stock, ps.name AS supplier_name
                   FROM job_parts jp
                   LEFT JOIN spare_parts sp ON sp.id = jp.part_id
                   LEFT JOIN part_suppliers ps ON ps.id = sp.supplier_id
                   WHERE jp.job_id = ? ORDER BY jp.id`, [job.id]);
  job.parts_purchase = Math.round(job.parts.reduce((s, p) => s + (p.qty * (p.purchase_price || 0)), 0) * 100) / 100;
  job.profit = Math.round(((job.total || 0) - job.parts_purchase) * 100) / 100;
  res.json(job);
});
app.post('/api/maintenance/jobs', auth, (req, res) => {
  const { customer_name, customer_phone, device, problem, labor_cost, notes, deposit, deposit_method, due_date, claim_until } = req.body || {};
  const dep = Number(deposit) || 0;
  const jobNo = nextInvoice('JOB');
  const r = run(`INSERT INTO maintenance_jobs (job_no, customer_name, customer_phone, device, problem, labor_cost, notes, deposit, due_date, claim_until, paid, user_id, branch_id)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [jobNo, String(customer_name || '').trim(), String(customer_phone || '').trim(),
     String(device || '').trim(), String(problem || '').trim(), Number(labor_cost) || 0,
     String(notes || '').trim(), dep, due_date || null, claim_until || null, dep,
     req.user.id, req.user.branch_id || null]);
  if (dep > 0) {
    run(`INSERT INTO maintenance_payments (job_id, user_id, amount, method, note) VALUES (?,?,?,?,?)`,
      [r.lastInsertRowid, req.user.id, dep, ['cash','card','wallet'].includes(deposit_method) ? deposit_method : 'cash', 'عربون عند استلام الأمر']);
  }
  recalcJob(r.lastInsertRowid);
  res.json({ ok: true, id: r.lastInsertRowid, job_no: jobNo });
});

app.post('/api/maintenance/jobs/:id/pay', auth, (req, res) => {
  const job = get('SELECT * FROM maintenance_jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'أمر الصيانة غير موجود' });
  if (job.status === 'cancelled') return res.status(400).json({ error: 'لا يمكن التحصيل على أمر ملغي' });
  const { method, note, close } = req.body || {};
  const remaining = Math.round(((job.total || 0) - (job.paid || 0)) * 100) / 100;
  let amount = Number(req.body?.amount);
  if (!Number.isFinite(amount)) return res.status(400).json({ error: 'المبلغ غير صحيح' });
  if (amount <= 0 && !(close && remaining <= 0.001)) return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
  if (remaining > 0.001 && close) amount = remaining;
  amount = Math.round(amount * 100) / 100;
  if (amount > remaining + 0.001) return res.status(400).json({ error: `المبلغ أكبر من المتبقي (${remaining})` });
  const m = ['cash', 'card', 'wallet'].includes(method) ? method : 'cash';
  transaction((j, amt, meth, nt) => {
    run('INSERT INTO maintenance_payments (job_id, user_id, amount, method, note) VALUES (?,?,?,?,?)',
      [j.id, req.user.id, amt, meth, String(nt || '')]);
    run('UPDATE maintenance_jobs SET paid = paid + ?, updated_at = datetime("now","localtime") WHERE id = ?', [amt, j.id]);
    if (close) {
      run(`UPDATE maintenance_jobs SET status = 'delivered',
           delivered_at = CASE WHEN delivered_at IS NULL THEN datetime('now','localtime') ELSE delivered_at END,
           updated_at = datetime('now','localtime') WHERE id = ?`, [j.id]);
    }
  })(job, amount, m, note);
  const updated = get('SELECT id, job_no, total, paid, status FROM maintenance_jobs WHERE id = ?', [job.id]);
  res.json({ ok: true, job: updated, remaining: Math.round(((updated.total || 0) - (updated.paid || 0)) * 100) / 100 });
});

app.get('/api/maintenance/jobs/:id/payments', auth, (req, res) => {
  const job = get('SELECT id FROM maintenance_jobs WHERE id = ?', [req.params.id]);
  if (!job) return status404Job(res);
  res.json(all(`SELECT mp.*, u.full_name AS user_name FROM maintenance_payments mp
                LEFT JOIN users u ON u.id = mp.user_id WHERE mp.job_id = ? ORDER BY mp.id DESC`, [job.id]));
});

function status404Job(res) { return res.status(404).json({ error: 'أمر الصيانة غير موجود' }); }

app.get('/api/maintenance/board', auth, (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : new Date().toISOString().slice(0, 10);
  const todayJobs = all(`SELECT j.*, u.full_name AS created_by FROM maintenance_jobs j
                         LEFT JOIN users u ON u.id = j.user_id
                         WHERE date(j.created_at) = date(?) ORDER BY j.id DESC`, [date]);
  const openJobs = all(`SELECT j.*, u.full_name AS created_by,
                        CAST(julianday('now','localtime') - julianday(j.created_at) AS INTEGER) AS age_days
                        FROM maintenance_jobs j LEFT JOIN users u ON u.id = j.user_id
                        WHERE j.status NOT IN ('delivered','cancelled')
                        ORDER BY (j.total - j.paid) DESC, j.id`);
  const payments = all(`SELECT mp.*, j.job_no, j.customer_name, u.full_name AS user_name
                        FROM maintenance_payments mp
                        JOIN maintenance_jobs j ON j.id = mp.job_id
                        LEFT JOIN users u ON u.id = mp.user_id
                        WHERE date(mp.created_at) = date(?) ORDER BY mp.id DESC`, [date]);
  const r2 = n => Math.round(n * 100) / 100;
  const openRemaining = r2(openJobs.reduce((s, j) => s + Math.max(0, (j.total || 0) - (j.paid || 0)), 0));
  res.json({
    date,
    today_jobs: todayJobs,
    open_jobs: openJobs,
    today_payments: payments,
    summary: {
      today_count: todayJobs.length,
      today_total: r2(todayJobs.reduce((s, j) => s + (j.total || 0), 0)),
      collected_today: r2(payments.reduce((s, p) => s + (p.amount || 0), 0)),
      collected_cash: r2(payments.filter(p => p.method === 'cash').reduce((s, p) => s + (p.amount || 0), 0)),
      payments_count: payments.length,
      open_count: openJobs.length,
      open_remaining: openRemaining,
    },
  });
});

app.get('/api/maintenance/report', auth, permOrAdmin('reports'), (req, res) => {
  const from = req.query.from || '2020-01-01';
  const to = req.query.to || '9999-12-31';
  const jobs = all(`SELECT j.*, u.full_name AS created_by FROM maintenance_jobs j
                    LEFT JOIN users u ON u.id = j.user_id
                    WHERE date(j.created_at) >= date(?) AND date(j.created_at) <= date(?)
                    ORDER BY j.id DESC LIMIT 500`, [from, to]);
  const payments = all(`SELECT mp.*, j.job_no, j.customer_name, u.full_name AS user_name
                        FROM maintenance_payments mp
                        JOIN maintenance_jobs j ON j.id = mp.job_id
                        LEFT JOIN users u ON u.id = mp.user_id
                        WHERE date(mp.created_at) >= date(?) AND date(mp.created_at) <= date(?)
                        ORDER BY mp.id DESC LIMIT 500`, [from, to]);
  const byDay = all(`SELECT date(created_at) AS day, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
                     FROM maintenance_payments
                     WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
                     GROUP BY date(created_at) ORDER BY day DESC LIMIT 200`, [from, to]);
  const openJobs = all(`SELECT COUNT(*) AS count, COALESCE(SUM(MAX(total - paid, 0)),0) AS remaining
                        FROM maintenance_jobs WHERE status NOT IN ('delivered','cancelled')`);
  const r2 = n => Math.round(n * 100) / 100;
  res.json({
    summary: {
      jobs_count: jobs.length,
      jobs_total: r2(jobs.reduce((s, j) => s + (j.total || 0), 0)),
      collected: r2(payments.reduce((s, p) => s + (p.amount || 0), 0)),
      collected_cash: r2(payments.filter(p => p.method === 'cash').reduce((s, p) => s + (p.amount || 0), 0)),
      deposits: r2(payments.filter(p => (p.note || '').includes('عربون')).reduce((s, p) => s + (p.amount || 0), 0)),
      payments_count: payments.length,
      still_open_count: openJobs[0] ? openJobs[0].count : 0,
      still_open_remaining: openJobs[0] ? r2(openJobs[0].remaining) : 0,
    },
    jobs,
    payments,
    by_day: byDay,
  });
});
app.put('/api/maintenance/jobs/:id', auth, (req, res) => {
  const job = get('SELECT * FROM maintenance_jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'أمر الصيانة غير موجود' });
  const b = req.body || {};
  const status = b.status || job.status;
  if (!['received', 'repairing', 'done', 'delivered', 'cancelled'].includes(status)) return res.status(400).json({ error: 'حالة غير صحيحة' });
  run(`UPDATE maintenance_jobs SET customer_name=?, customer_phone=?, device=?, problem=?, labor_cost=?, paid=?, deposit=?, due_date=?, claim_until=?, notes=?, status=?,
       delivered_at=CASE WHEN ?='delivered' AND delivered_at IS NULL THEN datetime('now','localtime') ELSE delivered_at END,
       updated_at=datetime('now','localtime') WHERE id=?`,
    [b.customer_name ?? job.customer_name, b.customer_phone ?? job.customer_phone,
     b.device ?? job.device, b.problem ?? job.problem,
     b.labor_cost === undefined ? job.labor_cost : Number(b.labor_cost) || 0,
     b.paid === undefined ? job.paid : Number(b.paid) || 0,
     b.deposit === undefined ? job.deposit : Number(b.deposit) || 0,
     b.due_date === undefined ? job.due_date : (b.due_date || null),
     b.claim_until === undefined ? job.claim_until : (b.claim_until || null),
     b.notes ?? job.notes, status, status, job.id]);
  recalcJob(job.id);
  res.json({ ok: true });
});
app.delete('/api/maintenance/jobs/:id', auth, permOrAdmin('maintenance.delete_job'), (req, res) => {
  const job = get('SELECT * FROM maintenance_jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'غير موجود' });
  const lines = all('SELECT * FROM job_parts WHERE job_id = ? AND part_id IS NOT NULL', [job.id]);
  const doDel = transaction(() => {
    for (const l of lines) run('UPDATE spare_parts SET stock = stock + ? WHERE id = ?', [l.qty, l.part_id]);
    run('DELETE FROM job_parts WHERE job_id = ?', [job.id]);
    run('DELETE FROM maintenance_jobs WHERE id = ?', [job.id]);
  });
  doDel();
  res.json({ ok: true });
});
app.post('/api/maintenance/jobs/:id/parts', auth, (req, res) => {
  const job = get('SELECT * FROM maintenance_jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'أمر الصيانة غير موجود' });
  const { part_id, qty, price, part_name } = req.body || {};
  const n = Number(qty) || 0;
  if (n <= 0) return res.status(400).json({ error: 'الكمية غير صحيحة' });
  let name = String(part_name || '').trim();
  let unitPrice = Number(price) || 0;
  let pid = null;
  if (part_id) {
    const p = get('SELECT * FROM spare_parts WHERE id = ?', [part_id]);
    if (!p) return res.status(404).json({ error: 'القطعة غير موجودة' });
    if (p.stock < n) return res.status(400).json({ error: `المخزون من "${p.name}" لا يكفي (المتاح: ${p.stock})` });
    pid = p.id;
    name = name || p.name;
    unitPrice = unitPrice || p.sale_price;
    run('UPDATE spare_parts SET stock = stock - ? WHERE id = ?', [n, pid]);
  }
  if (!name) return res.status(400).json({ error: 'اسم القطعة مطلوب' });
  const purchasePrice = pid ? (get('SELECT purchase_price FROM spare_parts WHERE id = ?', [pid])?.purchase_price || 0) : 0;
  run('INSERT INTO job_parts (job_id, part_id, part_name, qty, price, purchase_price, total) VALUES (?,?,?,?,?,?,?)',
    [job.id, pid, name, n, unitPrice, purchasePrice, Math.round(n * unitPrice * 100) / 100]);
  recalcJob(job.id);
  res.json({ ok: true });
});
app.delete('/api/maintenance/jobs/:id/parts/:lineId', auth, (req, res) => {
  const line = get('SELECT * FROM job_parts WHERE id = ? AND job_id = ?', [req.params.lineId, req.params.id]);
  if (!line) return res.status(404).json({ error: 'السطر غير موجود' });
  const doDel = transaction(() => {
    if (line.part_id) run('UPDATE spare_parts SET stock = stock + ? WHERE id = ?', [line.qty, line.part_id]);
    run('DELETE FROM job_parts WHERE id = ?', [line.id]);
  });
  doDel();
  recalcJob(line.job_id);
  res.json({ ok: true });
});

app.get('/api/spare-parts', auth, (req, res) => {
  const q = req.query.q || '';
  let sql = `SELECT sp.*, ps.name AS supplier_name,
             (SELECT ps2.name FROM spare_stock_moves sm LEFT JOIN part_suppliers ps2 ON ps2.id = sm.supplier_id
              WHERE sm.part_id = sp.id AND sm.qty > 0 AND sm.supplier_id IS NOT NULL ORDER BY sm.id DESC LIMIT 1) AS last_supplier
             FROM spare_parts sp LEFT JOIN part_suppliers ps ON ps.id = sp.supplier_id WHERE 1=1`;
  const params = [];
  if (q) { sql += ' AND sp.name LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY sp.name';
  res.json(all(sql, params));
});
app.post('/api/spare-parts', auth, (req, res) => {
  const { name, supplier_id, purchase_price, sale_price, stock, min_stock } = req.body || {};
  if (!name) return res.status(400).json({ error: 'اسم القطعة مطلوب' });
  const r = run('INSERT INTO spare_parts (name, supplier_id, purchase_price, sale_price, stock, min_stock) VALUES (?,?,?,?,?,?)',
    [String(name).trim(), supplier_id || null, Number(purchase_price) || 0, Number(sale_price) || 0, Number(stock) || 0, Number(min_stock) || 0]);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/spare-parts/:id', auth, (req, res) => {
  const p = get('SELECT * FROM spare_parts WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'القطعة غير موجودة' });
  const b = req.body || {};
  run('UPDATE spare_parts SET name=?, supplier_id=?, purchase_price=?, sale_price=?, stock=?, min_stock=?, active=? WHERE id=?',
    [b.name ?? p.name, b.supplier_id === undefined ? p.supplier_id : (b.supplier_id || null),
     b.purchase_price ?? p.purchase_price, b.sale_price ?? p.sale_price,
     b.stock ?? p.stock, b.min_stock ?? p.min_stock,
     b.active === undefined ? p.active : b.active ? 1 : 0, p.id]);
  res.json({ ok: true });
});
app.delete('/api/spare-parts/:id', auth, (req, res) => {
  const used = get('SELECT COUNT(*) AS n FROM job_parts WHERE part_id = ?', [req.params.id]).n;
  if (used > 0) return res.status(400).json({ error: `لا يمكن الحذف — القطعة مستخدمة في ${used} أمر صيانة` });
  run('DELETE FROM spare_parts WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});
app.post('/api/spare-parts/:id/stock', auth, (req, res) => {
  const p = get('SELECT * FROM spare_parts WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'القطعة غير موجودة' });
  const delta = Number(req.body?.delta) || 0;
  if (!delta) return res.status(400).json({ error: 'أدخل كمية صحيحة' });
  const supplierId = req.body?.supplier_id ? Number(req.body.supplier_id) : null;
  const unitCost = Math.round((Number(req.body?.purchase_price) || 0) * 100) / 100;
  const note = String(req.body?.note || '').trim();
  if (delta > 0 && !supplierId) return res.status(400).json({ error: 'حدد المورد الخاص بهذه التورة' });
  if (p.stock + delta < 0) return res.status(400).json({ error: `الخصم أكبر من المخزون الحالي (${p.stock})` });
  transaction(() => {
    run('UPDATE spare_parts SET stock = stock + ?, purchase_price = CASE WHEN ? > 0 THEN ? ELSE purchase_price END WHERE id = ?',
      [delta, unitCost, unitCost, p.id]);
    run(`INSERT INTO spare_stock_moves (part_id, qty, supplier_id, purchase_price, note, user_id) VALUES (?,?,?,?,?,?)`,
      [p.id, delta, delta > 0 ? supplierId : null, unitCost, note, req.user.id]);
  })();
  res.json({ ok: true, stock: p.stock + delta });
});

app.get('/api/part-suppliers', auth, (req, res) => {
  res.json(all(`SELECT ps.*,
                (SELECT COALESCE(SUM(sm.qty * sm.purchase_price),0) FROM spare_stock_moves sm
                 WHERE sm.supplier_id = ps.id AND sm.qty > 0) AS purchased_total,
                (SELECT COALESCE(SUM(pp.amount),0) FROM part_supplier_payments pp WHERE pp.supplier_id = ps.id) AS paid_total
                FROM part_suppliers ps ORDER BY ps.name`));
});
app.post('/api/part-suppliers', auth, (req, res) => {
  const { name, phone, address } = req.body || {};
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const r = run('INSERT INTO part_suppliers (name, phone, address) VALUES (?,?,?)',
    [String(name).trim(), String(phone || '').trim(), String(address || '').trim()]);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/part-suppliers/:id', auth, (req, res) => {
  const s = get('SELECT * FROM part_suppliers WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'المورد غير موجود' });
  const b = req.body || {};
  run('UPDATE part_suppliers SET name=?, phone=?, address=? WHERE id=?',
    [b.name ?? s.name, b.phone ?? s.phone, b.address ?? s.address, s.id]);
  res.json({ ok: true });
});
app.delete('/api/part-suppliers/:id', auth, (req, res) => {
  const usedMoves = get('SELECT COUNT(*) AS n FROM spare_stock_moves WHERE supplier_id = ?', [req.params.id]).n;
  const usedPays = get('SELECT COUNT(*) AS n FROM part_supplier_payments WHERE supplier_id = ?', [req.params.id]).n;
  if (usedMoves > 0 || usedPays > 0) return res.status(400).json({ error: `لا يمكن الحذف — له ${usedMoves} تورة مخزون و${usedPays} دفعة سداد مسجلة` });
  run('DELETE FROM part_suppliers WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/part-suppliers/:id/pay', auth, (req, res) => {
  const s = get('SELECT * FROM part_suppliers WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'المورد غير موجود' });
  const amount = Math.round((Number(req.body?.amount) || 0) * 100) / 100;
  if (amount <= 0) return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
  const method = ['cash', 'card', 'wallet', 'transfer'].includes(req.body?.method) ? req.body.method : 'cash';
  run('INSERT INTO part_supplier_payments (supplier_id, amount, method, note, user_id) VALUES (?,?,?,?,?)',
    [s.id, amount, method, String(req.body?.note || '').trim(), req.user.id]);
  res.json({ ok: true });
});

app.get('/api/part-suppliers/:id/payments', auth, (req, res) => {
  const s = get('SELECT id FROM part_suppliers WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'المورد غير موجود' });
  const payments = all(`SELECT pp.*, u.full_name AS user_name FROM part_supplier_payments pp
                        LEFT JOIN users u ON u.id = pp.user_id WHERE pp.supplier_id = ? ORDER BY pp.id DESC`, [s.id]);
  const moves = all(`SELECT sm.*, sp.name AS part_name FROM spare_stock_moves sm
                     JOIN spare_parts sp ON sp.id = sm.part_id
                     WHERE sm.supplier_id = ? AND sm.qty > 0 ORDER BY sm.id DESC LIMIT 200`, [s.id]);
  const r2 = n => Math.round(n * 100) / 100;
  res.json({
    payments,
    purchases: moves,
    totals: {
      purchased: r2(moves.reduce((a, m) => a + m.qty * m.purchase_price, 0)),
      paid: r2(payments.reduce((a, p) => a + p.amount, 0)),
    },
  });
});

/* ==================== BACKUP ==================== */
app.get('/api/backup/list', auth, adminOnly, (req, res) => {
  res.json(listBackups());
});
app.post('/api/backup/create', auth, adminOnly, (req, res) => {
  const file = backup();
  res.json({ ok: true, file: path.basename(file) });
});
app.post('/api/backup/restore', auth, adminOnly, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'اختر ملف النسخة الاحتياطية' });
  try {
    restore(name);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.get('/api/backup/download/:name', auth, adminOnly, (req, res) => {
  const file = path.join(DATA_DIR, 'backups', path.basename(req.params.name));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'غير موجود' });
  res.download(file);
});
app.post('/api/backup/factory-reset', auth, adminOnly, (req, res) => {
  try {
    const safety = backup();

    transaction(() => {
      // 1. Clear transactional tables
      run('DELETE FROM sale_items');
      run('DELETE FROM sales');
      run('DELETE FROM return_items');
      run('DELETE FROM returns');
      run('DELETE FROM purchase_items');
      run('DELETE FROM purchases');
      run('DELETE FROM payments');

      // 2. Clear maintenance, repairs & spare parts
      run('DELETE FROM job_parts');
      run('DELETE FROM maintenance_payments');
      run('DELETE FROM maintenance_jobs');
      run('DELETE FROM spare_stock_moves');
      run('DELETE FROM spare_parts');
      run('DELETE FROM part_supplier_payments');
      run('DELETE FROM part_suppliers');

      // 3. Clear inventory, products, categories & serials
      run('DELETE FROM product_serials');
      run('DELETE FROM price_history');
      run('DELETE FROM products');
      run('DELETE FROM categories');
      run('DELETE FROM stocktake_items');
      run('DELETE FROM stocktakes');
      run('DELETE FROM coupons');
      run('DELETE FROM used_devices');

      // 4. Clear financial & operational records
      run('DELETE FROM expenses');
      run('DELETE FROM employee_commissions');
      run('DELETE FROM vacations');
      run('DELETE FROM salary_closings');
      run('DELETE FROM employees');
      run('DELETE FROM partner_txns');
      run('DELETE FROM partners');
      run('DELETE FROM shifts');
      run('DELETE FROM parties');

      // 5. Reset users: remove non-admin users, reset admin password to admin123
      run('DELETE FROM users WHERE username != ?', ['admin']);
      let branchId = null;
      if (get('SELECT COUNT(*) AS c FROM branches').c === 0) {
        const b = run('INSERT INTO branches (name, code, address, phone) VALUES (?,?,?,?)', ['الفرع الرئيسي', 'BR-001', '', '']);
        branchId = b.lastInsertRowid;
      } else {
        branchId = get('SELECT id FROM branches ORDER BY id LIMIT 1').id;
      }

      const hash = bcrypt.hashSync('admin123', 10);
      if (get('SELECT id FROM users WHERE username = ?', ['admin'])) {
        run('UPDATE users SET password_hash = ?, full_name = ?, role = ?, branch_id = ? WHERE username = ?',
          [hash, 'مدير النظام', 'admin', branchId, 'admin']);
      } else {
        run('INSERT INTO users (username, password_hash, full_name, role, branch_id) VALUES (?,?,?,?,?)',
          ['admin', hash, 'مدير النظام', 'admin', branchId]);
      }

      // 6. Delete all settings EXCEPT bot settings and license
      run(`
        DELETE FROM settings 
        WHERE key NOT LIKE 'bot_%' 
          AND key NOT LIKE 'ultramsg_%' 
          AND key NOT LIKE 'gemini_%' 
          AND key NOT LIKE 'store_owner_%' 
          AND key NOT IN ('license_json', 'store_name', 'n8n_webhook_url')
      `);

      // 7. Reset auto-increment sequences for wiped tables so IDs start fresh from 1
      const tablesToResetSeq = [
        'sale_items', 'sales', 'return_items', 'returns', 'purchase_items', 'purchases',
        'payments', 'job_parts', 'maintenance_payments', 'maintenance_jobs',
        'spare_stock_moves', 'spare_parts', 'part_supplier_payments', 'part_suppliers',
        'product_serials', 'price_history', 'products', 'categories', 'stocktake_items',
        'stocktakes', 'coupons', 'used_devices', 'expenses', 'employee_commissions',
        'vacations', 'salary_closings', 'employees', 'partner_txns', 'partners',
        'shifts', 'parties'
      ];
      for (const tbl of tablesToResetSeq) {
        try { run('DELETE FROM sqlite_sequence WHERE name = ?', [tbl]); } catch (e) {}
      }
    })();

    console.log('>> [Reset] تمت إعادة ضبط بيانات البرنامج بنجاح مع الاحتفاظ بكافة بيانات وإعدادات البوت والواتساب.');
    res.json({ ok: true, safety: path.basename(safety) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ==================== SHIFTS ==================== */
const SHIFT_METHODS = ['cash', 'card', 'wallet', 'transfer'];
function shiftRound(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function nowLocalStr() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function shiftBreakdown(userId, since, until) {
  const r2 = shiftRound;
  // compare via datetime() so 'HH:MM:SS' rows match an 'HH:MM:SS.SSS' boundary
  const cond = until ? 'AND datetime(created_at) <= datetime(?)' : '';
  const P = [userId, since, ...(until ? [until] : [])];
  const m = {};
  for (const k of SHIFT_METHODS) m[k] = { in: 0, out: 0 };
  const bump = (method, dir, amt) => {
    if (SHIFT_METHODS.includes(method)) {
      m[method][dir] += Number(amt) || 0;
    }
  };
  const info = {};

  // 1) sales paid per method (+ credit remainder tracked separately)
  const rows = all(`SELECT total, paid, payment_method, payments_json FROM sales WHERE user_id = ? AND datetime(created_at) >= datetime(?) ${cond}`, P);
  let salesTotal = 0, creditDue = 0;
  for (const s of rows) {
    salesTotal += Number(s.total) || 0;
    let paidSum = null;
    if (s.payments_json) {
      try {
        const ps = JSON.parse(s.payments_json);
        paidSum = 0;
        for (const p of ps) { bump(p.method, 'in', p.amount); paidSum += Number(p.amount) || 0; }
      } catch { paidSum = null; }
    }
    if (paidSum === null) { bump(s.payment_method, 'in', s.paid); paidSum = Number(s.paid) || 0; }
    const due = Math.round(((Number(s.total) || 0) - paidSum) * 100) / 100;
    if (due > 0.001) creditDue += due;
  }
  info.sales_count = rows.length;
  info.sales_total = r2(salesTotal);
  info.credit_due = r2(creditDue);

  // 2) merchandise purchases created in shift (+ supplier credit due)
  const purCond = until ? 'AND datetime(created_at) <= datetime(?)' : '';
  const purRows = all(`SELECT total, paid FROM purchases WHERE user_id = ? AND datetime(created_at) >= datetime(?) ${purCond}`, P);
  let purTotal = 0, purPaid = 0, purCreditDue = 0;
  for (const pu of purRows) {
    const t = Number(pu.total) || 0;
    const p = Number(pu.paid) || 0;
    purTotal += t;
    purPaid += p;
    if (t > p) purCreditDue += (t - p);
  }
  info.purchase_count = purRows.length;
  info.purchase_total = r2(purTotal);
  info.purchase_paid = r2(purPaid);
  info.purchase_credit_due = r2(purCreditDue);

  // 3) customer receipts (IN)
  const custIn = all(`SELECT method, SUM(amount) AS a, COUNT(*) AS c FROM payments WHERE type='in' AND party_id IS NOT NULL AND user_id = ? AND datetime(created_at) >= datetime(?) ${cond} GROUP BY method`, P);
  info.cust_in_count = custIn.reduce((a, x) => a + x.c, 0);
  for (const x of custIn) bump(x.method, 'in', x.a);

  // 4) maintenance collections (IN)
  const maint = all(`SELECT method, SUM(amount) AS a, COUNT(*) AS c FROM maintenance_payments WHERE user_id = ? AND datetime(created_at) >= datetime(?) ${cond} GROUP BY method`, P);
  info.maint_count = maint.reduce((a, x) => a + x.c, 0);
  info.maint_total = r2(maint.reduce((a, x) => a + Number(x.a), 0));
  for (const x of maint) bump(x.method, 'in', x.a);

  // 5) spare-parts supplier payments (OUT)
  const parts = all(`SELECT method, SUM(amount) AS a, COUNT(*) AS c FROM part_supplier_payments WHERE user_id = ? AND datetime(created_at) >= datetime(?) ${cond} GROUP BY method`, P);
  info.parts_out_count = parts.reduce((a, x) => a + x.c, 0);
  for (const x of parts) bump(x.method, 'out', x.a);

  // 6) party supplier payments (OUT)
  const supOut = all(`SELECT method, SUM(amount) AS a, COUNT(*) AS c FROM payments WHERE type='out' AND party_id IS NOT NULL AND user_id = ? AND datetime(created_at) >= datetime(?) ${cond} GROUP BY method`, P);
  info.sup_out_count = supOut.reduce((a, x) => a + x.c, 0);
  for (const x of supOut) bump(x.method, 'out', x.a);

  // 7) employee payouts — advances/salaries (OUT)
  const empOut = all(`SELECT method, SUM(amount) AS a, COUNT(*) AS c FROM payments WHERE type='out' AND employee_id IS NOT NULL AND user_id = ? AND datetime(created_at) >= datetime(?) ${cond} GROUP BY method`, P);
  info.emp_out_count = empOut.reduce((a, x) => a + x.c, 0);
  for (const x of empOut) bump(x.method, 'out', x.a);

  // 8) expenses (OUT)
  const exps = all(`SELECT method, SUM(amount) AS a, COUNT(*) AS c FROM expenses WHERE user_id = ? AND datetime(created_at) >= datetime(?) ${cond} GROUP BY method`, P);
  info.expense_count = exps.reduce((a, x) => a + x.c, 0);
  for (const x of exps) bump(x.method, 'out', x.a);

  // 9) sales returns (OUT) — القيمة الكاملة للمرتجع تخصم من طريقة الرد
  const rets = all(`SELECT refund_method AS method, SUM(subtotal) AS a, COUNT(*) AS c FROM returns WHERE user_id = ? AND datetime(created_at) >= datetime(?) ${cond} GROUP BY refund_method`, P);
  info.return_count = rets.reduce((a, x) => a + x.c, 0);
  info.return_total = r2(rets.reduce((a, x) => a + Number(x.a), 0));
  for (const x of rets) bump(x.method, 'out', x.a);

  // 10) used devices purchases (OUT)
  const udBuyCond = until ? 'AND datetime(purchase_date) <= datetime(?)' : '';
  const udBuys = all(`SELECT COALESCE(purchase_method, 'cash') AS method, SUM(purchase_price) AS a, COUNT(*) AS c FROM used_devices WHERE user_id = ? AND datetime(purchase_date) >= datetime(?) ${udBuyCond} GROUP BY COALESCE(purchase_method, 'cash')`, P);
  let udBuyTotal = 0, udBuyCredit = 0;
  for (const x of udBuys) {
    const amt = Number(x.a) || 0;
    udBuyTotal += amt;
    if (x.method === 'credit') udBuyCredit += amt;
    else bump(x.method, 'out', amt);
  }
  info.used_buy_count = udBuys.reduce((a, x) => a + x.c, 0);
  info.used_buy_total = r2(udBuyTotal);
  info.used_buy_credit = r2(udBuyCredit);

  // 11) used devices sales (IN)
  const udSellCond = until ? 'AND datetime(sale_date) <= datetime(?)' : '';
  const udSells = all(`SELECT COALESCE(sale_method, 'cash') AS method, SUM(sale_price) AS a, COUNT(*) AS c FROM used_devices WHERE status = 'sold' AND user_id = ? AND datetime(sale_date) >= datetime(?) ${udSellCond} GROUP BY COALESCE(sale_method, 'cash')`, P);
  let udSellTotal = 0, udSellCredit = 0;
  for (const x of udSells) {
    const amt = Number(x.a) || 0;
    udSellTotal += amt;
    if (x.method === 'credit') udSellCredit += amt;
    else bump(x.method, 'in', amt);
  }
  info.used_sell_count = udSells.reduce((a, x) => a + x.c, 0);
  info.used_sell_total = r2(udSellTotal);
  info.used_sell_credit = r2(udSellCredit);

  let totIn = 0, totOut = 0;
  for (const k of SHIFT_METHODS) {
    m[k].in = r2(m[k].in); m[k].out = r2(m[k].out);
    m[k].net = r2(m[k].in - m[k].out);
    totIn += m[k].in; totOut += m[k].out;
  }
  return { methods: m, totals: { in: r2(totIn), out: r2(totOut) }, info };
}

app.post('/api/shifts/open', auth, (req, res) => {
  const existing = get('SELECT * FROM shifts WHERE user_id = ? AND status = ?', [req.user.id, 'open']);
  if (existing) return res.status(400).json({ error: 'لديك وردية مفتوحة بالفعل' });
  const opening = Number(req.body?.opening_cash) || 0;
  const r = run('INSERT INTO shifts (user_id, branch_id, opening_cash, opened_at) VALUES (?,?,?,strftime(\'%Y-%m-%d %H:%M:%f\',\'now\',\'localtime\'))', [req.user.id, req.user.branch_id || null, opening]);
  res.json({ ok: true, shift: get('SELECT * FROM shifts WHERE id = ?', [r.lastInsertRowid]) });
});

app.get('/api/shifts/current', auth, (req, res) => {
  const shift = get('SELECT * FROM shifts WHERE user_id = ? AND status = ?', [req.user.id, 'open']);
  if (!shift) return res.json({ shift: null });
  const bd = shiftBreakdown(req.user.id, shift.opened_at, null);
  const expected_cash = shiftRound((Number(shift.opening_cash) || 0) + bd.methods.cash.in - bd.methods.cash.out);
  res.json({ shift, methods: bd.methods, totals: bd.totals, info: bd.info, expected_cash });
});

app.post('/api/shifts/close', auth, (req, res) => {
  const shift = get('SELECT * FROM shifts WHERE user_id = ? AND status = ?', [req.user.id, 'open']);
  if (!shift) return res.status(400).json({ error: 'لا توجد وردية مفتوحة' });
  const closing = Number(req.body?.closing_cash) || 0;
  const until = nowLocalStr();
  const bd = shiftBreakdown(req.user.id, shift.opened_at, until);
  const expected = shiftRound((Number(shift.opening_cash) || 0) + bd.methods.cash.in - bd.methods.cash.out);
  const diff = shiftRound(closing - expected);
  run('UPDATE shifts SET closed_at = ?, closing_cash = ?, expected_cash = ?, closed_by = ?, summary_json = ?, status = ? WHERE id = ?',
    [until, closing, expected, req.user.id, JSON.stringify(bd), 'closed', shift.id]);
  res.json({ ok: true, expected_cash: expected, closing_cash: closing, diff, summary: bd });
});

app.get('/api/reports/shifts', auth, permOrAdmin('reports'), (req, res) => {
  const { from, to } = req.query;
  const params = [];
  let where = "sh.status = 'closed'";
  if (from) { where += ' AND date(sh.opened_at) >= date(?)'; params.push(from); }
  if (to) { where += ' AND date(sh.opened_at) <= date(?)'; params.push(to); }
  const list = all(`SELECT sh.*, u1.full_name AS opened_by_name, u2.full_name AS closed_by_name, b.name AS branch_name
                FROM shifts sh JOIN users u1 ON u1.id = sh.user_id LEFT JOIN users u2 ON u2.id = sh.closed_by
                LEFT JOIN branches b ON b.id = sh.branch_id
                WHERE ${where} ORDER BY sh.id DESC LIMIT 500`, params);
  let deficitTotal = 0, surplusTotal = 0;
  for (const sh of list) {
    if (sh.summary_json) { try { sh.summary = JSON.parse(sh.summary_json); } catch { sh.summary = null; } }
    let expected = Number(sh.expected_cash);
    if (!Number.isFinite(expected)) {
      const agg = get('SELECT COALESCE(SUM(total),0) AS t FROM sales WHERE user_id = ? AND created_at >= ? AND created_at <= ?',
        [sh.user_id, sh.opened_at, sh.closed_at || '9999-12-31']);
      const mAgg = get(`SELECT COALESCE(SUM(CASE WHEN method='cash' THEN amount ELSE 0 END),0) AS t
                        FROM maintenance_payments WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
        [sh.user_id, sh.opened_at, sh.closed_at || '9999-12-31']);
      const sAgg = get(`SELECT COALESCE(SUM(CASE WHEN method='cash' THEN amount ELSE 0 END),0) AS t
                        FROM part_supplier_payments WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
        [sh.user_id, sh.opened_at, sh.closed_at || '9999-12-31']);
      const eAgg = get(`SELECT COALESCE(SUM(CASE WHEN method='cash' THEN amount ELSE 0 END),0) AS t
                        FROM expenses WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
        [sh.user_id, sh.opened_at, sh.closed_at || '9999-12-31']);
      const pInAgg = get(`SELECT COALESCE(SUM(CASE WHEN method='cash' THEN amount ELSE 0 END),0) AS t
                         FROM payments WHERE type='in' AND party_id IS NOT NULL AND user_id = ? AND created_at >= ? AND created_at <= ?`,
        [sh.user_id, sh.opened_at, sh.closed_at || '9999-12-31']);
      const pOutAgg = get(`SELECT COALESCE(SUM(CASE WHEN method='cash' THEN amount ELSE 0 END),0) AS t
                          FROM payments WHERE type='out' AND (party_id IS NOT NULL OR employee_id IS NOT NULL) AND user_id = ? AND created_at >= ? AND created_at <= ?`,
        [sh.user_id, sh.opened_at, sh.closed_at || '9999-12-31']);
      const udInAgg = get(`SELECT COALESCE(SUM(CASE WHEN COALESCE(sale_method,'cash')='cash' THEN sale_price ELSE 0 END),0) AS t
                          FROM used_devices WHERE status='sold' AND user_id = ? AND sale_date >= ? AND sale_date <= ?`,
        [sh.user_id, sh.opened_at, sh.closed_at || '9999-12-31']);
      const udOutAgg = get(`SELECT COALESCE(SUM(CASE WHEN COALESCE(purchase_method,'cash')='cash' THEN purchase_price ELSE 0 END),0) AS t
                          FROM used_devices WHERE user_id = ? AND purchase_date >= ? AND purchase_date <= ?`,
        [sh.user_id, sh.opened_at, sh.closed_at || '9999-12-31']);
      expected = (Number(sh.opening_cash) || 0) + (Number(agg.t) || 0)
        + (Math.round((Number(mAgg.t) || 0) * 100) / 100)
        + (Math.round((Number(pInAgg.t) || 0) * 100) / 100)
        + (Math.round((Number(udInAgg.t) || 0) * 100) / 100)
        - (Math.round((Number(sAgg.t) || 0) * 100) / 100)
        - (Math.round((Number(pOutAgg.t) || 0) * 100) / 100)
        - (Math.round((Number(eAgg.t) || 0) * 100) / 100)
        - (Math.round((Number(udOutAgg.t) || 0) * 100) / 100);
    }
    expected = Math.round(expected * 100) / 100;
    const diff = Math.round(((Number(sh.closing_cash) || 0) - expected) * 100) / 100;
    sh.expected_cash = expected;
    sh.diff = diff;
    if (diff < 0) deficitTotal += -diff; else if (diff > 0) surplusTotal += diff;
  }
  res.json({ shifts: list, deficit_total: Math.round(deficitTotal * 100) / 100, surplus_total: Math.round(surplusTotal * 100) / 100 });
});

app.get('/api/shifts/history', auth, adminOnly, (req, res) => {
  res.json(all(`SELECT sh.*, u.full_name AS cashier, b.name AS branch_name
                FROM shifts sh JOIN users u ON u.id = sh.user_id LEFT JOIN branches b ON b.id = sh.branch_id
                ORDER BY sh.id DESC LIMIT 100`));
});

/* ================= ACCOUNTING — PARTNERS ================= */
const r2f = (v) => Math.round((Number(v) || 0) * 100) / 100;

app.get('/api/partners', auth, adminOnly, (req, res) => {
  const list = all('SELECT * FROM partners ORDER BY id');
  const agg = all(`SELECT partner_id, type, kind, SUM(amount) AS total FROM partner_txns GROUP BY partner_id, type, kind`);
  const map = {};
  for (const a of agg) {
    const m = (map[a.partner_id] = map[a.partner_id] || { capital_cash: 0, capital_goods: 0, out_total: 0 });
    if (a.type === 'in') m[a.kind === 'goods' ? 'capital_goods' : 'capital_cash'] += Number(a.total) || 0;
    else m.out_total += Number(a.total) || 0;
  }
  res.json({ partners: list.map(p => ({ ...p, ...(map[p.id] || { capital_cash: 0, capital_goods: 0, out_total: 0 }), capital_total: r2f((map[p.id]?.capital_cash || 0) + (map[p.id]?.capital_goods || 0)) })) });
});

app.post('/api/partners', auth, adminOnly, (req, res) => {
  const { name, phone, profit_percent, notes, capital_cash, capital_goods } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'اسم الشريك مطلوب' });
  const pct = Math.round((Number(profit_percent) || 0) * 100) / 100;
  if (pct < 0 || pct > 100) return res.status(400).json({ error: 'نسبة الربح يجب أن تكون بين 0 و 100' });
  const r = run('INSERT INTO partners (name, phone, profit_percent, notes) VALUES (?,?,?,?)',
    [String(name).trim(), String(phone || '').trim(), pct, String(notes || '').trim()]);
  const partnerId = r.lastInsertRowid;
  const capCash = r2f(capital_cash);
  const capGoods = r2f(capital_goods);
  if (capCash > 0) {
    run('INSERT INTO partner_txns (partner_id, type, kind, method, amount, note, user_id) VALUES (?,?,?,?,?,?,?)',
      [partnerId, 'in', 'cash', 'cash', capCash, 'رأس مال نقدي أولي', req.user.id]);
  }
  if (capGoods > 0) {
    run('INSERT INTO partner_txns (partner_id, type, kind, method, amount, note, user_id) VALUES (?,?,?,?,?,?,?)',
      [partnerId, 'in', 'goods', 'cash', capGoods, 'رأس مال بضاعة أولي', req.user.id]);
  }
  res.json({ ok: true, id: partnerId });
});

app.delete('/api/partners/:id', auth, adminOnly, (req, res) => {
  const p = get('SELECT * FROM partners WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'الشريك غير موجود' });
  const txnsCount = get('SELECT COUNT(*) AS c FROM partner_txns WHERE partner_id = ?', [p.id])?.c || 0;
  if (txnsCount > 0) {
    return res.status(400).json({ error: 'لا يمكن حذف الشريك لوجود معاملات مالية أو توريدات سابقة مرتبطة به. يمكنك إيقافه بدلاً من حذفه.' });
  }
  run('DELETE FROM partners WHERE id = ?', [p.id]);
  res.json({ ok: true });
});

app.get('/api/partners/liquid', auth, adminOnly, (req, res) => {
  const row = get('SELECT value FROM settings WHERE key = ?', ['partner_liquid']);
  const liquid = { cash: 0, card: 0, wallet: 0, transfer: 0 };
  if (row) { try { Object.assign(liquid, JSON.parse(row.value)); } catch {} }
  res.json({ liquid, total: r2f(Object.values(liquid).reduce((s, v) => s + (Number(v) || 0), 0)) });
});

app.put('/api/partners/liquid', auth, adminOnly, (req, res) => {
  const b = req.body || {};
  const out = {};
  for (const k of ['cash', 'card', 'wallet', 'transfer']) out[k] = r2f(b[k]);
  run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['partner_liquid', JSON.stringify(out)]);
  res.json({ ok: true, liquid: out, total: r2f(Object.values(out).reduce((s, v) => s + v, 0)) });
});

app.put('/api/partners/:id', auth, adminOnly, (req, res) => {
  const p = get('SELECT * FROM partners WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'الشريك غير موجود' });
  const { name, phone, profit_percent, notes, active } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'اسم الشريك مطلوب' });
  let pct = p.profit_percent;
  if (profit_percent !== undefined) {
    pct = Math.round((Number(profit_percent) || 0) * 100) / 100;
    if (pct < 0 || pct > 100) return res.status(400).json({ error: 'نسبة الربح يجب أن تكون بين 0 و 100' });
  }
  run('UPDATE partners SET name = ?, phone = ?, profit_percent = ?, notes = ?, active = ? WHERE id = ?',
    [name !== undefined ? String(name).trim() : p.name,
     phone !== undefined ? String(phone).trim() : p.phone,
     pct,
     notes !== undefined ? String(notes).trim() : p.notes,
     active !== undefined ? (active ? 1 : 0) : p.active, p.id]);
  res.json({ ok: true });
});

app.get('/api/partners/:id/txns', auth, adminOnly, (req, res) => {
  const p = get('SELECT * FROM partners WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'الشريك غير موجود' });
  res.json({ partner: p, txns: all(`SELECT t.*, u.full_name AS by_user FROM partner_txns t LEFT JOIN users u ON u.id = t.user_id WHERE t.partner_id = ? ORDER BY t.id DESC LIMIT 300`, [p.id]) });
});

app.post('/api/partners/:id/txns', auth, adminOnly, (req, res) => {
  const p = get('SELECT * FROM partners WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'الشريك غير موجود' });
  const { type, kind, amount, note, method } = req.body || {};
  if (!['in', 'out'].includes(type)) return res.status(400).json({ error: "نوع الحركة يجب أن يكون 'in' توريد أو 'out' تحويل إليه" });
  if (!['cash', 'goods'].includes(kind)) return res.status(400).json({ error: "نوع القيمة يجب أن يكون 'cash' نقدي أو 'goods' بضاعة" });
  const m = ['cash', 'card', 'wallet', 'transfer'].includes(method) ? method : 'cash';
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  if (!(amt > 0)) return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
  const r = run('INSERT INTO partner_txns (partner_id, type, kind, method, amount, note, user_id) VALUES (?,?,?,?,?,?,?)',
    [p.id, type, kind, m, amt, String(note || '').trim(), req.user.id]);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.delete('/api/partners/txn/:id', auth, adminOnly, (req, res) => {
  const t = get('SELECT * FROM partner_txns WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'الحركة غير موجودة' });
  run('DELETE FROM partner_txns WHERE id = ?', [t.id]);
  res.json({ ok: true });
});

function periodProfit(month) {
  // month = 'YYYY-MM'
  const gp = get(`SELECT COALESCE(SUM(si.total - si.qty * COALESCE(p.purchase_price,0)),0) AS v
                  FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
                  WHERE substr(s.created_at,1,7) = ?`, [month]).v;
  const rets = get(`SELECT COALESCE(SUM(subtotal),0) AS v FROM returns WHERE substr(created_at,1,7) = ?`, [month]).v;
  // المرتجع ماينقصش من الأرباح بقيمته الكاملة — اللي بينقص هو ربح المنتجات المرتجعة بس
  // (قيمة المرتجع − تكلفة البضاعة المرتجعة)، القيمة الكاملة بتتخصم في الوردية حسب طريقة الرد
  const retCogs = get(`SELECT COALESCE(SUM(ri.qty * COALESCE(p.purchase_price,0)),0) AS v
                       FROM return_items ri JOIN returns rt ON rt.id = ri.return_id LEFT JOIN products p ON p.id = ri.product_id
                       WHERE substr(rt.created_at,1,7) = ?`, [month]).v;
  const retLoss = Math.max(0, Math.round((rets - retCogs) * 100) / 100);
  const exp = get(`SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE substr(created_at,1,7) = ?`, [month]).v;
  // salaries cost: fixed => monthly salary; commission => earned commission for that month
  const emps = all('SELECT id, name, salary, pay_type FROM employees WHERE active = 1');
  let salTotal = 0; const salDetail = [];
  for (const e of emps) {
    let v = 0;
    if (e.pay_type === 'commission') {
      v = employeeCommission(e, month).total;
    } else {
      v = Number(e.salary) || 0;
    }
    v = r2f(v);
    salTotal += v;
    salDetail.push({ id: e.id, name: e.name, pay_type: e.pay_type, amount: v });
  }
  salTotal = r2f(salTotal);
  const usedProfit = get(`SELECT COALESCE(SUM(sale_price - purchase_price), 0) AS v FROM used_devices WHERE status = 'sold' AND substr(sale_date,1,7) = ?`, [month]).v;
  return {
    sales_profit: r2f(gp), used_devices_profit: r2f(usedProfit), returns: r2f(rets), returns_cogs: r2f(retCogs), returns_profit_loss: retLoss,
    expenses: r2f(exp), salaries: salTotal, salaries_detail: salDetail,
    net: r2f(gp + usedProfit - retLoss - exp - salTotal),
  };
}

app.get('/api/partners/movements', auth, adminOnly, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 7);
  let sql = `SELECT t.*, p.name AS partner_name FROM partner_txns t JOIN partners p ON p.id = t.partner_id WHERE substr(t.created_at,1,7) = ?`;
  const params = [month];
  if (req.query.partner_id && /^\d+$/.test(String(req.query.partner_id))) { sql += ' AND t.partner_id = ?'; params.push(Number(req.query.partner_id)); }
  sql += ' ORDER BY t.id DESC LIMIT 500';
  const rows = all(sql, params);
  const totals = { in_cash: 0, in_goods: 0, out_cash: 0, out_goods: 0, by_method: { cash: 0, card: 0, wallet: 0, transfer: 0 } };
  for (const t of rows) {
    const dir = t.type === 'in' ? 'in' : 'out';
    totals[dir + '_' + (t.kind === 'goods' ? 'goods' : 'cash')] += Number(t.amount) || 0;
    totals.by_method[t.method] += (t.type === 'in' ? 1 : -1) * (Number(t.amount) || 0);
  }
  res.json({ month, rows, totals: { ...totals, by_method: Object.fromEntries(Object.entries(totals.by_method).map(([k, v]) => [k, r2f(v)])) } });
});

app.get('/api/partners/statement', auth, adminOnly, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 7);
  const period = periodProfit(month);
  const list = all('SELECT * FROM partners ORDER BY id');
  const mAgg = all(`SELECT partner_id, type, SUM(amount) AS total FROM partner_txns WHERE substr(created_at,1,7) = ? GROUP BY partner_id, type`, [month]);
  const mMap = {};
  for (const a of mAgg) {
    const m = (mMap[a.partner_id] = mMap[a.partner_id] || { in: 0, out: 0 });
    m[a.type] += Number(a.total) || 0;
  }
  const partners = list.map(p => {
    const mm = mMap[p.id] || { in: 0, out: 0 };
    const share = r2f(period.net * (Number(p.profit_percent) || 0) / 100);
    const usedPct = share > 0.001 ? Math.round((mm.out / share) * 1000) / 10 : (mm.out > 0 ? Infinity : 0);
    let status = 'ok';
    if (usedPct === Infinity || mm.out > share + 0.001) status = 'exceeded';
    else if (share > 0.001 && mm.out >= share * 0.8) status = 'near';
    return {
      id: p.id, name: p.name, phone: p.phone, profit_percent: p.profit_percent, active: p.active,
      month_in: r2f(mm.in), month_out: r2f(mm.out),
      share, remaining_share: r2f(share - mm.out), used_pct: usedPct === Infinity ? null : usedPct, status
    };
  });
  const alerts = [];
  for (const p of partners) {
    if (p.status === 'exceeded') alerts.push({ partner_id: p.id, name: p.name, level: 'danger', msg: `تحويلات ${p.name} هذا الشهر (${p.month_out}) تجاوزت نصيبه من الأرباح (${p.share}) بمقدار ${r2f(p.month_out - p.share)} — راجع الحساب` });
    else if (p.status === 'near') alerts.push({ partner_id: p.id, name: p.name, level: 'warn', msg: `${p.name} استهلك ${p.used_pct}% من نصيبه من أرباح الشهر (${p.month_out} من ${p.share})` });
  }
  const totalPct = r2f(list.reduce((s, p) => s + (Number(p.profit_percent) || 0), 0));
  if (totalPct > 100.001) alerts.push({ partner_id: null, name: null, level: 'warn', msg: `مجموع نسب الشركاء ${totalPct}% ويتجاوز 100% — عدّل النسب` });
  const liqRow = get('SELECT value FROM settings WHERE key = ?', ['partner_liquid']);
  const liquid = { cash: 0, card: 0, wallet: 0, transfer: 0 };
  if (liqRow) { try { Object.assign(liquid, JSON.parse(liqRow.value)); } catch {} }
  const liquidTotal = r2f(Object.values(liquid).reduce((s, v) => s + (Number(v) || 0), 0));
  const liquidDistribution = list.filter(p => p.active).map(p => ({
    partner_id: p.id, name: p.name, profit_percent: p.profit_percent,
    share: r2f(liquidTotal * (Number(p.profit_percent) || 0) / 100)
  }));
  res.json({ month, period, partners_total_percent: totalPct, partners, alerts, liquid, liquid_total: liquidTotal, liquid_distribution: liquidDistribution });
});

/* ==================== USED DEVICES API ==================== */

app.get('/api/used-devices', auth, (req, res) => {
  const statusFilter = String(req.query.status || 'all').trim();
  const q = String(req.query.q || req.query.search || '').trim();

  let sql = 'SELECT * FROM used_devices WHERE 1=1';
  const params = [];

  if (statusFilter && statusFilter !== 'all') {
    sql += ' AND status = ?';
    params.push(statusFilter);
  }

  if (q) {
    sql += ' AND (device_name LIKE ? OR brand LIKE ? OR model LIKE ? OR serial_number LIKE ? OR code LIKE ? OR seller_name LIKE ? OR buyer_name LIKE ? OR seller_phone LIKE ? OR buyer_phone LIKE ?)';
    const term = `%${q}%`;
    params.push(term, term, term, term, term, term, term, term, term);
  }

  sql += ' ORDER BY id DESC';

  const rows = all(sql, params);

  // Stats calculation
  const allDevices = all('SELECT status, purchase_price, sale_price FROM used_devices');
  let availableCount = 0;
  let soldCount = 0;
  let totalPurchaseValue = 0;
  let totalSalesValue = 0;
  let totalProfit = 0;

  for (const d of allDevices) {
    totalPurchaseValue += Number(d.purchase_price) || 0;
    if (d.status === 'available') {
      availableCount++;
    } else if (d.status === 'sold') {
      soldCount++;
      totalSalesValue += Number(d.sale_price) || 0;
      totalProfit += (Number(d.sale_price) || 0) - (Number(d.purchase_price) || 0);
    }
  }

  res.json({
    devices: rows,
    stats: {
      total: allDevices.length,
      availableCount,
      soldCount,
      totalPurchaseValue,
      totalSalesValue,
      totalProfit
    }
  });
});

app.get('/api/used-devices/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const device = get('SELECT * FROM used_devices WHERE id = ?', [id]);
  if (!device) return res.status(404).json({ error: 'الجهاز المستعمل غير موجود' });
  res.json(device);
});

app.post('/api/used-devices/buy', auth, (req, res) => {
  const {
    device_name, brand, model, serial_number, condition_notes,
    purchase_price, purchase_method, seller_name, seller_national_id, seller_phone, seller_address, notes
  } = req.body || {};

  if (!device_name || !String(device_name).trim()) {
    return res.status(400).json({ error: 'يرجى إدخال اسم أو نوع الجهاز' });
  }

  if (!seller_name || !String(seller_name).trim()) {
    return res.status(400).json({ error: 'يرجى إدخال اسم البائع' });
  }

  const pPrice = Number(purchase_price);
  if (isNaN(pPrice) || pPrice < 0) {
    return res.status(400).json({ error: 'سعر الشراء يجب أن يكون رقماً صفرياً أو إيجابياً' });
  }

  const serial = String(serial_number || '').trim();
  if (serial) {
    const existing = get("SELECT id, code FROM used_devices WHERE serial_number = ? AND status = 'available'", [serial]);
    if (existing) {
      return res.status(400).json({ error: `يوجد جهاز مستعمل متاح بنفس السيريال/IMEI (${existing.code})` });
    }
  }

  const code = nextInvoice('UD');
  const userId = req.user ? req.user.id : null;
  const branchId = req.user ? req.user.branch_id : null;

  const result = run(`
    INSERT INTO used_devices (
      code, device_name, brand, model, serial_number, condition_notes,
      status, purchase_date, purchase_price, purchase_method, seller_name, seller_national_id,
      seller_phone, seller_address, notes, user_id, branch_id
    ) VALUES (?,?,?,?,?,?,?,datetime('now','localtime'),?,?,?,?,?,?,?,?,?)
  `, [
    code, String(device_name).trim(), String(brand || '').trim(), String(model || '').trim(),
    serial, String(condition_notes || '').trim(), 'available', pPrice,
    String(purchase_method || 'cash').trim(),
    String(seller_name).trim(), String(seller_national_id || '').trim(),
    String(seller_phone || '').trim(), String(seller_address || '').trim(),
    String(notes || '').trim(), userId, branchId
  ]);

  const device = get('SELECT * FROM used_devices WHERE id = ?', [result.lastInsertRowid]);
  res.json({ ok: true, message: 'تم تسليم وقيد الجهاز المستعمل بنجاح', device });
});

app.post('/api/used-devices/:id/sell', auth, (req, res) => {
  const id = Number(req.params.id);
  const device = get('SELECT * FROM used_devices WHERE id = ?', [id]);
  if (!device) return res.status(404).json({ error: 'الجهاز غير موجود' });
  if (device.status !== 'available') {
    return res.status(400).json({ error: 'هذا الجهاز ليس متاحاً للبيع حالياً' });
  }

  const { sale_price, sale_method, buyer_name, buyer_national_id, buyer_phone, buyer_address, warranty_days, notes } = req.body || {};

  if (!buyer_name || !String(buyer_name).trim()) {
    return res.status(400).json({ error: 'يرجى إدخال اسم المشتري' });
  }

  const sPrice = Number(sale_price);
  if (isNaN(sPrice) || sPrice < 0) {
    return res.status(400).json({ error: 'سعر البيع يجب أن يكون رقماً صحاداً' });
  }

  run(`
    UPDATE used_devices SET
      status = 'sold',
      sale_date = datetime('now','localtime'),
      sale_price = ?,
      sale_method = ?,
      buyer_name = ?,
      buyer_national_id = ?,
      buyer_phone = ?,
      buyer_address = ?,
      warranty_days = ?,
      notes = CASE WHEN ? <> '' THEN ? ELSE notes END,
      updated_at = datetime('now','localtime')
    WHERE id = ?
  `, [
    sPrice, String(sale_method || 'cash').trim(),
    String(buyer_name).trim(), String(buyer_national_id || '').trim(),
    String(buyer_phone || '').trim(), String(buyer_address || '').trim(),
    Number(warranty_days) || 0, String(notes || '').trim(), String(notes || '').trim(),
    id
  ]);

  const updated = get('SELECT * FROM used_devices WHERE id = ?', [id]);
  res.json({ ok: true, message: 'تم إتمام بيع الجهاز المستعمل وتوثيق المبايعة بنجاح', device: updated });
});

app.put('/api/used-devices/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const device = get('SELECT * FROM used_devices WHERE id = ?', [id]);
  if (!device) return res.status(404).json({ error: 'الجهاز غير موجود' });

  const b = req.body || {};
  const device_name = b.device_name !== undefined ? String(b.device_name).trim() : device.device_name;
  const brand = b.brand !== undefined ? String(b.brand).trim() : device.brand;
  const model = b.model !== undefined ? String(b.model).trim() : device.model;
  const serial_number = b.serial_number !== undefined ? String(b.serial_number).trim() : device.serial_number;
  const condition_notes = b.condition_notes !== undefined ? String(b.condition_notes).trim() : device.condition_notes;
  const purchase_price = b.purchase_price !== undefined ? Number(b.purchase_price) : device.purchase_price;
  const purchase_method = b.purchase_method !== undefined ? String(b.purchase_method).trim() : device.purchase_method;
  const seller_name = b.seller_name !== undefined ? String(b.seller_name).trim() : device.seller_name;
  const seller_national_id = b.seller_national_id !== undefined ? String(b.seller_national_id).trim() : device.seller_national_id;
  const seller_phone = b.seller_phone !== undefined ? String(b.seller_phone).trim() : device.seller_phone;
  const seller_address = b.seller_address !== undefined ? String(b.seller_address).trim() : device.seller_address;

  const status = b.status !== undefined ? String(b.status).trim() : device.status;
  const sale_price = b.sale_price !== undefined ? Number(b.sale_price) : device.sale_price;
  const sale_method = b.sale_method !== undefined ? String(b.sale_method).trim() : device.sale_method;
  const buyer_name = b.buyer_name !== undefined ? String(b.buyer_name).trim() : device.buyer_name;
  const buyer_national_id = b.buyer_national_id !== undefined ? String(b.buyer_national_id).trim() : device.buyer_national_id;
  const buyer_phone = b.buyer_phone !== undefined ? String(b.buyer_phone).trim() : device.buyer_phone;
  const buyer_address = b.buyer_address !== undefined ? String(b.buyer_address).trim() : device.buyer_address;
  const warranty_days = b.warranty_days !== undefined ? Number(b.warranty_days) : device.warranty_days;
  const notes = b.notes !== undefined ? String(b.notes).trim() : device.notes;

  run(`
    UPDATE used_devices SET
      device_name = ?, brand = ?, model = ?, serial_number = ?, condition_notes = ?,
      purchase_price = ?, purchase_method = ?, seller_name = ?, seller_national_id = ?, seller_phone = ?, seller_address = ?,
      status = ?, sale_price = ?, sale_method = ?, buyer_name = ?, buyer_national_id = ?, buyer_phone = ?, buyer_address = ?,
      warranty_days = ?, notes = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `, [
    device_name, brand, model, serial_number, condition_notes,
    purchase_price, purchase_method, seller_name, seller_national_id, seller_phone, seller_address,
    status, sale_price, sale_method, buyer_name, buyer_national_id, buyer_phone, buyer_address,
    warranty_days, notes, id
  ]);

  const updated = get('SELECT * FROM used_devices WHERE id = ?', [id]);
  res.json({ ok: true, message: 'تم تعديل بيانات الجهاز بنجاح', device: updated });
});

app.delete('/api/used-devices/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const device = get('SELECT * FROM used_devices WHERE id = ?', [id]);
  if (!device) return res.status(404).json({ error: 'الجهاز غير موجود' });

  run('DELETE FROM used_devices WHERE id = ?', [id]);
  res.json({ ok: true, message: 'تم حذف سجل الجهاز بنجاح' });
});

/* ==================== WHATSAPP BOT & N8N ROUTES ==================== */
const { registerBotRoutes, startUltraMsgLiveSync } = require('./whatsapp_bot');
registerBotRoutes(app);

const HOST = process.env.ARP_HOST || '0.0.0.0';

function listenWithFallback(port, host) {
  return new Promise((resolve, reject) => {
    const srv = app.listen({ port, host }, () => resolve({ port, host, srv }));
    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        srv.close();
        console.log(`>> المنفذ ${port} مشغول — جرب المنفذ ${port + 1}`);
        resolve(listenWithFallback(port + 1, host));
      } else reject(err);
    });
  });
}

const ready = (async () => {
  await init();
  seedAdmin();
  try { startUltraMsgLiveSync(); } catch (e) { console.error('UltraMsg sync error:', e); }
  const { port, host } = await listenWithFallback(Number(PORT), HOST);
  try {
    const b = dailyBackup();
    console.log(b ? `>> تم عمل نسخة احتياطية: ${path.basename(b)}` : '>> يوجد نسخة احتياطية اليوم بالفعل');
  } catch (e) { console.log('>> تعذر النسخ الاحتياطي: ' + e.message); }
  console.log('=====================================');
  console.log('   ARP نظام ادارة الكترونيات — جاهز');
  console.log(`   افتح المتصفح على: http://${host}:${port}`);
  console.log('=====================================');
  return { port, host };
})();

module.exports = { app, ready };
