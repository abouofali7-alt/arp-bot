async function renderSettings() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="grid-2">
      <div>
        <div class="card">
          <div class="card-title">⚙️ إعدادات النظام</div>
          <div class="form-group"><label>اسم المتجر</label><input id="setStoreName" value="${esc(SETTINGS.store_name || '')}"></div>
          <div class="form-group"><label>سطر نهاية الفاتورة (ترحيب / شكر)</label><input id="setFooter" value="${esc(SETTINGS.invoice_footer || '')}"></div>
          <div class="form-group"><label>العملة</label><input id="setCurrency" value="${esc(SETTINGS.currency || 'ج')}"></div>
          <div class="card-title" style="margin-top:20px">🎁 إعدادات كوبون الولاء</div>
          <div class="grid-3">
            <div class="form-group"><label>عدد الفواتير للحصول على الكوبون</label><input type="number" id="setLoyThreshold" min="1" value="${esc(SETTINGS.loyalty_threshold || '5')}"></div>
            <div class="form-group"><label>نسبة الخصم %</label><input type="number" id="setLoyPercent" min="1" max="100" value="${esc(SETTINGS.loyalty_percent || '10')}"></div>
            <div class="form-group"><label>أيام الصلاحية بدون شراء</label><input type="number" id="setLoyDays" min="1" value="${esc(SETTINGS.loyalty_days || '2')}"></div>
          </div>
          <p class="small muted">بعد الوصول لعدد الفواتير يطبع باركود كوبون خصم للعميل باسمه — ويتجدد مع كل فاتورة جديدة، ويتلغي إذا مرّت المدة المحددة دون شراء.</p>
          <div class="modal-foot"><button class="btn" onclick="settingsSave()">حفظ الإعدادات</button></div>
        </div>
        <div class="card">
          <div class="card-title">🔤 الخط وألوان الكتابة</div>
          <p class="small muted mb-10">اختار خط التطبيق ولون الكتابة لكل وضع (فاتح / داكن) — الإعداد يُطبق على كل الشاشات ويُحفظ للجميع.</p>
          <div class="form-group"><label>خط التطبيق</label>
            <input id="setFontFamily" list="fontList" placeholder="اكتب أو اختر خطًا (اتركه فارغًا للافتراضي)" value="${esc(SETTINGS.font_family || '')}" oninput="typographyPreview()">
            <datalist id="fontList">
              ${['Segoe UI','Tahoma','Arial','Verdana','Trebuchet MS','Times New Roman','Georgia','Courier New','Calibri','Cambria','Consolas','Traditional Arabic','Simplified Arabic','Arabic Typesetting','Sakkal Majalla','Andalus','Aldhabi','Urdu Typesetting'].map(f => `<option value="${f}">${f}</option>`).join('')}
            </datalist>
          </div>
          <div class="grid-2">
            <div class="form-group"><label>لون الكتابة — الوضع الفاتح ☀️</label>
              <input type="color" id="setTextLight" value="${esc(SETTINGS.text_color_light || '#0f172a')}" oninput="typographyPreview()"></div>
            <div class="form-group"><label>لون الكتابة — الوضع الداكن 🌙</label>
              <input type="color" id="setTextDark" value="${esc(SETTINGS.text_color_dark || '#f1f5f9')}" oninput="typographyPreview()"></div>
          </div>
          <label class="small muted">معاينة مباشرة:</label>
          <div class="grid-2">
            <div id="typoPrevLight" style="background:#f1f5f9;border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:12px;margin-top:4px"></div>
            <div id="typoPrevDark" style="background:#0f172a;border-radius:10px;padding:12px;margin-top:4px"></div>
          </div>
          <div class="modal-foot">
            <button class="btn" onclick="typographySave()">💾 حفظ الخط والألوان</button>
            <button class="btn btn-secondary" onclick="typographyReset()">↩️ استعادة الافتراضي</button>
          </div>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title">💾 النسخ الاحتياطي للبيانات</div>
          <p class="small muted mb-10">يتم عمل نسخة احتياطية تلقائياً كل يوم عند تشغيل البرنامج. الملفات في مجلد <code>data/backups</code></p>
          <div class="flex mb-10">
            <button class="btn" onclick="backupCreate()">➕ عمل نسخة الآن</button>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>الملف</th><th class="num">الحجم</th><th>التاريخ</th><th></th></tr></thead>
            <tbody id="backupTable"></tbody>
          </table></div>
        </div>
        <div class="card" style="border-color:#dc2626">
          <div class="card-title" style="color:#dc2626">⚠️ منطقة الخطر — إعادة ضبط المصنع</div>
          <p class="small muted mb-10">بتمسح كل بيانات البرنامج نهائيًا (فواتير، منتجات، عملاء، موظفين، مصروفات...) وترجع النسخة الفارغة الثابتة بحساب المدير الافتراضي <b>admin / admin123</b>. قبل المسح بيتم عمل <b>نسخة أمان</b> من كل بياناتك الحالية تلقائيًا وتظهر في قائمة النسخ الاحتياطية فوق.</p>
          <button class="btn btn-danger" onclick="factoryReset()">🔄 إعادة ضبط البرنامج بالكامل</button>
        </div>
        <div class="card">
          <div class="card-title">🕑 سجل الورديات (الكاشيرات)</div>
          <div class="table-wrap"><table>
            <thead><tr><th>الكاشير</th><th>الفرع</th><th>الفتح</th><th>الغلق</th><th class="num">رصيد البداية</th><th class="num">رصيد النهاية</th><th>الحالة</th></tr></thead>
            <tbody id="shiftsTable"></tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-title">🖨️ الطابعات المتصلة بالجهاز ونمط الطباعة</div>
          <div class="form-group"><label>⚡ نمط ونوع الطباعة الافتراضي في البرنامج</label>
            <select id="printerProfilePick" onchange="printerProfilePickSave()">
              <option value="auto">كشف تلقائي (حسب اسم الطابعة المتصلة)</option>
              <option value="thermal">⚡ طابعة حرارية (Thermal Receipt 58mm / 80mm) [مقاس مدمج ومثالي لإيصالات الكاشير]</option>
              <option value="a4">📄 طابعة مستندات ورقية (Full A4 Page)</option>
            </select>
            <p class="small muted" style="margin-top:4px;margin-bottom:12px">اختر "طابعة حرارية" لإجبار البرنامج على طباعة كافة الفواتير والإيصالات بمقاس مدمج ومناسب لطابعات الكاشير بدون أي هوامش فارغة.</p>
          </div>
          <div class="form-group"><label>📏 مقاس وحجم خط الطباعة</label>
            <select id="printerFontSizePick" onchange="printerFontSizePickSave()">
              <option value="compact">مدمج وقياسي (افتراضي — مقاس صغير ومثالي للفواتير والتوفير في الورق)</option>
              <option value="normal">متوسط (+15% حجم أكبر)</option>
              <option value="large">كبير (+30% حجم أكبر)</option>
            </select>
            <p class="small muted" style="margin-top:4px;margin-bottom:12px">يمكنك اختيار مقاس النصوص في جميع المطبوعات حسب نوع وحجم الطابعة المستخدمة.</p>
          </div>
          <div class="flex mb-10">
            <button class="btn" onclick="printersLoad()">🔍 كشف الطابعات</button>
            <span class="small muted" id="printersInfo" style="align-self:center">اضغط زر الكشف لعرض الطابعات المتصلة</span>
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label>🧾 طابعة الفواتير والإيصالات (الكاشير)</label>
              <select id="printerPick" onchange="printerPickSave()"></select>
              <p class="small muted" style="margin-top:2px">الطابعة المستخدمة لطباعة إيصالات المبيعات وفواتير A4 وعقود الأجهزة</p>
            </div>
            <div class="form-group">
              <label>🏷️ طابعة الباركود والملصقات (منفصلة)</label>
              <select id="barcodePrinterPick" onchange="barcodePrinterPickSave()"></select>
              <p class="small muted" style="margin-top:2px">طابعة مخصصة لطباعة استيكرات وملصقات الباركود فقط</p>
            </div>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>اسم الطابعة</th><th>الحالة</th><th>الافتراضية</th><th>الوصف</th><th>النوع</th></tr></thead>
            <tbody id="printersTable"></tbody>
          </table></div>
          <div class="card-title" style="margin-top:18px">🔌 الطابعات عبر USB/Serial (مثل GP-58)</div>
          <p class="small muted mb-10">طابعات GP-58 غالباً بتتصل كمنفذ (مثل COM3) مش كطابعة ويندوز — كشف المنافذ هيحددها، واختارها للطباعة المباشرة بالباركود.</p>
          <div class="flex mb-10">
            <button class="btn btn-secondary" onclick="portsLoad()">🔍 كشف المنافذ</button>
            <span class="small muted" id="portsInfo" style="align-self:center">لم يتم الكشف بعد</span>
          </div>
          <div class="form-group"><label>منفذ الطباعة المباشر (ESC/POS) لطباعة الباركود</label>
            <select id="portPick" onchange="portPickSave()"></select>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>المنفذ</th><th>الجهاز</th><th>النوع</th></tr></thead>
            <tbody id="portsTable"></tbody>
          </table></div>
        </div>
      </div>
    </div>`;
  backupLoad();
  shiftsLoad();
  printersLoad();
  portsLoad();
  typographyPreview();
  if (document.getElementById('printerProfilePick')) {
    document.getElementById('printerProfilePick').value = localStorage.getItem('printerProfilePref') || 'auto';
  }
  if (document.getElementById('printerFontSizePick')) {
    document.getElementById('printerFontSizePick').value = localStorage.getItem('printerFontSizePref') || 'compact';
  }
  if (document.getElementById('barcodePrinterPick')) {
    document.getElementById('barcodePrinterPick').value = localStorage.getItem('barcodePrinterPref') || '';
  }
}

function printerProfilePickSave() {
  const v = document.getElementById('printerProfilePick').value;
  localStorage.setItem('printerProfilePref', v);
  showAlert('تم حفظ نمط الطباعة الافتراضي بنجاح');
}

function printerFontSizePickSave() {
  const v = document.getElementById('printerFontSizePick').value;
  localStorage.setItem('printerFontSizePref', v);
  showAlert('تم حفظ مقاس خط الطباعة بنجاح');
}

function portPickSave() {
  const port = document.getElementById('portPick').value;
  localStorage.setItem('portPref', port);
  const found = (window.__PORTS__ || []).find(p => p.port === port);
  localStorage.setItem('portPrefDesc', (found && found.desc) || '');
  const isPrinter = /GP[-_ ]?58|58 ?MM|58mm|CH340|CH341|PRINTER|SERIAL/i.test((found && found.desc) || '');
  if (port && !isPrinter) {
    showAlert('تحذير: هذا المنفذ لا يبدو طابعة حرارية — سيتم استخدام الطباعة العادية', 'error');
  } else {
    showAlert(port ? 'سيتم استخدام المنفذ لطباعة الباركود مباشرة' : 'تم العودة للطباعة العادية');
  }
}

async function portsLoad() {
  const info = document.getElementById('portsInfo');
  const tbody = document.getElementById('portsTable');
  const pick = document.getElementById('portPick');
  if (!window.printerAPI) {
    info.textContent = 'كشف المنافذ متاح في نسخة سطح المكتب فقط.';
    tbody.innerHTML = '';
    pick.innerHTML = '<option value="">غير متاح</option>';
    return;
  }
  info.textContent = '...جاري الكشف عن المنافذ';
  tbody.innerHTML = '<tr><td colspan="3"><div class="empty">...جارٍ الكشف</div></td></tr>';
  try {
    const list = await window.printerAPI.listPorts();
    window.__PORTS__ = list;
    const pref = localStorage.getItem('portPref') || '';
    pick.innerHTML = '<option value="">غير محدد — طباعة عادية</option>' +
      list.map(p => `<option value="${esc(p.port)}" ${p.port === pref ? 'selected' : ''}>${esc(p.port)} — ${esc(p.desc)}</option>`).join('');
    const isGP = (d) => /GP[-_ ]?58|58 ?MM|58mm|CH340|CH341|SERIAL/i.test(d || '');
    const rows = list.map(p => {
      const gp = isGP(p.desc);
      return `
      <tr${gp ? ' style="background:var(--accent-bg, rgba(0,150,90,.12))"' : ''}>
        <td><b>${esc(p.port)}</b>${gp ? ' <span class="badge badge-green">GP-58</span>' : ''}</td>
        <td class="small">${esc(p.desc)}</td>
        <td class="small">${gp ? '<span class="badge badge-green">طابعة حرارية</span>' : '<span class="badge badge-gray">منفذ</span>'}</td>
      </tr>`;
    }).join('');
    tbody.innerHTML = rows || '<tr><td colspan="3"><div class="empty">لم يتم العثور على منافذ — تأكد من توصيل الطابعة USB</div></td></tr>';
    const gpFound = list.filter(p => isGP(p.desc)).length;
    const winThermal = localStorage.getItem('printerPref') ? ' يوجد طابعة حرارية مختارة في قائمة الطابعات أعلاه — الطباعة ستعمل بها مباشرة.' : '';
    info.textContent = list.length
      ? (gpFound ? `تم التعرف على GP-58 على ${list.filter(p => isGP(p.desc)).map(p => p.port).join('، ')} ✅ — اختارها من القائمة للطباعة المباشرة` : `لا يوجد منفذ COM للطابعة الحرارية — طابعتك متصلة عبر USB كطابعة ويندوز وليست بحاجة لمنفذ.${winThermal}`)
      : 'لا توجد منافذ — تأكد من توصيل الطابعة بكابل USB';
    if (!list.some(p => p.port === pref)) pick.value = '';
  } catch (e) {
    info.textContent = 'تعذر الكشف: ' + e.message;
    tbody.innerHTML = '';
  }
}

function printerPickSave() {
  const v = document.getElementById('printerPick').value;
  localStorage.setItem('invoicePrinterPref', v);
  localStorage.setItem('printerPref', v);
  showAlert(v ? `تم تحديد طابعة الفواتير والإيصالات: ${v}` : 'تم ضبط طابعة الفواتير على الافتراضية');
  printersLoad();
}

function barcodePrinterPickSave() {
  const v = document.getElementById('barcodePrinterPick').value;
  localStorage.setItem('barcodePrinterPref', v);
  showAlert(v ? `تم تحديد طابعة الباركود: ${v}` : 'تم ضبط طابعة الباركود على الافتراضية');
  printersLoad();
}

function typographyPreview() {
  const font = (document.getElementById('setFontFamily').value || '').trim().replace(/[^A-Za-z0-9 \u0600-\u06FF-]/g, '');
  const cl = document.getElementById('setTextLight')?.value || '#0f172a';
  const cd = document.getElementById('setTextDark')?.value || '#f1f5f9';
  const ff = font ? `'${font}', Tahoma, Arial, sans-serif` : '';
  const pl = document.getElementById('typoPrevLight');
  const pd = document.getElementById('typoPrevDark');
  if (pl) { pl.style.fontFamily = ff; pl.style.color = cl; pl.innerHTML = '<b>مثال: إجمالي الفاتورة 250 ج</b><br><span style="font-size:.85rem">منتجات ومخزون وفواتير — ABC abc 123</span>'; }
  if (pd) { pd.style.fontFamily = ff; pd.style.color = cd; pd.innerHTML = '<b>مثال: إجمالي الفاتورة 250 ج</b><br><span style="font-size:.85rem">منتجات ومخزون وفواتير — ABC abc 123</span>'; }
}

async function typographySave() {
  const font = document.getElementById('setFontFamily').value.trim();
  const cl = document.getElementById('setTextLight').value;
  const cd = document.getElementById('setTextDark').value;
  const hex = v => /^#[0-9a-fA-F]{6}$/.test(v);
  if (!hex(cl) || !hex(cd)) { showAlert('لون غير صالح', 'error'); return; }
  const body = { font_family: font, text_color_light: cl, text_color_dark: cd };
  try {
    await API.put('/api/settings', body);
    SETTINGS = Object.assign(SETTINGS, body);
    applyTypography();
    showAlert('تم حفظ الخط والألوان وستظهر لكل المستخدمين');
  } catch (e) { showAlert(e.message, 'error'); }
}

function typographyReset() {
  document.getElementById('setFontFamily').value = '';
  document.getElementById('setTextLight').value = '#0f172a';
  document.getElementById('setTextDark').value = '#f1f5f9';
  typographyPreview();
}

async function settingsSave() {  const body = {
    store_name: document.getElementById('setStoreName').value.trim(),
    invoice_footer: document.getElementById('setFooter').value.trim(),
    currency: document.getElementById('setCurrency').value.trim() || 'ج',
    loyalty_threshold: Number(document.getElementById('setLoyThreshold').value) || 5,
    loyalty_percent: Number(document.getElementById('setLoyPercent').value) || 10,
    loyalty_days: Number(document.getElementById('setLoyDays').value) || 2,
  };
  try {
    await API.put('/api/settings', body);
    SETTINGS = await API.get('/api/settings');
    if (SETTINGS.store_name) document.getElementById('storeName').textContent = SETTINGS.store_name;
    showAlert('تم حفظ الإعدادات');
  } catch (e) { showAlert(e.message, 'error'); }
}

async function backupLoad() {
  const list = await API.get('/api/backup/list');
  document.getElementById('backupTable').innerHTML = list.map(b => `
    <tr>
      <td class="small">${esc(b.name)}</td>
      <td class="num small">${(b.size / 1024).toFixed(1)} KB</td>
      <td class="small">${fmtDate(b.mtime)}</td>
      <td><div class="flex" style="gap:4px">
        <button class="btn btn-secondary btn-sm" onclick="backupDownload('${esc(b.name)}')">تنزيل</button>
        <button class="btn btn-danger btn-sm" onclick="backupRestore('${esc(b.name)}')">استعادة</button>
      </div></td>
    </tr>`).join('') || '<tr><td colspan="4"><div class="empty">لا توجد نسخ احتياطية بعد</div></td></tr>';
}

async function backupCreate() {
  const r = await API.post('/api/backup/create', {});
  showAlert('تم عمل نسخة احتياطية: ' + r.file);
  backupLoad();
}

function backupDownload(name) {
  const token = localStorage.getItem('token');
  const url = '/api/backup/download/' + encodeURIComponent(name);
  fetch(url, { headers: { Authorization: 'Bearer ' + token } })
    .then(res => res.blob())
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
    });
}

function backupRestore(name) {
  if (!confirm('تحذير: استعادة هذا الملف ستحل محل جميع البيانات الحالية بالكامل. هل أنت متأكد؟')) return;
  API.post('/api/backup/restore', { name })
    .then(() => { showAlert('تمت الاستعادة بنجاح'); setTimeout(() => location.reload(), 800); })
    .catch(e => showAlert(e.message, 'error'));
}

async function factoryReset() {
  if (!confirm('تحذير نهائي!\nسيتم مسح كل بيانات البرنامج نهائيًا والعودة للنسخة الفارغة.\nسيتم حفظ نسخة أمان من بياناتك الحالية أولًا.\n\nهل تريد المتابعة؟')) return;
  openModal(`
    <div class="modal-head"><h3 style="color:#dc2626">⚠️ تأكيد إعادة الضبط النهائية</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <p class="small muted mb-10">هيتم مسح كل البيانات نهائيًا وعمل نسخة أمان تلقائيًا. اكتب كلمة <b>RESET</b> بحروف كبيرة في الخانة تحت للتأكيد:</p>
    <div class="form-group"><input id="frConfirm" placeholder="اكتب RESET هنا" autocomplete="off"></div>
    <div class="modal-foot">
      <button class="btn btn-danger" onclick="factoryResetGo()">تنفيذ إعادة الضبط</button>
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
}

