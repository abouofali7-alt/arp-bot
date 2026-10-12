const { init, all, run, get } = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
  await init();
  const branchCount = get('SELECT COUNT(*) AS c FROM branches').c;
  if (branchCount === 0) {
    run('INSERT INTO branches (name, code, address, phone) VALUES (?,?,?,?)', [
      'الفرع الرئيسي', 'BR-001', 'القاهرة، مصر', '01000000000',
    ]);
  }

  const adminCount = get('SELECT COUNT(*) AS c FROM users WHERE role = ?', ['admin']).c;
  if (adminCount === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    run('INSERT INTO users (username, password_hash, full_name, role, branch_id) VALUES (?,?,?,?,?)', [
      'admin', hash, 'مدير النظام', 'admin', 1,
    ]);
    console.log('>> تم إنشاء حساب المدير:');
    console.log('   username: admin');
    console.log('   password: admin123');
  }

  const catCount = get('SELECT COUNT(*) AS c FROM categories').c;
  if (catCount === 0) {
    run('INSERT INTO categories (name) VALUES (?)', ['مشروبات']);
    run('INSERT INTO categories (name) VALUES (?)', ['ألبان']);
    run('INSERT INTO categories (name) VALUES (?)', ['مخبوزات']);
    run('INSERT INTO categories (name) VALUES (?)', ['منظفات']);
  }

  const prodCount = get('SELECT COUNT(*) AS c FROM products').c;
  if (prodCount === 0) {
    const items = [
      ['1001', 'كوكاكولا 1 لتر', 1, 20, 25, 100, 20, 'زجاجة'],
      ['1002', 'بيبسي 1 لتر', 1, 19, 24, 120, 20, 'زجاجة'],
      ['1003', 'عصير برتقال 1 لتر', 1, 22, 30, 80, 15, 'كرتونة'],
      ['1004', 'مياه معدنية 1.5 لتر', 1, 7, 10, 300, 50, 'زجاجة'],
      ['2001', 'لبن كامل 1 لتر', 2, 30, 38, 60, 15, 'علبة'],
      ['2002', 'زبادي 100 جم', 2, 4, 6, 500, 100, 'علبة'],
      ['2003', 'جبنة بيضاء 1 كجم', 2, 90, 110, 40, 10, 'كيلو'],
      ['2004', 'جبنة رومي 1 كجم', 2, 120, 145, 25, 8, 'كيلو'],
      ['3001', 'عيش فينو', 3, 1.5, 2, 200, 50, 'رغيف'],
      ['3002', 'عيش بلدي', 3, 2, 2.5, 300, 80, 'رغيف'],
      ['3003', 'توست أبيض', 3, 15, 19, 70, 20, 'ربطة'],
      ['4001', 'مسحوق غسيل 1 كجم', 4, 55, 65, 50, 10, 'كيس'],
      ['4002', 'سائل غسيل أطباق', 4, 25, 32, 45, 10, 'زجاجة'],
      ['4003', 'كلور 1 لتر', 4, 18, 24, 40, 10, 'زجاجة'],
    ];
    for (const [barcode, name, cat, pp, sp, stock, min, unit] of items) {
      run('INSERT INTO products (barcode, name, category_id, purchase_price, sale_price, stock, min_stock, unit) VALUES (?,?,?,?,?,?,?,?)', [
        barcode, name, cat, pp, sp, stock, min, unit,
      ]);
    }
  }

  const supCount = get('SELECT COUNT(*) AS c FROM parties WHERE type = ?', ['supplier']).c;
  if (supCount === 0) {
    run('INSERT INTO parties (type, name, phone, address) VALUES (?,?,?,?)', [
      'supplier', 'مورد المشروبات', '01111111111', 'المنطقة الصناعية',
    ]);
    run('INSERT INTO parties (type, name, phone, address) VALUES (?,?,?,?)', [
      'supplier', 'مورد الألبان', '01222222222', 'مزرعة الألبان',
    ]);
  }

  const setCount = get('SELECT COUNT(*) AS c FROM settings').c;
  if (setCount === 0) {
    run('INSERT INTO settings (key, value) VALUES (?,?)', ['store_name', 'سوبر ماركت ARP']);
    run('INSERT INTO settings (key, value) VALUES (?,?)', ['invoice_footer', 'شكراً لتعاملكم معنا']);
    run('INSERT INTO settings (key, value) VALUES (?,?)', ['currency', 'جنيه']);
  }

  console.log('>> تم تجهيز قاعدة البيانات بنجاح.');
}

seed().catch((e) => { console.error('فشل تجهيز قاعدة البيانات:', e); process.exit(1); });
