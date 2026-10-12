let SALES = { q: '', from: '', to: '', user: '', branch: '' };

async function renderSales() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="toolbar">
      <input type="text" id="sSearch" style="width:240px" placeholder="🔍 ابحث برقم الفاتورة أو العميل..." oninput="salesLoad()">
      <input type="date" id="sFrom">
      <input type="date" id="sTo">
      <button class="btn btn-secondary" onclick="salesLoad()">بحث</button>
      <button class="btn btn-ghost" onclick="salesReset()">مسح الفلاتر</button>
      <div class="grow"></div>
      <span class="badge badge-blue" id="salesCount"></span>
    </div>
    <div class="card">
      <div class="card-title">🧾 فواتير البيع</div>
      <div class="table-wrap"><table>
        <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>العميل</th><th>الكاشير</th><th>الفرع</th><th class="num">الإجمالي</th><th class="num">المدفوع</th><th>الطريقة</th><th></th></tr></thead>
        <tbody id="salesTable"></tbody>
      </table></div>
    </div>`;
  const users = await API.get('/api/users').catch(() => []);
  if (document.getElementById('sSearch')) document.getElementById('sSearch').value = SALES.q || '';
  document.getElementById('sFrom').value = SALES.from;
  document.getElementById('sTo').value = SALES.to;
  salesLoad();
}

async function salesLoad() {
  const searchEl = document.getElementById('sSearch');
  if (searchEl) SALES.q = searchEl.value.trim();
  SALES.from = document.getElementById('sFrom').value;
  SALES.to = document.getElementById('sTo').value;
  const params = new URLSearchParams();
  if (SALES.q) params.set('q', SALES.q);
  if (SALES.from) params.set('from', SALES.from);
  if (SALES.to) params.set('to', SALES.to);
  const list = await API.get('/api/sales?' + params.toString());
  document.getElementById('salesCount').textContent = list.length + ' فاتورة';
  document.getElementById('salesTable').innerHTML = list.map(s => `
    <tr>
      <td class="small"><b>${esc(s.invoice_no)}</b></td>
      <td class="small">${fmtDate(s.created_at)}</td>
      <td class="small">${s.customer_name ? esc(s.customer_name) + (s.customer_phone ? `<div class="muted" dir="ltr" style="text-align:left">${esc(s.customer_phone)}</div>` : '') : '—'}</td>
      <td>${esc(s.cashier)}</td>
      <td class="small">${esc(s.branch_name || '—')}</td>
      <td class="num"><b>${fmt(s.total)}</b></td>
      <td class="num">${fmt(s.paid)}</td>
      <td>${payBadge(s.payment_method)}</td>
      <td><div class="flex" style="gap:4px">
        <button class="btn btn-secondary btn-sm" onclick="viewSale(${s.id})">عرض</button>
        ${isAdminUser() ? `<button class="btn btn-warning btn-sm" onclick="editSale(${s.id})" title="تعديل الفاتورة">✏️</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="returnOpenForm(${s.id})">مرتجع</button>
      </div></td>
    </tr>`).join('') || '<tr><td colspan="9"><div class="empty">لا توجد فواتير</div></td></tr>';
}

function salesReset() {
  SALES = { q: '', from: '', to: '', user: '', branch: '' };
  renderSales();
}

function payBadge(m) {
  const map = { cash: ['كاش', 'badge-green'], card: ['كارت', 'badge-blue'], wallet: ['محفظة', 'badge-orange'], credit: ['آجل', 'badge-red'], mixed: ['متعدد', 'badge-gray'] };
  const [label, cls] = map[m] || [m, 'badge-gray'];
  return `<span class="badge ${cls}">${label}</span>`;
}

async function viewSale(id) {
  const s = await API.get('/api/sales/' + id);
  const methodNames = { cash: 'كاش', card: 'كارت', wallet: 'محفظة', credit: 'آجل', mixed: 'متعدد' };
  const methodName = methodNames[s.payment_method] || s.payment_method;
  let payLines = [];
  try { payLines = JSON.parse(s.payments_json || 'null') || []; } catch {}
  const fullMethodName = payLines.length > 1 ? payLines.map(p => `${methodNames[p.method] || p.method} ${fmt(p.amount)}`).join(' + ') : methodName;
  openPrintModal(receiptHtml(s, methodNames, fullMethodName, null), 'invoice', 'فاتورة ' + s.invoice_no);
}