function factoryResetGo() {
  const v = (document.getElementById('frConfirm')?.value || '').trim();
  if (v !== 'RESET') { showAlert('اكتب كلمة RESET بحروف كبيرة للتأكيد', 'error'); return; }
  closeModal();
  API.post('/api/backup/factory-reset', {})
    .then((r) => {
      alert('تمت إعادة الضبط بنجاح!\nنسخة الأمان: ' + r.safety + '\n\nهيتم تسجيل الخروج الآن — سجل دخول بحساب admin / admin123');
      logout();
    })
    .catch(e => showAlert(e.message, 'error'));
}

async function shiftsLoad() {
  const list = await API.get('/api/shifts/history');
  document.getElementById('shiftsTable').innerHTML = list.map(s => `
    <tr>
      <td>${esc(s.cashier)}</td>
      <td class="small">${esc(s.branch_name || '—')}</td>
      <td class="small">${fmtDate(s.opened_at)}</td>
      <td class="small">${s.closed_at ? fmtDate(s.closed_at) : '—'}</td>
      <td class="num">${fmt(s.opening_cash)}</td>
      <td class="num">${s.closing_cash !== null ? fmt(s.closing_cash) : '—'}</td>
      <td>${s.status === 'open' ? '<span class="badge badge-green">مفتوحة</span>' : '<span class="badge badge-gray">مغلقة</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="7"><div class="empty">لا توجد ورديات</div></td></tr>';
}

async function printersLoad() {
  const info = document.getElementById('printersInfo');
  const tbody = document.getElementById('printersTable');
  const pick = document.getElementById('printerPick');
  const barPick = document.getElementById('barcodePrinterPick');
  if (!window.printerAPI) {
    info.textContent = 'كشف الطابعات متاح في نسخة سطح المكتب فقط (البرنامج المثبّت).';
    tbody.innerHTML = '';
    if (pick) pick.innerHTML = '<option value="">غير متاح — استخدم نسخة سطح المكتب</option>';
    if (barPick) barPick.innerHTML = '<option value="">غير متاح</option>';
    return;
  }
  info.textContent = '...جاري الكشف عن الطابعات';
  tbody.innerHTML = '<tr><td colspan="5"><div class="empty">...جارٍ الكشف</div></td></tr>';
  try {
    const list = await window.printerAPI.getPrinters();
    let pref = localStorage.getItem('invoicePrinterPref') || localStorage.getItem('printerPref') || '';
    let barPref = localStorage.getItem('barcodePrinterPref') || '';
    const isThermal = (name) => /XP-?58|GP-?58|RONGTA|XPRINTER|58\s?MM|58MM|58\s?mm|MINI.?PRINTER|58.?thermal/i.test(name || '');
    const thermal = list.find(p => isThermal(p.name));
    if ((!pref || !list.some(p => p.name === pref)) && thermal) {
      pref = thermal.name;
      localStorage.setItem('invoicePrinterPref', pref);
      localStorage.setItem('printerPref', pref);
    }
    if (pick) {
      pick.innerHTML = '<option value="">الطابعة الافتراضية للنظام</option>' +
        list.map(p => `<option value="${esc(p.name)}" ${p.name === pref ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    }
    if (barPick) {
      barPick.innerHTML = '<option value="">(نفس طابعة الفواتير / الافتراضية)</option>' +
        list.map(p => `<option value="${esc(p.name)}" ${p.name === barPref ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    }
    const rows = list.map(p => {
      const th = isThermal(p.name);
      const isInv = p.name === pref;
      const isBar = p.name === barPref;
      const pType = detectPrinterType(p.name);
      const typeBadge = pType === 'thermal' ? '<span class="badge badge-green">🔥 حرارية</span>' : '<span class="badge badge-blue">📄 A4</span>';
      const invBadge = isInv ? ' <span class="badge badge-blue">🧾 طابعة الفواتير</span>' : '';
      const barBadge = isBar ? ' <span class="badge" style="background:#10b981;color:#fff">🏷️ طابعة الباركود</span>' : '';
      return `
      <tr${(th || isInv || isBar) ? ' style="background:var(--accent-bg, rgba(0,150,90,.12))"' : ''}>
        <td><b>${esc(p.name)}</b> ${typeBadge}${invBadge}${barBadge}</td>
        <td>${p.status ? `<span class="badge badge-green">${esc(p.status)}</span>` : '<span class="badge badge-gray">—</span>'}</td>
        <td>${p.isDefault ? '<span class="badge badge-blue">افتراضية</span>' : '—'}</td>
        <td class="small" dir="ltr" style="text-align:left">${esc(p.description || '—')}</td>
        <td class="small">${esc((p.options && p.options['printer-type']) || '—')}</td>
      </tr>`;
    }).join('');
    tbody.innerHTML = rows || '<tr><td colspan="5"><div class="empty">لم يتم العثور على طابعات متصلة</div></td></tr>';
    const thermalFound = list.filter(p => isThermal(p.name));
    const a4Found = list.filter(p => !isThermal(p.name));
    if (thermalFound.length && a4Found.length) {
      info.textContent = `🔥 حرارية: ${thermalFound.map(p => p.name).join('، ')} — 📄 A4: ${a4Found.map(p => p.name).join('، ')}`;
    } else if (thermalFound.length) {
      info.textContent = `تم التعرف على طابعة حرارية ✅ — "${thermalFound.map(p => p.name).join('، ')}" — ستطبع على 58مم`;
    } else if (a4Found.length) {
      info.textContent = `📄 تم العثور على ${a4Found.length} طابعة A4 — "${a4Found.map(p => p.name).join('، ')}" — ستطبع على ورق عادي`;
    } else {
      info.textContent = 'لا توجد طابعات متصلة';
    }
    if (pick && !list.some(p => p.name === pref)) pick.value = '';
    if (barPick && !list.some(p => p.name === barPref)) barPick.value = '';
  } catch (e) {
    info.textContent = 'تعذر كشف الطابعات: ' + e.message;
    tbody.innerHTML = '';
  }
}
