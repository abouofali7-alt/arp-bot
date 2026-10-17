const initSqlJs = require('sql.js');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.ARP_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'grocery.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

let SQL = null;
let db = null;
let inTx = 0;

function wasmPath() {
  const p = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const unpacked = p.replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpacked)) return unpacked;
  return p;
}

function init() {
  return initSqlJs({ locateFile: wasmPath }).then((S) => {
    SQL = S;
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
    try { db.exec('PRAGMA foreign_keys = ON;'); } catch (e) {}
    initSchema();
    return true;
  });
}

function save() {
  if (inTx > 0 || !db) return;
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      address TEXT DEFAULT '',
      phone TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      branch_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE,
      name TEXT NOT NULL,
      category_id INTEGER,
      purchase_price REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      unit TEXT DEFAULT 'قطعة',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('supplier','customer')),
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      job_title TEXT DEFAULT '',
      salary REAL NOT NULL DEFAULT 0,
      emp_role TEXT DEFAULT 'general',
      pay_type TEXT NOT NULL DEFAULT 'fixed',
      hire_date TEXT,
      national_id TEXT DEFAULT '',
      balance REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS employee_commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      scope TEXT NOT NULL DEFAULT 'category',
      category_id INTEGER,
      percent REAL NOT NULL DEFAULT 0,
      UNIQUE(employee_id, scope, category_id),
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS vacations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'paid',
      note TEXT DEFAULT '',
      days INTEGER NOT NULL DEFAULT 0,
      deduction REAL NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      branch_id INTEGER,
      party_id INTEGER,
      customer_phone TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      delivery_fee REAL NOT NULL DEFAULT 0,
      delivery_address TEXT DEFAULT '',
      total REAL NOT NULL DEFAULT 0,
      paid REAL NOT NULL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (branch_id) REFERENCES branches(id),
      FOREIGN KEY (party_id) REFERENCES parties(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      name TEXT NOT NULL,
      barcode TEXT,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE NOT NULL,
      supplier_id INTEGER NOT NULL,
      branch_id INTEGER,
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      paid REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (supplier_id) REFERENCES parties(id),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      product_id INTEGER,
      name TEXT NOT NULL,
      barcode TEXT,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_id INTEGER,
      employee_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('in','out')),
      pay_type TEXT DEFAULT 'other',
      amount REAL NOT NULL,
      note TEXT DEFAULT '',
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (party_id) REFERENCES parties(id),
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS salary_closings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(employee_id, month),
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      spent_at TEXT DEFAULT (datetime('now','localtime')),
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      branch_id INTEGER,
      opened_at TEXT DEFAULT (datetime('now','localtime')),
      closed_at TEXT,
      opening_cash REAL NOT NULL DEFAULT 0,
      closing_cash REAL,
      status TEXT NOT NULL DEFAULT 'open',
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_no TEXT UNIQUE NOT NULL,
      sale_id INTEGER,
      user_id INTEGER NOT NULL,
      branch_id INTEGER,
      subtotal REAL NOT NULL DEFAULT 0,
      refund_method TEXT DEFAULT 'cash',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL,
      product_id INTEGER,
      name TEXT NOT NULL,
      barcode TEXT,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY (return_id) REFERENCES returns(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      old_price REAL NOT NULL DEFAULT 0,
      new_price REAL NOT NULL DEFAULT 0,
      user_id INTEGER,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_type TEXT NOT NULL CHECK(discount_type IN ('percent','fixed')),
      value REAL NOT NULL,
      min_total REAL NOT NULL DEFAULT 0,
      max_uses INTEGER NOT NULL DEFAULT 0,
      used_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      party_id INTEGER,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS stocktakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_no TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      branch_id INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      closed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS stocktake_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stocktake_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      system_stock REAL NOT NULL DEFAULT 0,
      actual_stock REAL,
      diff REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (stocktake_id) REFERENCES stocktakes(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS part_suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS spare_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      supplier_id INTEGER,
      purchase_price REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (supplier_id) REFERENCES part_suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_no TEXT UNIQUE NOT NULL,
      customer_name TEXT DEFAULT '',
      customer_phone TEXT DEFAULT '',
      device TEXT DEFAULT '',
      problem TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','repairing','done','delivered','cancelled')),
      labor_cost REAL NOT NULL DEFAULT 0,
      parts_cost REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      paid REAL NOT NULL DEFAULT 0,
      deposit REAL NOT NULL DEFAULT 0,
      due_date TEXT,
      claim_until TEXT,
      notes TEXT DEFAULT '',
      user_id INTEGER,
      branch_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT,
      delivered_at TEXT
    );

    CREATE TABLE IF NOT EXISTS job_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      part_id INTEGER,
      part_name TEXT NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      purchase_price REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      FOREIGN KEY (job_id) REFERENCES maintenance_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (part_id) REFERENCES spare_parts(id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      user_id INTEGER,
      amount REAL NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'cash',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (job_id) REFERENCES maintenance_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS spare_stock_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL,
      qty REAL NOT NULL,
      supplier_id INTEGER,
      purchase_price REAL NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (part_id) REFERENCES spare_parts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS part_supplier_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'cash',
      note TEXT DEFAULT '',
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      profit_percent REAL NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS partner_txns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'cash',
      amount REAL NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS used_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      device_name TEXT NOT NULL,
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      condition_notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','sold','returned')),
      purchase_date TEXT DEFAULT (datetime('now','localtime')),
      purchase_price REAL NOT NULL DEFAULT 0,
      seller_name TEXT NOT NULL DEFAULT '',
      seller_national_id TEXT DEFAULT '',
      seller_phone TEXT DEFAULT '',
      seller_address TEXT DEFAULT '',
      sale_date TEXT,
      sale_price REAL DEFAULT 0,
      buyer_name TEXT DEFAULT '',
      buyer_national_id TEXT DEFAULT '',
      buyer_phone TEXT DEFAULT '',
      buyer_address TEXT DEFAULT '',
      warranty_days INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      user_id INTEGER,
      branch_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS product_serials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      serial_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      purchase_id INTEGER,
      purchase_price REAL,
      sale_id INTEGER,
      sale_price REAL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (purchase_id) REFERENCES purchases(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_serials_unique ON product_serials(product_id, serial_number);
    CREATE INDEX IF NOT EXISTS idx_product_serials_serial ON product_serials(serial_number);
    CREATE INDEX IF NOT EXISTS idx_product_serials_status ON product_serials(status);
  `);
  migrate();
}

function tableExists(table) {
  try {
    const res = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`);
    return !!(res && res.length && res[0].values && res[0].values.length);
  } catch {
    return false;
  }
}