/* ==================== تعديل فاتورة بيع (أدمن) ==================== */
async function editSale(id) {
  const [s, products] = await Promise.all([
    API.get('/api/sales/' + id),
    API.get('/api/products').catch(() => []),
  ]);
  window._SE = {
    s,
    items: s.items.map(i => {
      const stock = Number(products.find(p => p.id === i.product_id)?.stock) || 0;
      return { product_id: i.product_id, name: i.name, qty: Number(i.qty), price: Number(i.price), max: Number(i.qty) + Math.max(0, stock) };
    }),
  };
  openModal(`
    <div class="modal-head"><h3>✏️ تعديل فاتورة ${esc(s.invoice_no)}${s.customer_name ? ' — ' + esc(s.customer_name) : ''}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <p class="small muted mb-10">عدّل الكميات والأسعار — المخزون وحساب العميل يتحدثون تلقائياً عند الحفظ</p>
    <div class="table-wrap"><table>
      <thead><tr><th>الصنف</th><th class="num">الكمية</th><th class="num">السعر</th><th class="num">إجمالي</th><th></th></tr></thead>
      <tbody id="seItemsBody"></tbody>
    </table></div>
    <div class="toolbar mt-10">
      <div class="form-group" style="margin:0;flex:1"><label class="small muted">الخصم</label><input type="number" id="seDiscount" step="0.01" min="0" value="${Number(s.discount)}" oninput="seRecalc()"></div>
      <div class="form-group" style="margin:0;flex:1"><label class="small muted">المدفوع</label><input type="number" id="sePaid" step="0.01" min="0" value="${Number(s.paid)}" oninput="seRecalc()"></div>
    </div>
    <div id="seTotals" class="card mt-10" style="padding:10px"></div>
    <div id="seWarn"></div>
    <div class="modal-foot">
      <button class="btn" onclick="seSave()">💾 حفظ التعديلات</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `, true);
  seRedraw();
}

function seRedraw() {
  const body = document.getElementById('seItemsBody');
  if (!body) return;
  body.innerHTML = window._SE.items.map((i, idx) => `
    <tr>
      <td><b>${esc(i.name)}</b></td>
      <td class="num"><input type="number" style="width:80px" min="0.01" max="${i.max}" step="0.01" value="${i.qty}" onchange="seSetQty(${idx}, this.value)"></td>
      <td class="num"><input type="number" style="width:100px" min="0" step="0.01" value="${i.price}" onchange="seSetPrice(${idx}, this.value)"></td>
      <td class="num">${fmt(i.qty * i.price)}</td>
      <td><button class="cremove" style="background:none;border:none;color:var(--danger);cursor:pointer" onclick="seRemove(${idx})">🗑️</button></td>
    </tr>`).join('') || '<tr><td colspan="5"><div class="empty">لا توجد أصناف</div></td></tr>';
  seRecalc();
}

window.seSetQty = function (idx, v) {
  const it = window._SE.items[idx];
  if (!it) return;
  let q = Number(v);
  if (isNaN(q) || q <= 0) q = 0.01;
  if (q > it.max) { q = it.max; showAlert(`أقصى كمية متاحة لـ "${it.name}" هي ${fmt(it.max)}`, 'error'); }
  it.qty = q;
  seRedraw();
};

window.seSetPrice = function (idx, v) {
  const it = window._SE.items[idx];
  if (!it) return;
  let p = Number(v);
  if (isNaN(p) || p < 0) p = 0;
  it.price = p;
  seRecalc();
  const row = document.querySelectorAll('#seItemsBody tr')[idx];
  if (row) row.cells[3].textContent = fmt(it.qty * it.price);
};

window.seRemove = function (idx) {
  window._SE.items.splice(idx, 1);
  seRedraw();
};

