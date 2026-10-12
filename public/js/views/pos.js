let POS = { products: [], categories: [], cart: [], filterCat: '', search: '', coupon: null };

async function renderPOS() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div id="shiftBar"></div>
    <div class="pos-layout">
      <div>
        <div class="toolbar">
          <input type="search" id="posSearch" placeholder="🔍 بحث بالاسم أو الباركود..." class="grow" style="font-size:1rem;padding:12px" autofocus>
          <button class="btn btn-accent" onclick="openScanner()" title="قراءة باركود بالكاميرا">📷 كاميرا</button>
          <select id="posCatFilter" style="min-width:140px"></select>
        </div>
        <div class="pos-products" id="posGrid"></div>
      </div>
      <div class="cart-panel">
        <div class="cart-box">
          <div class="cart-head">
            <h3>🧾 الفاتورة الحالية</h3>
            <button class="btn btn-ghost btn-sm" onclick="POS.clearCart()">إفراغ</button>
          </div>
          <div class="flex mb-10" style="gap:6px">
            <span class="badge badge-blue" id="cartItemsCount">🧺 أصناف: 0</span>
            <span class="badge badge-gray" id="cartQtySum">📦 إجمالي الكميات: 0</span>
          </div>
          <div class="cart-items" id="cartItems"></div>
          <div class="cart-total">
            <div class="row"><span>الإجمالي قبل الخصم</span><span id="cSubtotal">0.00</span></div>
            <div class="row"><span>الخصم اليدوي</span>
              <input type="number" id="posDiscount" min="0" step="0.01" placeholder="0.00" style="width:110px" oninput="drawCart()">
            </div>
            <div class="row" style="align-items:center"><span>كوبون خصم</span>
              <div style="display:flex;gap:6px;align-items:center">
                <input type="text" id="posCoupon" placeholder="الكود" style="width:110px;text-transform:uppercase">
                <button class="btn btn-secondary btn-sm" onclick="POS.applyCoupon()">تطبيق</button>
              </div>
            </div>
            <div class="row small" id="couponMsg"></div>
            <div class="row" style="align-items:center"><span>🛵 توصيل</span>
              <label style="display:flex;align-items:center;gap:6px;font-weight:700;cursor:pointer;margin:0">
                <input type="checkbox" id="posDeliveryToggle" onchange="POS.toggleDelivery()" style="width:auto">
                <span class="small">خدمة توصيل</span>
              </label>
            </div>
            <div id="posDeliveryBox" style="display:none" class="mt-10">
              <div class="form-group mb-10">
                <label>رسوم التوصيل</label>
                <input type="number" id="posDeliveryFee" min="0" step="0.01" placeholder="0.00" oninput="drawCart()">
              </div>
              <div class="form-group mb-10">
                <label>عنوان التوصيل <span class="muted small">(اختياري)</span></label>
                <input type="text" id="posDeliveryAddress" placeholder="الشارع، رقم العمارة...">
              </div>
            </div>
            <div class="row grand"><span>المطلوب</span><span id="cTotal">0.00</span></div>
          </div>
          <div class="form-group mb-10" style="margin-bottom:8px">
            <label style="display:flex;align-items:center;gap:8px;font-weight:700;cursor:pointer">
              <input type="checkbox" id="posCashCust" onchange="POS.toggleCashCustomer()" style="width:auto">
              <span>🚶 عميل نقدي (بدون بيانات)</span>
            </label>
          </div>
          <div id="posCustArea">
            <div class="form-group mb-10">
              <label>رقم هاتف العميل * <span class="muted small">(مطلوب لإصدار الفاتورة)</span></label>
              <input type="tel" id="posCustPhone" placeholder="01XXXXXXXXX" dir="ltr" style="text-align:left" autocomplete="off">
              <div class="small muted" id="custStatus" style="margin-top:4px"></div>
            </div>
            <div class="form-group mb-10" id="posCustNameBox" style="display:none">
              <label>اسم العميل</label>
              <input type="text" id="posCustName" placeholder="اسم العميل">
            </div>
            <div class="small muted mb-10" id="loyaltyStatus"></div>
          </div>
          <div id="payRows"></div>
          <div class="flex mb-10" style="gap:8px;align-items:center">
            <button class="btn btn-secondary btn-sm" onclick="POS.addPayRow()">➕ إضافة طريقة دفع</button>
            <label style="display:flex;align-items:center;gap:6px;font-weight:700;cursor:pointer;margin:0">
              <input type="checkbox" id="posCreditToggle" onchange="POS.toggleCredit()" style="width:auto">
              <span>📝 آجل (المتبقي مديونية)</span>
            </label>
          </div>
          <div class="row mb-10"><span>إجمالي المدفوع</span><b id="posPaidSum">0.00</b></div>
          <div class="row mb-10" id="posDueBox" style="font-size:.9rem;display:none"><span>المتبقي على العميل (مديونية آجل)</span><span id="posDue" class="text-danger" style="font-weight:800">0.00</span></div>
          <div class="row mb-10" style="font-size:.9rem"><span>الباقي للعميل</span><span id="posChange" class="text-success" style="font-weight:800">0.00</span></div>
          <button class="btn btn-lg btn-block" id="posCheckoutBtn" onclick="POS.checkout()">✅ إنهاء البيع وإصدار الفاتورة</button>
        </div>
      </div>
    </div>`;

  const [products, categories] = await Promise.all([
    API.get('/api/products'), API.get('/api/categories'),
  ]);
  POS.products = products;
  POS.categories = categories;

  const catSel = document.getElementById('posCatFilter');
  const catOpts = (parentId = null, depth = 0) => {
    let out = '';
    for (const c of categories.filter(x => Number(x.parent_id || 0) === Number(parentId || 0))) {
      out += `<option value="${c.id}">${'&nbsp;'.repeat(depth * 4)}${depth ? '↳ '.repeat(depth) : ''} ${esc(c.name)}</option>` + catOpts(c.id, depth + 1);
    }
    return out;
  };
  catSel.innerHTML = '<option value="">كل الأقسام</option>' + catOpts();

  document.getElementById('posSearch').addEventListener('input', (e) => {
    POS.search = e.target.value.trim();
    drawPOSGrid();
  });
  catSel.addEventListener('change', (e) => { POS.filterCat = e.target.value; drawPOSGrid(); });
  document.getElementById('posSearch').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = POS.search;
      if (!q) return;

      // 1) Check product barcode first for products WITHOUT serials
      const hit = POS.products.find(p => p.barcode && String(p.barcode) === q);
      if (hit && !hit.has_serials) {
        if (!hit.active) {
          showAlert(`⚠️ هذا المنتج (${esc(hit.name)}) موقوف حالياً ولا يمكن بيعه`, 'error');
          document.getElementById('posSearch').value = '';
          POS.search = '';
          return;
        }
        POS.addItem(hit);
        document.getElementById('posSearch').value = '';
        POS.search = '';
        return;
      }

      // 2) Verify serial number via API (/api/serials/verify)
      try {
        const verifyRes = await API.get('/api/serials/verify?q=' + encodeURIComponent(q));
        if (verifyRes && verifyRes.found) {
          if (verifyRes.status === 'sold') {
            const dateStr = verifyRes.sold_at ? fmtDate(verifyRes.sold_at) : 'تاريخ غير محدد';
            showAlert(`🚨 عذراً! هذا السيريال (${esc(q)}) تم بيعه سابقاً! (في فاتورة رقم: ${esc(verifyRes.invoice_no || 'غير معروف')} — بتاريخ: ${dateStr})`, 'error');
            document.getElementById('posSearch').value = '';
            POS.search = '';
            return;
          }
          if (verifyRes.status === 'available') {
            const prod = POS.products.find(p => p.id === verifyRes.product_id);
            if (prod) {
              if (!prod.active) {
                showAlert(`⚠️ هذا المنتج (${esc(prod.name)}) موقوف حالياً ولا يمكن بيعه`, 'error');
                document.getElementById('posSearch').value = '';
                POS.search = '';
                return;
              }
              POS.addItemWithSerial(prod, verifyRes.serial_number);
              document.getElementById('posSearch').value = '';
              POS.search = '';
              showAlert(`✅ تم تحديد وإضافة "${prod.name}" بالسيريال: ${verifyRes.serial_number}`, 'success');
              return;
            }
          }
        }
      } catch (err) {}

      // 3) If barcode hit exists for serial product, add product to cart for serial pick
      if (hit) {
        if (!hit.active) {
          showAlert(`⚠️ هذا المنتج (${esc(hit.name)}) موقوف حالياً ولا يمكن بيعه`, 'error');
          document.getElementById('posSearch').value = '';
          POS.search = '';
          return;
        }
        POS.addItem(hit);
        document.getElementById('posSearch').value = '';
        POS.search = '';
        return;
      }

      // 4) Check scanned coupon code
      applyScannedCoupon(q);
    }
  });
  const phoneInput = document.getElementById('posCustPhone');
  phoneInput.addEventListener('input', () => {
    clearTimeout(phoneInput._t);
    phoneInput._t = setTimeout(POS.phoneLookup, 350);
  });

  POS.payRows = [{ method: 'cash', amount: '' }];
  drawPayRows();
  drawPOSGrid();
  drawCart();
  loadShift();
  installPosForcedFocus();
}

/* ==================== Forced focus on barcode/search box ==================== */
function posFocusSearch() {
  const s = document.getElementById('posSearch');
  if (!s || document.activeElement === s) return;
  s.focus();
  const len = s.value.length;
  try { s.setSelectionRange(len, len); } catch {}
}

function installPosForcedFocus() {
  if (window._posFocusClick) document.removeEventListener('click', window._posFocusClick, true);
  if (window._posFocusKey) document.removeEventListener('keydown', window._posFocusKey, true);

  window._posFocusClick = (e) => {
    const search = document.getElementById('posSearch');
    if (!search) return;
    if (document.getElementById('modalOverlay')?.classList.contains('open')) return;
    const t = e.target;
    if (!t) return;
    if (t.closest('#modalOverlay')) return;
    if (!search.isConnected) return;
    if (!(t.closest('.app') || t === document.body)) return;
    if (t.closest('input, select, textarea, button, a, .cart-panel .qty-ctrl')) return;
    posFocusSearch();
  };
  document.addEventListener('click', window._posFocusClick, true);

  window._posFocusKey = (e) => {
    const search = document.getElementById('posSearch');
    if (!search || !search.isConnected) return;
    if (document.getElementById('modalOverlay')?.classList.contains('open')) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.length !== 1) return;
    const ae = document.activeElement;
    if (ae === search) return;
    if (ae && (['INPUT', 'SELECT', 'TEXTAREA'].includes(ae.tagName) || ae.isContentEditable)) return;
    e.preventDefault();
    search.value = (search.value || '') + e.key;
    POS.search = search.value.trim();
    drawPOSGrid();
    posFocusSearch();
  };
  document.addEventListener('keydown', window._posFocusKey, true);
}

const PAY_LABELS = { cash: '💵 كاش', card: '💳 كارت', wallet: '📱 محفظة' };

function drawPayRows() {
  const box = document.getElementById('payRows');
  if (!box) return;
  box.innerHTML = (POS.payRows || []).map((r, i) => `
    <div class="pay-row mb-10" style="align-items:end">
      <div class="form-group" style="margin:0;flex:1">
        <label class="small muted">${i === 0 ? 'طريقة الدفع الأساسية' : 'طريقة إضافية'}</label>
        <select data-paymethod="${i}" onchange="POS.setPayRow(${i}, 'method', this.value)">
          ${Object.entries(PAY_LABELS).map(([k, v]) => `<option value="${k}" ${r.method === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin:0;flex:1">
        <label class="small muted">المبلغ</label>
        <input type="number" data-pay="${i}" min="0" step="0.01" placeholder="${i === 0 ? 'يُحسب تلقائياً' : 'المبلغ'}" value="${r.amount}" oninput="POS.setPayRow(${i}, 'amount', this.value)">
      </div>
      ${i > 0 ? `<button class="btn btn-danger btn-sm" onclick="POS.removePayRow(${i})" title="حذف">✕</button>` : ''}
    </div>`).join('');
  onPayInput();
}

