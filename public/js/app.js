let CURRENT_USER = null;
let SETTINGS = {};

function isAdminUser() {
  return !!CURRENT_USER && CURRENT_USER.role === 'admin';
}

const ROLE_NAMES = { admin: 'مدير النظام', cashier: 'كاشير', accountant: 'محاسب', marketing: 'مدير التسويق', maint_worker: 'عامل صيانة' };

const PAGE_PERMS = [
  { id: 'dashboard', label: '🏠 الرئيسية' },
  { id: 'pos', label: '🛒 شاشة البيع' },
  { id: 'sales', label: '🧾 فواتير البيع' },
  { id: 'returns', label: '↩️ المرتجعات' },
  { id: 'maintenance', label: '🔧 أعمال الصيانة' },
  { id: 'used_devices', label: '📱 الأجهزة المستعملة والمبايعات' },
  { id: 'products', label: '📦 المنتجات والمخزون' },
  { id: 'purchases', label: '📥 المشتريات' },
  { id: 'barcodes', label: '🏷️ طباعة باركود' },
  { id: 'parties', label: '🤝 الموردون والعملاء' },
  { id: 'reports', label: '📊 التقارير' },
  { id: 'accounting', label: '🧮 حسابات الشركاء ورأس المال' },
  { id: 'expenses', label: '💸 المصروفات' },
  { id: 'coupons', label: '🎟️ الكوبونات' },
  { id: 'stocktake', label: '📋 الجرد' },
  { id: 'whatsapp_bot', label: '🤖 بوت واتساب و n8n' },
];
const ACTION_PERMS = [
  { key: 'products.edit', label: 'إضافة وتعديل المنتجات والأسعار والمخزون والأقسام' },
  { key: 'purchases.create', label: 'إنشاء فواتير شراء جديدة' },
  { key: 'parties.edit', label: 'إدارة الموردين والعملاء والموظفين والمرتبات' },
  { key: 'maintenance.delete_job', label: 'حذف أوامر الصيانة' },
  { key: 'used_devices.edit', label: 'شراء وبيع وتعديل الأجهزة المستعملة' },
  { key: 'expenses.create', label: 'إضافة وتعديل المصروفات' },
];

function userPermsObj() {
  if (!CURRENT_USER) return {};
  let p = CURRENT_USER.permissions;
  if (typeof p === 'string') { try { p = JSON.parse(p || '{}'); } catch { p = {}; } }
  return p || {};
}
function canPage(id) {
  if (isAdminUser()) return true;
  const def = !(NAV.find(n => n.id === id) || {}).admin;
  const pages = userPermsObj().pages;
  if (!pages || !Array.isArray(pages)) return def;
  return pages.includes(id);
}
function can(key) {
  if (isAdminUser()) return true;
  const actions = userPermsObj().actions;
  return !!(actions && actions[key]);
}

const NAV = [
  { id: 'dashboard', title: 'الرئيسية', icon: '🏠', view: 'dashboard', admin: true },
  { id: 'pos', title: 'شاشة البيع', icon: '🛒', view: 'pos' },
  { id: 'sales', title: 'فواتير البيع', icon: '🧾', view: 'sales' },
  { id: 'returns', title: 'المرتجعات', icon: '↩️', view: 'returns' },
  { id: 'maintenance', title: 'أعمال الصيانة', icon: '🔧', view: 'maintenance' },
  { id: 'used_devices', title: 'الأجهزة المستعملة', icon: '📱', view: 'used_devices' },
  { id: 'products', title: 'المنتجات والمخزون', icon: '📦', view: 'products' },
  { id: 'purchases', title: 'المشتريات', icon: '📥', view: 'purchases' },
  { id: 'barcodes', title: 'طباعة باركود', icon: '🏷️', view: 'barcodes' },
  { id: 'parties', title: 'الموردون والعملاء', icon: '🤝', view: 'parties' },
  { id: 'reports', title: 'التقارير', icon: '📊', view: 'reports', admin: true },
  { id: 'accounting', title: 'حسابات الشركاء', icon: '🧮', view: 'accounting', admin: true },
  { id: 'expenses', title: 'المصروفات', icon: '💸', view: 'expenses', admin: true },
  { id: 'coupons', title: 'الكوبونات', icon: '🎟️', view: 'coupons', admin: true },
  { id: 'stocktake', title: 'الجرد', icon: '📋', view: 'stocktake', admin: true },
  { id: 'whatsapp_bot', title: 'بوت واتساب و n8n', icon: '🤖', view: 'whatsapp_bot', admin: true },
  { id: 'users', title: 'المستخدمون والفروع', icon: '👥', view: 'users', admin: true },
  { id: 'permissions', title: 'الصلاحيات', icon: '🔐', view: 'permissions', admin: true },
  { id: 'settings', title: 'الإعدادات', icon: '⚙️', view: 'settings', admin: true },
];

