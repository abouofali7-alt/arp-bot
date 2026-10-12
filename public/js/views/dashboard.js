async function renderDashboard() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = '<div class="muted" style="text-align:center;padding:60px">جاري تحميل البيانات...</div>';
  const d = await API.get('/api/reports/dashboard');

  const unpaid = (d.unpaid_salaries || []).filter(u => !u.closed);
  const unpaidTotal = unpaid.reduce((s, u) => s + (u.salary || 0), 0);

  el.innerHTML = `
    ${unpaid.length ? `
    <div class="alert warning" style="margin-bottom:12px">
      <b>💰 إشعار المرتبات — الشهر الحالي:</b>
      ${unpaid.map(u => `${esc(u.name)} (${fmt(u.salary)})`).join('، ')}
      <span class="small muted">— إجمالي غير المغلق: ${fmt(unpaidTotal)} ${SETTINGS.currency || 'ج'}</span>
      <a href="#" onclick="partySwitch('employee'); return false;">اذهب للتقفيل ←</a>
    </div>` : ''}
    <div class="stat-grid">
      <div class="stat"><div class="icon">💰</div><div class="label">مبيعات اليوم</div>
        <div class="value">${fmt(d.today_sales.total)} <small>${SETTINGS.currency || 'ج'}</small></div>
        <div class="small muted">${d.today_sales.count} فاتورة</div></div>
      <div class="stat blue"><div class="icon">📅</div><div class="label">مبيعات الشهر</div>
        <div class="value">${fmt(d.month_sales.total)} <small>${SETTINGS.currency || 'ج'}</small></div></div>
      <div class="stat orange"><div class="icon">📥</div><div class="label">مشتريات اليوم</div>
        <div class="value">${fmt(d.today_purchases.total)} <small>${SETTINGS.currency || 'ج'}</small></div>
        <div class="small muted">${d.today_purchases.count || 0} فاتورة شراء</div></div>
      <div class="stat red"><div class="icon">🔁</div><div class="label">فواتير المرتجع — الشهر</div>
        <div class="value">${d.returns_month.count}</div>
        <div class="small muted">بقيمة ${fmt(d.returns_month.total)} ${SETTINGS.currency || 'ج'} — اليوم: ${d.returns_today.count} (${fmt(d.returns_today.total)})</div></div>
      <div class="stat blue"><div class="icon">🧾</div><div class="label">فواتير الشراء — الشهر</div>
        <div class="value">${d.month_purchases.count}</div>
        <div class="small muted">بقيمة ${fmt(d.month_purchases.total)} ${SETTINGS.currency || 'ج'}</div></div>
      <div class="stat red"><div class="icon">⚠️</div><div class="label">منتجات ناقصة المخزون</div>
        <div class="value">${d.low_stock.length}</div></div>
      <div class="stat"><div class="icon">📦</div><div class="label">عدد المنتجات</div>
        <div class="value">${d.product_count}</div></div>
      <div class="stat blue"><div class="icon">🗂️</div><div class="label">الأقسام</div>
        <div class="value">${d.category_count}</div></div>
    </div>

    ${d.maintenance ? `
    <div class="stat-grid mt-10">
      <div class="stat orange"><div class="icon">🔧</div><div class="label">أوامر صيانة اليوم</div>
        <div class="value">${d.maintenance.today_jobs}</div>
        <div class="small muted">بإجمالي ${fmt(d.maintenance.today_total)} ${SETTINGS.currency || 'ج'}</div></div>
      <div class="stat green" style="border-color:var(--green,#16a34a)"><div class="icon">💵</div><div class="label">محصل صيانة اليوم</div>
        <div class="value">${fmt(d.maintenance.today_collected)} <small>${SETTINGS.currency || 'ج'}</small></div>
        <div class="small muted">${d.maintenance.today_payments} دفعة (عربون + تقفيل)</div></div>
      <div class="stat red"><div class="icon">⏳</div><div class="label">أوامر غير مقفلة</div>
        <div class="value">${d.maintenance.open_count}</div>
        <div class="small muted">متبقٍ عليها ${fmt(d.maintenance.open_remaining)} ${SETTINGS.currency || 'ج'}
          — <a href="#" onclick="maintSwitch('board'); return false;">الكشف ←</a></div></div>
    </div>` : ''}

    <div class="grid-2 mt-10">
      <div class="card">
        <div class="card-title">↩️ بيان فواتير المرتجع (الأحدث)
          <a href="#" onclick="navigate('returns'); return false;" class="small">عرض الكل ←</a></div>
        ${d.recent_returns.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>المرتجع</th><th>الفاتورة الأصلية</th><th>التاريخ</th><th>الكاشير</th><th>الطريقة</th><th class="num">القيمة</th></tr></thead>
          <tbody>${d.recent_returns.map(r => {
            const mn = { cash: 'كاش', card: 'كارت', wallet: 'محفظة', credit: 'خصم من المستحق' }[r.refund_method] || r.refund_method;
            return `<tr><td class="small">${esc(r.return_no)}</td><td class="small">${esc(r.sale_invoice || '—')}</td><td class="small">${fmtDate(r.created_at)}</td><td class="small">${esc(r.cashier)}</td><td class="small">${mn}</td><td class="num"><b class="text-danger">${fmt(r.subtotal)}</b></td></tr>`;
          }).join('')}
          </tbody></table></div>` : '<div class="empty">لا توجد مرتجعات</div>'}
      </div>
      <div class="card">
        <div class="card-title">🧾 بيان فواتير الشراء (الأحدث)</div>
        ${d.recent_purchases.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>رقم الفاتورة</th><th>المورد</th><th>التاريخ</th><th class="num">الإجمالي</th></tr></thead>
          <tbody>${d.recent_purchases.map(p => `
            <tr><td class="small">${esc(p.invoice_no || p.id)}</td><td>${esc(p.supplier_name)}</td><td class="small">${fmtDate(p.created_at)}</td><td class="num"><b>${fmt(p.total)}</b></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">لا توجد مشتريات</div>'}
      </div>
    </div>

    <div class="grid-3">
      <div class="card">
        <div class="card-title">الأكثر مبيعاً</div>
        ${d.top_products.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>المنتج</th><th class="num">الكمية</th><th class="num">الإجمالي</th></tr></thead>
          <tbody>${d.top_products.map(p => `
            <tr><td>${esc(p.name)}</td><td class="num">${fmt(p.qty)}</td><td class="num">${fmt(p.total)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">لا توجد مبيعات بعد</div>'}
      </div>
      <div class="card">
        <div class="card-title">تحذيرات المخزون</div>
        ${d.low_stock.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>المنتج</th><th class="num">المخزون</th><th class="num">الحد الأدنى</th></tr></thead>
          <tbody>${d.low_stock.map(p => `
            <tr><td>${esc(p.name)}</td><td class="num"><span class="badge badge-red">${fmt(p.stock)}</span></td><td class="num">${fmt(p.min_stock)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">✅ لا توجد تحذيرات</div>'}
      </div>
      <div class="card">
        <div class="card-title">آخر الفواتير</div>
        ${d.recent_sales.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>الفاتورة</th><th>الكاشير</th><th class="num">الإجمالي</th></tr></thead>
          <tbody>${d.recent_sales.map(s => `
            <tr><td class="small">${esc(s.invoice_no)}</td><td class="small">${esc(s.cashier)}</td><td class="num">${fmt(s.total)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">لا توجد فواتير</div>'}
      </div>
    </div>
  `;
}
