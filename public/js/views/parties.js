let PARTIES = { type: 'supplier', list: [] };

async function renderParties() {
  const el = document.getElementById('viewContainer');
  if (PARTIES.type === 'employee') return renderEmployees(el);
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn ${PARTIES.type === 'supplier' ? '' : 'btn-secondary'}" onclick="partySwitch('supplier')">🤝 الموردون</button>
      <button class="btn ${PARTIES.type === 'customer' ? '' : 'btn-secondary'}" onclick="partySwitch('customer')">🧑‍🤝‍🧑 العملاء</button>
      <button class="btn btn-secondary" onclick="partySwitch('employee')">👷 العمال والموظفين</button>
      <div class="grow"></div>
      ${can('parties.edit') ? '<button class="btn" onclick="partyOpenForm()">➕ إضافة</button>' : ''}
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="label">إجمالي عدد</div><div class="value" id="pCount">0</div></div>
      <div class="stat orange"><div class="label">إجمالي المستحق لنا</div><div class="value" id="pDue">0.00</div></div>
      <div class="stat blue"><div class="label">إجمالي المستحق عليهم</div><div class="value" id="pOwe">0.00</div></div>
    </div>
    <div class="card">
      <div class="card-title">القائمة</div>
      <div class="table-wrap"><table>
        <thead><tr><th>الاسم</th><th>الهاتف</th><th>العنوان</th><th class="num">الرصيد</th><th></th></tr></thead>
        <tbody id="partiesTable"></tbody>
      </table></div>
    </div>`;
  partiesLoad();
}

function partySwitch(type) {
  PARTIES.type = type;
  renderParties();
}

async function partiesLoad() {
  const list = await API.get('/api/parties?type=' + PARTIES.type);
  PARTIES.list = list;
  document.getElementById('pCount').textContent = list.length;
  const due = list.filter(p => p.balance > 0).reduce((s, p) => s + p.balance, 0);
  const owe = list.filter(p => p.balance < 0).reduce((s, p) => s + p.balance, 0);
  document.getElementById('pDue').textContent = fmt(due);
  document.getElementById('pOwe').textContent = fmt(Math.abs(owe));
  document.getElementById('partiesTable').innerHTML = list.map(p => `
    <tr>
      <td><b>${esc(p.name)}</b></td>
      <td class="small" dir="ltr">${esc(p.phone || '—')}</td>
      <td class="small">${esc(p.address || '—')}</td>
      <td class="num">${p.balance > 0 ? `<span class="badge badge-red">عليه ${fmt(p.balance)}</span>` : p.balance < 0 ? `<span class="badge badge-green">له ${fmt(Math.abs(p.balance))}</span>` : '<span class="badge badge-gray">0.00</span>'}</td>
      <td><div class="flex" style="gap:4px">
        <button class="btn btn-accent btn-sm" onclick="partyMovements(${p.id})">📋 حركات</button>
        ${can('parties.edit') ? `
        <button class="btn btn-secondary btn-sm" onclick="partyOpenForm(${p.id})">تعديل</button>
        <button class="btn btn-warning btn-sm" onclick="partyPay(${p.id}, '${esc(p.name)}', ${p.balance})">سداد / دفع</button>` : ''}
      </div></td>
    </tr>`).join('') || '<tr><td colspan="5"><div class="empty">لا توجد سجلات</div></td></tr>';
}

async function partyOpenForm(id) {
  if (PARTIES.type === 'employee') return employeeOpenForm(id);
  const p = PARTIES.list.find(x => x.id === id) || null;
  const isSupplier = PARTIES.type === 'supplier';
  // الرصيد الافتتاحي المحفوظ (لو موجود) لاستخدامه في التعديل
  let openVal = '', openDir = '';
  if (p && Number(p.opening_amount) > 0) {
    openVal = Number(p.opening_amount);
    const positive = p.opening_type === 'out';
    openDir = isSupplier ? (positive ? 'prepaid' : 'owed') : (positive ? 'debt' : 'prepaid');
  }
  openModal(`
    <div class="modal-head"><h3>${p ? 'تعديل' : '➕ إضافة'} ${isSupplier ? 'مورد' : 'عميل'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="form-group"><label>الاسم *</label><input id="paName" value="${esc(p?.name || '')}"></div>
    <div class="form-group"><label>الهاتف</label><input id="paPhone" value="${esc(p?.phone || '')}" dir="ltr"></div>
    <div class="form-group"><label>العنوان</label><input id="paAddress" value="${esc(p?.address || '')}"></div>
    <div class="form-group"><label>رصيد افتتاحي ${p ? `<span class="muted small">(الحالي: ${openVal ? fmt(openVal) : 'لا يوجد'})</span>` : '<span class="muted small">(اختياري)</span>'}</label>
      <input type="number" id="paOpening" step="0.01" min="0" placeholder="0.00" value="${openVal}" style="width:100%;font-size:1rem;padding:10px" oninput="partyOpeningHint()">
      <select id="paOpeningDir" style="width:100%;margin-top:6px;padding:9px" onchange="partyOpeningHint()">${isSupplier
        ? `<option value="owed" ${openDir === 'owed' ? 'selected' : ''}>مستحق له (علينا)</option><option value="prepaid" ${openDir === 'prepaid' ? 'selected' : ''}>دفعت له مقدماً</option>`
        : `<option value="debt" ${openDir === 'debt' ? 'selected' : ''}>عليه (مديونية)</option><option value="prepaid" ${openDir === 'prepaid' ? 'selected' : ''}>له (دفعات مقدمة)</option>`}</select>
      <div class="small muted mt-5" id="paOpeningHint">${p ? 'عدّل القيمة لتصحيح الرصيد الافتتاحي — أو اجعلها صفراً لإلغائه من الحساب' : 'يُسجَّل في كشف حسابه كبند "رصيد افتتاحي"'}</div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="partySave(${p?.id || 0})">حفظ</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
}
function partyOpeningHint() {
  const el = document.getElementById('paOpeningHint');
  const v = Number(document.getElementById('paOpening')?.value) || 0;
  if (!el) return;
  el.textContent = v > 0 ? `سيُضاف ${fmt(v)} إلى ${document.getElementById('paOpeningDir').selectedOptions[0].textContent} عند الحفظ` : 'اجعلها صفراً لعدم تسجيل رصيد افتتاحي';
}
async function partySave(id) {
  const name = document.getElementById('paName').value.trim();
  if (!name) return;
  const body = { type: PARTIES.type, name, phone: document.getElementById('paPhone').value.trim(), address: document.getElementById('paAddress').value.trim() };
  body.opening_balance = Math.max(0, Number(document.getElementById('paOpening')?.value) || 0);
  body.opening_direction = document.getElementById('paOpeningDir')?.value || (PARTIES.type === 'supplier' ? 'owed' : 'debt');
  if (id) { await API.put('/api/parties/' + id, body); showAlert('تم التعديل'); }
  else { await API.post('/api/parties', body); showAlert('تمت الإضافة'); }
  closeModal();
  partiesLoad();
}

function partyPay(id, name, balance) {
  const isSupplier = PARTIES.type === 'supplier';
  openModal(`
    <div class="modal-head"><h3>${isSupplier ? 'دفعة للمورد' : 'سداد من العميل'}: ${esc(name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="alert ${Math.abs(balance) > 0.001 ? 'error' : 'success'}">الرصيد الحالي: ${balance > 0 ? 'عليه ' + fmt(balance) : balance < 0 ? 'له ' + fmt(Math.abs(balance)) : 'صفر'}</div>
    <div class="form-group"><label>نوع الدفعة</label>
      <select id="payType">
        <option value="debt">💳 سداد مديونية</option>
        <option value="arabon">🤝 عربون (دفعة مقدمة)</option>
        <option value="other">📝 أخرى</option>
      </select>
    </div>
    <div class="form-group"><label>المبلغ</label><input type="number" id="payAmount" step="0.01" min="0"></div>
    <div class="form-group"><label>طريقة الدفع</label>
      <select id="payMethod">
        <option value="cash">💵 كاش (من/إلى الدرج)</option>
        <option value="card">💳 كارت</option>
        <option value="wallet">📱 محفظة</option>
        <option value="transfer">🏦 تحويل بنكي</option>
      </select></div>
    <div class="form-group"><label>ملاحظات</label><input id="payNote" placeholder="اختياري"></div>
    <div class="muted small">${isSupplier ? 'دفع مبلغ للمورد (يقلل المستحق له لدينا)' : 'تحصيل مبلغ من العميل (يقلل المديونية عليه)'}</div>
    <div class="modal-foot"><button class="btn" onclick="partyPaySave(${id})">حفظ</button><button class="btn btn-secondary" onclick="closeModal()">إلغاء</button></div>
  `);
}
async function partyPaySave(id) {
  const amount = Number(document.getElementById('payAmount').value) || 0;
  if (amount <= 0) { showAlert('أدخل مبلغ صحيح', 'error'); return; }
  const isSupplier = PARTIES.type === 'supplier';
  await API.post('/api/parties/' + id + '/payment', { amount, type: isSupplier ? 'out' : 'in', pay_type: document.getElementById('payType').value, note: document.getElementById('payNote').value, method: document.getElementById('payMethod')?.value || 'cash' });
  closeModal();
  showAlert('تم تسجيل الدفعة');
  partiesLoad();
}

/* ==================== EMPLOYEES ==================== */
const EMP_ROLE_NAMES = { general: 'عام', cashier: 'كاشير', accountant: 'محاسب', marketing: 'مدير تسويق', maint_worker: 'عامل صيانة' };
const EMP_ROLE_BADGES = { general: 'badge-gray', cashier: 'badge-green', accountant: 'badge-blue', marketing: 'badge-orange', maint_worker: 'badge-purple' };

function renderEmployees(el) {
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-secondary" onclick="partySwitch('supplier')">🤝 الموردون</button>
      <button class="btn btn-secondary" onclick="partySwitch('customer')">🧑‍🤝‍🧑 العملاء</button>
      <button class="btn" onclick="partySwitch('employee')">👷 العمال والموظفين</button>
      <div class="grow"></div>
      ${can('parties.edit') ? '<button class="btn" onclick="employeeOpenForm()">➕ إضافة موظف</button>' : ''}
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="label">عدد الموظفين</div><div class="value" id="eCount">0</div></div>
      <div class="stat blue"><div class="label">إجمالي المرتبات الثابتة</div><div class="value" id="eSalary">0.00</div></div>
      <div class="stat orange"><div class="label">إجمالي السلف المستحقة</div><div class="value" id="eAdvance">0.00</div></div>
    </div>
    <div class="card">
      <div class="card-title">👷 العمال والموظفين</div>
      <div class="table-wrap"><table>
        <thead><tr><th>الاسم</th><th>الحالة الوظيفية</th><th>الهاتف</th><th>المرتب</th><th class="num">السلفة</th><th class="num">مرتب الشهر</th><th></th></tr></thead>
        <tbody id="employeesTable"></tbody>
      </table></div>
    </div>`;
  employeesLoad();
}

async function employeesLoad() {
  const list = await API.get('/api/employees');
  PARTIES._emp = list;
  document.getElementById('eCount').textContent = list.length;
  document.getElementById('eSalary').textContent = fmt(list.filter(e => e.pay_type !== 'commission').reduce((s, e) => s + (e.salary || 0), 0));
  document.getElementById('eAdvance').textContent = fmt(list.reduce((s, e) => s + (e.balance > 0 ? e.balance : 0), 0));
  document.getElementById('employeesTable').innerHTML = list.map(e => `
    <tr>
      <td><b>${esc(e.name)}</b>${e.active ? '' : ' <span class="badge badge-gray">مغادر</span>'}${e.on_vacation ? ` <span class="badge badge-blue" title="إجازة">🌴 حتى ${fmtDate(e.vacation_until + 'T00:00:00')}</span>` : ''}</td>
      <td><span class="badge ${EMP_ROLE_BADGES[e.emp_role] || 'badge-gray'}">${EMP_ROLE_NAMES[e.emp_role] || esc(e.emp_role || 'عام')}</span>${e.job_title ? `<div class="small muted">${esc(e.job_title)}</div>` : ''}</td>
      <td class="small" dir="ltr">${esc(e.phone || '—')}</td>
      <td>${e.pay_type === 'commission'
        ? `<span class="badge badge-orange">نسبة من الربح</span><div class="small muted">${(e.commissions || []).map(c => `${c.scope === 'maintenance' ? '🔧 صيانة' : esc(c.category_name)} ${c.percent}%`).join('<br>') || '—'}</div>`
        : `<span class="num">${fmt(e.salary)}</span> <span class="small muted">ثابت</span>`}</td>
      <td class="num">${e.balance > 0.001 ? `<span class="badge badge-red">عليه ${fmt(e.balance)}</span>` : e.balance < -0.001 ? `<span class="badge badge-green">له ${fmt(Math.abs(e.balance))}</span>` : '<span class="badge badge-gray">0.00</span>'}</td>
      <td class="num">${e.salary_closed ? '<span class="badge badge-green">✔ مغلق</span>' : '<span class="badge badge-orange">غير مغلق</span>'}</td>
      <td><div class="flex" style="gap:4px">
        <button class="btn btn-accent btn-sm" onclick="employeeMovements(${e.id})">📋 حركات</button>
        <button class="btn btn-secondary btn-sm" onclick="employeeVacations(${e.id})">🌴 إجازات</button>
        ${can('parties.edit') ? `
        <button class="btn btn-success btn-sm" onclick="employeeSalaryClose(${e.id})">💰 تقفيل مرتب</button>
        <button class="btn btn-secondary btn-sm" onclick="employeeOpenForm(${e.id})">تعديل</button>
        <button class="btn btn-warning btn-sm" onclick="employeeAdvance(${e.id})">سلفة / سداد</button>` : ''}
      </div></td>
    </tr>`).join('') || '<tr><td colspan="7"><div class="empty">لا يوجد موظفون</div></td></tr>';
}

function employeeOpenForm(id) {
  const e = (PARTIES._emp || []).find(x => x.id === id) || null;
  window._EMP_COMMS = e && Array.isArray(e.commissions) ? e.commissions.map(c => ({ ...c })) : [];
  const roleOpts = Object.entries(EMP_ROLE_NAMES).map(([k, v]) =>
    `<option value="${k}" ${(e?.emp_role || 'general') === k ? 'selected' : ''}>${v}</option>`).join('');
  openModal(`
    <div class="modal-head"><h3>${e ? 'تعديل' : '➕ إضافة'} موظف</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="form-group"><label>الاسم *</label><input id="emName" value="${esc(e?.name || '')}"></div>
    <div class="grid-2">
      <div class="form-group"><label>الحالة الوظيفية</label><select id="emRole">${roleOpts}</select></div>
      <div class="form-group"><label>المسمى الوظيفي</label><input id="emJob" value="${esc(e?.job_title || '')}" placeholder="اختياري"></div>
    </div>
    <div class="form-group"><label>نوع المرتب</label>
      <div class="flex" style="gap:16px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:700">
          <input type="radio" name="emPay" value="fixed" onchange="employeePaySwitch()" ${(e?.pay_type || 'fixed') === 'fixed' ? 'checked' : ''} style="width:auto"> مرتب ثابت
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:700">
          <input type="radio" name="emPay" value="commission" onchange="employeePaySwitch()" ${e?.pay_type === 'commission' ? 'checked' : ''} style="width:auto"> نسبة من الربح
        </label>
      </div>
    </div>
    <div id="emFixedBox">
      <div class="form-group"><label>المرتب الشهري الثابت</label><input type="number" id="emSalary" step="0.01" min="0" value="${e?.salary ?? 0}"></div>
    </div>
    <div id="emCommBox" style="display:none">
      <div class="card-title" style="font-size:.95rem">📊 نسب العمولة (من الربح)</div>
      <div class="flex mb-10" style="gap:8px;align-items:end">
        <div class="form-group" style="margin:0;flex:2"><label>الأساس</label>
          <select id="commScope">
            <option value="">— اختر أساس العمولة —</option>
            <option value="__cats__">📁 قسم من المبيعات...</option>
            <option value="maintenance">🔧 أعمال الصيانة (أجرة الشغل)</option>
          </select>
        </div>
        <div class="form-group" style="margin:0;flex:1"><label>النسبة %</label><input type="number" id="commPct" min="0" max="100" step="0.1"></div>
        <button class="btn btn-secondary btn-sm" onclick="employeeAddComm()">➕</button>
      </div>
      <div id="commCatPick" class="flex mb-10" style="display:none;gap:8px">
        <div class="form-group" style="margin:0;flex:1"><label>قسم رئيسي</label><select id="commMain" onchange="commFillSubs()"></select></div>
        <div class="form-group" style="margin:0;flex:1"><label>فرعي / نوع فرعي</label><select id="commSub"><option value="">القسم كاملاً</option></select></div>
      </div>
      <div id="commList" class="mb-10"></div>
    </div>
    <div class="grid-2">
      <div class="form-group"><label>الهاتف</label><input id="emPhone" value="${esc(e?.phone || '')}" dir="ltr"></div>
      <div class="form-group"><label>تاريخ التعيين</label><input type="date" id="emHire" value="${esc(e?.hire_date || '')}"></div>
    </div>
    <div class="form-group"><label>العنوان</label><input id="emAddress" value="${esc(e?.address || '')}"></div>
    <div class="form-group"><label>الرقم القومي</label><input id="emNid" value="${esc(e?.national_id || '')}" dir="ltr"></div>
    <div class="modal-foot">
      <button class="btn" onclick="employeeSave(${e?.id || 0})">حفظ</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
  employeeFillCats();
  commDrawList();
}

async function employeeFillCats() {
  let cats = [];
  try { cats = await API.get('/api/categories'); } catch {}
  const mains = cats.filter(c => !c.parent_id);
  const mainSel = document.getElementById('commMain');
  if (!mainSel) return;
  mainSel.innerHTML = '<option value="">— اختر —</option>' + mains.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
}

function commFillSubs() {
  const mid = Number(document.getElementById('commMain')?.value) || 0;
  const subSel = document.getElementById('commSub');
  API.get('/api/categories').then(cats => {
    const kids = cats.filter(c => c.parent_id == mid);
    subSel.innerHTML = '<option value="">القسم كاملاً</option>' + kids.map(k => {
      const grand = cats.filter(g => g.parent_id == k.id);
      return `<option value="${k.id}">↳ ${esc(k.name)}</option>` +
        grand.map(g => `<option value="${g.id}">&nbsp;&nbsp;&nbsp;&nbsp;↳↳ ${esc(g.name)}</option>`).join('');
    }).join('');
  });
}

function employeePaySwitch() {
  const isComm = document.querySelector('input[name="emPay"]:checked')?.value === 'commission';
  document.getElementById('emFixedBox').style.display = isComm ? 'none' : 'block';
  document.getElementById('emCommBox').style.display = isComm ? 'block' : 'none';
}

document.addEventListener('change', (ev) => {
  if (ev.target && ev.target.id === 'commScope') {
    document.getElementById('commCatPick').style.display = ev.target.value === '__cats__' ? 'flex' : 'none';
  }
});

function employeeAddComm() {
  const scopeSel = document.getElementById('commScope');
  const pct = Math.max(0, Math.min(100, Number(document.getElementById('commPct').value) || 0));
  if (!pct) { showAlert('أدخل نسبة صحيحة', 'error'); return; }
  if (scopeSel.value === 'maintenance') {
    window._EMP_COMMS.push({ scope: 'maintenance', category_id: null, category_name: null, percent: pct });
  } else if (scopeSel.value === '__cats__') {
    const sub = Number(document.getElementById('commSub')?.value) || 0;
    const main = Number(document.getElementById('commMain')?.value) || 0;
    const cid = sub || main;
    if (!cid) { showAlert('اختر القسم أولاً', 'error'); return; }
    const name = sub
      ? document.getElementById('commSub').selectedOptions[0].textContent.replace(/[↳]/g, '').trim()
      : document.getElementById('commMain').selectedOptions[0].textContent.trim();
    window._EMP_COMMS.push({ scope: 'category', category_id: cid, category_name: name, percent: pct });
  } else { showAlert('اختر أساس العمولة', 'error'); return; }
  document.getElementById('commPct').value = '';
  commDrawList();
}

function commDrawList() {
  const box = document.getElementById('commList');
  if (!box) return;
  box.innerHTML = (window._EMP_COMMS || []).map((c, i) => `
    <div class="r-line small"><span>${c.scope === 'maintenance' ? '🔧 أعمال صيانة' : '📁 ' + esc(c.category_name)}</span>
      <span>${c.percent}% <button class="btn btn-danger btn-sm" onclick="commRemove(${i})" title="حذف">✕</button></span></div>`).join('')
    || '<div class="small muted">لم تُضف نِسب بعد</div>';
}

function commRemove(i) {
  window._EMP_COMMS.splice(i, 1);
  commDrawList();
}

async function employeeSave(id) {
  const name = document.getElementById('emName').value.trim();
  if (!name) { showAlert('أدخل الاسم', 'error'); return; }
  const payType = document.querySelector('input[name="emPay"]:checked')?.value || 'fixed';
  const body = {
    name,
    job_title: document.getElementById('emJob').value.trim(),
    emp_role: document.getElementById('emRole').value,
    pay_type: payType,
    salary: Number(document.getElementById('emSalary')?.value) || 0,
    hire_date: document.getElementById('emHire').value,
    phone: document.getElementById('emPhone').value.trim(),
    address: document.getElementById('emAddress').value.trim(),
    national_id: document.getElementById('emNid').value.trim(),
    commissions: payType === 'commission' ? (window._EMP_COMMS || []) : [],
  };
  try {
    if (id) { await API.put('/api/employees/' + id, body); showAlert('تم التعديل'); }
    else { await API.post('/api/employees', body); showAlert('تمت الإضافة'); }
    closeModal();
    employeesLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

function employeeAdvance(id) {
  const e = (PARTIES._emp || []).find(x => x.id === id);
  if (!e) return;
  openModal(`
    <div class="modal-head"><h3>💵 سلفة / سداد: ${esc(e.name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="alert ${Math.abs(e.balance) > 0.001 ? 'error' : 'success'}">السلفة الحالية: ${e.balance > 0.001 ? 'عليه ' + fmt(e.balance) : e.balance < -0.001 ? 'له ' + fmt(Math.abs(e.balance)) : 'صفر'}</div>
    <div class="form-group"><label>النوع</label>
      <select id="emType">
        <option value="out">💸 سلفة (تزيد المبلغ المستحق على الموظف)</option>
        <option value="in">💵 سداد / خصم من الراتب</option>
      </select>
    </div>
    <div class="form-group"><label>المبلغ</label><input type="number" id="emAmount" step="0.01" min="0"></div>
    <div class="form-group"><label>طريقة الدفع</label>
      <select id="emMethod">
        <option value="cash">💵 كاش (من/إلى الدرج)</option>
        <option value="card">💳 كارت</option>
        <option value="wallet">📱 محفظة</option>
        <option value="transfer">🏦 تحويل بنكي</option>
      </select></div>
    <div class="form-group"><label>ملاحظات</label><input id="emNote" placeholder="اختياري"></div>
    <div class="modal-foot">
      <button class="btn" onclick="employeeAdvanceSave(${id})">حفظ</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
}

async function employeeAdvanceSave(id) {
  const amount = Number(document.getElementById('emAmount').value) || 0;
  if (amount <= 0) { showAlert('أدخل مبلغ صحيح', 'error'); return; }
  await API.post('/api/employees/' + id + '/advance', {
    amount,
    type: document.getElementById('emType').value,
    note: document.getElementById('emNote').value,
    method: document.getElementById('emMethod')?.value || 'cash',
  });
  closeModal();
  showAlert('تم التسجيل');
  employeesLoad();
}

async function employeeSalaryClose(id) {
  const e = (PARTIES._emp || []).find(x => x.id === id);
  if (!e) return;
  const now = new Date();
  const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const salary = Number(e.salary) || 0;
  const bal = Number(e.balance) || 0;
  // unpaid vacation deductions grouped by month
  window._VACCUT = {};
  try {
    const vd = await API.get('/api/employees/' + id + '/vacations');
    for (const v of vd.list || []) {
      if (v.type !== 'unpaid' || !(Number(v.deduction) > 0)) continue;
      const mk = String(v.start_date).slice(0, 7);
      window._VACCUT[mk] = Math.round(((window._VACCUT[mk] || 0) + Number(v.deduction)) * 100) / 100;
    }
  } catch {}
  openModal(`
    <div class="modal-head"><h3>💰 تقفيل مرتب: ${esc(e.name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="alert ${e.salary_closed ? 'success' : 'warning'}">${e.salary_closed ? 'تم تقفيل مرتب الشهر الحالي بالفعل' : 'الشهر الحالي غير مغلق بعد'}</div>
    ${e.pay_type === 'commission' ? '<div class="r-line"><span>نوع المرتب</span><span><b>نسبة من الربح</b></span></div>' : ''}
    <div class="r-line"><span>${e.pay_type === 'commission' ? 'المرتب الثابت (إن وجد)' : 'المرتب الشهري'}</span><span>${fmt(salary)}</span></div>
    <div class="r-line" id="scCommLines"></div>
    <div class="r-line"><span>السلفة الحالية</span><span>${bal > 0.001 ? fmt(bal) + ' عليه' : bal < -0.001 ? fmt(Math.abs(bal)) + ' له' : '0.00'}</span></div>
    <div class="r-line" id="scVacLine"></div>
    <div class="r-line"><span>المتبقي للصرف</span><span><b id="scNet">${fmt(0)}</b></span></div>
    <div class="form-group mt-10"><label>الشهر (سنة-شهر)</label><input type="month" id="scMonth" value="${month}" onchange="scRecalc(${id})"></div>
    <div class="form-group"><label>المبلغ للصرف</label><input type="number" id="scAmount" step="0.01" min="0" value="0"></div>
    <div class="muted small">تُحسب العمولات وتُخصم السلفة وأيام الإجازات بدون مرتب تلقائياً عند التقفيل.</div>
    <div class="form-group"><label>ملاحظات</label><input id="scNote" placeholder="اختياري"></div>
    <div class="modal-foot">
      <button class="btn" onclick="employeeSalaryCloseSave(${id})">تأكيد التقفيل</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
  scRecalc(id);
}

async function scRecalc(id) {
  const e = (PARTIES._emp || []).find(x => x.id === id);
  if (!e) return;
  const monthEl = document.getElementById('scMonth');
  const month = monthEl ? monthEl.value : '';
  if (!month) return;
  const salary = Number(e.salary) || 0;
  const bal = Number(e.balance) || 0;
  let comm = { sales: 0, maintenance: 0, total: 0 };
  if (e.pay_type === 'commission') {
    try { comm = await API.get('/api/employees/' + id + '/commission?month=' + month); } catch {}
  }
  window._SCCOMM = comm;
  const cut = (window._VACCUT || {})[month] || 0;
  const base = e.pay_type === 'commission' ? comm.total : salary;
  const net = Math.max(0, Math.round((base - bal - cut) * 100) / 100);
  const cl = document.getElementById('scCommLines');
  if (cl) cl.innerHTML = e.pay_type === 'commission'
    ? `<span>عمولة الشهر (${comm.sales > 0 ? 'مبيعات ' + fmt(comm.sales) : ''}${comm.sales > 0 && comm.maintenance > 0 ? ' + ' : ''}${comm.maintenance > 0 ? 'صيانة ' + fmt(comm.maintenance) : ''})</span><span style="color:#16a34a;font-weight:800">+ ${fmt(comm.total)}</span>`
    : '';
  const line = document.getElementById('scVacLine');
  if (line) line.innerHTML = cut > 0.001
    ? `<span>إجازات بدون مرتب (${month}) — تُخصم تلقائياً</span><span class="text-danger">− ${fmt(cut)}</span>`
    : '';
  const netEl = document.getElementById('scNet');
  if (netEl) netEl.textContent = fmt(net);
  const amtEl = document.getElementById('scAmount');
  if (amtEl && document.activeElement !== amtEl) amtEl.value = net;
}

async function employeeSalaryCloseSave(id) {
  const month = document.getElementById('scMonth').value;
  const amount = Number(document.getElementById('scAmount').value) || 0;
  if (amount < 0) { showAlert('أدخل مبلغ صحيح', 'error'); return; }
  try {
    await API.post('/api/employees/' + id + '/salary-close', {
      month,
      amount,
      note: document.getElementById('scNote').value,
    });
    closeModal();
    showAlert('تم تقفيل المرتب');
    employeesLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

/* ==================== VACATIONS ==================== */
const VAC_TYPE_NAMES = { paid: 'مدفوعة', unpaid: 'بدون مرتب', sick: 'مرضية' };

async function employeeVacations(id) {
  const e = (PARTIES._emp || []).find(x => x.id === id);
  if (!e) return;
  const d = await API.get('/api/employees/' + id + '/vacations');
  const today = new Date().toISOString().slice(0, 10);
  openModal(`
    <div class="modal-head"><h3>🌴 إجازات: ${esc(e.name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    ${can('parties.edit') ? `
    <div class="grid-2">
      <div class="form-group"><label>من تاريخ *</label><input type="date" id="vacFrom" value="${today}" onchange="vacCutPreview(${id})"></div>
      <div class="form-group"><label>إلى تاريخ *</label><input type="date" id="vacTo" value="${today}" onchange="vacCutPreview(${id})"></div>
    </div>
    <div class="form-group"><label>النوع</label>
      <select id="vacType" onchange="vacCutPreview(${id})">
        <option value="paid">مدفوعة</option>
        <option value="unpaid">بدون مرتب</option>
        <option value="sick">مرضية</option>
      </select></div>
    <div id="vacCutPreview" class="small mb-10" style="color:#b45309;font-weight:700"></div>
    <div class="form-group"><label>ملاحظات</label><input id="vacNote" placeholder="اختياري"></div>
    <button class="btn btn-block mb-10" onclick="employeeVacSave(${id})">➕ تسجيل الإجازة</button>`
    : '<div class="alert warning mb-10">ليس لديك صلاحية تعديل — عرض فقط</div>'}
    <div class="card-title">الإجازات المسجلة (${d.list.length})</div>
    <div class="table-wrap"><table>
      <thead><tr><th>من</th><th>إلى</th><th class="num">الأيام</th><th>النوع</th><th class="num">الخصم</th><th>ملاحظة</th>${can('parties.edit') ? '<th></th>' : ''}</tr></thead>
      <tbody>${d.list.map(v => {
        const active = v.start_date <= today && v.end_date >= today;
        return `<tr${active ? ' style="background:var(--primary-light)"' : ''}>
          <td class="small">${fmtDate(v.start_date + 'T00:00:00')}</td>
          <td class="small">${fmtDate(v.end_date + 'T00:00:00')} ${active ? '<span class="badge badge-green">جارية</span>' : ''}</td>
          <td class="num">${v.days}</td>
          <td class="small">${VAC_TYPE_NAMES[v.type] || v.type}</td>
          <td class="num">${Number(v.deduction) > 0 ? `<span class="badge badge-red">− ${fmt(v.deduction)}</span>` : '—'}</td>
          <td class="small">${esc((v.note || '').slice(0, 40))}</td>
          ${can('parties.edit') ? `<td><button class="btn btn-danger btn-sm" onclick="employeeVacDel(${v.id}, ${id})">🗑️</button></td>` : ''}
        </tr>`;
      }).join('') || '<tr><td colspan="7"><div class="empty">لا توجد إجازات مسجلة</div></td></tr>'}</tbody>
    </table></div>
  `);
}

function vacCutPreview(id) {
  const e = (PARTIES._emp || []).find(x => x.id === id);
  const box = document.getElementById('vacCutPreview');
  if (!e || !box) return;
  const f = document.getElementById('vacFrom').value;
  const t = document.getElementById('vacTo').value;
  const ty = document.getElementById('vacType').value;
  if (ty !== 'unpaid' || !f || !t || t < f) { box.textContent = ''; return; }
  const days = Math.floor((new Date(t + 'T00:00:00') - new Date(f + 'T00:00:00')) / 86400000) + 1;
  const dim = new Date(Number(f.slice(0, 4)), Number(f.slice(5, 7)), 0).getDate();
  const daily = (Number(e.salary) || 0) / dim;
  const cut = Math.round(daily * days * 100) / 100;
  box.innerHTML = `⚠️ سيُخصم تلقائياً من مرتب الشهر: <b>${fmt(cut)}</b> <span class="muted">(${days} يوم × ${daily.toFixed(2)} يومياً)</span>`;
}

async function employeeVacSave(id) {
  const from = document.getElementById('vacFrom').value;
  const to = document.getElementById('vacTo').value;
  if (!from || !to) { showAlert('حدد تاريخي البداية والنهاية', 'error'); return; }
  if (to < from) { showAlert('تاريخ النهاية قبل تاريخ البداية', 'error'); return; }
  try {
    const r = await API.post('/api/employees/' + id + '/vacations', {
      start_date: from,
      end_date: to,
      type: document.getElementById('vacType').value,
      note: document.getElementById('vacNote').value,
    });
    showAlert(`تم تسجيل إجازة (${r.days} يوم)` + (Number(r.deduction) > 0 ? ` — سيُخصم ${fmt(r.deduction)} من مرتب الشهر` : ''));
    closeModal();
    employeesLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function employeeVacDel(vacId, empId) {
  if (!confirm('حذف هذه الإجازة؟')) return;
  try {
    await API.del('/api/vacations/' + vacId);
    showAlert('تم الحذف');
    employeeVacations(empId);
    employeesLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

/* ==================== MOVEMENTS (statement) ==================== */
async function partyMovements(id) {
  const d = await API.get('/api/parties/' + id + '/movements');
  window.__movData = d;
  window.__movIsEmployee = false;
  movementsModal(d, false);
}

async function employeeMovements(id) {
  const d = await API.get('/api/employees/' + id + '/movements');
  window.__movData = d;
  window.__movIsEmployee = true;
  movementsModal(d, true);
}

function movementsModal(d, isEmployee) {
  const e = d.entity;
  const s = d.summary || {};
  const kindName = isEmployee ? 'الموظف' : e.type === 'supplier' ? 'المورد' : 'العميل';
  let stats = '';
  if (isEmployee) {
    stats = `
      <div class="stat"><div class="label">الرصيد (السلفة)</div><div class="value">${fmt(e.balance)}</div></div>
      <div class="stat orange"><div class="label">إجمالي السلف</div><div class="value">${fmt(s.advance_total)}</div></div>
      <div class="stat blue"><div class="label">إجمالي السداد</div><div class="value">${fmt(s.repay_total)}</div></div>`;
  } else if (e.type === 'supplier') {
    stats = `
      <div class="stat"><div class="label">الرصيد</div><div class="value">${fmt(e.balance)}</div></div>
      <div class="stat orange"><div class="label">إجمالي المشتريات</div><div class="value">${fmt(s.purchases_total)} <span class="small">(${s.purchases_count})</span></div></div>
      <div class="stat blue"><div class="label">إجمالي الصرف له</div><div class="value">${fmt(s.payments_out_total)}</div></div>`;
  } else {
    stats = `
      <div class="stat"><div class="label">الرصيد</div><div class="value">${fmt(e.balance)}</div></div>
      <div class="stat orange"><div class="label">إجمالي المبيعات</div><div class="value">${fmt(s.sales_total)} <span class="small">(${s.sales_count})</span></div></div>
      <div class="stat blue"><div class="label">إجمالي القبض</div><div class="value">${fmt(s.payments_in_total)}</div></div>`;
  }
  const rows = d.movements.map(movementsRow).join('') || '<tr><td colspan="6"><div class="empty">لا توجد حركات</div></td></tr>';
  const title = '📋 حركات ' + kindName + ': ' + e.name;
  openModal(`
    <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="stat-grid">${stats}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>التاريخ</th><th>البيان</th><th class="num">المبلغ</th><th class="num">التأثير</th><th class="num">الرصيد بعدها</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="modal-foot">
      <button class="btn btn-secondary" onclick="closeModal()">إغلاق</button>
      <button class="btn btn-accent" onclick="printMovements()">🖨️ طباعة الكشف</button>
    </div>
  `, true);
}

function movementsRow(m) {
  const icons = { sale: '🧾', purchase: '📥', return: '↩️', pay_in: '💵', pay_out: '💸', advance: '💸', repay: '💵' };
  const eff = Number(m.effect) || 0;
  const effBadge = eff > 0 ? `<span class="badge badge-green">+${fmt(eff)}</span>` : eff < 0 ? `<span class="badge badge-red">${fmt(eff)}</span>` : '<span class="badge badge-gray">0.00</span>';
  const run = Number(m.running) || 0;
  const runCls = run > 0.001 ? 'badge badge-red' : run < -0.001 ? 'badge badge-green' : 'badge badge-gray';
  const runTxt = run > 0.001 ? `${fmt(run)} عليه` : run < -0.001 ? `${fmt(Math.abs(run))} له` : '0.00';
  const viewBtn = `<button class="btn btn-secondary btn-sm" onclick="viewMovement(${m.id}, '${m.kind}')">عرض</button>`;
  return `
    <tr>
      <td class="small">${fmtDate(m.date)}</td>
      <td class="small">${icons[m.kind] || '📄'} <b>${esc(m.label)}</b>${m.pay_type && m.pay_type !== 'other' ? `<span class="badge badge-blue">${esc(payTypeName(m.pay_type))}</span>` : ''}${m.method && m.method !== 'cash' ? ` <span class="muted small">(${ { card: 'كارت', wallet: 'محفظة', transfer: 'تحويل' }[m.method] || m.method })</span>` : ''}${m.ref ? ` <span class="muted">${esc(m.ref)}</span>` : ''}${m.note ? `<div class="muted">${esc(m.note)}</div>` : ''}</td>
      <td class="num">${fmt(m.amount)}</td>
      <td class="num">${effBadge}</td>
      <td class="num"><span class="${runCls}">${runTxt}</span></td>
      <td>${viewBtn}</td>
    </tr>`;
}

function payTypeName(pt) {
  return { arabon: 'عربون', debt: 'سداد مديونية', other: 'أخرى', opening: 'رصيد افتتاحي' }[pt] || '';
}

async function viewMovement(id, kind) {
  if (kind === 'sale') return viewSale(id);
  if (kind === 'purchase') return viewPurchase(id);
  if (kind === 'return') return viewReturn(id);
  const p = await API.get('/api/payments/' + id).catch(() => null);
  if (!p) { showAlert('الدفعة غير موجودة', 'error'); return; }
  const isEmp = !!p.employee_id;
  openModal(`
    <div class="modal-head"><h3>💵 تفاصيل الدفعة</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="r-line"><span>التاريخ</span><span>${fmtDate(p.created_at)}</span></div>
    <div class="r-line"><span>نوع الدفعة</span><span>${p.type === 'in' ? (isEmp ? 'سداد' : 'قبض') : (isEmp ? 'سلفة' : 'صرف')} ${p.pay_type && p.pay_type !== 'other' ? '— ' + esc(payTypeName(p.pay_type)) : ''}</span></div>
    <div class="r-line r-total"><span>المبلغ</span><span>${fmt(p.amount)}</span></div>
    ${p.note ? `<div class="r-line"><span>ملاحظات</span><span>${esc(p.note)}</span></div>` : ''}
    <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal()">إغلاق</button></div>
  `);
}

function movementsReportHtml(d, isEmployee) {
  const e = d.entity;
  const cur = SETTINGS.currency || 'ج';
  const kindName = isEmployee ? 'الموظف' : e.type === 'supplier' ? 'المورد' : 'العميل';
  return `
    <div class="rep">
      <div class="rep-head">
        <h2>${esc(SETTINGS.store_name || 'سوبر ماركت')}</h2>
        <div class="rep-meta">كشف حركات ${kindName}: ${esc(e.name)} — ${fmtDate(new Date().toISOString())}</div>
      </div>
      <div class="rep-stats">
        <div class="rep-stat"><span class="lbl">الرصيد</span><b>${fmt(e.balance)} ${cur}</b></div>
      </div>
      <h4>تفاصيل الحركات</h4>
      <table>
        <thead><tr><th>التاريخ</th><th>البيان</th><th class="num">المبلغ</th><th class="num">التأثير</th><th class="num">الرصيد بعدها</th></tr></thead>
        <tbody>
          ${d.movements.map(m => `<tr>
            <td>${fmtDate(m.date)}</td>
            <td>${esc(m.label)}${m.pay_type && m.pay_type !== 'other' ? ' (' + esc(payTypeName(m.pay_type)) + ')' : ''}${m.ref ? ' ' + esc(m.ref) : ''}${m.note ? ' — ' + esc(m.note) : ''}</td>
            <td class="num">${fmt(m.amount)}</td>
            <td class="num">${fmt(m.effect)}</td>
            <td class="num">${fmt(m.running)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function printMovements() {
  const d = window.__movData;
  if (!d) return;
  openPrintModal(movementsReportHtml(d, window.__movIsEmployee), 'report', 'طباعة كشف حركات');
}
