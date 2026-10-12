let MAINT = { tab: 'jobs', q: '', status: '' };

const JOB_STATUS = {
  received: { label: 'استلام', badge: 'badge-gray' },
  repairing: { label: 'جاري الإصلاح', badge: 'badge-orange' },
  done: { label: 'تم الإصلاح', badge: 'badge-green' },
  delivered: { label: 'تم التسليم', badge: 'badge-blue' },
  cancelled: { label: 'ملغي', badge: 'badge-red' },
};

const PAY_METHOD = { cash: 'كاش', card: 'كارت', wallet: 'محفظة' };

async function renderMaintenance() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn ${MAINT.tab === 'jobs' ? '' : 'btn-secondary'}" onclick="maintSwitch('jobs')">🔧 أعمال الصيانة</button>
      <button class="btn ${MAINT.tab === 'board' ? '' : 'btn-secondary'}" onclick="maintSwitch('board')">📋 كشف اليوم وغير المقفلة</button>
      <button class="btn ${MAINT.tab === 'parts' ? '' : 'btn-secondary'}" onclick="maintSwitch('parts')">⚙️ قطع الغيار</button>
      <button class="btn ${MAINT.tab === 'suppliers' ? '' : 'btn-secondary'}" onclick="maintSwitch('suppliers')">🚚 موردون القطع</button>
    </div>
    <div id="maintBody"></div>`;
  if (MAINT.tab === 'jobs') maintLoadJobs();
  else if (MAINT.tab === 'board') maintLoadBoard();
  else if (MAINT.tab === 'parts') maintLoadParts();
  else maintLoadSuppliers();
}

function maintSwitch(tab) { MAINT.tab = tab; renderMaintenance(); }

/* ==================== JOBS ==================== */
async function maintLoadJobs() {
  const body = document.getElementById('maintBody');
  body.innerHTML = `
    <div class="toolbar" style="margin-top:10px">
      <input type="search" id="jobSearch" placeholder="🔍 بحث بالعميل أو الهاتف أو الجهاز أو رقم الأمر أو القطعة..." class="grow" value="${esc(MAINT.q)}">
      <select id="jobStatusFilter">
        <option value="">كل الحالات</option>
        ${Object.entries(JOB_STATUS).map(([k, v]) => `<option value="${k}" ${MAINT.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select>
      <button class="btn" onclick="jobOpenForm()">➕ أمر صيانة جديد</button>
    </div>
    <div class="card">
      <div class="card-title">🔧 أوامر الصيانة</div>
      <div class="table-wrap"><table>
        <thead><tr><th>رقم الأمر</th><th>العميل</th><th>الجهاز</th><th>المشكلة</th><th>الحالة</th><th class="num">القطع</th><th class="num">الأجر</th><th class="num">الإجمالي</th><th class="num">المتبقي</th><th></th></tr></thead>
        <tbody id="jobsTable"><tr><td colspan="10"><div class="empty">جاري التحميل...</div></td></tr></tbody>
      </table></div>
    </div>`;
  document.getElementById('jobSearch').addEventListener('input', (e) => { MAINT.q = e.target.value.trim(); maintRefreshJobs(); });
  document.getElementById('jobSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && MAINT.lastList && MAINT.lastList.length === 1) jobDetail(MAINT.lastList[0].id);
  });
  document.getElementById('jobStatusFilter').addEventListener('change', (e) => { MAINT.status = e.target.value; maintRefreshJobs(); });
  maintRefreshJobs();
}

