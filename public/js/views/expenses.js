const EXP_CATS = { cleaning: '🧹 نظافة', internet: '🌐 إنترنت', maintenance: '🔧 صيانة أجهزة', rent: '🏠 إيجار', utilities: '💡 كهرباء ومياه', other: '📦 أخرى' };
let EXP = { from: '', to: '', category: '' };

async function renderExpenses() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="toolbar">
      <h3 style="flex:1">💸 المصروفات</h3>
      <button class="btn" onclick="expOpenForm()">➕ مصروف جديد</button>
    </div>
    <div class="toolbar">
      <input type="date" id="expFrom">
      <input type="date" id="expTo">
      <select id="expCat"><option value="">كل التصنيفات</option>
        ${Object.entries(EXP_CATS).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
      <button class="btn btn-secondary" onclick="expensesLoad()">عرض</button>
    </div>
    <div id="expResults"><div class="empty" style="padding:60px">حدد الفترة واضغط عرض</div></div>`;
}

async function expensesLoad() {
  EXP.from = document.getElementById('expFrom').value;
  EXP.to = document.getElementById('expTo').value;
  EXP.category = document.getElementById('expCat').value;
  const params = new URLSearchParams();
  if (EXP.from) params.set('from', EXP.from);
  if (EXP.to) params.set('to', EXP.to);
  if (EXP.category) params.set('category', EXP.category);
  const d = await API.get('/api/expenses?' + params);
  window.EXP_DATA = d;
  document.getElementById('expResults').innerHTML = `
    <div class="stat-grid">
      <div class="stat red"><div class="icon">💸</div><div class="label">إجمالي المصروفات</div>
        <div class="value">${fmt(d.total)} <small>${SETTINGS.currency || 'ج'}</small></div>
        <div class="small muted">${d.count} مصروف</div></div>
    </div>
    <div class="card">
      ${d.list.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>التاريخ</th><th>التصنيف</th><th>البيان</th><th>الطريقة</th><th class="num">المبلغ</th><th>المستخدم</th><th></th></tr></thead>
        <tbody>${d.list.map(e => `
          <tr><td class="small">${fmtDate(e.spent_at)}</td><td>${EXP_CATS[e.category] || esc(e.category)}</td>
          <td class="small">${esc(e.note || '—')}</td>
          <td class="small">${{ cash: '💵 كاش', card: '💳 كارت', wallet: '📱 محفظة', transfer: '🏦 تحويل' }[e.method] || 'كاش'}</td>
          <td class="num"><b class="text-danger">${fmt(e.amount)}</b></td>
          <td class="small">${esc(e.user_name || '—')}</td>
          <td><button class="btn btn-danger btn-sm" onclick="expDelete(${e.id})">🗑️</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">لا توجد مصروفات في هذه الفترة</div>'}
    </div>`;
}

function expOpenForm() {
  openModal(`
    <div class="modal-head"><h3>➕ مصروف جديد</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="grid-2">
      <div class="form-group"><label>التصنيف *</label>
        <select id="exCat">${Object.entries(EXP_CATS).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>
      <div class="form-group"><label>المبلغ * (${SETTINGS.currency || 'ج'})</label><input type="number" id="exAmount" min="0" step="0.01"></div>
      <div class="form-group"><label>طريقة الدفع</label>
        <select id="exMethod">
          <option value="cash">💵 كاش (من الدرج)</option>
          <option value="card">💳 كارت</option>
          <option value="wallet">📱 محفظة</option>
          <option value="transfer">🏦 تحويل بنكي</option>
        </select></div>
    </div>
    <div class="form-group"><label>البيان / ملاحظة</label><input id="exNote" placeholder="مثال: فاتورة انترنت شهر 8"></div>
    <div class="form-group"><label>تاريخ الصرف</label><input type="date" id="exDate" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="modal-foot"><button class="btn" onclick="expSave()">حفظ</button><button class="btn btn-secondary" onclick="closeModal()">إلغاء</button></div>
  `);
}

async function expSave() {
  const amount = Number(document.getElementById('exAmount').value);
  if (!amount || amount <= 0) { showAlert('أدخل مبلغاً صحيحاً', 'error'); return; }
  try {
    await API.post('/api/expenses', {
      category: document.getElementById('exCat').value,
      amount,
      note: document.getElementById('exNote').value.trim(),
      spent_at: document.getElementById('exDate').value || undefined,
      method: document.getElementById('exMethod')?.value || 'cash',
    });
    closeModal();
    showAlert('تم تسجيل المصروف');
    if (document.getElementById('expResults')) expensesLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function expDelete(id) {
  if (!confirm('حذف هذا المصروف؟')) return;
  try {
    await API.del('/api/expenses/' + id);
    showAlert('تم الحذف');
    expensesLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}