async function init() {
  const token = localStorage.getItem('token');
  if (!token) { window.location.href = '/'; return; }
  try {
    CURRENT_USER = JSON.parse(localStorage.getItem('user'));
    const me = await API.get('/api/me');
    CURRENT_USER = me.user;
    localStorage.setItem('user', JSON.stringify(me.user));
  } catch {
    window.location.href = '/'; return;
  }
  try { SETTINGS = await API.get('/api/settings'); } catch {}
  if (SETTINGS.store_name) document.getElementById('storeName').textContent = SETTINGS.store_name;
  applyTypography();
  document.getElementById('userName').textContent = CURRENT_USER.full_name;
  document.getElementById('userRole').textContent = ROLE_NAMES[CURRENT_USER.role] || CURRENT_USER.role;
  document.getElementById('userAvatar').textContent = CURRENT_USER.full_name.charAt(0);
  document.getElementById('sideUser').textContent = CURRENT_USER.full_name + ' — ' + (CURRENT_USER.branch || '');
  buildNav();
  applyAppearance();
  route();
}

function buildNav() {
  const nav = document.getElementById('navMenu');
  nav.innerHTML = NAV.map(n => {
    if (!canPage(n.id)) return '';
    return `<a data-view="${n.id}" onclick="navigate('${n.id}')">
      <span class="ic">${n.icon}</span><span>${n.title}</span>
    </a>`;
  }).join('');
}

function navigate(id) {
  closeSidebarMobile();
  location.hash = '#' + id;
}

function route() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay && overlay.classList.contains('open')) {
    minimizeModal();
  }
  const id = (location.hash || '#dashboard').replace('#', '');
  const item = NAV.find(n => n.id === id);
  if (!item || !canPage(id)) { location.hash = isAdminUser() ? '#dashboard' : '#pos'; return; }
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === id));
  document.getElementById('pageTitle').textContent = item.title;
  const views = {
    dashboard: renderDashboard,
    pos: renderPOS,
    sales: renderSales,
    returns: renderReturns,
    maintenance: renderMaintenance,
    used_devices: renderUsedDevices,
    products: renderProducts,
    purchases: renderPurchases,
    barcodes: renderBarcodes,
    parties: renderParties,
    reports: renderReports,
    accounting: renderAccounting,
    expenses: renderExpenses,
    coupons: renderCoupons,
    stocktake: renderStocktakes,
    whatsapp_bot: renderWhatsAppBot,
    users: renderUsers,
    permissions: renderPermissions,
    settings: renderSettings,
  };
  const fn = views[item.view];
  if (fn) fn();
}

window.addEventListener('hashchange', route);
window.addEventListener('resize', () => {
  if (!isMobile()) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarBackdrop').classList.remove('visible');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const el = document.activeElement;
  if (!el || !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.disabled) return;
  const focusables = Array.from(document.querySelectorAll(
    'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(f => f.offsetParent !== null);
  const idx = focusables.indexOf(el);
  if (idx === -1) return;
  if (e.shiftKey && idx === 0) e.preventDefault();
  else if (!e.shiftKey && idx === focusables.length - 1) e.preventDefault();
});

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
}

/* ---------- Theme + Sidebar ---------- */
function toggleTheme() {
  const html = document.documentElement;
  const dark = html.getAttribute('data-theme') === 'dark';
  if (dark) html.removeAttribute('data-theme');
  else html.setAttribute('data-theme', 'dark');
  localStorage.setItem('theme', dark ? 'light' : 'dark');
  updateThemeBtn();
}
function updateThemeBtn() {
  const b = document.getElementById('themeBtn');
  if (b) b.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
}

function isMobile() { return window.innerWidth <= 768; }

function toggleSidebar() {
  if (isMobile()) {
    const sb = document.getElementById('sidebar');
    const bd = document.getElementById('sidebarBackdrop');
    sb.classList.toggle('open');
    bd.classList.toggle('visible');
  } else {
    const app = document.querySelector('.app');
    app.classList.toggle('sidebar-hidden');
    localStorage.setItem('sidebarHidden', app.classList.contains('sidebar-hidden') ? '1' : '0');
  }
}
function closeSidebarMobile() {
  if (!isMobile()) return;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('visible');
}

function applyAppearance() {
  if (!isMobile() && localStorage.getItem('sidebarHidden') === '1') document.querySelector('.app').classList.add('sidebar-hidden');
  updateThemeBtn();
}

/* ---------- Typography (font + text colors) ---------- */
function applyTypography() {
  let st = document.getElementById('typoStyle');
  if (!st) { st = document.createElement('style'); st.id = 'typoStyle'; document.head.appendChild(st); }
  const font = String(SETTINGS.font_family || '').trim().replace(/[^A-Za-z0-9 \u0600-\u06FF-]/g, '');
  const cl = /^#[0-9a-fA-F]{6}$/.test(SETTINGS.text_color_light || '') ? SETTINGS.text_color_light : '';
  const cd = /^#[0-9a-fA-F]{6}$/.test(SETTINGS.text_color_dark || '') ? SETTINGS.text_color_dark : '';
  st.textContent =
    (font ? `:root{--app-font:'${font}',Tahoma,Arial,sans-serif;}` : '') +
    (cl ? `:root:not([data-theme="dark"]){--text:${cl};}` : '') +
    (cd ? `[data-theme="dark"]{--text:${cd};}` : '');
}

/* ---------- Modal helpers & Window Controls ---------- */
let minimizedModals = [];
let modalStack = [];
let modalState = {
  get isMinimized() { return minimizedModals.length > 0; },
  set isMinimized(val) {},
  isMaximized: false,
  title: ''
};

function saveModalFormValues(container) {
  if (!container) return;
  container.querySelectorAll('input, select, textarea').forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked) el.setAttribute('checked', 'checked');
      else el.removeAttribute('checked');
    } else if (el.tagName === 'SELECT') {
      el.querySelectorAll('option').forEach(opt => {
        if (opt.value === el.value) opt.setAttribute('selected', 'selected');
        else opt.removeAttribute('selected');
      });
    } else {
      el.setAttribute('value', el.value);
      if (el.tagName === 'TEXTAREA') el.textContent = el.value;
    }
  });
}

