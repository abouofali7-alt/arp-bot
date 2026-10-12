let wbCurrentTab = 'stats';
let wbCachedInterests = [];

async function renderWhatsAppBot() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="whatsapp-bot-view">
      <div class="card" style="margin-bottom:14px; background:linear-gradient(135deg, rgba(22,163,74,0.06), rgba(37,99,235,0.06)); border-color:rgba(22,163,74,0.25);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:46px; height:46px; border-radius:12px; background:linear-gradient(135deg, #25D366, #128C7E); display:flex; align-items:center; justify-content:center; font-size:24px; color:#fff; box-shadow:0 4px 12px rgba(37,211,102,0.35);">
              🤖
            </div>
            <div>
              <h2 style="margin:0; font-size:1.25rem; font-weight:800; display:flex; align-items:center; gap:8px;">
                بوت واتساب الذكي & الربط مع n8n
                <span class="badge badge-green" style="font-size:0.75rem;">نشط ومربوط بالمخزون</span>
              </h2>
              <div class="small muted">الرد التلقائي على استفسارات الأسعار والمخزون، وتجميع اهتمامات العملاء وإرسال الحملات الترويجية</div>
            </div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-sm btn-ghost" onclick="wbSwitchTab('sandbox')">🧪 تجربة البوت المباشرة</button>
            <button class="btn btn-sm btn-secondary" onclick="wbSwitchTab('n8n')">⚡ إعدادات n8n والمفتاح</button>
          </div>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="wb-nav-tabs" style="display:flex; gap:8px; margin-bottom:18px; border-bottom:2px solid var(--border); padding-bottom:8px; overflow-x:auto;">
        <button class="btn btn-sm ${wbCurrentTab === 'stats' ? 'btn-primary' : 'btn-secondary'}" onclick="wbSwitchTab('stats')">📊 الإحصائيات والسجل</button>
        <button class="btn btn-sm ${wbCurrentTab === 'customers' ? 'btn-primary' : 'btn-secondary'}" onclick="wbSwitchTab('customers')">👥 دليل العملاء والاهتمامات</button>
        <button class="btn btn-sm ${wbCurrentTab === 'campaigns' ? 'btn-primary' : 'btn-secondary'}" onclick="wbSwitchTab('campaigns')">📢 حملات العروض والتسويق</button>
        <button class="btn btn-sm ${wbCurrentTab === 'n8n' ? 'btn-primary' : 'btn-secondary'}" onclick="wbSwitchTab('n8n')">⚙️ الربط مع n8n ودليل التشغيل</button>
        <button class="btn btn-sm ${wbCurrentTab === 'sandbox' ? 'btn-primary' : 'btn-secondary'}" onclick="wbSwitchTab('sandbox')">🧪 محاكي البوت والردود</button>
      </div>

      <!-- Tab Content Area -->
      <div id="wbTabContent"></div>
    </div>
  `;

  wbRenderCurrentTab();
}

function wbSwitchTab(tab) {
  wbCurrentTab = tab;
  renderWhatsAppBot();
}

function wbRenderCurrentTab() {
  const container = document.getElementById('wbTabContent');
  if (!container) return;

  if (wbCurrentTab === 'stats') {
    wbRenderStatsTab(container);
  } else if (wbCurrentTab === 'customers') {
    wbRenderCustomersTab(container);
  } else if (wbCurrentTab === 'campaigns') {
    wbRenderCampaignsTab(container);
  } else if (wbCurrentTab === 'n8n') {
    wbRenderN8nTab(container);
  } else if (wbCurrentTab === 'sandbox') {
    wbRenderSandboxTab(container);
  }
}

let wbLivePollTimer = null;

function wbGenerateLogsRowsHtml(logs) {
  if (!logs || logs.length === 0) {
    return `<tr><td colspan="6" class="text-center muted">لا توجد رسائل مسجلة حتى الآن</td></tr>`;
  }
  return logs.map(l => {
    const isIn = l.direction === 'inbound';
    const dirBadge = isIn 
      ? '<span class="badge badge-green">📥 وارد (عميل)</span>' 
      : '<span class="badge badge-blue">📤 صادر (رد آلي)</span>';
    
    let productsSummary = '-';
    if (l.matched_products) {
      try {
        const arr = JSON.parse(l.matched_products);
        if (Array.isArray(arr) && arr.length > 0) {
          productsSummary = arr.map(p => `<span class="badge badge-orange" style="margin:2px;">${esc(p.name || p)}</span>`).join('');
        }
      } catch {
        productsSummary = esc(l.matched_products);
      }
    }

    return `
      <tr>
        <td style="white-space:nowrap;" class="small">${fmtDate(l.created_at)}</td>
        <td>${dirBadge}</td>
        <td>
          <b>${esc(l.customer_name || 'عميل')}</b>
          <div class="small muted" dir="ltr" style="text-align:right;">${esc(l.phone)}</div>
        </td>
        <td style="max-width:320px; white-space:pre-wrap; font-size:0.85rem;">${esc(l.message)}</td>
        <td>${productsSummary}</td>
        <td style="white-space:nowrap;">
          <a href="https://wa.me/${esc(l.phone)}" target="_blank" class="btn btn-sm btn-ghost" title="فتح المحادثة على واتساب">💬 واتساب</a>
        </td>
      </tr>
    `;
  }).join('');
}

function wbStartLivePolling() {
  if (wbLivePollTimer) clearInterval(wbLivePollTimer);
  wbLivePollTimer = setInterval(async () => {
    const tableBody = document.getElementById('wbLogsTableBody');
    if (!tableBody || wbCurrentTab !== 'stats') {
      clearInterval(wbLivePollTimer);
      wbLivePollTimer = null;
      return;
    }
    try {
      const res = await API.get('/api/bot/stats');
      if (res && res.recent_logs && tableBody) {
        tableBody.innerHTML = wbGenerateLogsRowsHtml(res.recent_logs);
      }
    } catch {}
  }, 3500);
}

async function wbQuickSendTest() {
  const phone = prompt('أدخل رقم هاتف لتجربة الإرسال المباشر إليه عبر البوت:', '01070329441');
  if (!phone) return;
  try {
    showAlert('جاري إرسال رسالة الاختبار عبر البوت...', 'info');
    const res = await API.post('/api/bot/test-send', {
      phone,
      message: 'مرحباً بك! 👋\nهذه رسالة اختبار حية لتأكيد ربط البوت برقم المحل بنجاح 🚀✅'
    });
    if (res.ok) {
      showAlert('تم تسليم الرسالة بنجاح إلى واتساب! 📱✅', 'success');
      wbRenderStatsTab(document.getElementById('wbTabContent'));
    }
  } catch (err) {
    showAlert('تعذر الإرسال: ' + err.message, 'error');
  }
}

/* =========================================================================
   TAB 1: STATS & OVERVIEW
   ========================================================================= */
async function wbRenderStatsTab(container) {
  container.innerHTML = `
    <div style="text-align:center; padding:30px;" class="muted">جاري تحميل الإحصائيات...</div>
  `;

  try {
    const res = await API.get('/api/bot/stats');
    const s = res.stats || {};
    wbCachedInterests = s.top_interests || [];

    let interestsHtml = '';
    if (s.top_interests && s.top_interests.length > 0) {
      interestsHtml = s.top_interests.map(t => `
        <span class="badge badge-blue" style="cursor:pointer; font-size:0.85rem; padding:6px 12px; margin:4px;" onclick="wbFilterByInterest('${esc(t.name)}')" title="اضغط لتصفية العملاء">
          🏷️ ${esc(t.name)} <b style="margin-right:4px;">(${t.count})</b>
        </span>
      `).join('');
    } else {
      interestsHtml = '<div class="small muted">لم يتم تسجيل اهتمامات بعد — ستظهر تلقائياً بمجرد إرسال العملاء رسائل بالمنتجات التي يبحثون عنها.</div>';
    }

    const logsRows = wbGenerateLogsRowsHtml(res.recent_logs);

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px; background:linear-gradient(90deg, rgba(37,211,102,0.12), rgba(18,140,126,0.06)); border:1px solid #25D366; padding:12px 16px; border-radius:10px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:#25D366; box-shadow:0 0 10px #25D366;"></span>
          <div>
            <b style="color:var(--text); font-size:0.95rem;">البوت متصل ويستمع لحظياً للرسائل على رقم المتجر: <span dir="ltr">01050592877</span></b>
            <div class="small muted">يتم استلام الرسائل والرد عليها وتحديث هذا الجدول تلقائياً كل 3 ثوانٍ ⚡</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="btn btn-sm btn-ghost" onclick="wbRenderStatsTab(document.getElementById('wbTabContent'))">🔄 تحديث يدوي</button>
          <button class="btn btn-sm btn-success" onclick="wbQuickSendTest()">🚀 تجربة إرسال لهاتفي</button>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat green">
          <div class="icon">👥</div>
          <div class="label">إجمالي عملاء البوت</div>
          <div class="value">${fmt(s.total_customers)}</div>
        </div>
        <div class="stat blue">
          <div class="icon">📥</div>
          <div class="label">استفسارات اليوم</div>
          <div class="value">${fmt(s.today_inquiries)}</div>
        </div>
        <div class="stat orange">
          <div class="icon">💬</div>
          <div class="label">إجمالي الاستفسارات عبر التاريخ</div>
          <div class="value">${fmt(s.total_inquiries)}</div>
        </div>
        <div class="stat">
          <div class="icon">📢</div>
          <div class="label">الحملات الترويجية المرسلة</div>
          <div class="value">${fmt(s.total_campaigns)}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>🏷️ سحابة اهتمامات العملاء الأكثر طلباً</span>
          <button class="btn btn-sm btn-secondary" onclick="wbSwitchTab('customers')">عرض تفاصيل العملاء ←</button>
        </div>
        <p class="small muted mb-10">يتم تصنيف هذه الاهتمامات تلقائياً عبر تحليل الكلمات المفتاحية وأسماء المنتجات التي يسأل عنها العملاء على واتساب:</p>
        <div style="display:flex; flex-wrap:wrap; gap:6px; padding:10px; background:var(--bg); border-radius:10px;">
          ${interestsHtml}
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>📝 أحدث سجلات المحادثات والاستفسارات (تحديث لحظي)</span>
          <button class="btn btn-sm btn-ghost" onclick="wbRenderStatsTab(document.getElementById('wbTabContent'))">🔄 تحديث</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الوقت</th>
                <th>الاتجاه</th>
                <th>العميل والرقم</th>
                <th>نص الرسالة</th>
                <th>المنتجات المطابقة</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody id="wbLogsTableBody">
              ${logsRows}
            </tbody>
          </table>
        </div>
      </div>
    `;

    wbStartLivePolling();
  } catch (err) {
    container.innerHTML = `<div class="alert error">تعذر تحميل الإحصائيات: ${esc(err.message)}</div>`;
  }
}

