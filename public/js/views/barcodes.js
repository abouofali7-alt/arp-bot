let BAR = {
  products: [],
  search: '',
  cat: '',
  selected: {},
  showPrice: (typeof localStorage !== 'undefined' && localStorage.getItem('barShowPrice') === 'false') ? false : true
};

async function renderBarcodes() {
  BAR.showPrice = (typeof localStorage !== 'undefined' && localStorage.getItem('barShowPrice') === 'false') ? false : true;
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="card">
      <div class="card-title">🏷️ طباعة باركود المنتجات
        <span class="small muted" id="barCount"></span>
      </div>
      <div class="toolbar">
        <input type="search" id="barSearch" placeholder="🔍 بحث بالاسم أو الباركود..." class="grow">
        <select id="barCat"></select>
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;user-select:none;margin-left:8px;padding:6px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
          <input type="checkbox" id="barShowPrice" ${BAR.showPrice ? 'checked' : ''} onchange="barToggleShowPrice(this.checked)">
          🏷️ عرض السعر في الطباعة
        </label>
        <div style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:4px 10px">
          <span style="font-weight:700;font-size:0.88rem">🖨️ طابعة الباركود:</span>
          <select id="barPrinterPick" onchange="barPrinterPickSave(this.value)" style="border:none;background:transparent;font-weight:600;font-size:0.88rem;cursor:pointer">
            <option value="">جاري الكشف...</option>
          </select>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="barSelectAll()">☑️ تحديد الكل</button>
        <button class="btn btn-secondary btn-sm" onclick="barClearAll()">مسح التحديد</button>
      </div>
      <div class="table-wrap" style="margin-bottom:14px"><table>
        <thead><tr><th style="width:40px"></th><th>المنتج</th><th>الباركود</th><th class="num">سعر البيع</th><th class="num" style="width:110px">عدد النسخ</th></tr></thead>
        <tbody id="barTable"></tbody>
      </table></div>
      <div class="flex" style="gap:10px;flex-wrap:wrap">
        <button class="btn btn-lg" onclick="barPrint('a4')">🖨️ طباعة A4 لاصق</button>
        <button class="btn btn-lg btn-accent" onclick="barPrint('thermal')">🖨️ طباعة حرارية</button>
        <span class="small muted" style="align-self:center">الملصقات 63.5×38.1 مم — ورقة لاصقة A4 (3 في العرض)</span>
      </div>
      <div class="small muted" id="barPrinter" style="margin-top:8px"></div>
    </div>`;
  const [products, categories] = await Promise.all([API.get('/api/products'), API.get('/api/categories')]);
  BAR.products = Array.isArray(products) ? products : [];
  const catSel = document.getElementById('barCat');
  const catPathName = (c) => {
    const chain = []; let cur = c; let guard = 0;
    while (cur && guard++ < 10) {
      chain.unshift(cur.name);
      cur = (categories || []).find(x => Number(x.id) === Number(cur.parent_id));
    }
    return chain.join(' ↳ ');
  };
  if (catSel) {
    catSel.innerHTML = '<option value="">كل الأقسام</option>' + (categories || []).map(c => `<option value="${c.id}">${esc(catPathName(c))}</option>`).join('');
    catSel.addEventListener('change', (e) => { BAR.cat = e.target.value; barDraw(); });
  }
  const searchInput = document.getElementById('barSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => { BAR.search = e.target.value.trim(); barDraw(); });
  }
  barDraw();
  barPrinterInfo();
}

async function barPrinterInfo() {
  const el = document.getElementById('barPrinter');
  const pick = document.getElementById('barPrinterPick');
  if (!window.printerAPI) {
    if (el) el.textContent = '💡 الطابعات متاحة في نسخة سطح المكتب المثبّتة — من الإعدادات → الطابعات المتصلة';
    if (pick) pick.innerHTML = '<option value="">(الافتراضية)</option>';
    return;
  }
  try {
    const port = localStorage.getItem('portPref');
    const portDesc = localStorage.getItem('portPrefDesc') || '';
    const portIsPrinter = /GP[-_ ]?58|58 ?MM|58mm|CH340|CH341|PRINTER|SERIAL/i.test(portDesc);
    if (port && portIsPrinter) {
      if (el) el.textContent = `🖨️ الطباعة المباشرة على المنفذ: ${port} (ESC/POS)`;
      return;
    }
    const list = await window.printerAPI.getPrinters();
    const barPref = localStorage.getItem('barcodePrinterPref') || '';
    if (pick) {
      pick.innerHTML = '<option value="">(الافتراضية للنظام)</option>' +
        list.map(p => `<option value="${esc(p.name)}" ${p.name === barPref ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    }
    const invPref = localStorage.getItem('invoicePrinterPref') || localStorage.getItem('printerPref') || '';
    const parts = [];
    if (barPref) parts.push(`طابعة الباركود: ${barPref} 🏷️`);
    else parts.push('طابعة الباركود: الافتراضية للنظام');
    if (invPref) parts.push(`طابعة الفواتير (منفصلة): ${invPref} 🧾`);
    if (list.length === 0) parts.push('لا توجد طابعات متصلة');
    if (el) el.textContent = '🖨️ ' + parts.join(' | ');
  } catch {
    if (el) el.textContent = '🖨️ تعذر كشف الطابعات';
  }
}

