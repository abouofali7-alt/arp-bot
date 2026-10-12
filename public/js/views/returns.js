let RETURNS_STATE = { q: '', from: '', to: '' };

async function renderReturns() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-danger flex align-center gap-5" onclick="openReturnByInvoiceModal()">↩️ عمل مرتجع برقم الفاتورة</button>
      <input type="text" id="retSearch" style="width:240px" placeholder="🔍 ابحث برقم المرتجع أو الفاتورة..." oninput="returnsLoad()">
      <input type="date" id="retFrom">
      <input type="date" id="retTo">
      <button class="btn btn-secondary" onclick="returnsLoad()">بحث</button>
      <button class="btn btn-ghost" onclick="returnsReset()">مسح الفلاتر</button>
      <div class="grow"></div>
      <span class="badge badge-orange" id="retCount"></span>
    </div>
    <div class="card">
      <div class="card-title">↩️ المرتجعات</div>
      <div class="table-wrap"><table>
        <thead><tr><th>رقم المرتجع</th><th>الفاتورة الأصلية</th><th>التاريخ</th><th>الكاشير</th><th>الطريقة</th><th class="num">القيمة</th><th></th></tr></thead>
        <tbody id="returnsTable"></tbody>
      </table></div>
    </div>`;
  if (document.getElementById('retSearch')) document.getElementById('retSearch').value = RETURNS_STATE.q || '';
  if (document.getElementById('retFrom')) document.getElementById('retFrom').value = RETURNS_STATE.from || '';
  if (document.getElementById('retTo')) document.getElementById('retTo').value = RETURNS_STATE.to || '';
  returnsLoad();
}

function openReturnByInvoiceModal() {
  openModal(`
    <div class="modal-head"><h3>↩️ عمل مرتجع برقم الفاتورة</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="form-group mt-10">
      <label>أدخل رقم الفاتورة (مثال: INV-20261008-0018 أو 18):</label>
      <div class="flex gap-10 mt-5">
        <input type="text" id="retInvInput" placeholder="أدخل رقم الفاتورة المراد إرجاعها..." style="font-size:1.1rem; padding:8px" onkeydown="if(event.key==='Enter') retFetchByInvoice()">
        <button class="btn btn-primary" onclick="retFetchByInvoice()">🔍 بحث وجلب الفاتورة</button>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
  setTimeout(() => document.getElementById('retInvInput')?.focus(), 100);
}

async function retFetchByInvoice() {
  const invNo = document.getElementById('retInvInput')?.value.trim();
  if (!invNo) { showAlert('يرجى أدخال رقم الفاتورة للبحث', 'error'); return; }
  try {
    const data = await API.get('/api/sales/by-invoice/' + encodeURIComponent(invNo) + '/returnable');
    closeModal();
    returnOpenForm(data.sale.id, data);
  } catch (err) {
    showAlert(err.message || 'الفاتورة غير موجودة أو لا تحتوي أصناف مرتجعة', 'error');
  }
}

async function returnsLoad() {
  const searchEl = document.getElementById('retSearch');
  if (searchEl) RETURNS_STATE.q = searchEl.value.trim();
  const fromEl = document.getElementById('retFrom');
  if (fromEl) RETURNS_STATE.from = fromEl.value;
  const toEl = document.getElementById('retTo');
  if (toEl) RETURNS_STATE.to = toEl.value;

  const params = new URLSearchParams();
  if (RETURNS_STATE.q) params.set('q', RETURNS_STATE.q);
  if (RETURNS_STATE.from) params.set('from', RETURNS_STATE.from);
  if (RETURNS_STATE.to) params.set('to', RETURNS_STATE.to);

  const list = await API.get('/api/returns?' + params.toString());
  document.getElementById('retCount').textContent = list.length + ' مرتجع';
  const methodNames = { cash: 'كاش', card: 'كارت', wallet: 'محفظة', credit: 'خصم من المستحق' };
  document.getElementById('returnsTable').innerHTML = list.map(r => `
    <tr>
      <td class="small"><b>${esc(r.return_no)}</b></td>
      <td class="small">${esc(r.sale_invoice || '—')}</td>
      <td class="small">${fmtDate(r.created_at)}</td>
      <td>${esc(r.cashier)}</td>
      <td>${methodNames[r.refund_method] || r.refund_method}</td>
      <td class="num"><b class="text-danger">${fmt(r.subtotal)}</b></td>
      <td><button class="btn btn-secondary btn-sm" onclick="viewReturn(${r.id})">عرض</button></td>
    </tr>`).join('') || '<tr><td colspan="7"><div class="empty">لا توجد مرتجعات</div></td></tr>';
}

function returnsReset() {
  RETURNS_STATE = { q: '', from: '', to: '' };
  renderReturns();
}

async function viewReturn(id) {
  const r = await API.get('/api/returns/' + id);
  window._retView = r;
  openPrintModal(retReceiptHtml(), 'invoice', 'إشعار مرتجع ' + r.return_no);
}

function retReceiptHtml() {
  const r = window._retView;
  const methodNames = { cash: 'كاش', card: 'كارت', wallet: 'محفظة', credit: 'خصم من المستحق' };
  return [
    `<div class="r-head"><h3>${esc(SETTINGS.store_name || 'سوبر ماركت')}</h3>`,
    `<div>إشعار مرتجع: ${esc(r.return_no)}</div>`,
    `<div>الفاتورة: ${esc(r.sale_invoice || '—')}</div>`,
    `<div>${fmtDate(r.created_at)}</div></div>`,
    `<table><thead><tr><td style="text-align:right"><b>الصنف</b></td><td style="text-align:center"><b>كمية</b></td><td style="text-align:left"><b>إجمالي</b></td></tr></thead><tbody>`,
    ...r.items.map(i => `<tr><td style="text-align:right">${esc(i.name)}</td><td style="text-align:center">${fmt(i.qty)}</td><td style="text-align:left">${fmt(i.total)}</td></tr>`),
    `</tbody></table>`,
    `<div class="r-line r-total"><span>إجمالي المرتجع</span><span>${fmt(r.subtotal)}</span></div>`,
    `<div class="r-line"><span>طريقة الرد</span><span>${methodNames[r.refund_method] || r.refund_method}</span></div>`,
    `<div class="r-foot">${esc(SETTINGS.invoice_footer || 'شكراً لتعاملكم معنا')}</div>`,
  ].join('\n');
}
