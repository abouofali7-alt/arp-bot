let PROD = { q: '', cat: '', nav: [] };

if (!window._CAT_PICKER_DOC_BOUND) {
  window._CAT_PICKER_DOC_BOUND = true;
  document.addEventListener('click', (e) => {
    const p = document.getElementById('catPicker');
    if (p && !p.contains(e.target)) p.classList.remove('open');
  });
}

async function renderProducts() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="toolbar">
      <input type="search" id="prodSearch" placeholder="🔍 بحث بالاسم أو الباركود..." class="grow">
      <div class="cat-picker" id="catPicker">
        <button type="button" class="cat-picker-btn" onclick="catPickerToggle(event)"><span id="catPickerLabel">📂 كل الأقسام</span><span class="arrow">▾</span></button>
        <div class="cat-menu" id="catMenu"></div>
      </div>
      ${can('products.edit') ? `
      <button class="btn" onclick="prodOpenForm()">➕ منتج جديد</button>
      <button class="btn btn-secondary" onclick="catsManage()">🗂️ الأقسام</button>
      <button class="btn btn-accent" onclick="bulkPriceForm()">💰 تعديل أسعار جماعي</button>
      <button class="btn btn-ghost" onclick="priceHistoryModal()">📜 سجل الأسعار</button>` : ''}
      ${isAdminUser() ? `
      <button class="btn btn-secondary" onclick="exportProductsExcel()">📊 سحب البيانات (شيت إكسيل)</button>
      <button class="btn btn-accent" onclick="importProductsExcelModal()">📥 استرداد من إكسيل</button>` : ''}
    </div>
    <div class="card">
      <div class="card-title"><span>📦 المنتجات والمخزون</span><span class="badge badge-green" id="prodCount"></span></div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>الباركود</th><th>الاسم</th><th>القسم</th>
          <th class="num">سعر الشراء</th><th class="num">سعر البيع</th>
          <th class="num">المخزون</th><th class="num">الحد الأدنى</th><th>الحالة</th><th></th>
        </tr></thead>
        <tbody id="prodTable"></tbody>
      </table></div>
    </div>`;

  const cats = await API.get('/api/categories');
  window._PROD_CATS = cats;
  window._PROD_REQ = 0;
  if (!window._PROD_OPENED) window._PROD_OPENED = {};

  clearTimeout(window._PROD_SEARCH_T);
  window._PROD_SEARCH_T = null;
  document.getElementById('prodSearch').addEventListener('input', (e) => {
    PROD.q = e.target.value.trim();
    clearTimeout(window._PROD_SEARCH_T);
    window._PROD_SEARCH_T = setTimeout(prodLoad, 250);
  });
  catDraw();
  prodLoad();
}

function catKids(id) {
  return (window._PROD_CATS || []).filter(c => Number(c.parent_id) === Number(id) && Number(c.id) !== Number(id));
}

function catLevelLabel(id) {
  const cats = window._PROD_CATS || [];
  const path = []; const seen = [];
  let cur = cats.find(c => Number(c.id) === Number(id));
  while (cur && !seen.includes(cur.id)) {
    seen.push(cur.id);
    path.unshift(cur.name);
    cur = cats.find(c => Number(c.id) === Number(cur.parent_id));
  }
  return '📁 ' + path.join(' ↳ ');
}

function catDraw() {
  const cats = window._PROD_CATS || [];
  const catNode = (c) => {
    const kids = catKids(c.id);
    const sel = PROD.cat && Number(PROD.cat) === Number(c.id);
    return `
      <div class="cat-item${kids.length ? ' has-kids' : ''}${sel ? ' selected' : ''}${kids.length && (window._PROD_OPENED[c.id]) ? ' open' : ''}" onclick="catClick(event, ${c.id})">
        <span>📁 ${esc(c.name)}</span>${kids.length ? '<span class="arrow">◀</span>' : ''}
        ${kids.length ? `<div class="cat-sub">
          <div class="cat-item" onclick="catPick(${c.id})"><span>✅ كل منتجات هذا القسم (يشمل فروعه)</span></div>
          ${kids.map(catNode).join('')}</div>` : ''}
      </div>`;
  };
  document.getElementById('catMenu').innerHTML =
    `<div class="cat-item${!PROD.cat ? ' selected' : ''}" onclick="catPick(0)"><span>📂 كل الأقسام</span></div>` +
    cats.filter(c => !c.parent_id).map(catNode).join('');
}

function catPickerToggle(e) {
  e.stopPropagation();
  document.getElementById('catPicker').classList.toggle('open');
}
function closeCatPicker() {
  const p = document.getElementById('catPicker');
  if (p) p.classList.remove('open');
}
function catClick(e, id) {
  e.stopPropagation();
  const el = e.currentTarget;
  if (!el) return;
  if (el.classList.contains('has-kids')) {
    el.classList.toggle('open');
    window._PROD_OPENED = window._PROD_OPENED || {};
    window._PROD_OPENED[id] = el.classList.contains('open');
    return;
  }
  PROD.cat = String(id);
  catPickLabel();
  prodLoad();
}
function catPick(id) {
  PROD.cat = id ? String(id) : '';
  catPickLabel();
  prodLoad();
}
function catPickLabel() {
  let label = '📂 كل الأقسام';
  if (PROD.cat) {
    const c = (window._PROD_CATS || []).find(x => x.id == PROD.cat);
    if (c) label = catLevelLabel(c.id);
  }
  const el = document.getElementById('catPickerLabel');
  if (el) el.textContent = label;
}

async function prodLoad() {
  const params = new URLSearchParams();
  if (PROD.q) params.set('q', PROD.q);
  if (PROD.cat) params.set('category_id', PROD.cat);
  const my = ++window._PROD_REQ;
  const list = await API.get('/api/products?' + params.toString());
  if (my !== window._PROD_REQ) return;
  document.getElementById('prodCount').textContent = list.length + ' منتج';
  document.getElementById('prodTable').innerHTML = list.map(p => `
    <tr>
      <td class="small">${esc(p.barcode || '—')}</td>
      <td><b>${esc(p.name)}</b> ${p.has_serials ? '<span class="badge badge-blue" style="font-size:0.75rem;margin-right:4px;">🔢 بسيريال</span>' : ''}</td>
      <td class="small">${[p.grand_cat_name, p.parent_cat_name, p.category_name].filter(Boolean).map(x => esc(x)).join(' ↳ ') || '—'}</td>
      <td class="num">${fmt(p.purchase_price)}</td>
      <td class="num"><b>${fmt(p.sale_price)}</b></td>
      <td class="num">${p.stock <= p.min_stock ? `<span class="badge badge-red">${fmt(p.stock)}</span>` : fmt(p.stock)} <span class="muted small">${esc(p.unit)}</span></td>
      <td class="num">${fmt(p.min_stock)}</td>
      <td>${p.active ? '<span class="badge badge-green">نشط</span>' : '<span class="badge badge-gray">موقوف</span>'}</td>
      <td>
        <div class="flex" style="gap:4px">
          ${can('products.edit') ? `
          <button class="btn btn-secondary btn-sm" onclick="prodOpenForm(${p.id})">تعديل</button>
          <button class="btn btn-warning btn-sm" onclick="stockOpenForm(${p.id}, '${esc(p.name)}')">مخزون</button>
          ${p.has_serials ? `<button class="btn btn-secondary btn-sm" onclick="prodViewSerials(${p.id}, '${esc(p.name)}')">🔢 سيريالات</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="prodDelete(${p.id}, '${esc(p.name)}')">🗑️ حذف</button>` : '<span class="small muted">عرض فقط</span>'}
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="9"><div class="empty">لا توجد منتجات</div></td></tr>';
}

async function prodViewSerials(id, name) {
  try {
    const list = await API.get(`/api/products/${id}/serials`);
    openModal(`
      <div class="modal-head"><h3>🔢 سيريالات المنتج المخزنة: ${esc(name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="table-wrap" style="max-height:60vh;overflow:auto;">
        <table>
          <thead><tr><th>السيريال (SN/IMEI)</th><th>الحالة</th><th>سعر الشراء</th><th>تاريخ الإضافة</th></tr></thead>
          <tbody>
            ${list.map(s => `
              <tr>
                <td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-weight:bold;direction:ltr;">${esc(s.serial_number)}</code></td>
                <td>${s.status === 'available' ? '<span class="badge badge-green">متاح بالمخزون</span>' : '<span class="badge badge-gray">تم البيع</span>'}</td>
                <td class="num">${fmt(s.purchase_price)}</td>
                <td class="small">${fmtDate(s.created_at)}</td>
              </tr>
            `).join('') || '<tr><td colspan="4"><div class="empty">لا توجد سيريالات مضافة لهذا المنتج بعد</div></td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal()">إغلاق</button></div>
    `, true);
  } catch (e) {
    showAlert(e.message || 'خطأ أثناء تحميل السيريالات', 'error');
  }
}

async function prodDelete(id, name) {
  if (!confirm(`هل أنت تأكد من رغبتك في حذف المنتج "${name}" نهائياً؟`)) return;
  try {
    const res = await API.del('/api/products/' + id);
    showAlert(res.message || 'تم حذف المنتج بنجاح');
    renderProducts();
  } catch (e) {
    showAlert(e.message || 'خطأ أثناء الحذف', 'error');
  }
}

async function catsManage() {
  const cats = await API.get('/api/categories');
  const kidsOf = (id) => cats.filter(c => Number(c.parent_id) === Number(id));
  const admin = can('products.edit');
  const depthLabel = ['قسم رئيسي', 'فئة فرعية', 'نوع فرعي'];
  const addLabel = ['➕ فئة فرعية', '➕ نوع فرعي'];

  const nodeRow = (node, depth) => {
    const kids = kidsOf(node.id);
    const indent = depth * 18;
    return `
      <div class="flex-between" style="padding:4px 0;border-bottom:1px solid var(--border,#eee);margin-right:${indent}px">
        <span>${depth === 0 ? '📂' : '↳'.repeat(depth) + ' 📁'} ${esc(node.name)} <span class="badge badge-gray">${node.products_count} منتج</span></span>
        ${admin ? `
        <div class="flex" style="gap:4px">
          ${depth < 2 ? `<button class="btn btn-secondary btn-sm" onclick="catOpenForm(${node.id}, ${depth + 1})">${addLabel[depth]}</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="catEditForm(${node.id})">✏️ تعديل</button>
          <button class="btn btn-danger btn-sm" onclick="catDelete(${node.id}, '${esc(node.name)}')">🗑️ حذف</button>
        </div>` : ''}
      </div>
      ${kids.map(k => nodeRow(k, depth + 1)).join('')}`;
  };

  openModal(`
    <div class="modal-head"><h3>🗂️ إدارة الأقسام (${depthLabel.join(' ← ')})</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    ${admin ? '<div class="flex mb-10"><button class="btn" onclick="catOpenForm()">➕ قسم رئيسي جديد</button></div>' : ''}
    <div style="max-height:55vh;overflow:auto">
    ${cats.filter(c => !c.parent_id).map(m => `
      <div class="card" style="margin-bottom:8px">
        ${nodeRow(m, 0)}
      </div>`).join('') || '<div class="empty">لا توجد أقسام بعد</div>'}
    </div>
  `, true);
}

function catOpenForm(parentId, parentDepth = 0) {
  window._CAT_PARENT = parentId || null;
  const labels = { 0: '🗂️ قسم رئيسي جديد', 1: '📁 فئة فرعية جديدة', 2: '🏷️ نوع فرعي جديد' };
  const ph = { 0: 'مثال: إلكترونيات', 1: 'مثال: هواتف ذكية', 2: 'مثال: آيفون' };
  const d = parentId ? parentDepth : 0;
  const parentPath = parentId ? catLevelLabel(parentId) : '';
  openModal(`
    <div class="modal-head"><h3>${labels[d]}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    ${parentPath ? `<div class="small muted mb-10" style="background:var(--bg-surface-2,#f8f9fa);padding:8px;border-radius:6px">تابع لـ: <b>${parentPath}</b></div>` : ''}
    <div class="form-group"><label>اسم ${d === 0 ? 'القسم الرئيسي' : d === 1 ? 'الفئة الفرعية' : 'النوع الفرعي'}</label><input id="catName" placeholder="${ph[d]}"></div>
    <div class="modal-foot"><button class="btn" onclick="catSave()">حفظ</button><button class="btn btn-secondary" onclick="closeModal()">إلغاء</button></div>
  `);
}

async function catEditForm(id) {
  const cats = await API.get('/api/categories');
  const c = cats.find(x => x.id == id);
  if (!c) return;
  const isSub = !!c.parent_id;
  const parentPath = c.parent_id ? catLevelLabel(c.parent_id) : '';
  openModal(`
    <div class="modal-head"><h3>✏️ تعديل ${isSub ? (cats.find(x => x.id == c.parent_id)?.parent_id ? 'النوع الفرعي' : 'الفئة الفرعية') : 'القسم الرئيسي'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    ${parentPath ? `<div class="small muted mb-10" style="background:var(--bg-surface-2,#f8f9fa);padding:8px;border-radius:6px">تابع لـ: <b>${parentPath}</b></div>` : ''}
    <div class="form-group"><label>الاسم</label><input id="catEditName" value="${esc(c.name)}"></div>
    ${!isSub ? `
    <div class="form-group"><label>نقل الفئات الفرعية إلى قسم رئيسي آخر (اختياري)</label>
      <select id="catEditMove"><option value="">— بدون نقل —</option>${cats.filter(x => !x.parent_id && x.id != c.id).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
      <div class="small muted mt-5">سيتم نقل كل الفئات الفرعية للقسم المختار</div>
    </div>` : ''}
    <div class="modal-foot"><button class="btn" onclick="catSaveEdit(${c.id})">حفظ</button><button class="btn btn-secondary" onclick="closeModal()">إلغاء</button></div>
  `);
}

async function catSave() {
  const name = document.getElementById('catName').value.trim();
  if (!name) { showAlert('أدخل الاسم', 'error'); return; }
  try {
    await API.post('/api/categories', { name, parent_id: window._CAT_PARENT });
    closeModal();
    showAlert('تم الحفظ');
    catsManage();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function catSaveEdit(id) {
  const body = { name: document.getElementById('catEditName').value.trim() };
  const moveSel = document.getElementById('catEditMove');
  if (moveSel && moveSel.value) {
    try {
      await API.put('/api/categories/' + id, body);
      await API.post('/api/categories/move-subs', { from: id, to: Number(moveSel.value) });
      closeModal();
      showAlert('تم التعديل ونقل الفئات الفرعية');
      catsManage();
    } catch (e) { showAlert(e.message, 'error'); }
    return;
  }
  if (!body.name) { showAlert('أدخل الاسم', 'error'); return; }
  try {
    await API.put('/api/categories/' + id, body);
    closeModal();
    showAlert('تم التعديل');
    catsManage();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function catDelete(id, name) {
  if (!confirm(`حذف "${name}"؟ لا يمكن الحذف إذا كان يحتوي منتجات أو فئات فرعية`)) return;
  try {
    await API.del('/api/categories/' + id);
    showAlert('تم الحذف');
    catsManage();
  } catch (e) { showAlert(e.message, 'error'); }
}

function toggleBarcodeOption() {
  const isAuto = document.getElementById('bcOptAuto')?.checked;
  const box = document.getElementById('manualBarcodeBox');
  if (box) box.style.display = isAuto ? 'none' : 'block';
}

async function prodOpenForm(id) {
  const cats = await API.get('/api/categories');
  let p = null;
  if (id) {
    const list = await API.get('/api/products');
    p = list.find(x => x.id === id);
  }
  let selMain = '', selSub = '', selType = '';
  if (p && p.category_id) {
    const chain = [];
    let cur = cats.find(c => c.id == p.category_id);
    while (cur) { chain.unshift(cur); cur = cats.find(c => c.id == cur.parent_id); }
    [selMain, selSub, selType] = [chain[0]?.id || '', chain[1]?.id || '', chain[2]?.id || ''];
  }
  openModal(`
    <div class="modal-head"><h3>${p ? '✏️ تعديل منتج' : '➕ إضافة منتج جديد'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="grid-2">
      <div class="form-group" style="grid-column: span 2;">
        <label style="font-weight:bold;">اسم المنتج *</label>
        <input id="pName" class="form-control" placeholder="اسم المنتج..." value="${esc(p?.name || '')}">
      </div>

      <div class="form-group"><label>القسم الرئيسي</label>
        <select id="pCat" class="form-control" onchange="prodFillSubs()"><option value="">— اختر القسم الرئيسي —</option>${cats.filter(c => !c.parent_id).map(c => `<option value="${c.id}" ${selMain == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>الفئة الفرعية</label>
        <select id="pSub" class="form-control" onchange="prodFillTypes()"><option value="">— اختر الفئة الفرعية —</option></select></div>
      <div class="form-group" style="grid-column: span 2;"><label>النوع الفرعي</label>
        <select id="pType" class="form-control"><option value="">— اختر النوع الفرعي —</option></select></div>

      <div class="form-group" style="grid-column: span 2; background:var(--bg-surface-2, #f8f9fa); padding:10px; border-radius:6px; border:1px solid #e2e8f0; margin-bottom:5px;">
        <label style="font-weight:bold; margin-bottom:8px; display:block;">نوع الباركود:</label>
        <div style="display:flex; gap:20px; flex-wrap:wrap; align-items:center;">
          <label style="cursor:pointer; display:flex; align-items:center; gap:6px;">
            <input type="radio" name="barcodeOption" id="bcOptAuto" value="auto" ${!p?.barcode ? 'checked' : ''} onchange="toggleBarcodeOption()">
            <b>⚡ باركود تلقائي من البرنامج</b>
          </label>
          <label style="cursor:pointer; display:flex; align-items:center; gap:6px;">
            <input type="radio" name="barcodeOption" id="bcOptManual" value="manual" ${p?.barcode ? 'checked' : ''} onchange="toggleBarcodeOption()">
            <b>⌨️ إدخال الباركود يدوي (قارئ الباركود/الكيبورد)</b>
          </label>
        </div>
      </div>
      <div class="form-group" id="manualBarcodeBox" style="grid-column: span 2; ${p?.barcode ? '' : 'display:none;'}">
        <label style="font-weight:bold;">الباركود اليدوي *</label>
        <input id="pBarcode" class="form-control" placeholder="امسح الباركود باستخدام القارئ أو اكتبه هنا..." value="${esc(p?.barcode || '')}">
      </div>

      <div class="form-group" style="grid-column: span 2; background:var(--bg-surface-2, #f8f9fa); padding:10px; border-radius:6px; border:1px solid #e2e8f0; margin-bottom:5px;">
        <label style="font-weight:bold; margin-bottom:6px; display:block;">تتبع السيريال نمبر (Serial Number Tracking):</label>
        <label style="cursor:pointer; display:flex; align-items:center; gap:8px;">
          <input type="checkbox" id="pHasSerials" ${p?.has_serials ? 'checked' : ''} style="width:18px;height:18px;">
          <span><b>🔢 هذا المنتج يُباع ويُشترى بسيريال نمبر فريد لكل قطعة (غير مكرر)</b></span>
        </label>
        <span class="small muted" style="display:block; margin-top:4px;">عند تفعيل الخيار، يلزم إدخال سيريال فريد لكل قطعة ويمنع النظام تكرار نفس السيريال إطلاقاً.</span>
      </div>

      <div class="form-group"><label>سعر الشراء</label><input type="number" id="pPurchase" step="0.01" class="form-control" value="${p?.purchase_price || 0}"></div>
      <div class="form-group"><label>سعر البيع *</label><input type="number" id="pSale" step="0.01" class="form-control" value="${p?.sale_price || 0}"></div>
      <div class="form-group"><label>الحد الأدنى للمخزون</label><input type="number" id="pMin" step="0.01" class="form-control" value="${p?.min_stock || 0}"></div>
      <div class="form-group"><label>الوحدة</label><input id="pUnit" class="form-control" value="${esc(p?.unit || 'قطعة')}"></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="prodSave(${p?.id || 0})">حفظ المنتج 💾</button>
      ${p ? `<button class="btn btn-danger" onclick="prodToggle(${p.id}, ${p.active ? 0 : 1})">${p.active ? 'إيقاف' : 'تفعيل'}</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
  window._PROD_CATS = cats;
  prodFillSubs(selSub);
  prodFillTypes(selType);
}

function prodFillSubs(preselect) {
  const mid = document.getElementById('pCat')?.value;
  const subSel = document.getElementById('pSub');
  if (!subSel) return;
  const subs = mid ? (window._PROD_CATS || []).filter(c => Number(c.parent_id) === Number(mid)) : [];
  subSel.innerHTML = '<option value="">— اختر الفئة الفرعية —</option>' +
    subs.map(s => `<option value="${s.id}" ${preselect && s.id == preselect ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  prodFillTypes();
}

function prodFillTypes(preselect) {
  const sid = document.getElementById('pSub')?.value;
  const typeSel = document.getElementById('pType');
  if (!typeSel) return;
  const types = sid ? (window._PROD_CATS || []).filter(c => Number(c.parent_id) === Number(sid)) : [];
  typeSel.innerHTML = '<option value="">— اختر النوع الفرعي —</option>' +
    types.map(t => `<option value="${t.id}" ${preselect && t.id == preselect ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}

async function prodSave(id) {
  const name = document.getElementById('pName').value.trim();
  if (!name) { showAlert('اسم المنتج مطلوب', 'error'); return; }

  const isAuto = document.getElementById('bcOptAuto')?.checked;
  const barcodeInput = document.getElementById('pBarcode')?.value.trim();

  if (!isAuto && !barcodeInput) {
    showAlert('يرجى كتابة أو مسح الباركود اليدوي أو اختيار الباركود التلقائي', 'error');
    return;
  }

  const body = {
    name,
    auto_barcode: isAuto,
    barcode: isAuto ? null : barcodeInput,
    category_id: document.getElementById('pType').value || document.getElementById('pSub').value || document.getElementById('pCat').value || null,
    unit: document.getElementById('pUnit').value.trim() || 'قطعة',
    purchase_price: Number(document.getElementById('pPurchase').value) || 0,
    sale_price: Number(document.getElementById('pSale').value) || 0,
    min_stock: Number(document.getElementById('pMin').value) || 0,
    has_serials: document.getElementById('pHasSerials')?.checked ? 1 : 0
  };

  try {
    if (id) {
      const res = await API.put('/api/products/' + id, body);
      showAlert('تم تعديل بيانات المنتج بنجاح');
    } else {
      const res = await API.post('/api/products', body);
      showAlert(`تمت إضافة المنتج بنجاح (الباركود: ${res.barcode})`);
    }
    closeModal();
    renderProducts();
  } catch (e) {
    showAlert(e.message || 'خطأ أثناء الحفظ', 'error');
  }
}

async function prodToggle(id, active) {
  await API.put('/api/products/' + id, { active });
  closeModal();
  renderProducts();
}

function stockOpenForm(id, name) {
  openModal(`
    <div class="modal-head"><h3>تعديل مخزون: ${esc(name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="form-group"><label>التغيير (+ إضافة / − خصم)</label><input type="number" id="stockDelta" step="0.01" value="0"></div>
    <div class="muted small">مثال: +50 لإضافة 50 وحدة، −10 لخصم 10 وحدات</div>
    <div class="modal-foot"><button class="btn" onclick="stockSave(${id})">حفظ</button><button class="btn btn-secondary" onclick="closeModal()">إلغاء</button></div>
  `);
}
async function stockSave(id) {
  const delta = Number(document.getElementById('stockDelta').value) || 0;
  await API.post('/api/products/' + id + '/stock', { delta });
  closeModal();
  showAlert('تم تحديث المخزون');
  renderProducts();
}

async function bulkPriceForm() {
  const cats = await API.get('/api/categories');
  openModal(`
    <div class="modal-head"><h3>💰 تعديل أسعار جماعي</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <p class="small muted mb-10">يتم رفع السعر بنسبة مئوية (+ زيادة / − تخفيض). مثال: 10 = زيادة 10%، ‎-5 = تخفيض 5%</p>
    <div class="grid-2">
      <div class="form-group"><label>النسبة المئوية (%)</label><input type="number" id="bpPercent" step="0.01" placeholder="مثال: 10"></div>
      <div class="form-group"><label>القسم (اختياري)</label>
        <select id="bpCat"><option value="">كل الأقسام</option>${cats.map(c => `<option value="${c.id}">${esc(catLevelLabel(c.id))}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>نوع السعر</label>
      <select id="bpTarget">
        <option value="sale">سعر البيع</option>
        <option value="purchase">سعر الشراء</option>
      </select>
    </div>
    <div class="modal-foot">
      <button class="btn btn-accent" onclick="bulkPriceSave()">تطبيق التعديل</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
}

async function bulkPriceSave() {
  const percent = Number(document.getElementById('bpPercent').value) || 0;
  if (percent === 0) { showAlert('أدخل نسبة غير صفرية', 'error'); return; }
  try {
    const r = await API.post('/api/products/bulk-price', {
      percent,
      category_id: document.getElementById('bpCat').value || null,
      target: document.getElementById('bpTarget').value,
    });
    closeModal();
    showAlert(`تم تعديل أسعار ${r.count} منتج`);
    renderProducts();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function priceHistoryModal() {
  openModal(`
    <div class="modal-head"><h3>📜 سجل تغيير الأسعار</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>المنتج</th><th class="num">السعر القديم</th><th class="num">السعر الجديد</th><th>السبب</th><th>التاريخ</th></tr></thead>
      <tbody id="phTable"></tbody>
    </table></div>
  `, true);
  const list = await API.get('/api/price-history');
  document.getElementById('phTable').innerHTML = list.map(h => `
    <tr>
      <td><b>${esc(h.product_name)}</b></td>
      <td class="num">${fmt(h.old_price)}</td>
      <td class="num"><b>${fmt(h.new_price)}</b></td>
      <td class="small">${esc(h.note || '')}</td>
      <td class="small">${fmtDate(h.created_at)}</td>
    </tr>`).join('') || '<tr><td colspan="5"><div class="empty">لا توجد تغييرات أسعار بعد</div></td></tr>';
}

/* ==================== EXCEL EXPORT & IMPORT (ADMIN ONLY) ==================== */

async function exportProductsExcel() {
  if (!isAdminUser()) {
    showAlert('هذا الإجراء متاح للمدير فقط', 'error');
    return;
  }
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/products/export', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('فشل تصدير بيانات المنتجات');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `products_inventory_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showAlert('تم تصدير شيت المنتجات والمخزون بنجاح 📊');
  } catch (e) {
    showAlert(e.message || 'خطأ أثناء التصدير', 'error');
  }
}

function downloadSampleProductTemplate() {
  const sampleHeaders = [
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

  const sampleRows = [
    ['6291100112233', 'شاحن أيفون 20 واط أصلي', 'إكسسوارات', 'شواحن', 'شواحن أبل', '120', '180', '25', '5', 'قطعة', '0', '1'],
    ['6291100114455', 'هاتف أيفون 15 بروماكس 256GB', 'موبايلات', 'أبل', 'أيفون 15', '45000', '49500', '3', '1', 'قطعة', '1', '1']
  ];

  const bom = '\uFEFF';
  const csvContent = bom + sampleHeaders.join(',') + '\r\n' + sampleRows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sample_products_template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

function decodeSpreadsheetBuffer(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  
  // Check BOM
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  
  // Try UTF-8 first
  const utf8Text = new TextDecoder('utf-8').decode(bytes);
  if (!utf8Text.includes('\uFFFD')) {
    return utf8Text;
  }
  
  // Fallback to windows-1256 (Arabic ANSI saved by Excel)
  try {
    return new TextDecoder('windows-1256').decode(bytes);
  } catch (e) {
    return utf8Text;
  }
}

function parseCsvToProducts(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  // Auto-detect delimiter from header line
  const headerLine = lines[0];
  const countComma = (headerLine.match(/,/g) || []).length;
  const countSemicolon = (headerLine.match(/;/g) || []).length;
  const countTab = (headerLine.match(/\t/g) || []).length;

  let delimiter = ',';
  if (countSemicolon > countComma && countSemicolon >= countTab) delimiter = ';';
  else if (countTab > countComma && countTab > countSemicolon) delimiter = '\t';

  const parseLine = (line) => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === delimiter && !inQuotes) {
        result.push(cur.replace(/^"+|"+$/g, '').trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.replace(/^"+|"+$/g, '').trim());
    return result;
  };

  const rawHeaders = parseLine(lines[0]);
  const headers = rawHeaders.map(h => h.replace(/^\uFEFF/, '').replace(/^"+|"+$/g, '').trim());

  const getColIdx = (possibleHeaders, fallbackIdx) => {
    const idx = headers.findIndex(h => possibleHeaders.some(p => h.toLowerCase().includes(p.toLowerCase())));
    if (idx !== -1) return idx;
    return fallbackIdx;
  };

  const barcodeIdx = getColIdx(['الباركود', 'باركود', 'barcode', 'code'], 0);
  const nameIdx = getColIdx(['اسم المنتج', 'المنتج', 'الاسم', 'name', 'title'], 1);
  const mainCatIdx = getColIdx(['القسم الرئيسي', 'القسم', 'main_category', 'category'], 2);
  const subCatIdx = getColIdx(['الفئة الفرعية', 'sub_category'], 3);
  const typeCatIdx = getColIdx(['النوع الفرعي', 'type_category'], 4);
  const purchaseIdx = getColIdx(['سعر الشراء', 'شراء', 'purchase_price', 'purchase'], 5);
  const saleIdx = getColIdx(['سعر البيع', 'بيع', 'sale_price', 'price'], 6);
  const stockIdx = getColIdx(['المخزون الحالي', 'المخزون', 'الكمية', 'stock', 'qty'], 7);
  const minStockIdx = getColIdx(['الحد الأدنى للمخزون', 'الحد الأدنى', 'min_stock'], 8);
  const unitIdx = getColIdx(['الوحدة', 'unit'], 9);
  const serialIdx = getColIdx(['تتبع السيريال', 'سيريال', 'has_serials', 'sn'], 10);
  const activeIdx = getColIdx(['الحالة', 'نشط', 'active', 'status'], 11);

  const items = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseLine(lines[i]);
    if (row.length === 0 || !row.some(Boolean)) continue;

    const name = row[nameIdx] !== undefined ? row[nameIdx].trim() : '';
    const barcode = row[barcodeIdx] !== undefined ? row[barcodeIdx].trim() : '';

    if (name) {
      items.push({
        barcode,
        name,
        main_category: row[mainCatIdx] || '',
        sub_category: row[subCatIdx] || '',
        type_category: row[typeCatIdx] || '',
        purchase_price: row[purchaseIdx] || 0,
        sale_price: row[saleIdx] || 0,
        stock: row[stockIdx] || 0,
        min_stock: row[minStockIdx] || 0,
        unit: row[unitIdx] || 'قطعة',
        has_serials: row[serialIdx] || 0,
        active: row[activeIdx] !== undefined ? row[activeIdx] : 1
      });
    }
  }

  return items;
}

function importProductsExcelModal() {
  if (!isAdminUser()) {
    showAlert('هذا الإجراء متاح للمدير فقط', 'error');
    return;
  }
  window._parsedImportItems = [];
  openModal(`
    <div class="modal-head"><h3>📥 استرداد وتحديث المنتجات من شيت إكسيل (خاص بالمدير)</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    
    <div style="background:var(--bg-surface-2, #f8f9fa); padding:12px; border-radius:8px; border:1px solid #cbd5e1; margin-bottom:14px; font-size:0.9rem;">
      <b>💡 تعليمات استرداد الملف:</b>
      <ul style="margin-top:6px; margin-right:20px; line-height:1.6;">
        <li>يمكنك رفع شيت المنتجات بصيغة <b>.csv</b> أو <b>.txt</b>.</li>
        <li>سيقوم النظام بتحديث المنتجات الموجودة واستبدال بياناتها السابقة (بالتطابق على الباركود أو الاسم)، وإضافة المنتجات الجديدة تلقائياً.</li>
        <li>يمكنك تحميل نموذج شيت جاهز للتعبئة: <button type="button" class="btn btn-sm btn-secondary" style="margin-right:6px;" onclick="downloadSampleProductTemplate()">📥 تحميل شيت تجريبي نموذج</button></li>
      </ul>
    </div>

    <div class="form-group">
      <label style="font-weight:bold;">اختيار ملف شيت المنتجات (.csv):</label>
      <input type="file" id="excelFile" accept=".csv,.txt" class="form-control" onchange="handleImportFileSelect(event)">
    </div>

    <div class="form-group" style="margin-top:10px;">
      <label style="cursor:pointer; display:flex; align-items:center; gap:8px;">
        <input type="checkbox" id="replaceStockCheck" checked style="width:18px;height:18px;">
        <span><b>🔄 تحديث واستبدال كمية المخزون بالكميات الموضحة بالشيت</b></span>
      </label>
    </div>

    <div id="importPreviewStatus" style="display:none; margin-top:14px; padding:10px; border-radius:6px; background:#e0f2fe; border:1px solid #bae6fd; font-weight:bold;">
    </div>

    <div class="modal-foot">
      <button class="btn btn-accent btn-lg" id="btnConfirmImport" disabled onclick="confirmImportProductsExcel()">📥 تأكيد واسترداد البيانات الآن</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `, true);
}

function handleImportFileSelect(event) {
  const file = event.target.files[0];
  const btn = document.getElementById('btnConfirmImport');
  const status = document.getElementById('importPreviewStatus');
  if (!file) {
    if (btn) btn.disabled = true;
    if (status) status.style.display = 'none';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const buffer = e.target.result;
      const text = decodeSpreadsheetBuffer(buffer);
      const items = parseCsvToProducts(text);
      window._parsedImportItems = items;
      if (items.length > 0) {
        if (status) {
          status.style.display = 'block';
          status.innerHTML = `✅ تم العثور على <b>${items.length}</b> منتج جاهز للاسترداد من الملف ("${esc(file.name)}").`;
        }
        if (btn) btn.disabled = false;
      } else {
        if (status) {
          status.style.display = 'block';
          status.innerHTML = `⚠️ لم يتم العثور على منتجات صالحة في الملف ("${esc(file.name)}"). يرجى التحقق من العناوين أو تحميل الشيت التجريبي النموذجي.`;
        }
        if (btn) btn.disabled = true;
      }
    } catch (err) {
      if (status) {
        status.style.display = 'block';
        status.innerHTML = `❌ خطأ في قراءة الملف: ${esc(err.message)}`;
      }
      if (btn) btn.disabled = true;
    }
  };
  reader.readAsArrayBuffer(file);
}

async function confirmImportProductsExcel() {
  if (!isAdminUser()) {
    showAlert('هذا الإجراء متاح للمدير فقط', 'error');
    return;
  }
  const items = window._parsedImportItems || [];
  if (items.length === 0) {
    showAlert('اختر ملف إكسيل يحتوي منتجات صالحة أولاً', 'error');
    return;
  }

  const replaceStock = document.getElementById('replaceStockCheck')?.checked || false;

  try {
    const res = await API.post('/api/products/import', { items, replaceStock });
    closeModal();
    showAlert(`تمت عملية الاسترداد بنجاح! 🎉 (منتجات جديدة: ${res.created}، منتجات معدلة: ${res.updated})`);
    renderProducts();
  } catch (e) {
    showAlert(e.message || 'خطأ أثناء استرداد بيانات الشيت', 'error');
  }
}
