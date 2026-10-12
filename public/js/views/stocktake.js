let ST = { current: null, items: [], cats: [], filterCat: '' };

async function renderStocktakes() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="toolbar">
      <h3 style="flex:1">📋 الجرد (العد الفعلي للمخزون)</h3>
      <button class="btn" onclick="stocktakeOpen()">📋 فتح جرد جديد</button>
    </div>
    <div class="card">
      <div class="card-title">سجل الجرد</div>
      <div class="table-wrap"><table>
        <thead><tr><th>الرقم</th><th>التاريخ</th><th>المُعد</th><th class="num">الأصناف</th><th class="num">الفروق</th><th>الحالة</th><th></th></tr></thead>
        <tbody id="stocktakesTable"></tbody>
      </table></div>
    </div>`;
  stocktakesLoad();
}

async function stocktakesLoad() {
  const list = await API.get('/api/stocktakes');
  document.getElementById('stocktakesTable').innerHTML = list.map(st => `
    <tr>
      <td class="small">${esc(st.ref_no)}</td>
      <td class="small">${fmtDate(st.created_at)}</td>
      <td>${esc(st.cashier)}</td>
      <td class="num">${st.items_count}</td>
      <td class="num">${st.diffs_count > 0 ? `<span class="badge badge-orange">${st.diffs_count} صنف</span>` : '0'}</td>
      <td>${st.status === 'open' ? '<span class="badge badge-green">مفتوح</span>' : `<span class="badge badge-gray">مغلق ${st.closed_at ? '' : ''}</span>`}</td>
      <td><button class="btn btn-${st.status === 'open' ? 'warning' : 'secondary'} btn-sm" onclick="stocktakeDetail(${st.id})">${st.status === 'open' ? 'إكمال الجرد' : 'عرض'}</button></td>
    </tr>`).join('') || '<tr><td colspan="7"><div class="empty">لا توجد جردات</div></td></tr>';
}

async function stocktakeOpen() {
  try {
    const r = await API.post('/api/stocktakes', {});
    showAlert('تم فتح جرد جديد: ' + r.ref_no);
    stocktakeDetail(r.id);
  } catch (e) { showAlert(e.message, 'error'); }
}

async function stocktakeDetail(id) {
  const st = await API.get('/api/stocktakes/' + id);
  ST.current = st;
  ST.items = st.items.map(i => ({ ...i }));
  const cats = await API.get('/api/categories');
  ST.cats = cats;
  const isOpen = st.status === 'open';
  openModal(`
    <div class="modal-head"><h3>جرد ${esc(st.ref_no)} ${isOpen ? '— <span class="badge badge-green">مفتوح</span>' : '<span class="badge badge-gray">مغلق</span>'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <p class="small muted mb-10">أدخل الكمية الفعلية لكل صنف — الفرق يُحسب تلقائياً، وعند الغلق يتم تعديل المخزون</p>
    <div class="toolbar" style="margin-bottom:10px">
      <label class="small muted">فلترة بالقسم:</label>
      <select id="stCat" style="max-width:280px" onchange="stocktakeSetCat(this.value)">
        <option value="">📂 كل الأقسام</option>
        <option value="root">📁 أقسام الجذر (رئيسي فقط)</option>
        ${cats.filter(c => !c.parent_id).map(c => `<option value="${c.id}">📁 ${esc(c.name)}</option>`).join('')}
        ${cats.filter(c => c.parent_id).map(c => `<option value="${c.id}">↳ ${esc(c.name)}</option>`).join('')}
      </select>
    </div>
    <div style="max-height:55vh;overflow:auto;border:1px solid var(--border);border-radius:10px">
      <table>
        <thead style="position:sticky;top:0"><tr><th>المنتج</th><th class="num">المخزون النظامي</th><th class="num">الفعلي</th><th class="num">الفرق</th></tr></thead>
        <tbody id="stItemsBody"></tbody>
      </table>
    </div>
    <div class="flex-between mt-10">
      <span class="small">الأصناف ذات الفروق: <b id="stDiffCount">0</b></span>
      <div class="flex">
        ${isOpen ? `
          <button class="btn btn-secondary btn-sm" onclick="stocktakeSaveCounts()">💾 حفظ الأعداد</button>
          <button class="btn btn-danger btn-sm" onclick="stocktakeClose(${id})">✔️ غلق وتطبيق</button>
        ` : `<button class="btn" onclick="openPrintModal(stocktakeReport(), 'invoice', 'تقرير جرد ' + ST.current.ref_no)">🖨️ طباعة الجرد</button>`}
        <button class="btn btn-secondary btn-sm" onclick="closeModal()">إغلاق</button>
      </div>
    </div>
  `, true);
  stocktakeRenderItems();
}

function stocktakeSetCat(v) {
  ST.filterCat = v || '';
  document.getElementById('stCat').value = v || '';
  stocktakeRenderItems();
}

function stocktakeFilteredItems() {
  if (!ST.filterCat || ST.filterCat === 'root') {
    if (ST.filterCat === 'root') return ST.items.filter(i => !i.category_id);
    return ST.items;
  }
  const selfCat = ST.cats.find(c => Number(c.id) === Number(ST.filterCat));
  if (selfCat && !selfCat.parent_id) {
    const ids = [Number(ST.filterCat)];
    for (let i = 0; i < ids.length; i++) {
      ST.cats.filter(c => Number(c.parent_id) === Number(ids[i])).forEach(c => ids.push(Number(c.id)));
    }
    return ST.items.filter(i => ids.includes(Number(i.category_id)));
  }
  return ST.items.filter(i => Number(i.category_id) === Number(ST.filterCat));
}

function stocktakeRenderItems() {
  const body = document.getElementById('stItemsBody');
  const isOpen = ST.current.status === 'open';
  let diffs = 0;
  body.innerHTML = stocktakeFilteredItems().map((i, idx) => {
    const diff = (Number(i.actual_stock) || 0) - i.system_stock;
    if (Math.abs(diff) > 0.001) diffs++;
    const realIdx = ST.items.findIndex(x => x.product_id === i.product_id);
    return `<tr>
      <td><b>${esc(i.name)}</b></td>
      <td class="num">${fmt(i.system_stock)}</td>
      <td class="num">${isOpen
        ? `<input type="number" step="0.01" value="${i.actual_stock ?? ''}" style="width:90px" oninput="ST.items[${realIdx}].actual_stock = this.value; stocktakeRecalc()">`
        : fmt(i.actual_stock)}</td>
      <td class="num">${Math.abs(diff) > 0.001 ? `<span class="badge ${diff > 0 ? 'badge-green' : 'badge-red'}">${diff > 0 ? '+' : ''}${fmt(diff)}</span>` : '<span class="muted small">—</span>'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4"><div class="empty">لا توجد أصناف في هذا القسم</div></td></tr>';
  document.getElementById('stDiffCount').textContent = diffs;
}

function stocktakeRecalc() {
  let diffs = 0;
  ST.items.forEach(i => {
    const diff = (Number(i.actual_stock) || 0) - i.system_stock;
    if (Math.abs(diff) > 0.001) diffs++;
  });
  const el = document.getElementById('stDiffCount');
  if (el) el.textContent = diffs;
}

async function stocktakeSaveCounts() {
  const payload = ST.items.map(i => ({ product_id: i.product_id, actual_stock: Number(i.actual_stock) || 0 }));
  await API.put('/api/stocktakes/' + ST.current.id + '/items', { items: payload });
  showAlert('تم حفظ الأعداد');
}

async function stocktakeClose(id) {
  if (!confirm('تأكيد غلق الجرد؟ سيتم تعديل مخزون كل المنتجات حسب الأعداد الفعلية.')) return;
  try {
    const payload = ST.items.map(i => ({ product_id: i.product_id, actual_stock: Number(i.actual_stock) || 0 }));
    await API.put('/api/stocktakes/' + id + '/items', { items: payload });
    const r = await API.post('/api/stocktakes/' + id + '/close');
    closeModal();
    showAlert(`تم غلق الجرد وتعديل المخزون. قيمة الفروق: ${fmt(r.diff_cost)}`);
    stocktakesLoad();
  } catch (e) { showAlert(e.message, 'error'); }
}

function stocktakeReport() {
  const st = ST.current;
  let lines = [
    `<div class="r-head"><h3>${esc(SETTINGS.store_name || 'سوبر ماركت')}</h3>`,
    `<div>تقرير جرد: ${esc(st.ref_no)}</div>`,
    `<div>${fmtDate(st.created_at)}</div></div>`,
    `<table><thead><tr><td style="text-align:right"><b>الصنف</b></td><td style="text-align:center"><b>النظامي</b></td><td style="text-align:center"><b>الفعلي</b></td><td style="text-align:left"><b>الفرق</b></td></tr></thead><tbody>`,
  ];
  for (const i of st.items) {
    const diff = (Number(i.actual_stock) || 0) - i.system_stock;
    lines.push(`<tr><td style="text-align:right">${esc(i.name)}</td><td style="text-align:center">${fmt(i.system_stock)}</td><td style="text-align:center">${fmt(i.actual_stock)}</td><td style="text-align:left">${diff !== 0 ? fmt(diff) : '—'}</td></tr>`);
  }
  lines.push(`</tbody></table>`,
    `<div class="r-foot">${esc(SETTINGS.invoice_footer || 'شكراً لتعاملكم معنا')}</div>`);
  return lines.join('\n');
}