POS.toggleCashCustomer = function () {
  const on = document.getElementById('posCashCust').checked;
  document.getElementById('posCustArea').style.display = on ? 'none' : 'block';
  if (on) {
    POS.customer = null;
    document.getElementById('posCustPhone').value = '';
    document.getElementById('custStatus').textContent = '';
    document.getElementById('loyaltyStatus').textContent = '';
  }
};

POS.addPayRow = function () {
  const used = (POS.payRows || []).map(r => r.method);
  const next = ['card', 'wallet'].find(m => !used.includes(m)) || 'cash';
  POS.payRows.push({ method: next, amount: '' });
  drawPayRows();
};

POS.toggleCredit = function () {
  if (document.getElementById('posCreditToggle').checked) {
    const primary = document.querySelector('[data-pay="0"]');
    if (primary) { primary.value = ''; POS.payRows[0].amount = ''; }
    primary?.focus();
  }
  recalcPayDisplay();
};

POS.removePayRow = function (i) {
  POS.payRows.splice(i, 1);
  drawPayRows();
};

POS.setPayRow = function (i, field, value) {
  POS.payRows[i][field] = value;
  if (field === 'amount') recalcPayDisplay();
  else onPayInput();
};

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function onPayInput() {
  const rows = POS.payRows || [{ method: 'cash', amount: '' }];
  const { total } = cartTotals();
  const primary = document.querySelector('[data-pay="0"]');
  const creditOn = document.getElementById('posCreditToggle')?.checked;
  if (primary && document.activeElement !== primary && !creditOn) {
    const others = rows.slice(1).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const want = Math.max(0, round2(total - others));
    primary.value = want > 0 ? want.toFixed(2) : '';
    rows[0].amount = primary.value;
  }
  recalcPayDisplay();
}

