const PARTNER_STATUS = {
  ok: { label: '✅ آمن', bg: 'var(--ok-bg,#e8f5e9)', fg: '#1b5e20' },
  near: { label: '⚠️ قارب النصيب', bg: '#fff3e0', fg: '#a15c00' },
  exceeded: { label: '🚨 تجاوز نصيبه', bg: '#fdecea', fg: '#b71c1c' },
};
const TXN_METHODS = { cash: '💵 كاش', card: '💳 فيزا/شبكة', wallet: '📱 محفظة', transfer: '🏦 تحويل بنكي' };

async function renderAccounting() {
  const el = document.getElementById('viewContainer');
  const cur = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 7);
  el.innerHTML = `
    <div class="toolbar">
      <h3 style="flex:1">🧮 حسابات الشركاء ورأس المال</h3>
      <button class="btn" onclick="prtOpenForm()">➕ شريك جديد</button>
    </div>
    <div class="toolbar">
      <label class="small muted">شهر كشف الأرباح:</label>
      <input type="month" id="accMonth" value="${cur}">
      <button class="btn btn-secondary" onclick="accountingLoad()">تحديث</button>
      <span class="small muted" style="flex:1">الصافي = أرباح المبيعات − المرتجعات − المصروفات − مرتبات الموظفين</span>
    </div>
    <div id="accAlerts"></div>
    <div id="accContent"><div class="empty" style="padding:60px">جارِ التحميل…</div></div>`;
  accountingLoad();
}

