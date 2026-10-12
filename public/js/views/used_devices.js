let usedDevicesState = {
  devices: [],
  stats: { total: 0, availableCount: 0, soldCount: 0, totalPurchaseValue: 0, totalSalesValue: 0, totalProfit: 0 },
  statusFilter: 'all',
  searchQuery: ''
};

async function renderUsedDevices() {
  const container = document.getElementById('viewContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="card" style="margin-bottom: 20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px;">
        <div>
          <h2 style="margin:0; font-size:1.4rem;">📱 قسم الأجهزة المستعملة والمبايعات</h2>
          <p style="margin:4px 0 0 0; color:var(--text-muted, #666); font-size:0.9rem;">
            إدارة شراء وبيع الأجهزة المستعملة، متابعة المخزون والأرباح، وتوليد عقود المبايعة الرسمية.
          </p>
        </div>
        <div>
          <button class="btn btn-primary" onclick="openBuyDeviceModal()">
            <span>➕</span> شراء جهاز مستعمل جديد
          </button>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-top: 20px;">
        <div class="card" style="background: var(--bg-surface-2, #f8f9fa); border-right: 4px solid #3b82f6; padding: 12px 16px;">
          <div style="font-size:0.85rem; color:#555;">الأجهزة المتاحة للبيع</div>
          <div style="font-size:1.6rem; font-weight:bold; color:#1e40af;" id="statAvailable">0</div>
        </div>
        <div class="card" style="background: var(--bg-surface-2, #f8f9fa); border-right: 4px solid #10b981; padding: 12px 16px;">
          <div style="font-size:0.85rem; color:#555;">الأجهزة المباعة</div>
          <div style="font-size:1.6rem; font-weight:bold; color:#065f46;" id="statSold">0</div>
        </div>
        <div class="card" style="background: var(--bg-surface-2, #f8f9fa); border-right: 4px solid #8b5cf6; padding: 12px 16px;">
          <div style="font-size:0.85rem; color:#555;">إجمالي المشتريات</div>
          <div style="font-size:1.4rem; font-weight:bold; color:#5b21b6;" id="statPurchaseVal">0</div>
        </div>
        <div class="card" style="background: var(--bg-surface-2, #f8f9fa); border-right: 4px solid #f59e0b; padding: 12px 16px;">
          <div style="font-size:0.85rem; color:#555;">إجمالي قيمة المبيعات</div>
          <div style="font-size:1.4rem; font-weight:bold; color:#92400e;" id="statSalesVal">0</div>
        </div>
        <div class="card" style="background: var(--bg-surface-2, #f8f9fa); border-right: 4px solid #ec4899; padding: 12px 16px;">
          <div style="font-size:0.85rem; color:#555;">إجمالي أرباح البيع</div>
          <div style="font-size:1.4rem; font-weight:bold; color:#9d174d;" id="statProfitVal">0</div>
        </div>
      </div>
    </div>

    <!-- Filter & Search Toolbar -->
    <div class="card" style="margin-bottom: 20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <button class="btn btn-sm ${usedDevicesState.statusFilter === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="setUsedDeviceFilter('all')">الكل</button>
          <button class="btn btn-sm ${usedDevicesState.statusFilter === 'available' ? 'btn-primary' : 'btn-secondary'}" onclick="setUsedDeviceFilter('available')">متاح للبيع 🟢</button>
          <button class="btn btn-sm ${usedDevicesState.statusFilter === 'sold' ? 'btn-primary' : 'btn-secondary'}" onclick="setUsedDeviceFilter('sold')">تم البيع 🔴</button>
        </div>
        <div style="display:flex; gap:10px; flex:1; max-width:400px;">
          <input type="text" id="udSearchInput" class="form-control" placeholder="بحث بالسيريال / IMEI / اسم الجهاز / اسم العميل..." value="${esc(usedDevicesState.searchQuery)}" onkeyup="if(event.key==='Enter') searchUsedDevices()">
          <button class="btn btn-secondary" onclick="searchUsedDevices()">بحث</button>
        </div>
      </div>
    </div>

    <!-- Devices Table -->
    <div class="card">
      <div class="table-responsive">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>الكود</th>
              <th>الجهاز والماركة</th>
              <th>السيريال / IMEI</th>
              <th>البائع الأصلي</th>
              <th>تاريخ الشراء</th>
              <th>سعر الشراء</th>
              <th>الحالة</th>
              <th>المشتري / البيع</th>
              <th>الإجراءات وعقود المبايعة</th>
            </tr>
          </thead>
          <tbody id="usedDevicesTbody">
            <tr><td colspan="9" style="text-align:center; padding:30px;">جاري تحميل الأجهزة...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  await loadUsedDevicesData();
}

async function loadUsedDevicesData() {
  try {
    const params = new URLSearchParams();
    if (usedDevicesState.statusFilter && usedDevicesState.statusFilter !== 'all') params.append('status', usedDevicesState.statusFilter);
    if (usedDevicesState.searchQuery) params.append('q', usedDevicesState.searchQuery);

    const res = await API.get('/api/used-devices?' + params.toString());
    usedDevicesState.devices = res.devices || [];
    usedDevicesState.stats = res.stats || {};

    updateUsedDevicesStats();
    renderUsedDevicesTable();
  } catch (err) {
    showAlert('خطأ أثناء تحميل الأجهزة المستعملة: ' + (err.message || err), 'error');
  }
}

function updateUsedDevicesStats() {
  const st = usedDevicesState.stats;
  const currency = SETTINGS.currency || 'ج';
  const getEl = id => document.getElementById(id);

  if (getEl('statAvailable')) getEl('statAvailable').textContent = st.availableCount || 0;
  if (getEl('statSold')) getEl('statSold').textContent = st.soldCount || 0;
  if (getEl('statPurchaseVal')) getEl('statPurchaseVal').textContent = fmt(st.totalPurchaseValue || 0) + ' ' + currency;
  if (getEl('statSalesVal')) getEl('statSalesVal').textContent = fmt(st.totalSalesValue || 0) + ' ' + currency;
  if (getEl('statProfitVal')) getEl('statProfitVal').textContent = fmt(st.totalProfit || 0) + ' ' + currency;
}

function renderUsedDevicesTable() {
  const tbody = document.getElementById('usedDevicesTbody');
  if (!tbody) return;

  if (usedDevicesState.devices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#888;">لا توجد أجهزة مستعملة مطابقة للبحث</td></tr>`;
    return;
  }

  const currency = SETTINGS.currency || 'ج';

  tbody.innerHTML = usedDevicesState.devices.map(d => {
    const isAvailable = d.status === 'available';
    const statusBadge = isAvailable
      ? `<span class="badge" style="background:#d1fae5; color:#065f46; padding:4px 8px; border-radius:4px; font-weight:bold;">متاح للبيع</span>`
      : `<span class="badge" style="background:#fee2e2; color:#991b1b; padding:4px 8px; border-radius:4px; font-weight:bold;">تم البيع</span>`;

    const profit = !isAvailable ? (Number(d.sale_price) || 0) - (Number(d.purchase_price) || 0) : 0;
    const profitHtml = !isAvailable
      ? `<div style="font-size:0.8rem; color:${profit >= 0 ? '#10b981' : '#ef4444'};">الربح: ${fmt(profit)} ${currency}</div>`
      : '';

    return `
      <tr>
        <td><b>${esc(d.code)}</b></td>
        <td>
          <div style="font-weight:bold;">${esc(d.device_name)}</div>
          <div style="font-size:0.8rem; color:#666;">${esc(d.brand || '')} ${esc(d.model || '')}</div>
        </td>
        <td style="direction:ltr; text-align:right;">
          <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px;">${esc(d.serial_number || 'بدون سيريال')}</code>
        </td>
        <td>
          <div>${esc(d.seller_name || '—')}</div>
          <div style="font-size:0.8rem; color:#666;">${esc(d.seller_phone || '')}</div>
        </td>
        <td>${esc((d.purchase_date || '').slice(0, 10))}</td>
        <td style="font-weight:bold; color:#1e40af;">${fmt(d.purchase_price)} ${currency}</td>
        <td>${statusBadge}</td>
        <td>
          ${!isAvailable ? `
            <div style="font-weight:bold; color:#065f46;">${fmt(d.sale_price)} ${currency}</div>
            <div style="font-size:0.8rem;">إلى: ${esc(d.buyer_name || '—')}</div>
            ${profitHtml}
          ` : '<span style="color:#aaa;">—</span>'}
        </td>
        <td>
          <div style="display:flex; gap:4px; flex-wrap:wrap;">
            <button class="btn btn-sm btn-secondary" title="عرض التفاصيل" onclick="openDeviceDetailsModal(${d.id})">🔍</button>
            <button class="btn btn-sm btn-outline" title="طباعة مبايعة شراء" onclick="printPurchaseAgreement(${d.id})">📜 مبايعة شراء</button>
            ${isAvailable ? `
              <button class="btn btn-sm btn-success" title="بيع الجهاز" onclick="openSellDeviceModal(${d.id})">🛒 بيع</button>
            ` : `
              <button class="btn btn-sm btn-outline" title="طباعة مبايعة بيع" onclick="printSaleAgreement(${d.id})">📄 مبايعة بيع</button>
            `}
            <button class="btn btn-sm btn-secondary" title="تعديل" onclick="openEditDeviceModal(${d.id})">✏️</button>
            <button class="btn btn-sm btn-danger" title="حذف" onclick="deleteUsedDevice(${d.id})">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function setUsedDeviceFilter(filter) {
  usedDevicesState.statusFilter = filter;
  renderUsedDevices();
}

function searchUsedDevices() {
  const input = document.getElementById('udSearchInput');
  usedDevicesState.searchQuery = input ? input.value.trim() : '';
  loadUsedDevicesData();
}

/* ==================== MODALS: BUY & SELL ==================== */

function openBuyDeviceModal() {
  const html = `
    <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
      <h3 style="margin:0;">🛒 تسجيل شراء جهاز مستعمل جديد</h3>
      <button class="btn btn-sm btn-secondary" onclick="closeModal()">✕</button>
    </div>
    <form onsubmit="submitBuyDevice(event)">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label class="form-label">اسم / نوع الجهاز *</label>
          <input type="text" id="buy_device_name" class="form-control" placeholder="مثال: iPhone 13 Pro Max" required>
        </div>
        <div>
          <label class="form-label">الماركة (Brand)</label>
          <input type="text" id="buy_brand" class="form-control" placeholder="مثال: Apple, Samsung">
        </div>
        <div>
          <label class="form-label">الموديل (Model)</label>
          <input type="text" id="buy_model" class="form-control" placeholder="مثال: A2643">
        </div>
        <div>
          <label class="form-label">الرقم التسلسلي / IMEI *</label>
          <input type="text" id="buy_serial_number" class="form-control" placeholder="رقم IMEI أو Serial Number" style="direction:ltr;">
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <label class="form-label">حالة الجهاز والعيوب والملحقات</label>
        <textarea id="buy_condition_notes" class="form-control" rows="2" placeholder="حالة الشاشة، الفريم، الملحقات المتوفرة مثل الشاحن والعلبة..."></textarea>
      </div>

      <div style="background:#f8f9fa; border:1px solid #ddd; padding:12px; border-radius:6px; margin-bottom:15px;">
        <h4 style="margin:0 0 10px 0; font-size:1rem; color:#1e40af;">👤 بيانات البائع الأصلي (العميل)</h4>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div>
            <label class="form-label">اسم البائع بالكامل *</label>
            <input type="text" id="buy_seller_name" class="form-control" placeholder="اسم البائع الرباعي" required>
          </div>
          <div>
            <label class="form-label">الرقم القومي / الهوية</label>
            <input type="text" id="buy_seller_national_id" class="form-control" placeholder="الرقم القومي">
          </div>
          <div>
            <label class="form-label">رقم الهاتف</label>
            <input type="text" id="buy_seller_phone" class="form-control" placeholder="01xxxxxxxxx">
          </div>
          <div>
            <label class="form-label">العنوان</label>
            <input type="text" id="buy_seller_address" class="form-control" placeholder="محل الإقامة">
          </div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:15px;">
        <div>
          <label class="form-label">سعر الشراء المتفق عليه * (${SETTINGS.currency || 'ج'})</label>
          <input type="number" step="any" id="buy_purchase_price" class="form-control" placeholder="0.00" required>
        </div>
        <div>
          <label class="form-label">طريقة دفع الشراء (الوردية)</label>
          <select id="buy_purchase_method" class="form-control">
            <option value="cash">نقداً (كاش / الخزينة)</option>
            <option value="card">بطاقة / فيزا (Card)</option>
            <option value="wallet">محفظة إلكترونية (Wallet)</option>
            <option value="transfer">تحويل بنكي (Transfer)</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:15px;">
        <label class="form-label">ملاحظات إضافية</label>
        <input type="text" id="buy_notes" class="form-control" placeholder="ملاحظات العقد...">
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
        <button type="submit" class="btn btn-primary">حفظ وشراء الجهاز 💾</button>
      </div>
    </form>
  `;

  openModal(html, true);
}

async function submitBuyDevice(e) {
  e.preventDefault();
  const payload = {
    device_name: document.getElementById('buy_device_name').value.trim(),
    brand: document.getElementById('buy_brand').value.trim(),
    model: document.getElementById('buy_model').value.trim(),
    serial_number: document.getElementById('buy_serial_number').value.trim(),
    condition_notes: document.getElementById('buy_condition_notes').value.trim(),
    seller_name: document.getElementById('buy_seller_name').value.trim(),
    seller_national_id: document.getElementById('buy_seller_national_id').value.trim(),
    seller_phone: document.getElementById('buy_seller_phone').value.trim(),
    seller_address: document.getElementById('buy_seller_address').value.trim(),
    purchase_price: parseFloat(document.getElementById('buy_purchase_price').value),
    purchase_method: document.getElementById('buy_purchase_method').value,
    notes: document.getElementById('buy_notes').value.trim()
  };

  try {
    const res = await API.post('/api/used-devices/buy', payload);
    showAlert(res.message || 'تم قيد شراء الجهاز المستعمل بنجاح');
    closeModal();
    await loadUsedDevicesData();
    if (res.device) {
      printUsedDevicePurchaseAgreement(res.device);
    }
  } catch (err) {
    showAlert('خطأ: ' + (err.message || err), 'error');
  }
}

function openSellDeviceModal(id) {
  const device = usedDevicesState.devices.find(d => d.id === id);
  if (!device) return;

  const html = `
    <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
      <h3 style="margin:0;">💰 بيع جهاز مستعمل — ${esc(device.code)}</h3>
      <button class="btn btn-sm btn-secondary" onclick="closeModal()">✕</button>
    </div>
    <div style="background:#f1f5f9; padding:10px; border-radius:6px; margin-bottom:15px; font-size:0.9rem;">
      <div><b>الجهاز:</b> ${esc(device.device_name)} (${esc(device.brand || '')} ${esc(device.model || '')})</div>
      <div><b>السيريال / IMEI:</b> <code style="direction:ltr;">${esc(device.serial_number || 'بدون')}</code></div>
      <div><b>سعر الشراء الاصلي:</b> ${fmt(device.purchase_price)} ${SETTINGS.currency || 'ج'}</div>
    </div>
    <form onsubmit="submitSellDevice(${id}, event)">
      <div style="background:#f8f9fa; border:1px solid #ddd; padding:12px; border-radius:6px; margin-bottom:15px;">
        <h4 style="margin:0 0 10px 0; font-size:1rem; color:#065f46;">👤 بيانات المشتري</h4>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div>
            <label class="form-label">اسم المشتري بالكامل *</label>
            <input type="text" id="sell_buyer_name" class="form-control" placeholder="اسم المشتري الرباعي" required>
          </div>
          <div>
            <label class="form-label">الرقم القومي / الهوية</label>
            <input type="text" id="sell_buyer_national_id" class="form-control" placeholder="الرقم القومي">
          </div>
          <div>
            <label class="form-label">رقم الهاتف</label>
            <input type="text" id="sell_buyer_phone" class="form-control" placeholder="01xxxxxxxxx">
          </div>
          <div>
            <label class="form-label">العنوان</label>
            <input type="text" id="sell_buyer_address" class="form-control" placeholder="محل الإقامة">
          </div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:15px;">
        <div>
          <label class="form-label">سعر البيع المتفق عليه * (${SETTINGS.currency || 'ج'})</label>
          <input type="number" step="any" id="sell_sale_price" class="form-control" value="${device.purchase_price || ''}" required>
        </div>
        <div>
          <label class="form-label">طريقة تحصيل البيع (الوردية)</label>
          <select id="sell_sale_method" class="form-control">
            <option value="cash">نقداً (كاش / الخزينة)</option>
            <option value="card">بطاقة / فيزا (Card)</option>
            <option value="wallet">محفظة إلكترونية (Wallet)</option>
            <option value="transfer">تحويل بنكي (Transfer)</option>
          </select>
        </div>
        <div>
          <label class="form-label">فترة الضمان (بالأيام)</label>
          <input type="number" id="sell_warranty_days" class="form-control" value="30" placeholder="مثال: 30">
        </div>
      </div>

      <div style="margin-bottom:15px;">
        <label class="form-label">ملاحظات البيع / الفاتورة</label>
        <textarea id="sell_notes" class="form-control" rows="2" placeholder="ملاحظات الضمان والبيع..."></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
        <button type="submit" class="btn btn-success">تأكيد البيع وإصدار الفاتورة 💵</button>
      </div>
    </form>
  `;

  openModal(html, true);
}

async function submitSellDevice(id, e) {
  e.preventDefault();
  const payload = {
    buyer_name: document.getElementById('sell_buyer_name').value.trim(),
    buyer_national_id: document.getElementById('sell_buyer_national_id').value.trim(),
    buyer_phone: document.getElementById('sell_buyer_phone').value.trim(),
    buyer_address: document.getElementById('sell_buyer_address').value.trim(),
    sale_price: parseFloat(document.getElementById('sell_sale_price').value),
    sale_method: document.getElementById('sell_sale_method').value,
    warranty_days: parseInt(document.getElementById('sell_warranty_days').value || 0),
    notes: document.getElementById('sell_notes').value.trim()
  };

  try {
    const res = await API.post(`/api/used-devices/${id}/sell`, payload);
    showAlert(res.message || 'تم إتمام بيع الجهاز بنجاح');
    closeModal();
    await loadUsedDevicesData();
    if (res.device) {
      printUsedDeviceSaleAgreement(res.device);
    }
  } catch (err) {
    showAlert('خطأ: ' + (err.message || err), 'error');
  }
}

function openEditDeviceModal(id) {
  const device = usedDevicesState.devices.find(d => d.id === id);
  if (!device) return;

  const html = `
    <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
      <h3 style="margin:0;">✏️ تعديل بيانات الجهاز المستعمل (${esc(device.code)})</h3>
      <button class="btn btn-sm btn-secondary" onclick="closeModal()">✕</button>
    </div>
    <form onsubmit="submitEditDevice(${id}, event)">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
        <div>
          <label class="form-label">اسم الجهاز</label>
          <input type="text" id="edit_device_name" class="form-control" value="${esc(device.device_name)}" required>
        </div>
        <div>
          <label class="form-label">الماركة</label>
          <input type="text" id="edit_brand" class="form-control" value="${esc(device.brand || '')}">
        </div>
        <div>
          <label class="form-label">الموديل</label>
          <input type="text" id="edit_model" class="form-control" value="${esc(device.model || '')}">
        </div>
        <div>
          <label class="form-label">السيريال / IMEI</label>
          <input type="text" id="edit_serial_number" class="form-control" value="${esc(device.serial_number || '')}" style="direction:ltr;">
        </div>
        <div>
          <label class="form-label">اسم البائع</label>
          <input type="text" id="edit_seller_name" class="form-control" value="${esc(device.seller_name || '')}">
        </div>
        <div>
          <label class="form-label">هاتف البائع</label>
          <input type="text" id="edit_seller_phone" class="form-control" value="${esc(device.seller_phone || '')}">
        </div>
        <div>
          <label class="form-label">سعر الشراء</label>
          <input type="number" step="any" id="edit_purchase_price" class="form-control" value="${device.purchase_price || 0}">
        </div>
        <div>
          <label class="form-label">طريقة الشراء</label>
          <select id="edit_purchase_method" class="form-control">
            <option value="cash" ${device.purchase_method === 'cash' ? 'selected' : ''}>نقداً (كاش)</option>
            <option value="card" ${device.purchase_method === 'card' ? 'selected' : ''}>بطاقة (Card)</option>
            <option value="wallet" ${device.purchase_method === 'wallet' ? 'selected' : ''}>محفظة (Wallet)</option>
            <option value="transfer" ${device.purchase_method === 'transfer' ? 'selected' : ''}>تحويل بنكي</option>
          </select>
        </div>
        <div>
          <label class="form-label">حالة الجهاز</label>
          <select id="edit_status" class="form-control">
            <option value="available" ${device.status === 'available' ? 'selected' : ''}>متاح للبيع</option>
            <option value="sold" ${device.status === 'sold' ? 'selected' : ''}>تم البيع</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:10px;">
        <label class="form-label">حالة الجهاز والعيوب والملحقات</label>
        <textarea id="edit_condition_notes" class="form-control" rows="2">${esc(device.condition_notes || '')}</textarea>
      </div>

      ${device.status === 'sold' ? `
        <div style="background:#f8f9fa; padding:10px; border-radius:6px; margin-bottom:10px;">
          <h5 style="margin:0 0 8px 0;">بيانات البيع:</h5>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <label class="form-label">سعر البيع</label>
              <input type="number" step="any" id="edit_sale_price" class="form-control" value="${device.sale_price || 0}">
            </div>
            <div>
              <label class="form-label">طريقة البيع</label>
              <select id="edit_sale_method" class="form-control">
                <option value="cash" ${device.sale_method === 'cash' ? 'selected' : ''}>نقداً (كاش)</option>
                <option value="card" ${device.sale_method === 'card' ? 'selected' : ''}>بطاقة (Card)</option>
                <option value="wallet" ${device.sale_method === 'wallet' ? 'selected' : ''}>محفظة (Wallet)</option>
                <option value="transfer" ${device.sale_method === 'transfer' ? 'selected' : ''}>تحويل بنكي</option>
              </select>
            </div>
            <div>
              <label class="form-label">اسم المشتري</label>
              <input type="text" id="edit_buyer_name" class="form-control" value="${esc(device.buyer_name || '')}">
            </div>
          </div>
        </div>
      ` : ''}

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:15px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
        <button type="submit" class="btn btn-primary">حفظ التعديلات 💾</button>
      </div>
    </form>
  `;

  openModal(html, true);
}

async function submitEditDevice(id, e) {
  e.preventDefault();
  const payload = {
    device_name: document.getElementById('edit_device_name').value.trim(),
    brand: document.getElementById('edit_brand').value.trim(),
    model: document.getElementById('edit_model').value.trim(),
    serial_number: document.getElementById('edit_serial_number').value.trim(),
    seller_name: document.getElementById('edit_seller_name').value.trim(),
    seller_phone: document.getElementById('edit_seller_phone').value.trim(),
    purchase_price: parseFloat(document.getElementById('edit_purchase_price').value),
    purchase_method: document.getElementById('edit_purchase_method').value,
    status: document.getElementById('edit_status').value,
    condition_notes: document.getElementById('edit_condition_notes').value.trim()
  };

  const salePriceEl = document.getElementById('edit_sale_price');
  if (salePriceEl) payload.sale_price = parseFloat(salePriceEl.value);
  const saleMethodEl = document.getElementById('edit_sale_method');
  if (saleMethodEl) payload.sale_method = saleMethodEl.value;
  const buyerNameEl = document.getElementById('edit_buyer_name');
  if (buyerNameEl) payload.buyer_name = buyerNameEl.value.trim();

  try {
    const res = await API.put(`/api/used-devices/${id}`, payload);
    showAlert(res.message || 'تم تحديث البيانات بنجاح');
    closeModal();
    await loadUsedDevicesData();
  } catch (err) {
    showAlert('خطأ: ' + (err.message || err), 'error');
  }
}

async function deleteUsedDevice(id) {
  if (!confirm('هل أنت تأكد من رغبتك في حذف هذا الجهاز المستعمل نهائياً؟')) return;
  try {
    const res = await API.delete(`/api/used-devices/${id}`);
    showAlert(res.message || 'تم الحذف بنجاح');
    await loadUsedDevicesData();
  } catch (err) {
    showAlert('خطأ أثناء الحذف: ' + (err.message || err), 'error');
  }
}

function openDeviceDetailsModal(id) {
  const device = usedDevicesState.devices.find(d => d.id === id);
  if (!device) return;

  const currency = SETTINGS.currency || 'ج';
  const isAvailable = device.status === 'available';

  const html = `
    <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
      <h3 style="margin:0;">📱 تفاصيل الجهاز المستعمل (${esc(device.code)})</h3>
      <button class="btn btn-sm btn-secondary" onclick="closeModal()">✕</button>
    </div>
    
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:15px;">
      <div style="background:#fafafa; border:1px solid #ddd; padding:12px; border-radius:6px;">
        <h4 style="margin:0 0 8px 0; color:#1e40af;">مواصفات الجهاز</h4>
        <p style="margin:4px 0;"><b>اسم الجهاز:</b> ${esc(device.device_name)}</p>
        <p style="margin:4px 0;"><b>الماركة والـ Model:</b> ${esc(device.brand || '')} ${esc(device.model || '')}</p>
        <p style="margin:4px 0;"><b>السيريال / IMEI:</b> <code style="direction:ltr;">${esc(device.serial_number || 'بدون')}</code></p>
        <p style="margin:4px 0;"><b>الحالة والملاحظات:</b> ${esc(device.condition_notes || 'لا يوجد')}</p>
        <p style="margin:4px 0;"><b>سعر الشراء:</b> ${fmt(device.purchase_price)} ${currency}</p>
        <p style="margin:4px 0;"><b>تاريخ الشراء:</b> ${esc(device.purchase_date || '')}</p>
      </div>

      <div style="background:#fafafa; border:1px solid #ddd; padding:12px; border-radius:6px;">
        <h4 style="margin:0 0 8px 0; color:#065f46;">بيانات البائع والمشتري</h4>
        <p style="margin:4px 0;"><b>البائع الاصلي:</b> ${esc(device.seller_name || '—')}</p>
        <p style="margin:4px 0;"><b>رقم القومي للبائع:</b> ${esc(device.seller_national_id || '—')}</p>
        <p style="margin:4px 0;"><b>هاتف البائع:</b> ${esc(device.seller_phone || '—')}</p>
        <hr style="margin:8px 0; border:0; border-top:1px dashed #ccc;">
        <p style="margin:4px 0;"><b>المشتري:</b> ${esc(device.buyer_name || '—')}</p>
        <p style="margin:4px 0;"><b>هاتف المشتري:</b> ${esc(device.buyer_phone || '—')}</p>
        <p style="margin:4px 0;"><b>سعر البيع:</b> ${device.sale_price ? fmt(device.sale_price) + ' ' + currency : '—'}</p>
        <p style="margin:4px 0;"><b>الضمان:</b> ${device.warranty_days ? device.warranty_days + ' يوم' : 'بدون'}</p>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px;">
      <div>
        <button class="btn btn-outline" onclick="printPurchaseAgreement(${device.id})">📜 طباعة مبايعة شراء</button>
        ${!isAvailable ? `<button class="btn btn-outline" onclick="printSaleAgreement(${device.id})">📄 طباعة مبايعة بيع</button>` : ''}
      </div>
      <button class="btn btn-secondary" onclick="closeModal()">إغلاق</button>
    </div>
  `;

  openModal(html, true);
}

function printPurchaseAgreement(id) {
  const device = usedDevicesState.devices.find(d => d.id === id);
  if (device) printUsedDevicePurchaseAgreement(device);
}

function printSaleAgreement(id) {
  const device = usedDevicesState.devices.find(d => d.id === id);
  if (device) printUsedDeviceSaleAgreement(device);
}

// Make views render function globally accessible
window.renderUsedDevices = renderUsedDevices;