function recalcPayDisplay() {
  const sumEl = document.getElementById('posPaidSum');
  const dueEl = document.getElementById('posDue');
  const dueBox = document.getElementById('posDueBox');
  const changeEl = document.getElementById('posChange');
  if (!sumEl) return;
  const rows = POS.payRows || [];
  const { total } = cartTotals();
  const paidSum = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const due = round2(Math.max(0, total - paidSum));
  const change = Math.max(0, round2(paidSum - total));
  sumEl.textContent = fmt(paidSum);
  changeEl.textContent = fmt(change);
  dueBox.style.display = due > 0.001 ? 'flex' : 'none';
  dueEl.textContent = fmt(due);
}

const SHIFT_METHOD_NAMES = { cash: '💵 كاش', card: '💳 فيزا/شبكة', wallet: '📱 محفظة', transfer: '🏦 تحويل بنكي' };

async function loadShift() {
  const bar = document.getElementById('shiftBar');
  const data = await API.get('/api/shifts/current');
  if (data.shift) {
    const s = data.shift;
    const chips = Object.entries(data.methods || {})
      .filter(([, v]) => v.in > 0.001 || v.out > 0.001)
      .map(([k, v]) => `<div class="card" style="padding:6px 12px;display:inline-flex;gap:8px;align-items:center">
        <b class="small">${SHIFT_METHOD_NAMES[k] || k}</b>
        <span class="small" style="color:var(--primary-dark)">داخل ${fmt(v.in)}</span>
        <span class="small" style="color:var(--danger)">خارج ${fmt(v.out)}</span>
        <span class="badge ${v.net >= 0 ? 'badge-green' : 'badge-red'}">صافي ${fmt(v.net)}</span>
      </div>`).join('');
    const i = data.info || {};
    bar.innerHTML = `
      <div class="card" style="padding:14px;border-right:4px solid var(--primary)">
        <div class="flex-between" style="flex-wrap:wrap;gap:10px">
          <div class="flex" style="gap:18px;flex-wrap:wrap">
            <div><span class="muted small">فتحت في:</span> <b>${fmtDate(s.opened_at)}</b></div>
            <div><span class="muted small">رصيد البداية:</span> <b>${fmt(s.opening_cash)}</b></div>
            <div><span class="muted small">مبيعات الوردية:</span> <b>${fmt(i.sales_total)}</b> (${i.sales_count} فاتورة)</div>
            ${i.credit_due > 0.001 ? `<div><span class="muted small">مبيعات آجل:</span> <b style="color:var(--warning)">${fmt(i.credit_due)}</b></div>` : ''}
            ${i.maint_count ? `<div><span class="muted small">تحصيل صيانة:</span> <b>${fmt(i.maint_total)}</b> (${i.maint_count} دفعة)</div>` : ''}
          </div>
          <button class="btn btn-danger" onclick="POS.closeShift()">⏹️ غلق الوردية</button>
        </div>
        <div class="flex mt-10" style="gap:8px;flex-wrap:wrap;align-items:center">
          ${chips || '<span class="small muted">لا توجد حركات بعد</span>'}
          <div class="card" style="padding:6px 12px;background:var(--primary-light,#dcfce7)">
            <b class="small">الرصيد المتوقع في الدرج (كاش):</b>
            <b style="color:var(--primary-dark);font-size:1.05rem"> ${fmt(data.expected_cash)}</b>
          </div>
        </div>
      </div>`;
  } else {
    bar.innerHTML = `
      <div class="card" style="padding:14px;border-right:4px solid var(--warning);background:#fffbeb">
        <div class="flex-between" style="gap:12px;flex-wrap:wrap">
          <div>
            <b>⚠️ لا توجد وردية مفتوحة</b>
            <div class="small muted">افتح الوردية قبل بدء البيع لتتبع المبيعات اليومية</div>
          </div>
          <div class="flex">
            <input type="number" id="shiftOpenCash" placeholder="رصيد البداية في الدرج" style="width:180px" step="0.01">
            <button class="btn" onclick="POS.openShift()">▶️ فتح الوردية</button>
          </div>
        </div>
      </div>`;
  }
}

POS.openShift = async function () {
  const opening = Number(document.getElementById('shiftOpenCash')?.value) || 0;
  try {
    await API.post('/api/shifts/open', { opening_cash: opening });
    showAlert('تم فتح الوردية');
    loadShift();
  } catch (e) { showAlert(e.message, 'error'); }
};

