'use strict';

const API = '/api';
let TOKEN = localStorage.getItem('hamada_token') || '';
let ADMIN = null;
let ordersState = [];
let providersState = [];

const DOC_LABELS = {
  personal: 'صورة شخصية',
  id: 'بطاقة التعريف',
  registration: 'البطاقة الرمادية',
  insurance: 'التأمين',
  payment: 'إيصال الدفع',
};

const PAY_LABELS = {
  bankily: 'بنكيلي Bankily',
  masrivi: 'مصرفي Masrivi',
  sadad: 'السداد Sadad',
  bim: 'بيم بانك Bim Bank',
};

const STATUS_LABELS = {
  new: 'جديد',
  accepted: 'مقبول',
  en_route: 'قيد التوصيل',
  completed: 'مكتمل',
  rejected: 'مرفوض',
  pending: 'قيد المراجعة',
  approved: 'مقبول',
  needs_resubmission: 'مطلوب استكمال',
};

const DOC_STATUS_LABELS = {
  pending: 'قيد المراجعة',
  accepted: 'معتمدة',
  rejected: 'مرفوضة',
};

const $ = (sel) => document.querySelector(sel);

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

/* ---------- Custom modals (بديل رسائل المتصفح) ---------- */

function openModal({ title, body, foot }) {
  const overlay = document.createElement('div');
  overlay.className = 'doc-lightbox';
  overlay.innerHTML =
    '<div class="modal-box">' +
    '<div class="doc-lightbox-head">' + title + '<button class="btn-sm" onclick="this.closest(\'.doc-lightbox\').remove()">إغلاق</button></div>' +
    '<div class="modal-body">' + (body || '') + '</div>' +
    (foot ? '<div class="modal-foot">' + foot + '</div>' : '') +
    '</div>';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  return overlay;
}

function askText(title, placeholder, onOk, opts = {}) {
  const overlay = openModal({
    title,
    body: '<textarea id="ask-text" class="modal-input" placeholder="' + esc(placeholder) + '" rows="3"></textarea>',
    foot:
      '<button class="modal-btn ghost" data-close>إلغاء</button>' +
      '<button class="modal-btn ok" data-submit>' + esc(opts.confirm || 'تأكيد') + '</button>',
  });
  const ta = overlay.querySelector('#ask-text');
  if (opts.value) ta.value = opts.value;
  setTimeout(() => ta.focus(), 30);
  const submit = () => {
    const val = ta.value.trim();
    if (opts.required && !val) {
      ta.style.borderColor = 'var(--danger)';
      ta.focus();
      return;
    }
    overlay.remove();
    onOk(val);
  };
  overlay.querySelector('[data-submit]').addEventListener('click', submit);
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return overlay;
}

function askConfirm(title, message, onOk, opts = {}) {
  const overlay = openModal({
    title,
    body: '<p>' + message + '</p>',
    foot:
      '<button class="modal-btn ghost" data-close>إلغاء</button>' +
      '<button class="modal-btn ' + (opts.danger ? 'no' : 'ok') + '" data-submit>' + esc(opts.confirm || 'تأكيد') + '</button>',
  });
  overlay.querySelector('[data-submit]').addEventListener('click', () => { overlay.remove(); onOk(); });
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
  return overlay;
}

/* ---------- نغمات العمليات الواردة ---------- */

let audioCtx = null;
let soundEnabled = true;

function ensureAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}
document.addEventListener('pointerdown', ensureAudio, { capture: true });
document.addEventListener('keydown', ensureAudio, { capture: true });

