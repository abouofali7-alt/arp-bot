let REP = { from: '', to: '', activeTab: 'summary', search: '' };
const PAYS = { cash: '💵 كاش', card: '💳 فيزا/شبكة', wallet: '📱 محفظة', transfer: '🏦 تحويل بنكي', credit: '📝 آجل' };

async function renderReports() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="card mb-10" style="padding:14px">
      <div class="toolbar mb-10" style="gap:8px;flex-wrap:wrap">
        <label class="small muted" style="display:flex;align-items:center;gap:4px">من: <input type="date" id="repFrom" onchange="reportsLoad()"></label>
        <label class="small muted" style="display:flex;align-items:center;gap:4px">إلى: <input type="date" id="repTo" onchange="reportsLoad()"></label>
        <button class="btn btn-secondary btn-sm" onclick="repPreset('today')">اليوم</button>
        <button class="btn btn-secondary btn-sm" onclick="repPreset('week')">هذا الأسبوع</button>
        <button class="btn btn-secondary btn-sm" onclick="repPreset('month')">هذا الشهر</button>
        <button class="btn btn-secondary btn-sm" onclick="repPreset('all')">كل الفترات</button>
        <div class="grow"></div>
        <input type="search" id="repTableSearch" placeholder="🔍 تصفية البحث في التقرير..." style="width:200px;padding:6px 10px" oninput="repSearchFilter(this.value)">
        <button class="btn btn-ghost btn-sm" onclick="exportReportPDF()">📄 تصدير PDF</button>
        <button class="btn btn-ghost btn-sm" onclick="openPrintModal(reportHtml(), 'report', 'تقرير تفصيلي شامل')">🖨️ طباعة</button>
      </div>

      <div class="tabs" id="repTabs" style="display:flex;gap:4px;flex-wrap:wrap;border-bottom:2px solid var(--border);padding-bottom:6px">
        <button class="tab-btn active" data-tab="summary" onclick="repSwitchTab('summary')">🌐 التقرير الشامل</button>
        <button class="tab-btn" data-tab="sales" onclick="repSwitchTab('sales')">🧾 المبيعات والأصناف</button>
        <button class="tab-btn" data-tab="purchases" onclick="repSwitchTab('purchases')">📦 المشتريات والموردين</button>
        <button class="tab-btn" data-tab="inventory" onclick="repSwitchTab('inventory')">📋 المخزون والجرد والسيريالات</button>
        <button class="tab-btn" data-tab="maintenance" onclick="repSwitchTab('maintenance')">🔧 الصيانة وقطع الغيار</button>
        <button class="tab-btn" data-tab="used_devices" onclick="repSwitchTab('used_devices')">📱 الأجهزة المستعملة</button>
        <button class="tab-btn" data-tab="expenses" onclick="repSwitchTab('expenses')">💸 المصروفات والموظفين</button>
        <button class="tab-btn" data-tab="movements" onclick="repSwitchTab('movements')">👥 حركات الموردين والعملاء</button>
        <button class="tab-btn" data-tab="shifts" onclick="repSwitchTab('shifts')">⏱️ الورديات والدرج</button>
        <button class="tab-btn" data-tab="partners" onclick="repSwitchTab('partners')">🧮 الشركاء والأرباح</button>
      </div>
    </div>
    <div id="repResults"><div class="empty" style="padding:60px">جاري تحميل بيانات التقارير...</div></div>`;

  await reportsLoad();
}

function repPreset(mode) {
  const from = document.getElementById('repFrom');
  const to = document.getElementById('repTo');
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (mode === 'today') {
    from.value = todayStr; to.value = todayStr;
  } else if (mode === 'week') {
    const w = new Date();
    w.setDate(w.getDate() - 7);
    from.value = `${w.getFullYear()}-${pad(w.getMonth() + 1)}-${pad(w.getDate())}`;
    to.value = todayStr;
  } else if (mode === 'month') {
    from.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    to.value = todayStr;
  } else if (mode === 'all') {
    from.value = ''; to.value = '';
  }
  reportsLoad();
}

function repSwitchTab(tabName) {
  REP.activeTab = tabName;
  document.querySelectorAll('#repTabs .tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  renderActiveTab();
}

function repSearchFilter(q) {
  REP.search = String(q || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#repResults table tbody tr');
  rows.forEach(r => {
    if (!REP.search) { r.style.display = ''; return; }
    const txt = r.textContent.toLowerCase();
    r.style.display = txt.includes(REP.search) ? '' : 'none';
  });
}

async function reportsLoad() {
  REP.from = document.getElementById('repFrom')?.value || '';
  REP.to = document.getElementById('repTo')?.value || '';
  const params = new URLSearchParams();
  if (REP.from) params.set('from', REP.from);
  if (REP.to) params.set('to', REP.to);

  const [
    summary, byCashier, daily, sales, purchasesRep, shiftsRep,
    inventory, serials, stocktakes, partiesSum, movements,
    maintRep, usedDevsRep, expenses, employeesRep, catSales
  ] = await Promise.all([
    API.get('/api/reports/summary?' + params),
    API.get('/api/reports/by-cashier?' + params),
    API.get('/api/reports/daily?' + params),
    API.get('/api/sales?' + params),
    API.get('/api/reports/purchases?' + params),
    API.get('/api/reports/shifts?' + params),
    API.get('/api/reports/inventory'),
    API.get('/api/reports/serials'),
    API.get('/api/reports/stocktakes'),
    API.get('/api/reports/parties-summary'),
    API.get('/api/reports/party-movements?' + params),
    API.get('/api/maintenance/report?' + params),
    API.get('/api/reports/used-devices?' + params),
    API.get('/api/expenses?' + params),
    API.get('/api/reports/employees?' + params),
    API.get('/api/reports/categories-sales?' + params),
  ]);

  window.REP_DATA = {
    summary, byCashier, daily, sales, purchasesRep, shiftsRep,
    inventory, serials, stocktakes, partiesSum, movements,
    maintRep, usedDevsRep, expenses, employeesRep, catSales
  };

  renderActiveTab();
}

function renderActiveTab() {
  const d = window.REP_DATA;
  const box = document.getElementById('repResults');
  if (!d || !box) return;

  const tab = REP.activeTab || 'summary';

  if (tab === 'summary') box.innerHTML = renderSummaryTab(d);
  else if (tab === 'sales') box.innerHTML = renderSalesTab(d);
  else if (tab === 'purchases') box.innerHTML = renderPurchasesTab(d);
  else if (tab === 'inventory') box.innerHTML = renderInventoryTab(d);
  else if (tab === 'maintenance') box.innerHTML = renderMaintenanceTab(d);
  else if (tab === 'used_devices') box.innerHTML = renderUsedDevicesTab(d);
  else if (tab === 'expenses') box.innerHTML = renderExpensesTab(d);
  else if (tab === 'movements') box.innerHTML = renderMovementsTab(d);
  else if (tab === 'shifts') box.innerHTML = renderShiftsTab(d);
  else if (tab === 'partners') box.innerHTML = renderPartnersTab(d);

  repPartnersInit();
  if (REP.search) repSearchFilter(REP.search);
}

/* ==================== 1. Summary Tab ==================== */
function renderSummaryTab(d) {
  const s = d.summary.sales;
  const f = d.summary.financial || {};
  const cur = SETTINGS.currency || 'ج';

  return `
    <div class="stat-grid">
      <div class="stat"><div class="label">إجمالي المبيعات</div><div class="value">${fmt(s.revenue)} <small>${cur}</small></div></div>
      <div class="stat blue"><div class="label">الربح التقديري (مبيعات)</div><div class="value">${fmt(s.profit)} <small>${cur}</small></div></div>
      <div class="stat orange"><div class="label">إجمالي الخصومات</div><div class="value">${fmt(s.discount)}</div></div>
      <div class="stat"><div class="label">عدد فواتير البيع</div><div class="value">${s.count}</div></div>
      <div class="stat blue"><div class="label">إجمالي المشتريات</div><div class="value">${fmt(d.summary.purchases.total)}</div></div>
      <div class="stat orange"><div class="label">عدد فواتير الشراء</div><div class="value">${d.summary.purchases.count}</div></div>
      <div class="stat red"><div class="label">عجز الورديات</div><div class="value">${fmt(d.shiftsRep.deficit_total)}</div></div>
      <div class="stat" style="border-color:var(--green,#16a34a)"><div class="label">زيادة الورديات</div><div class="value">${fmt(d.shiftsRep.surplus_total)}</div></div>
    </div>

    <div class="card mt-10">
      <div class="card-title">💼 الوضع المالي التجميعي للفترة (Financial Position)</div>
      <div class="table-wrap"><table>
        <tbody>
          <tr><td>صافي المبيعات (مبيعات − مرتجعات: ${fmt(d.summary.returns.total)} + مبيعات أجهزة مستعملة: ${fmt(d.summary.used_devices.sold_revenue)})</td><td class="num"><b>${fmt(f.net_sales)} ${cur}</b></td></tr>
          <tr><td>تكلفة البضاعة المبيعة (تكلفة مبيعات + تكلفة مستعمل)</td><td class="num">${fmt(f.net_cogs)} ${cur}</td></tr>
          <tr><td><b>الربح الإجمالي (Gross Profit)</b></td><td class="num"><b style="color:var(--primary-dark)">${fmt(f.gross_profit)} ${cur}</b></td></tr>
          <tr><td>المصروفات العامة (${d.summary.expenses.count} مصروف)</td><td class="num text-danger">− ${fmt(d.summary.expenses.total)} ${cur}</td></tr>
          <tr><td>مرتبات ومسحوبات موظفين (${d.summary.salaries_paid.count} تسوية)</td><td class="num text-danger">− ${fmt(d.summary.salaries_paid.total)} ${cur}</td></tr>
          <tr style="background:var(--primary-light,#dcfce7)"><td style="font-size:16px;font-weight:800">صافي الربح النهائي (Net Profit)</td><td class="num"><b style="font-size:18px;color:${f.net_profit >= 0 ? 'var(--green,#16a34a)' : '#dc2626'}">${fmt(f.net_profit)} ${cur}</b></td></tr>
          <tr><td>مديونيات عملاء على فواتير الفترة (آجل غير محصّل)</td><td class="num"><b>${fmt(d.summary.customer_debts.total)} ${cur}</b></td></tr>
        </tbody>
      </table></div>
    </div>

    <div class="grid-2 mt-10">
      <div class="card">
        <div class="card-title">📈 المبيعات اليومية</div>
        ${d.daily.length ? `<div class="table-wrap"><table>
          <thead><tr><th>اليوم</th><th class="num">الفواتير</th><th class="num">الإجمالي</th></tr></thead>
          <tbody>${d.daily.map(x => `<tr><td class="small">${x.day}</td><td class="num">${x.count}</td><td class="num">${fmt(x.total)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">لا توجد مبيعات</div>'}
      </div>
      <div class="card">
        <div class="card-title">👤 أداء الكاشيرات</div>
        <div class="table-wrap"><table>
          <thead><tr><th>الكاشير</th><th class="num">الفواتير</th><th class="num">الإجمالي</th></tr></thead>
          <tbody>${d.byCashier.map(c => `<tr><td>${esc(c.full_name)}</td><td class="num">${c.invoices}</td><td class="num">${fmt(c.total)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>`;
}

/* ==================== 2. Sales Tab ==================== */
function renderSalesTab(d) {
  const sales = d.sales || [];
  const catSales = d.catSales || [];

  return `
    <div class="card mb-10">
      <div class="card-title">📊 المبيعات حسب الأقسام والأصناف</div>
      ${catSales.length ? `<div class="table-wrap"><table>
        <thead><tr><th>القسم الرئيسية / الفرعي</th><th class="num">عدد الفواتير</th><th class="num">الكمية المباعة</th><th class="num">إجمالي المبيعات</th><th class="num">الربح التقديري</th></tr></thead>
        <tbody>${catSales.map(c => `
          <tr>
            <td>${esc(c.parent_name ? c.parent_name + ' ↳ ' + c.category_name : c.category_name || 'بدون قسم')}</td>
            <td class="num">${c.invoices_count}</td>
            <td class="num">${fmt(c.qty_sold)}</td>
            <td class="num"><b>${fmt(c.total_sales)}</b></td>
            <td class="num text-success"><b>${fmt(c.estimated_profit)}</b></td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty">لا توجد مبيعات بالأقسام في هذه الفترة</div>'}
    </div>

    <div class="card">
      <div class="card-title">🧾 سجل فواتير البيع التفصيلي (${sales.length} فاتورة)</div>
      ${sales.length ? `<div class="table-wrap"><table>
        <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>الكاشير</th><th>العميل</th><th class="num">الخصم</th><th class="num">التوصيل</th><th class="num">الإجمالي</th><th>طريقة الدفع</th></tr></thead>
        <tbody>${sales.map(s => `
          <tr>
            <td class="small"><b>${esc(s.invoice_no)}</b></td>
            <td class="small">${fmtDate(s.created_at)}</td>
            <td class="small">${esc(s.cashier || '—')}</td>
            <td class="small">${esc(s.customer_name || 'عميل نقدي')} ${s.customer_phone ? ' (' + esc(s.customer_phone) + ')' : ''}</td>
            <td class="num">${fmt(s.discount)}</td>
            <td class="num">${fmt(s.delivery_fee)}</td>
            <td class="num"><b>${fmt(s.total)}</b></td>
            <td class="small">${payBadge(s.payment_method)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty">لا توجد فواتير بيع في هذه الفترة</div>'}
    </div>`;
}

/* ==================== 3. Purchases Tab ==================== */
function renderPurchasesTab(d) {
  const pur = d.purchasesRep || { list: [], summary: {} };
  const list = pur.list || [];
  const sm = pur.summary || {};

  return `
    <div class="stat-grid mb-10">
      <div class="stat blue"><div class="label">إجمالي فواتير الشراء</div><div class="value">${fmt(sm.total)}</div></div>
      <div class="stat green" style="border-color:var(--green,#16a34a)"><div class="label">المدفوع للموردين</div><div class="value">${fmt(sm.paid)}</div></div>
      <div class="stat red"><div class="label">الآجل (مستحقات للموردين)</div><div class="value">${fmt(sm.due)}</div></div>
      <div class="stat"><div class="label">عدد فواتير الشراء</div><div class="value">${sm.count || 0}</div></div>
    </div>

    <div class="card">
      <div class="card-title">📦 سجل فواتير الشراء التفصيلي (${list.length} فاتورة)</div>
      ${list.length ? `<div class="table-wrap"><table>
        <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>المورد</th><th>بواسطة</th><th class="num">الخصم</th><th class="num">الإجمالي</th><th class="num">المدفوع</th><th class="num">المتبقي (آجل)</th></tr></thead>
        <tbody>${list.map(p => {
          const due = Math.max(0, p.total - p.paid);
          return `
          <tr>
            <td class="small"><b>${esc(p.invoice_no)}</b></td>
            <td class="small">${fmtDate(p.created_at)}</td>
            <td><b>${esc(p.supplier_name)}</b></td>
            <td class="small">${esc(p.user_name || '—')}</td>
            <td class="num">${fmt(p.discount)}</td>
            <td class="num"><b>${fmt(p.total)}</b></td>
            <td class="num text-success">${fmt(p.paid)}</td>
            <td class="num ${due > 0 ? 'text-danger font-weight-bold' : ''}">${fmt(due)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>` : '<div class="empty">لا توجد فواتير شراء في هذه الفترة</div>'}
    </div>`;
}

/* ==================== 4. Inventory, Stocktake & Serials Tab ==================== */
function renderInventoryTab(d) {
  const inv = d.inventory || { items: [] };
  const serials = d.serials || [];
  const stocktakes = d.stocktakes || [];

  return `
    <div class="card mb-10">
      <div class="card-title">📋 جرد وتقييم البضاعة الحالية بالمنتجات (${inv.count || 0} صنف)</div>
      <div class="table-wrap"><table>
        <thead><tr><th>المنتج</th><th class="num">المخزون</th><th class="num">سعر التكلفة</th><th class="num">قيمة التكلفة</th><th class="num">سعر البيع</th><th class="num">القيمة البيعية</th><th class="num">الربح المتوقع</th></tr></thead>
        <tbody>${(inv.items || []).map(p => {
          const c = (p.stock || 0) * (p.purchase_price || 0);
          const r = (p.stock || 0) * (p.sale_price || 0);
          return `<tr><td class="small">${esc(p.name)}</td><td class="num">${fmt(p.stock)}</td><td class="num">${fmt(p.purchase_price)}</td><td class="num">${fmt(c)}</td><td class="num">${fmt(p.sale_price)}</td><td class="num">${fmt(r)}</td><td class="num"><b>${fmt(r - c)}</b></td></tr>`;
        }).join('') || '<tr><td colspan="7" class="empty">لا توجد بضاعة في المخزون</td></tr>'}
        </tbody>
        <tfoot><tr style="background:#eee;font-weight:bold">
          <td>الإجمالي</td><td></td><td></td><td class="num">${fmt(inv.cost)}</td><td></td><td class="num">${fmt(inv.retail)}</td><td class="num">${fmt(inv.potential)}</td>
        </tr></tfoot>
      </table></div>
    </div>

    <div class="card mb-10">
      <div class="card-title">🔢 تقرير سجل السيريالات (Serial Numbers Registry — ${serials.length} سيريال)</div>
      ${serials.length ? `<div class="table-wrap"><table>
        <thead><tr><th>السيريال (S/N)</th><th>المنتج</th><th>الباركود</th><th>الحالة</th><th>فاتورة الشراء</th><th>سعر الشراء</th><th>فاتورة البيع</th><th>سعر البيع</th></tr></thead>
        <tbody>${serials.map(s => `
          <tr>
            <td class="small font-mono"><b>${esc(s.serial_number)}</b></td>
            <td>${esc(s.product_name)}</td>
            <td class="small">${esc(s.product_barcode || '—')}</td>
            <td>${s.status === 'available' ? '<span class="badge badge-green">متاح بالمخزون</span>' : '<span class="badge badge-blue">مُباع</span>'}</td>
            <td class="small">${esc(s.purchase_invoice || '—')}</td>
            <td class="num">${fmt(s.purchase_price)}</td>
            <td class="small">${esc(s.sale_invoice || '—')}</td>
            <td class="num">${fmt(s.sale_price)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty">لا توجد سيريالات مسجلة</div>'}
    </div>

    <div class="card">
      <div class="card-title">📊 محاضر الجرد الفعلي والفرق (Stocktake Audits — ${stocktakes.length} محضر)</div>
      ${stocktakes.length ? `<div class="table-wrap"><table>
        <thead><tr><th>المرجع</th><th>التاريخ</th><th>المستخدم</th><th>عدد الأصناف</th><th>الحالة</th><th class="num">إجمالي الفرق (عجز/زيادة)</th></tr></thead>
        <tbody>${stocktakes.map(st => `
          <tr>
            <td class="small"><b>${esc(st.ref_no)}</b></td>
            <td class="small">${fmtDate(st.created_at)}</td>
            <td class="small">${esc(st.user_name || '—')}</td>
            <td class="num">${st.items_count}</td>
            <td>${st.status === 'closed' ? '<span class="badge badge-green">مغلق ومُعتمد</span>' : '<span class="badge badge-orange">قيد الجرد</span>'}</td>
            <td class="num ${st.total_diff < 0 ? 'text-danger' : st.total_diff > 0 ? 'text-success' : ''}"><b>${fmt(st.total_diff)}</b></td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty">لا توجد عمليات جرد سابقة</div>'}
    </div>`;
}

/* ==================== 5. Maintenance Tab ==================== */
function renderMaintenanceTab(d) {
  const mr = d.maintRep || { summary: {}, payments: [], by_day: [] };
  return maintRepHtml(mr);
}

/* ==================== 6. Used Devices Tab ==================== */
function renderUsedDevicesTab(d) {
  const ud = d.usedDevsRep || { bought: [], sold: [], available: [], summary: {} };
  const bSum = ud.summary.bought || {};
  const sSum = ud.summary.sold || {};

  return `
    <div class="stat-grid mb-10">
      <div class="stat blue"><div class="label">إجمالي شراء أجهزة مستعملة</div><div class="value">${fmt(bSum.total)} <small>(${bSum.count || 0} جهاز)</small></div></div>
      <div class="stat green" style="border-color:var(--green,#16a34a)"><div class="label">إجمالي بيع مستعمل</div><div class="value">${fmt(sSum.revenue)} <small>(${sSum.count || 0} جهاز)</small></div></div>
      <div class="stat orange"><div class="label">تكلفة المباع (COGS)</div><div class="value">${fmt(sSum.cogs)}</div></div>
      <div class="stat" style="border-color:var(--primary)"><div class="label">صافي الأرباح المحققة</div><div class="value text-success">${fmt(sSum.profit)}</div></div>
    </div>

    <div class="card mb-10">
      <div class="card-title">📱 الأجهزة المستعملة المباعة وأرباحها (${ud.sold.length} جهاز)</div>
      ${ud.sold.length ? `<div class="table-wrap"><table>
        <thead><tr><th>الكود</th><th>الجهاز</th><th>السيريال/IMEI</th><th>المشتري</th><th class="num">سعر الشراء</th><th class="num">سعر البيع</th><th class="num">صافي الربح</th><th>طريقة البيع</th></tr></thead>
        <tbody>${ud.sold.map(x => `
          <tr>
            <td class="small font-mono"><b>${esc(x.code)}</b></td>
            <td>${esc(x.device_name)} <span class="small muted">(${esc(x.brand || '')} ${esc(x.model || '')})</span></td>
            <td class="small font-mono">${esc(x.serial_number || '—')}</td>
            <td class="small">${esc(x.buyer_name || '—')}</td>
            <td class="num">${fmt(x.purchase_price)}</td>
            <td class="num"><b>${fmt(x.sale_price)}</b></td>
            <td class="num text-success font-weight-bold">${fmt(x.sale_price - x.purchase_price)}</td>
            <td class="small">${PAYS[x.sale_method] || '💵 كاش'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty">لا توجد أجهزة مباعة في هذه الفترة</div>'}
    </div>

    <div class="card mb-10">
      <div class="card-title">📥 الأجهزة المستعملة المشتراة (${ud.bought.length} جهاز)</div>
      ${ud.bought.length ? `<div class="table-wrap"><table>
        <thead><tr><th>الكود</th><th>تاريخ الشراء</th><th>الجهاز</th><th>البائع</th><th class="num">سعر الشراء</th><th>طريقة الشراء</th><th>الحالة</th></tr></thead>
        <tbody>${ud.bought.map(x => `
          <tr>
            <td class="small font-mono"><b>${esc(x.code)}</b></td>
            <td class="small">${fmtDate(x.purchase_date)}</td>
            <td>${esc(x.device_name)} <span class="small muted">(${esc(x.brand || '')})</span></td>
            <td class="small">${esc(x.seller_name || '—')}</td>
            <td class="num"><b>${fmt(x.purchase_price)}</b></td>
            <td class="small">${PAYS[x.purchase_method] || '💵 كاش'}</td>
            <td>${x.status === 'available' ? '<span class="badge badge-green">متاح بالمعرض</span>' : '<span class="badge badge-blue">مُباع</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty">لا توجد أجهزة مشتراة في هذه الفترة</div>'}
    </div>

    <div class="card">
      <div class="card-title">🏪 الأجهزة المستعملة المتاحة حالياً بالمعرض (${ud.available.length} جهاز)</div>
      ${ud.available.length ? `<div class="table-wrap"><table>
        <thead><tr><th>الكود</th><th>اسم الجهاز</th><th>السيريال/IMEI</th><th class="num">تكلفة الشراء</th><th>ملاحظات الحالة</th></tr></thead>
        <tbody>${ud.available.map(x => `
          <tr>
            <td class="small font-mono"><b>${esc(x.code)}</b></td>
            <td>${esc(x.device_name)} (${esc(x.brand || '')})</td>
            <td class="small font-mono">${esc(x.serial_number || '—')}</td>
            <td class="num font-weight-bold">${fmt(x.purchase_price)}</td>
            <td class="small">${esc(x.condition_notes || 'ممتازة')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty">لا توجد أجهزة مستعملة متاحة بالمخزون</div>'}
    </div>`;
}

/* ==================== 7. Expenses & Employees Tab ==================== */
function renderExpensesTab(d) {
  const exp = d.expenses || { list: [], count: 0, total: 0 };
  const emp = d.employeesRep || { closings: [], payments: [], vacations: [] };

  return `
    <div class="card mb-10">
      <div class="card-title">💸 بيان حركات المصروفات (${exp.count || 0} مصروف — إجمالي: ${fmt(exp.total)})</div>
      ${exp.list && exp.list.length ? `<div class="table-wrap"><table>
        <thead><tr><th>التاريخ</th><th>التصنيف</th><th>البيان</th><th>طريقة السداد</th><th>المستخدم</th><th class="num">المبلغ</th></tr></thead>
        <tbody>${exp.list.map(e => `
          <tr>
            <td class="small">${fmtDate(e.spent_at)}</td>
            <td class="small">${(typeof EXP_CATS !== 'undefined' && EXP_CATS[e.category]) || esc(e.category)}</td>
            <td class="small">${esc(e.note || '—')}</td>
            <td class="small">${PAYS[e.method] || '💵 كاش'}</td>
            <td class="small">${esc(e.user_name || '—')}</td>
            <td class="num text-danger"><b>−${fmt(e.amount)}</b></td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr style="background:#eee;font-weight:bold"><td colspan="5">إجمالي المصروفات</td><td class="num text-danger">${fmt(exp.total)} ${SETTINGS.currency || 'ج'}</td></tr></tfoot>
      </table></div>` : '<div class="empty">لا توجد مصروفات مسجلة</div>'}
    </div>

    <div class="card mb-10">
      <div class="card-title">👷 تسويات وسداد مرتبات الموظفين (${emp.closings.length} تسوية)</div>
      ${emp.closings.length ? `<div class="table-wrap"><table>
        <thead><tr><th>التاريخ</th><th>الموظف</th><th>الشهر المغلق</th><th class="num">المبلغ المدفوع</th><th>ملاحظات</th><th>بواسطة</th></tr></thead>
        <tbody>${emp.closings.map(sc => `
          <tr>
            <td class="small">${fmtDate(sc.created_at)}</td>
            <td><b>${esc(sc.employee_name)}</b></td>
            <td class="small">${esc(sc.month)}</td>
            <td class="num text-danger"><b>−${fmt(sc.amount)}</b></td>
            <td class="small">${esc(sc.note || '—')}</td>
            <td class="small">${esc(sc.user_name || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty">لا توجد تسويات مرتبات سابقة</div>'}
    </div>

    <div class="card">
      <div class="card-title">💵 سلف ومسحوبات وإجازات الموظفين</div>
      ${emp.payments.length ? `<div class="table-wrap"><table>
        <thead><tr><th>التاريخ</th><th>الموظف</th><th>النوع</th><th>طريقة السداد</th><th class="num">المبلغ</th><th>البيان</th></tr></thead>
        <tbody>${emp.payments.map(p => `
          <tr>
            <td class="small">${fmtDate(p.created_at)}</td>
            <td><b>${esc(p.employee_name)}</b></td>
            <td class="small">${esc(p.pay_type || 'سلفة')}</td>
            <td class="small">${PAYS[p.method] || '💵 كاش'}</td>
            <td class="num text-danger"><b>−${fmt(p.amount)}</b></td>
            <td class="small">${esc(p.note || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty">لا توجد سلف أو مسحوبات</div>'}
    </div>`;
}

/* ==================== 8. Movements Tab ==================== */
function renderMovementsTab(d) {
  const ps = d.partiesSum || {};
  return `
    ${partiesHtml(ps)}
    <div id="repMovementsBox" class="mt-10"></div>`;
}

/* ==================== 9. Shifts Tab ==================== */
function renderShiftsTab(d) {
  return shiftsHtml(d.shiftsRep || { shifts: [] });
}

/* ==================== 10. Partners Tab ==================== */
function renderPartnersTab(d) {
  return `
    <div class="card mt-10">
      <div class="card-title">🧮 حسابات الشركاء — البيان المفصل وتوزيع الأرباح</div>
      <div class="toolbar">
        <label class="small muted">الشهر:</label><input type="month" id="repPrtMonth" value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 7)}">
        <select id="repPrtPartner"><option value="">كل الشركاء</option></select>
        <button class="btn btn-secondary" onclick="repPartnersLoad()">عرض</button>
      </div>
      <div id="repPartnersBox"><div class="empty" style="padding:30px">اضغط عرض لتحميل بيان الشركاء</div></div>
    </div>`;
}

/* ==================== Helpers & Sub-renderers ==================== */
function partiesHtml(ps) {
  const c = ps.customers || {}, sp = ps.suppliers || {};
  return `
    <div class="stat-grid mb-10">
      <div class="stat blue"><div class="icon">👥</div><div class="label">العملاء المسجلون</div>
        <div class="value">${c.count || 0}</div></div>
      <div class="stat red"><div class="label">مديونيات العملاء علينا تحصيلها</div>
        <div class="value">${fmt(c.debts_total || 0)} <small>${SETTINGS.currency || 'ج'}</small></div>
        <div class="small muted">${c.debtors || 0} عميل مدين</div></div>
      <div class="stat orange"><div class="icon">🏭</div><div class="label">الموردون</div>
        <div class="value">${sp.count || 0}</div></div>
      <div class="stat"><div class="label">مستحقات الموردين (عليها دفع)</div>
        <div class="value">${fmt(sp.dues_total || 0)} <small>${SETTINGS.currency || 'ج'}</small></div>
        <div class="small muted">${sp.creditors || 0} مورد مستحق</div></div>
    </div>`;
}

async function repMovementsLoad() {
  const box = document.getElementById('repMovementsBox');
  if (!box) return;
  const type = document.getElementById('repMovType')?.value || '';
  const params = new URLSearchParams();
  if (REP.from) params.set('from', REP.from);
  if (REP.to) params.set('to', REP.to);
  if (type) params.set('type', type);
  const d = await API.get('/api/reports/party-movements?' + params);
  if (window.REP_DATA) window.REP_DATA.movements = d;
  box.innerHTML = `
    <div class="card">
      <div class="card-title">🔄 بيان حركات الموردين والعملاء (${d.list.length} حركة)
        <select id="repMovType" onchange="repMovementsLoad()" style="min-width:150px">
          <option value="" ${!type ? 'selected' : ''}>الكل</option>
          <option value="customer" ${type === 'customer' ? 'selected' : ''}>العملاء فقط</option>
          <option value="supplier" ${type === 'supplier' ? 'selected' : ''}>الموردون فقط</option>
        </select></div>
      ${d.list.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>التاريخ</th><th>الطرف</th><th>النوع</th><th>المرجع</th><th>ملاحظة</th><th class="num">قيمة الحركة</th><th class="num">الأثر على الرصيد</th></tr></thead>
        <tbody>${d.list.map(m => `
          <tr>
            <td class="small">${fmtDate(m.date)}</td>
            <td>${esc(m.party_name)} <span class="badge ${m.party_type === 'customer' ? 'badge-blue' : 'badge-orange'}">${m.party_type === 'customer' ? 'عميل' : 'مورد'}</span></td>
            <td class="small">${esc(m.label)}</td>
            <td class="small">${esc(m.ref || '—')}</td>
            <td class="small">${esc((m.note || '').slice(0, 40))}</td>
            <td class="num">${fmt(m.amount)}</td>
            <td class="num" style="font-weight:800;color:${m.effect > 0 ? '#dc2626' : m.effect < 0 ? '#16a34a' : 'inherit'}">${m.effect > 0 ? '+' : ''}${fmt(m.effect)}</td>
          </tr>`).join('')}
        </tbody></table></div>
      <div class="small muted mt-10">الأثر: (+) يزيد مديونية الطرف علينا / (−) تقليل منها — إجمالي أثر المعروض: <b>${fmt(d.total_effect)}</b></div>`
      : '<div class="empty">لا توجد حركات في هذه الفترة</div>'}
    </div>`;
}

function maintRepHtml(mr) {
  if (!mr) return '';
  const sm = mr.summary || {};
  const payName = m => ({ cash: 'كاش', card: 'كارت', wallet: 'محفظة' }[m] || m);
  return `
    <div class="card mt-10">
      <div class="card-title">🔧 تقرير الصيانة — التحصيل والأوامر</div>
      <div class="stat-grid" style="margin-bottom:10px">
        <div class="stat"><div class="label">أوامر الفترة</div><div class="value">${sm.jobs_count || 0}</div></div>
        <div class="stat blue"><div class="label">إجمالي قيمة الأوامر</div><div class="value">${fmt(sm.jobs_total || 0)}</div></div>
        <div class="stat green" style="border-color:var(--green,#16a34a)"><div class="label">المحصل (عربون + تقفيل)</div><div class="value">${fmt(sm.collected || 0)}</div></div>
        <div class="stat orange"><div class="label">منه عربون</div><div class="value">${fmt(sm.deposits || 0)}</div></div>
        <div class="stat red"><div class="label">أوامر لسه مقفلتش</div><div class="value">${sm.still_open_count || 0}</div>
          <div class="small muted">متبقٍ ${fmt(sm.still_open_remaining || 0)} ${SETTINGS.currency || 'ج'}</div></div>
      </div>
      ${mr.by_day && mr.by_day.length ? `
      <div class="table-wrap" style="margin-bottom:10px"><table>
        <thead><tr><th>تحصيلات الصيانة اليومية</th><th class="num">عدد الدفعات</th><th class="num">الإجمالي</th></tr></thead>
        <tbody>${mr.by_day.map(d => `<tr><td class="small">${d.day}</td><td class="num">${d.count}</td><td class="num"><b>${fmt(d.total)}</b></td></tr>`).join('')}</tbody>
      </table></div>` : ''}
      ${mr.payments && mr.payments.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>التاريخ</th><th>رقم الأمر</th><th>العميل</th><th>النوع</th><th>الطريقة</th><th>بواسطة</th><th class="num">المبلغ</th></tr></thead>
        <tbody>${mr.payments.map(p => `<tr>
          <td class="small">${fmtDate(p.created_at)}</td><td class="small">${esc(p.job_no)}</td><td>${esc(p.customer_name || '—')}</td>
          <td>${(p.note || '').includes('عربون') ? '<span class="badge badge-orange">عربون</span>' : '<span class="badge badge-green">تسديد</span>'}</td>
          <td class="small">${payName(p.method)}</td><td class="small">${esc(p.user_name || '—')}</td>
          <td class="num">${fmt(p.amount)}</td></tr>`).join('')}</tbody>
        <tfoot><tr style="background:#eee;font-weight:bold"><td colspan="6">إجمالي المحصل في الفترة</td><td class="num">${fmt(sm.collected)}</td></tr></tfoot>
      </table></div>` : '<div class="empty">لا توجد تحصيلات صيانة في هذه الفترة</div>'}
    </div>`;
}

function shiftsHtml(shiftsRep) {
  const list = shiftsRep.shifts || [];
  return `
    <div class="card">
      <div class="card-title">⏱️ تقرير الورديات — العجز والزيادة (${list.length} وردية)</div>
      ${list.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>فتحها</th><th>وقت الفتح</th><th>قفلها</th><th>وقت الغلق</th><th class="num">رصيد البداية</th><th class="num">المتوقع</th><th class="num">الفعلي</th><th class="num">الفرق</th></tr></thead>
        <tbody>${list.map(sh => {
          const d = Number(sh.diff) || 0;
          const badge = Math.abs(d) < 0.005 ? '<span class="badge badge-green">مطابق ✅</span>'
            : d < 0 ? `<span class="badge badge-red">عجز ${fmt(Math.abs(d))}</span>`
            : `<span class="badge badge-blue">زيادة ${fmt(d)}</span>`;
          return `<tr>
            <td class="small">${sh.id}</td>
            <td>${esc(sh.opened_by_name || '—')}</td>
            <td class="small">${fmtDate(sh.opened_at)}</td>
            <td>${esc(sh.closed_by_name || '—')}</td>
            <td class="small">${sh.closed_at ? fmtDate(sh.closed_at) : '—'}</td>
            <td class="num">${fmt(sh.opening_cash)}</td>
            <td class="num">${fmt(sh.expected_cash)}</td>
            <td class="num">${fmt(sh.closing_cash)}</td>
            <td class="num">${badge}</td>
          </tr>`;
        }).join('')}
        </tbody></table></div>` : '<div class="empty">لا توجد ورديات مقفولة في هذه الفترة</div>'}
    </div>`;
}

async function repPartnersInit() {
  try {
    const pl = await API.get('/api/partners');
    const sel = document.getElementById('repPrtPartner');
    if (sel) sel.innerHTML = '<option value="">كل الشركاء</option>' +
      pl.partners.map(p => `<option value="${p.id}">${esc(p.name)} (${p.profit_percent}%)</option>`).join('');
    repPartnersLoad();
  } catch {}
}

async function repPartnersLoad() {
  const box = document.getElementById('repPartnersBox');
  if (!box) return;
  const month = document.getElementById('repPrtMonth')?.value || new Date().toISOString().slice(0, 7);
  const pid = document.getElementById('repPrtPartner')?.value || '';
  const C = SETTINGS.currency || 'ج';
  const METHOD = { cash: '💵 كاش', card: '💳 فيزا', wallet: '📱 محفظة', transfer: '🏦 تحويل' };
  let mv, st;
  try {
    mv = await API.get(`/api/partners/movements?month=${encodeURIComponent(month)}` + (pid ? '&partner_id=' + pid : ''));
    st = await API.get('/api/partners/statement?month=' + encodeURIComponent(month));
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  window.REP_PRT = { mv, st, month, pid };
  const t = mv.totals;
  box.innerHTML = `
    <div class="stat-grid">
      <div class="stat green"><div class="icon">📥</div><div class="label">توريد نقدي</div><div class="value">${fmt(t.in_cash)}</div></div>
      <div class="stat"><div class="icon">📦</div><div class="label">توريد بضاعة</div><div class="value">${fmt(t.in_goods)}</div></div>
      <div class="stat red"><div class="icon">📤</div><div class="label">تحويلات إليه (نقدي/بضاعة)</div><div class="value">${fmt(t.out_cash + t.out_goods)}</div></div>
      <div class="stat blue"><div class="icon">💧</div><div class="label">أموال سائلة حالية</div><div class="value">${fmt(st.liquid_total)}</div>
        <div class="small muted">${Object.entries(st.liquid).filter(([, v]) => v > 0).map(([k, v]) => `${METHOD[k]} ${fmt(v)}`).join(' — ') || 'لا توجد أرصدة مسجلة'}</div></div>
    </div>
    <div class="table-wrap mt-10"><table>
      <thead><tr><th>الشهر</th><th>أرباح المبيعات</th><th>خسارة أرباح المرتجعات</th><th>مصروفات</th><th>مرتبات موظفين</th><th>صافي الربح</th></tr></thead>
      <tbody><tr>
        <td>${st.month}</td><td class="num text-success">${fmt(st.period.sales_profit)}</td>
        <td class="num text-danger" title="قيمة المرتجعات: ${fmt(st.period.returns)} — بيخصم ربح المنتج المرتجع فقط (المرتجع − تكلفته)">−${fmt(st.period.returns_profit_loss)}</td><td class="num text-danger">−${fmt(st.period.expenses)}</td>
        <td class="num text-danger">−${fmt(st.period.salaries)}</td>
        <td class="num"><b style="color:${st.period.net >= 0 ? 'var(--green,#16a34a)' : '#dc2626'}">${fmt(st.period.net)}</b></td>
      </tr></tbody></table></div>
    <div class="table-wrap mt-10"><table>
      <thead><tr><th>الشريك</th><th class="num">النسبة</th><th class="num">نصيبه من صافي الربح</th><th class="num">تحويلات إليه</th><th class="num">المتبقي</th><th>الحالة</th><th class="num">حصته من السائل</th></tr></thead>
      <tbody>${st.partners.filter(p => !pid || String(p.id) === pid).map(p => {
        const meta = { ok: ['✅ آمن', '#1b5e20'], near: ['⚠️ قارب النصيب', '#a15c00'], exceeded: ['🚨 تجاوز', '#b71c1c'] }[p.status] || ['—', ''];
        return `<tr><td>${esc(p.name)}</td><td class="num">${p.profit_percent}%</td><td class="num"><b>${fmt(p.share)}</b></td>
          <td class="num text-danger">${fmt(p.month_out)}</td><td class="num">${fmt(p.remaining_share)}</td>
          <td style="color:${meta[1]};white-space:nowrap">${meta[0]}</td>
          <td class="num">${fmt((st.liquid_distribution.find(d => d.partner_id === p.id) || {}).share || 0)}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">لا يوجد شركاء</td></tr>'}</tbody></table></div>
    <div class="table-wrap mt-10"><table>
      <thead><tr><th>التاريخ</th><th>الشريك</th><th>نوع الحركة</th><th>القيمة</th><th>طريقة التوريد/التحويل</th><th class="num">المبلغ</th><th>البيان</th></tr></thead>
      <tbody>${mv.rows.map(x => `<tr>
        <td class="small">${fmtDate(x.created_at)}</td><td>${esc(x.partner_name)}</td>
        <td>${x.type === 'in' ? '<b class="text-success">توريد ↓</b>' : '<b class="text-danger">تحويل إليه ↑</b>'}</td>
        <td class="small">${x.kind === 'goods' ? '📦 بضاعة' : '💵 نقدي'}</td>
        <td class="small">${METHOD[x.method] || '💵 كاش'}</td>
        <td class="num"><b>${x.type === 'in' ? '+' : '−'}${fmt(x.amount)}</b></td>
        <td class="small">${esc(x.note || '—')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">لا توجد حركات في هذا الشهر</td></tr>'}
      </tbody>
    </table></div>`;
}

/* ==================== Export PDF & Print HTML ==================== */
async function exportReportPDF() {
  if (!window.REP_DATA) { showAlert('اعرض التقرير أولاً ثم صدّره', 'error'); return; }
  if (!window.printerAPI || !window.printerAPI.exportPDF) { showAlert('تصدير PDF يعمل داخل برنامج الديسكتوب فقط', 'error'); return; }
  const name = `تقرير-${REP.activeTab}-${REP.from || 'الكل'}${REP.to ? '_' + REP.to : ''}.pdf`;
  showAlert('جاري إنشاء ملف PDF...');
  try {
    const res = await window.printerAPI.exportPDF(reportDoc(reportHtml()), name);
    if (res && res.ok) showAlert('تم حفظ الملف: ' + res.path);
    else if (res && !res.canceled) showAlert('فشل التصدير: ' + (res.err || 'خطأ غير معروف'), 'error');
  } catch (e) { showAlert('فشل التصدير: ' + e.message, 'error'); }
}

function reportHtml() {
  const d = window.REP_DATA;
  if (!d) return '<div class="empty" style="padding:60px">لا يوجد تقرير محمّل — اضغط عرض التقرير أولاً</div>';
  const tab = REP.activeTab || 'summary';
  const box = document.getElementById('repResults');
  const content = box ? box.innerHTML : renderSummaryTab(d);

  return `
    <div class="rep">
      <div class="rep-head" style="text-align:center;margin-bottom:15px">
        <h2>${esc(SETTINGS.store_name || 'سوبر ماركت')}</h2>
        <div class="rep-meta" style="font-weight:700">تقرير تفصيلي — ${document.querySelector(`#repTabs [data-tab="${tab}"]`)?.textContent || tab}</div>
        <div class="small muted">من الفترة: ${REP.from || 'البداية'} إلى ${REP.to || 'الآن'}</div>
      </div>
      ${content}
    </div>`;
}