POS.closeShift = async function () {
  try {
    const data = await API.get('/api/shifts/current');
    if (!data.shift) { showAlert('لا توجد وردية مفتوحة', 'error'); return; }
    const expected = data.expected_cash;
    const m = data.methods || {};
    const i = data.info || {};
    const methodRows = Object.entries(m).map(([k, v]) => `
      <tr>
        <td class="small"><b>${SHIFT_METHOD_NAMES[k] || k}</b></td>
        <td class="num small" style="color:var(--primary-dark);font-weight:700">${fmt(v.in)}</td>
        <td class="num small" style="color:var(--danger);font-weight:700">${fmt(v.out)}</td>
        <td class="num small" style="font-weight:800">${fmt(v.net)}</td>
      </tr>`).join('');
    openModal(`
      <div class="modal-head"><h3>🔒 غلق الوردية</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="card" style="padding:12px;margin-bottom:12px">
        <div style="font-weight:800;font-size:.9rem;margin-bottom:6px">💳 بيان وسائل الدفع المسددة فعلياً:</div>
        <table style="width:100%;margin-bottom:10px">
          <thead><tr style="color:var(--text-muted)">
            <th style="text-align:right;font-size:.8rem">طريقة الدفع</th>
            <th class="num" style="font-size:.8rem">داخل</th>
            <th class="num" style="font-size:.8rem">خارج</th>
            <th class="num" style="font-size:.8rem">الصافي</th>
          </tr></thead>
          <tbody>${methodRows}</tbody>
          <tfoot><tr style="border-top:2px solid var(--border)">
            <td style="padding-top:6px;font-weight:800">إجمالي المدفوعات المسددة</td>
            <td class="num" style="padding-top:6px;font-weight:800">${fmt((data.totals || {}).in)}</td>
            <td class="num" style="padding-top:6px;font-weight:800;color:var(--danger)">${fmt((data.totals || {}).out)}</td>
            <td class="num" style="padding-top:6px;font-weight:800">${fmt(((data.totals || {}).in || 0) - ((data.totals || {}).out || 0))}</td>
          </tr></tfoot>
        </table>

        <div class="mt-10" style="border-top:1px dashed var(--border);padding-top:8px">
          <div style="font-weight:800;font-size:.9rem;margin-bottom:6px">📊 ملخص كل عمليات الوردية (مدفوع / آجل):</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:.85rem;background:var(--bg-card);padding:8px;border-radius:6px">
            <div>🧾 <b>مبيعات أصناف:</b> ${fmt(i.sales_total || 0)} ${i.credit_due > 0.001 ? `<span style="color:var(--warning)">(آجل عملاء: ${fmt(i.credit_due)})</span>` : ''}</div>
            <div>📦 <b>مشتريات أصناف:</b> ${fmt(i.purchase_total || 0)} ${i.purchase_credit_due > 0.001 ? `<span style="color:var(--warning)">(آجل موردين: ${fmt(i.purchase_credit_due)})</span>` : ''}</div>
            <div>🔧 <b>تحصيل صيانة:</b> ${fmt(i.maint_total || 0)}</div>
            <div>📱 <b>أجهزة مستعملة (بيع):</b> ${fmt(i.used_sell_total || 0)} ${i.used_sell_credit > 0.001 ? `<span style="color:var(--warning)">(آجل: ${fmt(i.used_sell_credit)})</span>` : ''}</div>
            <div>📱 <b>أجهزة مستعملة (شراء):</b> ${fmt(i.used_buy_total || 0)} ${i.used_buy_credit > 0.001 ? `<span style="color:var(--warning)">(آجل: ${fmt(i.used_buy_credit)})</span>` : ''}</div>
            <div>💸 <b>مصروفات ومسحوبات:</b> ${fmt((i.expense_total || 0) + (i.emp_out_total || 0))}</div>
          </div>
        </div>

        <div class="flex-between mt-10" style="border-top:2px solid var(--border);padding-top:8px">
          <span class="small muted">رصيد بداية الوردية في الدرج</span><b class="small">${fmt(data.shift.opening_cash)}</b>
        </div>
        <div class="flex-between">
          <span style="font-weight:800">💰 الرصيد المتوقع في درج النقدية (كاش داخل − كاش خارج)</span>
          <b style="color:var(--primary-dark);font-size:1.15rem">${fmt(expected)}</b>
        </div>
      </div>
      <div class="form-group"><label>رصيد الدرج الفعلي (بعد عدّ النقود)</label><input type="number" id="closingCash" step="0.01" value="${expected}"></div>
      <div class="muted small">سيُحسب الفرق بين الفعلي والمتوقع تلقائياً — حركات فيزا/المحفظة مسجلة بالكامل فوق لكنها لا تدخل درج الكاش</div>
      <div class="modal-foot">
        <button class="btn" onclick="POS.closeShiftSave()">🔒 تأكيد الغلق</button>
        <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
      </div>
    `);
    const inp = document.getElementById('closingCash');
    if (inp) { inp.focus(); inp.select(); }
  } catch (e) { showAlert(e.message, 'error'); }
};

POS.closeShiftSave = async function () {
  const c = Number(document.getElementById('closingCash').value);
  if (isNaN(c)) { showAlert('أدخل رقماً صحيحاً', 'error'); return; }
  try {
    const result = await API.post('/api/shifts/close', { closing_cash: c });
    closeModal();
    showAlert(`تم غلق الوردية — المتوقع: ${result.expected_cash.toFixed(2)} — الفعلي: ${result.closing_cash.toFixed(2)} — الفرق: ${result.diff.toFixed(2)}`);
    loadShift();
  } catch (e) { closeModal(); showAlert(e.message, 'error'); }
};

function drawPOSGrid() {
  const grid = document.getElementById('posGrid');
  if (!grid) return;
  let list = POS.products;
  if (POS.filterCat) {
    const selfCat = POS.categories.find(c => Number(c.id) === Number(POS.filterCat));
    if (selfCat && !Number(selfCat.parent_id || 0)) {
      // قسم رئيسي: يضم كل السلالة (فرع وأنواع)
      const ids = [Number(POS.filterCat)];
      for (let i = 0; i < ids.length; i++) {
        for (const c of POS.categories) if (Number(c.parent_id) === ids[i]) ids.push(Number(c.id));
      }
      list = list.filter(p => ids.includes(Number(p.category_id)));
    } else {
      // فئة فرعية / نوع فرعي: تطابق مباشر بالضبط
      list = list.filter(p => Number(p.category_id) === Number(POS.filterCat));
    }
  }

  const query = (POS.search || '').trim().toLowerCase();
  if (query) {
    list = list.filter(p => {
      const nameMatch = p.name.toLowerCase().includes(query);
      const barcodeMatch = p.barcode && String(p.barcode).toLowerCase().includes(query);
      const serialMatch = Array.isArray(p.available_serials) && p.available_serials.some(s => s.toLowerCase().includes(query));
      return nameMatch || barcodeMatch || serialMatch;
    });
  }

  const items = POS.cart;
  grid.innerHTML = list.map(p => {
    const inCart = items.find(i => i.product_id === p.id);
    const low = p.stock <= p.min_stock;
    const isInactive = !p.active;

    let matchedSerial = null;
    if (query && Array.isArray(p.available_serials)) {
      matchedSerial = p.available_serials.find(s => s.toLowerCase() === query) ||
                      p.available_serials.find(s => s.toLowerCase().includes(query));
    }

    const clickAction = isInactive
      ? `showAlert('⚠️ هذا المنتج (${esc(p.name)}) موقوف حالياً ولا يمكن بيعه', 'error')`
      : (matchedSerial
          ? `POS.addItemWithSerial(${p.id}, '${esc(matchedSerial)}')`
          : `POS.addItem(${p.id})`);

    const inactiveStyle = isInactive
      ? 'opacity:0.65;filter:grayscale(0.6);border:2px dashed #ef4444;background:#fef2f2;cursor:not-allowed;'
      : '';

    return `<div class="pos-item${low ? ' low' : ''}${isInactive ? ' disabled' : ''}" style="${inactiveStyle}" onclick="${clickAction}" title="${isInactive ? 'منتج موقوف — غير متاح للبيع' : esc(p.name)}">
      <div class="pname">
        ${esc(p.name)}
        ${isInactive ? ' <span class="badge badge-red" style="font-size:0.75rem;vertical-align:middle;margin-right:4px;">⛔ موقوف</span>' : ''}
      </div>
      <div class="pprice">${fmt(p.sale_price)} ${SETTINGS.currency || 'ج'}</div>
      ${matchedSerial ? `<div class="small bold text-blue mt-5" style="font-family:monospace">🔢 سيريال: ${esc(matchedSerial)}</div>` : ''}
      <div class="pstock">
        ${isInactive ? '<b style="color:#dc2626;">غير متاح للبيع (موقوف)</b>' : `المخزون: ${fmt(p.stock)} ${inCart ? `— <span class="badge badge-blue">${inCart.qty} في الفاتورة</span>` : ''}`}
      </div>
    </div>`;
  }).join('') || '<div class="empty">لا توجد منتجات مطابقة</div>';
}