function beep(freq, delay, dur, vol, type) {
  if (!audioCtx || !soundEnabled) return;
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function toneKind(action) {
  const a = action || '';
  if (a.includes('طلب توصيل جديد')) return 'order';
  if (a.includes('طلب اشتراك جديد') || a.includes('إعادة رفع أوراق')) return 'subs';
  if (a.includes('حظر') || a.includes('حذف') || a.includes('رفض')) return 'danger';
  if (a.includes('قبول')) return 'accept';
  return 'default';
}

function playTone(kind) {
  switch (kind) {
    case 'order': beep(880, 0, 0.12, 0.22); beep(1175, 0.15, 0.16, 0.22); break;
    case 'subs': beep(523, 0, 0.14, 0.2); beep(659, 0.16, 0.14, 0.2); beep(784, 0.32, 0.2, 0.22); break;
    case 'accept': beep(659, 0, 0.12, 0.2); beep(880, 0.14, 0.2, 0.2); break;
    case 'danger': beep(392, 0, 0.16, 0.24, 'square'); beep(311, 0.2, 0.16, 0.24, 'square'); beep(392, 0.4, 0.24, 0.24, 'square'); break;
    default: beep(698, 0, 0.1, 0.18); beep(698, 0.12, 0.12, 0.18); break;
  }
}

/* ---------- التلقي الدوري للعمليات الواردة ---------- */

let lastActivityId = 0;
let pollTimer = null;

function startActivityPoller() {
  lastActivityId = 0;
  stopActivityPoller();
  pollTimer = setInterval(pollActivity, 8000);
  pollActivity();
}

function stopActivityPoller() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function autoRefreshView(name) {
  const btn = document.querySelector('[data-reload="' + name + '"]');
  if (btn) btn.classList.add('busy');
  loadView(name)
    .catch(() => {})
    .finally(() => { if (btn) btn.classList.remove('busy'); });
}

async function pollActivity() {
  try {
    const res = await api('/activity/since?after=' + lastActivityId);
    const current = Number(res.current || 0);
    if (lastActivityId === 0) { lastActivityId = current; return; }
    const fresh = (res.rows || []).filter((a) => a.id > lastActivityId && a.admin_name !== ADMIN.full_name);
    lastActivityId = current;
    if (!fresh.length) return;
    fresh.forEach((a) => playTone(toneKind(a.action)));
    const first = fresh[0];
    toast(fresh.length > 1 ? fresh.length + ' عمليات جديدة — ' + first.action : first.action + (first.target ? ': ' + first.target : ''));
    const badge = $('#event-badge');
    if (badge) { badge.textContent = fresh.length; badge.classList.remove('hidden'); }
    if (document.querySelector('.doc-lightbox')) return;
    const active = document.querySelector('.nav-item.active');
    if (active && active.dataset.view !== 'settings') autoRefreshView(active.dataset.view);
  } catch {}
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const res = await fetch(API + path, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error('انتهت الجلسة');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطأ في الطلب');
  return data;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('ar-MA') + ' أوقية';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ar-MA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ar-MA');
}

/* ---------- Login ---------- */

async function handleLogin(e) {
  e.preventDefault();
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  $('#login-btn').textContent = 'جاري الدخول...';
  try {
    const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    TOKEN = res.token;
    ADMIN = res.admin;
    localStorage.setItem('hamada_token', TOKEN);
    enterApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
    $('#login-error').classList.remove('hidden');
  } finally {
    $('#login-btn').textContent = 'دخول';
  }
}

function logout() {
  TOKEN = '';
  ADMIN = null;
  stopActivityPoller();
  localStorage.removeItem('hamada_token');
  $('#login-screen').classList.remove('hidden');
  $('#app-screen').classList.add('hidden');
  $('#login-password').value = '';
}

function enterApp() {
  $('#login-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');
  $('#user-name').textContent = ADMIN.full_name;
  $('#user-role').textContent = ADMIN.role === 'owner' ? 'مالك النظام' : ADMIN.role;
  switchView('dashboard');
  loadView('dashboard');
  startClock();
  startActivityPoller();
}

/* ---------- Navigation ---------- */

const TITLES = {
  dashboard: 'لوحة الإحصائيات',
  requests: 'طلبات الاشتراك',
  orders: 'الطلبات',
  providers: 'أصحاب التوصيل',
  customers: 'الزبائن',
  activity: 'سجل النشاط',
  settings: 'الإعدادات',
};

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $('#view-title').textContent = TITLES[name] || '';
}

async function loadView(name) {
  try {
    if (name === 'dashboard') await loadDashboard();
    if (name === 'requests') await loadRequests();
    if (name === 'orders') await loadOrders();
    if (name === 'providers') await loadProviders();
    if (name === 'customers') await loadCustomers();
    if (name === 'activity') await loadActivity();
    if (name === 'settings') await loadSubSettings();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------- Dashboard ---------- */

const STAT_META = [
  { key: 'orders_today', label: 'طلبات اليوم', sub: null },
  { key: 'pending_requests', label: 'اشتراكات قيد المراجعة', sub: null, cls: 'gold' },
  { key: 'active_providers', label: 'أصحاب توصيل متصلون', sub: null },
  { key: 'orders_total', label: 'إجمالي الطلبات', sub: null },
  { key: 'customers', label: 'الزبائن', sub: null, cls: 'blue' },
  { key: 'providers', label: 'أصحاب التوصيل', sub: null },
];

async function loadDashboard() {
  const [stats, activity] = await Promise.all([api('/stats'), api('/activity')]);
  const grid = $('#stats-cards');
  grid.innerHTML = '';
  const cards = [
    ...STAT_META.map((m) => {
      const v = stats[m.key];
      const sub = m.key === 'revenue_today' ? '' : m.sub;
      return { ...m, value: v, sub };
    }),
    { label: 'إيرادات اليوم', value: stats.revenue_today, sub: 'أوقية جديدة', cls: 'gold' },
    { label: 'إجمالي الإيرادات', value: stats.revenue, sub: 'أوقية', cls: 'gold' },
  ];
  cards.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'stat-card' + (c.cls ? ' ' + c.cls : '');
    const isMoney = c.label.includes('إيراد');
    div.innerHTML =
      '<div class="stat-label">' + esc(c.label) + '</div>' +
      '<div class="stat-value">' + (isMoney ? fmtMoney(c.value) : esc(c.value)) + '</div>' +
      (c.sub ? '<div class="stat-sub">' + esc(c.sub) + '</div>' : '');
    grid.appendChild(div);
  });

  const breakdownEl = $('.two-col #orders-breakdown, .breakdown');
  const bdContainer = $('#view-dashboard .two-col .card:nth-child(1) .breakdown');
  const statuses = ['new', 'accepted', 'en_route', 'completed', 'rejected'];
  const statusCounts = await api('/orders?limit=500');
  const counts = {};
  statuses.forEach((s) => (counts[s] = 0));
  statusCounts.forEach((o) => (counts[o.status] = (counts[o.status] || 0) + 1));
  const max = Math.max(1, ...Object.values(counts));
  bdContainer.innerHTML = '';
  statuses.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    row.innerHTML =
      '<span class="bd-label">' + esc(STATUS_LABELS[s]) + '</span>' +
      '<div class="bd-bar"><div class="bd-fill" style="width:' + Math.round((counts[s] / max) * 100) + '%"></div></div>' +
      '<span class="bd-count">' + counts[s] + '</span>';
    bdContainer.appendChild(row);
  });

  const recent = $('#view-dashboard .two-col .card:nth-child(2) .activity-list');
  recent.innerHTML = activity
    .slice(0, 6)
    .map((a) => '<li>' + esc(a.action) + ' <span class="act-time">' + esc(a.target) + ' — ' + fmtDate(a.created_at) + '</span></li>')
    .join('') || '<li>لا يوجد نشاط بعد</li>';
  void breakdownEl;
}