function columnExists(table, col) {
  if (!tableExists(table)) return false;
  try {
    const res = db.exec(`PRAGMA table_info(${table})`);
    if (!res || !res.length) return false;
    return res[0].values.some(r => r[1] === col);
  } catch {
    return false;
  }
}

function safeAddColumn(table, col, typeDef) {
  try {
    if (tableExists(table) && !columnExists(table, col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${typeDef}`);
    }
  } catch (e) {
    console.warn(`[Migration Warning] Could not add column ${col} to ${table}:`, e.message);
  }
}

function migrate() {
  safeAddColumn('sales', 'customer_phone', "TEXT DEFAULT ''");
  safeAddColumn('sales', 'customer_name', "TEXT DEFAULT ''");
  safeAddColumn('coupons', 'party_id', 'INTEGER');
  safeAddColumn('coupons', 'source', "TEXT DEFAULT 'manual'");
  safeAddColumn('payments', 'employee_id', 'INTEGER');
  safeAddColumn('payments', 'pay_type', "TEXT DEFAULT 'other'");
  safeAddColumn('categories', 'parent_id', 'INTEGER');
  safeAddColumn('maintenance_jobs', 'deposit', 'REAL NOT NULL DEFAULT 0');
  safeAddColumn('maintenance_jobs', 'due_date', 'TEXT');
  safeAddColumn('maintenance_jobs', 'claim_until', 'TEXT');
  safeAddColumn('job_parts', 'purchase_price', 'REAL NOT NULL DEFAULT 0');
  safeAddColumn('sales', 'payments_json', 'TEXT');
  safeAddColumn('shifts', 'closed_by', 'INTEGER');
  safeAddColumn('shifts', 'expected_cash', 'REAL');
  safeAddColumn('users', 'permissions', 'TEXT');
  safeAddColumn('sales', 'delivery_fee', 'REAL NOT NULL DEFAULT 0');
  safeAddColumn('sales', 'delivery_address', "TEXT DEFAULT ''");
  safeAddColumn('vacations', 'days', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('vacations', 'deduction', 'REAL NOT NULL DEFAULT 0');
  safeAddColumn('employees', 'emp_role', "TEXT DEFAULT 'general'");
  safeAddColumn('employees', 'pay_type', "TEXT NOT NULL DEFAULT 'fixed'");
  safeAddColumn('shifts', 'summary_json', 'TEXT');
  safeAddColumn('expenses', 'method', "TEXT DEFAULT 'cash'");
  safeAddColumn('payments', 'method', "TEXT DEFAULT 'cash'");
  safeAddColumn('partner_txns', 'method', "TEXT NOT NULL DEFAULT 'cash'");
  safeAddColumn('used_devices', 'purchase_method', "TEXT DEFAULT 'cash'");
  safeAddColumn('used_devices', 'sale_method', "TEXT DEFAULT 'cash'");
  safeAddColumn('products', 'has_serials', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('purchase_items', 'serials_json', 'TEXT');
  safeAddColumn('sale_items', 'serials_json', 'TEXT');
  safeAddColumn('purchases', 'user_id', 'INTEGER');

  const catSql = get("SELECT sql FROM sqlite_master WHERE type='table' AND name='categories'")?.sql || '';
  if (catSql.includes('UNIQUE')) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE categories_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER
      );
      INSERT INTO categories_new (id, name, parent_id)
      SELECT id, name, parent_id FROM categories;
      DROP TABLE categories;
      ALTER TABLE categories_new RENAME TO categories;
      PRAGMA foreign_keys = ON;
    `);
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_main_name ON categories(name) WHERE parent_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_sub_name ON categories(name, parent_id) WHERE parent_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
    CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at);
    CREATE INDEX IF NOT EXISTS idx_used_devices_code ON used_devices(code);
    CREATE INDEX IF NOT EXISTS idx_used_devices_serial ON used_devices(serial_number);
    CREATE INDEX IF NOT EXISTS idx_used_devices_status ON used_devices(status);
  `);

  const defaultSettings = {
    loyalty_percent: '10',
    loyalty_threshold: '5',
    loyalty_days: '2'
  };
  for (const [k, v] of Object.entries(defaultSettings)) {
    const s = get('SELECT value FROM settings WHERE key = ?', [k]);
    if (!s) run('INSERT INTO settings (key, value) VALUES (?,?)', [k, v]);
  }

  // تنظيف أي جداول أو إعدادات سابقة خاصة بنظام البوت والواتساب
  try {
    db.exec(`
      DROP TABLE IF EXISTS whatsapp_customers;
      DROP TABLE IF EXISTS whatsapp_logs;
      DROP TABLE IF EXISTS whatsapp_campaigns;
      DELETE FROM settings WHERE key LIKE 'bot_%' OR key LIKE 'ultramsg_%' OR key LIKE 'gemini_%' OR key LIKE 'store_owner_%' OR key = 'n8n_webhook_url';
    `);
  } catch (e) {}
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) return stmt.getAsObject();
    return undefined;
  } finally {
    stmt.free();
  }
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    stmt.step();
    const changes = db.getRowsModified();
    const lastInsertRowid = Number(get('SELECT last_insert_rowid() AS id').id);
    save();
    return { lastInsertRowid, changes };
  } finally {
    stmt.free();
  }
}

function transaction(fn) {
  return function (...args) {
    db.exec('BEGIN');
    inTx++;
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      inTx--;
      save();
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      inTx--;
      throw err;
    }
  };
}

function ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backup() {
  save();
  const file = path.join(BACKUP_DIR, `backup-${ts()}.db`);
  fs.copyFileSync(DB_FILE, file);
  return file;
}

function listBackups() {
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const full = path.join(BACKUP_DIR, f);
      const st = fs.statSync(full);
      return { name: f, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

function restore(name) {
  const src = path.join(BACKUP_DIR, path.basename(name));
  if (!fs.existsSync(src)) throw new Error('الملف الاحتياطي غير موجود');
  const buf = fs.readFileSync(src);
  if (db) { try { db.close(); } catch (e) {} }
  db = new SQL.Database(buf);
  try { fs.writeFileSync(DB_FILE, Buffer.from(db.export())); } catch (e) {}
}

function dailyBackup() {
  const today = new Date().toISOString().slice(0, 10);
  const existing = listBackups().some(f => f.name.startsWith(`backup-${today.replace(/-/g, '')}`));
  if (!existing) return backup();
  return null;
}

function makeFactoryBaseline() {
  const prev = db;
  const fresh = new SQL.Database();
  let buf = null;
  try {
    db = fresh;
    try { fresh.exec('PRAGMA foreign_keys = ON;'); } catch (e) {}
    initSchema();
    buf = Buffer.from(fresh.export());
  } finally {
    try { fresh.close(); } catch (e) {}
    db = prev;
  }
  if (!buf || !buf.length) throw new Error('تعذر إنشاء النسخة الأساسية الفارغة');
  const file = path.join(BACKUP_DIR, 'baseline-factory.db');
  fs.writeFileSync(file, buf);
  return file;
}

module.exports = { init, get, all, run, transaction, backup, restore, listBackups, dailyBackup, makeFactoryBaseline, DATA_DIR };