async function accountingLoad() {
  const month = document.getElementById('accMonth').value;
  let st, pl;
  try {
    st = await API.get('/api/partners/statement?month=' + encodeURIComponent(month));
    pl = await API.get('/api/partners');
  } catch (e) { showAlert(e.message, 'error'); return; }
  const C = SETTINGS.currency || 'ج';
  const byId = {}; for (const p of pl.partners) byId[p.id] = p;
  const totalCapCash = pl.partners.reduce((s, p) => s + (p.capital_cash || 0), 0);
  const totalCapGoods = pl.partners.reduce((s, p) => s + (p.capital_goods || 0), 0);
  const totalOutMonth = st.partners.reduce((s, p) => s + p.month_out, 0);

  document.getElementById('accAlerts').innerHTML = st.alerts.map(a => `
    <div class="card" style="border-right:5px solid ${a.level === 'danger' ? '#d32f2f' : '#ef6c00'};background:${a.level === 'danger' ? '#fdecea' : '#fff3e0'};margin-bottom:10px;padding:12px 16px">
      <b>${a.level === 'danger' ? '🚨 تحذير تجاوز:' : '⚠️ تنبيه:'}</b> ${esc(a.msg)}
    </div>`).join('');

  const pctBadge = st.partners_total_percent > 100.001
    ? `<span style="background:#fdecea;color:#b71c1c;padding:4px 12px;border-radius:14px;font-weight:bold">⚠️ مجموع النسب ${st.partners_total_percent}%</span>`
    : `<span class="small muted">مجموع النسب: ${st.partners_total_percent}%</span>`;

  document.getElementById('accContent').innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="icon">📈</div><div class="label">أرباح مبيعات ${st.month}</div><div class="value">${fmt(st.period.sales_profit)} <small>${C}</small></div></div>
      <div class="stat red"><div class="icon">↩️</div><div class="label">خسارة أرباح المرتجعات</div><div class="value">${fmt(st.period.returns_profit_loss)} <small>${C}</small></div><div class="small muted">قيمة المرتجعات: ${fmt(st.period.returns)} ${C} — بيخصم ربح المنتج المرتجع فقط</div></div>
      <div class="stat red"><div class="icon">💸</div><div class="label">مصروفات</div><div class="value">${fmt(st.period.expenses)} <small>${C}</small></div></div>
      <div class="stat red"><div class="icon">👷</div><div class="label">مرتبات الموظفين</div><div class="value">${fmt(st.period.salaries)} <small>${C}</small></div><div class="small muted">${st.period.salaries_detail.filter(e => e.amount > 0).length} موظف</div></div>
      <div class="stat ${st.period.net >= 0 ? 'green' : 'red'}"><div class="icon">${st.period.net >= 0 ? '💰' : '📉'}</div><div class="label">صافي ربح الفترة</div><div class="value">${fmt(st.period.net)} <small>${C}</small></div></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="icon">💵</div><div class="label">رأس مال نقدي</div><div class="value">${fmt(totalCapCash)} <small>${C}</small></div></div>
      <div class="stat"><div class="icon">📦</div><div class="label">رأس مال بضاعة</div><div class="value">${fmt(totalCapGoods)} <small>${C}</small></div></div>
      <div class="stat green"><div class="icon">🏦</div><div class="label">إجمالي رأس المال</div><div class="value">${fmt(totalCapCash + totalCapGoods)} <small>${C}</small></div></div>
      <div class="stat red"><div class="icon">📤</div><div class="label">تحويلات للشركاء (${st.month})</div><div class="value">${fmt(totalOutMonth)} <small>${C}</small></div></div>
    </div>
    <div class="card mt-10">
      <div class="toolbar" style="padding:0 0 10px"><h3 style="flex:1">💧 الأموال السائلة الحالية وتوزيعها</h3>
        <button class="btn btn-sm" onclick="accSaveLiquid()">💾 حفظ الأرصدة</button></div>
      <div class="grid-2">
        ${Object.entries(TXN_METHODS).map(([k, label]) => `
          <div class="form-group"><label>${label} (${C})</label>
            <input type="number" id="liq_${k}" min="0" step="0.01" value="${Number(st.liquid[k]) || 0}"></div>`).join('')}
        <div class="form-group"><label><b>الإجمالي</b></label>
          <input value="${fmt(st.liquid_total)} ${C}" disabled></div>
        <div class="form-group" style="grid-column:1/-1">
          <label>التوزيع على الشركاء حسب نسبهم:</label>
          <div class="table-wrap"><table>
            <thead><tr><th>الشريك</th><th class="num">النسبة</th><th class="num">حصته من السائل (${C})</th></tr></thead>
            <tbody>${st.liquid_distribution.map(d => `<tr><td>${esc(d.name)}</td><td class="num">${d.profit_percent}%</td><td class="num"><b>${fmt(d.share)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="empty">لا يوجد شركاء</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="toolbar" style="padding:0 0 10px"><h3 style="flex:1">👨‍💼 الشركاء</h3>${pctBadge}</div>
      ${st.partners.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>الشريك</th><th class="num">النسبة</th><th class="num">رأس المال (نقدي)</th><th class="num">رأس المال (بضاعة)</th><th class="num">توريد الشهر</th><th class="num">تحويلات إليه</th><th class="num">نصيبه من الربح</th><th class="num">المتبقي له</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${st.partners.map(p => {
          const meta = PARTNER_STATUS[p.status] || PARTNER_STATUS.ok;
          const cap = byId[p.id] || {};
          return `<tr>
            <td><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="muted small">(موقوف)</span>'}<div class="small muted">${esc(p.phone || '')}</div></td>
            <td class="num">${p.profit_percent}%</td>
            <td class="num">${fmt(cap.capital_cash || 0)}</td>
            <td class="num">${fmt(cap.capital_goods || 0)}</td>
            <td class="num text-success">+${fmt(p.month_in)}</td>
            <td class="num text-danger">−${fmt(p.month_out)}</td>
            <td class="num"><b>${fmt(p.share)}</b></td>
            <td class="num">${p.remaining_share < 0 ? `<b class="text-danger">${fmt(p.remaining_share)}</b>` : fmt(p.remaining_share)}</td>
            <td><span style="background:${meta.bg};color:${meta.fg};padding:3px 10px;border-radius:12px;font-size:12px;white-space:nowrap">${meta.label}${p.status !== 'ok' && p.used_pct != null ? ` (${p.used_pct}%)` : ''}</span></td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm" onclick="accOpenTxn(${p.id},'in')" title="توريد رأس مال">📥</button>
              <button class="btn btn-sm" onclick="accOpenTxn(${p.id},'out')" title="تحويل إليه">📤</button>
              <button class="btn btn-secondary btn-sm" onclick="accStatement(${p.id})" title="كشف الحساب">📋</button>
              <button class="btn btn-secondary btn-sm" onclick="prtOpenForm(${p.id})" title="تعديل">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="accDeletePartner(${p.id}, '${esc(p.name)}')" title="حذف الشريك">🗑️</button>
            </td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">لا يوجد شركاء — ابدأ بإضافة شريك وتحديد نسبته ونسبة رأس ماله</div>'}
    </div>`;
}

async function prtOpenForm(id) {
  if (!window._ACC_PARTNERS) {
    try { window._ACC_PARTNERS = (await API.get('/api/partners')).partners; } catch {}
  }
  const editing = id ? (window._ACC_PARTNERS || []).find(p => p.id === id) : null;
  const C = SETTINGS.currency || 'ج';
  openModal(`
    <div class="modal-head"><h3>${editing ? '✏️ تعديل شريك' : '➕ شريك جديد'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="grid-2">
      <div class="form-group"><label>اسم الشريك *</label><input id="ptName" value="${editing ? esc(editing.name) : ''}" placeholder="اسم الشريك"></div>
      <div class="form-group"><label>الهاتف</label><input id="ptPhone" value="${editing ? esc(editing.phone || '') : ''}"></div>
      <div class="form-group"><label>نسبة الربح % *</label><input type="number" id="ptPercent" min="0" max="100" step="0.01" value="${editing ? editing.profit_percent : ''}" placeholder="مثال: 40"></div>
      <div class="form-group"><label>الحالة</label><select id="ptActive"><option value="1" ${!editing || editing.active ? 'selected' : ''}>نشط</option><option value="0" ${editing && !editing.active ? 'selected' : ''}>موقوف</option></select></div>
      ${!editing ? `
        <div class="form-group"><label>رأس المال النقدي الأولي (${C})</label><input type="number" id="ptCapCash" min="0" step="0.01" value="0" placeholder="0.00"></div>
        <div class="form-group"><label>رأس المال بضاعة الأولي (${C})</label><input type="number" id="ptCapGoods" min="0" step="0.01" value="0" placeholder="0.00"></div>
      ` : ''}
    </div>
    <div class="form-group"><label>ملاحظات</label><input id="ptNotes" value="${editing ? esc(editing.notes || '') : ''}"></div>
    <div class="modal-foot"><button class="btn" onclick="prtSave(${id || 0})">حفظ</button><button class="btn btn-secondary" onclick="closeModal()">إلغاء</button></div>
  `);
}

async function prtSave(id) {
  const body = {
    name: document.getElementById('ptName').value.trim(),
    phone: document.getElementById('ptPhone').value.trim(),
    profit_percent: Number(document.getElementById('ptPercent').value),
    notes: document.getElementById('ptNotes').value.trim(),
    active: document.getElementById('ptActive').value === '1',
  };
  if (!id) {
    body.capital_cash = Number(document.getElementById('ptCapCash')?.value) || 0;
    body.capital_goods = Number(document.getElementById('ptCapGoods')?.value) || 0;
  }
  if (!body.name) { showAlert('أدخل اسم الشريك', 'error'); return; }
  try {
    if (id) await API.put('/api/partners/' + id, body);
    else await API.post('/api/partners', body);
    closeModal(); showAlert('تم الحفظ'); window._ACC_PARTNERS = null; accountingLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function accDeletePartner(id, name) {
  if (!confirm(`هل أنت تأكد من حذف الشريك "${name}"؟`)) return;
  try {
    await API.del('/api/partners/' + id);
    showAlert('تم حذف الشريك بنجاح');
    window._ACC_PARTNERS = null;
    accountingLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function accSaveLiquid() {
  const body = {};
  for (const k of Object.keys(TXN_METHODS)) body[k] = Number(document.getElementById('liq_' + k).value) || 0;
  try {
    await API.put('/api/partners/liquid', body);
    showAlert('تم حفظ الأرصدة السائلة');
    accountingLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

function accOpenTxn(partnerId, type) {
  const p = (window._ACC_PARTNERS || []).find(x => x.id === partnerId);
  openModal(`
    <div class="modal-head"><h3>${type === 'in' ? '📥 توريد رأس مال —' : '📤 تحويل إليه —'} ${p ? esc(p.name) : ''}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    ${type === 'out' && p && p.profit_percent > 0 ? `<div class="small muted" style="margin-bottom:8px">نسبة ${esc(p.name)} من الأرباح: <b>${p.profit_percent}%</b> — التحويلات تُخصم من نصيبه وسيظهر تحذير عند التجاوز</div>` : ''}
    <div class="grid-2">
      <div class="form-group"><label>نوع القيمة *</label>
        <select id="txKind"><option value="cash">💵 أموال نقدية داخل المشروع</option><option value="goods">📦 بضاعة / عينات</option></select></div>
      <div class="form-group"><label>القيمة * (${SETTINGS.currency || 'ج'})</label><input type="number" id="txAmount" min="0" step="0.01"></div>
      <div class="form-group"><label>طريقة ${type === 'in' ? 'التوريد' : 'التحويل'} *</label>
        <select id="txMethod">${Object.entries(TXN_METHODS).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>
      <div class="form-group"></div>
    </div>
    <div class="form-group"><label>البيان / ملاحظة</label><input id="txNote" placeholder="${type === 'in' ? 'مثال: توريد أول المشروع — لابتوبات' : 'مثال: سحب من نصيب الشهر عبر محفظة'}"></div>
    <div class="modal-foot"><button class="btn" onclick="accSaveTxn(${partnerId},'${type}')">حفظ</button><button class="btn btn-secondary" onclick="closeModal()">إلغاء</button></div>
  `);
}

async function accSaveTxn(partnerId, type) {
  const amount = Number(document.getElementById('txAmount').value);
  if (!amount || amount <= 0) { showAlert('أدخل قيمة صحيحة', 'error'); return; }
  try {
    await API.post(`/api/partners/${partnerId}/txns`, {
      type,
      kind: document.getElementById('txKind').value,
      method: document.getElementById('txMethod').value,
      amount,
      note: document.getElementById('txNote').value.trim(),
    });
    closeModal(); showAlert('تم تسجيل الحركة'); window._ACC_PARTNERS = null; accountingLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function accStatement(partnerId) {
  let d;
  try { d = await API.get('/api/partners/' + partnerId + '/txns'); } catch (e) { showAlert(e.message, 'error'); return; }
  const p = d.partner;
  const sum = (t, k) => d.txns.filter(x => x.type === t && x.kind === k).reduce((s, x) => s + x.amount, 0);
  const inCash = sum('in', 'cash'), inGoods = sum('in', 'goods'), outAll = sum('out', 'cash') + sum('out', 'goods');
  const KIND = { cash: '💵 نقدي', goods: '📦 بضاعة' };
  openModal(`
    <div class="modal-head"><h3>📋 كشف حساب: ${esc(p.name)} (${p.profit_percent}%)</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="stat-grid">
      <div class="stat"><div class="icon">💵</div><div class="label">رأس مال نقدي</div><div class="value">${fmt(inCash)}</div></div>
      <div class="stat"><div class="icon">📦</div><div class="label">رأس مال بضاعة</div><div class="value">${fmt(inGoods)}</div></div>
      <div class="stat green"><div class="icon">🏦</div><div class="label">صافي رأس المال</div><div class="value">${fmt(inCash + inGoods - outAll)}</div></div>
      <div class="stat red"><div class="icon">📤</div><div class="label">تحويلات إليه (كل الفترات)</div><div class="value">${fmt(outAll)}</div></div>
    </div>
    ${d.txns.length ? `
    <div class="table-wrap" style="max-height:340px;overflow:auto"><table>
      <thead><tr><th>التاريخ</th><th>النوع</th><th>القيمة</th><th>الطريقة</th><th class="num">المبلغ</th><th>البيان</th><th></th></tr></thead>
      <tbody>${d.txns.map(t => `<tr>
        <td class="small">${fmtDate(t.created_at)}</td>
        <td>${t.type === 'in' ? '<b class="text-success">توريد ↓</b>' : '<b class="text-danger">تحويل إليه ↑</b>'}</td>
        <td class="small">${KIND[t.kind] || t.kind}</td>
        <td class="small">${TXN_METHODS[t.method] || '💵 كاش'}</td>
        <td class="num"><b>${t.type === 'in' ? '+' : '−'}${fmt(t.amount)}</b></td>
        <td class="small">${esc(t.note || '—')}</td>
        <td><button class="btn btn-danger btn-sm" onclick="accDelTxn(${t.id},${p.id})">🗑️</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">لا توجد حركات بعد</div>'}
    <div class="modal-foot">
      <button class="btn" onclick="accPrintStatement(${p.id})">🖨️ طباعة كشف الحساب</button>
      <button class="btn btn-secondary" onclick="closeModal()">إغلاق</button>
    </div>
  `);
}

async function accDelTxn(txnId, partnerId) {
  if (!confirm('حذف هذه الحركة؟')) return;
  try { await API.del('/api/partners/txn/' + txnId); showAlert('تم الحذف'); closeModal(); window._ACC_PARTNERS = null; accountingLoad(); }
  catch (e) { showAlert(e.message, 'error'); }
}

async function accPrintStatement(partnerId) {
  let d;
  try { d = await API.get('/api/partners/' + partnerId + '/txns'); } catch (e) { showAlert(e.message, 'error'); return; }
  const p = d.partner;
  const storeName = (typeof SETTINGS !== 'undefined' && SETTINGS.store_name) || 'نظام المحل التجاري';
  const C = (typeof SETTINGS !== 'undefined' && SETTINGS.currency) || 'ج';
  const sum = (t, k) => d.txns.filter(x => x.type === t && x.kind === k).reduce((s, x) => s + x.amount, 0);
  const inCash = sum('in', 'cash'), inGoods = sum('in', 'goods'), outAll = sum('out', 'cash') + sum('out', 'goods');
  const KIND = { cash: 'نقدي', goods: 'بضاعة' };
  
  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <title>كشف حساب شريك - ${esc(p.name)}</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; margin: 20px; color: #222; direction: rtl; text-align: right; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
        .header h2 { margin: 0 0 5px; }
        .header p { margin: 0; color: #666; font-size: 14px; }
        .info-grid { display: flex; justify-content: space-between; background: #f8f9fa; padding: 12px; border-radius: 6px; margin-bottom: 20px; border: 1px solid #eee; }
        .info-item { text-align: right; }
        .info-item strong { display: block; font-size: 12px; color: #666; }
        .summary-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
        .card { background: #fff; border: 1px solid #ddd; padding: 10px; border-radius: 6px; text-align: center; }
        .card .title { font-size: 11px; color: #555; }
        .card .val { font-size: 16px; font-weight: bold; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
        th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: right; }
        th { background: #eee; }
        .text-center { text-align: center; }
        .text-success { color: #2e7d32; font-weight: bold; }
        .text-danger { color: #c62828; font-weight: bold; }
        .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #888; border-top: 1px dashed #ccc; padding-top: 10px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>${esc(storeName)}</h2>
        <h3>📋 كشف حساب شريك: ${esc(p.name)}</h3>
        <p>تاريخ التقرير: ${new Date().toLocaleDateString('ar-EG')} - ${new Date().toLocaleTimeString('ar-EG')}</p>
      </div>
      <div class="info-grid">
        <div class="info-item"><strong>اسم الشريك:</strong> ${esc(p.name)}</div>
        <div class="info-item"><strong>الهاتف:</strong> ${esc(p.phone || '—')}</div>
        <div class="info-item"><strong>نسبة الأرباح:</strong> ${p.profit_percent}%</div>
        <div class="info-item"><strong>الحالة:</strong> ${p.active ? 'نشط' : 'موقوف'}</div>
      </div>
      <div class="summary-cards">
        <div class="card"><div class="title">رأس مال نقدي</div><div class="val">${fmt(inCash)} ${C}</div></div>
        <div class="card"><div class="title">رأس مال بضاعة</div><div class="val">${fmt(inGoods)} ${C}</div></div>
        <div class="card"><div class="title">تحويلات إليه</div><div class="val text-danger">${fmt(outAll)} ${C}</div></div>
        <div class="card"><div class="title">صافي رأس المال</div><div class="val text-success">${fmt(inCash + inGoods - outAll)} ${C}</div></div>
      </div>
      <h4>سجل المعاملات والحركات:</h4>
      ${d.txns.length ? `
      <table>
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>نوع الحركة</th>
            <th>طبيعة القيمة</th>
            <th>طريقة الدفع</th>
            <th>المبلغ (${C})</th>
            <th>البيان / ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          ${d.txns.map(t => `
            <tr>
              <td>${fmtDate(t.created_at)}</td>
              <td>${t.type === 'in' ? '<span class="text-success">توريد (+)</span>' : '<span class="text-danger">تحويل إليه (-)</span>'}</td>
              <td>${KIND[t.kind] || t.kind}</td>
              <td>${TXN_METHODS[t.method] || 'كاش'}</td>
              <td><b>${t.type === 'in' ? '+' : '-'}${fmt(t.amount)}</b></td>
              <td>${esc(t.note || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ` : '<p class="text-center" style="padding:20px;color:#777;">لا توجد حركات مسجلة بهذا الحساب</p>'}
      <div class="footer">
        تمت طباعة التقرير من نظام إداري محمي — ${esc(storeName)}
      </div>
    </body>
    </html>
  `;
  if (typeof printDocument === 'function') printDocument(html);
  else if (typeof doPrint === 'function') doPrint(html);
}