/* ---------- Requests ---------- */

let requestsFilter = '';
let requestsState = [];

async function loadRequests() {
  requestsState = await api('/subscription-requests' + (requestsFilter ? '?status=' + requestsFilter : ''));
  const body = $('#requests-body');
  if (!requestsState.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="8">لا توجد طلبات</td></tr>';
    return;
  }
  body.innerHTML = requestsState
    .map((r) => {
      let docs = [];
      try { docs = JSON.parse(r.documents || '[]'); } catch {}
      const docChips = docs
        .map((d) => {
          const label = esc(DOC_LABELS[d.category] || d.category || 'وثيقة');
          const st = d.status || 'pending';
          if (d.data) {
            return '<span class="thumb-wrap ' + st + '" title="' + label + ' - ' + (DOC_STATUS_LABELS[st] || st) + '"><img class="doc-thumb" src="data:image/jpeg;base64,' + esc(d.data) + '" onclick="openDocImage(this.src, \'' + label + '\')"></span>';
          }
          return '<span class="doc-chip">' + label + '</span>';
        })
        .join(' ');
      const statusBadge = '<span class="badge ' + r.status + '">' + esc(STATUS_LABELS[r.status] || r.status) + '</span>';
      let actions = '<div class="row-actions">';
      if (r.status === 'pending') {
        actions +=
          '<button class="btn-sm blue" onclick="openReviewDocs(' + r.id + ')">مراجعة الأوراق</button>' +
          '<button class="btn-sm ok" onclick="reviewRequest(' + r.id + ',\'approve\')">قبول</button>' +
          '<button class="btn-sm no" onclick="reviewRequest(' + r.id + ',\'reject\')">رفض</button>';
      }
      actions += '<button class="btn-sm no" onclick="deleteRequest(' + r.id + ')">حذف</button></div>';
      return (
        '<tr>' +
        '<td>' + r.id + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong></td>' +
        '<td>' + esc(r.phone) + '</td>' +
        '<td>' + esc(PAY_LABELS[r.payment_method] || r.payment_method || '—') + '</td>' +
        '<td>' + docChips + '</td>' +
        '<td>' + fmtDate(r.created_at) + '</td>' +
        '<td>' + statusBadge + (r.review_note ? '<div class="req-note">' + esc(r.review_note) + '</div>' : '') + '</td>' +
        '<td>' + actions + '</td>' +
        '</tr>'
      );
    })
    .join('');
}

function deleteRequest(id) {
  const r = requestsState.find((x) => x.id === id);
  askConfirm(
    'حذف طلب الاشتراك',
    'هل تريد حذف طلب الاشتراك #' + id + (r ? ' لـ "' + esc(r.name) + '"' : '') + ' نهائياً؟<br>لن يستطيع أحد عرضه بعد الآن.',
    () => {
      api('/subscription-requests/' + id + '/delete', { method: 'POST', body: JSON.stringify({}) })
        .then(() => {
          toast('تم حذف طلب الاشتراك #' + id);
          loadRequests();
        })
        .catch((err) => toast(err.message, true));
    },
    { danger: true, confirm: 'حذف' }
  );
}

function deleteAllRequests() {
  askConfirm(
    'حذف كل طلبات الاشتراك',
    'هل تريد حذف جميع طلبات الاشتراك نهائياً؟<br>لا يمكن التراجع عن هذه العملية.',
    () => {
      api('/subscription-requests/delete-all', { method: 'POST', body: JSON.stringify({}) })
        .then((res) => {
          toast('تم حذف ' + (res && res.deleted ? res.deleted : 0) + ' طلب اشتراك');
          loadRequests();
          if (!requestsFilter) loadView('dashboard');
        })
        .catch((err) => toast(err.message, true));
    },
    { danger: true, confirm: 'حذف الكل' }
  );
}