function restoreModalFormValues(container) {
  if (!container) return;
  container.querySelectorAll('input, select, textarea').forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = el.hasAttribute('checked');
    } else if (el.tagName === 'SELECT') {
      const selectedOpt = el.querySelector('option[selected]');
      if (selectedOpt) el.value = selectedOpt.value;
    } else {
      const val = el.getAttribute('value');
      if (val !== null) el.value = val;
    }
  });
}

function openModal(html, large, keepParent = false) {
  const box = document.getElementById('modalBox');
  const overlay = document.getElementById('modalOverlay');
  if (!box || !overlay) return;

  // If there's an active visible modal open
  if (overlay.classList.contains('open') && box.innerHTML.trim()) {
    if (keepParent) {
      saveModalFormValues(box);
      modalStack.push({
        html: box.innerHTML,
        className: box.className,
        title: modalState.title,
        isMaximized: modalState.isMaximized
      });
    } else {
      // Auto-minimize current active modal into dock bar so user work isn't lost!
      minimizeModal();
    }
  } else if (!keepParent) {
    modalStack = [];
  }

  modalState.isMaximized = false;
  box.className = 'modal' + (large ? ' lg' : '');

  const temp = document.createElement('div');
  temp.innerHTML = html;
  const h3 = temp.querySelector('.modal-head h3');
  modalState.title = h3 ? h3.textContent.trim() : 'النافذة الحالية';

  // Enhance modal-head controls
  const headBtn = temp.querySelector('.modal-head .modal-close');
  if (headBtn) {
    const controlsHtml = `
      <div class="modal-win-controls">
        <button type="button" class="win-btn win-min" onclick="minimizeModal()" title="تصغير إلى الشريط الأسفل">➖</button>
        <button type="button" class="win-btn win-max" onclick="toggleMaximizeModal()" title="تكبير / ملء الشاشة">🗖</button>
        <button type="button" class="win-btn win-close" onclick="closeModal(${keepParent ? 'true' : ''})" title="إغلاق">✕</button>
      </div>
    `;
    headBtn.outerHTML = controlsHtml;
  }

  box.innerHTML = temp.innerHTML;
  overlay.classList.add('open');
  overlay.classList.remove('minimized');
  updateDockBar();
}

function minimizeModal() {
  const box = document.getElementById('modalBox');
  const overlay = document.getElementById('modalOverlay');
  if (!overlay || !overlay.classList.contains('open') || !box || !box.innerHTML.trim()) return;

  saveModalFormValues(box);
  const h3 = box.querySelector('.modal-head h3');
  const title = h3 ? h3.textContent.trim() : 'نافذة قيد التحرير';
  const id = 'mod_' + Date.now() + '_' + Math.floor(Math.random() * 10000);

  minimizedModals.push({
    id,
    title,
    html: box.innerHTML,
    className: box.className,
    isMaximized: box.classList.contains('maximized')
  });

  box.innerHTML = '';
  box.classList.remove('maximized', 'shake');
  overlay.classList.remove('open', 'minimized');
  updateDockBar();
}