function seRecalc() {
  const box = document.getElementById('seTotals');
  if (!box) return;
  const s = window._SE.s;
  const sub = window._SE.items.reduce((t, i) => t + i.qty * i.price, 0);
  let d = Number(document.getElementById('seDiscount')?.value) || 0;
  d = Math.max(0, Math.min(d, sub));
  const fee = Number(s.delivery_fee) || 0;
  const total = round2s(sub - d + fee);
  let paid = Number(document.getElementById('sePaid')?.value) || 0;
  paid = Math.max(0, paid);
  const due = Math.max(0, round2s(total - paid));
  const change = Math.max(0, round2s(paid - total));
  box.innerHTML = `
    <div class="r-line small"><span>الإجمالي قبل الخصم</span><span>${fmt(round2s(sub))}</span></div>
    ${fee > 0 ? `<div class="r-line small"><span>🛵 توصيل</span><span>${fmt(fee)}</span></div>` : ''}
    <div class="r-line r-total"><span>المطلوب الجديد</span><span>${fmt(total)}</span></div>
    <div class="r-line small"><span>المدفوع</span><span>${fmt(paid)}</span></div>
    ${due > 0.001 ? `<div class="r-line small" style="color:var(--danger);font-weight:800"><span>المتبقي (آجل على العميل)</span><span>${fmt(due)}</span></div>` : ''}
    ${change > 0.001 ? `<div class="r-line small" style="color:var(--success)"><span>الباقي للعميل</span><span>${fmt(change)}</span></div>` : ''}
  `;
  const warn = document.getElementById('seWarn');
  warn.innerHTML = (due > 0.001 && !s.party_id)
    ? '<div class="alert error mt-10">الفاتورة بدون عميل مسجل — لا يمكن ترك متبقي؛ أكمل المدفوع أو زوّد قيمة الفاتورة أقل من المدفوع</div>'
    : (due > 0.001 && s.customer_name ? `<div class="small muted mt-10">سيُضاف ${fmt(due)} إلى مديونية ${esc(s.customer_name)}</div>` : '');
}

function round2s(n) { return Math.round(n * 100) / 100; }

