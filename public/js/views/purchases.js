let PUR = { items: [], from: '', to: '' };

async function renderPurchases() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="toolbar">
      <input type="date" id="puFrom">
      <input type="date" id="puTo">
      <button class="btn btn-secondary" onclick="purchasesLoad()">بحث</button>
      <div class="grow"></div>
      ${can('purchases.create') ? '<button class="btn" onclick="purOpenForm()">📥 فاتورة شراء جديدة</button>' : ''}
    </div>
    <div class="card">
      <div class="card-title">📥 فواتير الشراء من الموردين</div>
      <div class="table-wrap"><table>
        <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>المورد</th><th class="num">الإجمالي</th><th class="num">المدفوع</th><th></th></tr></thead>
        <tbody id="purchasesTable"></tbody>
      </table></div>
    </div>`;
  purchasesLoad();
}

async function purchasesLoad() {
  PUR.from = document.getElementById('puFrom').value;
  PUR.to = document.getElementById('puTo').value;
  const params = new URLSearchParams();
  if (PUR.from) params.set('from', PUR.from);
  if (PUR.to) params.set('to', PUR.to);
  const list = await API.get('/api/purchases?' + params.toString());
  document.getElementById('purchasesTable').innerHTML = list.map(p => `
    <tr>
      <td class="small">${esc(p.invoice_no)}</td>
      <td class="small">${fmtDate(p.created_at)}</td>
      <td><b>${esc(p.supplier_name)}</b></td>
      <td class="num">${fmt(p.total)}</td>
      <td class="num">${fmt(p.paid)}</td>
      <td><div class="flex" style="gap:4px">
        <button class="btn btn-secondary btn-sm" onclick="viewPurchase(${p.id})">عرض</button>
        ${isAdminUser() ? `<button class="btn btn-warning btn-sm" onclick="purOpenForm(${p.id})" title="تعديل الفاتورة">✏️</button>` : ''}
      </div></td>
    </tr>`).join('') || '<tr><td colspan="6"><div class="empty">لا توجد فواتير شراء</div></td></tr>';
}

async function viewPurchase(id) {
  const p = await API.get('/api/purchases/' + id);
  openModal(`
    <div class="modal-head"><h3>فاتورة شراء ${esc(p.invoice_no)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="r-line"><span>التاريخ</span><span>${fmtDate(p.created_at)}</span></div>
    <div class="r-line"><span>المورد</span><span>${esc(p.supplier_name)}</span></div>
    <table class="mt-10">
      <thead><tr><th>الصنف</th><th class="num">كمية</th><th class="num">سعر</th><th class="num">إجمالي</th></tr></thead>
      <tbody>${p.items.map(i => {
        const serials = i.serials_json ? JSON.parse(i.serials_json) : [];
        const serialsHtml = serials.length > 0
          ? `<div style="font-size:11.5px;font-weight:800;color:#000;margin-top:2px;direction:ltr;text-align:right;"><b>🔢 سيريالات:</b> ${serials.map(s => `<code style="background:#e2e8f0;color:#000;font-weight:800;padding:2px 6px;border-radius:3px;margin:1px;display:inline-block;">${esc(s)}</code>`).join(' ')}</div>`
          : '';
        return `<tr>
          <td>
            <div><b>${esc(i.name)}</b></div>
            ${serialsHtml}
          </td>
          <td class="num">${fmt(i.qty)}</td>
          <td class="num">${fmt(i.price)}</td>
          <td class="num">${fmt(i.total)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    <div class="r-line r-total"><span>الإجمالي</span><span>${fmt(p.total)}</span></div>
    <div class="r-line"><span>المدفوع</span><span>${fmt(p.paid)}</span></div>
    <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal()">إغلاق</button></div>
  `, true);
}

let PURFORM = { products: [], suppliers: [], items: [], editing: 0 };

function purQuickAddSupplier() {
  openModal(`
    <div class="modal-head"><h3>➕ إضافة مورد جديد (سريع)</h3><button class="modal-close" onclick="closeModal(true)">✕</button></div>
    <div class="form-group"><label>اسم المورد *</label><input id="qsName" class="form-control" placeholder="اسم المورد أو الشركة..." required></div>
    <div class="form-group"><label>رقم الهاتف</label><input id="qsPhone" class="form-control" placeholder="01xxxxxxxxx"></div>
    <div class="form-group"><label>العنوان</label><input id="qsAddress" class="form-control" placeholder="العنوان..."></div>
    <div class="modal-foot">
      <button class="btn" onclick="purSaveQuickSupplier()">حفظ واختيار المورد 💾</button>
      <button class="btn btn-secondary" onclick="closeModal(true)">إلغاء</button>
    </div>
  `, false, true);
}

async function purSaveQuickSupplier() {
  const name = document.getElementById('qsName')?.value.trim();
  if (!name) { showAlert('يرجى كتابة اسم المورد', 'error'); return; }
  const phone = document.getElementById('qsPhone')?.value.trim();
  const address = document.getElementById('qsAddress')?.value.trim();
  try {
    const res = await API.post('/api/parties', { name, phone, address, type: 'supplier' });
    showAlert('تمت إضافة المورد بنجاح');
    closeModal(true);
    const suppliers = await API.get('/api/parties?type=supplier');
    PURFORM.suppliers = suppliers;
    const sel = document.getElementById('purSupplier');
    if (sel) {
      sel.innerHTML = '<option value="">— اختر المورد —</option>' + suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
      sel.value = res.id;
    }
  } catch (e) {
    showAlert(e.message || 'خطأ أثناء إضافة المورد', 'error');
  }
}

function purEditSerials(idx) {
  const item = PURFORM.items[idx];
  if (!item) return;
  const serialsText = (item.serials || []).join('\n');
  const count = (item.serials || []).length;
  openModal(`
    <div class="modal-head"><h3>🔢 مراقبة السيريال نمبر والكميات: ${esc(item.name)}</h3><button class="modal-close" onclick="closeModal(true)">✕</button></div>
    <p class="small muted mb-10">امسح الباركود مباشرة بالسينسور أو اكتب السيريالات (كل سيريال في سطر) — النظام يربط كل سيريال بوحدة كمية تلقائياً:</p>
    <div class="form-group">
      <div class="flex-between mb-5" style="align-items:center;">
        <label class="small muted" style="margin:0;">قائمة السيريالات:</label>
        <span id="purSerialCounterBadge" class="badge ${count > 0 ? 'badge-green' : 'badge-gray'}" style="font-size:0.95rem; font-weight:bold; padding:4px 10px;">
          📦 عدد السيريالات / الكمية: <b id="purSerialCountVal">${count}</b>
        </span>
      </div>
      <textarea id="serialsArea" rows="7" class="form-control" placeholder="امسح أو اكتب السيريالات هنا (كل سيريال في سطر)..." oninput="purUpdateSerialLiveCount()">${esc(serialsText)}</textarea>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="purSaveItemSerials(${idx})">تأكيد الحفظ وتحديث الكمية 💾</button>
      <button class="btn btn-secondary" onclick="closeModal(true)">إلغاء</button>
    </div>
  `, false, true);
}

function purUpdateSerialLiveCount() {
  const text = document.getElementById('serialsArea')?.value || '';
  const list = text.split('\n').map(s => s.trim()).filter(Boolean);
  const count = list.length;
  const valEl = document.getElementById('purSerialCountVal');
  const badge = document.getElementById('purSerialCounterBadge');
  if (valEl) valEl.textContent = count;
  if (badge) {
    badge.className = count > 0 ? 'badge badge-green' : 'badge badge-gray';
  }
}

function purSaveItemSerials(idx) {
  const item = PURFORM.items[idx];
  if (!item) return;
  const text = document.getElementById('serialsArea')?.value || '';
  const list = text.split('\n').map(s => s.trim()).filter(Boolean);
  item.serials = list;
  if (list.length > 0) {
    item.qty = list.length;
  }
  closeModal(true);
  purRenderItems();
  showAlert(`تم حفظ ${list.length} سيريال وتحديث كمية الصنف تلقائياً إلى (${item.qty})`);
}

async function purOpenForm(editId = 0) {
  if (!editId && modalState.isMinimized && modalState.title && modalState.title.includes('فاتورة شراء')) {
    restoreModal();
    return;
  }
  const [products, suppliers] = await Promise.all([
    API.get('/api/products'), API.get('/api/parties?type=supplier'),
  ]);
  let editPu = null;
  if (editId) {
    editPu = await API.get('/api/purchases/' + editId);
    if (!editPu) { showAlert('فاتورة الشراء غير موجودة', 'error'); return; }
  }
  PURFORM.products = products;
  PURFORM.suppliers = suppliers;
  PURFORM.editing = editPu ? editPu.id : 0;
  PURFORM.items = editPu ? editPu.items.map(i => ({
    product_id: i.product_id,
    name: i.name,
    price: Number(i.price),
    qty: Number(i.qty),
    serials: i.serials_json ? JSON.parse(i.serials_json) : []
  })) : [];
  openModal(`
    <div class="modal-head"><h3>${editPu ? '✏️ تعديل فاتورة شراء ' + esc(editPu.invoice_no) : '📥 فاتورة شراء جديدة'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="form-group">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <label style="margin:0; font-weight:bold;">المورد *</label>
        <button type="button" class="btn btn-secondary btn-sm" onclick="purQuickAddSupplier()">➕ مورد جديد</button>
      </div>
      <select id="purSupplier" class="form-control"><option value="">— اختر المورد —</option>${suppliers.map(s => `<option value="${s.id}" ${editPu && Number(editPu.supplier_id) === Number(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    </div>
    <div class="toolbar">
      <div class="form-group" style="margin:0;flex:1"><label class="small muted">الخصم</label><input type="number" id="purDiscount" step="0.01" min="0" value="${editPu ? Number(editPu.discount) || 0 : ''}" placeholder="0.00" oninput="purRenderItems()"></div>
      <div class="form-group" style="margin:0;flex:1"><label class="small muted">المدفوع للمورد</label><input type="number" id="purPaid" step="0.01" min="0" value="${editPu ? Number(editPu.paid) || 0 : ''}" placeholder="اتركه فاضياً = مسدد كامل"></div>
    </div>
    <div class="toolbar">
      <input type="search" id="purSearch" placeholder="🔍 بحث بالاسم أو الباركود ثم Enter للإضافة..." class="grow">
      <button class="btn btn-accent" onclick="purAddItem()">➕ إضافة</button>
    </div>
    <div class="table-wrap" style="max-height:170px;overflow:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:10px">
      <table><tbody id="purResults"></tbody></table>
    </div>
    <div class="flex mb-10" style="gap:6px">
      <span class="badge badge-blue" id="purItemsCount">🧺 أصناف: 0</span>
      <span class="badge badge-gray" id="purQtySum">📦 إجمالي الكميات: 0</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>الصنف والسيريال</th><th class="num">الكمية</th><th class="num">سعر الشراء</th><th class="num">إجمالي</th><th></th></tr></thead>
      <tbody id="purItemsTable"></tbody>
    </table></div>
    <div class="mt-10 flex-between">
      <span class="small muted">سعر الشراء يتحدث تلقائياً من بيانات المنتج</span>
      <b>الإجمالي: <span id="purTotal">0.00</span></b>
    </div>
    <div class="small muted" id="purDueLine" style="text-align:left"></div>
    <div class="modal-foot">
      <button class="btn" onclick="purSave()">${editPu ? '💾 حفظ التعديلات' : 'حفظ الفاتورة 💾'}</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `, true);
  document.getElementById('purSearch').addEventListener('input', purRenderProductOptions);
  document.getElementById('purSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); purAddItem(); }
  });
  purRenderProductOptions();
  purRenderItems();
}

function purRenderProductOptions() {
  const box = document.getElementById('purResults');
  if (!box) return;
  const q = (document.getElementById('purSearch')?.value || '').trim();
  if (!q) {
    box.innerHTML = '<tr><td><div class="empty small muted" style="padding:8px">اكتب اسم المنتج أو الباركود لتظهر نتائج البحث</div></td></tr>';
    return;
  }
  const list = PURFORM.products.filter(p => p.name.includes(q) || (p.barcode && String(p.barcode).includes(q)));
  box.innerHTML = list.length === 0
    ? '<tr><td><div class="empty small muted" style="padding:8px">لا توجد نتائج مطابقة</div></td></tr>'
    : list.slice(0, 30).map(p => `
      <tr style="cursor:pointer" onclick="purPick(${p.id})" title="اضغط للإضافة للفاتورة">
        <td><b>${esc(p.name)}</b> <span class="small muted">${esc(p.barcode || '')}</span> ${p.has_serials ? '<span class="badge badge-blue" style="font-size:0.7rem;">🔢 سيريالات</span>' : ''}</td>
        <td class="num">${fmt(p.purchase_price)}</td>
        <td class="num">${fmt(p.stock)}</td>
      </tr>`).join('');
}

function purPick(pid) {
  const p = PURFORM.products.find(x => x.id === pid);
  if (!p) return;
  const existing = PURFORM.items.find(i => i.product_id === p.id);
  if (existing) existing.qty += 1;
  else PURFORM.items.unshift({ product_id: p.id, name: p.name, price: p.purchase_price, qty: 1, serials: [] });
  document.getElementById('purSearch').value = '';
  purRenderProductOptions();
  purRenderItems();
}

function purAddItem() {
  const q = (document.getElementById('purSearch')?.value || '').trim();
  if (!q) return;
  const p = PURFORM.products.find(x => x.name === q || (x.barcode && String(x.barcode) === q));
  if (p) { purPick(p.id); return; }
  const ids = PURFORM.products.filter(x => x.name.includes(q)).slice(0, 30);
  if (ids.length === 1) purPick(ids[0].id);
  else if (ids.length > 0) { const el = document.getElementById('purItemsTable'); el.scrollIntoView(); }
}

function purRenderItems() {
  const table = document.getElementById('purItemsTable');
  if (!table) return;
  const c1 = document.getElementById('purItemsCount');
  const c2 = document.getElementById('purQtySum');
  if (c1) c1.textContent = '🧺 أصناف: ' + PURFORM.items.length;
  if (c2) c2.textContent = '📦 إجمالي الكميات: ' + fmt(PURFORM.items.reduce((s, i) => s + (Number(i.qty) || 0), 0));
  const total = PURFORM.items.reduce((s, i) => s + i.price * i.qty, 0);
  const disc = Number(document.getElementById('purDiscount')?.value) || 0;
  document.getElementById('purTotal').textContent = fmt(Math.max(0, total - disc));
  const dueLine = document.getElementById('purDueLine');
  if (dueLine) {
    const grand = Math.max(0, total - disc);
    const paidV = document.getElementById('purPaid')?.value.trim();
    const paidAmt = paidV === '' ? grand : Math.max(0, Number(paidV) || 0);
    const due = Math.max(0, Math.round((grand - paidAmt) * 100) / 100);
    dueLine.textContent = due > 0.001 ? `المتبقي على المورد (آجل): ${fmt(due)}` : '✅ مسددة بالكامل';
  }
  table.innerHTML = PURFORM.items.map((i, idx) => {
    const serialCount = (i.serials || []).length;
    const serialsBadge = serialCount > 0
      ? `<button type="button" class="btn btn-sm btn-secondary" style="font-size:0.75rem; padding:2px 6px; margin-top:2px;" onclick="purEditSerials(${idx})">🔢 سيريالات (${serialCount})</button>`
      : `<button type="button" class="btn btn-sm btn-ghost" style="font-size:0.75rem; padding:2px 6px; margin-top:2px;" onclick="purEditSerials(${idx})">+ 🔢 إضافة سيريال</button>`;
    return `
    <tr>
      <td>
        <div><b>${esc(i.name)}</b></div>
        <div>${serialsBadge}</div>
      </td>
      <td class="num"><input type="number" style="width:80px" value="${i.qty}" min="0.01" step="0.01" onchange="PURFORM.items[${idx}].qty = Number(this.value); purRenderItems()"></td>
      <td class="num"><input type="number" style="width:100px" value="${i.price}" step="0.01" onchange="PURFORM.items[${idx}].price = Number(this.value); purRenderItems()"></td>
      <td class="num">${fmt(i.price * i.qty)}</td>
      <td><button class="cremove" style="background:none;border:none;color:var(--danger);cursor:pointer" onclick="PURFORM.items.splice(${idx},1); purRenderItems()">🗑️</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5"><div class="empty">لا توجد أصناف — أضف منتجات</div></td></tr>';
}

async function purSave() {
  const supplier_id = document.getElementById('purSupplier').value;
  if (!supplier_id) { showAlert('اختر المورد', 'error'); return; }
  if (PURFORM.items.length === 0) { showAlert('الفاتورة فارغة', 'error'); return; }
  try {
    if (PURFORM.editing) {
      await API.put('/api/purchases/' + PURFORM.editing + '/edit', {
        supplier_id,
        items: PURFORM.items.map(i => ({ product_id: i.product_id, qty: i.qty, price: i.price, serials: i.serials || [] })),
        discount: Number(document.getElementById('purDiscount')?.value) || 0,
        paid: document.getElementById('purPaid')?.value ?? '',
      });
      showAlert('تم تعديل فاتورة الشراء وتحديث المخزون وحساب المورد');
    } else {
      await API.post('/api/purchases', {
        supplier_id,
        items: PURFORM.items.map(i => ({ product_id: i.product_id, qty: i.qty, price: i.price, serials: i.serials || [] })),
        discount: Number(document.getElementById('purDiscount')?.value) || 0,
        paid: document.getElementById('purPaid')?.value ?? '',
        payment_method: 'cash',
      });
      showAlert('تم حفظ فاتورة الشراء وإضافة المخزون وتوثيق السيريالات');
    }
    closeModal();
    renderPurchases();
  } catch (e) { showAlert(e.message, 'error'); }
}
