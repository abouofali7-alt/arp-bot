let REP_ROLES = { admin: 'مدير', cashier: 'كاشير', accountant: 'محاسب', marketing: 'مدير التسويق', maint_worker: 'عامل صيانة' };
function roleBadge(role) {
  const cls = { admin: 'badge-red', accountant: 'badge-blue', marketing: 'badge-orange', cashier: 'badge-green', maint_worker: 'badge-purple' }[role] || 'badge-gray';
  return `<span class="badge ${cls}">${esc(REP_ROLES[role] || role)}</span>`;
}

async function renderUsers() {
  const el = document.getElementById('viewContainer');
  el.innerHTML = `
    <div class="toolbar">
      <h3 style="flex:1">👥 المستخدمون</h3>
      <button class="btn" onclick="userOpenForm()">➕ مستخدم جديد</button>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الصلاحية</th><th>الفرع</th><th>الحالة</th><th></th></tr></thead>
        <tbody id="usersTable"></tbody>
      </table></div>
    </div>
    <div class="toolbar mt-10">
      <h3 style="flex:1">🏢 الفروع</h3>
      <button class="btn" onclick="branchOpenForm()">➕ فرع جديد</button>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>الاسم</th><th>الكود</th><th>العنوان</th><th>الهاتف</th></tr></thead>
        <tbody id="branchesTable"></tbody>
      </table></div>
    </div>`;

  const [users, branches] = await Promise.all([API.get('/api/users'), API.get('/api/branches')]);
  document.getElementById('usersTable').innerHTML = users.map(u => `
    <tr>
      <td><b>${esc(u.full_name)}</b></td>
      <td class="small">${esc(u.username)}</td>
      <td>${roleBadge(u.role)}</td>
      <td class="small">${esc(branches.find(b => b.id === u.branch_id)?.name || '—')}</td>
      <td>${u.active ? '<span class="badge badge-green">نشط</span>' : '<span class="badge badge-gray">موقوف</span>'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="userOpenForm(${u.id})">تعديل</button>
        ${u.role !== 'admin' ? `<button class="btn btn-danger btn-sm" onclick="userDelete(${u.id}, '${esc(u.full_name).replace(/'/g, "\\'")}')">🗑️</button>` : ''}
      </td>
    </tr>`).join('');
  document.getElementById('branchesTable').innerHTML = branches.map(b => `
    <tr><td><b>${esc(b.name)}</b></td><td class="small">${esc(b.code)}</td><td class="small">${esc(b.address || '—')}</td><td class="small" dir="ltr">${esc(b.phone || '—')}</td></tr>`).join('');
}

async function userOpenForm(id) {
  const branches = await API.get('/api/branches');
  let u = null;
  if (id) {
    const users = await API.get('/api/users');
    u = users.find(x => x.id === id);
  }
  openModal(`
    <div class="modal-head"><h3>${u ? 'تعديل مستخدم' : '➕ مستخدم جديد'}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="form-group"><label>الاسم الكامل *</label><input id="uName" value="${esc(u?.full_name || '')}"></div>
    <div class="form-group"><label>اسم المستخدم *</label><input id="uUsername" value="${esc(u?.username || '')}" ${u ? 'disabled' : ''}></div>
    <div class="form-group"><label>كلمة المرور ${u ? '(اتركها فارغة لعدم التغيير)' : '*'}</label><input type="password" id="uPass"></div>
    <div class="grid-2">
      <div class="form-group"><label>الصلاحية</label>
        <select id="uRole">${Object.entries(REP_ROLES).map(([v, n]) => `<option value="${v}" ${u?.role === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="form-group"><label>الفرع</label>
        <select id="uBranch"><option value="">— بدون —</option>${branches.map(b => `<option value="${b.id}" ${u && u.branch_id == b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="userSave(${u?.id || 0})">حفظ</button>
      ${u ? `<button class="btn btn-warning" onclick="userToggle(${u.id}, ${u.active ? 0 : 1})">${u.active ? 'إيقاف' : 'تفعيل'}</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">إلغاء</button>
    </div>
  `);
}

async function userSave(id) {
  const name = document.getElementById('uName').value.trim();
  const username = document.getElementById('uUsername').value.trim();
  const pass = document.getElementById('uPass').value;
  if (!name || (!id && !username) || (!id && !pass)) { showAlert('بيانات ناقصة', 'error'); return; }
  const body = {
    full_name: name,
    role: document.getElementById('uRole').value,
    branch_id: document.getElementById('uBranch').value || null,
  };
  if (pass) body.password = pass;
  if (id) { await API.put('/api/users/' + id, body); showAlert('تم التعديل'); }
  else { await API.post('/api/users', { ...body, username }); showAlert('تمت الإضافة'); }
  closeModal();
  renderUsers();
}

async function userToggle(id, active) {
  await API.put('/api/users/' + id, { active });
  closeModal();
  renderUsers();
}

async function userDelete(id, name) {
  if (!confirm(`هل أنت متأكد من حذف المستخدم "${name}" نهائيًا؟\nلن يمكن التراجع. لو له سجلات (فواتير/ورديات) سيُمنع الحذف.`)) return;
  try {
    await API.del('/api/users/' + id);
    showAlert('تم حذف المستخدم');
    renderUsers();
  } catch (e) { showAlert(e.message, 'error'); }
}

async function branchOpenForm() {
  openModal(`
    <div class="modal-head"><h3>🏢 فرع جديد</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="grid-2">
      <div class="form-group"><label>اسم الفرع *</label><input id="bName"></div>
      <div class="form-group"><label>الكود *</label><input id="bCode" placeholder="BR-002"></div>
      <div class="form-group"><label>العنوان</label><input id="bAddress"></div>
      <div class="form-group"><label>الهاتف</label><input id="bPhone"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="branchSave()">حفظ</button><button class="btn btn-secondary" onclick="closeModal()">إلغاء</button></div>
  `);
}
async function branchSave() {
  const name = document.getElementById('bName').value.trim();
  const code = document.getElementById('bCode').value.trim();
  if (!name || !code) { showAlert('الاسم والكود مطلوبان', 'error'); return; }
  await API.post('/api/branches', { name, code, address: document.getElementById('bAddress').value, phone: document.getElementById('bPhone').value });
  closeModal();
  showAlert('تم إضافة الفرع');
  renderUsers();
}