function restoreModalById(id) {
  const box = document.getElementById('modalBox');
  const overlay = document.getElementById('modalOverlay');
  if (!box || !overlay) return;

  // Auto-minimize any currently visible modal before restoring target
  if (overlay.classList.contains('open') && box.innerHTML.trim()) {
    minimizeModal();
  }

  let idx = minimizedModals.findIndex(m => m.id === id);
  if (idx === -1) {
    if (minimizedModals.length === 0) return;
    idx = minimizedModals.length - 1;
  }

  const target = minimizedModals.splice(idx, 1)[0];
  box.className = target.className;
  box.innerHTML = target.html;
  modalState.title = target.title;
  modalState.isMaximized = target.isMaximized;

  if (target.isMaximized) box.classList.add('maximized');
  else box.classList.remove('maximized');

  restoreModalFormValues(box);
  overlay.classList.add('open');
  overlay.classList.remove('minimized');
  updateDockBar();
}

function restoreModal(titleFilter) {
  if (minimizedModals.length === 0) return;
  if (titleFilter) {
    const match = minimizedModals.find(m => m.title.includes(titleFilter));
    if (match) {
      restoreModalById(match.id);
      return;
    }
  }
  restoreModalById(minimizedModals[minimizedModals.length - 1].id);
}

function closeMinimizedModalById(id, event) {
  if (event) event.stopPropagation();
  minimizedModals = minimizedModals.filter(m => m.id !== id);
  updateDockBar();
}

function toggleMaximizeModal() {
  const box = document.getElementById('modalBox');
  if (!box) return;
  modalState.isMaximized = !modalState.isMaximized;
  if (modalState.isMaximized) {
    box.classList.add('maximized');
  } else {
    box.classList.remove('maximized');
  }
}

function closeModal(restoreParent = false) {
  if (window.APP_scanner) {
    try { window.APP_scanner.stop().catch(() => {}); window.APP_scanner.clear(); } catch {}
    window.APP_scanner = null;
  }
  const box = document.getElementById('modalBox');
  const overlay = document.getElementById('modalOverlay');
  if (box) {
    box.innerHTML = '';
    box.classList.remove('maximized', 'shake');
  }

  if (restoreParent && modalStack.length > 0) {
    const prev = modalStack.pop();
    box.className = prev.className;
    box.innerHTML = prev.html;
    modalState.title = prev.title;
    modalState.isMaximized = prev.isMaximized;
    if (prev.isMaximized) box.classList.add('maximized');
    restoreModalFormValues(box);
    if (overlay) {
      overlay.classList.add('open');
      overlay.classList.remove('minimized');
    }
    updateDockBar();
    return;
  }

  modalStack = [];
  if (overlay) overlay.classList.remove('open', 'minimized');
  modalState.isMaximized = false;
  updateDockBar();
}

function updateDockBar() {
  let dock = document.getElementById('modalDockBar');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'modalDockBar';
    dock.className = 'modal-dock-bar';
    document.body.appendChild(dock);
  }

  if (minimizedModals.length > 0) {
    dock.innerHTML = minimizedModals.map(m => `
      <div class="dock-item" onclick="restoreModalById('${m.id}')" title="اضغط لاستعادة: ${esc(m.title)}">
        <span class="dock-icon">📌</span>
        <span class="dock-title">${esc(m.title)}</span>
        <span class="dock-badge">⬆️ استعادة</span>
        <button type="button" class="dock-close-btn" onclick="closeMinimizedModalById('${m.id}', event)" title="إغلاق النافذة">✕</button>
      </div>
    `).join('');
    dock.style.display = 'flex';
  } else {
    dock.style.display = 'none';
    dock.innerHTML = '';
  }
}

document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') {
    // Prevent accidental closing when clicking outside backdrop!
    const box = document.getElementById('modalBox');
    if (box) {
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
    }
  }
});

function showAlert(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const icons = { success: '\u2713', error: '\u2717', warning: '\u26A0', info: '\u2139' };
  const titles = { success: 'تم بنجاح', error: 'خطأ', warning: 'تنبيه', info: 'معلومة' };
  const dur = type === 'error' ? 5000 : 3500;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.style.setProperty('--toast-duration', dur + 'ms');
  t.innerHTML =
    '<div class="toast-icon">' + (icons[type] || icons.info) + '</div>' +
    '<div class="toast-body">' +
      '<div class="toast-title">' + (titles[type] || titles.info) + '</div>' +
      '<div class="toast-msg">' + esc(msg) + '</div>' +
    '</div>' +
    '<button class="toast-close" aria-label="\u0625\u063A\u0644\u0627\u0642">&times;</button>' +
    '<div class="toast-progress"></div>';
  t.querySelector('.toast-close').onclick = function () { dismiss(); };
  let removed = false;
  function dismiss() {
    if (removed) return;
    removed = true;
    t.classList.add('removing');
    setTimeout(function () { t.remove(); }, 320);
  }
  container.prepend(t);
  setTimeout(dismiss, dur);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init();