function barPrinterPickSave(val) {
  localStorage.setItem('barcodePrinterPref', val);
  showAlert(val ? `تم تحديد طابعة الباركود: ${val}` : 'تم ضبط طابعة الباركود على الافتراضية');
  barPrinterInfo();
}

function barFiltered() {
  let list = Array.isArray(BAR.products) ? BAR.products : [];
  if (BAR.cat) list = list.filter(p => p.category_id == BAR.cat);
  if (BAR.search) {
    const q = BAR.search.toLowerCase();
    list = list.filter(p => 
      (p.name && p.name.toLowerCase().includes(q)) || 
      (p.barcode && String(p.barcode).toLowerCase().includes(q))
    );
  }
  return list;
}

function barDraw() {
  const list = barFiltered();
  const selCount = Object.keys(BAR.selected).length;
  document.getElementById('barCount').textContent = selCount + ' منتج محدد';
  document.getElementById('barTable').innerHTML = list.map(p => {
    const sel = BAR.selected[p.id];
    return `
    <tr>
      <td><input type="checkbox" ${sel ? 'checked' : ''} onchange="barToggle(${p.id}, this.checked)"></td>
      <td><b>${esc(p.name)}</b>${p.barcode ? '' : ' <span class="badge badge-red">بدون باركود</span>'}</td>
      <td dir="ltr" style="text-align:left" class="small">${esc(p.barcode || '—')}</td>
      <td class="num"><input type="number" min="0" step="0.01" value="${sel ? sel.price : p.sale_price}" style="width:90px" onchange="barSetPrice(${p.id}, this.value)"></td>
      <td class="num"><input type="number" min="1" step="1" value="${sel ? sel.qty : 1}" style="width:70px" onchange="barSetQty(${p.id}, this.value)"></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5"><div class="empty">لا توجد منتجات</div></td></tr>';
}

function barToggle(id, on) {
  const p = BAR.products.find(x => x.id === id);
  if (!p) return;
  if (on) BAR.selected[id] = { qty: 1, price: p.sale_price };
  else delete BAR.selected[id];
  barDraw();
}

function barSetPrice(id, v) {
  if (BAR.selected[id]) BAR.selected[id].price = Number(v) || 0;
}

function barSetQty(id, v) {
  const p = BAR.products.find(x => x.id === id);
  if (!p) return;
  const q = Math.max(1, Number(v) || 1);
  if (BAR.selected[id]) BAR.selected[id].qty = q;
  else BAR.selected[id] = { qty: q, price: p.sale_price };
  barDraw();
}

function barSelectAll() {
  barFiltered().forEach(p => { if (!BAR.selected[p.id]) BAR.selected[p.id] = { qty: 1, price: p.sale_price }; });
  barDraw();
}

function barClearAll() {
  BAR.selected = {};
  barDraw();
}

function barToggleShowPrice(on) {
  BAR.showPrice = !!on;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('barShowPrice', BAR.showPrice ? 'true' : 'false');
  }
}

function barPrint(mode) {
  const labels = [];
  for (const [id, s] of Object.entries(BAR.selected)) {
    const p = BAR.products.find(x => x.id == id);
    if (!p) continue;
    for (let i = 0; i < s.qty; i++) {
      labels.push({
        name: p.name,
        barcode: p.barcode || '',
        price: Number(s.price) || 0,
        showPrice: BAR.showPrice
      });
    }
  }
  if (labels.length === 0) { showAlert('حدد منتجات للطباعة أولاً', 'error'); return; }
  const port = localStorage.getItem('portPref');
  const portDesc = localStorage.getItem('portPrefDesc') || '';
  const portIsPrinter = /GP[-_ ]?58|58 ?MM|58mm|CH340|CH341|PRINTER|SERIAL/i.test(portDesc);
  if (mode === 'thermal' && window.printerAPI && port && portIsPrinter) {
    const escp = thermalEscp(labels);
    window.printerAPI.printESCP(port, escp).then(r => {
      if (r && r.ok) showAlert('تم إرسال الطباعة إلى ' + port);
      else showAlert('فشل الطباعة على ' + port + ' — ' + ((r && r.err) || 'تحقق من توصيل الطابعة'), 'error');
    });
    return;
  }
  const inApp = labels.map(l => `
    <div class="label">
      <div class="l-title">${esc(l.name)}</div>
      ${l.barcode ? `<div class="l-img"><img src="${barcodeImg(l.barcode)}" alt=""><div class="l-code">${esc(l.barcode)}</div></div>` : '<div class="l-sub">بدون باركود</div>'}
      ${l.showPrice !== false ? `<div class="l-price">${fmt(l.price)} ${esc(SETTINGS.currency || 'ج')}</div>` : ''}
    </div>`).join('');
  openPrintModal(inApp, 'label', `طباعة ${labels.length} ليبل`, () => printBarcodeLabels(labels, mode, { preview: false }));
}

function thermalEscp(labels) {
  const bytes = [];
  const push = (arr) => { for (const b of arr) bytes.push(b); };
  const line = (s) => { for (const ch of String(s)) bytes.push(ch.charCodeAt(0)); bytes.push(0x0a); };
  push([0x1b, 0x40]);
  push([0x1b, 0x61, 0x01]);
  for (const l of labels) {
    push([0x1d, 0x21, 0x00]);
    line(l.name);
    const code = String(l.barcode || '');
    if (code) {
      if (/^\d{13}$/.test(code)) {
        push([0x1d, 0x6b, 0x43, 13]);
        for (const c of code) bytes.push(c.charCodeAt(0));
      } else if (/^\d{8}$/.test(code)) {
        push([0x1d, 0x6b, 0x44, 8]);
        for (const c of code) bytes.push(c.charCodeAt(0));
      } else {
        const b = Buffer.from(code, 'latin1');
        push([0x1d, 0x6b, 0x49, b.length, 0]);
        for (const c of b) bytes.push(c);
      }
      bytes.push(0x0a);
      line(code);
    }
    if (l.showPrice !== false) {
      push([0x1d, 0x21, 0x11]);
      line(l.price + ' ' + (SETTINGS.currency || 'ج'));
    }
    push([0x1b, 0x64, 0x01]);
    push([0x1d, 0x56, 0x01]);
  }
  return Buffer.from(bytes).toString('base64');
}