async function maintRefreshJobs() {
  const params = new URLSearchParams();
  if (MAINT.q) params.set('q', MAINT.q);
  if (MAINT.status) params.set('status', MAINT.status);
  const list = await API.get('/api/maintenance/jobs?' + params.toString());
  MAINT.lastList = list;
  document.getElementById('jobsTable').innerHTML = list.map(j => {
    const st = JOB_STATUS[j.status] || JOB_STATUS.received;
    const remaining = (j.total || 0) - (j.paid || 0);
    return `
    <tr>
      <td class="small">${esc(j.job_no)}</td>
      <td><b>${esc(j.customer_name || '—')}</b><div class="small muted" dir="ltr">${esc(j.customer_phone || '')}</div></td>
      <td>${esc(j.device || '—')}</td>
      <td class="small">${esc((j.problem || '').slice(0, 40))}${(j.problem || '').length > 40 ? '…' : ''}</td>
      <td><span class="badge ${st.badge}">${st.label}</span></td>
      <td class="num">${fmt(j.parts_cost)}</td>
      <td class="num">${fmt(j.labor_cost)}</td>
      <td class="num"><b>${fmt(j.total)}</b></td>
      <td class="num">${remaining > 0.001 ? `<span class="badge badge-red">${fmt(remaining)}</span>` : '<span class="badge badge-green">مسدد</span>'}</td>
      <td><div class="flex" style="gap:4px">
        <button class="btn btn-accent btn-sm" onclick="jobDetail(${j.id})">فتح</button>
        <button class="btn btn-secondary btn-sm" onclick="jobPrint(${j.id})">🖨️</button>
        ${can('maintenance.delete_job') ? `<button class="btn btn-danger btn-sm" onclick="jobDelete(${j.id})">🗑️</button>` : ''}
      </div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="10"><div class="empty">لا توجد أوامر صيانة</div></td></tr>';
}

/* ==================== DAILY BOARD ==================== */
async function maintLoadBoard() {
  const body = document.getElementById('maintBody');
  const today = new Date().toISOString().slice(0, 10);
  body.innerHTML = `
    <div class="toolbar" style="margin-top:10px">
      <input type="date" id="boardDate" value="${esc(MAINT.boardDate || today)}">
      <button class="btn btn-secondary" onclick="boardRefresh()">عرض</button>
      <div class="grow"></div>
      <button class="btn btn-ghost" onclick="boardPrint()">🖨️ طباعة الكشف</button>
    </div>
    <div id="boardContent"><div class="empty" style="padding:40px">جاري التحميل...</div></div>`;
  if (!MAINT.boardDate) MAINT.boardDate = today;
  boardRefresh();
}

async function boardRefresh() {
  MAINT.boardDate = document.getElementById('boardDate').value;
  const box = document.getElementById('boardContent');
  if (!box) return;
  try {
    const d = await API.get('/api/maintenance/board?date=' + MAINT.boardDate);
    MAINT.boardData = d;
    const s = d.summary;
    box.innerHTML = `
      <div class="stat-grid mt-10">
        <div class="stat"><div class="icon">🔧</div><div class="label">أوامر اليوم (${esc(d.date)})</div>
          <div class="value">${s.today_count}</div><div class="small muted">بإجمالي ${fmt(s.today_total)} ${SETTINGS.currency || 'ج'}</div></div>
        <div class="stat green"><div class="icon">💵</div><div class="label">المحصل من الصيانة</div>
          <div class="value">${fmt(s.collected_today)} <small>${SETTINGS.currency || 'ج'}</small></div>
          <div class="small muted">${s.payments_count} دفعة — كاش: ${fmt(s.collected_cash)}</div></div>
        <div class="stat orange"><div class="icon">⏳</div><div class="label">أوامر غير مقفلة</div>
          <div class="value">${s.open_count}</div>
          <div class="small muted">متبقٍ عليها ${fmt(s.open_remaining)} ${SETTINGS.currency || 'ج'}</div></div>
      </div>

      <div class="card mt-10">
        <div class="card-title">💵 بيان تحصيلات اليوم</div>
        ${d.today_payments.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>الوقت</th><th>رقم الأمر</th><th>العميل</th><th>النوع</th><th>الطريقة</th><th>بواسطة</th><th class="num">المبلغ</th></tr></thead>
          <tbody>${d.today_payments.map(p => {
            const isDep = (p.note || '').includes('عربون');
            return `<tr>
              <td class="small">${fmtDate(p.created_at)}</td>
              <td class="small">${esc(p.job_no)}</td>
              <td>${esc(p.customer_name || '—')}</td>
              <td>${isDep ? '<span class="badge badge-orange">عربون</span>' : '<span class="badge badge-green">تسديد</span>'}</td>
              <td class="small">${PAY_METHOD[p.method] || p.method}</td>
              <td class="small">${esc(p.user_name || '—')}</td>
              <td class="num"><b>${fmt(p.amount)}</b></td>
            </tr>`;
          }).join('')}</tbody>
          <tfoot><tr style="background:#eee;font-weight:bold"><td colspan="6">الإجمالي المحصل</td><td class="num">${fmt(s.collected_today)}</td></tr></tfoot>
        </table></div>` : '<div class="empty">لا توجد تحصيلات في هذا اليوم</div>'}
      </div>

      <div class="grid-2 mt-10">
        <div class="card">
          <div class="card-title">🆕 أوامر اليوم</div>
          ${d.today_jobs.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>رقم الأمر</th><th>العميل</th><th>الجهاز</th><th>الحالة</th><th class="num">الإجمالي</th><th class="num">المتبقي</th></tr></thead>
            <tbody>${d.today_jobs.map(j => {
              const st = JOB_STATUS[j.status] || JOB_STATUS.received;
              return `<tr onclick="jobDetail(${j.id})" style="cursor:pointer">
                <td class="small">${esc(j.job_no)}</td>
                <td>${esc(j.customer_name || '—')}</td>
                <td class="small">${esc(j.device || '—')}</td>
                <td><span class="badge ${st.badge}">${st.label}</span></td>
                <td class="num">${fmt(j.total)}</td>
                <td class="num">${Math.max(0, (j.total || 0) - (j.paid || 0)) > 0.001 ? `<b class="text-danger">${fmt((j.total || 0) - (j.paid || 0))}</b>` : '✅'}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>` : '<div class="empty">لا توجد أوامر في هذا اليوم</div>'}
        </div>
        <div class="card">
          <div class="card-title">⏳ أوامر غير مقفلة (لسه مفتوحة)</div>
          ${d.open_jobs.length ? `
          <div class="table-wrap" style="max-height:420px;overflow:auto"><table>
            <thead><tr><th>رقم الأمر</th><th>العميل</th><th>الحالة</th><th class="num">أيام</th><th class="num">المتبقي</th></tr></thead>
            <tbody>${d.open_jobs.map(j => {
              const st = JOB_STATUS[j.status] || JOB_STATUS.received;
              const rem = Math.max(0, (j.total || 0) - (j.paid || 0));
              const late = (j.due_date && j.due_date < new Date().toISOString().slice(0, 10));
              return `<tr onclick="jobDetail(${j.id})" style="cursor:pointer">
                <td class="small">${esc(j.job_no)}${late ? ' ⚠️' : ''}</td>
                <td>${esc(j.customer_name || '—')}<div class="small muted">${esc(j.customer_phone || '')}</div></td>
                <td><span class="badge ${st.badge}">${st.label}</span></td>
                <td class="num small">${j.age_days ?? '—'}</td>
                <td class="num">${rem > 0.001 ? `<b class="text-danger">${fmt(rem)}</b>` : '✅'}</td>
              </tr>`;
            }).join('')}</tbody>
            <tfoot><tr style="background:#eee;font-weight:bold"><td colspan="4">إجمالي المتبقي على غير المقفلة</td><td class="num">${fmt(s.open_remaining)}</td></tr></tfoot>
          </table></div>` : '<div class="empty">✅ كل الأوامر مقفلة</div>'}
        </div>
      </div>`;
  } catch (e) { box.innerHTML = `<div class="empty">خطأ: ${esc(e.message)}</div>`; }
}

function boardPrint() {
  const d = MAINT.boardData;
  if (!d) { showAlert('اعرض الكشف أولاً', 'error'); return; }
  const s = d.summary;
  const cur = SETTINGS.currency || 'ج';
  const html = [
    `<div class="r-head"><h3>${esc(SETTINGS.store_name || 'سوبر ماركت')}</h3>`,
    `<div><b>كشف صيانة يومي</b></div><div>${esc(d.date)}</div></div>`,
    `<div class="r-line"><span>أوامر اليوم</span><span>${s.today_count} (${fmt(s.today_total)} ${cur})</span></div>`,
    `<div class="r-line"><span>المحصل (كاش)</span><span>${fmt(s.collected_cash)} ${cur}</span></div>`,
    `<div class="r-line r-total"><span>إجمالي المحصل</span><span>${fmt(s.collected_today)} ${cur}</span></div>`,
    `<div class="r-line"><span>أوامر غير مقفلة</span><span>${s.open_count}</span></div>`,
    `<div class="r-line"><span>المتبقي على غير المقفلة</span><span>${fmt(s.open_remaining)} ${cur}</span></div>`,
    `<div class="dashed"></div>`,
    d.today_payments.length ? ['<b>تحصيلات اليوم:</b>',
      ...d.today_payments.map(p => `<div class="r-line"><span>${esc(p.job_no)} — ${esc(p.customer_name || '—')} (${(p.note || '').includes('عربون') ? 'عربون' : PAY_METHOD[p.method] || p.method})</span><span>${fmt(p.amount)}</span></div>`)].join('\n') : '',
    `<div class="dashed"></div>`,
    d.open_jobs.length ? ['<b>غير المقفلة:</b>',
      ...d.open_jobs.map(j => `<div class="r-line"><span>${esc(j.job_no)} — ${esc(j.customer_name || '—')} (${(JOB_STATUS[j.status] || JOB_STATUS.received).label})</span><span>${fmt(Math.max(0, (j.total || 0) - (j.paid || 0)))}</span></div>`)].join('\n') : '',
    `<div class="r-foot">${esc(SETTINGS.invoice_footer || '')}</div>`,
  ].filter(Boolean).join('\n');
  openPrintModal(html, 'invoice', 'كشف الصيانة ' + d.date);
}

async function jobOpenForm() {
  openModal(`
    <div class="modal-head"><h3>🔧 أمر صيانة جديد</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="grid-2">
      <div class="form-group"><label>اسم العميل *</label><input id="jCustomer"></div>
      <div class="form-group"><label>هاتف العميل</label><input id="jPhone" dir="ltr"></div>
      <div class="form-group"><label>الجهاز / الصنف</label>
        <input type="search" id="jDevice" placeholder="اكتب أول حرف لعرض المنتجات وقطع الغيار..." autocomplete="off">
        <div id="jDeviceResults" style="display:none;max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--card,#fff);position:relative;z-index:10"></div>
      </div>
      <div class="form-group"><label>أجر الصيانة</label><input type="number" id="jLabor" step="0.01" value="0"></div>
      <div class="form-group"><label>العربون (مدفوع مقدماً)</label><input type="number" id="jDeposit" step="0.01" value="0"></div>
      <div class="form-group"></div>
      <div class="form-group"><label>📅 موعد التسليم المتوقع</label><input type="date" id="jDue"></div>
      <div class="form-group"><label>⏰ آخر موعد لاستلام الجهاز</label><input type="date" id="jClaim"></div>
    </div>
    <div class="small muted">بعد آخر موعد للاستلام يحق للمحل التصرف في الجهاز حسب الاتفاق</div>
    <div class="form-group mt-10"><label>وصف المشكلة</label><textarea id="jProblem" rows="2"></textarea></div>
    <div class="form-group"><label>ملاحظات</label><input id="jNotes"></div>
    <div class="modal-foot">
      <button class="btn" onclick="jobSave()">حفظ</button>
      <button class="btn btn-accent" onclick="jobSave(true)">حفظ وطباعة الإيصال 🖨️</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
  try {
    const [products, sparts] = await Promise.all([API.get('/api/products'), API.get('/api/spare-parts')]);
    MAINT.devCache = [
      ...(products || []).filter(p => p.active === undefined || p.active).map(p => ({ name: p.name, kind: 'منتج' })),
      ...(sparts || []).filter(p => p.active).map(p => ({ name: p.name, kind: 'قطعة غيار' })),
    ];
  } catch { MAINT.devCache = []; }
  const inp = document.getElementById('jDevice');
  inp.addEventListener('input', () => maintDrawDeviceResults(inp.value.trim()));
  inp.addEventListener('focus', () => maintDrawDeviceResults(inp.value.trim()));
  inp.addEventListener('blur', () => setTimeout(() => { const r = document.getElementById('jDeviceResults'); if (r) r.style.display = 'none'; }, 200));
}

function maintDrawDeviceResults(q) {
  const res = document.getElementById('jDeviceResults');
  if (!res) return;
  let list = MAINT.devCache || [];
  if (q) list = list.filter(x => (x.name || '').includes(q));
  MAINT.devFiltered = list.slice(0, 30);
  res.innerHTML = MAINT.devFiltered.map((x, i) => `
    <div style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border)" onmousedown="maintPickDevice(${i})">
      <b>${esc(x.name)}</b> <span class="badge badge-gray">${x.kind}</span>
    </div>`).join('') || '<div class="empty small" style="padding:8px">لا توجد نتائج مطابقة</div>';
  res.style.display = 'block';
}

function maintPickDevice(i) {
  const x = (MAINT.devFiltered || [])[i];
  if (!x) return;
  const inp = document.getElementById('jDevice');
  if (inp) inp.value = x.name;
  const r = document.getElementById('jDeviceResults');
  if (r) r.style.display = 'none';
}

async function jobSave(printAfter) {
  const customer_name = document.getElementById('jCustomer').value.trim();
  if (!customer_name) { showAlert('اسم العميل مطلوب', 'error'); return; }
  const r = await API.post('/api/maintenance/jobs', {
    customer_name,
    customer_phone: document.getElementById('jPhone').value.trim(),
    device: document.getElementById('jDevice').value.trim(),
    problem: document.getElementById('jProblem').value.trim(),
    labor_cost: Number(document.getElementById('jLabor').value) || 0,
    deposit: Number(document.getElementById('jDeposit').value) || 0,
    due_date: document.getElementById('jDue').value || null,
    claim_until: document.getElementById('jClaim').value || null,
    notes: document.getElementById('jNotes').value.trim(),
  });
  closeModal();
  showAlert('تم إنشاء أمر الصيانة ' + r.job_no);
  maintRefreshJobs();
  if (printAfter) jobPrint(r.id);
}

async function jobDetail(id) {
  const j = await API.get('/api/maintenance/jobs/' + id);
  const st = JOB_STATUS[j.status] || JOB_STATUS.received;
  const remaining = (j.total || 0) - (j.paid || 0);
  const parts = await API.get('/api/spare-parts');
  const activeParts = parts.filter(p => p.active);
  openModal(`
    <div class="modal-head"><h3>🔧 ${esc(j.job_no)} — ${esc(j.customer_name || '')}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="grid-2">
      <div class="form-group"><label>اسم العميل</label><input id="jdCustomer" value="${esc(j.customer_name || '')}"></div>
      <div class="form-group"><label>الهاتف</label><input id="jdPhone" dir="ltr" value="${esc(j.customer_phone || '')}"></div>
      <div class="form-group"><label>الجهاز</label><input id="jdDevice" value="${esc(j.device || '')}"></div>
      <div class="form-group"><label>أجر الصيانة</label><input type="number" id="jdLabor" step="0.01" value="${j.labor_cost || 0}"></div>
      <div class="form-group"><label>📅 موعد التسليم المتوقع</label><input type="date" id="jdDue" value="${esc(j.due_date || '')}"></div>
      <div class="form-group"><label>⏰ آخر موعد للاستلام</label><input type="date" id="jdClaim" value="${esc(j.claim_until || '')}"></div>
    </div>
    <div class="form-group"><label>وصف المشكلة</label><textarea id="jdProblem" rows="2">${esc(j.problem || '')}</textarea></div>
    <div class="form-group"><label>ملاحظات</label><input id="jdNotes" value="${esc(j.notes || '')}"></div>

    <div class="card-title mt-10">⚙️ القطع المستخدمة</div>
    <div class="table-wrap"><table>
      <thead><tr><th>القطعة</th><th>المورد</th><th class="num">الكمية</th><th class="num">سعر البيع</th><th class="num">سعر الشراء</th><th class="num">الإجمالي</th><th></th></tr></thead>
      <tbody>${j.parts.map(p => `
        <tr>
          <td>${esc(p.part_name)}</td>
          <td class="small">${esc(p.supplier_name || '—')}</td>
          <td class="num">${fmt(p.qty)}</td>
          <td class="num">${fmt(p.price)}</td>
          <td class="num small">${fmt(p.purchase_price || 0)}</td>
          <td class="num">${fmt(p.total)}</td>
          <td><button class="btn btn-danger btn-sm" onclick="jobRemovePart(${j.id}, ${p.id})">🗑️</button></td>
        </tr>`).join('') || '<tr><td colspan="7"><div class="empty">لا توجد قطع</div></td></tr>'}
    </tbody></table></div>

    <div class="grid-2 mt-10">
      <div class="form-group"><label>إضافة قطعة من المخزن (🔍 ابحث بالاسم أو المورد)</label>
        <input type="search" id="jdPartSearch" placeholder="اكتب اسم القطعة..." autocomplete="off">
        <input type="hidden" id="jdPartPick">
        <div id="jdPartSel" class="small muted"></div>
        <div id="jdPartResults" style="display:none;max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--card,#fff)"></div>
      </div>
      <div class="form-group"><label>الكمية</label><input type="number" id="jdPartQty" step="0.01" value="1" min="0.01"></div>
    </div>
    <button class="btn btn-secondary btn-sm" onclick="jobAddPart(${j.id})">➕ إضافة القطعة للأمر</button>

    <div class="card mt-10" style="padding:10px">
      <div class="r-line flex-between"><span>تكلفة شراء القطع</span><b>${fmt(j.parts_purchase)}</b></div>
      <div class="r-line flex-between"><span>ربح الصيانة (الإجمالي − تكلفة القطع)</span><b style="color:var(--success)">${fmt(j.profit)}</b></div>
      <div class="r-line flex-between mt-5"><span>الإجمالي على العميل</span><b>${fmt(j.total)}</b></div>
      <div class="r-line flex-between"><span>العربون / المسدد</span><b>${fmt(j.paid)} ${j.deposit ? '(منه عربون ' + fmt(j.deposit) + ')' : ''}</b></div>
      <div class="r-line flex-between"><span>المتبقي</span><b style="color:${remaining > 0.001 ? 'var(--danger)' : 'var(--success)'}">${fmt(remaining)}</b></div>
    </div>

    <div class="grid-2 mt-10">
      <div class="form-group"><label>تحديث الحالة</label>
        <select id="jdStatus">${Object.entries(JOB_STATUS).map(([k, v]) => `<option value="${k}" ${j.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="form-group"><label>&nbsp;</label>
        <button class="btn btn-accent" style="width:100%" onclick="jobPayForm(${j.id})">💵 تسديد دفعة / تقفيل الأمر</button></div>
    </div>

    <div class="card mt-10" style="padding:10px">
      <div class="card-title" style="margin-bottom:6px">🧾 بيان الدفعات</div>
      <div id="jdPayments"><div class="empty small">جاري التحميل...</div></div>
    </div>

    <div class="small muted mt-10">أنشأه: ${esc(j.created_by || '—')} — ${fmtDate(j.created_at)}${j.delivered_at ? ' — تم التسليم: ' + fmtDate(j.delivered_at) : ''}</div>
    <div class="modal-foot">
      <button class="btn" onclick="jobSaveEdit(${j.id})">💾 حفظ التعديلات</button>
      <button class="btn btn-accent" onclick="jobPrint(${j.id})">🖨️ طباعة الإيصال</button>
      <button class="btn btn-secondary" onclick="closeModal()">إغلاق</button>
    </div>
  `, true);
  jobLoadPayments(j.id);
  MAINT.partCache = activeParts;
  const inp = document.getElementById('jdPartSearch');
  inp.addEventListener('input', () => maintDrawPartResults(inp.value.trim()));
  inp.addEventListener('focus', () => maintDrawPartResults(inp.value.trim()));
  inp.addEventListener('blur', () => setTimeout(() => { const r = document.getElementById('jdPartResults'); if (r) r.style.display = 'none'; }, 200));
}

function maintDrawPartResults(q) {
  const res = document.getElementById('jdPartResults');
  if (!res) return;
  let list = MAINT.partCache || [];
  if (q) list = list.filter(p => (p.name || '').includes(q) || (p.supplier_name || '').includes(q));
  res.innerHTML = list.slice(0, 30).map(p => `
    <div style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border)" onmousedown="maintPickPart(${p.id})">
      <b>${esc(p.name)}</b> — ${fmt(p.sale_price)} — متاح ${fmt(p.stock)}${p.supplier_name ? ` <span class="small muted">(${esc(p.supplier_name)})</span>` : ''}
    </div>`).join('') || '<div class="empty small" style="padding:8px">لا توجد نتائج مطابقة</div>';
  res.style.display = 'block';
}

function maintPickPart(id) {
  const p = (MAINT.partCache || []).find(x => x.id === id);
  if (!p) return;
  document.getElementById('jdPartPick').value = p.id;
  document.getElementById('jdPartSearch').value = p.name;
  document.getElementById('jdPartSel').textContent = `✔ ${p.name} — سعر البيع ${fmt(p.sale_price)} — متاح ${fmt(p.stock)}`;
  const r = document.getElementById('jdPartResults');
  if (r) r.style.display = 'none';
}

async function jobSaveEdit(id) {
  try {
    await API.put('/api/maintenance/jobs/' + id, {
      customer_name: document.getElementById('jdCustomer').value.trim(),
      customer_phone: document.getElementById('jdPhone').value.trim(),
      device: document.getElementById('jdDevice').value.trim(),
      problem: document.getElementById('jdProblem').value.trim(),
      labor_cost: Number(document.getElementById('jdLabor').value) || 0,
      due_date: document.getElementById('jdDue').value || null,
      claim_until: document.getElementById('jdClaim').value || null,
      notes: document.getElementById('jdNotes').value.trim(),
      status: document.getElementById('jdStatus').value,
    });
    showAlert('تم الحفظ');
    jobDetail(id);
    maintRefreshJobs();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function jobPrint(id) {
  const j = await API.get('/api/maintenance/jobs/' + id);
  const st = JOB_STATUS[j.status] || JOB_STATUS.received;
  const remaining = Math.max(0, (j.total || 0) - (j.paid || 0));
  const cur = SETTINGS.currency || 'ج';
  const html = [
    `<div class="r-head">`,
    `<h3>${esc(SETTINGS.store_name || 'سوبر ماركت')}</h3>`,
    `<div><b>إيصال صيانة</b></div>`,
    `<div>رقم الأمر: <b>${esc(j.job_no)}</b></div>`,
    `<div>${fmtDate(j.created_at)}</div>`,
    `</div>`,
    `<div>العميل: ${esc(j.customer_name || '—')}</div>`,
    j.customer_phone ? `<div>الهاتف: ${esc(j.customer_phone)}</div>` : '',
    j.device ? `<div>الجهاز: ${esc(j.device)}</div>` : '',
    j.problem ? `<div>المشكلة: ${esc(j.problem)}</div>` : '',
    `<div class="dashed"></div>`,
    j.due_date ? `<div><b>موعد التسليم المتوقع:</b> ${esc(j.due_date)}</div>` : '',
    j.claim_until ? `<div><b>آخر موعد لاستلام الجهاز:</b> ${esc(j.claim_until)}</div>` : '',
    j.claim_until ? `<div style="font-size:11px">(بعد هذا التاريخ يحق للمحل التصرف في الجهاز)</div>` : '',
    `<div class="dashed"></div>`,
    j.parts.length ? [`<table>`,
      `<thead><tr><td style="text-align:right"><b>القطعة</b></td><td style="text-align:center"><b>كمية</b></td><td style="text-align:left"><b>سعر</b></td><td style="text-align:left"><b>إجمالي</b></td></tr></thead><tbody>`,
      ...j.parts.map(p => `<tr><td style="text-align:right">${esc(p.part_name)}</td><td style="text-align:center">${fmt(p.qty)}</td><td style="text-align:left">${fmt(p.price)}</td><td style="text-align:left">${fmt(p.total)}</td></tr>`),
      `</tbody></table>`].join('\n') : '',
    `<div class="dashed"></div>`,
    j.parts.length ? `<div class="r-line"><span>قطع الغيار</span><span>${fmt(j.parts_cost)}</span></div>` : '',
    `<div class="r-line"><span>أجر الصيانة</span><span>${fmt(j.labor_cost)}</span></div>`,
    `<div class="r-line r-total"><span>الإجمالي</span><span>${fmt(j.total)} ${esc(cur)}</span></div>`,
    j.deposit ? `<div class="r-line"><span>العربون المدفوع</span><span>${fmt(j.deposit)}</span></div>` : '',
    `<div class="r-line"><span>المسدد</span><span>${fmt(j.paid)}</span></div>`,
    `<div class="r-line r-total"><span>المتبقي عند الاستلام</span><span>${fmt(remaining)} ${esc(cur)}</span></div>`,
    `<div class="dashed"></div>`,
    `<div>الحالة: <b>${st.label}</b></div>`,
    j.notes ? `<div>ملاحظات: ${esc(j.notes)}</div>` : '',
    `<div class="bc">`,
    `<img src="${barcodeImg(j.job_no, { scale: 2, height: 10 })}" alt="barcode" style="width:34mm;height:auto">`,
    `<div class="code-text">${esc(j.job_no)}</div>`,
    `<div style="font-size:11px">امسح الباركود في صفحة الصيانة للاستعلام عن الأمر</div>`,
    `</div>`,
    `<div class="r-foot">${esc(SETTINGS.invoice_footer || 'شكراً لتعاملكم معنا')}</div>`,
  ].filter(Boolean).join('\n');
  openPrintModal(html, 'invoice', 'إيصال صيانة ' + j.job_no);
}

async function jobAddPart(jobId) {
  const partSel = document.getElementById('jdPartPick');
  const qty = Number(document.getElementById('jdPartQty').value) || 0;
  if (!partSel.value) { showAlert('ابحث واختر قطعة من المخزن أولاً', 'error'); return; }
  if (qty <= 0) { showAlert('كمية غير صحيحة', 'error'); return; }
  try {
    await API.post('/api/maintenance/jobs/' + jobId + '/parts', { part_id: Number(partSel.value), qty });
    showAlert('تمت إضافة القطعة');
    jobDetail(jobId);
  } catch (e) { showAlert(e.message, 'error'); }
}

async function jobRemovePart(jobId, lineId) {
  if (!confirm('إزالة هذه القطعة من الأمر؟ ستعود الكمية للمخزن')) return;
  try {
    await API.del('/api/maintenance/jobs/' + jobId + '/parts/' + lineId);
    jobDetail(jobId);
  } catch (e) { showAlert(e.message, 'error'); }
}

async function jobDelete(id) {
  if (!confirm('حذف أمر الصيانة نهائياً؟ ستعود قطعه لمخزن قطع الغيار')) return;
  try {
    await API.del('/api/maintenance/jobs/' + id);
    showAlert('تم الحذف');
    maintRefreshJobs();
  } catch (e) { showAlert(e.message, 'error'); }
}

/* ==================== JOB PAYMENTS ==================== */
async function jobLoadPayments(jobId) {
  const box = document.getElementById('jdPayments');
  if (!box) return;
  try {
    const list = await API.get('/api/maintenance/jobs/' + jobId + '/payments');
    MAINT.paymentsCache = list;
    box.innerHTML = list.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>التاريخ</th><th>النوع</th><th>الطريقة</th><th>بواسطة</th><th class="num">المبلغ</th></tr></thead>
        <tbody>${list.map(p => {
          const isDep = (p.note || '').includes('عربون');
          return `<tr>
            <td class="small">${fmtDate(p.created_at)}</td>
            <td>${isDep ? '<span class="badge badge-orange">عربون</span>' : '<span class="badge badge-green">تسديد</span>'}</td>
            <td class="small">${PAY_METHOD[p.method] || p.method}</td>
            <td class="small">${esc(p.user_name || '—')}</td>
            <td class="num"><b>${fmt(p.amount)}</b></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<div class="empty small">لا توجد دفعات مسجلة على هذا الأمر</div>';
  } catch (e) { box.innerHTML = `<div class="empty small">${esc(e.message)}</div>`; }
}

async function jobPayForm(jobId) {
  const j = await API.get('/api/maintenance/jobs/' + jobId);
  const remaining = Math.max(0, Math.round(((j.total || 0) - (j.paid || 0)) * 100) / 100);
  const closed = j.status === 'delivered';
  openModal(`
    <div class="modal-head"><h3>💵 تسديد — ${esc(j.job_no)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="alert success" style="margin-bottom:10px">
      الإجمالي: <b>${fmt(j.total)}</b> — المسدد: <b>${fmt(j.paid)}</b> — المتبقي: <b style="color:${remaining > 0.001 ? 'var(--danger)' : 'var(--success)'}">${fmt(remaining)}</b>
    </div>
    ${remaining <= 0.001 && !closed ? '<div class="alert success">تم سداد كامل المبلغ — يمكنك تقفيل الأمر وتسليمه</div>' : ''}
    <div class="grid-2">
      <div class="form-group"><label>المبلغ المسدد الآن</label><input type="number" id="payAmount" step="0.01" value="${remaining > 0.001 ? remaining : 0}" ${remaining <= 0.001 ? 'disabled' : ''}></div>
      <div class="form-group"><label>طريقة الدفع</label>
        <select id="payMethod">
          <option value="cash">كاش</option>
          <option value="card">كارت</option>
          <option value="wallet">محفظة إلكترونية</option>
        </select></div>
    </div>
    <div class="form-group"><label>ملاحظة</label><input id="payNote" placeholder="مثال: باقي قيمة الأجر"></div>
    ${!closed ? '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="payClose" style="width:auto"> 🔒 تقفيل الأمر وتسليمه للعميل</label></div>'
              : '<div class="small muted">هذا الأمر مقفل بالفعل — يمكنك تسجيل دفعة إضافية إن وجدت</div>'}
    <div class="modal-foot">
      <button class="btn btn-accent" onclick="jobPaySave(${jobId})">✔ تأكيد التسديد</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
  const cb = document.getElementById('payClose');
  if (cb) cb.addEventListener('change', () => {
    const amt = document.getElementById('payAmount');
    if (cb.checked && remaining > 0.001) { amt.value = remaining; amt.disabled = true; }
    else if (remaining > 0.001) amt.disabled = false;
  });
}

async function jobPaySave(jobId) {
  const amount = Number(document.getElementById('payAmount').value) || 0;
  const method = document.getElementById('payMethod').value;
  const note = document.getElementById('payNote').value.trim();
  const closeEl = document.getElementById('payClose');
  const close = !!(closeEl && closeEl.checked);
  if (amount <= 0 && !(close)) { showAlert('أدخل مبلغاً صحيحاً', 'error'); return; }
  try {
    await API.post('/api/maintenance/jobs/' + jobId + '/pay', { amount, method, note, close });
    closeModal();
    showAlert(close ? 'تم التسديد وتقفيل الأمر ✅' : 'تم تسجيل الدفعة ✅');
    jobDetail(jobId);
    maintRefreshJobs();
  } catch (e) { showAlert(e.message, 'error'); }
}

/* ==================== SPARE PARTS ==================== */
async function maintLoadParts() {
  const body = document.getElementById('maintBody');
  body.innerHTML = `
    <div class="toolbar" style="margin-top:10px">
      <input type="search" id="spSearch" placeholder="🔍 بحث باسم القطعة..." class="grow">
      <button class="btn" onclick="spOpenForm()">➕ قطعة جديدة</button>
    </div>
    <div class="card">
      <div class="card-title">⚙️ قطع الغيار وأسعارها</div>
      <div class="table-wrap"><table>
        <thead><tr><th>القطعة</th><th>آخر مورد</th><th class="num">سعر الشراء</th><th class="num">سعر البيع</th><th class="num">المخزون</th><th class="num">الحد الأدنى</th><th></th></tr></thead>
        <tbody id="spTable"><tr><td colspan="7"><div class="empty">جاري التحميل...</div></td></tr></tbody>
      </table></div>
    </div>`;
  document.getElementById('spSearch').addEventListener('input', (e) => maintRefreshParts(e.target.value.trim()));
  maintRefreshParts('');
}

async function maintRefreshParts(q) {
  const list = await API.get('/api/spare-parts' + (q ? '?q=' + encodeURIComponent(q) : ''));
  document.getElementById('spTable').innerHTML = list.map(p => `
    <tr>
      <td><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="badge badge-gray">موقوفة</span>'}</td>
      <td class="small">${esc(p.last_supplier || p.supplier_name || '—')}</td>
      <td class="num">${fmt(p.purchase_price)}</td>
      <td class="num"><b>${fmt(p.sale_price)}</b></td>
      <td class="num">${p.stock <= p.min_stock ? `<span class="badge badge-red">${fmt(p.stock)}</span>` : fmt(p.stock)}</td>
      <td class="num">${fmt(p.min_stock)}</td>
      <td><div class="flex" style="gap:4px">
        <button class="btn btn-secondary btn-sm" onclick="spOpenForm(${p.id})">تعديل</button>
        <button class="btn btn-warning btn-sm" onclick="spStockForm(${p.id}, '${esc(p.name)}', ${p.stock}, ${Number(p.purchase_price) || 0})">مخزون</button>
        <button class="btn btn-danger btn-sm" onclick="spDelete(${p.id})">🗑️</button>
      </div></td>
    </tr>`).join('') || '<tr><td colspan="7"><div class="empty">لا توجد قطع غيار</div></td></tr>';
}

async function spOpenForm(id) {
  let p = null;
  if (id) {
    const list = await API.get('/api/spare-parts');
    p = list.find(x => x.id == id);
  }
  openModal(`
    <div class="modal-head"><h3>${p ? 'تعديل قطعة' : '➕ قطعة غيار جديدة'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="grid-2">
      <div class="form-group"><label>اسم القطعة *</label><input id="spName" value="${esc(p?.name || '')}"></div>
      <div class="form-group"><label>سعر البيع</label><input type="number" id="spSale" step="0.01" value="${p?.sale_price || 0}"></div>
      <div class="form-group"><label>المخزون</label><input type="number" id="spStock" step="0.01" value="${p?.stock || 0}"></div>
      <div class="form-group"><label>الحد الأدنى</label><input type="number" id="spMin" step="0.01" value="${p?.min_stock || 0}"></div>
    </div>
    ${p ? '' : '<div class="alert alert-info" style="margin-top:8px">💡 الكمية الابتدائية تتسجل كرصيد افتتاحي بدون تورية — استخدم زرار «مخزون» بعدها لتسجيل التوريات بالمورد والسعر</div>'}
    <div class="modal-foot">
      <button class="btn" onclick="spSave(${p?.id || 0})">حفظ</button>
      ${p ? `<button class="btn btn-warning" onclick="spToggle(${p.id}, ${p.active ? 0 : 1})">${p.active ? 'إيقاف' : 'تفعيل'}</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
}

async function spSave(id) {
  const name = document.getElementById('spName').value.trim();
  if (!name) { showAlert('اسم القطعة مطلوب', 'error'); return; }
  const body = {
    name,
    purchase_price: Number(document.getElementById('spPurchase')?.value) || undefined,
    sale_price: Number(document.getElementById('spSale').value) || 0,
    stock: Number(document.getElementById('spStock').value) || 0,
    min_stock: Number(document.getElementById('spMin').value) || 0,
  };
  if (id) { await API.put('/api/spare-parts/' + id, body); showAlert('تم التعديل'); }
  else { await API.post('/api/spare-parts', body); showAlert('تمت الإضافة'); }
  closeModal();
  maintRefreshParts('');
}

function spStockForm(id, name, stock, lastPrice) {
  MAINT.stockSuppliers = [];
  API.get('/api/part-suppliers').then(list => {
    MAINT.stockSuppliers = list;
    const sel = document.getElementById('spSup');
    if (sel) sel.innerHTML = '<option value="">— اختر المورد —</option>' +
      list.map(s => `<option value="${s.id}">${esc(s.name)}${s.balance > 0.001 ? ' (عليه ' + fmt(s.balance) + ')' : ''}</option>`).join('');
  });
  openModal(`
    <div class="modal-head"><h3>📦 حركة مخزون: ${esc(name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="form-group"><label>الكمية (+ تورية / − خصم تصحيح)</label><input type="number" id="spDelta" step="0.01" value="1" oninput="spStockToggleFields()"></div>
    <div id="stockInFields">
      <div class="form-group"><label>المورد *</label><select id="spSup"><option value="">— جاري التحميل —</option></select></div>
      <div class="grid-2">
        <div class="form-group"><label>سعر شراء الوحدة</label><input type="number" id="spCost" step="0.01" value="${lastPrice || 0}" oninput="spStockCalcTotal()"></div>
        <div class="form-group"><label>إجمالي التورية</label><input type="text" id="spCostTotal" readonly style="background:#f5f5f5;font-weight:bold" value="0" onfocus="spStockCalcTotal()"></div>
      </div>
    </div>
    <div class="form-group"><label>ملاحظة (رقم فاتورة التورة مثلاً)</label><input id="spMoveNote"></div>
    <div class="modal-foot"><button class="btn" onclick="spStockSave(${id})">حفظ الحركة</button><button class="btn btn-secondary" onclick="closeModal()">إلغاء</button></div>
  `);
  setTimeout(() => { const d = document.getElementById('spDelta'); if (d) { d.value = ''; d.focus(); } }, 50);
}
function spStockToggleFields() {
  const delta = Number(document.getElementById('spDelta').value) || 0;
  document.getElementById('stockInFields').style.display = delta > 0 ? '' : 'none';
  spStockCalcTotal();
}
function spStockCalcTotal() {
  const t = document.getElementById('spCostTotal');
  if (!t) return;
  const qty = Math.abs(Number(document.getElementById('spDelta').value) || 0);
  const cost = Number(document.getElementById('spCost').value) || 0;
  t.value = fmt(qty * cost);
}
async function spStockSave(id) {
  const delta = Number(document.getElementById('spDelta').value) || 0;
  if (!delta) { showAlert('أدخل كمية صحيحة', 'error'); return; }
  const supEl = document.getElementById('spSup');
  const cost = Number(document.getElementById('spCost')?.value) || 0;
  if (delta > 0 && !(supEl && supEl.value)) { showAlert('حدد المورد الخاص بهذه التورة', 'error'); return; }
  try {
    await API.post('/api/spare-parts/' + id + '/stock', {
      delta,
      supplier_id: supEl && supEl.value ? Number(supEl.value) : null,
      purchase_price: delta > 0 ? cost : 0,
      note: document.getElementById('spMoveNote').value.trim(),
    });
    closeModal();
    showAlert(delta > 0 ? 'تم تسجيل التورية ✅' : 'تم خصم الكمية');
    maintRefreshParts('');
  } catch (e) { showAlert(e.message, 'error'); }
}

async function spToggle(id, active) {
  await API.put('/api/spare-parts/' + id, { active });
  closeModal();
  maintRefreshParts('');
}

async function spDelete(id) {
  if (!confirm('حذف هذه القطعة؟')) return;
  try {
    await API.del('/api/spare-parts/' + id);
    showAlert('تم الحذف');
    maintRefreshParts('');
  } catch (e) { showAlert(e.message, 'error'); }
}

/* ==================== PART SUPPLIERS ==================== */
const SUP_PAY_METHOD = { cash: 'كاش', card: 'كارت', wallet: 'محفظة', transfer: 'تحويل بنكي' };

async function maintLoadSuppliers() {
  const body = document.getElementById('maintBody');
  body.innerHTML = `
    <div class="toolbar" style="margin-top:10px">
      <div class="grow"></div>
      <button class="btn" onclick="psOpenForm()">➕ مورد قطع غيار</button>
    </div>
    <div class="card">
      <div class="card-title">🚚 موردو قطع الغيار</div>
      <div class="table-wrap"><table>
        <thead><tr><th>الاسم</th><th>الهاتف</th><th class="num">إجمالي التوريات</th><th class="num">المسدد</th><th class="num">المتبقي عليه</th><th></th></tr></thead>
        <tbody id="psTable"><tr><td colspan="6"><div class="empty">جاري التحميل...</div></td></tr></tbody>
      </table></div>
    </div>`;
  const list = await API.get('/api/part-suppliers');
  document.getElementById('psTable').innerHTML = list.map(s => {
    const balance = Math.round(((Number(s.purchased_total) || 0) - (Number(s.paid_total) || 0)) * 100) / 100;
    return `<tr>
      <td><b>${esc(s.name)}</b>${s.address ? `<div class="small muted">${esc(s.address)}</div>` : ''}</td>
      <td class="small" dir="ltr">${esc(s.phone || '—')}</td>
      <td class="num">${fmt(s.purchased_total)}</td>
      <td class="num" style="color:var(--green,#16a34a)"><b>${fmt(s.paid_total)}</b></td>
      <td class="num">${balance > 0.001 ? `<span class="badge badge-red">${fmt(balance)} ${SETTINGS.currency || 'ج'}</span>` : '<span class="badge badge-green">مسدد ✅</span>'}</td>
      <td><div class="flex" style="gap:4px">
        <button class="btn btn-sm" onclick="psPayForm(${s.id}, '${esc(s.name).replace(/'/g, '\\&#39;')}', ${balance})">💵 سداد</button>
        <button class="btn btn-secondary btn-sm" onclick="psStatement(${s.id}, '${esc(s.name).replace(/'/g, '\\&#39;')}')">🧾 بيان</button>
        <button class="btn btn-secondary btn-sm" onclick="psOpenForm(${s.id})">تعديل</button>
        <button class="btn btn-danger btn-sm" onclick="psDelete(${s.id})">🗑️</button>
      </div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6"><div class="empty">لا يوجد موردون</div></td></tr>';
}

function psPayForm(id, name, balance) {
  openModal(`
    <div class="modal-head"><h3>💵 سداد لمورد: ${esc(name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    ${balance > 0.001 ? `<div class="alert alert-warning" style="margin-bottom:10px">المتبقي على حسابه: <b>${fmt(balance)} ${SETTINGS.currency || 'ج'}</b></div>` : ''}
    <div class="grid-2">
      <div class="form-group"><label>المبلغ *</label><input type="number" id="psPayAmount" step="0.01" value="${balance > 0 ? balance : ''}"></div>
      <div class="form-group"><label>طريقة السداد</label>
        <select id="psPayMethod">${Object.entries(SUP_PAY_METHOD).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>ملاحظة</label><input id="psPayNote"></div>
    <div class="modal-foot"><button class="btn" onclick="psPaySave(${id})">تأكيد السداد</button><button class="btn btn-secondary" onclick="closeModal()">إلغاء</button></div>
  `);
  setTimeout(() => { const a = document.getElementById('psPayAmount'); if (a) a.focus(); }, 50);
}

async function psPaySave(id) {
  const amount = Number(document.getElementById('psPayAmount').value) || 0;
  if (amount <= 0) { showAlert('أدخل مبلغاً صحيحاً', 'error'); return; }
  try {
    await API.post('/api/part-suppliers/' + id + '/pay', {
      amount,
      method: document.getElementById('psPayMethod').value,
      note: document.getElementById('psPayNote').value.trim(),
    });
    closeModal();
    showAlert('تم تسجيل السداد ✅');
    maintLoadSuppliers();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function psStatement(id, name) {
  const data = await API.get('/api/part-suppliers/' + id + '/payments');
  const rows = [
    ...data.purchases.map(m => ({
      date: m.created_at, type: 'in',
      label: `تورية: ${m.part_name} × ${fmt(m.qty)}` + (m.note ? ` — ${esc(m.note)}` : ''),
      debit: m.qty * m.purchase_price, credit: 0,
    })),
    ...data.payments.map(p => ({
      date: p.created_at, type: 'out',
      label: `سداد (${SUP_PAY_METHOD[p.method] || p.method})` + (p.note ? ` — ${esc(p.note)}` : '') + (p.user_name ? ` — بواسطة ${esc(p.user_name)}` : ''),
      debit: 0, credit: p.amount,
    })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let running = 0;
  const body = rows.map(r => {
    running += r.debit - r.credit;
    return `<tr>
      <td class="small">${fmtDate(r.date)}</td>
      <td class="small">${r.type === 'in' ? '<span class="badge badge-orange">تورية</span>' : '<span class="badge badge-green">سداد</span>'}</td>
      <td class="small">${r.label}</td>
      <td class="num">${r.debit ? fmt(r.debit) : '—'}</td>
      <td class="num">${r.credit ? fmt(r.credit) : '—'}</td>
      <td class="num"><b>${fmt(running)}</b></td>
    </tr>`;
  }).join('');
  openModal(`
    <div class="modal-head"><h3>🧾 كشف حساب مورد: ${esc(name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="stat-grid" style="margin-bottom:10px">
      <div class="stat orange"><div class="label">إجمالي التوريات</div><div class="value">${fmt(data.totals.purchased)}</div></div>
      <div class="stat green"><div class="label">إجمالي المسدد</div><div class="value">${fmt(data.totals.paid)}</div></div>
      <div class="stat red"><div class="label">المتبقي</div><div class="value">${fmt(Math.round((data.totals.purchased - data.totals.paid) * 100) / 100)}</div></div>
    </div>
    <div class="table-wrap" style="max-height:50vh;overflow:auto"><table>
      <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th class="num">مدين</th><th class="num">دفع</th><th class="num">الرصيد</th></tr></thead>
      <tbody>${body || '<tr><td colspan="6"><div class="empty">لا توجد حركات</div></td></tr>'}</tbody>
    </table></div>
    <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal()">إغلاق</button></div>
  `, true);
}

async function psOpenForm(id) {
  let s = null;
  if (id) {
    const list = await API.get('/api/part-suppliers');
    s = list.find(x => x.id == id);
  }
  openModal(`
    <div class="modal-head"><h3>${s ? 'تعديل مورد' : '➕ مورد قطع غيار'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="form-group"><label>الاسم *</label><input id="psName" value="${esc(s?.name || '')}"></div>
    <div class="grid-2">
      <div class="form-group"><label>الهاتف</label><input id="psPhone" dir="ltr" value="${esc(s?.phone || '')}"></div>
      <div class="form-group"><label>العنوان</label><input id="psAddress" value="${esc(s?.address || '')}"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="psSave(${s?.id || 0})">حفظ</button><button class="btn btn-secondary" onclick="closeModal()">إلغاء</button></div>
  `);
}

async function psSave(id) {
  const name = document.getElementById('psName').value.trim();
  if (!name) { showAlert('الاسم مطلوب', 'error'); return; }
  const body = {
    name,
    phone: document.getElementById('psPhone').value.trim(),
    address: document.getElementById('psAddress').value.trim(),
  };
  if (id) { await API.put('/api/part-suppliers/' + id, body); showAlert('تم التعديل'); }
  else { await API.post('/api/part-suppliers', body); showAlert('تمت الإضافة'); }
  closeModal();
  maintLoadSuppliers();
}

async function psDelete(id) {
  if (!confirm('حذف هذا المورد؟')) return;
  try {
    await API.del('/api/part-suppliers/' + id);
    showAlert('تم الحذف');
    maintLoadSuppliers();
  } catch (e) { showAlert(e.message, 'error'); }
}