async function seSave() {
  const items = window._SE.items.filter(i => i.qty > 0).map(i => ({ product_id: i.product_id, qty: i.qty, price: i.price }));
  if (items.length === 0) { showAlert('لا يمكن حفظ فاتورة فارغة', 'error'); return; }
  try {
    await API.put('/api/sales/' + window._SE.s.id + '/edit', {
      items,
      discount: Number(document.getElementById('seDiscount')?.value) || 0,
      paid: document.getElementById('sePaid')?.value ?? '',
    });
    closeModal();
    showAlert('تم تعديل الفاتورة وتحديث المخزون وحساب العميل');
    salesLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function returnOpenForm(saleId, preloadedData = null) {
  const data = preloadedData || await API.get('/api/sales/' + saleId + '/returnable');
  const items = data.items.filter(i => i.max_returnable > 0);
  if (items.length === 0) { showAlert('لا توجد أصناف قابلة للإرجاع في هذه الفاتورة', 'error'); return; }
  window._RET = { saleId: data.sale.id, items };
  const unpaid = Number(data.sale.total) - Number(data.sale.paid);
  const showCredit = data.sale.party_id && unpaid > 0.001;
  openModal(`
    <div class="modal-head"><h3>↩️ مرتجع فاتورة ${esc(data.sale.invoice_no)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <p class="small muted mb-10">حدد الكمية والمرتجع لكل صنف — ستُعاد السيريالات تلقائياً للمخزون المتاح</p>
    <div class="table-wrap"><table>
      <thead><tr><th>الصنف</th><th class="num">المباع</th><th class="num">المرتجع سابقاً</th><th class="num">المتبقي</th><th class="num">سعر المرتجع</th><th class="num">الكمية للإرجاع</th></tr></thead>
      <tbody>${items.map((i, idx) => `
        <tr>
          <td>
            <b>${esc(i.name)}</b>${(Number(i.refund_price) < i.price) ? '<span class="small muted"> (بعد خصم الكوبون)</span>' : ''}
            ${(i.has_serials === 1 && i.sold_serials && i.sold_serials.length > 0) ? `
              <div class="mt-5 text-start" style="font-size:0.85rem">
                <span class="text-blue bold">🔢 اختر السيريالات المرجعة:</span>
                <div class="flex flex-wrap gap-5 mt-5">
                  ${i.sold_serials.map(sn => `
                    <label class="badge badge-gray flex align-center gap-5 cursor-pointer" style="padding:4px 8px">
                      <input type="checkbox" class="ret-sn-cb-${idx}" value="${esc(sn)}" onchange="retSyncSerials(${idx})">
                      <span>${esc(sn)}</span>
                    </label>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </td>
          <td class="num">${fmt(i.sold_qty)}</td>
          <td class="num">${fmt(i.returned_qty)}</td>
          <td class="num">${fmt(i.max_returnable)}</td>
          <td class="num"><input type="number" min="0" max="${i.price}" step="0.01" value="${Number(i.refund_price).toFixed(2)}" style="width:90px" id="retPrice_${idx}" oninput="retClampPrice(${idx}); retCalcTotal()" title="قابل للتعديل — بحد أقصى سعر البيع ${fmt(i.price)}"></td>
          <td class="num"><input type="number" min="0" max="${i.max_returnable}" value="0" step="0.01" style="width:90px" id="retQty_${idx}" ${i.has_serials === 1 ? 'readonly' : ''} oninput="retCalcTotal()"></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    <div class="form-group mt-10"><label>طريقة رد المبلغ</label>
      <select id="retMethod">
        <option value="cash">💵 كاش</option>
        <option value="card">💳 كارت</option>
        <option value="wallet">📱 محفظة</option>
        ${showCredit ? '<option value="credit">💼 الخصم من المستحق على العميل</option>' : ''}
      </select>
    </div>
    <div class="flex-between mt-10"><span class="small">إجمالي المرتجع</span><b style="font-size:1.2rem" id="retTotal">0.00</b></div>
    <div class="modal-foot">
      <button class="btn btn-danger" onclick="returnSave()">↩️ تنفيذ المرتجع</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `, true);
  retCalcTotal();
}

function retSyncSerials(idx) {
  const cbs = document.querySelectorAll(`.ret-sn-cb-${idx}:checked`);
  const qtyInp = document.getElementById('retQty_' + idx);
  if (qtyInp) {
    qtyInp.value = cbs.length;
  }
  retCalcTotal();
}

function retClampPrice(idx) {
  const i = window._RET.items[idx];
  const inp = document.getElementById('retPrice_' + idx);
  if (!inp || !i) return;
  let v = Number(inp.value);
  if (isNaN(v) || v < 0) { inp.value = Number(i.refund_price).toFixed(2); return; }
  if (v > i.price) { inp.value = Number(i.price).toFixed(2); showAlert(`سعر المرتجع لا يمكن أن يتخطى سعر البيع في الفاتورة (${fmt(i.price)})`, 'error'); }
}

function retCalcTotal() {
  const items = window._RET.items;
  let total = 0;
  items.forEach((i, idx) => {
    const q = Number(document.getElementById('retQty_' + idx)?.value) || 0;
    const max = i.max_returnable;
    let price = Number(document.getElementById('retPrice_' + idx)?.value);
    if (isNaN(price) || price < 0) price = i.refund_price;
    if (price > i.price) price = i.price;
    if (q > max) { document.getElementById('retQty_' + idx).value = max; total += max * price; }
    else total += q * price;
  });
  document.getElementById('retTotal').textContent = fmt(total);
}

async function returnSave() {
  const items = window._RET.items;
  const payload = [];
  let errorMsg = null;

  items.forEach((i, idx) => {
    if (errorMsg) return;
    const q = Number(document.getElementById('retQty_' + idx)?.value) || 0;
    if (q > 0) {
      let price = Number(document.getElementById('retPrice_' + idx)?.value);
      if (isNaN(price) || price <= 0) price = i.refund_price;
      if (price > i.price + 0.001) {
        errorMsg = `مرفوض: سعر المرتجع لـ "${i.name}" لا يمكن أن يتخطى سعر البيع في الفاتورة (${fmt(i.price)})`;
        document.getElementById('retPrice_' + idx).value = Number(i.price).toFixed(2);
        retCalcTotal();
        return;
      }
      let serials = [];
      if (i.has_serials === 1) {
        const checkedCbs = Array.from(document.querySelectorAll(`.ret-sn-cb-${idx}:checked`)).map(c => c.value);
        if (checkedCbs.length !== q) {
          errorMsg = `مطلوب تحديد ${q} سيريالات للإرجاع لـ "${i.name}" (المحدد: ${checkedCbs.length})`;
          return;
        }
        serials = checkedCbs;
      }
      payload.push({ product_id: i.product_id, qty: q, price, serials });
    }
  });

  if (errorMsg) { showAlert(errorMsg, 'error'); return; }
  if (payload.length === 0) { showAlert('حدد كمية أو سيريالات للإرجاع على الأقل', 'error'); return; }

  try {
    const r = await API.post('/api/sales/' + window._RET.saleId + '/return', {
      items: payload,
      refund_method: document.getElementById('retMethod').value,
    });
    closeModal();
    showAlert(`تم تنفيذ المرتجع ${r.return_no} بقيمة ${r.subtotal.toFixed(2)} وإعادة المخزون والسيريالات للمخزون المتاح ✅`);
    if (r.return_id) viewReturn(r.return_id);
    if (typeof salesLoad === 'function') salesLoad();
    if (typeof returnsLoad === 'function') returnsLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}