POS.addItem = function (pid) {
  const p = typeof pid === 'object' ? pid : POS.products.find(x => x.id === pid);
  if (!p) return;
  if (!p.active) {
    showAlert(`⚠️ المنتج "${p.name}" موقوف حالياً ولا يمكن بيعه`, 'error');
    return;
  }

  const query = (POS.search || '').trim().toLowerCase();
  if (query && Array.isArray(p.available_serials)) {
    const exactSerial = p.available_serials.find(s => s.toLowerCase() === query) ||
                        p.available_serials.find(s => s.toLowerCase().includes(query));
    if (exactSerial) {
      return POS.addItemWithSerial(p, exactSerial);
    }
  }

  const existing = POS.cart.find(i => i.product_id === p.id);
  if (existing) {
    if (existing.qty < p.stock) existing.qty += 1;
  } else {
    if (p.stock < 1) { showAlert('لا توجد كمية متاحة من هذا المنتج', 'error'); return; }
    POS.cart.unshift({ product_id: p.id, name: p.name, barcode: p.barcode, price: p.sale_price, qty: 1, stock: p.stock, has_serials: p.has_serials || 0, serials: [] });
  }
  drawCart(); drawPOSGrid();
};

POS.addItemWithSerial = function (pid, serialNumber) {
  const p = typeof pid === 'object' ? pid : POS.products.find(x => x.id === pid);
  if (!p) return;
  if (!p.active) {
    showAlert(`⚠️ المنتج "${p.name}" موقوف حالياً ولا يمكن بيعه`, 'error');
    return;
  }
  let existing = POS.cart.find(i => i.product_id === p.id);
  if (existing) {
    if (existing.qty < p.stock) {
      existing.qty += 1;
      if (!Array.isArray(existing.serials)) existing.serials = [];
      if (!existing.serials.includes(serialNumber)) existing.serials.push(serialNumber);
    } else {
      showAlert(`المخزون المتوفر من "${p.name}" هو ${p.stock} فقط`, 'error');
      return;
    }
  } else {
    if (p.stock < 1) { showAlert('لا توجد كمية متاحة من هذا المنتج', 'error'); return; }
    POS.cart.unshift({
      product_id: p.id,
      name: p.name,
      barcode: p.barcode,
      price: p.sale_price,
      qty: 1,
      stock: p.stock,
      has_serials: p.has_serials || 1,
      serials: [serialNumber]
    });
  }
  drawCart(); drawPOSGrid();
};

POS.openItemSerialsModal = async function (pid) {
  const item = POS.cart.find(i => i.product_id === pid);
  if (!item) return;
  try {
    const availableSerials = await API.get('/api/products/' + pid + '/serials?status=available');
    const currentSerials = item.serials || [];
    if (!availableSerials || availableSerials.length === 0) {
      showAlert('لا توجد سيريالات متاحة مسجلة لهذا المنتج في المخزون', 'error');
      return;
    }
    const listHtml = availableSerials.map(s => {
      const checked = currentSerials.includes(s.serial_number) ? 'checked' : '';
      return `
        <label class="card" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;cursor:pointer">
          <span style="font-weight:700;font-family:monospace;font-size:1.05rem">${esc(s.serial_number)}</span>
          <input type="checkbox" class="pos-item-sn-chk" value="${esc(s.serial_number)}" ${checked} style="width:20px;height:20px">
        </label>`;
    }).join('');

    openModal(`
      <div class="modal-head"><h3>🔢 تحديد السيريالات المباعة — ${esc(item.name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <p class="small muted mb-10">الكمية المطلوبة في الفاتورة: <b>${item.qty}</b> — حدد السيريالات المطابقة (الحد الأقصى ${item.qty}):</p>
      <div style="max-height:280px;overflow-y:auto">${listHtml}</div>
      <div class="modal-foot">
        <button class="btn" onclick="POS.saveItemSerials(${pid})">حفظ السيريالات</button>
        <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
      </div>
    `);
  } catch (e) { showAlert(e.message, 'error'); }
};

POS.saveItemSerials = function (pid) {
  const item = POS.cart.find(i => i.product_id === pid);
  if (!item) return;
  const chks = Array.from(document.querySelectorAll('.pos-item-sn-chk:checked')).map(c => c.value);
  if (chks.length > item.qty) {
    showAlert(`اخترت ${chks.length} سيريالات بينما الكمية في الفاتورة ${item.qty}`, 'error');
    return;
  }
  item.serials = chks;
  closeModal();
  drawCart();
  showAlert(`تم حفظ ${chks.length} سيريال للمنتج "${item.name}"`, 'success');
};

POS.setQty = function (pid, delta) {
  const item = POS.cart.find(i => i.product_id === pid);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) POS.cart = POS.cart.filter(i => i.product_id !== pid);
  if (item.qty > item.stock) item.qty = item.stock;
  drawCart(); drawPOSGrid();
};

POS.setQtyManual = function (pid, input) {
  const item = POS.cart.find(i => i.product_id === pid);
  if (!item) return;
  let v = Math.round(Number(input.value) || 0);
  if (v <= 0) { POS.cart = POS.cart.filter(i => i.product_id !== pid); drawCart(); drawPOSGrid(); return; }
  if (v > item.stock) v = item.stock;
  item.qty = v;
  input.value = v;
  drawCart(); drawPOSGrid();
};

POS.setPrice = function (pid, input) {
  const item = POS.cart.find(i => i.product_id === pid);
  if (!item) return;
  let v = Math.round((Number(input.value) || 0) * 100) / 100;
  if (v <= 0) v = item.price;
  item.price = v;
  input.value = v;
  drawCart();
};

