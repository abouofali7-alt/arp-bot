async function renderCoupons() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="toolbar">
      <h3 style="flex:1">🎟️ كوبونات الخصم</h3>
      <button class="btn" onclick="couponOpenForm()">➕ كوبون جديد</button>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>الكود</th><th>النوع</th><th class="num">القيمة</th><th class="num">الحد الأدنى</th><th class="num">الاستخدام</th><th>الصلاحية</th><th>الحالة</th><th></th></tr></thead>
        <tbody id="couponsTable"></tbody>
      </table></div>
    </div>`;
  couponsLoad();
}

async function couponsLoad() {
  const list = await API.get('/api/coupons');
  const now = new Date().toISOString().slice(0, 10);
  document.getElementById('couponsTable').innerHTML = list.map(c => {
    const expired = c.expires_at && c.expires_at < now;
    const usedUp = c.max_uses > 0 && c.used_count >= c.max_uses;
    const ok = c.active && !expired && !usedUp;
    return `
    <tr>
      <td><b dir="ltr" style="letter-spacing:1px">${esc(c.code)}</b></td>
      <td>
        ${c.discount_type === 'percent' ? `<span class="badge badge-blue">نسبة ${c.value}%</span>` : `<span class="badge badge-orange">ثابت ${fmt(c.value)}</span>`}
        ${c.party_id ? `<div class="small muted mt-10">${c.source === 'loyalty' ? '🎁 ولاء' : '👤 خاص بالعميل'}: ${esc(c.customer_name || 'عميل')}</div>` : '<div class="small muted mt-10">👥 عام — لكل العملاء</div>'}
      </td>
      <td class="num">${fmt(c.value)}</td>
      <td class="num">${fmt(c.min_total)}</td>
      <td class="num">${c.max_uses > 0 ? c.used_count + ' / ' + c.max_uses : c.used_count + ' / ∞'}</td>
      <td class="small">${c.expires_at ? (expired ? `<span class="badge badge-red">انتهى ${c.expires_at}</span>` : c.expires_at) : 'دائم'}</td>
      <td>${ok ? '<span class="badge badge-green">نشط</span>' : '<span class="badge badge-red">موقوف</span>'}</td>
      <td><div class="flex" style="gap:4px">
        <button class="btn btn-secondary btn-sm" onclick="couponOpenForm(${c.id})">تعديل</button>
        <button class="btn btn-ghost btn-sm" onclick="couponPrintCode('${esc(c.code)}')" title="طباعة باركود">🖨️</button>
      </div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8"><div class="empty">لا توجد كوبونات — أنشئ أول كوبون</div></td></tr>';
}

async function couponPrintCode(code) {
  const list = await API.get('/api/coupons');
  const c = list.find(x => x.code === code);
  if (!c) return;
  window.APP_printCoupon = { code: c.code, discount_type: c.discount_type, value: c.value, expires_at: c.expires_at || '' };
  openPrintModal(loyaltyLabelHtml(window.APP_printCoupon), 'label', 'طباعة باركود الكوبون');
}

async function couponOpenForm(id) {
  let c = null;
  if (id) {
    const list = await API.get('/api/coupons');
    c = list.find(x => x.id === id);
  }
  const customers = await API.get('/api/parties?type=customer');
  openModal(`
    <div class="modal-head"><h3>${c ? 'تعديل كوبون' : '➕ كوبون جديد'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="grid-2">
      <div class="form-group"><label>الكود *</label><input id="cpCode" value="${esc(c?.code || '')}" dir="ltr" placeholder="SALE10" style="text-transform:uppercase" ${c ? 'disabled' : ''}></div>
      <div class="form-group"><label>النوع</label>
        <select id="cpType">
          <option value="percent" ${c?.discount_type === 'percent' ? 'selected' : ''}>نسبة مئوية</option>
          <option value="fixed" ${c?.discount_type === 'fixed' ? 'selected' : ''}>مبلغ ثابت</option>
        </select></div>
      <div class="form-group"><label>القيمة *</label><input type="number" id="cpValue" step="0.01" value="${c?.value || ''}"></div>
      <div class="form-group"><label>الحد الأدنى للفاتورة</label><input type="number" id="cpMin" step="0.01" value="${c?.min_total || 0}"></div>
      <div class="form-group"><label>الحد الأقصى للاستخدام (0 = غير محدود)</label><input type="number" id="cpMax" value="${c?.max_uses || 0}"></div>
      <div class="form-group"><label>تاريخ الانتهاء (اختياري)</label><input type="date" id="cpExpires" value="${c?.expires_at || ''}"></div>
      <div class="form-group" style="grid-column:1/-1"><label>العميل المخصص (اتركه فارغاً لكوبون عام لكل العملاء)</label>
        <select id="cpParty">
          <option value="">👥 كل العملاء — كوبون عام</option>
          ${customers.map(x => `<option value="${x.id}" ${c && Number(c.party_id) === Number(x.id) ? 'selected' : ''}>${esc(x.name)}${x.phone ? ' — ' + esc(x.phone) : ''}</option>`).join('')}
        </select></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="couponSave(${c?.id || 0})">حفظ</button>
      ${c ? `<button class="btn btn-warning" onclick="couponToggle(${c.id}, ${c.active ? 0 : 1})">${c.active ? 'إيقاف' : 'تفعيل'}</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
}

async function couponSave(id) {
  const body = {
    code: document.getElementById('cpCode').value.trim(),
    discount_type: document.getElementById('cpType').value,
    value: Number(document.getElementById('cpValue').value),
    min_total: Number(document.getElementById('cpMin').value) || 0,
    max_uses: Number(document.getElementById('cpMax').value) || 0,
    expires_at: document.getElementById('cpExpires').value || null,
    party_id: document.getElementById('cpParty').value || null,
  };
  if (!body.code || !(body.value > 0)) { showAlert('الكود والقيمة مطلوبان', 'error'); return; }
  try {
    if (id) { await API.put('/api/coupons/' + id, body); showAlert('تم التعديل'); }
    else { await API.post('/api/coupons', body); showAlert('تم إنشاء الكوبون'); }
    closeModal();
    couponsLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function couponToggle(id, active) {
  await API.put('/api/coupons/' + id, { active });
  closeModal();
  couponsLoad();
}
