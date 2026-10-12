let PERM_SEL = { userId: 0 };

async function renderPermissions() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = '<div class="muted" style="text-align:center;padding:60px">جاري التحميل...</div>';
  const users = await API.get('/api/users');
  const staff = users.filter(u => u.role !== 'admin');
  if (!staff.length) {
    el.innerHTML = `<div class="toolbar"><h3 style="flex:1">🔐 الصلاحيات</h3></div>
      <div class="empty" style="padding:60px">لا يوجد موظفون — أضف مستخدمين من صفحة المستخدمين أولاً</div>`;
    return;
  }
  el.innerHTML = `
    <div class="toolbar">
      <h3 style="flex:1">🔐 صلاحيات الموظفين</h3>
    </div>
    <div class="card">
      <div class="form-group" style="max-width:420px">
        <label>اختر الموظف</label>
        <select id="permUser" onchange="permPickUser()">
          ${staff.map(u => `<option value="${u.id}">${esc(u.full_name)} (${esc(u.username)}) — ${esc(ROLE_NAMES[u.role] || u.role)}${u.active ? '' : ' — موقوف'}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="permEditor"></div>`;

  PERM_SEL.userId = staff[0].id;
  permDrawEditor();
}

function permPickUser() {
  PERM_SEL.userId = Number(document.getElementById('permUser').value) || 0;
  permDrawEditor();
}

async function permDrawEditor() {
  const box = document.getElementById('permEditor');
  if (!PERM_SEL.userId) { box.innerHTML = ''; return; }
  const users = await API.get('/api/users');
  const u = users.find(x => x.id === PERM_SEL.userId);
  if (!u) { box.innerHTML = ''; return; }
  let perms = {};
  try { perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions || '{}') : (u.permissions || {}); } catch {}
  const pages = Array.isArray(perms.pages) ? perms.pages : null;
  const actions = perms.actions || {};

  box.innerHTML = `
    <div class="grid-2 mt-10">
      <div class="card">
        <div class="card-title">📄 الصفحات التي يشاهدها
          <button class="btn btn-ghost btn-sm" onclick="permToggleAllPages(true)">تحديد الكل</button>
          <button class="btn btn-ghost btn-sm" onclick="permToggleAllPages(false)">إلغاء الكل</button></div>
        <div class="perm-grid">
          ${PAGE_PERMS.map(p => `
            <label class="perm-item"><input type="checkbox" class="permPage" data-page="${p.id}" ${!pages || pages.includes(p.id) ? 'checked' : ''}> ${p.label}</label>`).join('')}
        </div>
        <div class="small muted mt-10">ملاحظة: لو مفيش أي تحديد محفوظ للموظف، هيشوف الصفحات الافتراضية للموظفين.</div>
      </div>
      <div class="card">
        <div class="card-title">✏️ الأجزاء التي يستطيع تعديلها</div>
        <div class="perm-grid">
          ${ACTION_PERMS.map(a => `
            <label class="perm-item"><input type="checkbox" class="permAction" data-key="${a.key}" ${actions[a.key] ? 'checked' : ''}> ${a.label}</label>`).join('')}
        </div>
        <div class="small muted mt-10">المدير الرئيسي له كل الصلاحيات دائمًا ولا يمكن تعديلها.</div>
      </div>
    </div>
    <div class="toolbar mt-10">
      <button class="btn" onclick="permSave()">💾 حفظ الصلاحيات</button>
      <button class="btn btn-secondary" onclick="permDrawEditor()">استعادة المحفوظ</button>
    </div>`;
}

function permToggleAllPages(on) {
  document.querySelectorAll('.permPage').forEach(cb => cb.checked = on);
}

async function permSave() {
  const pages = Array.from(document.querySelectorAll('.permPage')).filter(cb => cb.checked).map(cb => cb.dataset.page);
  const actions = {};
  document.querySelectorAll('.permAction').forEach(cb => { if (cb.checked) actions[cb.dataset.key] = true; });
  try {
    await API.put('/api/users/' + PERM_SEL.userId, { permissions: { pages, actions } });
    showAlert('تم حفظ الصلاحيات — تظهر للموظف بعد إعادة تسجيل الدخول أو تحديث الصفحة');
  } catch (e) { showAlert(e.message, 'error'); }
}