POS.applyCoupon = async function () {
  const input = document.getElementById('posCoupon');
  const msg = document.getElementById('couponMsg');
  const code = input.value.trim();
  if (!code) { POS.coupon = null; msg.textContent = ''; drawCart(); return; }
  const { subtotal } = cartTotals();
  try {
    const res = await API.post('/api/coupons/validate', { code, total: subtotal, party_id: (POS.customer || {}).id || null });
    if (res.valid) {
      POS.coupon = { code: code.toUpperCase(), discount: res.discount, type: res.coupon.discount_type };
      msg.innerHTML = `<span class="badge badge-green">كوبون ${esc(code.toUpperCase())}: خصم ${fmt(res.discount)}</span>`;
      msg.style.color = '';
    } else {
      POS.coupon = null;
      msg.innerHTML = `<span class="badge badge-red">${esc(res.error || 'كوبون غير صالح')}</span>`;
    }
    drawCart();
  } catch (e) { showAlert(e.message, 'error'); }
};

POS.clearCart = function () {
  POS.cart = [];
  POS.coupon = null;
  const input = document.getElementById('posCoupon');
  if (input) input.value = '';
  const msg = document.getElementById('couponMsg');
  if (msg) msg.textContent = '';
  drawCart(); drawPOSGrid();
};

POS.phoneLookup = async function () {
  const phone = document.getElementById('posCustPhone').value.trim();
  const status = document.getElementById('custStatus');
  const nameBox = document.getElementById('posCustNameBox');
  const nameInput = document.getElementById('posCustName');
  const loyaltyStatus = document.getElementById('loyaltyStatus');
  if (loyaltyStatus) loyaltyStatus.textContent = '';
  POS.customer = null;
  if (phone.length < 7) {
    if (status) status.textContent = '';
    if (nameBox) nameBox.style.display = 'none';
    if (nameInput) nameInput.value = '';
    return;
  }
  try {
    const res = await API.get('/api/customers/lookup?phone=' + encodeURIComponent(phone));
    if (res.customer) {
      POS.customer = res.customer;
      if (nameInput) nameInput.value = res.customer.name;
      if (nameBox) nameBox.style.display = 'block';
      if (status) status.innerHTML = `<span class="badge badge-green">✅ عميل موجود: ${esc(res.customer.name)}</span>`;
      const threshold = Number(SETTINGS.loyalty_threshold) || 5;
      const remaining = Math.max(0, threshold - (res.sales_count || 0));
      const percent = Number(SETTINGS.loyalty_percent) || 10;
      if (loyaltyStatus) loyaltyStatus.innerHTML = remaining > 0
        ? `🎁 ولاء: عدد الفواتير ${res.sales_count} — تبقى <b>${remaining}</b> فاتورة لتحصل على كوبون خصم ${percent}%`
        : `🎁 عميل وفية — يطبع له كوبون خصم ${percent}% مع كل فاتورة`;
    } else {
      POS.customer = null;
      if (nameInput) nameInput.value = '';
      if (nameBox) nameBox.style.display = 'block';
      if (status) status.innerHTML = `<span class="badge badge-blue">🆕 عميل جديد — أدخل اسمه</span>`;
    }
  } catch (e) {
    if (status) status.textContent = '';
  }
};

POS.toggleDelivery = function () {
  const on = document.getElementById('posDeliveryToggle').checked;
  document.getElementById('posDeliveryBox').style.display = on ? 'block' : 'none';
  if (on) document.getElementById('posDeliveryFee').focus();
  else document.getElementById('posDeliveryFee').value = '';
  drawCart();
};

function cartTotals() {
  const subtotal = POS.cart.reduce((s, i) => s + i.price * i.qty, 0);
  let discount = Math.min(Number(document.getElementById('posDiscount')?.value) || 0, subtotal);
  if (POS.coupon) discount = Math.max(discount, Math.min(POS.coupon.discount, subtotal));
  const deliveryOn = document.getElementById('posDeliveryToggle')?.checked;
  const deliveryFee = deliveryOn ? Math.max(0, Number(document.getElementById('posDeliveryFee')?.value) || 0) : 0;
  return { subtotal, discount, deliveryFee, total: subtotal - discount + deliveryFee };
}

function drawCart() {
  const box = document.getElementById('cartItems');
  const subtotal = document.getElementById('cSubtotal');
  const totalEl = document.getElementById('cTotal');
  if (!box) return;
  const cntEl = document.getElementById('cartItemsCount');
  const qtyEl = document.getElementById('cartQtySum');
  if (cntEl) cntEl.textContent = '🧺 أصناف: ' + POS.cart.length;
  if (qtyEl) qtyEl.textContent = '📦 إجمالي الكميات: ' + fmt(POS.cart.reduce((s, i) => s + (Number(i.qty) || 0), 0));
  const { subtotal: st, discount, total } = cartTotals();
  if (subtotal) subtotal.textContent = fmt(st) + ' ' + (SETTINGS.currency || 'ج');
  if (totalEl) totalEl.textContent = fmt(total) + ' ' + (SETTINGS.currency || 'ج');
  const discEl = document.getElementById('cDiscount');
  if (discEl) discEl.textContent = fmt(discount);
  if (POS.cart.length === 0) {
    box.innerHTML = '<div class="empty">الفاتورة فارغة — أضف منتجات</div>';
    return;
  }
  box.innerHTML = POS.cart.map(i => {
    const hasSerials = !!i.has_serials || (i.serials && i.serials.length > 0);
    const serialsList = i.serials || [];
    const needed = i.qty - serialsList.length;
    return `
    <div class="cart-row" style="flex-wrap:wrap">
      <div style="display:flex;align-items:center;width:100%;gap:6px">
        <button class="cremove" onclick="POS.setQty(${i.product_id}, -999)">🗑️</button>
        <div class="cname">${esc(i.name)}</div>
        <div class="cart-edit">
          <label class="cart-field qty"><span>الكمية</span>
            <input type="number" min="1" max="${i.stock}" value="${i.qty}"
              onchange="POS.setQtyManual(${i.product_id}, this)" oninput="this.value=this.value.replace(/[^0-9]/g,'')">
          </label>
          <label class="cart-field price"><span>السعر</span>
            <input type="number" step="0.01" min="0" value="${i.price}"
              onchange="POS.setPrice(${i.product_id}, this)">
          </label>
        </div>
        <div class="qty-ctrl">
          <button onclick="POS.setQty(${i.product_id}, 1)">+</button>
          <button onclick="POS.setQty(${i.product_id}, -1)">−</button>
        </div>
        <div class="cprice">${fmt(i.price * i.qty)}</div>
      </div>
      ${hasSerials ? `
        <div style="width:100%;margin-top:4px;padding:4px 8px;background:var(--bg-card,#f8fafc);border-radius:6px;display:flex;align-items:center;justify-content:space-between">
          <div class="small">
            <b>🔢 السيريالات:</b>
            ${serialsList.length ? serialsList.map(s => `<span class="badge badge-blue" style="margin-left:3px">${esc(s)}</span>`).join('') : '<span class="muted">لم تُحدد سيريالات بعد</span>'}
            ${needed > 0 ? `<span class="badge badge-red" style="margin-left:4px">⚠️ مطلوب ${needed} سيريال</span>` : ''}
          </div>
          <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:0.8rem" onclick="POS.openItemSerialsModal(${i.product_id})">⚙️ اختيار السيريالات</button>
        </div>` : ''}
    </div>`;
  }).join('');
  onPayInput();
}