/* =========================================================================
   TAB 2: CUSTOMERS & LEADS CRM
   ========================================================================= */
async function wbRenderCustomersTab(container, filterInterest = '') {
  container.innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>👥 قاعدة بيانات عملاء واتساب واهتماماتهم</span>
        <button class="btn btn-sm btn-success" onclick="wbSwitchTab('campaigns')">📢 إرسال عرض مخصص لهؤلاء العملاء</button>
      </div>
      <div class="grid-3 mb-10">
        <div class="form-group" style="margin:0;">
          <input type="text" id="wbCustSearch" placeholder="بحث بالاسم أو رقم الهاتف..." oninput="wbDebounceCustomers()">
        </div>
        <div class="form-group" style="margin:0;">
          <input type="text" id="wbCustInterest" placeholder="تصفية حسب الاهتمام (مثل: شاحن، ايفون...)" value="${esc(filterInterest)}" oninput="wbDebounceCustomers()">
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary btn-block" onclick="wbLoadCustomersList()">🔍 بحث</button>
          <button class="btn btn-ghost" onclick="document.getElementById('wbCustSearch').value=''; document.getElementById('wbCustInterest').value=''; wbLoadCustomersList();">إلغاء</button>
        </div>
      </div>

      <div id="wbCustTableContainer" style="margin-top:14px;">
        <div style="text-align:center; padding:20px;" class="muted">جاري تحميل العملاء...</div>
      </div>
    </div>
  `;

  wbLoadCustomersList();
}

let wbDebounceTimer = null;
function wbDebounceCustomers() {
  clearTimeout(wbDebounceTimer);
  wbDebounceTimer = setTimeout(() => wbLoadCustomersList(), 350);
}

function wbFilterByInterest(tag) {
  wbCurrentTab = 'customers';
  renderWhatsAppBot();
  setTimeout(() => {
    const inp = document.getElementById('wbCustInterest');
    if (inp) {
      inp.value = tag;
      wbLoadCustomersList();
    }
  }, 50);
}

async function wbLoadCustomersList() {
  const container = document.getElementById('wbCustTableContainer');
  if (!container) return;

  const search = document.getElementById('wbCustSearch')?.value || '';
  const interest = document.getElementById('wbCustInterest')?.value || '';

  try {
    const url = `/api/bot/customers?search=${encodeURIComponent(search)}&interest=${encodeURIComponent(interest)}`;
    const res = await API.get(url);
    const customers = res.customers || [];

    if (customers.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px;" class="muted">
          <div style="font-size:32px; margin-bottom:8px;">📭</div>
          <div>لا يوجد عملاء يطابقون شروط البحث</div>
        </div>
      `;
      return;
    }

    const rows = customers.map(c => {
      let interestsBadges = '-';
      if (c.interests) {
        interestsBadges = c.interests.split(',').map(s => s.trim()).filter(Boolean).map(tag => `
          <span class="badge badge-blue" style="cursor:pointer; margin:2px;" onclick="wbFilterByInterest('${esc(tag)}')">${esc(tag)}</span>
        `).join('');
      }

      return `
        <tr>
          <td>
            <b>${esc(c.name || 'عميل غير محدد')}</b>
            ${c.notes ? `<div class="small muted">📝 ${esc(c.notes)}</div>` : ''}
          </td>
          <td dir="ltr" style="text-align:right; font-weight:700;">
            ${esc(c.phone)}
          </td>
          <td style="max-width:280px;">${interestsBadges}</td>
          <td class="num">${fmt(c.inquiries_count)}</td>
          <td class="small">${fmtDate(c.last_inquiry_at)}</td>
          <td style="white-space:nowrap; text-align:left;">
            <a href="https://wa.me/${esc(c.phone)}" target="_blank" class="btn btn-sm btn-success" title="محادثة واتساب">💬 مراسلة</a>
            <button class="btn btn-sm btn-secondary" onclick="wbOpenCustomerModal(${c.id})" title="تعديل">✏️</button>
            <button class="btn btn-sm btn-ghost" onclick="wbDeleteCustomer(${c.id})" title="حذف" style="color:var(--danger);">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div class="small muted mb-10">إجمالي النتائج: <b>${customers.length}</b> عميل</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>اسم العميل</th>
              <th>رقم الهاتف</th>
              <th>الاهتمامات المسجلة</th>
              <th class="num">عدد الاستفسارات</th>
              <th>آخر تواصل</th>
              <th style="text-align:left;">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="alert error">تعذر تحميل العملاء: ${esc(err.message)}</div>`;
  }
}