function openDocImage(src, label) {
  const overlay = document.createElement('div');
  overlay.className = 'doc-lightbox';
  overlay.innerHTML =
    '<div class="doc-lightbox-box">' +
    '<div class="doc-lightbox-head">' + esc(label || 'وثيقة') + '<button class="btn-sm" onclick="this.parentElement.parentElement.parentElement.remove()">إغلاق</button></div>' +
    '<img src="' + src + '">' +
    '</div>';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

function reviewRequest(id, action) {
  const isApprove = action === 'approve';
  askText(
    isApprove ? 'قبول الاشتراك' : 'رفض الاشتراك',
    isApprove ? 'ملاحظة القبول (اختياري):' : 'سبب الرفض (مطلوب):',
    (note) => {
      api('/subscription-requests/' + id + '/' + action, { method: 'POST', body: JSON.stringify({ note }) })
        .then(() => {
          toast(isApprove ? 'تم قبول الاشتراك وإنشاء الحساب' : 'تم رفض الاشتراك');
          loadRequests();
          if (requestsFilter === 'pending' || !requestsFilter) loadView('dashboard');
        })
        .catch((err) => toast(err.message, true));
    },
    { required: !isApprove, confirm: isApprove ? 'قبول' : 'رفض' }
  );
}

let currentReviewId = null;

function openReviewDocs(id) {
  api('/subscription-requests').then((rows) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return toast('لم يتم العثور على الطلب', true);
    let docs = [];
    try { docs = JSON.parse(r.documents || '[]'); } catch {}
    currentReviewId = id;
    const items = docs
      .map((d, i) => {
        const label = esc(DOC_LABELS[d.category] || d.category || 'وثيقة');
        const st = d.status || 'pending';
        const img = d.data
          ? '<img class="rv-img" src="data:image/jpeg;base64,' + esc(d.data) + '" onclick="openDocImage(this.src, \'' + label + '\')">'
          : '<div class="rv-empty">لا صورة</div>';
        const note = esc(d.note || '');
        return (
          '<div class="rv-item" data-cat="' + esc(d.category) + '">' +
          '<div class="rv-imgbox">' + img + '</div>' +
          '<div class="rv-meta">' +
          '<strong>' + label + '</strong>' +
          '<div class="rv-btns">' +
          '<label class="rv-opt ' + (st === 'accepted' ? 'on ok' : '') + '" onclick="rvSelect(this)"><input type="radio" name="rv-' + i + '" value="accepted" ' + (st === 'accepted' ? 'checked' : '') + '> معتمدة</label>' +
          '<label class="rv-opt ' + (st === 'rejected' ? 'on no' : '') + '" onclick="rvSelect(this)"><input type="radio" name="rv-' + i + '" value="rejected" ' + (st === 'rejected' ? 'checked' : '') + '> مرفوضة</label>' +
          '</div>' +
          '<input class="rv-note ' + (st === 'rejected' ? '' : 'hidden') + '" placeholder="سبب الرفض (منتهية الصلاحية / صورة غير مطابقة...)" value="' + note + '">' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
    const overlay = document.createElement('div');
    overlay.className = 'doc-lightbox';
    overlay.innerHTML =
      '<div class="rv-modal">' +
      '<div class="doc-lightbox-head">مراجعة وثائق: ' + esc(r.name) + '<button class="btn-sm" onclick="this.closest(\'.doc-lightbox\').remove()">إغلاق</button></div>' +
      '<div class="rv-body">' + items + '</div>' +
      '<div class="rv-foot">' +
      '<span class="rv-hint">قبل/ارفض كل ورقة على حدة</span>' +
      '<button class="btn-primary rv-save" onclick="saveReviewDocs(this)">حفظ المراجعة</button>' +
      '</div>' +
      '</div>';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  });
}

function rvSelect(lbl) {
  const item = lbl.closest('.rv-item');
  const input = lbl.querySelector('input');
  if (input) input.checked = true;
  item.querySelectorAll('.rv-opt').forEach((x) => x.classList.remove('on'));
  lbl.classList.add('on');
  const note = item.querySelector('.rv-note');
  if (note) note.classList.toggle('hidden', !input || input.value !== 'rejected');
}

function saveReviewDocs(btn) {
  const modal = btn.closest('.rv-modal');
  const docs = [];
  modal.querySelectorAll('.rv-item').forEach((item) => {
    const checked = item.querySelector('input:checked');
    const noteInp = item.querySelector('.rv-note');
    const status = checked ? checked.value : 'pending';
    const entry = { category: item.dataset.cat, status };
    if (status === 'rejected' && noteInp) entry.note = noteInp.value.trim();
    docs.push(entry);
  });
  btn.disabled = true;
  api('/subscription-requests/' + currentReviewId + '/docs-review', {
    method: 'POST',
    body: JSON.stringify({ docs }),
  })
    .then((res) => {
      const status = res && res.request ? res.request.status : (res ? res.status : '');
      toast(status === 'approved' ? 'تم اعتماد الاشتراك تلقائياً وإنشاء الحساب' : 'تم حفظ مراجعة الوثائق');
      modal.closest('.doc-lightbox').remove();
      loadRequests();
      if (requestsFilter === 'pending' || !requestsFilter) loadView('dashboard');
    })
    .catch((err) => { btn.disabled = false; toast(err.message, true); });
}

/* ---------- Orders ---------- */

let ordersFilter = '';

async function loadOrders() {
  const q = ($('#orders-search') ? $('#orders-search').value : '').trim();
  const rows = await api('/orders?limit=500' + (ordersFilter ? '&status=' + ordersFilter : '') + (q ? '&q=' + encodeURIComponent(q) : ''));
  ordersState = rows;
  const body = $('#orders-body');
  if (!rows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="9">لا توجد طلبات</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((o) => {
      const nextMap = { new: 'accepted', accepted: 'en_route', en_route: 'completed' };
      const next = nextMap[o.status];
      const actions =
        o.status === 'new'
          ? '<button class="btn-sm ok" onclick="changeOrderStatus(' + o.id + ',\'accepted\')">قبول</button>'
          : next
          ? '<button class="btn-sm blue" onclick="changeOrderStatus(' + o.id + ',\'' + next + '\')">' + (next === 'completed' ? 'إنهاء' : 'التالي') + '</button>'
          : '<span class="badge ' + o.status + '">' + esc(STATUS_LABELS[o.status]) + '</span>';
      return (
        '<tr>' +
        '<td>' + o.id + '</td>' +
        '<td><strong>' + esc(o.customer_name) + '</strong></td>' +
        '<td>' + esc(o.from_area) + '</td>' +
        '<td>' + esc(o.to_area) + '</td>' +
        '<td>' + fmtMoney(o.total) + '</td>' +
        '<td>' + (o.provider_name ? esc(o.provider_name) : '<span class="badge new">غير مسند</span>') + '</td>' +
        '<td><span class="badge ' + o.status + '">' + esc(STATUS_LABELS[o.status]) + '</span></td>' +
        '<td><div class="row-actions">' +
        (o.status === 'new' ? '<button class="btn-sm blue" onclick="assignOrder(' + o.id + ')">إسناد</button>' : '') +
        actions +
        (o.status === 'rejected' ? '<button class="btn-sm ok" onclick="changeOrderStatus(' + o.id + ',\'accepted\')">إعادة</button>' : '') +
        '<button class="btn-sm blue" onclick="editOrder(' + o.id + ')">تعديل</button>' +
        '<button class="btn-sm no" onclick="deleteOrder(' + o.id + ')">حذف</button>' +
        '</div></td>' +
        '</tr>'
      );
    })
    .join('');
}

async function changeOrderStatus(id, status) {
  try {
    await api('/orders/status', { method: 'POST', body: JSON.stringify({ id, status }) });
    toast('تم تحديث الطلب #' + id);
    loadOrders();
    loadDashboard();
  } catch (err) {
    toast(err.message, true);
  }
}

function assignOrder(id) {
  if (!providersState.length) {
    toast('لا يوجد أصحاب توصيل للإسناد', true);
    return;
  }
  const options = providersState
    .map((p) => '<option value="' + p.id + '">' + esc(p.name) + ' — ' + esc(p.phone) + '</option>')
    .join('');
  const overlay = openModal({
    title: 'إسناد الطلب #' + id,
    body: '<select id="assign-provider" class="modal-input">' + options + '</select>',
    foot:
      '<button class="modal-btn ghost" data-close>إلغاء</button>' +
      '<button class="modal-btn ok" data-submit>إسناد</button>',
  });
  const sel = overlay.querySelector('#assign-provider');
  sel.focus();
  overlay.querySelector('[data-submit]').addEventListener('click', () => {
    const provId = Number(sel.value);
    const prov = providersState.find((x) => x.id === provId);
    overlay.remove();
    api('/orders/assign', { method: 'POST', body: JSON.stringify({ id, provider_id: provId }) })
      .then(() => {
        toast('تم إسناد الطلب إلى ' + prov.name);
        loadOrders();
      })
      .catch((err) => toast(err.message, true));
  });
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
}

const ORDER_STATUSES = ['new', 'accepted', 'en_route', 'completed', 'rejected'];

function editOrder(id) {
  const o = ordersState.find((x) => x.id === id);
  if (!o) return;
  const payOptions = Object.keys(PAY_LABELS)
    .map((k) => '<option value="' + k + '"' + (o.payment_method === k ? ' selected' : '') + '>' + esc(PAY_LABELS[k]) + '</option>')
    .join('') + '<option value="cash" ' + (o.payment_method === 'cash' ? 'selected' : '') + '>نقداً</option>';
  const statusOptions = ORDER_STATUSES
    .map((k) => '<option value="' + k + '"' + (o.status === k ? ' selected' : '') + '>' + esc(STATUS_LABELS[k]) + '</option>')
    .join('');
  const overlay = openModal({
    title: 'تعديل الرحلة #' + id,
    body:
      '<label class="modal-label">اسم الزبون</label>' +
      '<input id="eo-name" class="modal-input" type="text" value="' + esc(o.customer_name) + '">' +
      '<label class="modal-label">من</label>' +
      '<input id="eo-from" class="modal-input" type="text" value="' + esc(o.from_area) + '">' +
      '<label class="modal-label">إلى</label>' +
      '<input id="eo-to" class="modal-input" type="text" value="' + esc(o.to_area) + '">' +
      '<label class="modal-label">السعر (أوقية)</label>' +
      '<input id="eo-total" class="modal-input" type="number" min="100" max="250" step="1" value="' + esc(o.total) + '">' +
      '<label class="modal-label">وسيلة الدفع</label>' +
      '<select id="eo-pay" class="modal-input">' + payOptions + '</select>' +
      '<label class="modal-label">الحالة</label>' +
      '<select id="eo-status" class="modal-input">' + statusOptions + '</select>',
    foot:
      '<button class="modal-btn ghost" data-close>إلغاء</button>' +
      '<button class="modal-btn ok" data-submit>حفظ التعديل</button>',
  });
  const save = () => {
    const price = Number(overlay.querySelector('#eo-total').value);
    if (!Number.isFinite(price) || price < 100 || price > 250) {
      toast('سعر الرحلة يجب أن يكون بين 100 و 250 أوقية', true);
      return;
    }
    const body = {
      id,
      customer_name: overlay.querySelector('#eo-name').value.trim(),
      from_area: overlay.querySelector('#eo-from').value.trim(),
      to_area: overlay.querySelector('#eo-to').value.trim(),
      total: price,
      payment_method: overlay.querySelector('#eo-pay').value,
      status: overlay.querySelector('#eo-status').value,
    };
    overlay.remove();
    api('/orders/update', { method: 'POST', body: JSON.stringify(body) })
      .then(() => { toast('تم حفظ تعديل الرحلة'); loadOrders(); loadDashboard(); })
      .catch((err) => toast(err.message, true));
  };
  overlay.querySelector('[data-submit]').addEventListener('click', save);
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
}

function deleteOrder(id) {
  const o = ordersState.find((x) => x.id === id);
  if (!o) return;
  askConfirm(
    'حذف الرحلة',
    'هل تريد حذف الرحلة #' + id + ' لـ "' + esc(o.customer_name) + '" نهائياً؟<br>لن يستطيع أحد عرضها بعد الآن.',
    () => {
      api('/orders/delete', { method: 'POST', body: JSON.stringify({ id }) })
        .then(() => { toast('تم حذف الرحلة'); loadOrders(); loadDashboard(); })
        .catch((err) => toast(err.message, true));
    },
    { danger: true, confirm: 'حذف نهائي' }
  );
}

/* ---------- Providers ---------- */

async function loadProviders() {
  const rows = await api('/providers');
  providersState = rows;
  const body = $('#providers-body');
  if (!rows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="9">لا يوجد أصحاب توصيل</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((p) =>
      '<tr>' +
      '<td>' + p.id + '</td>' +
      '<td><strong>' + esc(p.name) + '</strong>' +
      (p.blocked ? ' <span class="badge rejected">محظور</span>' : '') +
      '</td>' +
      '<td>' + esc(p.phone) + '</td>' +
      '<td>' + esc(p.plate) + '</td>' +
      '<td>★ ' + esc(p.rating) + '</td>' +
      '<td><span class="badge ' + (p.is_connected ? 'online' : 'offline') + '">' + (p.is_connected ? 'متصل' : 'غير متصل') + '</span></td>' +
      '<td><span class="badge ' + (p.subscription_active ? 'active' : 'inactive') + '">' + (p.subscription_active ? 'نشط' : 'موقوف') + '</span></td>' +
      '<td>' + fmtDateShort(p.subscription_end) + '</td>' +
      '<td><div class="row-actions">' +
      '<button class="btn-sm blue" onclick="editProvider(' + p.id + ')">تعديل</button>' +
      '<button class="btn-sm blue" onclick="toggleProvider(' + p.id + ',\'toggle-connection\')">' + (p.is_connected ? 'إيقاف الاتصال' : 'تفعيل الاتصال') + '</button>' +
      '<button class="btn-sm ' + (p.subscription_active ? 'no' : 'ok') + '" onclick="toggleProvider(' + p.id + ',\'toggle-subscription\')">' + (p.subscription_active ? 'إيقاف الاشتراك' : 'تفعيل الاشتراك') + '</button>' +
      '<button class="btn-sm ' + (p.blocked ? 'ok' : 'no') + '" onclick="toggleProvider(' + p.id + ',\'toggle-block\')">' + (p.blocked ? 'رفع الحظر' : 'حظر') + '</button>' +
      '<button class="btn-sm no" onclick="deleteProvider(' + p.id + ')">حذف</button>' +
      '</div></td>' +
      '</tr>'
    )
    .join('');
}

function editProvider(id) {
  const p = providersState.find((x) => x.id === id);
  if (!p) return;
  const overlay = document.createElement('div');
  overlay.className = 'doc-lightbox';
  overlay.innerHTML =
    '<div class="rv-modal">' +
    '<div class="doc-lightbox-head">تعديل بيانات: ' + esc(p.name) + '<button class="btn-sm" onclick="this.closest(\'.doc-lightbox\').remove()">إغلاق</button></div>' +
    '<div class="rv-body edit-body">' +
    '<label>الاسم الكامل</label>' +
    '<input id="ep-name" type="text" value="' + esc(p.name) + '">' +
    '<label>رقم الهاتف</label>' +
    '<input id="ep-phone" type="text" value="' + esc(p.phone) + '">' +
    '<label>رقم اللوحة</label>' +
    '<input id="ep-plate" type="text" value="' + esc(p.plate || '') + '">' +
    '</div>' +
    '<div class="rv-foot">' +
    '<button class="btn-primary rv-save" onclick="saveProvider(this,' + id + ')">حفظ التعديل</button>' +
    '</div>' +
    '</div>';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

function saveProvider(btn, id) {
  const overlay = btn.closest('.doc-lightbox');
  const name = overlay.querySelector('#ep-name').value.trim();
  const phone = overlay.querySelector('#ep-phone').value.trim();
  const plate = overlay.querySelector('#ep-plate').value.trim();
  if (!name || !phone) return toast('الاسم والهاتف مطلوبان', true);
  btn.disabled = true;
  api('/providers/' + id + '/update', {
    method: 'POST',
    body: JSON.stringify({ name, phone, plate }),
  })
    .then(() => {
      toast('تم حفظ التعديل');
      overlay.remove();
      loadProviders();
    })
    .catch((err) => { btn.disabled = false; toast(err.message, true); });
}

function deleteProvider(id) {
  const p = providersState.find((x) => x.id === id);
  if (!p) return;
  askConfirm(
    'حذف صاحب التوصيل',
    'هل تريد حذف "' + esc(p.name) + '" نهائياً؟<br>سيفقد حسابه وصلاحياته ولن يستطيع الدخول.',
    () => {
      api('/providers/' + id + '/delete', { method: 'POST', body: '{}' })
        .then(() => {
          toast('تم حذف صاحب التوصيل');
          loadProviders();
          loadDashboard();
        })
        .catch((err) => toast(err.message, true));
    },
    { danger: true, confirm: 'حذف نهائي' }
  );
}

async function toggleProvider(id, action) {
  try {
    await api('/providers/' + id + '/' + action, { method: 'POST', body: '{}' });
    toast('تم التحديث');
    loadProviders();
    loadDashboard();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------- Customers ---------- */

async function loadCustomers() {
  const rows = await api('/customers');
  const body = $('#customers-body');
  if (!rows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">لا يوجد زبائن</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((c) =>
      '<tr>' +
      '<td>' + c.id + '</td>' +
      '<td><strong>' + esc(c.name) + '</strong>' +
      (c.blocked ? ' <span class="badge rejected">محظور</span>' : (c.is_active === 0 ? ' <span class="badge inactive">موقوف</span>' : '')) +
      '</td>' +
      '<td>' + esc(c.phone) + '</td>' +
      '<td>' + fmtDateShort(c.joined_at) + '</td>' +
      '<td>' + c.orders_count + '</td>' +
      '<td><div class="row-actions">' +
      '<button class="btn-sm blue" onclick="editCustomer(' + c.id + ')">تعديل</button>' +
      '<button class="btn-sm ' + (c.is_active ? 'no' : 'ok') + '" onclick="toggleCustomer(' + c.id + ',\'toggle-active\')">' + (c.is_active ? 'تعطيل' : 'تفعيل') + '</button>' +
      '<button class="btn-sm ' + (c.blocked ? 'ok' : 'no') + '" onclick="toggleCustomer(' + c.id + ',\'toggle-block\')">' + (c.blocked ? 'رفع الحظر' : 'حظر') + '</button>' +
      '<button class="btn-sm no" onclick="deleteCustomer(' + c.id + ')">حذف</button>' +
      '</div></td>' +
      '</tr>'
    )
    .join('');
}

let customersState = [];

async function reloadCustomersState() {
  customersState = await api('/customers');
}

function editCustomer(id) {
  reloadCustomersState().then(() => {
    const c = customersState.find((x) => x.id === id);
    if (!c) return;
    const overlay = openModal({
      title: 'تعديل بيانات الزبون: ' + esc(c.name),
      body:
        '<label class="modal-label">الاسم الكامل</label>' +
        '<input id="ec-name" class="modal-input" type="text" value="' + esc(c.name) + '">' +
        '<label class="modal-label">رقم الهاتف</label>' +
        '<input id="ec-phone" class="modal-input" type="text" value="' + esc(c.phone) + '">',
      foot:
        '<button class="modal-btn ghost" data-close>إلغاء</button>' +
        '<button class="modal-btn ok" data-submit>حفظ التعديل</button>',
    });
    const save = () => {
      const name = overlay.querySelector('#ec-name').value.trim();
      const phone = overlay.querySelector('#ec-phone').value.trim();
      if (!name || !phone) return toast('الاسم والهاتف مطلوبان', true);
      overlay.remove();
      api('/customers/' + id + '/update', { method: 'POST', body: JSON.stringify({ name, phone }) })
        .then(() => { toast('تم حفظ التعديل'); loadCustomers(); })
        .catch((err) => toast(err.message, true));
    };
    overlay.querySelector('[data-submit]').addEventListener('click', save);
    overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
  });
}

function toggleCustomer(id, action) {
  api('/customers/' + id + '/' + action, { method: 'POST', body: '{}' })
    .then(() => {
      toast('تم التحديث');
      loadCustomers();
    })
    .catch((err) => toast(err.message, true));
}

function deleteCustomer(id) {
  reloadCustomersState().then(() => {
    const c = customersState.find((x) => x.id === id);
    if (!c) return;
    askConfirm(
      'حذف الزبون',
      'هل تريد حذف "' + esc(c.name) + '" نهائياً؟<br>سيفقد حسابه ولن يستطيع الدخول.',
      () => {
        api('/customers/' + id + '/delete', { method: 'POST', body: '{}' })
          .then(() => {
            toast('تم حذف الزبون');
            loadCustomers();
            loadDashboard();
          })
          .catch((err) => toast(err.message, true));
      },
      { danger: true, confirm: 'حذف نهائي' }
    );
  });
}

/* ---------- Activity ---------- */

async function loadActivity() {
  const rows = await api('/activity');
  const el = $('#activity-full');
  el.innerHTML =
    rows
      .map(
        (a) =>
          '<li>' + esc(a.action) + (a.target ? ' — <strong>' + esc(a.target) + '</strong>' : '') +
          '<span class="act-time">' + fmtDate(a.created_at) + '</span></li>'
      )
      .join('') || '<li>لا يوجد نشاط بعد</li>';
}

/* ---------- Settings ---------- */

async function loadSubSettings() {
  try {
    const s = await api('/settings');
    $('#set-fee').value = s.subscription_fee;
    $('#set-phone').value = s.payment_phone;
    $('#set-note').value = s.payment_note || '';
  } catch (err) {
    toast(err.message, true);
  }
}

$('#subsettings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#subsettings-msg');
  try {
    const s = await api('/settings', {
      method: 'POST',
      body: JSON.stringify({ subscription_fee: Number($('#set-fee').value), payment_phone: $('#set-phone').value.trim(), payment_note: $('#set-note').value.trim() }),
    });
    msg.textContent = 'تم حفظ الإعدادات';
    msg.className = 'msg-text';
    msg.classList.remove('hidden');
    msg.style.color = 'var(--primary)';
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = 'var(--danger)';
    msg.classList.remove('hidden');
  }
});

$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#pw-msg');
  try {
    await api('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ current: $('#pw-current').value, next: $('#pw-next').value }),
    });
    msg.textContent = 'تم تغيير كلمة المرور بنجاح';
    msg.className = 'msg-text';
    msg.classList.remove('hidden');
    msg.style.color = 'var(--primary)';
    e.target.reset();
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = 'var(--danger)';
    msg.classList.remove('hidden');
  }
});

/* ---------- Events ---------- */

document.querySelectorAll('.nav-item').forEach((btn) =>
  btn.addEventListener('click', () => {
    switchView(btn.dataset.view);
    loadView(btn.dataset.view);
  })
);

$('#refresh-btn').addEventListener('click', () => {
  const active = document.querySelector('.nav-item.active');
  refreshView(active ? active.dataset.view : 'dashboard');
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-reload]');
  if (btn) refreshView(btn.dataset.reload);
});

function clearEventBadge() {
  const b = $('#event-badge');
  if (b) { b.classList.add('hidden'); b.textContent = '0'; }
}

function refreshView(name) {
  const btn = document.querySelector('[data-reload="' + name + '"]') || $('#refresh-btn');
  clearEventBadge();
  if (btn) btn.classList.add('busy');
  loadView(name)
    .catch(() => {})
    .finally(() => { if (btn) btn.classList.remove('busy'); });
}

$('#sound-toggle').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  ensureAudio();
  $('#sound-toggle').textContent = soundEnabled ? 'النغمات: على' : 'النغمات: إيقاف';
  if (soundEnabled) beep(880, 0, 0.1, 0.15);
});

$('#logout-btn').addEventListener('click', () => {
  api('/auth/logout', { method: 'POST' }).catch(() => {});
  logout();
});

$('#login-form').addEventListener('submit', handleLogin);

document.querySelectorAll('#requests-seg .seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#requests-seg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    requestsFilter = b.dataset.status;
    loadRequests();
  })
);

document.querySelectorAll('#orders-seg .seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#orders-seg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    ordersFilter = b.dataset.status;
    loadOrders();
  })
);

let searchT = null;
$('#orders-search').addEventListener('input', () => {
  clearTimeout(searchT);
  searchT = setTimeout(loadOrders, 350);
});

function startClock() {
  const update = () => {
    $('#clock').textContent = new Date().toLocaleString('ar-MA');
  };
  update();
  clearInterval(startClock._i);
  startClock._i = setInterval(update, 30000);
}

/* ---------- Boot ---------- */

async function boot() {
  if (TOKEN) {
    try {
      const res = await api('/auth/me');
      ADMIN = res.admin;
      enterApp();
      return;
    } catch {
      logout();
    }
  }
  $('#login-screen').classList.remove('hidden');
}

boot();