POS.checkout = async function () {
  if (POS.cart.length === 0) { showAlert('الفاتورة فارغة', 'error'); return; }
  for (const item of POS.cart) {
    if (item.has_serials) {
      const sArr = item.serials || [];
      if (sArr.length !== item.qty) {
        showAlert(`المنتج "${item.name}" يتطلب تحديد ${item.qty} سيريال (محدد حالياً ${sArr.length})`, 'error');
        return;
      }
    }
  }
  const isCashCustomer = document.getElementById('posCashCust').checked;
  const phone = document.getElementById('posCustPhone').value.trim();
  const name = document.getElementById('posCustName').value.trim();
  if (!isCashCustomer && !phone) { showAlert('أدخل رقم هاتف العميل أو اختر "عميل نقدي"', 'error'); return; }
  const rows = POS.payRows || [];
  const hasCredit = document.getElementById('posCreditToggle').checked;
  const { subtotal, discount, deliveryFee, total } = cartTotals();
  const deliveryAddress = document.getElementById('posDeliveryToggle')?.checked
    ? document.getElementById('posDeliveryAddress').value.trim() : '';
  const payments = rows
    .map(r => ({ method: r.method, amount: round2(Number(r.amount) || 0) }))
    .filter(p => p.amount > 0);
  const paidSum = round2(payments.reduce((s, p) => s + p.amount, 0));
  const due = round2(total - paidSum);
  if (hasCredit && due <= 0.001) {
    showAlert('في الآجل لا يمكن أن يكون المدفوع مساوياً لقيمة الفاتورة أو أكثر منها — اترك متبقي كمديونية', 'error');
    return;
  }
  if (!hasCredit && due > 0.001) {
    showAlert(`المبلغ المدفوع أقل من قيمة الفاتورة (${fmt(due)} متبقي) — أكمل المبلغ أو فعّل "آجل" للمتبقي`, 'error');
    return;
  }
  if (hasCredit && isCashCustomer) {
    showAlert('البيع بالآجل يتطلب عميلاً مسجلاً — عميل نقدي لا يمكن أن يكون عليه مديونية', 'error');
    return;
  }
  const btn = document.getElementById('posCheckoutBtn');
  btn.disabled = true; btn.textContent = 'جاري الحفظ...';
  try {
    const data = await API.post('/api/sales', {
      items: POS.cart.map(i => ({ product_id: i.product_id, qty: i.qty, price: i.price, serials: i.serials || [] })),
      discount,
      coupon_code: POS.coupon ? POS.coupon.code : null,
      payments: payments.length ? payments : undefined,
      paid: payments.length ? undefined : '',
      payment_method: rows[0].method,
      credit: hasCredit,
      customer_cash: isCashCustomer,
      delivery_fee: deliveryFee,
      delivery_address: deliveryAddress,
      customer_phone: isCashCustomer ? '' : phone,
      customer_name: isCashCustomer ? '' : name,
    });
    showReceipt(data.sale_id, data.invoice_no, data.loyalty || null, data.due || 0, data.payments || []);
    if (data.loyalty && !data.loyalty.issued && data.loyalty.code) {
      showAlert(`🎁 تم تجديد كوبون الخصم ${data.loyalty.code} حتى ${data.loyalty.expires_at}`, 'success');
    }
    POS.cart = [];
    drawCart();
    renderPOS();
  } catch (err) {
    showAlert(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '✅ إنهاء البيع وإصدار الفاتورة';
  }
};

async function showReceipt(saleId, invoiceNo, loyalty, due, payments) {
  const s = await API.get('/api/sales/' + saleId);
  POS.lastSale = s;
  const methodNames = { cash: 'كاش', card: 'كارت', wallet: 'محفظة', credit: 'آجل', mixed: 'متعدد' };
  const payLines = Array.isArray(payments) && payments.length
    ? payments
    : (() => { try { return JSON.parse(s.payments_json || 'null') || []; } catch { return []; } })();
  const methodName = payLines.length > 1
    ? payLines.map(p => `${methodNames[p.method] || p.method} ${fmt(p.amount)}`).join(' + ')
    : (methodNames[s.payment_method] || s.payment_method);
  POS.lastMethodNames = methodNames;
  POS.lastMethodName = methodName;
  POS.lastLoyalty = loyalty || null;
  if (loyalty && loyalty.code) window.APP_loyalty = loyalty;
  openModal(`
    <div class="modal-head"><h3>✅ تمت العملية بنجاح</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="receipt">
      <div class="r-head">
        <h4>${esc(SETTINGS.store_name || 'سوبر ماركت')}</h4>
        <div class="small">فاتورة رقم: ${esc(s.invoice_no)}</div>
        <div class="small">${fmtDate(s.created_at)}</div>
        <div class="small">الكاشير: ${esc(s.cashier)}</div>
        ${s.customer_name ? `<div class="small">العميل: ${esc(s.customer_name)}${s.customer_phone ? ' — ' + esc(s.customer_phone) : ''}</div>` : ''}
      </div>
      <table>
        <thead><tr><th>الصنف</th><th class="num">كمية</th><th class="num">سعر</th><th class="num">إجمالي</th></tr></thead>
        <tbody>${s.items.map(i => {
          let sArr = [];
          try { if (i.serials_json) sArr = JSON.parse(i.serials_json); } catch {}
          const serialsHtml = sArr.length ? `<div style="font-size:11.5px;font-weight:800;color:#000;direction:ltr;text-align:right;margin-top:2px;letter-spacing:0.5px"><b>🔢 S/N:</b> ${sArr.map(x=>esc(x)).join(', ')}</div>` : '';
          return `<tr><td>${esc(i.name)}${serialsHtml}</td><td class="num">${fmt(i.qty)}</td><td class="num">${fmt(i.price)}</td><td class="num">${fmt(i.total)}</td></tr>`;
        }).join('')}
        </tbody>
      </table>
      <div class="r-line"><span>الإجمالي قبل الخصم</span><span>${fmt(s.subtotal)}</span></div>
      <div class="r-line"><span>الخصم</span><span>${fmt(s.discount)}</span></div>
      ${Number(s.delivery_fee) > 0 ? `<div class="r-line"><span>🛵 رسوم التوصيل${s.delivery_address ? ' (' + esc(s.delivery_address) + ')' : ''}</span><span>${fmt(s.delivery_fee)}</span></div>` : ''}
      <div class="r-line r-total"><span>المطلوب</span><span>${fmt(s.total)} ${SETTINGS.currency || 'ج'}</span></div>
      <div class="r-line"><span>المدفوع</span><span>${fmt(s.paid)}</span></div>
      ${payLines.length > 1 ? payLines.map(p => `<div class="r-line small"><span>— ${methodNames[p.method] || p.method}</span><span>${fmt(p.amount)}</span></div>`).join('') : ''}
      ${due > 0.001 ? `<div class="r-line" style="color:var(--danger);font-weight:800"><span>المتبقي (آجل على العميل)</span><span>${fmt(due)}</span></div>` : ''}
      <div class="r-line"><span>طريقة الدفع</span><span>${esc(methodName)}</span></div>
      ${loyalty && loyalty.code ? loyaltyBarcodeHtml(loyalty) : ''}
      <div class="r-foot">${esc(SETTINGS.invoice_footer || 'شكراً لتعاملكم معنا')}<br>
        <button class="btn btn-sm mt-10" onclick="smartPrint(receiptHtml(POS.lastSale, POS.lastMethodNames, POS.lastMethodName, POS.lastLoyalty), 'invoice')">🖨️ طباعة</button>
        <button class="btn btn-secondary btn-sm mt-10" onclick="closeModal()">إغلاق</button>
      </div>
    </div>
  `, false);
  const ov = document.getElementById('modalOverlay');
  ov.style.alignItems = 'flex-start';
  ov.style.paddingTop = '30px';
}

/* ==================== Camera barcode scanner ==================== */
function getScanner() { return window.APP_scanner || null; }
function setScanner(s) { window.APP_scanner = s; }

async function openScanner() {
  if (typeof Html5Qrcode === 'undefined') { showAlert('مكتبة الكاميرا غير محملة', 'error'); return; }
  openModal(`
    <div class="modal-head"><h3>📷 قراءة باركود بالكاميرا</h3><button class="modal-close" onclick="closeScanner()">✕</button></div>
    <p class="small muted mb-10">وجه الكاميرا نحو الباركود — سيُضاف المنتج تلقائياً للفاتورة</p>
    <div id="scannerBox" style="width:100%;max-width:420px;margin:0 auto"></div>
    <div class="small muted" style="text-align:center;margin-top:8px" id="scannerStatus">...</div>
    <div class="modal-foot"><button class="btn btn-secondary" onclick="closeScanner()">إغلاق</button></div>
  `, false);
  const s = new Html5Qrcode('scannerBox');
  setScanner(s);
  try {
    await s.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      (decoded) => {
        handleScannedCode(decoded);
      },
      (err) => { document.getElementById('scannerStatus').textContent = 'جاري البحث عن باركود...'; }
    );
  } catch (e) {
    document.getElementById('scannerStatus').innerHTML = `<span class="badge badge-red">تعذر تشغيل الكاميرا: ${esc(e.message)}</span>`;
  }
}