async function wbOpenCustomerModal(id) {
  try {
    const res = await API.get('/api/bot/customers');
    const c = (res.customers || []).find(x => x.id === id);
    if (!c) return toast('العميل غير موجود', 'error');

    openModal(`
      <div class="modal-head">✏️ تعديل بيانات العميل</div>
      <div class="modal-body">
        <div class="form-group">
          <label>رقم الهاتف</label>
          <input type="text" value="${esc(c.phone)}" disabled style="background:var(--bg);">
        </div>
        <div class="form-group">
          <label>اسم العميل</label>
          <input type="text" id="wbEditCustName" value="${esc(c.name || '')}" placeholder="اسم العميل...">
        </div>
        <div class="form-group">
          <label>الاهتمامات (مفصولة بفواصل)</label>
          <input type="text" id="wbEditCustInterests" value="${esc(c.interests || '')}" placeholder="شواحن, ايفون, صيانة...">
          <div class="small muted">اكتب الكلمات أو الأقسام التي يفضلها العميل لتصل له العروض الخاصة بها</div>
        </div>
        <div class="form-group">
          <label>ملاحظات إضافية</label>
          <textarea id="wbEditCustNotes" rows="3" placeholder="أي ملاحظات خاصة بالعميل...">${esc(c.notes || '')}</textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="wbSaveCustomer(${id})">حفظ التعديلات</button>
        <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
      </div>
    `);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function wbSaveCustomer(id) {
  const name = document.getElementById('wbEditCustName')?.value;
  const interests = document.getElementById('wbEditCustInterests')?.value;
  const notes = document.getElementById('wbEditCustNotes')?.value;

  try {
    await API.put(`/api/bot/customers/${id}`, { name, interests, notes });
    closeModal();
    toast('تم حفظ بيانات العميل بنجاح');
    wbLoadCustomersList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function wbDeleteCustomer(id) {
  if (!confirm('هل أنت متأكد من حذف هذا العميل من سجلات البوت؟')) return;
  try {
    await API.del(`/api/bot/customers/${id}`);
    toast('تم حذف العميل بنجاح');
    wbLoadCustomersList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* =========================================================================
   TAB 3: MARKETING CAMPAIGNS & BROADCAST
   ========================================================================= */
async function wbRenderCampaignsTab(container) {
  container.innerHTML = `
    <div class="grid-2">
      <div>
        <div class="card">
          <div class="card-title">📢 إطلاق حملة عروض جديدة</div>
          <p class="small muted mb-10">صمم رسالة العرض الترويجي واستهدف بها العملاء المهتمين بمنتجات أو أقسام معينة لزيادة المبيعات:</p>
          
          <div class="form-group">
            <label>عنوان الحملة (داخلي)</label>
            <input type="text" id="wbCampTitle" placeholder="مثال: خصم 20% على إكسسوارات الهواتف" value="عرض خاص ومميز 🔥">
          </div>

          <div class="form-group">
            <label>الفئة المستهدفة من العملاء</label>
            <select id="wbCampTarget" onchange="wbUpdateTargetAudienceCount()">
              <option value="all">👥 جميع العملاء المسجلين</option>
            </select>
            <div id="wbAudienceCount" class="small muted mt-4" style="color:var(--primary); font-weight:700;">جاري حساب الجمهور...</div>
          </div>

          <div class="form-group">
            <label>نص رسالة العرض (التي ستصل للعملاء على واتساب)</label>
            <textarea id="wbCampMessage" rows="6" placeholder="اكتب تفاصيل العرض والخصومات والمنتجات المشمولة..." oninput="wbUpdateCampaignPreview()">يسرنا إبلاغكم بوصول تشكيلة جديدة ومميزة بأسعار خاصة جداً لفترة محدودة! 🎁
سارع بزيارتنا أو الرد على هذه الرسالة للحجز والاستفادة من العرض.</textarea>
          </div>

          <div style="background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:12px; margin-bottom:14px;">
            <div class="small muted mb-6">📱 معاينة شكل الرسالة:</div>
            <div id="wbCampPreview" style="background:var(--card); padding:10px; border-radius:8px; font-size:0.88rem; white-space:pre-wrap; border-right:4px solid #25D366;"></div>
          </div>

          <div class="modal-foot" style="justify-content:flex-start; gap:10px;">
            <button class="btn btn-success" id="wbSendCampBtn" onclick="wbExecuteCampaign()">🚀 إرسال العرض الآن</button>
            <button class="btn btn-secondary" onclick="wbSwitchTab('n8n')">⚙️ ضبط Webhook الربط مع n8n</button>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title">
            <span>📋 سجل الحملات السابقة</span>
            <button class="btn btn-sm btn-ghost" onclick="wbLoadCampaignsHistory()">🔄 تحديث</button>
          </div>
          <div id="wbCampaignsHistoryContainer">
            <div style="text-align:center; padding:30px;" class="muted">جاري تحميل الحملات...</div>
          </div>
        </div>
      </div>
    </div>
  `;

  wbPopulateTargetOptions();
  wbUpdateCampaignPreview();
  wbLoadCampaignsHistory();
}

async function wbPopulateTargetOptions() {
  const sel = document.getElementById('wbCampTarget');
  if (!sel) return;

  try {
    const res = await API.get('/api/bot/stats');
    const interests = res.stats?.top_interests || [];

    interests.forEach(i => {
      const opt = document.createElement('option');
      opt.value = i.name;
      opt.textContent = `🎯 المهتمين بـ: ${i.name} (${i.count} عميل)`;
      sel.appendChild(opt);
    });

    wbUpdateTargetAudienceCount();
  } catch {}
}

async function wbUpdateTargetAudienceCount() {
  const lbl = document.getElementById('wbAudienceCount');
  const sel = document.getElementById('wbCampTarget');
  if (!lbl || !sel) return;

  const target = sel.value;
  try {
    const url = target === 'all' ? '/api/bot/customers' : `/api/bot/customers?interest=${encodeURIComponent(target)}`;
    const res = await API.get(url);
    const count = (res.customers || []).length;
    lbl.textContent = `🎯 سيتم إرسال العرض إلى: ${count} عميل`;
  } catch {
    lbl.textContent = 'تعذر حساب عدد العملاء';
  }
}

function wbUpdateCampaignPreview() {
  const title = document.getElementById('wbCampTitle')?.value || '';
  const msg = document.getElementById('wbCampMessage')?.value || '';
  const prev = document.getElementById('wbCampPreview');
  if (!prev) return;

  prev.innerHTML = `📢 <b>${esc(title)}</b>\n\nمرحباً بك يا عميلنا العزيز 👋\n\n${esc(msg)}\n\n━━━━━━━━━━━━━━━\nللحجز أو الاستفسار تواصل معنا فوراً! 🎁`;
}

async function wbExecuteCampaign() {
  const title = document.getElementById('wbCampTitle')?.value;
  const message = document.getElementById('wbCampMessage')?.value;
  const target_interest = document.getElementById('wbCampTarget')?.value;

  if (!title || !title.trim()) return toast('يرجى كتابة عنوان الحملة', 'error');
  if (!message || !message.trim()) return toast('يرجى كتابة نص رسالة العرض', 'error');

  const btn = document.getElementById('wbSendCampBtn');
  if (btn) btn.disabled = true;

  try {
    const res = await API.post('/api/bot/campaigns/send', { title, message, target_interest });
    toast(res.message || 'تم إطلاق الحملة بنجاح');
    
    if (res.n8n_triggered) {
      toast('⚡ تم توجيه الحملة إلى n8n بنجاح للبدء في الإرسال التلقائي!', 'success');
    } else if (res.n8n_error) {
      toast(`⚠️ لم يتم الاتصال بـ n8n (${res.n8n_error}) — تأكد من تشغيل الـ Webhook في n8n`, 'warning');
    }

    wbLoadCampaignsHistory();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function wbLoadCampaignsHistory() {
  const container = document.getElementById('wbCampaignsHistoryContainer');
  if (!container) return;

  try {
    const res = await API.get('/api/bot/campaigns');
    const list = res.campaigns || [];

    if (list.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:30px;" class="muted">لا توجد حملات تسويقية سابقة</div>`;
      return;
    }

    const rows = list.map(c => `
      <tr>
        <td>
          <b>${esc(c.title)}</b>
          <div class="small muted" style="max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(c.message)}</div>
        </td>
        <td><span class="badge badge-blue">${esc(c.target_interest === 'all' ? 'الكل' : c.target_interest)}</span></td>
        <td class="num font-bold">${fmt(c.recipient_count)}</td>
        <td class="small">${fmtDate(c.sent_at || c.created_at)}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>العنوان والرسالة</th>
              <th>الفئة</th>
              <th class="num">المستلمين</th>
              <th>تاريخ الإرسال</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  }
}

/* =========================================================================
   TAB 4: N8N INTEGRATION & OPERATOR GUIDE
   ========================================================================= */
async function wbRenderN8nTab(container) {
  container.innerHTML = `
    <div style="text-align:center; padding:30px;" class="muted">جاري تحميل إعدادات الربط...</div>
  `;

  try {
    const cfg = await API.get('/api/bot/config');

    container.innerHTML = `
      <div class="grid-2">
        <div>
          <!-- UltraMsg Connection Card -->
          <div class="card" style="border-color:#25D366; background:linear-gradient(135deg, rgba(37,211,102,0.06), rgba(18,140,126,0.04));">
            <div class="card-title" style="color:#128C7E;">
              <span style="display:flex; align-items:center; gap:8px;">
                🟢 بوابة واتساب المتصلة (UltraMsg)
                <span class="badge badge-green">متصل برقم المحل ✅</span>
              </span>
            </div>
            <p class="small muted mb-10">تم ربط رقم الواتساب الخاص بك بنجاح! البوت يقوم بالمزامنة الحية واستقبال الرسائل من زبائنك والرد عليهم تلقائياً.</p>

            <div style="background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:10px 14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
              <div>
                <div class="small muted">📱 رقم الواتساب المتصل حالياً:</div>
                <div style="font-size:1.15rem; font-weight:800; color:#128C7E; direction:ltr; text-align:right;">
                  +20 105 059 2877 <span class="small font-normal muted">(01050592877)</span>
                </div>
              </div>
              <div style="text-align:left;">
                <div class="small muted">اسم الحساب في واتساب:</div>
                <div style="font-weight:700; color:var(--primary);">abouofali7</div>
              </div>
            </div>

            <div class="grid-2">
              <div class="form-group">
                <label>معرف القناة (Instance ID)</label>
                <input type="text" id="wbUltraInstance" value="${esc(cfg.ultramsg_instance_id || 'instance193963')}" style="font-family:monospace; background:var(--bg);">
              </div>
              <div class="form-group">
                <label>رمز الأمان (Token)</label>
                <input type="password" id="wbUltraToken" value="${esc(cfg.ultramsg_token || '366qvfkvtoodqzpi')}" style="font-family:monospace; background:var(--bg);">
              </div>
            </div>

            <div class="form-group">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="wbUltraToggle" ${cfg.ultramsg_enabled !== false ? 'checked' : ''} style="width:auto;">
                <b>تفعيل الرد التلقائي المباشر على رسائل واتساب (Live Auto-Reply)</b>
              </label>
            </div>

            <!-- Quick WhatsApp Test Message -->
            <div style="background:var(--card); border:1px solid var(--border); border-radius:10px; padding:12px; margin-top:10px;">
              <div class="small font-bold mb-6">📱 تجربة إرسال رسالة واتساب حقيقية لهاتفك:</div>
              <div class="grid-2 mb-6">
                <input type="text" id="wbTestPhone" value="01050592877" placeholder="رقم هاتفك (مثال: 01012345678)" style="font-size:0.85rem;">
                <input type="text" id="wbTestMsg" value="مرحباً بك! هذه رسالة تجريبية لتأكيد ربط البوت برقم الواتساب بنجاح 🚀" style="font-size:0.85rem;">
              </div>
              <button class="btn btn-sm btn-success" onclick="wbSendTestWhatsApp()">
                🚀 إرسال الرسالة إلى هاتفي الآن للتأكد
              </button>
            </div>
          </div>

          <!-- Gemini AI Integration Card -->
          <div class="card" style="border-color:#3b82f6; background:linear-gradient(135deg, rgba(59,130,246,0.06), rgba(147,51,234,0.04));">
            <div class="card-title" style="color:#2563eb;">
              <span style="display:flex; align-items:center; gap:8px;">
                ✨ الذكاء الاصطناعي التوليدي (Google Gemini AI)
                <span class="badge ${cfg.gemini_api_key ? 'badge-blue' : 'badge-gray'}">${cfg.gemini_api_key ? 'مفعل ✨' : 'غير مربوط'}</span>
              </span>
            </div>
            <p class="small muted mb-10">
              يقوم Google Gemini بصياغة الردود بلهجة مصرية بشرية ودودة كبائع شاطر في المحل، مع التزام صارم بأسعار ومخزون المحل الحقيقي ومنع أي تأليف.
            </p>

            <div class="form-group">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="wbGeminiToggle" ${cfg.gemini_enabled !== false ? 'checked' : ''} style="width:auto;">
                <b>تفعيل الرد الذكي البشري عبر Gemini (AI Responses)</b>
              </label>
            </div>

            <div class="form-group">
              <label>مفتاح Google Gemini API Key</label>
              <div style="display:flex; gap:8px;">
                <input type="password" id="wbGeminiApiKey" value="${esc(cfg.gemini_api_key || '')}" placeholder="AIzaSy..." style="font-family:monospace; background:var(--bg);">
                <button class="btn btn-secondary" onclick="wbToggleGeminiKeyVisibility()" title="إظهار / إخفاء">👁️</button>
                <button class="btn btn-primary" onclick="wbTestGeminiApi()">🧪 تجربة المفتاح</button>
              </div>
              <div class="small muted mt-4">احصل على مفتاحك مجاناً وبكل سهولة من <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--primary); text-decoration:underline;">Google AI Studio</a>.</div>
            </div>

            <div class="form-group">
              <label>نموذج الذكاء الاصطناعي (Model)</label>
              <select id="wbGeminiModel">
                <option value="gemini-3.8-flash" ${cfg.gemini_model === 'gemini-3.8-flash' || !cfg.gemini_model ? 'selected' : ''}>⚡ gemini-3.8-flash (فائق السرعة وخبير بالعامية المصرية - موصى به)</option>
                <option value="gemini-2.5-flash" ${cfg.gemini_model === 'gemini-2.5-flash' ? 'selected' : ''}>🚀 gemini-2.5-flash</option>
              </select>
            </div>
          </div>

          <!-- Store Owner Inquiry Card -->
          <div class="card" style="border-color:#f59e0b; background:linear-gradient(135deg, rgba(245,158,11,0.06), rgba(217,119,6,0.03));">
            <div class="card-title" style="color:#d97706;">
              <span style="display:flex; align-items:center; gap:8px;">
                👑 بيانات ومسار صاحب المحل (المعلم)
                <span class="badge badge-orange">مسار مخصص في n8n</span>
              </span>
            </div>
            <p class="small muted mb-10">
              عندما يسأل العميل عن صاحب المحل أو المعلم أو تواجده أو رقمه، يقوم البوت فوراً بالرد بالبيانات المحددة هنا وبأسلوب ودود.
            </p>

            <div class="grid-2">
              <div class="form-group">
                <label>اسم صاحب المحل / المعلم</label>
                <input type="text" id="wbOwnerName" value="${esc(cfg.store_owner_name || 'المعلم علي')}" placeholder="مثال: المعلم علي">
              </div>
              <div class="form-group">
                <label>رقم هاتف المعلم المباشر / واتساب</label>
                <input type="text" id="wbOwnerPhone" value="${esc(cfg.store_owner_phone || '01050592877')}" placeholder="010XXXXXXXX">
              </div>
            </div>

            <div class="form-group">
              <label>مواعيد التواجد والعمل بالمحل</label>
              <input type="text" id="wbOwnerSchedule" value="${esc(cfg.store_owner_schedule || 'متواجد يومياً بالمحل من 5:00 مساءً حتى 11:00 مساءً عدا الجمعة')}" placeholder="مثال: يومياً من 5:00 م حتى 11:00 م عدا الجمعة">
            </div>

            <div class="form-group">
              <label>رسالة التوجيه والملاحظات الإضافية</label>
              <textarea id="wbOwnerCustomReply" rows="2" placeholder="ملاحظة إضافية للعميل في حال عدم تواجد المعلم...">${esc(cfg.store_owner_custom_reply || 'المعلم متواجد في المحل حسب المواعيد الموضحة، ولأي استفسار عاجل يمكنك التواصل معه مباشرة عبر هاتفه الخاص.')}</textarea>
            </div>
          </div>

          <!-- Settings Card -->
          <div class="card">
            <div class="card-title">⚙️ بيانات ومفاتيح الربط البرمجي (API Credentials)</div>
            
            <div class="form-group">
              <label>مفتاح الأمان الخاص بالبوت (X-Bot-Key)</label>
              <div style="display:flex; gap:8px;">
                <input type="text" id="wbApiKeyVal" value="${esc(cfg.bot_api_key)}" readonly style="font-family:monospace; background:var(--bg);">
                <button class="btn btn-secondary" onclick="wbCopyText('${esc(cfg.bot_api_key)}', 'تم نسخ مفتاح API')">📋 نسخ</button>
                <button class="btn btn-ghost" onclick="wbRegenerateBotKey()" title="توليد مفتاح جديد">🔄 تجديد</button>
              </div>
              <div class="small muted mt-4">يُوضع في رأس الطلب (Header): <code>X-Bot-Key: ${esc(cfg.bot_api_key)}</code> داخل n8n لحماية وتأمين النظام.</div>
            </div>

            <div class="form-group">
              <label>رابط استعلام الأسعار والمخزون في البرنامج (Inquiry Endpoint)</label>
              <div style="display:flex; gap:8px;">
                <input type="text" id="wbInquiryEndpoint" value="${esc(cfg.api_inquiry_url)}" readonly style="font-family:monospace; background:var(--bg);">
                <button class="btn btn-secondary" onclick="wbCopyText('${esc(cfg.api_inquiry_url)}', 'تم نسخ الرابط')">📋 نسخ</button>
              </div>
              <div class="small muted mt-4">طريقة الطلب: <code>POST</code> مع إرسال JSON: <code>{"phone": "...", "name": "...", "message": "..."}</code></div>
            </div>

            <div class="form-group">
              <label>رابط Webhook الحملات في n8n (Campaign Webhook URL)</label>
              <input type="text" id="wbN8nWebhookUrl" value="${esc(cfg.n8n_webhook_url)}" placeholder="https://your-n8n.com/webhook/campaign-broadcast">
              <div class="small muted mt-4">عندما تضغط على "إرسال عرض" من صفحة الحملات، سيتم إرسال بيانات العرض والعملاء مباشرة إلى هذا الرابط في n8n لتولي إرسالها على واتساب.</div>
            </div>

            <div class="form-group">
              <label>نص الترحيب التلقائي</label>
              <input type="text" id="wbGreetingMsg" value="${esc(cfg.bot_greeting_msg)}" placeholder="أهلاً بك في متجرنا...">
            </div>

            <div class="form-group">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="wbAutoQuoteToggle" ${cfg.bot_auto_quote_enabled ? 'checked' : ''} style="width:auto;">
                <b>تفعيل توليد عروض الأسعار التلقائية (Auto-Quotation)</b>
              </label>
            </div>

            <div class="modal-foot" style="justify-content:flex-start;">
              <button class="btn" onclick="wbSaveConfig()">💾 حفظ الإعدادات</button>
            </div>
          </div>

          <!-- Download n8n Blueprint Card -->
          <div class="card" style="border-color:var(--accent); background:linear-gradient(135deg, rgba(37,99,235,0.04), rgba(22,163,74,0.04));">
            <div class="card-title" style="color:var(--accent);">
              <span>📦 مخطط n8n الجاهز للاستيراد (Workflow Blueprint)</span>
            </div>
            <p class="small muted mb-10">قمنا بتجهيز مخطط n8n كامل ومُعد مسبقاً بمفتاح API ورابط النظام الخاص بك. يمكنك تنزيله كملف واستيراده مباشرة في n8n بضغطة زر واحدة!</p>
            
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <a href="/api/bot/n8n-workflow?download=1" class="btn btn-primary" download="n8n_whatsapp_workflow.json">
                📥 تحميل ملف المخطط (n8n_whatsapp_workflow.json)
              </a>
              <button class="btn btn-secondary" onclick="wbCopyWorkflowJson()">
                📋 نسخ كود المخطط (JSON)
              </button>
              <button class="btn btn-warning" onclick="wbSendTestToN8n()">
                ⚡ تجربة إرسال حدث مباشر إلى n8n
              </button>
            </div>
          </div>
        </div>

        <div>
          <!-- Operator Guide Card -->
          <div class="card">
            <div class="card-title">🧭 دليل تشغيل وقيادة منظومة n8n وواتساب</div>
            
            <div style="display:flex; flex-direction:column; gap:16px;">
              
              <div style="background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:14px;">
                <h4 style="margin:0 0 6px 0; color:var(--primary); font-size:0.95rem;">
                  1️⃣ الخطوة الأولى: استيراد المخطط في n8n
                </h4>
                <div class="small" style="line-height:1.6;">
                  - افتح منصة <b>n8n</b> (سواء كانت سحابية أو على نفس الجهاز عبر <code>http://localhost:5678</code>).<br>
                  - اضغط على زر <b>Add Workflow</b> ثم من القائمة اختر <b>Import from File</b> واختر الملف الذي قمت بتحميله أعلاه، أو اضغط <b>Import from URL / Clipboard</b> والصق كود الـ JSON.<br>
                  - ستجد المخطط بالكامل قد ظهر أمامك بكافة العقد وتوصيلاتها تلقائياً!
                </div>
              </div>

              <div style="background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:14px;">
                <h4 style="margin:0 0 6px 0; color:var(--accent); font-size:0.95rem;">
                  2️⃣ الخطوة الثانية: ربط رقم واتساب
                </h4>
                <div class="small" style="line-height:1.6;">
                  لديك خياران للربط حسب تفضيلك:<br>
                  • <b>الخيار المجاني الأسهل (Evolution API أو Baileys):</b> ربط أي رقم واتساب عادي عبر مسح رمز الاستجابة السريعة (QR Code).<br>
                  • <b>الخيار الرسمي (WhatsApp Cloud API):</b> من بوابة المطورين لدى Meta، يدعم أول 1000 محادثة شهرياً مجاناً.<br>
                  - انسخ رابط عقدة الـ <b>Webhook</b> في n8n وضعه كـ Webhook URL في إعدادات بوابة واتساب المختارة.
                </div>
              </div>

              <div style="background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:14px;">
                <h4 style="margin:0 0 6px 0; color:var(--warning); font-size:0.95rem;">
                  3️⃣ الخطوة الثالثة: تفعيل سير العمل (Activate)
                </h4>
                <div class="small" style="line-height:1.6;">
                  - في أعلى شاشة n8n، قم بتبديل المفتاح من <b>Inactive</b> إلى <b>Active</b>.<br>
                  - الآن بمجرد أن يرسل أي عميل رسالة على واتساب (مثلاً: <i>"بكام ايفون 13"</i> أو <i>"عندكم شاحن انكر؟"</i>):<br>
                  1. تستلم n8n الرسالة وتمررها لنظام الكاشير والمخزون.<br>
                  2. يفحص البرنامج المخزون الحي ويسجل اهتمام العميل تلقائياً في قاعدة البيانات.<br>
                  3. يرسل البوت الرد المنسق بالأسعار وحالة التوفر للعميل في ثوانٍ معدودة!
                </div>
              </div>

              <div style="background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:14px;">
                <h4 style="margin:0 0 6px 0; color:#8b5cf6; font-size:0.95rem;">
                  4️⃣ الخطوة الرابعة: ربط n8n السحابي مع الكاشير المحلي (في حال استخدام Cloud)
                </h4>
                <div class="small" style="line-height:1.6;">
                  - إذا كان حساب n8n سحابياً (على الإنترنت) وبرنامج الكاشير يعمل على جهازك في المحل:<br>
                  يمكنك استخدام أداة نفق مجانية وآمنة مثل <b>Cloudflare Tunnels</b> أو <b>Ngrok</b> لتوفير رابط خارجي للبرنامج، ثم وضعه في عقدة HTTP Request داخل n8n.
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  }
}

function wbToggleGeminiKeyVisibility() {
  const inp = document.getElementById('wbGeminiApiKey');
  if (inp) {
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }
}

async function wbTestGeminiApi() {
  const apiKey = document.getElementById('wbGeminiApiKey')?.value;
  const model = document.getElementById('wbGeminiModel')?.value || 'gemini-1.5-flash';

  if (!apiKey || !apiKey.trim()) {
    return toast('يرجى لصق مفتاح Google Gemini API أولاً للاختبار', 'error');
  }

  showAlert('جاري الاتصال بـ Google Gemini وتوليد رسالة ترحيبية بالذكاء الاصطناعي...', 'info');
  try {
    const res = await API.post('/api/bot/test-gemini', { apiKey: apiKey.trim(), model });
    if (res.ok) {
      showAlert(`✨ ${res.message}\n\n🤖 رد الذكاء الاصطناعي التجريبي:\n"${res.reply}"`, 'success');
    } else {
      showAlert(res.error || 'تعذر الاتصال بـ Gemini', 'error');
    }
  } catch (err) {
    showAlert('خطأ أثناء اختبار Gemini: ' + err.message, 'error');
  }
}

async function wbSaveConfig() {
  const n8n_webhook_url = document.getElementById('wbN8nWebhookUrl')?.value;
  const bot_greeting_msg = document.getElementById('wbGreetingMsg')?.value;
  const bot_auto_quote_enabled = document.getElementById('wbAutoQuoteToggle')?.checked;
  const ultramsg_instance_id = document.getElementById('wbUltraInstance')?.value;
  const ultramsg_token = document.getElementById('wbUltraToken')?.value;
  const ultramsg_enabled = document.getElementById('wbUltraToggle')?.checked;
  const gemini_api_key = document.getElementById('wbGeminiApiKey')?.value;
  const gemini_enabled = document.getElementById('wbGeminiToggle')?.checked;
  const gemini_model = document.getElementById('wbGeminiModel')?.value;
  const store_owner_name = document.getElementById('wbOwnerName')?.value;
  const store_owner_phone = document.getElementById('wbOwnerPhone')?.value;
  const store_owner_schedule = document.getElementById('wbOwnerSchedule')?.value;
  const store_owner_custom_reply = document.getElementById('wbOwnerCustomReply')?.value;

  try {
    await API.put('/api/bot/config', {
      n8n_webhook_url,
      bot_greeting_msg,
      bot_auto_quote_enabled,
      ultramsg_instance_id,
      ultramsg_token,
      ultramsg_enabled,
      gemini_api_key,
      gemini_enabled,
      gemini_model,
      store_owner_name,
      store_owner_phone,
      store_owner_schedule,
      store_owner_custom_reply
    });
    toast('تم حفظ كافة إعدادات البوت والذكاء الاصطناعي بنجاح');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function wbSendTestWhatsApp() {
  const phone = document.getElementById('wbTestPhone')?.value;
  const message = document.getElementById('wbTestMsg')?.value;

  if (!phone || !phone.trim()) return toast('يرجى إدخال رقم هاتفك للتجربة', 'error');
  if (!message || !message.trim()) return toast('يرجى كتابة نص الرسالة', 'error');

  try {
    toast('جاري إرسال الرسالة إلى هاتفك على واتساب...');
    const res = await API.post('/api/bot/test-send', { phone: phone.trim(), message: message.trim() });
    toast(res.message || 'تم إرسال الرسالة بنجاح! تفقد هاتفك الآن 📱', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function wbRegenerateBotKey() {
  if (!confirm('هل أنت متأكد من تجديد مفتاح API؟ ستحتاج لتحديثه في عقدة n8n بعد التجديد.')) return;
  try {
    const res = await API.post('/api/bot/config/regenerate-key');
    toast(res.message || 'تم تجديد المفتاح');
    wbSwitchTab('n8n');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function wbCopyWorkflowJson() {
  try {
    const data = await API.get('/api/bot/n8n-workflow');
    wbCopyText(JSON.stringify(data, null, 2), 'تم نسخ مخطط n8n بالكامل إلى الحافظة!');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function wbSendTestToN8n() {
  try {
    showAlert('جاري إرسال حدث تجريبي إلى n8n...', 'info');
    const res = await API.post('/api/bot/test-n8n', {
      phone: '01070329441',
      name: 'علي (عميل تجريبي)',
      message: 'عندكم شاحن انكر وبكام؟'
    });
    if (res.ok) {
      showAlert('تم وصول الحدث إلى n8n بنجاح! 🚀✅', 'success');
    } else {
      showAlert(res.message || 'تأكد من فتح المخطط في n8n وتفعيله (Active)', 'warning');
    }
  } catch (err) {
    showAlert('خطأ: ' + err.message, 'error');
  }
}

function wbCopyText(text, successMsg) {
  if (!navigator.clipboard) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast(successMsg || 'تم النسخ');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    toast(successMsg || 'تم النسخ بنجاح');
  }).catch(() => {
    toast('تعذر النسخ إلى الحافظة', 'error');
  });
}

/* =========================================================================
   TAB 5: LIVE SANDBOX & SIMULATOR
   ========================================================================= */
function wbRenderSandboxTab(container) {
  container.innerHTML = `
    <div class="grid-2">
      <div>
        <div class="card">
          <div class="card-title">🧪 محاكي ومختبر البوت المباشر</div>
          <p class="small muted mb-10">يمكنك هنا كتابة رسالة تجريبية كما يكتبها العميل في واتساب، واختبار كيف سيحللها البوت ويبحث في المخزون ويرد بالأسعار ويسجل اهتمامات العميل:</p>
          
          <div class="form-group">
            <label>رقم هاتف تجريبي للعميل</label>
            <input type="text" id="wbSimPhone" value="01012345678" placeholder="010XXXXXXXX">
          </div>

          <div class="form-group">
            <label>اسم العميل (اختياري)</label>
            <input type="text" id="wbSimName" value="أحمد محمد" placeholder="اسم العميل...">
          </div>

          <div class="form-group">
            <label>رسالة العميل المستفسر</label>
            <textarea id="wbSimMessage" rows="3" placeholder="مثال: لو سمحت عندكم شاحن انكر وبكام؟ أو: سعر ايفون 13 كام عندك">لو سمحت عندكم شاحن انكر وبكام؟</textarea>
          </div>

          <div class="small muted mb-10">
            أمثلة سريعة للتجربة: 
            <span class="badge badge-orange" style="cursor:pointer;" onclick="wbFillSim('هو صاحب المحل موجود دلوقتي؟')">👑 صاحب المحل موجود؟</span>
            <span class="badge badge-orange" style="cursor:pointer;" onclick="wbFillSim('عاوز رقم المعلم لو سمحت')">📱 رقم المعلم</span>
            <span class="badge badge-gray" style="cursor:pointer;" onclick="wbFillSim('بكام شاحن انكر؟')">شاحن انكر</span>
            <span class="badge badge-gray" style="cursor:pointer;" onclick="wbFillSim('عندكم رامات 16 جيجا؟')">رامات 16</span>
            <span class="badge badge-gray" style="cursor:pointer;" onclick="wbFillSim('اسعار الشاشات ايه؟')">شاشات</span>
          </div>

          <button class="btn btn-success btn-block" id="wbSimBtn" onclick="wbSimulateInquiry()">
            ⚡ إرسال المحاكاة وفحص المخزون
          </button>
        </div>
      </div>

      <div>
        <div class="card" style="min-height:420px; display:flex; flex-direction:column;">
          <div class="card-title">
            <span>📱 شاشة المحاكاة (معاينة رد واتساب المباشر)</span>
            <span class="badge badge-green" id="wbSimStatus">جاهز للاختبار</span>
          </div>
          
          <div id="wbSimChatArea" style="flex:1; background:#0b141a; border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:12px; overflow-y:auto; min-height:280px; background-image:radial-gradient(rgba(255,255,255,0.03) 1px, transparent 0); background-size:16px 16px;">
            <div style="align-self:center; background:#182229; color:#8696a0; font-size:0.75rem; padding:4px 10px; border-radius:6px;">
              هذه المحاكاة تطابق رد البوت الحقيقي للعميل في واتساب
            </div>
          </div>

          <div id="wbSimAnalysis" style="margin-top:14px; display:none; border-top:1px solid var(--border); padding-top:12px;">
            <div class="small font-bold mb-4">🔍 تحليل النظام والبيانات المسجلة:</div>
            <div id="wbSimAnalysisDetails" class="small muted"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function wbFillSim(text) {
  const inp = document.getElementById('wbSimMessage');
  if (inp) inp.value = text;
}

async function wbSimulateInquiry() {
  const phone = document.getElementById('wbSimPhone')?.value || '01012345678';
  const name = document.getElementById('wbSimName')?.value || 'عميل تجريبي';
  const message = document.getElementById('wbSimMessage')?.value || '';

  if (!message.trim()) return toast('اكتب رسالة للاختبار', 'error');

  const chat = document.getElementById('wbSimChatArea');
  const statusBadge = document.getElementById('wbSimStatus');
  const analysisBox = document.getElementById('wbSimAnalysis');
  const analysisDetails = document.getElementById('wbSimAnalysisDetails');
  const btn = document.getElementById('wbSimBtn');

  if (btn) btn.disabled = true;
  if (statusBadge) { statusBadge.textContent = 'جاري المعالجة...'; statusBadge.className = 'badge badge-orange'; }

  // 1. Show user message in chat
  chat.innerHTML = `
    <div style="align-self:flex-start; max-width:80%; background:#202c33; color:#e9edef; padding:10px 14px; border-radius:8px 8px 8px 0; font-size:0.9rem; line-height:1.4; box-shadow:0 1px 2px rgba(0,0,0,0.3);">
      <div style="font-size:0.72rem; color:#00a884; font-weight:700; margin-bottom:2px;">${esc(name)} (${esc(phone)})</div>
      <div>${esc(message)}</div>
      <div style="font-size:0.68rem; color:#8696a0; text-align:left; margin-top:4px;">الآن ✓✓</div>
    </div>
    <div id="wbSimTyping" style="align-self:flex-end; background:#005c4b; color:#e9edef; padding:8px 14px; border-radius:8px 8px 0 8px; font-size:0.8rem;">
      ✍️ جاري فحص المخزون وتوليد عرض السعر...
    </div>
  `;

  try {
    const res = await API.post('/api/bot/inquiry', { phone, name, message });
    
    // Remove typing indicator
    const typing = document.getElementById('wbSimTyping');
    if (typing) typing.remove();

    // 2. Add bot reply
    const replyFormatted = esc(res.reply || 'تم استلام الاستفسار')
      .replace(/\*(.*?)\*/g, '<b>$1</b>')
      .replace(/_(.*?)_/g, '<i>$1</i>')
      .replace(/\n/g, '<br>');

    const aiTag = res.is_ai 
      ? '<span class="badge badge-green" style="font-size:0.68rem; margin-right:4px;">✨ صياغة ذكية (Gemini AI)</span>' 
      : '<span class="badge badge-gray" style="font-size:0.68rem; margin-right:4px;">⚡ صياغة القالب المحلي</span>';
    const intentTag = res.intent === 'owner_inquiry'
      ? '<span class="badge badge-orange" style="font-size:0.68rem;">👑 استفسار عن صاحب المحل</span>'
      : '<span class="badge badge-blue" style="font-size:0.68rem;">📦 فحص المخزون والأسعار</span>';

    chat.innerHTML += `
      <div style="align-self:flex-end; max-width:85%; background:#005c4b; color:#e9edef; padding:12px 14px; border-radius:8px 8px 0 8px; font-size:0.9rem; line-height:1.5; box-shadow:0 1px 2px rgba(0,0,0,0.3);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:4px;">
          <span style="font-size:0.75rem; color:#53bdeb; font-weight:700;">🤖 بوت المتجر الذكي</span>
          <div>${intentTag} ${aiTag}</div>
        </div>
        <div>${replyFormatted}</div>
        <div style="font-size:0.68rem; color:#8696a0; text-align:left; margin-top:6px;">الآن ✓✓</div>
      </div>
    `;

    // 3. Display analysis
    if (analysisBox && analysisDetails) {
      analysisBox.style.display = 'block';
      analysisDetails.innerHTML = `
        <div>• <b>نوع المسار المستهدف (Intent):</b> ${res.intent === 'owner_inquiry' ? '👑 استفسار عن صاحب المحل (مسار المعلم)' : '📦 استفسار عن منتج ومخزون'}</div>
        <div>• <b>طريقة التوليد والصياغة:</b> ${res.is_ai ? '✨ Google Gemini AI (رد بشري طبيعي grounded)' : '⚡ القالب المحلي الاحتياطي'}</div>
        <div>• <b>عدد المنتجات المطابقة في المخزون:</b> ${res.matched_count || 0} منتج</div>
        <div>• <b>الاهتمامات المسجلة في سجل العميل (CRM):</b> <span class="badge badge-blue">${esc(res.interests || '-')}</span></div>
        <div>• <b>معرف العميل (ID):</b> ${res.customer_id || 'تم تحديثه'}</div>
      `;
    }

    if (statusBadge) { statusBadge.textContent = 'تم الرد بنجاح ✓'; statusBadge.className = 'badge badge-green'; }
  } catch (err) {
    const typing = document.getElementById('wbSimTyping');
    if (typing) typing.remove();
    chat.innerHTML += `<div class="alert error">خطأ أثناء المعالجة: ${esc(err.message)}</div>`;
    if (statusBadge) { statusBadge.textContent = 'خطأ'; statusBadge.className = 'badge badge-red'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}