async function handleScannedCode(code) {
  const codeStr = String(code).trim();
  const hit = POS.products.find(p => p.barcode && String(p.barcode) === codeStr);
  if (hit) {
    if (!hit.active) {
      closeScanner();
      showAlert(`⚠️ المنتج "${hit.name}" موقوف حالياً ولا يمكن بيعه`, 'error');
      return;
    }
    POS.addItem(hit);
    closeScanner();
    showAlert('✅ تمت إضافة: ' + hit.name);
  } else {
    try {
      const serialHits = await API.get('/api/serials/search?q=' + encodeURIComponent(codeStr));
      const availSerial = serialHits.find(s => s.status === 'available' && String(s.serial_number).trim().toUpperCase() === codeStr.toUpperCase());
      if (availSerial) {
        const prod = POS.products.find(p => p.id === availSerial.product_id);
        if (prod) {
          if (!prod.active) {
            closeScanner();
            showAlert(`⚠️ المنتج "${prod.name}" موقوف حالياً ولا يمكن بيعه`, 'error');
            return;
          }
          POS.addItemWithSerial(prod, availSerial.serial_number);
          closeScanner();
          showAlert(`✅ تمت إضافة: ${prod.name} بالسيريال ${availSerial.serial_number}`);
          return;
        }
      }
    } catch (e) {}

    const applied = await applyScannedCoupon(codeStr);
    if (!applied) {
      document.getElementById('scannerStatus').innerHTML = `<span class="badge badge-red">الباركود/السيريال ${esc(codeStr)} غير موجود أو غير متوفر — أو كوبون غير صالح</span>`;
    }
  }
}

async function applyScannedCoupon(codeStr) {
  const code = String(codeStr || '').trim();
  if (!code) return false;
  try {
    const res = await API.post('/api/coupons/validate', { code, total: cartTotals().subtotal, party_id: (POS.customer || {}).id || null });
    if (res.valid) {
      const input = document.getElementById('posCoupon');
      if (input) input.value = code.toUpperCase();
      POS.coupon = { code: code.toUpperCase(), discount: res.discount, type: res.coupon.discount_type };
      drawCart();
      closeScanner();
      showAlert('✅ تم تطبيق كوبون الخصم: ' + code.toUpperCase());
      return true;
    }
  } catch (e) {}
  return false;
}

function loyaltyBarcodeHtml(loy) {
  if (!loy || !loy.code) return '';
  const title = loy.issued ? '🎁 مبروك! كوبون ولاء جديد' : '🎁 كوبون الخصم';
  return `
    <div style="border:1px dashed var(--primary);border-radius:10px;padding:12px;margin:12px 0;background:var(--primary-light)">
      <div style="font-weight:800;text-align:center;margin-bottom:6px">${title}: خصم ${loy.discount_type === 'percent' ? loy.value + '%' : fmt(loy.value)}</div>
      <div class="barcode-box" style="margin:4px auto;padding:8px;background:#fff">
        <img src="${barcodeImg(loy.code)}" alt="barcode">
        <div class="code-text">${esc(loy.code)}</div>
      </div>
      <div class="small" style="text-align:center;color:var(--text-muted)">صالح حتى ${fmtDate(loy.expires_at + 'T00:00:00')} — يتجدد يومين مع كل فاتورة جديدة</div>
      <button class="btn btn-sm btn-block mt-10" onclick="openPrintModal(loyaltyLabelHtml(window.APP_loyalty), 'label', 'طباعة باركود الكوبون')">🖨️ طباعة باركود الكوبون</button>
    </div>`;
}

async function closeScanner() {
  const s = getScanner();
  if (s) {
    try { await s.stop(); } catch {}
    try { s.clear(); } catch {}
    setScanner(null);
  }
  closeModal();
}
