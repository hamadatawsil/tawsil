'use strict';

const db = firebase.firestore();
const auth = firebase.auth();
let ADMIN = null;
let ordersState = [];
let providersState = [];
let customersState = [];
let driverReqState = [];
/* ---------- درجات المشرفين: من يلمس المال، ومن يقرأ فقط ---------- */

/*
 * **والدرجةُ حرسٌ في اللوحة لا قفلٌ في القاعدة:** قاعدةُ Firestore تملك
 * المشرفَ كلَّه بدرجةٍ واحدة — أيُّ مشرفٍ موقّعٍ يقدر أن يكتب. ولو ضيّقنا
 * القاعدةَ إلى «المالك وحده» لكان أسرعُ طريقٍ إلى بابٍ لا يُفتح: كلُّ حسابٍ
 * قديمٍ لا لفظَ «مالك» في مستنده، فلو طُلب اللفظُ من السحابة لأُغلق التعيينُ
 * ولا أحدَ يملك أن يفتحه. فالسلوكُ يُضبَط هنا، حيث يراه المشرفُ ويُصحّحه
 * ويسجّله، لا هناك حيث لا يُرى ولا يُراجَع.
 *
 * **وبلا مالكٍ لا حارس:** ما لم يكن في النظام مالكٌ بعدُ فاللوحةُ بغير
 * حارسٍ يحمي التعيين، وأولُ داخلٍ يعلن نفسَه مالكًا — مرةً واحدة، ثم ينحصر
 * كلُّ تعيينٍ وتبديلٍ في يده.
 */
const ROLE_LABELS = { owner: 'مالك النظام', admin: 'مشرف', viewer: 'مطالع' };

/** درجةٌ كما تُفهم: المجهولُ والقديمُ سواءٌ — مشرفٌ كاملُ اليد. */
function roleOf(a) {
  const r = a && typeof a.role === 'string' ? a.role.trim() : '';
  return r === 'owner' || r === 'viewer' ? r : 'admin';
}

function myRole() { return roleOf(ADMIN); }
function isOwner() { return myRole() === 'owner'; }
function canWrite() { return myRole() !== 'viewer'; }
function myUid() { return String((ADMIN && (ADMIN.uid || ADMIN.id)) || ''); }

/*
 * **خاناتُ بحثٍ للجداول، كلها من الذاكرة:** الجداولُ تُقرأ مرّة، فكلُّ حرفٍ
 * يكتبه المشرف لا يستحقُّ رحلةً إلى القاعدة. والتشكيلُ يُجرَّد منه الطرفان
 * لأنَّ الأسماءَ في الجدول تُكتب بأوجهٍ مختلفة والبحثَ بيد رجلٍ على لوحة
 * هاتف: من بحثَ عن «محمد» لا يُعقل أن يُخيبَه اسمٌ مكتوب «محمّد».
 */
const searchText = {};

const SEARCH_IGNORED = /[\u064B-\u065F\u0670\u0640\u200B-\u200F]/g;

function normSearch(s) {
  return String(s || '').replace(SEARCH_IGNORED, '').trim().toLowerCase();
}

/** `parts` حقولُ السطر تُقرأ منها جميعًا: اسمٌ أو رقمٌ أو معرّف. */
function searchHit(view, parts) {
  const q = normSearch(searchText[view]);
  if (!q) return true;
  return normSearch(Array.isArray(parts) ? parts.join(' ') : parts).indexOf(q) >= 0;
}

function bindSearch(domId, view, rerender) {
  const el = document.getElementById(domId);
  if (!el) return;
  let t = null;
  el.addEventListener('input', () => {
    searchText[view] = el.value;
    clearTimeout(t);
    t = setTimeout(rerender, 200);
  });
}

/**
 * البوابةُ الوحيدة للأفعال: تُسكت الفعلَ وتقول سببَه بصوتٍ واحد، فلا يبقى
 * زرٌّ يعمل لرجلٍ ولا يعمل لآخر بلا أن يُقال له.
 */
function needRight(right, what) {
  if (right === 'write' && !canWrite()) {
    toast('درجتُك للاطّلاع فقط: لا تعديلَ في شيءٍ من البيانات', true);
    return false;
  }
  if (right === 'owner' && !isOwner()) {
    toast('هذا للمالك وحده: ' + what, true);
    return false;
  }
  return true;
}

/*
 * **جدولٌ واحد بدل حارسٍ في كل دالة:** الأفعالُ تُنادى من نصوص `onclick`
 * فيصفها المُنادي من النافذة، فلفُّ الاسمِ الواحد يلفُّ كلَّ مواضع النداء
 * معه — وبهذا لا يُنسى بابٌ لأن البابَ ليس عادتَ كاتبٍ بل شيئًا يُقرأ من
 * قائمةٍ واحدة.
 */
const RIGHT_OF = {
  writeAccess: 'write',
  accessAction: 'write',
  offerTrialTo: 'write',
  grantTrialBatch: 'write',
  backfillAccess: 'write',
  eraseProviderPasswords: 'owner',
  finishRenewal: 'write',
  reviewRenewal: 'write',
  reviewDriverRequest: 'write',
  deleteDriverRequest: 'write',
  expelDriver: 'write',
  openDriverWarning: 'write',
  saveReviewDocs: 'write',
  reviewRequest: 'write',
  deleteRequest: 'write',
  deleteAllRequests: 'write',
  saveProvider: 'write',
  deleteProvider: 'write',
  addProvider: 'write',
  deleteCallRecord: 'write',
  deleteTrip: 'write',
  callTripDriver: 'write',
  callbackTarget: 'write',
  deleteActivityLine: 'write',
  clearActivity: 'owner',
  createAdmin: 'owner',
  grantTrialSelected: 'write',
  grantPaidSelected: 'write',
  stopSubscriptionSelected: 'write',
  freezeSelected: 'write',
  unfreezeSelected: 'write',
  blockCallsSelected: 'write',
  allowCallsSelected: 'write',
  deleteSelectedProviders: 'write',
  addOrder: 'write',
  editOrder: 'write',
  deleteOrder: 'write',
  assignOrder: 'write',
  changeOrderStatus: 'write',
  addArea: 'write',
  editArea: 'write',
  deleteArea: 'write',
  editCustomer: 'write',
  toggleCustomer: 'write',
  deleteCustomer: 'write',
  openNewCallModal: 'write',
  startAdminCall: 'write',
  hangupCall: 'write',
  suspendCall: 'write',
  approveAdminRequest: 'owner',
  declineAdminRequest: 'owner',
  removeAdmin: 'owner',
  setAdminRole: 'owner',
  resetAdminPassword: 'owner',
};

/** يلفُّ أسماءَ الجدول بحارس الدرجة — تُستدعى مرةً واحدة عند الإقلاع. */
function guardRights() {
  Object.keys(RIGHT_OF).forEach((name) => {
    const original = window[name];
    if (typeof original !== 'function') {
      console.warn('[rights] اسمٌ في الجدول بلا دالة:', name);
      return;
    }
    const right = RIGHT_OF[name];
    window[name] = function () {
      if (!needRight(right, name)) return undefined;
      return original.apply(null, arguments);
    };
  });
}

/** ما يراه الرأسُ والجنبُ من درجةٍ: لا زرٌّ لمالكٍ ولا شاشةُ مالٍ لمطالع. */
function applyRoleChrome() {
  const role = myRole();
  const roleEl = $('#user-role');
  if (roleEl) {
    roleEl.textContent = ROLE_LABELS[role] + (role === 'viewer' ? ' · للاطّلاع فقط' : '');
  }
  document.querySelectorAll('.nav-item').forEach((b) => {
    const v = b.dataset.view;
    const ownerOnly = v === 'settings' || v === 'admins';
    b.style.display = ownerOnly && !isOwner() ? 'none' : '';
  });
  // **وللمطالع تُسحب أدواتُ الجماعة:** زرٌّ يعرف سلفًا أنه سيُرفض عند
  // الضغط يعلّم الرجلَ أن اللوحة معطوبة، لا أن درجتَه هي كذلك.
  const bulk = document.getElementById('providers-bulk-bar');
  if (bulk) bulk.style.display = canWrite() ? '' : 'none';
  // **ونفسُ اليدِ تُطبقُ على ما وُسمَ في الصفحة:** الصيانةُ المكتوبةُ في
  // الصفحةِ تُعرَفُ بدرجتِها من وسْمِها لا من دالَّةٍ تنساها، فمن أضافَ
  // زرًّا جديدًا يكتفي بأن يقولَ لمن هو.
  document.querySelectorAll('[data-need]').forEach((b) => {
    const need = b.dataset && b.dataset.need;
    const allowed = need === 'owner' ? isOwner() : canWrite();
    b.style.display = allowed ? '' : 'none';
  });
}

/* ---------- إعدادات المكالمات: بروتوكول التطبيق نفسه ---------- */
const CALL_ADMIN_ID = 'admin';
const RING_TIMEOUT_MS = 60000;
const RUN_SHA = 'v20261026-3';

/// مستند الإشارة: الاسم نفسه الذي يقرؤه `call_service_inapp.dart` في الجوّال.
const SIGNAL_COLLECTION = 'call_signal';

/*
 * **STUN وحده، بلا خادم تحويل:** TURN يحتاج عقدًا مدفوعًا عند مزوّد خدمة،
 * فمن يبنِ مكالماته على «مجاني شركة» يبقِ هاتفه رهينة سعرها. هنا يتعارف
 * الجهازان على الشبكة العامة ويمشي الصوت بينهما مباشرة.
 */
const CALL_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

try { console.log('[app] built:', RUN_SHA, '| WebRTC:', (typeof RTCPeerConnection !== 'undefined' ? 'متاح' : 'غير متاح')); } catch (_) {}

const CALL_STATUS_LABELS = {
  ringing: 'يرن',
  ongoing: 'جارية',
  ended: 'منتهية',
  declined: 'مرفوضة',
  missed: 'فائتة',
};

/// أسباب الانتهاء: الكلمات نفسها التي يكتبها التطبيق في `endReason`.
const CALL_END_LABELS = {
  callee_no_answer: 'لم يردّ',
  caller_timeout: 'انتهى وقت الانتظار',
  callee_unavailable: 'غير متاح',
  caller_unavailable: 'تعذّر بدء الاتصال',
  admin_declined: 'رفضته الإدارة',
  admin_unavailable: 'الإدارة غير متاحة',
  admin_ended: 'أنهتها الإدارة',
  admin_suspended: 'موقوفة من الإدارة',
  admin_error: 'خطأ في جهة الإدارة',
};

let callsState = [];
let callsSub = null;
let ringToneTimer = null;
let activeRingCallId = null;
let callPeer = null;
let callMicTrack = null;
let callLocalStream = null;
let callSignalSub = null;
let callDocSub = null;
let activeCallId = null;
let callInProgress = false;
const handledRinging = new Set();

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
  if (a.includes('طلب توصيل جديد') || a.includes('إرسال طلب توصيل')) return 'order';
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

let lastActivityTs = null;
let pollTimer = null;

function startActivityPoller() {
  lastActivityTs = new Date();
  stopActivityPoller();
  pollTimer = setInterval(pollActivity, 8000);
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
    if (!lastActivityTs) return;
    const snap = await db.collection('activity_log')
      .where('created_at', '>', lastActivityTs)
      .orderBy('created_at', 'desc')
      .limit(20)
      .get();
    const fresh = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(a => a.admin_name !== ADMIN.full_name);
    if (fresh.length) {
      lastActivityTs = fresh[0].created_at ? fresh[0].created_at.toDate() : new Date();
      fresh.forEach((a) => playTone(toneKind(a.action)));
      const first = fresh[0];
      toast(fresh.length > 1 ? fresh.length + ' عمليات جديدة — ' + first.action : first.action + (first.target ? ': ' + first.target : ''));
      showAlertPopup(fresh);
    }
    refreshNavBadges();
    const badge = $('#event-badge');
    if (badge && fresh.length) {
      badge.textContent = fresh.length;
      badge.classList.remove('hidden');
      clearTimeout(badge._t);
      badge._t = setTimeout(() => badge.classList.add('hidden'), 8000);
    }
    if (document.querySelector('.doc-lightbox')) return;
    const active = document.querySelector('.nav-item.active');
    if (active && active.dataset.view !== 'settings') autoRefreshView(active.dataset.view);
  } catch {}
}

function showAlertPopup(fresh) {
  if (!fresh || !fresh.length) return;
  const important = fresh.find((a) =>
    a.action.includes('طلب توصيل جديد') ||
    a.action.includes('طلب اشتراك جديد') ||
    a.action.includes('إعادة رفع أوراق') ||
    a.action.includes('حظر') ||
    a.action.includes('حذف')
  );
  if (!important) return;
  const alert = document.createElement('div');
  alert.className = 'alert-popup';
  const isDanger = important.action.includes('حظر') || important.action.includes('حذف');
  alert.innerHTML =
    '<div class="alert-popup-head"><span class="alert-dot"></span>تنبيه جديد</div>' +
    '<div class="alert-message">' + esc(important.action) + (important.target ? ': ' + esc(important.target) : '') + '</div>' +
    '<div class="alert-popup-foot"><button class="btn-sm ' + (isDanger ? 'no' : 'ok') + '" data-alert-view>عرض</button>' +
    '<button class="btn-sm" data-alert-close>إغلاق</button></div>';
  document.body.appendChild(alert);
  const clear = () => alert.classList.add('hide');
  alert.querySelector('[data-alert-close]').addEventListener('click', clear);
  alert.querySelector('[data-alert-view]').addEventListener('click', () => {
    const view = important.action.includes('طلب اشتراك') || important.action.includes('إعادة رفع')
      ? 'requests'
      : important.action.includes('طلب توصيل') ? 'orders' : 'activity';
    switchView(view);
    loadView(view);
    clear();
  });
  setTimeout(clear, 9000);
}

async function refreshNavBadges() {
  try {
    const pendingRef = db.collection('subscription_requests').where('status', '==', 'pending');
    const resubRef = db.collection('subscription_requests').where('status', '==', 'needs_resubmission');
    const newOrdersRef = db.collection('orders').where('status', '==', 'new');
    const pendingDriversRef = db.collection('driver_applications').where('status', '==', 'pending');
    const pendingRenewalsRef = db.collection(RENEWAL_COLLECTION).where('status', '==', 'pending');
    const [pending, resub, newOrders, pendingDrivers, pendingRenewals] = await Promise.all([
      pendingRef.count().get(),
      resubRef.count().get(),
      newOrdersRef.count().get(),
      pendingDriversRef.count().get(),
      // **والخامسة لا تُسقط الأربع:** مُنعت اللوحة قراءةَ التجديدات —
      // لأن القاعدة لم تُنشر بعد مثلاً — فبقية الشارات تُحسب. فلها
      // جوابٌ صامتٌ خاص بها، لا `Promise.all` يرمي بالكل.
      pendingRenewalsRef.count().get().catch(() => null),
    ]);
    setNavBadge('requests', pending.data().count + resub.data().count);
    setNavBadge('orders', newOrders.data().count);
    // **شارة السائقين مستقلّة لا مدمجة مع شارة الاشتراك:** هما قائمتان
    // مختلفتان بمراجعة مختلفة. ودمجهما يجعل عدّاداً يخفي تحته طلبات
    // تسجيل سائقين لا يعرف المشرف أنّها وصلت أصلاً.
    setNavBadge('driverRequests', pendingDrivers.data().count);
    // **وشيكة التجديدات رابعة:** مالٌ وصل ولا قرارٍ كُتب بعد، وصاحبُه
    // دفع وينتظر — فهي أوّل ما يجب أن يرى المشرف عند فتح اللوحة.
    const renewalsCount = pendingRenewals ? pendingRenewals.data().count : 0;
    setNavBadge('renewals', renewalsCount);
    setSegCount('requests-pending', pending.data().count);
    setSegCount('orders-new', newOrders.data().count);
    setSegCount('driverreq-pending', pendingDrivers.data().count);
    setSegCount('renewals-pending', renewalsCount);
  } catch {}
}

function setSegCount(key, count) {
  const el = document.querySelector('[data-count="' + key + '"]');
  if (!el) return;
  if (!count) { el.classList.add('hidden'); return; }
  el.textContent = count;
  el.classList.remove('hidden');
}

function setNavBadge(view, count) {
  const el = document.querySelector('[data-badge="' + view + '"]');
  if (!el) return;
  if (!count) { el.classList.add('hidden'); return; }
  el.textContent = count;
  el.classList.remove('hidden');
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('ar-MA') + ' أوقية';
}

function fmtDate(val) {
  if (!val) return '—';
  const d = val.toDate ? val.toDate() : new Date(val);
  return d.toLocaleDateString('ar-MA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtDateShort(val) {
  if (!val) return '—';
  const d = val.toDate ? val.toDate() : new Date(val);
  return d.toLocaleDateString('ar-MA');
}

async function logActivity(action, target) {
  try {
    await db.collection('activity_log').add({
      admin_name: ADMIN.full_name,
      action,
      target: target || '',
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch {}
}

/* ---------- المكالمات: بروتوكول التطبيق نفسه (WebRTC بلا وسيط) ---------- */

/*
 * **لا SDK ولا مفاتيح شركة:** الجوّال والمتصفّح يتصافحان مباشرة بـ
 * `RTCPeerConnection` الأصلي، والإشارة (العرض والجواب وعناوين ICE) تمرّ في
 * `call_signal/{callId}` كما في `call_service_inapp.dart` حرفيًّا: المتصل
 * يكتب `offer` و`iceCaller`، والمتّصل به يكتب `answer` و`iceCallee`، وكل
 * طرف يلمس صندوقه وحده بكتابة مدموجة فلا يمحوا ما كتبه الآخر.
 *
 * **والقائمتان متطابقتان عمدًا:** أي تغيير في اسم حقل هنا يجب أن يقابله
 * هناك في اللحظة نفسها، وإلا صارت المكالمة تُفتح ولا تُغلق.
 */

function callRoleLabel(role) {
  const map = { guest: 'زائر', customer: 'زبون', driver: 'صاحب توصيل', owner: 'صاحب توصيل', admin: 'الإدارة' };
  return map[role] || role || '—';
}

/* ---------- نغمة الرنين ---------- */

const BUILD_CACHE = '20260908-4';
let ringBuffer = null;
let ringSource = null;
let ringBufferLoading = null;

function loadRingBuffer() {
  if (ringBuffer || ringBufferLoading) return ringBufferLoading;
  ringBufferLoading = fetch('ringtone.wav?v=' + BUILD_CACHE)
    .then((r) => r.arrayBuffer())
    .then((ab) => audioCtx.decodeAudioData(ab))
    .then((buf) => { ringBuffer = buf; return buf; })
    .catch((err) => {
      console.error('[ringtone] load failed', err);
      ringBuffer = null;
    });
  return ringBufferLoading;
}

function startRingTone() {
  stopRingTone();
  if (!soundEnabled) return;
  ensureAudio();
  if (!audioCtx) return;
  const play = () => {
    if (!ringBuffer || !audioCtx || ringSource) return;
    const src = audioCtx.createBufferSource();
    src.buffer = ringBuffer;
    src.loop = true;
    src.connect(audioCtx.destination);
    src.start();
    ringSource = src;
  };
  if (ringBuffer) play();
  else loadRingBuffer().then(() => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); play(); });
}

function stopRingTone() {
  if (ringToneTimer) { clearInterval(ringToneTimer); ringToneTimer = null; }
  if (ringSource) {
    try { ringSource.stop(); } catch (_) {}
    try { ringSource.disconnect(); } catch (_) {}
    ringSource = null;
  }
}

/* ---------- مستند المكالمة ---------- */

async function endCallDoc(callId, status, reason) {
  const patch = { status, endedAt: firebase.firestore.FieldValue.serverTimestamp() };
  if (reason) patch.endReason = reason;
  try { await db.collection('calls').doc(callId).update(patch); } catch (_) {}
}

/// «جارية» لا تُكتب إلا حين يمشي الصوت فعلًا، فلا يُحسب زمنٌ لم يتكلّم فيه أحد.
async function markCallOngoing(callId) {
  try {
    await db.collection('calls').doc(callId).update({
      status: 'ongoing',
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (_) {}
}

/// صندوق الرنين يُمسح بيد من يقرّره: لو بقي صار صاحِب الرقم يرنّ على مكالمة ماتت.
async function clearRingBox(phone) {
  if (!phone) return;
  try { await db.collection('call_rings').doc(phone).delete(); } catch (_) {}
}

/* ---------- آلة الصوت ---------- */

let seenRemoteCands = new Set();
let sentLocalCands = new Set();
let callRemoteAudio = null;
let callOngoingMarked = false;

function callMicFailure(err) {
  const name = (err && err.name) || '';
  if (/NotAllowed|Permission|denied|Security/i.test(name)) {
    return 'ممنوع الوصول إلى الميكروفون: اسمح بالميكروفون في المتصفح ثم أعد المحاولة.';
  }
  if (/NotFound|Devices/i.test(name)) return 'لا ميكروفون في هذا الجهاز.';
  return String((err && err.message) || err || 'خطأ غير معروف');
}

async function attachLocalMic(pc) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  callLocalStream = stream;
  const tracks = stream.getAudioTracks();
  callMicTrack = tracks.length ? tracks[0] : null;
  tracks.forEach((t) => pc.addTrack(t, stream));
}

function bindRemoteAudio(pc) {
  pc.ontrack = (e) => {
    const stream = e.streams && e.streams[0];
    if (!stream) return;
    if (!callRemoteAudio) {
      callRemoteAudio = document.createElement('audio');
      callRemoteAudio.autoplay = true;
      document.body.appendChild(callRemoteAudio);
    }
    callRemoteAudio.srcObject = stream;
    callRemoteAudio.play().catch(() => {});
  };
}

/// الكتابة مدموجة دائمًا: الحقل الذي لم يُذكر يبقى كما هو عند الطرف الآخر.
function writeSignal(callId, fields) {
  const patch = Object.assign(
    { callId: callId, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
    fields,
  );
  return db.collection(SIGNAL_COLLECTION).doc(callId).set(patch, { merge: true });
}

function publishCandidates(pc, callId, isCaller) {
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    const box = isCaller ? 'iceCaller' : 'iceCallee';
    const encoded = JSON.stringify({
      candidate: e.candidate.candidate,
      sdpMid: e.candidate.sdpMid,
      sdpMLineIndex: e.candidate.sdpMLineIndex,
    });
    if (sentLocalCands.has(encoded)) return;
    sentLocalCands.add(encoded);
    const payload = {};
    payload[box] = firebase.firestore.FieldValue.arrayUnion(encoded);
    writeSignal(callId, payload).catch(() => {});
  };
}

async function addRemoteCandidates(pc, raw) {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (typeof item !== 'string' || seenRemoteCands.has(item)) continue;
    seenRemoteCands.add(item);
    try {
      const json = JSON.parse(item);
      await pc.addCandidate({
        candidate: json.candidate,
        sdpMid: json.sdpMid,
        sdpMLineIndex: json.sdpMLineIndex,
      });
    } catch (_) {
      /// مرشّحٌ سبق العرض: يُعاد قراءته مع التحديث التالي للمستند.
      seenRemoteCands.delete(item);
    }
  }
}

/**
 * يراقب مستند الإشارة. `isCaller` تحدد الصندوق الذي يُقرأ والآخر الذي يُكتب:
 * المتصل ينتظر `answer` و`iceCallee`، والمتّصل به ينتظر `offer` و`iceCaller`
 * ثم يردّ بجوابه من فوره.
 */
function watchSignal(callId, isCaller, pc) {
  if (callSignalSub) { callSignalSub(); callSignalSub = null; }
  let offerApplied = false;
  let answerApplied = false;
  callSignalSub = db.collection(SIGNAL_COLLECTION).doc(callId).onSnapshot(async (snap) => {
    if (!snap.exists || !callPeer) return;
    const data = snap.data() || {};
    try {
      if (isCaller) {
        const answer = data.answer;
        if (answer && answer.sdp && !answerApplied) {
          answerApplied = true;
          await pc.setRemoteDescription({ type: answer.type || 'answer', sdp: answer.sdp });
        }
        await addRemoteCandidates(pc, data.iceCallee);
      } else {
        const offer = data.offer;
        if (offer && offer.sdp && !offerApplied) {
          offerApplied = true;
          await pc.setRemoteDescription({ type: offer.type || 'offer', sdp: offer.sdp });
          const local = await pc.createAnswer();
          await pc.setLocalDescription(local);
          await writeSignal(callId, { answer: { type: local.type || 'answer', sdp: local.sdp } });
        }
        await addRemoteCandidates(pc, data.iceCaller);
      }
    } catch (err) {
      console.error('[calls] signal error', err);
    }
  }, (err) => console.error('[calls] signal listener error', err));
}

/// حالة الصوت تُقرأ من الوصلة نفسها، فلا رسالة «متصل» قبل أن يمشي الصوت.
function trackConnection(pc, callId) {
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') {
      setCallStatusText('الصوت متصل');
      if (!callOngoingMarked) {
        callOngoingMarked = true;
        markCallOngoing(callId);
      }
    } else if (st === 'failed') {
      setCallStatusText('تعذّر ربط الصوت — جرّب شبكة أخرى');
    } else if (st === 'disconnected') {
      setCallStatusText('انقطعت الوصلة');
    }
  };
}

function setCallStatusText(text) {
  const el = document.getElementById('call-state');
  if (el) el.textContent = text;
}

/**
 * الطرف الآخر يُغلق المكالمة على جواله أو يوقفها المشرف من هنا: الشاشة
 * تُغلق وحدها لأن حالة المستند تُقرأ، لا لأن أحدًا أرسل رسالة إغلاق.
 */
function watchCallEnd(callId) {
  if (callDocSub) { callDocSub(); callDocSub = null; }
  callDocSub = db.collection('calls').doc(callId).onSnapshot((snap) => {
    if (!snap.exists) return;
    const status = (snap.data() || {}).status;
    if (status !== 'ended' && status !== 'declined' && status !== 'missed') return;
    if (activeCallId !== callId) return;
    clearActiveCallTicker();
    closeActiveCallOverlay();
    teardownCall();
    toast('انتهت المكالمة.');
  }, (err) => console.error('[calls] doc listener error', err));
}

function teardownCall() {
  if (callSignalSub) { callSignalSub(); callSignalSub = null; }
  if (callDocSub) { callDocSub(); callDocSub = null; }
  try { if (callPeer) callPeer.close(); } catch (_) {}
  callPeer = null;
  try { if (callLocalStream) callLocalStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  callLocalStream = null;
  callMicTrack = null;
  if (callRemoteAudio) {
    try { callRemoteAudio.pause(); callRemoteAudio.srcObject = null; callRemoteAudio.remove(); } catch (_) {}
    callRemoteAudio = null;
  }
  seenRemoteCands = new Set();
  sentLocalCands = new Set();
  callOngoingMarked = false;
  activeCallId = null;
  callInProgress = false;
}

/* ---------- الردّ على وارد ---------- */

async function answerIncomingCall(data) {
  const callId = data.id;
  try {
    callInProgress = true;
    const pc = new RTCPeerConnection({ iceServers: CALL_ICE_SERVERS });
    callPeer = pc;
    bindRemoteAudio(pc);
    await attachLocalMic(pc);
    publishCandidates(pc, callId, false);
    trackConnection(pc, callId);
    watchSignal(callId, false, pc);
    await clearRingBox(data.calleePhone || CALL_ADMIN_ID);
    showActiveCall({ peerName: data.callerName || data.callerId, callId: callId });
  } catch (err) {
    console.error('[calls] answer error', err);
    teardownCall();
    await endCallDoc(callId, 'missed', 'admin_error');
    toast('تعذر الرد على المكالمة: ' + callMicFailure(err), true);
  }
}

/* ---------- اتصال صادر من الإدارة ---------- */

async function startAdminCall(calleePhone, calleeName, calleeRole) {
  if (callInProgress) { toast('هناك مكالمة جارية: أنهاها أولًا.', true); return; }
  if (!calleePhone || !/^[0-9]{8,12}$/.test(calleePhone)) { toast('رقم غير صالح: من 8 إلى 12 رقمًا بلا رموز.', true); return; }
  if (typeof RTCPeerConnection === 'undefined') { toast('متصفّحك لا يدعم WebRTC — جرّب Chrome أو Edge.', true); return; }
  const callerName = (ADMIN && (ADMIN.full_name || ADMIN.username)) || 'الإدارة';
  let callId = null;
  try {
    callInProgress = true;
    const ref = db.collection('calls').doc();
    callId = ref.id;
    await ref.set({
      channelName: 'call_' + callId,
      callerId: CALL_ADMIN_ID,
      callerName: callerName,
      callerRole: 'admin',
      callerPhone: CALL_ADMIN_ID,
      calleeId: calleePhone,
      calleeName: calleeName || calleePhone,
      calleeRole: calleeRole,
      calleePhone: calleePhone,
      participants: [CALL_ADMIN_ID, calleePhone],
      status: 'ringing',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection('call_rings').doc(calleePhone).set({
      callId: callId,
      channelName: 'call_' + callId,
      callerId: CALL_ADMIN_ID,
      callerName: callerName,
      callerRole: 'admin',
      status: 'ringing',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    const pc = new RTCPeerConnection({ iceServers: CALL_ICE_SERVERS });
    callPeer = pc;
    bindRemoteAudio(pc);
    await attachLocalMic(pc);
    publishCandidates(pc, callId, true);
    trackConnection(pc, callId);
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await writeSignal(callId, { offer: { type: offer.type, sdp: offer.sdp } });
    watchSignal(callId, true, pc);
    watchCallEnd(callId);

    await logActivity('اتصال بالمستخدم ' + calleePhone, 'users/' + calleePhone);
    handledRinging.add(callId);
    showActiveCall({ peerName: calleeName || calleePhone, callId: callId, outgoing: true });
  } catch (err) {
    console.error('[calls] start error', err);
    teardownCall();
    if (callId) {
      await endCallDoc(callId, 'missed', 'caller_unavailable');
      await clearRingBox(calleePhone);
    }
    toast('تعذّر بدء الاتصال: ' + callMicFailure(err), true);
  }
}

/* ---------- الشاشات ---------- */

function showIncomingCall(data) {
  if (callInProgress || activeRingCallId) return;
  activeRingCallId = data.id;
  const name = data.callerName || data.callerId || 'مستعمل';
  const overlay = openModal({
    title: 'مكالمة واردة إلى الإدارة',
    body:
      '<div class="incoming-call-avatar">☎</div>' +
      '<div class="incoming-call-name">' + esc(name) + '</div>' +
      '<div class="incoming-call-role">' + esc(callRoleLabel(data.callerRole)) + '</div>' +
      '<div class="call-status-ring">يرن الآن...</div>' +
      '<div id="incoming-mic-hint" class="incoming-mic-hint"></div>',
    foot:
      '<button class="modal-btn no" data-decline>رفض</button>' +
      '<button class="modal-btn ok" data-answer>قبول</button>',
  });
  const titleClose = overlay.querySelector('.doc-lightbox-head .btn-sm');
  if (titleClose) titleClose.style.display = 'none';
  const micHint = overlay.querySelector('#incoming-mic-hint');
  if (micHint && navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'microphone' }).then((st) => {
      if (st.state === 'denied') {
        micHint.textContent = 'إذن الميكروفون مرفوض لهذا الموقع: افتح القفل قرب العنوان وفعّل «الميكروفون: السماح»، ثم أعد تحميل الصفحة.';
      } else if (st.state === 'prompt') {
        micHint.textContent = 'سيطلب المتصفح إذن الميكروفون عند القبول — اضغط «السماح».';
      }
    }).catch(() => {});
  }
  startRingTone();

  const close = () => {
    overlay.remove();
    stopRingTone();
    activeRingCallId = null;
  };

  overlay.querySelector('[data-answer]').addEventListener('click', async () => {
    clearTimeout(close._t);
    close();
    await answerIncomingCall(data);
  });
  overlay.querySelector('[data-decline]').addEventListener('click', async () => {
    clearTimeout(close._t);
    await endCallDoc(data.id, 'declined', 'admin_declined');
    await clearRingBox(data.calleePhone || CALL_ADMIN_ID);
    handledRinging.add(data.id);
    close();
  });
  close._t = setTimeout(async () => {
    await endCallDoc(data.id, 'missed', 'callee_no_answer');
    await clearRingBox(data.calleePhone || CALL_ADMIN_ID);
    handledRinging.add(data.id);
    close();
  }, RING_TIMEOUT_MS);
}

let activeCallTicker = null;
function clearActiveCallTicker() {
  if (activeCallTicker) { clearInterval(activeCallTicker); activeCallTicker = null; }
}
function closeActiveCallOverlay() {
  const overlay = document.querySelector('.call-active-overlay');
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
}

function showActiveCall(data) {
  const outgoing = !!data.outgoing;
  activeCallId = data.callId;
  const overlay = openModal({
    title: outgoing ? 'اتصال صادر من الإدارة' : 'مكالمة جارية',
    body:
      '<div class="incoming-call-avatar">☎</div>' +
      '<div class="incoming-call-name">' + esc(data.peerName || '') + '</div>' +
      '<div class="call-status-ring" id="call-state">' + (outgoing ? 'جارٍ الرنين...' : 'لم يأتِ الصوت بعد') + '</div>' +
      '<div class="call-status-ring" id="call-timer">00:00</div>',
    foot:
      '<button class="modal-btn ghost" data-mute>كتم</button>' +
      '<button class="modal-btn no" data-hangup>إنهاء</button>',
  });
  overlay.classList.add('call-active-overlay');
  const titleClose = overlay.querySelector('.doc-lightbox-head .btn-sm');
  if (titleClose) titleClose.style.display = 'none';
  watchCallEnd(data.callId);

  const t0 = Date.now();
  clearActiveCallTicker();
  activeCallTicker = setInterval(() => {
    const el = overlay.querySelector('#call-timer');
    if (!el) return;
    const s = Math.floor((Date.now() - t0) / 1000);
    el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 1000);

  let muted = false;
  const muteBtn = overlay.querySelector('[data-mute]');
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? 'التحدث' : 'كتم';
    try { if (callMicTrack) callMicTrack.enabled = !muted; } catch (_) {}
  });
  overlay.querySelector('[data-hangup]').addEventListener('click', async () => {
    await hangupCall(data.callId);
  });
}

async function hangupCall(callId) {
  await endCallDoc(callId, 'ended', 'admin_ended');
  await logActivity('أنهى مكالمة ' + callId, 'calls/' + callId);
  clearActiveCallTicker();
  closeActiveCallOverlay();
  teardownCall();
}

/// إيقاف مكالمة جارية من بعيد: الجوّال يقرأ `admin_suspended` ويغلق بشاشته الخاصة.
function suspendCall(callId, label) {
  askConfirm(
    'إيقاف المكالمة',
    'سيُغلق الاتصال فورًا على جهاز «' + esc(label || callId) + '» ويُسجَّل السبب في سجلّ النشاط.',
    async () => {
      await endCallDoc(callId, 'ended', 'admin_suspended');
      await logActivity('أوقف مكالمة ' + (label || callId), 'calls/' + callId);
      if (activeCallId === callId) {
        clearActiveCallTicker();
        closeActiveCallOverlay();
        teardownCall();
      }
      toast('أُوقفت المكالمة.');
    },
    { danger: true, confirm: 'إيقاف' },
  );
}

/* ---------- جدول المكالمات ---------- */

let callsFilter = '';

function setCallsFilter(value) {
  callsFilter = value;
  renderCallsTable();
}

function callDuration(c) {
  if (!c.startedAt) return '—';
  const start = c.startedAt.toDate ? c.startedAt.toDate() : new Date(c.startedAt);
  let end = null;
  if (c.endedAt) end = c.endedAt.toDate ? c.endedAt.toDate() : new Date(c.endedAt);
  else if (c.status === 'ongoing') end = new Date();
  if (!end) return '—';
  const diff = Math.max(0, Math.round((end - start) / 1000));
  return String(Math.floor(diff / 60)).padStart(2, '0') + ':' + String(diff % 60).padStart(2, '0');
}

function renderCallsTable() {
  const tbody = $('#calls-body');
  if (!tbody) return;
  const buildEl = document.getElementById('calls-build-tag');
  if (buildEl) {
    buildEl.textContent = 'البناء: ' + RUN_SHA +
      ' | WebRTC: ' + (typeof RTCPeerConnection !== 'undefined' ? 'متاح' : 'غير متاح') +
      ' | الإشارة: ' + SIGNAL_COLLECTION;
  }
  let rows = !callsFilter
    ? callsState
    : callsState.filter((c) => c.status === callsFilter);
  rows = rows.filter((c) =>
    searchHit('calls', [c.callerName, c.callerPhone, c.calleeName, c.calleePhone, c.id])
  );
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">' +
      (callsState.length ? 'لا نتيجة لهذا البحث' : 'لا توجد مكالمات بعد') + '</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  rows.forEach((c, i) => {
    const caller = esc(c.callerName || c.callerId || '—') +
      (c.callerPhone && c.callerPhone !== c.callerName
        ? '<div style="font-size:11px;color:var(--gray);direction:ltr">' + esc(c.callerPhone) + '</div>' : '');
    const callee = esc(c.calleeName || c.calleeId || '—') +
      (c.calleePhone && c.calleePhone !== c.calleeName
        ? '<div style="font-size:11px;color:var(--gray);direction:ltr">' + esc(c.calleePhone) + '</div>' : '');
    const reason = c.endReason ? (CALL_END_LABELS[c.endReason] || c.endReason) : '';
    const statusCell = esc(CALL_STATUS_LABELS[c.status] || c.status || '—') +
      (reason ? '<div style="font-size:11px;color:var(--gray)" title="' + esc(c.endReason) + '">' + esc(reason) + '</div>' : '');
    const live = c.status === 'ongoing' || c.status === 'ringing';
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (i + 1) + '</td>' +
      '<td><strong>' + esc(callRoleLabel(c.callerRole)) + '</strong><div>' + caller + '</div></td>' +
      '<td>' + callee + '</td>' +
      '<td>' + esc(c.createdAt ? fmtDate(c.createdAt) : '—') + '</td>' +
      '<td>' + statusCell + '</td>' +
      '<td style="direction:ltr">' + callDuration(c) + '</td>' +
      '<td>' + esc(c.channelName ? c.channelName.substring(0, 10) : '—') + '</td>' +
      '<td><div class="row-actions">' +
      (live
        ? '<button class="btn-sm no" onclick="suspendCall(\'' + esc(c.id) + '\',\'' +
          esc(c.calleeName || c.calleePhone || c.callerName || c.id) + '\')">إيقاف</button>'
        : '') +
      (c.status === 'missed' || c.status === 'declined'
        ? '<button class="btn-sm ok" onclick="callbackTarget(\'' + esc(c.id) + '\')">إعادة الاتصال</button>'
        : '') +
      (!live && canWrite()
        ? '<button class="btn-sm no" onclick="deleteCallRecord(\'' + esc(c.id) + '\')">حذف</button>'
        : '') +
      '</div></td>';
    tbody.appendChild(tr);
  });
}

/// من السجلّ إلى الطلب مباشرة: يعيد فتح نافذة الاتصال برقم الطرف الذي كلّمنا.
function callbackTarget(callId) {
  const c = callsState.find((x) => x.id === callId);
  if (!c) return;
  const isIncoming = c.calleeId === CALL_ADMIN_ID;
  const phone = isIncoming ? (c.callerPhone || c.callerId) : (c.calleePhone || c.calleeId);
  const name = isIncoming ? c.callerName : c.calleeName;
  const role = isIncoming ? c.callerRole : c.calleeRole;
  openNewCallModal({ phone: phone, name: name, role: role });
}

/*
 * **والحذفُ للمنتهي وحده:** المكالمةُ الحيّةُ تُوقَف ولا تُمحى — الفرقُ أن
 * الإيقافَ قرارٌ يراه الرجلُ وهو في الخط، والحذفَ ورقةٌ تُشَقّ من بعده.
 * فتمحُو سطرًا جارٍ معناه أن اللوحة أنكرت مكالمةً يعمل عليها صاحبُها.
 */
function deleteCallRecord(callId) {
  const c = callsState.find((x) => x.id === callId);
  if (!c) return toast('لا يوجد هذا السطر', true);
  if (c.status === 'ongoing' || c.status === 'ringing') {
    return toast('مكالمةٌ لم تنتهِ بعد: أوقفها أولًا ثم احذف أثرها', true);
  }
  askConfirm(
    'حذف سطر من سجل المكالمات',
    'يُمحى سجلُّ مكالمة <strong>' +
    esc(c.callerName || c.callerPhone || c.callerId || '—') + ' ← ' +
    esc(c.calleeName || c.calleePhone || c.calleeId || '—') + '</strong> ' +
    'المؤرَّخة ' + esc(c.createdAt ? fmtDate(c.createdAt) : 'بلا تاريخ') +
    '. محوٌ نهائي لا رجعة فيه، ولا يمسّ ما سُجِّل في «سجل التواصل».',
    async () => {
      try {
        await db.collection('calls').doc(String(callId)).delete();
        await logActivity(
          'حذف سجل مكالمة',
          (c.callerPhone || c.callerId || '?') + ' ← ' + (c.calleePhone || c.calleeId || '?')
        );
        toast('حُذف السطر');
        loadCalls();
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'حذف نهائي' }
  );
}

/* ---------- الاستماع ---------- */

function refreshCallsBadge() {
  const count = callsState.filter((c) => c.status === 'ringing' && c.calleeId === CALL_ADMIN_ID).length;
  setNavBadge('calls', count);
}

function initCallsListener() {
  stopCallsListener();
  expireStaleCalls();
  try {
    callsSub = db.collection('calls')
      .orderBy('createdAt', 'desc')
      .limit(80)
      .onSnapshot((snap) => {
        callsState = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        callsState.slice().reverse().forEach((c) => {
          if (c.status === 'ringing' && c.calleeId === CALL_ADMIN_ID && !handledRinging.has(c.id)) {
            handledRinging.add(c.id);
            const createdAt = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate() : new Date();
            if (Date.now() - createdAt.getTime() < RING_TIMEOUT_MS + 15000) showIncomingCall(c);
          }
        });
        refreshCallsBadge();
        renderCallsTable();
      }, (err) => {
        console.error('[calls] listener error', err);
        toast('خطأ في استقبال المكالمات: ' + ((err && err.message) || err), true);
      });
  } catch (err) {
    console.error('[calls] init error', err);
    toast('تعذر تشغيل استقبال المكالمات: ' + ((err && err.message) || err), true);
  }
}

async function expireStaleCalls() {
  const cutoff = new Date(Date.now() - (RING_TIMEOUT_MS + 15000));
  try {
    const snap = await db.collection('calls')
      .where('calleeId', '==', CALL_ADMIN_ID)
      .where('status', '==', 'ringing')
      .get();
    for (const doc of snap.docs) {
      const d = doc.data();
      const createdAt = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate() : new Date();
      if (createdAt < cutoff) {
        await doc.ref.update({
          status: 'missed',
          endReason: 'admin_unavailable',
          endedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  } catch (_) {}
}

function stopCallsListener() {
  if (callsSub) { callsSub(); callsSub = null; }
  stopRingTone();
  clearActiveCallTicker();
  closeActiveCallOverlay();
  teardownCall();
  activeRingCallId = null;
}

async function loadCalls() {
  const snap = await db.collection('calls').orderBy('createdAt', 'desc').limit(80).get();
  callsState = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  refreshCallsBadge();
  renderCallsTable();
}

/* ---------- نافذة اتصال جديد ---------- */

let callPeersLoaded = null;

/** أرقام معروفة عند اللوحة، لتُنتقى بالاسم بدل النسخ من جدول آخر. */
function loadCallPeers() {
  if (callPeersLoaded) return callPeersLoaded;
  callPeersLoaded = Promise.all([
    db.collection('providers').limit(300).get(),
    db.collection('customers').limit(300).get(),
  ])
    .then(([prov, cust]) => [
      ...prov.docs.map((d) => ({ phone: d.data().phone, name: d.data().name, role: 'driver' })),
      ...cust.docs.map((d) => ({ phone: d.data().phone, name: d.data().name, role: 'customer' })),
    ].filter((p) => p.phone))
    .catch(() => []);
  return callPeersLoaded;
}

function openNewCallModal(preset) {
  const pre = preset || {};
  const overlay = openModal({
    title: 'اتصال داخل التطبيق',
    body:
      '<label class="modal-label">رقم المتّصل به</label>' +
      '<input id="nc-phone" class="modal-input" list="nc-peers" maxlength="12" style="direction:ltr;text-align:left" placeholder="2233344551" value="' + esc(pre.phone || '') + '">' +
      '<datalist id="nc-peers"></datalist>' +
      '<label class="modal-label">الاسم (اختياري)</label>' +
      '<input id="nc-name" class="modal-input" maxlength="60" placeholder="الاسم الذي يظهر على شاشة المتّصل به" value="' + esc(pre.name || '') + '">' +
      '<label class="modal-label">الدور</label>' +
      '<select id="nc-role" class="modal-input">' +
      '<option value="customer"' + (pre.role === 'customer' ? ' selected' : '') + '>زبون</option>' +
      '<option value="driver"' + (pre.role === 'driver' ? ' selected' : '') + '>صاحب توصيل</option>' +
      '</select>' +
      '<div class="incoming-mic-hint">الصوت يمشي مباشرة بين الجهازين عبر البيانات أو واي فاي: لا دقائق ولا رصيد شريحة ولا شركة وسيطة.</div>',
    foot:
      '<button class="modal-btn ghost" data-close>إلغاء</button>' +
      '<button class="modal-btn ok" data-submit>اتصل</button>',
  });
  const phoneEl = overlay.querySelector('#nc-phone');
  loadCallPeers().then((peers) => {
    const list = overlay.querySelector('#nc-peers');
    if (!list || !phoneEl.parentNode) return;
    const seen = new Set();
    list.innerHTML = peers
      .filter((p) => /^[0-9]{8,12}$/.test(String(p.phone)) && !seen.has(p.phone) && seen.add(p.phone))
      .map((p) => '<option value="' + esc(p.phone) + '">' + esc(p.name || '') + '</option>')
      .join('');
  });

  const submit = () => {
    const phone = (phoneEl.value || '').replace(/[^0-9]/g, '');
    const name = (overlay.querySelector('#nc-name').value || '').trim();
    const role = overlay.querySelector('#nc-role').value;
    overlay.remove();
    startAdminCall(phone, name, role);
  };
  overlay.querySelector('[data-submit]').addEventListener('click', submit);
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
  phoneEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => phoneEl.focus(), 30);
}

/* ---------- سجلّ التواصل ---------- */

/*
 * **لماذا هو هنا؟** لأنّ كل مكالمةٍ وصلت تكتب رحلةً في
 * `customers/{phone}/trips`. من هذا السجلّ وحده يعرف المشرف كيف تواصل
 * الناس فعلًا: كم مكالمةً عبرت بروتوكول التطبيق، وكم بقي عالقًا على
 * واتساب أو شريحة الهاتف — ولا يُقرأ شيء من هذا في جدول الطلبات.
 *
 * **والرحلة مكالمةٌ لا ضغطة:** التطبيق صار يحفظ الرحلة حين تُغلق شاشة
 * المكالمة وقد سمع الطرفان بعضهما، فلا تُعدّ مكالمةٌ رُفضت أو لم تُرَد
 * تواصلًا. ومن قرأ السجلّ ووجد زبونًا «مكالماته أقلّ» مما كان، فذاك صدق
 * القائمة لا نقصٌ فيها.
 *
 * **والقنوات القديمة تُعرض لا تُمحى:** `sim` و`whatsapp` لم يعد التطبيق
 * ينتجهما بعد حذف الجسر إلى شريحة الهاتف، و`agora` اسم رحلات ما قبل
 * بروتوكول التطبيق. بقاؤها في الشاشة هي الدلالة على أن الانتقال تمّ.
 */

const TRIP_CHANNEL_META = {
  inapp: { label: 'اتصال التطبيق', cls: 'completed' },
  agora: { label: 'اتصال قديم', cls: 'offline' },
  whatsapp: { label: 'واتساب', cls: 'accepted' },
  sim: { label: 'شريحة الهاتف', cls: 'pending' },
};

let tripsState = [];

async function loadTrips() {
  const sel = $('#trips-customer');
  const body = $('#trips-body');
  if (!sel || !body) return;

  if (!customersState.length) {
    const snap = await db.collection('customers').limit(500).get();
    customersState = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  const keep = sel.value;
  sel.innerHTML = customersState
    .slice()
    .sort((a, b) => String(a.name || a.phone || '').localeCompare(String(b.name || b.phone || ''), 'ar'))
    .map((c) => {
      const phone = c.phone || c.id;
      return '<option value="' + esc(phone) + '">' + esc((c.name || 'بلا اسم') + ' — ' + phone) + '</option>';
    })
    .join('');
  if (keep) sel.value = keep;

  const phone = sel.value;
  if (!phone) {
    tripsState = [];
    body.innerHTML = '<tr><td colspan="6" class="empty-cell">لا زبائن بعد</td></tr>';
    renderTripsSummary();
    return;
  }
  const snap = await db.collection('customers').doc(phone)
    .collection('trips').orderBy('createdAt', 'desc').limit(100).get();
  tripsState = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTrips();
}

function renderTripsSummary() {
  const el = $('#trips-summary');
  if (!el) return;
  const counts = { inapp: 0, legacy: 0 };
  tripsState.forEach((t) => {
    if (t.channel === 'inapp') counts.inapp += 1;
    else counts.legacy += 1;
  });
  el.innerHTML =
    '<div class="stat-card"><div class="stat-label">تواصل مسجّل</div><div class="stat-value">' + tripsState.length + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">بروتوكول التطبيق</div><div class="stat-value">' + counts.inapp + '</div></div>' +
    '<div class="stat-card blue"><div class="stat-label">قنوات قديمة</div><div class="stat-value">' + counts.legacy + '</div></div>';
}

function renderTrips() {
  const body = $('#trips-body');
  if (!body) return;
  renderTripsSummary();
  const rows = tripsState.filter((t) =>
    searchHit('trips', [t.driverName, t.driverPhone, t.channel, t.id])
  );
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-cell">' +
      (tripsState.length ? 'لا نتيجة لهذا البحث' : 'لا تواصل مسجّل لهذا الزبون') + '</td></tr>';
    return;
  }
  body.innerHTML = rows.map((t, i) => {
    const meta = TRIP_CHANNEL_META[t.channel] || { label: t.channel || 'غير معروفة', cls: 'offline' };
    const name = t.driverName || t.driverPhone || '—';
    const avatar = t.driverPhoto
      ? '<img class="avatar" alt="" src="data:image/jpeg;base64,' + esc(t.driverPhoto) + '">'
      : '<span class="avatar avatar-fallback">' + esc(String(name).trim().charAt(0) || '?') + '</span>';
    const dist = typeof t.distanceKm === 'number'
      ? t.distanceKm.toFixed(1) + ' كم'
      : '—';
    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td>' + esc(t.createdAt ? fmtDate(t.createdAt) : '—') + '</td>' +
      '<td><div class="cell-user">' + avatar +
      '<div><strong>' + esc(name) + '</strong>' +
      '<div style="font-size:11px;color:var(--gray);direction:ltr">' + esc(t.driverPhone || '—') + '</div></div></div></td>' +
      '<td style="direction:ltr">' + dist + '</td>' +
      '<td><span class="badge ' + meta.cls + '">' + esc(meta.label) + '</span></td>' +
      '<td><div class="row-actions">' +
      '<button class="btn-sm ok" onclick="callTripDriver(\'' + esc(t.driverPhone || '') + '\',\'' + esc(t.driverName || '') + '\')">اتصل به</button>' +
      (canWrite()
        ? '<button class="btn-sm no" onclick="deleteTrip(\'' + esc(t.id) + '\')">حذف</button>'
        : '') +
      '</div></td>' +
      '</tr>';
  }).join('');
}

/// من السجلّ إلى المكالمة نفسها: يفتح نافذة الاتصال برقم صاحب التوصيل.
function callTripDriver(phone, name) {
  if (!phone) { toast('هذه الرحلة بلا رقم صاحب توصيل.', true); return; }
  openNewCallModal({ phone: phone, name: name, role: 'driver' });
}

/**
 * سطرُ التواصل داخل ملفّ الزبون نفسه، فحذفُهُ من هناك لا من جدولٍ مستقلّ:
 * من ظنّ أنه محا سطرًا في اللوحة فقط أبقي أثرًا لا يراه وهو يظنّه زال.
 */
function deleteTrip(tripId) {
  const phone = $('#trips-customer') ? $('#trips-customer').value : '';
  if (!phone) return toast('اختر الزبون أولًا، فالسطرُ في ملفّه هو لا في مكانٍ آخر', true);
  const t = tripsState.find((x) => x.id === tripId);
  if (!t) return toast('لا يوجد هذا السطر', true);
  askConfirm(
    'حذف سطر من سجل التواصل',
    'يُمحى من ملفّ الزبون <strong style="direction:ltr">' + esc(phone) + '</strong> أثرُ تواصله مع ' +
    '<strong>' + esc(t.driverName || t.driverPhone || '—') + '</strong> ' +
    'المؤرَّخ ' + esc(t.createdAt ? fmtDate(t.createdAt) : 'بلا تاريخ') + '. محوٌ نهائي لا رجعة فيه.',
    async () => {
      try {
        await db.collection('customers').doc(String(phone))
          .collection('trips').doc(String(tripId)).delete();
        await logActivity('حذف سجل تواصل', phone + ' · ' + (t.driverPhone || t.driverName || ''));
        toast('حُذف السطر');
        loadTrips();
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'حذف نهائي' }
  );
}

/* ---------- الدخول ---------- */

/*
 * الدخول يمرّ على Firebase Auth ثم على القاعدة، وهو ترتيب لا يُعكس:
 *
 * - **القاعدة لا تُخزّن كلمة المرور anymore.** تشترط وجود `admins/{uid}`
 *   باسم الـuid نفسه، فالاسم وحده لا يعطي أحداً صلاحية. لو بقيت
 *   المقارنة داخل الصفحة لأمكن تعديل `app.js` من أي متصفح ليتجاوزها،
 *   ولأمكن لأي شخص أن يكتب ما يشاء في `admins` لأنها كانت مفتوحة.
 * - **بلا حدّ للمحاولات.** لا عدّاد ولا تجميد ولا تأخير: من ينسى كلمة
 *   مروره يعيدها متى شاء. الحماية الحقيقية هي Firebase Auth نفسه.
 */

/** خرائط اسم المستخدم إلى بريد Auth، فيبقى الحقلان كما هما في الشاشة. */
const AUTH_EMAIL_BY_USERNAME = { admin: 'admin@tawsil.app' };

/*
 * تنظيف اسم المستخدم قبل استعماله.
 *
 * **المشكلة التي وقعت:** كُتب `admin` على لوح المفاتيح العربي فيدخل معه
 * تشكيل — `َadmin` — فيرفضه الكود رغم أنه مكتوب صحيحاً للرجل. و`trim()`
 * لا تنفع: التشكيل ليس فراغاً، فهو حرف من نوع `Mn` ملتصق بالاسم، فيبقى
 * بعد التنظيف ويُخالف `admin` حرفاً حرفاً.
 *
 * **وقبل التنظيف كان الفشل مُهماً:** الرسالة كانت «اسم المستخدم غير
 * معروف»، وهي صحيحة تماماً لكنها لا تدل على أن الاسم الذي يكتبه أمامي
 * ليس هو الاسم الذي كتبه. فلا بدّ من أن يقول الاسم منطوقاً ومكتوباً معاً.
 */
const DIACRITIC_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\uFE70-\uFEFF]/g;
const INVISIBLE_RE = /[\u200B-\u200F\uFEFF\u00AD]/g;

function cleanUsername(raw) {
  return String(raw == null ? '' : raw)
    .replace(INVISIBLE_RE, '')
    .replace(DIACRITIC_RE, '')
    .trim()
    .toLowerCase();
}

function authEmailFor(username) {
  const u = cleanUsername(username);
  if (!u) return '';
  // **بريد مكتوب مباشرة:** نقبله كما هو بعد التنظيف، فهو مفاتيح Firebase.
  if (u.indexOf('@') > -1) return u;
  return AUTH_EMAIL_BY_USERNAME[u] || '';
}

/** يعرض الاسم كما وصل، ليعرف المستخدم الفرق بين ما كتبه وما قُبل. */
function sayLoginError(text, typed) {
  const el = $('#login-error');
  el.textContent = text + (typed ? ' (المكتوب: ' + typed + ')' : '');
  el.classList.remove('hidden');
}

/** يقرأ ملف المشرف ويعيده، أو null إن لم يكن مشرفاً. */
async function loadAdminProfile(uid) {
  const doc = await db.collection('admins').doc(uid).get();
  if (!doc.exists) return null;
  return { id: doc.id, uid, ...doc.data() };
}

async function handleLogin(e) {
  e.preventDefault();
  // **نحتفظ بالاسم خاماً ونستعمل المنقّى:** الاسم المنقّى هو الذي يُبحث
  // به، والخام هو الذي يُعرض في الرسالة إن فشل البحث، فالمستخدم يرى
  // الفرق بدل أن يُقال له «اسم غير معروف» وكأنه كتب خطأً.
  const typed = $('#login-username').value;
  const password = $('#login-password').value;
  const email = authEmailFor(typed);
  $('#login-error').classList.add('hidden');
  $('#login-notadmin').classList.add('hidden');
  if (!email) {
    sayLoginError('اسم المستخدم غير معروف. أدخّل "admin" أو بريدك.', cleanUsername(typed));
    return;
  }
  $('#login-btn').textContent = 'جاري الدخول...';
  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const profile = await loadAdminProfile(cred.user.uid);
    if (!profile) {
      // **حساب صحيح بلا صلاحية:** ليست رسالة خطأ، بل حالة قائمة.
      await auth.signOut();
      $('#login-notadmin').classList.remove('hidden');
      return;
    }
    ADMIN = profile;
    sessionStorage.setItem('hamada_admin', JSON.stringify(ADMIN));
    enterApp();
  } catch (err) {
    const map = {
      'auth/invalid-credential': 'اسم المستخدم أو كلمة المرور غير صحيحة',
      'auth/user-not-found': 'اسم المستخدم أو كلمة المرور غير صحيحة',
      'auth/wrong-password': 'اسم المستخدم أو كلمة المرور غير صحيحة',
      'auth/invalid-email': 'اسم المستخدم غير معروف',
      'auth/too-many-requests': 'محاولات كثيرة من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة',
      'auth/network-request-failed': 'تعذّر الاتصال بالإنترنت',
    };
    // **الرمز يبقى ظاهراً عمداً:** الرسالة العربية وحدها لا تكفي
    // لتشخيص فشل في المتصفح، فالرمز يحدّد السبب بالضبط («النطاق غير
    // مسموح» يختلف كلياً عن «كلمة مرور خاطئة»). إخفاءه يجعل كل عطل
    // يبدو واحداً، والتشخيص يمتد بلا نهاية.
    const known = map[err.code];
    $('#login-error').textContent = (known || 'تعذّر الدخول: ' + err.message) + ' [' + (err.code || '؟') + ']';
    $('#login-error').classList.remove('hidden');
  } finally {
    $('#login-btn').textContent = 'دخول';
  }
}

/* ---------- طلب صلاحية مشرف ---------- */

/*
 * الطلب لا يعطي صلاحية: يكفي أن يُنشأ حساب وكتابة سطر طلب. والقبول هو
 * الذي يكتب `admins/{uid}`، ولا يستطيعه إلا مشرف قائم. فطريق الموظف
 * إلى الصفة طويل، والطريق الوحيد القصير هو موافقتك.
 */

async function handleAdminRequest() {
  const name = $('#req-name').value.trim();
  const email = $('#req-email').value.trim();
  const pass = $('#req-password').value;
  const pass2 = $('#req-password2').value;
  const msg = $('#req-msg');
  const say = (t, bad) => { msg.textContent = t; msg.classList.toggle('hidden', false); msg.style.color = bad ? '#e5484d' : '#2f9e44'; };
  if (!name || !email || !pass) return say('املأ الاسم والبريد وكلمة المرور', true);
  if (pass !== pass2) return say('كلمتا المرور غير متطابقتين', true);
  if (pass.length < 6) return say('كلمة المرور يجب 6 محارف على الأقل', true);
  $('#req-btn').textContent = 'جاري الإرسال...';
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await db.collection('admin_requests').doc(cred.user.uid).set({
      full_name: name,
      email,
      requested_at: firebase.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
    });
    $('#req-name').value = ''; $('#req-email').value = '';
    $('#req-password').value = ''; $('#req-password2').value = '';
    say('تم إرسال الطلب. بانتظار موافقة مدير اللوحة.');
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') say('هذا البريد مستخدم. ادخل مباشرة بكلمة مروره.', true);
    else if (err.code === 'auth/weak-password') say('كلمة المرور ضعيفة. استخدم 6 محارف فأكثر.', true);
    else say('تعذّر الإرسال: ' + err.message, true);
  } finally {
    $('#req-btn').textContent = 'إرسال الطلب';
  }
}

async function approveAdminRequest(uid, role) {
  const req = await db.collection('admin_requests').doc(uid).get();
  if (!req.exists) return;
  const d = req.data();
  // **والدرجة تُختار عند القبول لا بعده:** «مطالع» من اليوم الأول يعني أن
  // أحداً لا يدخل اللوحة بيده الكاملة ثم يُنزع منه ما لم يعرف أنه سيُنزع.
  const r = roleOf({ role });
  // **ولا يُقبَلُ ثانٍ على كرسيٍّ واحد:** زرُّ «قبول مالكًا» يظهرُ ما لم يكن،
  // فإن سبقَ أحدٌ واللوحةُ لا تزالُ ترسمُ الجدولَ القديمَ رفضَ الفعلُ لا
  // المنظرُ وحدَه.
  if (r === 'owner' && await findOwnerUid()) {
    return toast('المالكُ معلَنٌ بالفعل: لا مالكَ ثانٍ للنظام', true);
  }
  await db.collection('admins').doc(uid).set({
    uid,
    email: d.email || '',
    username: d.email || '',
    full_name: d.full_name || '',
    role: r,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection('admin_requests').doc(uid).delete();
  logActivity('قبول مشرف جديد', (d.full_name || d.email || uid) + ' · ' + ROLE_LABELS[r]);
  toast('تم إعطاء الصلاحية (' + ROLE_LABELS[r] + '): ' + (d.full_name || d.email || uid));
  applyRoleChrome();
  loadAdmins();
}

async function declineAdminRequest(uid) {
  const req = await db.collection('admin_requests').doc(uid).get();
  const who = req.exists ? (req.data().full_name || req.data().email) : uid;
  await db.collection('admin_requests').doc(uid).delete();
  logActivity('رفض طلب مشرف', who);
  toast('تم رفض الطلب');
  loadAdmins();
}

/**
 * **المالكُ وجودٌ واحدٌ لا يُمسّ:** بطاقةٌ واحدةٌ في النظامِ درجتُها «مالك»،
 * وهيَ التي تُعيِّنُ وتَعزلُ وتبدَّلُ الدرجات. إن حُذِفَت أو دُنِّسَت درجتُها
 * صارتِ اللوحةُ بلا حارسٍ للتعين، وأولُ داخِلٍ يرفعُ نفسَه إلى مكانِها.
 * **ولذلك يُقرأُ الحكمُ من القاعدةِ وقتَ الفعلِ لا من نصِّ الزرّ:** الأزرارُ
 * تُرسَمُ من جدولٍ قد يكونُ قديمًا في الشاشة، والرجلُ قد يضغطُ بعدَ أن تغيَّر
 * ما تحتَ يديه، فالحارسُ في الدالةِ نفسِها لا في المنظرِ وحدَه.
 */
async function findOwnerUid() {
  const snap = await db.collection('admins').where('role', '==', 'owner').limit(2).get();
  return snap.empty ? '' : snap.docs[0].id;
}

async function removeAdmin(uid) {
  if (uid === myUid()) return toast('لا يمكنك إزالة نفسك', true);
  const doc = await db.collection('admins').doc(uid).get();
  // **ولا بطاقةُ مالكٍ تُحذَفُ البتَّة:** الحكمُ على البطاقةِ نفسِها لا على
  // «المالكِ الوحيد»، فإنَّ جدولًا قديمًا قد يحملُ مالكَينِ من عهدِ ما قبلَ
  // الدرجات، وكلاهما لا يُمَسّ — فالحذفُ إن أُبيحَ على واحدةٍ منهما أُغلِقَ
  // بابُ التعيينِ كلُّه ولا يُفتَحُ إلا بيدٍ من خارجِ اللوحة.
  if (doc.exists && roleOf(doc.data()) === 'owner') {
    return toast('المالكُ لا يُزال: تُغلَقَ اللوحةُ بلا يدٍ تُعيِّنُ بعدها', true);
  }
  const who = doc.exists ? (doc.data().full_name || doc.data().email) : uid;
  // **ونافذةُ اللوحة لا نافذةُ المتصفح:** فعلٌ يعزل رجلاً عن العمل لا
  // يُختصر بسطرٍ رماديٍّ في شريط العنوان، فالواحدة تُقرأ وال أخرى تُغلق
  // بالخطأ وهي لا تقول ماذا يحدث للمعزول.
  askConfirm(
    'إزالة صلاحية مشرف',
    'يُزال «<strong>' + esc(who) + '</strong>» من قائمة المشرفين: لا يستطيع ' +
    'دخول اللوحة من بعده، ويبقى حسابه في النظام كما هو للاطّلاع على ما فعل.',
    async () => {
      try {
        await db.collection('admins').doc(uid).delete();
        await logActivity('إزالة مشرف', who);
        toast('أُزيلت الصلاحية');
        loadAdmins();
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'إزالة' }
  );
}

async function loadAdmins() {
  const reqBody = $('#adminreq-body');
  const admBody = $('#admins-body');
  if (!reqBody || !admBody) return;

  const [reqs, adm] = await Promise.all([
    db.collection('admin_requests').get(),
    db.collection('admins').get(),
  ]);
  const reqsState = reqs.docs.map((d) => ({ id: d.id, ...d.data() }));
  const admState = adm.docs.map((d) => ({ id: d.id, ...d.data() }));
  // **وجودُ المالك هو الذي يُغلق بابَ التعيين:** ما لم يكن فاللوحةُ بلا
  // حارس، ويُعلَن أولُ داخلٍ فيها مالكًا — ثم يحصرُ كلَّ شيءٍ في يده.
  const ownerExists = admState.some((a) => roleOf(a) === 'owner');
  setNavBadge('admins', reqsState.length);

  const grantBtn = (id, role, label) =>
    '<button class="btn-sm ok" onclick="approveAdminRequest(\'' + id + '\',\'' + role + '\')">' + label + '</button>';
  const mayGrant = isOwner() || !ownerExists;
  reqBody.innerHTML = reqsState.length
    ? reqsState.map((r) =>
        '<tr><td><strong>' + esc(r.full_name || '—') + '</strong></td>' +
        '<td style="direction:ltr">' + esc(r.email || '—') + '</td>' +
        '<td>' + fmtDateShort(r.requested_at) + '</td>' +
        '<td><div class="row-actions">' +
        (mayGrant ? grantBtn(r.id, 'admin', 'قبول مشرفًا') : '') +
        (mayGrant ? grantBtn(r.id, 'viewer', 'قبول مطالعًا') : '') +
        (ownerExists ? '' : grantBtn(r.id, 'owner', 'قبول مالكًا')) +
        (isOwner() ? '<button class="btn-sm no" onclick="declineAdminRequest(\'' + r.id + '\')">رفض</button>' : '') +
        (isOwner() || !ownerExists ? '' : '<span class="badge inactive">للاطّلاع — القبولُ للمالك</span>') +
        '</div></td></tr>').join('')
    : '<tr class="empty-row"><td colspan="4">لا توجد طلبات</td></tr>';

  const roleCell = (a) => {
    const role = roleOf(a);
    // **المالكُ لا يُبدَّلُ بمنبوذة:** منظرُ الدرجةِ الثابتةِ يقولُ للمالكِ
    // نفسِه إنَّ يدَه عن ملَكِه مغلولة، ولا يدعُ له قائمةً يخطئُ فيها مرة.
    if (role === 'owner') {
      return '<span class="badge active">مالك النظام — لا يُزال ولا تُبدَّل درجتُه</span>';
    }
    if (!isOwner()) return '<span class="badge inactive">' + ROLE_LABELS[role] + '</span>';
    return '<select class="modal-input" style="width:auto;padding:2px 8px" ' +
      'onchange="setAdminRole(\'' + a.id + '\', this.value)">' +
      ['owner', 'admin', 'viewer'].map((r) =>
        '<option value="' + r + '"' + (r === role ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>').join('') +
      '</select>';
  };

  admBody.innerHTML = admState.length
    ? admState.map((a) => {
        const me = a.id === ADMIN.uid || a.id === myUid();
        return '<tr><td><strong>' + esc(a.full_name || '—') + '</strong>' +
        (me ? ' <span class="badge active">أنت</span>' : '') + '</td>' +
        '<td style="direction:ltr">' + esc(a.email || a.username || '—') + '</td>' +
        '<td>' + roleCell(a) + '</td>' +
        '<td>' + fmtDateShort(a.createdAt) + '</td>' +
        '<td><div class="row-actions">' +
        (me && !ownerExists ? '<button class="btn-sm ok" onclick="claimOwner()">اجعلني مالكًا</button>' : '') +
        (isOwner() ? '<button class="btn-sm blue" onclick="resetAdminPassword(\'' + a.id + '\')">رابط كلمة المرور</button>' : '') +
        (isOwner() && !me && roleOf(a) !== 'owner'
          ? '<button class="btn-sm no" onclick="removeAdmin(\'' + a.id + '\')">إزالة</button>' : '') +
        '</div></td></tr>';
      }).join('')
    : '<tr class="empty-row"><td colspan="5">لا يوجد مشرفون</td></tr>';
}

/**
 * درجةُ مشرفٍ تُبدَّل بعد القبول: للمالك وحده. والدرجةُ ليست زينةً —
 * «مطالع» يعني أن كلَّ زرٍّ في اللوحة يُقال له سببُه ولا يُنفَّذ.
 */
async function setAdminRole(uid, role) {
  const r = roleOf({ role });
  // **درجتانِ لا تُمسّان:** بطاقةُ المالكِ لا تُنزَلُ عن ملَكِها — لا بيدِه
  // ولا بيدِ غيرِه، لأنَّ لا يَرفَعُ إلى المالكِ بعدَه أحدٌ فيبقى النظامُ بلا
  // حارسٍ أبداً — ولا يُنشأُ مالكٌ ثانٍ، فلو ملكَ اثنانِ انقسمَ التعيينُ
  // بينهما فلم تُعرَفْ أيُّ كلمةٍ تُصدَّق. والقراءةُ من القاعدةِ وقتَ الفعل،
  // فالمنظرُ قد يكونُ رسُمَ على جدولٍ قديم.
  const target = await db.collection('admins').doc(uid).get();
  const ownerCard = target.exists && roleOf(target.data()) === 'owner';
  if (ownerCard && r !== 'owner') {
    return toast('درجةُ المالكِ لا تُبدَّل: لا يرفَعُ بعدها إلى المالكِ أحد', true);
  }
  if (r === 'owner' && !ownerCard && await findOwnerUid()) {
    return toast('لا مالكَ ثانٍ للنظام', true);
  }
  try {
    await db.collection('admins').doc(uid).update({ role: r });
    if (uid === myUid()) {
      ADMIN.role = r;
      sessionStorage.setItem('hamada_admin', JSON.stringify(ADMIN));
    }
    await logActivity('تغيير درجة مشرف', r);
    toast('الدرجة الآن: ' + ROLE_LABELS[r]);
    applyRoleChrome();
    loadAdmins();
  } catch (err) { toast(err.message, true); }
}

/** أولُ داخلٍ يصبح المالك، ولا شيءَ بعده يُبدَّل إلا بيده. */
function claimOwner() {
  askConfirm(
    'إعلان المالك',
    'لا مالكَ في النظام بعد. أجعلْ «<strong>' + esc((ADMIN && ADMIN.full_name) || 'أنت') + '</strong>» مالكًا؟ ' +
    'بعدها لا تُبدَّل درجةٌ ولا تُضاف صلاحيةٌ إلا من يده.',
    async () => {
      try {
        // **الجدولُ قد يكون قديمًا:** لو سبق رجلٌ وضغط الإعلانَ قبله، فالبابُ
        // الذي يفتحُ مالكًا ثانٍ يجب أن يُغلق هنا، لا عند الزرِّ وحده.
        const owners = await db.collection('admins').where('role', '==', 'owner').get();
        if (owners.docs.length) {
          toast('المالكُ معلَنٌ بالفعل: «' + (owners.docs[0].data().full_name || owners.docs[0].id) + '»', true);
          loadAdmins();
          return;
        }
        await db.collection('admins').doc(myUid()).update({ role: 'owner' });
        ADMIN.role = 'owner';
        sessionStorage.setItem('hamada_admin', JSON.stringify(ADMIN));
        await logActivity('إعلان مالك النظام', (ADMIN && ADMIN.full_name) || '');
        toast('أنت الآن مالكُ النظام');
        applyRoleChrome();
        loadAdmins();
      } catch (err) { toast(err.message, true); }
    },
    { confirm: 'إعلان' }
  );
}

/* ---------- مشرفٌ تُنشئه اللوحةُ بيدِ المالك ---------- */

/*
 * **الطريقُ الطويل يبقى كما هو:** أن يُنشئ الرجلُ حسابَه من شاشة الدخول
 * ثم يطلب صلاحيةً ثم تقبلها — وهذا سبيلُه حين يكون بعيدًا. أمّا إذا كان
 * في المكتب وتحتاج أن يعمل اليوم فلا معنى أن تنتظر أن يضغط هو زرًّا.
 *
 * **ولماذا تطبيقُ حساباتٍ ثانٍ؟** لأنَّ إنشاءَ حسابٍ في جلسة اللوحة نفسها
 * يُخرج المالكَ من دخوله ويُجلس مكانه الرجلَ الجديد. فالتطبيقُ الثاني
 * يُنشئ ثم يخرج، ويُقالُ له «لا تخزّن» حتى لا يمسَّ أثرَ جلسة المالك
 * المحفوظة في المتصفّح — وبعده تُتحقَّق اللوحةُ أن صاحبها لم يخرج.
 */
const PROVISIONER_APP = 'hamada-admin-provisioner';
const provisionerReady = {};

async function provisionerAuth() {
  const list = Array.isArray(firebase.apps) ? firebase.apps : [];
  const app = list.find((a) => a.name === PROVISIONER_APP) ||
    firebase.initializeApp(firebase.app().options, PROVISIONER_APP);
  const pa = app.auth();
  if (!provisionerReady[PROVISIONER_APP]) {
    await pa.setPersistence(firebase.auth.Auth.Persistence.NONE);
    provisionerReady[PROVISIONER_APP] = true;
  }
  return pa;
}

/**
 * بريدٌ لا صندوقَ خلفه.
 *
 * **وهذا هو جوابُ سؤال «رابط كلمة المرور»:** الحسابُ الذي في داخله بريدٌ
 * صنعه النظامُ لاسمٍ ثابت لا يملكه رجل — الرسالةُ تُرسَل ولا تصل إلى أحد.
 * فالزرُّ صحيحُ الصنعة على هذا البريد وهمٌّ على ذاك، واللوحةُ تقول ذلك
 * بدل أن تُخبره أن الرابطَ أُرسل.
 */
function isVirtualAdminEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return !e || e.endsWith('@tawsil.app');
}

function createAdmin() {
  const overlay = openModal({
    title: 'إنشاء مشرفٍ بيدك',
    body:
      '<div style="display:grid;gap:10px">' +
      '<label>الاسم في اللوحة</label><input id="ca-name" type="text" class="modal-input">' +
      '<label>بريده الحقيقي</label><input id="ca-email" type="email" class="modal-input" style="direction:ltr" autocomplete="off">' +
      '<label>كلمة سرٍّ مؤقّتة</label><input id="ca-pass" type="text" class="modal-input" style="direction:ltr" autocomplete="off">' +
      '<label>درجتُه</label><select id="ca-role" class="modal-input">' +
      ['admin', 'viewer'].map((r) =>
        '<option value="' + r + '">' + ROLE_LABELS[r] + '</option>').join('') +
      '</select>' +
      '<p class="login-sub">أعطِه الكلمةَ المؤقّتة وقل له يغيّرها من «الإعدادات» بعد أول دخول. ' +
      '<strong>والبريدُ يجب أن يكون حقيقيًا:</strong> إن ضاعت كلمتُه فإنما يُرسَل رابطُ التعيين إلى بريده، ' +
      'فلا يُنشَأ حسابٌ ببريدٍ لا صندوق خلفه. ولا تُمنح من هنا درجةُ المالك: المالكُ واحدٌ في النظام.</p>' +
      '</div>',
    foot:
      '<button class="modal-btn ghost" data-close>إلغاء</button>' +
      '<button class="modal-btn ok" data-submit>إنشاءٌ ومنحُ الصفة</button>',
  });
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
  overlay.querySelector('[data-submit]').addEventListener('click', () => submitNewAdmin(overlay));
}

async function submitNewAdmin(overlay) {
  const name = overlay.querySelector('#ca-name').value.trim();
  const email = overlay.querySelector('#ca-email').value.trim();
  const pass = overlay.querySelector('#ca-pass').value;
  // **وبابُ الإنشاءِ لا يُنشئُ ملكاً:** القائمةُ لا تعرضُ غيرَ «مشرفٍ ومطالع»،
  // ولو جاءَ نصُّ الدرجةِ من خارجِ اللوحةِ بمالكٍ ثانٍ رُدَّ إلى مشرفٍ، لأنَّ
  // المالكَ واحدٌ ولا يُجعَلُ في النظامِ اثنانِ من بابِ الأسماء.
  const chosen = roleOf({ role: overlay.querySelector('#ca-role').value });
  const role = chosen === 'owner' ? 'admin' : chosen;
  const btn = overlay.querySelector('[data-submit]');
  if (!name || !email || !pass) return toast('الاسمُ والبريدُ والكلمةُ ثلاثةٌ مطلوبة', true);
  if (pass.length < 6) return toast('كلمة السرّ: ستّةُ محارف فأكثر', true);
  if (isVirtualAdminEmail(email)) {
    return toast('هذا بريدُ اللوحة الداخليّ لا بريدُ رجل: اكتب بريدَه الحقيقي', true);
  }
  const before = auth.currentUser ? auth.currentUser.uid : '';
  btn.disabled = true;
  try {
    const pa = await provisionerAuth();
    const cred = await pa.createUserWithEmailAndPassword(email, pass);
    const uid = cred.user.uid;
    // والصفةُ تُكتب من جلسة المالك — فاللوحةُ هي التي تقرّر لا الحسابُ الجديد.
    await db.collection('admins').doc(uid).set({
      uid: uid,
      email: email,
      username: email,
      full_name: name,
      role: role,
      added_by: String((ADMIN && (ADMIN.full_name || ADMIN.username)) || ''),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await pa.signOut();
    overlay.remove();
    await logActivity('إنشاء مشرف بيد المالك', name + ' · ' + ROLE_LABELS[role]);
    toast('أُنجز: «' + name + '» بدرجة ' + ROLE_LABELS[role]);
    loadAdmins();
    // **ودخولُ المالك لا يُمسّ:** لو خرج من جلسته وهو لا يدري لضاع عمله
    // نصفَ منجَزٍ وظنّ أن اللوحة معطوبة.
    if (auth.currentUser && auth.currentUser.uid === before) return;
    toast('أُنجز الحساب، لكن وجب عليك أن تدخل إلى اللوحة من جديد', true);
  } catch (err) {
    btn.disabled = false;
    toast(err.code === 'auth/email-already-in-use'
      ? 'هذا البريد له حسابٌ بالفعل: امنحه الصفةَ من قائمة المشرفين أو اطلب منه أن يدخل'
      : err.code === 'auth/invalid-email'
        ? 'البريد غيرُ صحيح الشكل'
        : err.code === 'auth/weak-password'
          ? 'كلمة المرور ضعيفة: ستّةُ محارف فأكثر'
          : 'تعذّر الإنشاء: ' + err.message, true);
  }
}

/**
 * كلمةُ سرٍّ لا تعرفها اللوحة: تُرسَل رسالةُ تعيينٍ من Firebase إلى بريد
 * المشرف. واللوحةُ التي تخزّن كلمةَ سرٍّ في جدولٍ يقرؤه كلُّ مشرفٍ قد
 * نشرت أسرارَ الدخول على نفسها — وهذا بابٌ كان مفتوحًا وانغلق.
 */
async function resetAdminPassword(uid) {
  try {
    const doc = await db.collection('admins').doc(uid).get();
    if (!doc.exists) return toast('لا يوجد هذا المشرف', true);
    const email = String(doc.data().email || '');
    if (!email) return toast('لا بريد مسجَّل لهذا المشرف', true);
    if (isVirtualAdminEmail(email)) {
      return toast(
        'لا صندوقَ بريد خلف هذا الحساب: الرابطُ يُرسَل ولا يصل إلى أحد. ' +
        'أنشئ له حسابًا ببريدٍ حقيقي ثم أرسل الرابطَ إليه.',
        true
      );
    }
    askConfirm(
      'إعادة تعيين كلمة المرور',
      'يُرسل النظامُ رسالةً إلى <strong style="direction:ltr">' + esc(email) + '</strong> ' +
      'فيها رابطُ تعيين كلمةٍ جديدة. لا تُرسل اللوحةُ كلمةً ولا تعرف واحدة.',
      async () => {
        try {
          await auth.sendPasswordResetEmail(email);
          await logActivity('إرسال رابط كلمة مرور', doc.data().full_name || email);
          toast('أُرسل الرابط إلى البريد');
        } catch (err) { toast(err.message, true); }
      },
      { confirm: 'إرسال الرابط' }
    );
  } catch (err) { toast(err.message, true); }
}

/* ---------- الزبائن الجدد ---------- */

/*
 * الإشعار يبدأ من الزبون نفسه لا من التطبيق: التطبيق لا يكتب في
 * `activity_log` لأن ذلك يمنح أي زبون حقّ الكتابة في سجل الإدارة.
 * فاللوحة تقرأ `customers` وترى من هو جديد، ثم تكتب سطر النشاط **هي**
 * بعد أنُزحقت من Firebase Auth. فالسجل لا يقبل إلا من مشرف، والمشرف
 * وحده يقرّر أنه رأى الزبون.
 *
 * **والمعرّف `customer_<phone>` لا اعتباطي:** لو استعملنا `add()` لأنشأ
 * السطر نفسه كل مرة تفتح فيها اللوحة، فتضخّم «سجل النشاط» بلا سبب.
 * بمعرّف ثابت، الكتابة الثانية تصطدم بالمستند الموجود فتُتجاهل.
 */

const SEEN_KEY = 'hamada_seen_customers';
const PENDING_KEY = 'hamada_pending_customers';
let seenCustomers = null;
let pendingCustomers = null;
let baselinePending = false;
let customerPollTimer = null;

function loadSeenCustomers() {
  const read = (k) => {
    try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); }
    catch { return new Set(); }
  };
  seenCustomers = read(SEEN_KEY);
  pendingCustomers = read(PENDING_KEY);
  // **الخط أساس لا إخبار:** أول تشغيل بعد نشر الكود يجب ألّا يطلق
  // إشعاراً عن زبائن قدامى أضيفوا قبل وجود هذه الميزة.
  if (!localStorage.getItem(SEEN_KEY)) baselinePending = true;
}

function saveSeenCustomers() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seenCustomers]));
    localStorage.setItem(PENDING_KEY, JSON.stringify([...pendingCustomers]));
  } catch {}
}

/**
 * يرى الزبون الجديد ويحفظه «معلقاً» حتى يفتح المشرف القائمة.
 *
 * **الفصل بين `seen` و`pending` هو ما يجعل الشارة لها معنى:** لو أضاف
 * المستكشفُ الزبونَ إلى `seen` عند رؤيته، لصارت الشارة صفراً بعد ثانية —
 **الشارة تعني «يوجد من لم تنظر إليه بعد»، فلا يصح أن يُحسَب قد رآه من
 * نظر إليه. فـ`pending` هو من رآه المستكشف ولم تفتحه أنت بعد.
 */
async function pollNewCustomers() {
  if (!ADMIN || !seenCustomers) return;
  let snap;
  try { snap = await db.collection('customers').get(); } catch { return; }

  // **بلا إخبار بعد أول تشغيل:** نأخذ الموجود اليوم كخط أساس.
  if (baselinePending) {
    snap.forEach((d) => { seenCustomers.add(d.id); pendingCustomers.delete(d.id); });
    baselinePending = false;
    saveSeenCustomers();
    refreshCustomersBadge();
    return;
  }

  const fresh = [];
  snap.forEach((d) => {
    const id = d.id;
    if (!seenCustomers.has(id) && !pendingCustomers.has(id)) fresh.push({ id, ...d.data() });
  });

  for (const c of fresh) {
    pendingCustomers.add(c.id);
    const who = c.name || c.phone || c.id;
    try {
      const ref = db.collection('activity_log').doc('customer_' + c.id);
      const already = await ref.get();
      if (already.exists) continue;
      await ref.set({
        // **اسم كاتب مختلف عن المشرف:** المستعرض يطنّش أسطر
        // المشرف نفسه كي لا يُسمع صوت كل إجراء يفعله بيده. وهذا السطر
        // ليس إجراء مشرف بل تسجيل زبون من التطبيق، فاسمه «التطبيق».
        admin_name: 'التطبيق',
        action: 'زبون جديد سجّل',
        target: who,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch {}
  }
  if (fresh.length) saveSeenCustomers();
  refreshCustomersBadge();
}

/** الشارة = عدد من رآه المستكشف ولم تفتح قائمتك بعد. */
function refreshCustomersBadge() {
  if (!pendingCustomers) return;
  setNavBadge('customers', pendingCustomers.size);
}

/** فتح قائمة الزبائن يعني أنك رأتَهم، فيغادرون الانتظار. */
function clearPendingCustomers() {
  if (!pendingCustomers || !seenCustomers) return;
  pendingCustomers.forEach((id) => seenCustomers.add(id));
  pendingCustomers.clear();
  saveSeenCustomers();
  refreshCustomersBadge();
}

function startCustomerPoller() {
  stopCustomerPoller();
  pollNewCustomers();
  customerPollTimer = setInterval(pollNewCustomers, 10000);
}

function stopCustomerPoller() {
  if (customerPollTimer) { clearInterval(customerPollTimer); customerPollTimer = null; }
}

function logout() {
  ADMIN = null;
  stopActivityPoller();
  stopCallsListener();
  stopCustomerPoller();
  // **الخروج يخرج من Firebase Auth أيضاً:** ترك الجلسة مفتوحة يجعل
  // الصفحة تقرأ البيانات بإذن مشرف حتى بعد أن يبدو للمستخدم أنه خرج.
  auth.signOut().catch(() => {});
  sessionStorage.removeItem('hamada_admin');
  $('#login-screen').classList.remove('hidden');
  $('#app-screen').classList.add('hidden');
  $('#login-password').value = '';
}

function enterApp() {
  $('#login-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');
  $('#user-name').textContent = ADMIN.full_name;
  applyRoleChrome();
  switchView('dashboard');
  loadView('dashboard');
  startClock();
  startActivityPoller();
  loadSeenCustomers();
  startCustomerPoller();
  refreshNavBadges();
  initCallsListener();
}

/* ---------- Navigation ---------- */

const TITLES = {
  dashboard: 'لوحة الإحصائيات',
  requests: 'طلبات الاشتراك',
  driverRequests: 'تسجيل أصحاب التوصيل',
  renewals: 'تجديدات الاشتراك',
  orders: 'الطلبات',
  calls: 'المكالمات',
  providers: 'أصحاب التوصيل',
  customers: 'الزبائن',
  areas: 'المناطق',
  admins: 'المشرفون',
  activity: 'سجل النشاط',
  settings: 'الإعدادات',
};

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $('#view-title').textContent = TITLES[name] || '';
  const b = document.querySelector('.nav-item.active');
  if (b) setNavBadge(b.dataset.view, 0);
}

async function loadView(name) {
  try {
    if (name === 'dashboard') await loadDashboard();
    if (name === 'requests') await loadRequests();
    if (name === 'driverRequests') await loadDriverRequests();
    if (name === 'orders') await loadOrders();
    if (name === 'calls') await loadCalls();
    if (name === 'trips') await loadTrips();
    if (name === 'providers') await loadProviders();
    if (name === 'renewals') await loadRenewals();
    if (name === 'customers') await loadCustomers();
    if (name === 'areas') await loadAreas();
    if (name === 'admins') await loadAdmins();
    // **فتح قائمة الزبائن يُصفّر الشارة:** الشارة تعني «يوجد من لم تره بعد»،
    // فبمجرد فتح القائمة رأيتهم، وإلّا بقي الرقم معلّقاً بلا معنى.
    if (name === 'customers') clearPendingCustomers();
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
  { key: 'visible_providers', label: 'يظهر للزبائن الآن', sub: null },
  { key: 'orders_total', label: 'إجمالي الطلبات', sub: null },
  { key: 'customers', label: 'الزبائن', sub: null, cls: 'blue' },
  { key: 'providers', label: 'أصحاب التوصيل', sub: null },
];

async function loadDashboard() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [ordersSnap, pendingSnap, providersSnap, customersSnap, activitySnap] = await Promise.all([
    db.collection('orders').get(),
    db.collection('subscription_requests').where('status', '==', 'pending').get(),
    db.collection('providers').get(),
    db.collection('customers').get(),
    db.collection('activity_log').orderBy('created_at', 'desc').limit(20).get(),
  ]);

  const allOrders = ordersSnap.docs.map(d => d.data());
  const ordersToday = allOrders.filter(o => {
    if (!o.created_at) return false;
    const d = o.created_at.toDate ? o.created_at.toDate() : new Date(o.created_at);
    return d >= todayStart;
  });

  const revenueToday = ordersToday.filter(o => o.status === 'completed').reduce((s, o) => s + (Number(o.total) || 0), 0);
  const revenue = allOrders.filter(o => o.status === 'completed').reduce((s, o) => s + (Number(o.total) || 0), 0);
  // **وظهورُهم كما هو لا كما تظنُّ اللوحة:** كانت البطاقةُ تعدّ «متصلين»
  // من حقلٍ في جدول أصحاب التوصيل لم يعد أحدٌ يكتبه منذ أن صار الظهورُ
  // ببطاقة القرار، فرقمُها ثابتٌ على صفرٍ أو على عهدٍ قديم. العددُ الآن
  // يُقرأ من البطاقة نفسها التي يقرأها الهاتف.
  const dashPhones = Array.from(new Set(
    providersSnap.docs.map((d) => String(d.data().phone || '')).filter(Boolean)
  ));
  const dashAccess = await loadAccess(dashPhones);
  const visibleProviders = dashPhones.filter(
    (ph) => accessIsVisible(dashAccess[ph])
  ).length;

  const stats = {
    orders_today: ordersToday.length,
    pending_requests: pendingSnap.size,
    visible_providers: visibleProviders,
    orders_total: allOrders.length,
    customers: customersSnap.size,
    providers: providersSnap.size,
    revenue_today: revenueToday,
    revenue: revenue,
  };

  const grid = $('#stats-cards');
  grid.innerHTML = '';
  const cards = [
    ...STAT_META.map((m) => ({ ...m, value: stats[m.key] })),
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

  const bdContainer = $('#view-dashboard .two-col .card:nth-child(1) .breakdown');
  const statuses = ['new', 'accepted', 'en_route', 'completed', 'rejected'];
  const counts = {};
  statuses.forEach((s) => (counts[s] = 0));
  allOrders.forEach((o) => { if (counts[o.status] !== undefined) counts[o.status]++; });
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

  const activity = activitySnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const recent = $('#view-dashboard .two-col .card:nth-child(2) .activity-list');
  recent.innerHTML = activity
    .slice(0, 6)
    .map((a) => '<li>' + esc(a.action) + ' <span class="act-time">' + esc(a.target) + ' — ' + fmtDate(a.created_at) + '</span></li>')
    .join('') || '<li>لا يوجد نشاط بعد</li>';
}

/* ---------- Requests ---------- */

let requestsFilter = '';
let requestsState = [];

async function loadRequests() {
  const snap = await db.collection('subscription_requests').orderBy('created_at', 'desc').get();
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (requestsFilter) requestsState = rows.filter(r => r.status === requestsFilter);
  else requestsState = rows;
  renderRequests();
}

/** رسمُ قائمة الأوراق وحده: البحثُ والتصفيةُ لا يُعيدان قراءة القاعدة. */
function renderRequests() {
  const body = $('#requests-body');
  if (!body) return;
  const rows = requestsState.filter((r) => searchHit('requests', [r.name, r.phone, r.id]));
  if (!rows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="8">' +
      (requestsState.length ? 'لا نتيجة لهذا البحث' : 'لا توجد طلبات') + '</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((r) => {
      let docs = [];
      if (Array.isArray(r.documents)) docs = r.documents;
      else try { docs = JSON.parse(r.documents || '[]'); } catch {}
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
          '<button class="btn-sm blue" onclick="openReviewDocs(\'' + r.id + '\')">مراجعة الأوراق</button>' +
          '<button class="btn-sm ok" onclick="reviewRequest(\'' + r.id + '\',\'approve\')">قبول</button>' +
          '<button class="btn-sm no" onclick="reviewRequest(\'' + r.id + '\',\'reject\')">رفض</button>';
      }
      actions += '<button class="btn-sm no" onclick="deleteRequest(\'' + r.id + '\')">حذف</button></div>';
      return (
        '<tr>' +
        '<td style="font-size:11px;max-width:80px;overflow:hidden;text-overflow:ellipsis" title="' + esc(r.id) + '">' + esc(r.id.substring(0, 8)) + '</td>' +
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
    'هل تريد حذف طلب الاشتراك "' + (r ? esc(r.name) : id.substring(0, 8)) + '" نهائياً؟<br>لن يستطيع أحد عرضه بعد الآن.',
    async () => {
      try {
        await db.collection('subscription_requests').doc(id).delete();
        await logActivity('حذف طلب اشتراك', r ? r.name : '');
        toast('تم حذف طلب الاشتراك');
        loadRequests();
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'حذف' }
  );
}

function deleteAllRequests() {
  askConfirm(
    'حذف كل طلبات الاشتراك',
    'هل تريد حذف جميع طلبات الاشتراك نهائياً؟<br>لا يمكن التراجع عن هذه العملية.',
    async () => {
      try {
        const snap = await db.collection('subscription_requests').get();
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        await logActivity('حذف كل طلبات الاشتراك', snap.size + ' طلب');
        toast('تم حذف ' + snap.size + ' طلب اشتراك');
        loadRequests();
        if (!requestsFilter) loadView('dashboard');
      } catch (err) { toast(err.message, true); }
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
    async (note) => {
      try {
        if (isApprove) {
          const reqDoc = await db.collection('subscription_requests').doc(id).get();
          const req = reqDoc.data();
          const now = firebase.firestore.FieldValue.serverTimestamp();
          const endDate = new Date(Date.now() + 365 * 24 * 3600 * 1000);

          let existingProvider = null;
          const provSnap = await db.collection('providers').where('phone', '==', req.phone).limit(1).get();
          if (!provSnap.empty) existingProvider = provSnap.docs[0];

          let personalPhoto = '';
          if (Array.isArray(req.documents)) {
            const personal = req.documents.find(d => d.category === 'personal');
            if (personal && personal.data) personalPhoto = personal.data;
          }

          if (existingProvider) {
            const upd = {
              subscription_active: true,
              subscription_start: now,
              subscription_end: endDate,
            };
            if (personalPhoto) upd.photo = personalPhoto;
            await existingProvider.ref.update(upd);
          } else {
            await db.collection('providers').add({
              name: req.name,
              phone: req.phone,
              // **ولا كلمةَ سرّ هنا:** الجدولُ كلُّه للمشرف، لكن نسخهَ إلى
              // اللوحة تعني أن سرًّا من أسرار الدخول صار نصًّا في مستندٍ لا
              // يقرؤه أحدٌ للدخول أصلاً — الجوّالُ يقرأ بصمةَ الكلمة في
              // `driver_login_index`، لا هذا الجدول.
              plate: '',
              rating: 0,
              is_connected: false,
              subscription_active: true,
              subscription_start: now,
              subscription_end: endDate,
              blocked: false,
              created_at: now,
              photo: personalPhoto || '',
            });
          }

          let docs = [];
          if (Array.isArray(req.documents)) docs = req.documents;
          docs = docs.map(d => ({ ...d, status: 'accepted' }));

          await db.collection('subscription_requests').doc(id).update({
            status: 'approved',
            documents: docs,
            review_note: note || '',
            reviewed_by: ADMIN.full_name,
            reviewed_at: now,
          });
          await logActivity('قبول اشتراك', req.name);
          toast('تم قبول الاشتراك وإنشاء الحساب');
        } else {
          await db.collection('subscription_requests').doc(id).update({
            status: 'rejected',
            review_note: note,
            reviewed_by: ADMIN.full_name,
            reviewed_at: firebase.firestore.FieldValue.serverTimestamp(),
          });
          const r = requestsState.find(x => x.id === id);
          await logActivity('رفض اشتراك', r ? r.name : '');
          toast('تم رفض الاشتراك');
        }
        loadRequests();
        if (requestsFilter === 'pending' || !requestsFilter) loadView('dashboard');
      } catch (err) { toast(err.message, true); }
    },
    { required: !isApprove, confirm: isApprove ? 'قبول' : 'رفض' }
  );
}

let currentReviewId = null;

function openReviewDocs(id) {
  const r = requestsState.find(x => x.id === id);
  if (!r) return toast('لم يتم العثور على الطلب', true);
  let docs = [];
  if (Array.isArray(r.documents)) docs = r.documents;
  else try { docs = JSON.parse(r.documents || '[]'); } catch {}
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

async function saveReviewDocs(btn) {
  const modal = btn.closest('.rv-modal');
  const docs = [];
  let allAccepted = true;
  modal.querySelectorAll('.rv-item').forEach((item) => {
    const checked = item.querySelector('input:checked');
    const noteInp = item.querySelector('.rv-note');
    const status = checked ? checked.value : 'pending';
    const entry = { category: item.dataset.cat, status };
    if (status === 'rejected' && noteInp) entry.note = noteInp.value.trim();
    if (status !== 'accepted') allAccepted = false;
    docs.push(entry);
  });
  btn.disabled = true;
  try {
    const newStatus = allAccepted ? 'approved' : 'needs_resubmission';
    const update = {
      documents: docs,
      status: newStatus,
      reviewed_by: ADMIN.full_name,
      reviewed_at: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (newStatus === 'approved') {
      const reqDoc = await db.collection('subscription_requests').doc(currentReviewId).get();
      const req = reqDoc.data();
      const now = firebase.firestore.FieldValue.serverTimestamp();
      const endDate = new Date(Date.now() + 365 * 24 * 3600 * 1000);
      const provSnap = await db.collection('providers').where('phone', '==', req.phone).limit(1).get();
      let personalPhoto = '';
      if (Array.isArray(req.documents)) {
        const personal = req.documents.find(d => d.category === 'personal');
        if (personal && personal.data) personalPhoto = personal.data;
      }
      if (!provSnap.empty) {
        const upd = { subscription_active: true, subscription_start: now, subscription_end: endDate };
        if (personalPhoto) upd.photo = personalPhoto;
        await provSnap.docs[0].ref.update(upd);
      } else {
        await db.collection('providers').add({
          name: req.name, phone: req.phone, plate: '', rating: 0,
          is_connected: false, subscription_active: true, subscription_start: now, subscription_end: endDate,
          blocked: false, created_at: now, photo: personalPhoto || '',
        });
      }
      await logActivity('قبول اشتراك', req.name);
    }
    await db.collection('subscription_requests').doc(currentReviewId).update(update);
    toast(allAccepted ? 'تم اعتماد الاشتراك تلقائياً وإنشاء الحساب' : 'تم حفظ مراجعة الوثائق');
    modal.closest('.doc-lightbox').remove();
    loadRequests();
    if (requestsFilter === 'pending' || !requestsFilter) loadView('dashboard');
  } catch (err) { btn.disabled = false; toast(err.message, true); }
}

/* ---------- طلبات تسجيل أصحاب التوصيل ---------- */

/*
 * **لا عدد للوثائق مكتوباً في هذا القسم:** العرض والعدّ والفحص كلُّها
 * من `DRIVER_DOC_IDS`، فليست القائمة هنا هي التي تقرّر كم وثيقةً يلزم،
 * بل ما يرسله التطبيق. والوثيقة الخامِسة — تأمين الدراجة — زيدت بهذا
 * الشرط، فزاد عددها في الجدول والمراجعة والفحص معاً بلا سطرٍ آخر.
 */

const DRIVER_DOC_IDS = ['id_card', 'personal_photo', 'grey_card', 'driving_license', 'bike_insurance'];

const DRIVER_DOC_LABELS = {
  id_card: 'بطاقة التعريف',
  personal_photo: 'الصورة الشخصية',
  grey_card: 'البطاقة الرمادية',
  driving_license: 'رخصة السياقة',
  bike_insurance: 'تأمين الدراجة',
};

const DRIVER_STATUS_LABELS = {
  pending: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
  banned: 'مطرود',
};

/* **النصّ الافتراضي للإنذار من شروط التسجيل نفسها:** المشرف غالباً يرسل
 * الإنذار الأول بلا تعديل، وهذا النصّ يطابق بند «المخالفة الأولى: إنذار»
 * الذي وافق عليه صاحب التوصيل عند التسجيل، فلا يأتيه ما لم يوافق عليه.
 * ويبقى قابلاً للتحرير قبل الإرسال. */
const DRIVER_WARNING_DEFAULT =
  'تنبيه رسمي: ضياع الرسالة أو الإخلال بالأمانة مسؤوليتك، وهذه مخالفة أولى وإنذار. ' +
  'وتكرار المخالفة يُغلق حسابك نهائياً دون استرجاع رسوم الاشتراك.';

let driverReqFilter = '';

/* **إنذارات أصحاب التوصيل بمفتاح الرقم:** تُقرأ مع الطلبات لتُعرض حالة
 * الإنذار في العمود نفسه: قائمٌ (لم يُطّلع عليه) أو مُطّلعٌ عليه. ويحمل
 * المستند `count` عدد الإنذارات كلها، فيرى المشرف كم أخطأ صاحب التوصيل. */
let driverWarningsMap = {};

/* **المطرودون مجموعة أرقام:** تُقرأ مع الطلبات لتُعرض حالة الطرد ومنع
 * أزرار الإنذار والطرد على من طُرد سابقاً. */
let driverBannedSet = new Set();

/* **فشل قراءة الإنذارات لا يُسقط جدول الطلبات:** لو لم تُنشر قواعد
 * `driver_warnings` بعد، أو تعذّرت الشبكة، يُعرض الجدول بلا علامة إنذار
 * بدل أن يبقى فارغاً. والعلامة الغائبة أهونُ من جدولٍ لا يُقرأ. */
async function loadDriverWarnings() {
  try {
    const snap = await db.collection('driver_warnings').get();
    const map = {};
    snap.docs.forEach((d) => { map[d.id] = d.data(); });
    return map;
  } catch (err) {
    return {};
  }
}

/* **وقراءة المطرودين لا تُسقط الجدول كذلك:** القاعدة نفسها: علامةٌ غائبة
 * تعني «لا حظر معروف»، فلا يُمنع مشرفٌ من العمل لأن قائمةً لم تُقرأ. */
async function loadBannedDrivers() {
  try {
    const snap = await db.collection('banned_drivers').get();
    return new Set(snap.docs.map((d) => d.id));
  } catch (err) {
    return new Set();
  }
}

async function loadDriverRequests() {
  // **بلا `orderBy` على `createdAt`:** الحقل يُكتب بـ`serverTimestamp` من
  // التطبيق، و`orderBy` على حقل طابع زمني يُنتج استعلاماً مُركّباً
  // (composite) لا تحتاجه لوحة بصف واحد. والأحدث أولاً هنا أقل أهمية من
  // صحّة النتائج: الفرز يتمّ في المتصفّح على القيمة المحسوبة.
  const snap = await db.collection('driver_applications').get();
  driverWarningsMap = await loadDriverWarnings();
  driverBannedSet = await loadBannedDrivers();
  driverArchiveMap = await loadDriverArchives();
  // **ملفّات أصحاب التوصيل الشخصية:** الاسم المعدَّل والصورة يأتيان من
  // `driver_profiles`، فيُدمجان بالرقم. ومن لا مستند له (قُبل قبل الميزة)
  // يبقى على اسم الطلب بلا صورة.
  const profilesSnap = await db.collection('driver_profiles').get();
  const profiles = {};
  profilesSnap.docs.forEach((d) => { profiles[d.id] = d.data() || {}; });
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // **الفرز بعد الجلب لا قبله:** الطابع الزمني يُسخَّن محلياً بعد قراءة
  // المستند، فيصير رقماً يمكن المقارنة به بدل كائن `Timestamp`.
  rows.sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt));
  if (driverReqFilter) rows = rows.filter(r => r.status === driverReqFilter);
  driverReqState = rows;
  driverReqProfiles = profiles;
  renderDriverRequests();
}

let driverReqProfiles = {};

/** رسمُ قائمة التسجيل وحده: الاسمُ المعدَّل والصورةُ من ملفّ صاحبه. */
function renderDriverRequests() {
  const body = $('#driverreq-body');
  if (!body) return;
  const rows = driverReqState.filter((r) => searchHit('driverreq', [r.name, r.phone, r.id]));
  if (!rows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="7">' +
      (driverReqState.length ? 'لا نتيجة لهذا البحث' : 'لا توجد طلبات تسجيل') + '</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((r) => {
      const st = r.status || 'pending';
      const badge = '<span class="badge ' + esc(st) + '">' +
        esc(DRIVER_STATUS_LABELS[st] || st) + '</span>';
      const note = r.review_note ? '<div class="req-note">' + esc(r.review_note) + '</div>' : '';
      // **العدّاد يكشف ما لا يكشفه النصّ:** إنذارٌ واحد أو اثنان أو ثلاثة
      // قرار المشرف مرجعه عدد الأخطاء لا وجود الخطأ. والعلامة قابلة
      // للنقر فتُفتح سجلّ الإنذارات كلها بنصّها وتاريخها.
      const warn = driverWarningsMap[r.id];
      const warnCount = warn ? (Number(warn.count) || 1) : 0;
      const banned = driverBannedSet.has(r.id);
      const warnChip = (!banned && warnCount > 0)
        ? '<span class="badge ' + (warn.acknowledged ? 'approved' : 'rejected') +
            '" style="cursor:pointer" title="عرض سجلّ الإنذارات" ' +
            'onclick="openDriverWarningHistory(\'' + esc(r.id) + '\')">إنذارات: ' + warnCount + '</span>'
        : '';
      let actions = '<div class="row-actions">';
      // **الأزرار تظهر للقيد فقط:** طلب مقبول أو مرفوض لا يُراجَع مرّة
      // ثانية من هنا، فإعادة فتحه تعني إقراراً غير مسجّل على منافس
      // محتمل. وما قبله يُحذف صراحةً إن أراد المشرف تغيير رأيه.
      // **والأرشيفُ يُفتَحُ من كلِّ سطر:** معلَّقًا كانَ الطلبُ أم مقبولًا
      // أم مرفوضًا، فالورقةُ التي يريدُها المشرفُ بعدَ شهرٍ هي الورقةُ
      // نفسُها، والنافذةُ واحدةٌ للقائمةِ كلها.
      actions += '<button class="btn-sm blue" onclick="openDriverArchive(\'' + esc(r.id) + '\')">' +
        (st === 'pending' ? 'مراجعة الوثائق' : 'الوثائق') + '</button>';
      if (st === 'pending') {
        actions +=
          '<button class="btn-sm ok" onclick="reviewDriverRequest(\'' + esc(r.id) + '\',\'approve\')">قبول</button>' +
          '<button class="btn-sm no" onclick="reviewDriverRequest(\'' + esc(r.id) + '\',\'reject\')">رفض</button>';
      }
      // **الإنذار والطرد للمقبول وحده:** هما وسيلتا ضبط حسابٍ قائم، ومن
      // ليس له حساب بعد لا يُنذَر ولا يُطرَد. والمعرّف وحده يُحمل في
      // `onclick` (الاسم فيه محارف تُفسد السطر)، ويُقرأ من الحالة هنا.
      if (st === 'approved' && !banned) {
        actions +=
          '<button class="btn-sm blue" onclick="openDriverWarning(\'' + esc(r.id) + '\')">إنذار</button>' +
          '<button class="btn-sm no" onclick="expelDriver(\'' + esc(r.id) + '\')">طرد وإغلاق الحساب</button>';
      }
      actions += '<button class="btn-sm no" onclick="deleteDriverRequest(\'' + esc(r.id) + '\')">حذف</button></div>';
      // **الاسم المعدَّل والصورة من ملفّه الشخصي:** يُفضَّل اسم الملفّ إن
      // وُجد، وإلا اسم الطلب. والصورة في دائرة كجدول الزبائن، وبديلها
      // الحرف الأول.
      const prof = driverReqProfiles[r.id] || {};
      const dispName = (typeof prof.name === 'string' && prof.name.trim()) ? prof.name : r.name;
      return (
        '<tr>' +
        '<td style="font-size:11px;max-width:90px;overflow:hidden;text-overflow:ellipsis" title="' + esc(r.id) + '">' +
          esc(r.id.substring(0, 10)) + '</td>' +
        '<td>' +
        '<div class="cell-user">' +
        (prof.photo
          ? '<img class="avatar" alt="" src="data:image/jpeg;base64,' + prof.photo + '">'
          : '<span class="avatar avatar-fallback">' + esc(((dispName || '?').trim().charAt(0)) || '?') + '</span>') +
        '<div><strong>' + esc(dispName) + '</strong></div>' +
        '</div></td>' +
        '<td style="direction:ltr;text-align:right">' + esc(r.phone) + '</td>' +
        '<td><span class="doc-chip">' + DRIVER_DOC_IDS.length + ' وثائق</span>' + driverDocSummary(r.id) + '</td>' +
        '<td>' + fmtDate(r.createdAt) + '</td>' +
        '<td>' + badge + warnChip + note + '</td>' +
        '<td>' + actions + '</td>' +
        '</tr>'
      );
    })
    .join('');
}

/* **`millisOf` لأن `createdAt` قد يكون `Timestamp` أو `null`:**
 * الطلب الجديد طابعه محسوم من الخادم، لكن طلباً قديماً كُتب قبل
 * إضافة `createdAt` إلى الخدمة يبقى بلا قيمة. و`null - number` في
 * JavaScript لا يرمي بل يعطي `NaN`، و`sort` بمقارنة تُرجع `NaN` يترك
 * الترتيب كما جاء بلا تغيير. فنُرجع 0 لا `NaN`.
 */
function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ---------- مراجعة وثائق السائق ---------- */

/* **الكاش يمنع إعادة الجلب عند فتح طلب ثانٍ:** الصور base64 ثقيلة
 * (نحو 800 كيلوبايت لكل واحدة)، وبلا كاش تفتح طلبين فتفتح أربع صور
 * مرّة أخرى من الشبكة. والمفتاح رقم الهاتف نفسه: طلب واحد لكل رقم.
 */
let driverDocsCache = null;

async function fetchDriverDocuments(id) {
  if (driverDocsCache && driverDocsCache.id === id) return driverDocsCache.docs;
  const snap = await db.collection('driver_applications').doc(id).collection('documents').get();
  const byId = {};
  snap.docs.forEach((d) => { byId[d.id] = d.data(); });
  const docs = DRIVER_DOC_IDS.map((key) => ({ key: key, label: DRIVER_DOC_LABELS[key], data: byId[key] && byId[key].data }));
  driverDocsCache = { id: id, docs: docs };
  return docs;
}

/* ---------- أرشيفُ الوثائقِ الدائم ---------- */

const DAY_MS = 86400000;

/*
 * **الحالةُ مشتقَّةٌ من التاريخِ لا من ذاكرةِ المشرف:** ورقةٌ «معتمدةٌ» في
 * بطاقةِ المراجعةِ لا تعني أنَّها ساريةٌ اليوم؛ فالمشرفُ يعتمدُها في يناير
 * وتنتهي في ديسمبر، والجدولُ الذي لا يحسبُ يقولُ «كلُّ شيءٍ تمام» بينما
 * التأمينُ ماتَ منذَ أشهر. فالاسمُ الذي يقرؤُهُ هنا محسوبٌ من حالةِ
 * المراجعةِ وتاريخِ الانتهاءِ ومهلَةِ التنبيه، وهوَ الحسابُ نفسُهُ المكتوبُ
 * في Dart، فلا تقولُ اللوحةُ «سارية» وتقولُ شاشةُ السائقِ «منتهية».
 */
function driverDocState(cell, nowMs) {
  const now = nowMs || Date.now();
  if (!cell) return 'missing';
  if (cell.reviewState === 'rejected') return 'rejected';
  if (cell.reviewState === 'staged') return 'renewal';
  if (cell.reviewState !== 'accepted') return 'pending_review';
  const end = millisOf(cell.expiry);
  if (!end) return 'no_date';
  if (end <= now) return 'expired';
  const days = Number(cell.reminderDays) > 0 ? Number(cell.reminderDays) : 30;
  if (end - now <= days * DAY_MS) return 'expiring';
  return 'valid';
}

const DRIVER_DOC_STATE_LABELS = {
  missing: 'لا أثر',
  rejected: 'مرفوضة',
  renewal: 'تجديدٌ قيد النظر',
  pending_review: 'بانتظار النظر',
  no_date: 'معتمدة بلا تاريخ',
  expired: 'منتهية الصلاحية',
  expiring: 'تنتهي قريبًا',
  valid: 'سارية',
};

/* **ولونُ الشارةِ واحدٌ في الجدولِ والنافذة:** «منتهية» حمراءُ في الاثنين،
 * فلا يقرؤُ المشرفُ أخضرَ في عمودٍ وأحمرَ في آخر. */
const DRIVER_DOC_STATE_BADGE = {
  missing: 'banned',
  rejected: 'rejected',
  renewal: 'pending',
  pending_review: 'pending',
  no_date: 'approved',
  expired: 'rejected',
  expiring: 'pending',
  valid: 'approved',
};

/* **التاريخُ يُخزَّنُ طابعًا زمنيًّا ويُعرضُ يومًا:** حقلُ اليومِ لا يعرفُ
 * الطوابعَ والعكسُ صحيح، فنحوِّلُ هنا لا في المستند. والفارغُ معنىً
 * حقيقيّ: «لا تاريخَ بعدُ»، فيُكتَبُ فارغًا صراحةً لا غائبًا،
 * فتعرفُ الورقةُ نفسُها أنَّها بلا تاريخٍ لا أنَّ تاريخَها ضاع. */
function toDateInput(value) {
  const ms = millisOf(value);
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function fromDateInput(value) {
  if (!value) return null;
  const parsed = new Date(value + 'T00:00:00').getTime();
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

/* **ورؤوسُ الأرشيفِ تُقرَأُ معَ الجدولِ لأنَّها بلا صور:** المستندُ رأسٌ
 * صغيرٌ من خمسِ خلايا: حالةٌ وتاريخٌ ومهلة، فقرأتُها كلِّها طلبٌ واحدٌ
 * رخيص. والصورُ لا تُحمَلُ إلّا في النافذةِ عندَ الطلب، وإلّا صارَ فتحُ
 * اللوحةِ عشرينَ ميغابايتٍ من الوثائقِ قبلَ أن ينقرَ المشرفُ على شيء. */
async function loadDriverArchives() {
  try {
    const snap = await db.collection('driver_documents').get();
    const map = {};
    snap.docs.forEach((d) => { map[d.id] = d.data() || {}; });
    return map;
  } catch (err) {
    return {};
  }
}

let driverArchiveMap = {};

/** **علامةُ العمودِ محسوبةٌ من التواريخِ لا من الأسماء:** لا تقرأُ صورةً
 * ولا تُبطِئ الجدولَ، ومن لا أرشيفَ لهُ بلا علامةٍ لا بسطرٍ فارغ. */
function driverDocSummary(phone) {
  const arch = driverArchiveMap[phone];
  if (!arch) return '';
  const cells = arch.docs || {};
  const states = DRIVER_DOC_IDS.map((k) => driverDocState(cells[k]));
  const expired = states.filter((s) => s === 'expired').length;
  const soon = states.filter((s) => s === 'expiring').length;
  if (expired) return '<span class="badge rejected">منتهية: ' + expired + '</span>';
  if (soon) return '<span class="badge pending">تنتهي قريبًا: ' + soon + '</span>';
  return '';
}

/**
 * يفتحُ وثائقَ صاحبِ توصيلٍ واحدٍ بأوجهُها الثلاثة: صورةُ الطلبِ كما
 * أُرسلتْ، وصورَتُهُ المعتمدةُ في الأرشيفِ مع تاريخِها، وصندوقُ تجديدِه.
 *
 * **والنافذةُ من كلِّ سطرٍ لا من المعلَّقِ وحدَه:** القبولُ ليسَ آخرَ مرةٍ
 * يرى فيها المشرفُ الوثيقة؛ فمن حقِّه أن يرجعَ بعدَ شهرٍ ويتحقَّقَ أنَّ
 * التأمينَ كانَ ساريًا يومَ أشعلَ صاحبُ التوصيلِ دراجتَه. والطلباتُ
 * القائمةُ تُحذفُ يومًا، والأرشيفُ يبقى.
 */
function openDriverArchive(id) {
  const r = driverReqState.find((x) => x.id === id);
  const name = r ? esc(r.name) : esc(id);
  openModal({
    title: 'وثائق: ' + name,
    body: '<div class="rv-body" id="arch-body"><div class="rv-empty">جارٍ تحميل الوثائق...</div></div>',
    foot:
      '<span class="rv-hint">التاريخُ بيدِك، والتنبيهَ يقرؤُه صاحبُ التوصيلِ في التطبيق</span>' +
      '<button class="modal-btn ghost" onclick="this.closest(\'.doc-lightbox\').remove()">إغلاق</button>' +
      '<button class="btn-primary" onclick="saveDriverArchive(\'' + esc(id) + '\', this)">حفظ التواريخ والملاحظات</button>',
  });
  renderDriverArchive(id).catch((err) => {
    const host = document.getElementById('arch-body');
    if (host) host.innerHTML = '<div class="rv-empty">تعذّر تحميل الوثائق: ' + esc(err.message) + '</div>';
  });
}

/** يقرأُ الأوجهَ الثلاثةَ معًا ويرسمُها: الطلبُ، فالأرشيفُ، فالصندوق. */
async function renderDriverArchive(id) {
  const [appDocs, files, staged, head] = await Promise.all([
    fetchDriverDocuments(id),
    db.collection('driver_documents').doc(id).collection('files').get(),
    db.collection('driver_documents').doc(id).collection('staged').get().catch(() => null),
    db.collection('driver_documents').doc(id).get(),
  ]);
  const host = document.getElementById('arch-body');
  // **الحارسُ قبلَ الكتابة:** النافذةُ قد تُغلَقُ أو يفتحَ غيرُها أثناءَ
  // الشبكة، فالكتابةُ على عنصرٍ رحلَ تُنشِئُه من جديدٍ في مكانٍ غريب.
  if (!host) return;
  const archived = {};
  files.docs.forEach((d) => { archived[d.id] = d.data() || {}; });
  const incoming = {};
  if (staged) staged.docs.forEach((d) => { incoming[d.id] = d.data() || {}; });
  const cells = (head.data() || {}).docs || {};
  host.innerHTML = appDocs
    .map((d) => archiveRow(id, d, cells[d.key], archived[d.key], incoming[d.key]))
    .join('');
}

/** خليَّةُ وثيقةٍ واحدةٍ في النافذة: صورتُها وتاريخُها وقرارُها. */
function archiveRow(id, d, cell, archived, incoming) {
  const state = driverDocState(cell);
  const shown = (archived && archived.data) || (incoming && incoming.data) || d.data || '';
  const img = shown
    ? '<img class="rv-img" src="data:image/jpeg;base64,' + esc(shown) + '" onclick="openDocImage(this.src, \'' + esc(d.label) + '\')">'
    : '<div class="rv-empty">لا صورة</div>';
  const source = (archived && archived.data)
    ? 'في الأرشيف'
    : (incoming && incoming.data) ? 'تجديدٌ لم يُنظَرْ فيه' : (d.data ? 'صورة الطلب' : 'لا صورة');
  const btns = [];
  if (d.data) {
    btns.push('<button class="btn-sm blue" onclick="copyApplicationDoc(\'' + esc(id) + '\',\'' + d.key + '\')">' +
      (archived && archived.data ? 'نسخ صورة الطلب فوق الأرشيف' : 'اعتماد صورة الطلب في الأرشيف') + '</button>');
  }
  if (incoming && incoming.data) {
    btns.push('<button class="btn-sm ok" onclick="acceptStagedDoc(\'' + esc(id) + '\',\'' + d.key + '\')">اعتماد التجديد</button>');
    btns.push('<button class="btn-sm no" onclick="rejectStagedDoc(\'' + esc(id) + '\',\'' + d.key + '\')">رفض التجديد</button>');
  }
  btns.push('<button class="btn-sm" onclick="notifyDriverDoc(\'' + esc(id) + '\',\'' + d.key + '\')">تنبيه بالتجديد</button>');
  const sel = (v) => (cell && cell.reviewState === v ? ' selected' : '');
  return (
    '<div class="rv-item arch-item" data-doc="' + d.key + '">' +
    '<div class="rv-imgbox">' + img + '</div>' +
    '<div class="rv-meta">' +
    '<strong>' + esc(d.label) +
      ' <span class="badge ' + DRIVER_DOC_STATE_BADGE[state] + '">' + DRIVER_DOC_STATE_LABELS[state] + '</span>' +
      ' <span class="doc-chip">' + source + '</span></strong>' +
    '<div class="rv-btns" style="margin-bottom:8px">' +
      '<select class="modal-input arch-state" style="width:auto">' +
        '<option value="accepted"' + sel('accepted') + '>معتمدة</option>' +
        '<option value="rejected"' + sel('rejected') + '>مرفوضة</option>' +
        '<option value="pending_review"' + sel('pending_review') + '>بانتظار النظر</option>' +
      '</select>' +
      '<input type="date" class="modal-input arch-expiry" style="width:auto" value="' + toDateInput(cell && cell.expiry) + '">' +
      '<input type="number" class="modal-input arch-reminder" style="width:74px" min="1" max="120" title="التنبيه قبل انتهاء المدة بأيام" value="' +
        (cell && Number(cell.reminderDays) > 0 ? Number(cell.reminderDays) : 30) + '">' +
    '</div>' +
    '<input class="modal-input arch-note" maxlength="120" placeholder="ملاحظة المراجعة (لا تظهر لصاحب التوصيل)" value="' +
      esc((cell && cell.note) || '') + '">' +
    '<div class="rv-btns" style="margin-top:8px">' + btns.join('') + '</div>' +
    '</div>' +
    '</div>'
  );
}

/**
 * يحفظُ بطاقةَ المراجعةِ وورقةَ الهاتفِ معًا في `batch` واحدة.
 *
 * **ولماذا مستندان لا مستندٌ واحدٌ بكلِّ الحقول؟** لأنَّ قواعدِ Firestore
 * تعرفُ المستندَ كلَّه ولا تعرفُ حقلاً فيه: لا تستطيعُ أن تُخفيَ ملاحظةَ
 * مشرفٍ عن هاتفٍ يسألُ بتلكَ الملاحظةِ نفسِها. فالوجهُ الأولُ كلُّه
 * للمشرف، والوجهُ الثاني تاريخٌ خالصٌ يقرؤُه صاحبُ الرقم. ولو كتبَ أحدُهما
 * ونجحَ وفشلَ الآخرُ لانقلبتِ الشاشةُ في يدِ المشرفِ عن الشاشةِ في يدِ
 * السائق: ساريةٌ هنا ومنتهيةٌ هناك، ورسالةٌ لا معنى لها في التطبيق.
 */
async function saveDriverArchive(id, btn) {
  const modal = btn.closest('.doc-lightbox');
  if (!modal) return;
  const docs = {};
  const publicDocs = {};
  modal.querySelectorAll('.arch-item').forEach((item) => {
    const key = item.dataset.doc;
    const expiry = fromDateInput(item.querySelector('.arch-expiry').value);
    const reminder = Math.max(1, Math.min(120, Number(item.querySelector('.arch-reminder').value) || 30));
    docs[key] = {
      reviewState: item.querySelector('.arch-state').value,
      expiry: expiry,
      reminderDays: reminder,
      verifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
      reviewedBy: ADMIN.full_name,
      note: item.querySelector('.arch-note').value.trim(),
    };
    // **ومهلةُ التنبيه تُنسَخُ إلى ورقةِ الهاتفِ أيضًا:** بلا هذا الرقمِ
    // تقولُ شاشةُ السائقِ «ساريةٌ» يومًا كاملًا قبلَ أن تقولَها اللوحة،
    // لأنَّها لا تعرفُ متى يبدأُ «قريبًا». فالحسابُ واحدٌ في الواجهتين
    // لأنَّ الاسمَينِ نفسَيهما مكتوبانِ في الورقتين.
    publicDocs[key] = { expiry: expiry, remind: reminder };
  });
  const now = firebase.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(db.collection('driver_documents').doc(id), { phone: id, updatedAt: now, docs: docs }, { merge: true });
  batch.set(db.collection('driver_documents_public').doc(id), { phone: id, updatedAt: now, docs: publicDocs }, { merge: true });
  btn.disabled = true;
  try {
    await batch.commit();
    await logActivity('حفظ أرشيف وثائق صاحب توصيل', id);
    toast('حُفظت التواريخ والملاحظات');
    driverArchiveMap = await loadDriverArchives();
    renderDriverRequests();
  } catch (err) { toast(err.message, true); }
  btn.disabled = false;
}

/** ينسخُ صورةَ الطلبِ إلى الأرشيفِ الدائمِ كما هي، بلا إعادةَ ترميز. */
async function copyApplicationDoc(id, key) {
  try {
    const src = await db.collection('driver_applications').doc(id)
      .collection('documents').doc(key).get();
    if (!src.exists || !(src.data() || {}).data) {
      return toast('لا صورةَ لهذا الطلبِ في هذهِ الوثيقة', true);
    }
    const d = src.data();
    await db.collection('driver_documents').doc(id).collection('files').doc(key).set({
      type: key,
      mime: d.mime || 'image/jpeg',
      bytes: Number(d.bytes) > 0 ? Number(d.bytes) : String(d.data).length,
      data: d.data,
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await logActivity('نسخ وثيقة إلى الأرشيف', id + ' / ' + DRIVER_DOC_LABELS[key]);
    toast('نُسخت الصورة إلى الأرشيف');
    renderDriverArchive(id);
  } catch (err) { toast(err.message, true); }
}

/**
 * يعتمدُ تجديدًا من صندوقِ الهاتف: صورتُه تصيرُ الأرشيف، والصندوقُ يفرغ.
 *
 * **والحذفُ بعدَ النسخِ في طلبٍ واحد:** لو بقيَتِ الصورةُ في الصندوقِ بعدَ
 * اعتمادِها لَكانَ «قيدَ النظرِ» كذبًا، ولرآها المشرفُ مرَّتينِ في كلِّ مرةٍ
 * يفتحُ فيها النافذة، وقد يعتمدُ القديمةَ بعدَ أن اعتمدَ الجديدة.
 */
async function acceptStagedDoc(id, key) {
  try {
    const src = await db.collection('driver_documents').doc(id)
      .collection('staged').doc(key).get();
    if (!src.exists || !(src.data() || {}).data) {
      return toast('لا تجديدَ في هذا الصندوق', true);
    }
    const d = src.data();
    const batch = db.batch();
    batch.set(db.collection('driver_documents').doc(id).collection('files').doc(key), {
      type: key,
      mime: d.mime || 'image/jpeg',
      bytes: Number(d.bytes) > 0 ? Number(d.bytes) : String(d.data).length,
      data: d.data,
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    batch.delete(src.ref);
    await batch.commit();
    await pushDriverNotice(id, key, 'document_accepted', null);
    await logActivity('اعتماد تجديد وثيقة', id + ' / ' + DRIVER_DOC_LABELS[key]);
    toast('اعتمدَ التجديد');
    renderDriverArchive(id);
  } catch (err) { toast(err.message, true); }
}

/**
 * يرفضُ تجديدًا رفعَهُ الهاتف: يُفرَّغُ الصندوقُ ويُرسَلُ الخبر.
 *
 * **ولماذا يُحذفُ ولا يُترَكُ بحالَتِهِ؟** لأنَّ خليةَ الأرشيفِ تصيرُ
 * «قيدَ النظر» بقيدِ وجودِ الصورةِ في الصندوق، فلا شيءَ في المشروعِ يقولُ
 * «نُظِرَ فيهِ ورُفِضَ» غيرَ فراغِهِ بعدَ القرار. ولو بقيَتِ الصورةُ لَظنَّ
 * المشرفُ في فتحِهِ الثاني أنَّ قرارَهُ لم يُمضَ فيعيدُهُ.
 *
 * **والحذفُ بيدِ المشرفِ لا بيدِ الهاتفِ في القواعد،** فالهاتفُ لا يملكُ
 * إثباتًا على عمليةٍ بلا جسدٍ يُقرأُ فيها سرُّهُ.
 */
async function rejectStagedDoc(id, key) {
  askConfirm(
    'رفض التجديد',
    'تُحذفُ الصورةُ المرفوعةُ في الصندوقِ ويصلُ صاحبَ التوصيلِ خبرُ الرفضِ، ' +
      'فيرفعُ غيرَها. الصورةُ المعتمدةُ في الأرشيفِ لا تُمَسّ.',
    async () => {
      try {
        const src = db.collection('driver_documents').doc(id).collection('staged').doc(key);
        const batch = db.batch();
        batch.delete(src);
        await batch.commit();
        await pushDriverNotice(id, key, 'document_rejected', null);
        await logActivity('رفض تجديد وثيقة', id + ' / ' + DRIVER_DOC_LABELS[key]);
        toast('رُفضَ التجديدُ وأُعلِمَ صاحبُ التوصيل');
        renderDriverArchive(id);
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'رفض التجديد' }
  );
}

/**
 * يرسلُ تنبيهًا إلى التطبيق: لا نصَّ في الرسالة، بل نوعُها وورقتُها
 * وتاريخُها، والجملةَ العربيةَ يبني التطبيقُ عندَ صاحبِ التوصيل.
 *
 * **ولا نصَّ حرَّ من اللوحةِ إلى شاشةٍ يفتحُها صاحبُ الرقم:** لا تعرفُ
 * القواعدُ أن تقرأَ معنى جملة، فلو تُرِكَ حقلُ نصٍّ لَكانَ رقمُ زبونٍ أو
 * عنوانُه يصلُ إلى هاتفٍ غيرِ هاتفِه بكتابةٍ من مشرفٍ ظنَّ الرسالةَ
 * خاصةً به. فالرسالةُ نوعٌ من أربعةٍ معروفة، وكلُّ كلامٍ فيها مشتقٌّ.
 */
async function notifyDriverDoc(id, key) {
  const modal = document.querySelector('.doc-lightbox');
  const item = modal ? modal.querySelector('.arch-item[data-doc="' + key + '"]') : null;
  const expiry = item ? fromDateInput(item.querySelector('.arch-expiry').value) : null;
  try {
    await pushDriverNotice(id, key, expiry ? 'document_expiry' : 'renewal_needed', expiry);
    await logActivity('تنبيه بتجديد وثيقة', id + ' / ' + DRIVER_DOC_LABELS[key]);
    toast('أُرسل التنبيه إلى التطبيق');
  } catch (err) { toast(err.message, true); }
}

/**
 * يكتبُ التنبيهَ في مكانينِ لا واحد: سجلٍّ دائمٍ تحتَ بطاقةِ الأرشيفِ لا
 * يقرؤُهُ إلّا المشرف، وخليَّةٍ في ورقةِ التواريخِ يقرؤُها صاحبُ الرقم.
 *
 * **ولماذا مكانانِ والحكُّ واحد؟** لأنَّ السجلَّ تاريخٌ يُراجَعُ يومَ شكَّ
 * أحدٌ («متى نُبهِّهُ؟ كم مرة؟») والخليَّةُ حالةٌ حاضرةٌ تُبنى منها جملةٌ على
 * الشاشة. والأولُ تحتَ يدِ المشرفِ وحدَهُ لأنَّ بابًا مفتوحَ القراءةِ يسرِبُ
 * مسارَ كلِّ رسالةٍ فيهِ على سؤالِ مجموعةٍ واحد، ومسارُ الرسالةِ رقمُ
 * صاحبِها.
 *
 * **والثاني مكتوبٌ بـ `update` لا `set`:** ورقةُ التواريخِ تحملُ تواريخَ
 * كلِّ الوثائق، و`set` يستبدلُ الورقةَ كلَّها بمن كتبَ التنبيهَ — أي أنَّهُ
 * يمسحُ تواريخَ غيرِهِ من الخليةِ التي لم يذكرْها. فمسارُ الحقلِ النقطيِّ
 * يلمسُ خليةَ هذهِ الوثيقةِ وحدَها.
 */
async function pushDriverNotice(id, key, kind, expiresOn) {
  const now = firebase.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(db.collection('driver_documents').doc(id).collection('inbox').doc(key + '_' + Date.now()), {
    kind: kind,
    docType: key,
    expiresOn: expiresOn || null,
    sentAt: now,
  });
  const patch = { updatedAt: now };
  patch['notices.' + key] = { kind: kind, sentAt: now };
  batch.update(db.collection('driver_documents_public').doc(id), patch);
  await batch.commit();
}

/**
 * يقبل أو يرفض طلب تسجيل، والقبول يُنشئ حساب السائق.
 *
 * **والقبول عملية واحدة في `batch` لا ثلاث عمليات متتابعة:**
 * نكتب `driver_accounts` و`driver_login_index` و`status` معاً. فلو
 * نجحت الأولى وفشلت الثانية لبقي في Firestore حساب سائق لا يستطيع
 * الدخول (لا فهرس له) بينما الطلب ما زال «قيد المراجعة» في الجدول —
 * حالة لا يعرفها أحد ولا يصلحها أحد. و`batch` يجعلها إما أن تَتمّ أو لا.
 *
 * **والصور لا تُحذف بعد القبول:** نُبقيها كسجلّ مراجعة. لو حذفناها
 * فالقبول صار قراراً بلا دليل، وأيّ شكّ لاحق في الوثائق لا يجد ما يرجع
 * إليه. والطلب نفسه يحمل `reviewed_by` و`reviewed_at`.
 */
async function reviewDriverRequest(id, action) {
  const r = driverReqState.find((x) => x.id === id);
  const label = r ? r.name : id;

  if (action === 'reject') {
    askText(
      'رفض طلب التسجيل',
      'سبب الرفض (يظهر لصاحب التوصيل عند طلبه من جديد)',
      async (note) => {
        try {
          await db.collection('driver_applications').doc(id).update({
            status: 'rejected',
            review_note: note || '',
            reviewed_by: ADMIN.full_name,
            reviewed_at: firebase.firestore.FieldValue.serverTimestamp(),
          });
          await logActivity('رفض تسجيل صاحب توصيل', label);
          toast('تم رفض الطلب');
          refreshNavBadges();
          loadDriverRequests();
        } catch (err) { toast(err.message, true); }
      },
      { required: true, confirm: 'رفض' }
    );
    return;
  }

  askConfirm(
    'قبول طلب التسجيل',
    'سيُنشأ حساب لصاحب التوصيل "<strong>' + esc(label) + '</strong>" بكلمة المرور التي اختارها، ' +
      'فيدخل التطبيق بعدها مباشرة.<br><br>' +
      '<strong>لن يظهر للزبائن</strong>: القبولُ وحده لا يُعطي ظهوراً. ' +
      'امنحه من «بطاقة القرار» في جدول أصحاب التوصيل فترةً تجريبية بمدةٍ تحددها، ' +
      'أو انتظر حتى يدفع اشتراكه الشهري.<br><br>' +
      '<strong>وتُنسخُ الصورُ الخمسُ إلى أرشيفٍ دائم</strong> تراجعه متى شئت بعد القبول، ' +
      'فتضعُ فيهِ تاريخَ انتهاءِ كلِّ ورقةٍ ومهلَ تنبيهها. هل تريد القبول؟',
    async () => {
      try {
        const ref = db.collection('driver_applications').doc(id);
        const snap = await ref.get();
        const data = snap.data() || {};
        const hash = data.passwordHash;
        // **لا قبول بلا بصمة:** الحساب يُنشأ من `passwordHash` المحفوظ في
        // الطلب، فإن غاب الحقل لا حساب يُنشأ ولا يدخل أحد. والكتابة
        // حساباً ببصمة فارغة كان سيعني حساباً يُفتح بكلمة مرور أيّها.
        if (typeof hash !== 'string' || hash.length !== 64) {
          toast('لا توجد كلمة مرور مخزَّنة لهذا الطلب، لا يمكن القبول', true);
          return;
        }
        // **ولا قبولَ قبلَ أن تُقرأَ الصورُ كلُّها:** الأرشيفُ الدائمُ
        // يُولَدُ من صورِ الطلبِ في هذا الطلبِ نفسِه، فمن بقيَت واحدةٌ من
        // خمسٍ بلا صورةٍ وُلِدَ أرشيفُ رقمٍ ناقصٌ ولا يملأُ أحدٌ فراغَهُ بعدَ
        // أن صارَ الحسابُ حيًّا. والعدُّ هنا ليسَ زينةً في الشاشةِ بل شرطٌ
        // في الكتابة: لا حسابَ ولا أرشيفَ حتى تكتملَ الأوراقُ الخمس.
        const imgsSnap = await ref.collection('documents').get();
        const images = {};
        imgsSnap.docs.forEach((d) => {
          const v = d.data() || {};
          if (v.data) images[d.id] = v;
        });
        const missing = DRIVER_DOC_IDS.filter((k) => !images[k]);
        if (missing.length) {
          toast('لا قبول: تنقص ' + missing.length + ' وثيقة — ' +
            missing.map((k) => DRIVER_DOC_LABELS[k]).join('، '), true);
          return;
        }
        const now = firebase.firestore.FieldValue.serverTimestamp();
        const batch = db.batch();
        batch.set(db.collection('driver_accounts').doc(id), {
          phone: data.phone || id,
          name: data.name || '',
          passwordHash: hash,
          status: 'active',
          createdAt: now,
        });
        batch.set(db.collection('driver_login_index').doc(id), {
          passwordHash: hash,
        });
        // **ملفّ صاحب التوصيل الشخصي يُنشأ هنا باسمه:** فيجد اسمه مكتوباً
        // في شاشة ملفّه لا فارغاً، ويعدّله من التطبيق بعدها. و`merge` حتى
        // لا يمحو صورةً رفعها لو أُعيد القبول بعد رفض.
        batch.set(db.collection('driver_profiles').doc(id), {
          name: data.name || '',
          createdAt: now,
        }, { merge: true });
        // **`update` لا `set`:** الطلب مستند فيه `name` و`phone` و
        // `passwordHash` و`createdAt`. و`set` بلا `merge` يستبدل المستند
        // كاملاً فيمحو الاسم والبصمة وتاريخ التقديم، فيصبح القبول بلا
        // أثر يُراجَع ولا يستطيع المشرف قراءة ما قبله. الحقول الأربعة
        // تُقرأ من `data` هنا ولا داعي لكتابتها أصلاً.
        batch.update(ref, {
          status: 'approved',
          review_note: '',
          reviewed_by: ADMIN.full_name,
          reviewed_at: now,
        });
        // **والأرشيفُ يُولَدُ معَ الحسابِ لا بعدَهُ في طلبٍ ثانٍ:** لو
        // أُنشِئَ الحسابُ ثمَّ فشِلَت نسخةُ الأرشيفِ لَكانَ عندَ المشرفِ سائقٌ
        // حيٌّ بلا وثيقةٍ يراجعُها، ولَما وجدَ التطبيقُ ورقةَ تواريخَ يقرؤها
        // صاحبُها. فالكتاباتُ كلُّها هنا — الحسابُ والفهرسُ والملفُّ والطلبُ
        // والأرشيفُ والورقةُ العامة — في `batch` واحدة: إمّا أن يكونَ كلُّ
        // شيءٍ أو لا يكونَ شيء.
        //
        // **و`reviewState: 'accepted'` عندَ القبولِ صدقٌ لا افتراض:**
        // المشرفُ ضغطَ «قبول» على هذا الطلبِ بعينِه بعدَ أن نظرَ في
        // وثائقِه، فما في الأرشيفِ هوَ ما رآهُ لا ما يُفتَرَضُ أنَّهُ رآهُ.
        // ويبقى التاريخُ فارغًا حتى يضعَهُ بيدِه في النافذة.
        const cells = {};
        const publicCells = {};
        DRIVER_DOC_IDS.forEach((k) => {
          cells[k] = {
            reviewState: 'accepted', expiry: null, reminderDays: 30,
            verifiedAt: now, reviewedBy: ADMIN.full_name, note: '',
          };
          publicCells[k] = { expiry: null, remind: 30 };
          batch.set(db.collection('driver_documents').doc(id).collection('files').doc(k), {
            type: k,
            mime: images[k].mime || 'image/jpeg',
            bytes: Number(images[k].bytes) > 0 ? Number(images[k].bytes) : String(images[k].data).length,
            data: images[k].data,
            uploadedAt: now,
          });
        });
        batch.set(db.collection('driver_documents').doc(id), {
          phone: id, updatedAt: now, docs: cells,
        }, { merge: true });
        // **وجهُ الهاتفِ في الطلبِ نفسِه:** ورقةُ التواريخِ وحدَها، بلا حالةِ
        // مراجعةٍ ولا ملاحظةٍ ولا اسمِ مراجع، لأنَّ صاحبَ الرقمِ يقرؤُها
        // بمفتاحِ رقمِه فما يُكتَبُ هنا يقرؤُهُ كلُّ مَن كتبَ الرقمَ في المسار.
        batch.set(db.collection('driver_documents_public').doc(id), {
          phone: id, updatedAt: now, docs: publicCells,
        }, { merge: true });
        await batch.commit();
        await logActivity('قبول تسجيل صاحب توصيل', label);
        toast('تم القبول وأُنشئ الحساب');
        refreshNavBadges();
        loadDriverRequests();
      } catch (err) { toast(err.message, true); }
    },
    { confirm: 'قبول' }
  );
}

/**
 * يحذف طلب تسجيل وصوره نهائياً.
 *
 * **والحذف يقتظر قراراً لا دعوة للتراجع:** القواعد تمنع التطبيق من
 * التعديل أو الحذف (وإلا استُبدل طلب معلّق بمحتوى لم يره المشرف)، فالحذف
 * قرار المشرف وحده. ولا يُحذف طلب إلا في حالتين: طلبٌ مرفوض ثم أراد
 * صاحب التوصيل إعادة التقديم بنفس الرقم، أو طلب تجريبي.
 */
function deleteDriverRequest(id) {
  const r = driverReqState.find((x) => x.id === id);
  const name = r ? r.name : id;
  askConfirm(
    'حذف طلب التسجيل',
    'سيُحذف طلب "<strong>' + esc(name) + '</strong>" مع صور وثائقه (' +
      DRIVER_DOC_IDS.length + ') نهائياً.<br>لا يمكن التراجع.<br><br>' +
      '<strong>ويستطيع صاحب التوصيل بعد هذا الحذف أن يرسل طلباً جديداً بنفس الرقم</strong>: ' +
      'فالرقمُ المسجَّلُ من قبلُ هو الذي يمنعُ الطلبَ المكرر، والحذفُ يرفعُ ذلك المنع. ' +
      'لهذا يُحذفُ الطلبُ المرفوضُ حينَ يريدُ صاحبُه أن يعيدَ التقديم.<br><br>' +
      '<strong>وأرشيفُ الوثائقِ المعتمدُ لا يُمَسّ</strong>: إن كانَ هذا الرقمُ مقبولاً من قبلُ ' +
      'فصورُه المعتمدةُ وتواريخُها تبقى للمراجعة، لأنَّ الأرشيفَ سجلٌّ لا فرعٌ من الطلب.',
    async () => {
      try {
        // **حذف الرأس لا يحذف صور الوثائق:** Firestore لا يُزيل
        // المجموعات الفرعية عند حذف المستند الأب. حذف الرأس وحده يترك
        // أربع صور base64 يتيمة: نحو 3.2 ميغابايت لكل طلب محذوف، مع
        // تكلفة قراءة على كل من يعدّ المستند لاحقاً، وتبقى قابلة للعودة
        // لو أُعيد فتح الحساب. فكل كتابة تُجمَع في `batch` واحدة.
        const ref = db.collection('driver_applications').doc(id);
        const docs = await ref.collection('documents').get();
        const batch = db.batch();
        docs.docs.forEach((d) => batch.delete(d.ref));
        batch.delete(ref);
        await batch.commit();
        await logActivity('حذف طلب تسجيل صاحب توصيل', name);
        toast('تم حذف الطلب' + (docs.size ? ' وصوره' : ''));
        if (driverDocsCache && driverDocsCache.id === id) driverDocsCache = null;
        refreshNavBadges();
        loadDriverRequests();
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'حذف' }
  );
}

/**
 * يرسل إنذاراً لصاحب توصيل معتمد، فيظهر في شاشته بطاقةً حتى يطّلع عليه.
 *
 * **يُكتب بمعرّف هو الرقم، فيقرؤه التطبيق بـ`get`:** لا استعلام على
 * المجموعة، والقواعد تسمح للتطبيق بقراءة مستندٍ واحد بمعرّفه كما فهرس
 * الدخول. ولهذا المعرّف رقم لا معرّف عشوائي.
 *
 * **و`set` بدمج يصفّر الاطّلاع ويُبقي العدّاد:** `acknowledged: false`
 * يُكتب صراحةً فيعود الإنذار قائماً بعد كل إرسال، و`count` يزيد واحداً
 * بـ`increment` فلا يُمحى عدد الإنذارات السابقة. والمعرّف الرقمي نفسه
 * يعني أن إنذاراً جديداً يُحدّث المستند لا ينشئ ثانياً.
 *
 * **وكل إنذار يُسجّل مستنداً في سجلّ `history`:** فالعدّاد يقول «كم»،
 * والسجلّ يقول «ماذا ومتى ومن». وبهما يقرّر المشرف: إنذار ثانٍ أم طرد.
 */
function openDriverWarning(id) {
  const r = driverReqState.find((x) => x.id === id);
  const name = r ? r.name : id;
  const current = driverWarningsMap[id];
  askText(
    'إرسال إنذار',
    'نصّ الإنذار الذي سيظهر لصاحب التوصيل في شاشته',
    async (message) => {
      try {
        const ref = db.collection('driver_warnings').doc(id);
        const batch = db.batch();
        batch.set(ref, {
          phone: id,
          message: message,
          admin_name: ADMIN.full_name,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
          acknowledged: false,
          count: firebase.firestore.FieldValue.increment(1),
        }, { merge: true });
        batch.set(ref.collection('history').doc(), {
          message: message,
          admin_name: ADMIN.full_name,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await batch.commit();
        await logActivity('إرسال إنذار لصاحب توصيل', name);
        toast('تم إرسال الإنذار');
        loadDriverRequests();
      } catch (err) { toast(err.message, true); }
    },
    {
      required: true,
      confirm: 'إرسال',
      value: (current && current.message) ? current.message : DRIVER_WARNING_DEFAULT,
    }
  );
}

/**
 * يعرض سجلّ إنذارات صاحب التوصيل: نصّ كل إنذار وتاريخه ومن أرسله.
 *
 * **الترتيب تنازلي لا تصاعدي:** الأحدث أولاً هو ما يهمّ المشرف قبل قرار
 * الطرد، والسجلّ قد يطول. والترتيب على حقل واحد بلا فهرس مركّب.
 */
function openDriverWarningHistory(id) {
  const r = driverReqState.find((x) => x.id === id);
  const name = r ? esc(r.name) : id;
  openModal({
    title: 'سجلّ إنذارات: ' + name,
    body: '<div id="warn-history" class="rv-body"><div class="rv-empty">جارٍ تحميل السجلّ...</div></div>',
    foot: '<button class="modal-btn ghost" onclick="this.closest(\'.doc-lightbox\').remove()">إغلاق</button>',
  });
  db.collection('driver_warnings').doc(id).collection('history')
    .orderBy('created_at', 'desc').get()
    .then((snap) => {
      const host = document.getElementById('warn-history');
      // **الحارس يمنع الكتابة على عنصر رحل:** الفتح أخذ زمن الشبكة، فقد
      // يُغلق المشرف النافذة قبل وصول السجلّ.
      if (!host) return;
      if (snap.empty) {
        host.innerHTML = '<div class="rv-empty">لا إنذارات مسجّلة</div>';
        return;
      }
      host.innerHTML = snap.docs.map((d, i) => {
        const w = d.data();
        return '<div class="rv-item"><div class="rv-meta">' +
          '<strong>إنذار ' + (snap.size - i) + '</strong>' +
          '<span class="act-time">' + fmtDate(w.created_at) + ' — ' + esc(w.admin_name || '') + '</span>' +
          '<p>' + esc(w.message || '') + '</p>' +
          '</div></div>';
      }).join('');
    })
    .catch((err) => {
      const host = document.getElementById('warn-history');
      if (host) host.innerHTML = '<div class="rv-empty">تعذّر تحميل السجلّ: ' + esc(err.message) + '</div>';
    });
}

/**
 * يطرد صاحب توصيل نهائياً: يغلق حسابه ويمنع رقمه من التسجيل لاحقاً.
 *
 * **ليس تعطيلاً بل إغلاقٌ دائم:** يُحذف الحساب وفهرس الدخول ومستند
 * التوفّر في `batch` واحدة، فيصير الرقم لا يدخل. ثم يُكتب
 * `banned_drivers/{phone}` وبه ترفض القاعدة أي طلب تسجيل جديد بالرقم
 * نفسه — حتى لو حاول أحد الكتابة إلى Firestore مباشرة. وهذا هو بند
 * «تكرار المخالفة: إغلاق الحساب نهائياً» في شروط التسجيل.
 *
 * **وطلب التسجيل يبقى بعلامته:** لا يُحذف، بل حالته تصير `banned` فيبقى
 * في الجدول سجلاً مرئياً لمن طُرد، ولا تعود عليه أزرار الإنذار أو الطرد.
 *
 * **ولماذا يُطلب السبب؟** الطرد لا رجعة فيه، فسطرٌ مكتوب يجعل القرار
 * مقصوداً لا نقرةً عابرة، ويُسجَّل في سجلّ النشاط للمراجعة.
 */
function expelDriver(id) {
  const r = driverReqState.find((x) => x.id === id);
  const name = r ? r.name : id;
  const warnCount = (driverWarningsMap[id] && Number(driverWarningsMap[id].count)) || 0;
  askText(
    'طرد وإغلاق الحساب نهائياً',
    'سبب الطرد (يُسجَّل في سجلّ النشاط ولا يظهر لصاحب التوصيل)',
    async (reason) => {
      try {
        const batch = db.batch();
        batch.delete(db.collection('driver_accounts').doc(id));
        batch.delete(db.collection('driver_login_index').doc(id));
        batch.delete(db.collection('driver_public').doc(id));
        batch.delete(db.collection('driver_profiles').doc(id));
        batch.set(db.collection('banned_drivers').doc(id), {
          phone: id,
          reason: reason,
          admin_name: ADMIN.full_name,
          banned_at: firebase.firestore.FieldValue.serverTimestamp(),
          warnings_count: warnCount,
        });
        batch.update(db.collection('driver_applications').doc(id), {
          status: 'banned',
          review_note: reason,
          reviewed_by: ADMIN.full_name,
          reviewed_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await batch.commit();
        await logActivity('طرد صاحب توصيل وإغلاق حسابه', name);
        toast('تم الطرد ومنع الرقم من التسجيل');
        refreshNavBadges();
        loadDriverRequests();
      } catch (err) { toast(err.message, true); }
    },
    { required: true, confirm: 'طرد نهائي' }
  );
}

/* ---------- Orders ---------- */

let ordersFilter = '';

async function loadOrders() {
  const q = ($('#orders-search') ? $('#orders-search').value : '').trim();
  const snap = await db.collection('orders').orderBy('created_at', 'desc').get();
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (ordersFilter) rows = rows.filter(o => o.status === ordersFilter);
  if (q) {
    const ql = q.toLowerCase();
    rows = rows.filter(o => (o.customer_name || '').toLowerCase().includes(ql) || (o.from_area || '').toLowerCase().includes(ql) || (o.to_area || '').toLowerCase().includes(ql));
  }
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
          ? '<button class="btn-sm ok" onclick="changeOrderStatus(\'' + o.id + '\',\'accepted\')">قبول</button>'
          : next
          ? '<button class="btn-sm blue" onclick="changeOrderStatus(\'' + o.id + '\',\'' + next + '\')">' + (next === 'completed' ? 'إنهاء' : 'التالي') + '</button>'
          : '<span class="badge ' + o.status + '">' + esc(STATUS_LABELS[o.status]) + '</span>';
      return (
        '<tr>' +
        '<td style="font-size:11px;max-width:80px;overflow:hidden;text-overflow:ellipsis" title="' + esc(o.id) + '">' + esc(o.id.substring(0, 8)) + '</td>' +
        '<td><strong>' + esc(o.customer_name) + '</strong></td>' +
        '<td>' + esc(o.from_area) + '</td>' +
        '<td>' + esc(o.to_area) + '</td>' +
        '<td>' + fmtMoney(o.total) + '</td>' +
        '<td>' + (o.provider_name ? esc(o.provider_name) : '<span class="badge new">غير مسند</span>') + '</td>' +
        '<td><span class="badge ' + o.status + '">' + esc(STATUS_LABELS[o.status]) + '</span></td>' +
        '<td><div class="row-actions">' +
        (o.status === 'new' ? '<button class="btn-sm blue" onclick="assignOrder(\'' + o.id + '\')">إسناد</button>' : '') +
        actions +
        (o.status === 'rejected' ? '<button class="btn-sm ok" onclick="changeOrderStatus(\'' + o.id + '\',\'accepted\')">إعادة</button>' : '') +
        '<button class="btn-sm blue" onclick="editOrder(\'' + o.id + '\')">تعديل</button>' +
        '<button class="btn-sm no" onclick="deleteOrder(\'' + o.id + '\')">حذف</button>' +
        '</div></td>' +
        '</tr>'
      );
    })
    .join('');
}

async function changeOrderStatus(id, status) {
  try {
    await db.collection('orders').doc(id).update({ status });
    await logActivity('تغيير حالة الطلب', id.substring(0, 8) + ' ← ' + (STATUS_LABELS[status] || status));
    toast('تم تحديث الطلب');
    loadOrders();
    loadDashboard();
  } catch (err) { toast(err.message, true); }
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
    title: 'إسناد الطلب',
    body: '<select id="assign-provider" class="modal-input">' + options + '</select>',
    foot:
      '<button class="modal-btn ghost" data-close>إلغاء</button>' +
      '<button class="modal-btn ok" data-submit>إسناد</button>',
  });
  const sel = overlay.querySelector('#assign-provider');
  sel.focus();
  overlay.querySelector('[data-submit]').addEventListener('click', async () => {
    const provId = sel.value;
    const prov = providersState.find((x) => x.id === provId);
    overlay.remove();
    try {
      await db.collection('orders').doc(id).update({
        provider_id: provId,
        provider_name: prov.name,
        status: 'accepted',
      });
      await logActivity('إسناد طلب', id.substring(0, 8) + ' → ' + prov.name);
      toast('تم إسناد الطلب إلى ' + prov.name);
      loadOrders();
    } catch (err) { toast(err.message, true); }
  });
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
}

const ORDER_STATUSES = ['new', 'accepted', 'en_route', 'completed', 'rejected'];

function addOrder() {
  const overlay = openModal({
    title: 'إرسال طلب توصيل',
    body:
      '<label class="modal-label">اسم الزبون</label>' +
      '<input id="ao-name" class="modal-input" type="text" placeholder="مثال: أحمد محمد">' +
      '<label class="modal-label">هاتف الزبون</label>' +
      '<input id="ao-phone" class="modal-input" type="text" placeholder="مثال: +222 33 123 45 67">' +
      '<label class="modal-label">من</label>' +
      '<input id="ao-from" class="modal-input" type="text" placeholder="مثال: تفرغ زينة">' +
      '<label class="modal-label">إلى</label>' +
      '<input id="ao-to" class="modal-input" type="text" placeholder="مثال: تيارت">' +
      '<label class="modal-label">الوصف (اختياري)</label>' +
      '<input id="ao-desc" class="modal-input" type="text" placeholder="مثال: كرتونة طعام">' +
      '<label class="modal-label">السعر (أوقية، بين 100 و 250)</label>' +
      '<input id="ao-total" class="modal-input" type="number" min="100" max="250" step="1" value="150">',
    foot:
      '<button class="modal-btn ghost" data-close>إلغاء</button>' +
      '<button class="modal-btn ok" data-submit>إرسال الطلب</button>',
  });
  const save = async () => {
    const name = overlay.querySelector('#ao-name').value.trim();
    const phone = overlay.querySelector('#ao-phone').value.trim();
    const fromArea = overlay.querySelector('#ao-from').value.trim();
    const toArea = overlay.querySelector('#ao-to').value.trim();
    const total = Number(overlay.querySelector('#ao-total').value);
    if (!name) { toast('أدخل اسم الزبون', true); return; }
    if (!phone) { toast('أدخل هاتف الزبون', true); return; }
    if (!fromArea || !toArea) { toast('أدخل نقطة الانطلاق والوصول', true); return; }
    if (!Number.isFinite(total) || total < 100 || total > 250) {
      toast('سعر الرحلة يجب أن يكون بين 100 و 250 أوقية', true);
      return;
    }
    const typeIndex = total <= 100 ? 0 : (total <= 150 ? 1 : 2);
    const description = overlay.querySelector('#ao-desc').value.trim();
    overlay.remove();
    try {
      const doc = await db.collection('orders').add({
        customer_name: name,
        customer_phone: phone,
        service: 'delivery',
        from_area: fromArea,
        to_area: toArea,
        km: 0,
        base: total,
        rate: 0,
        total: total,
        status: 'new',
        payment_method: 'cash',
        description: description,
        type_index: typeIndex,
        provider_id: null,
        provider_name: '',
        from_lat: null,
        from_lng: null,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
        completed_at: null,
      });
      await logActivity('إرسال طلب توصيل', name + ' — ' + fromArea + ' ← ' + toArea);
      toast('تم إرسال طلب التوصيل');
      loadOrders();
      loadDashboard();
    } catch (err) { toast(err.message, true); }
  };
  overlay.querySelector('[data-submit]').addEventListener('click', save);
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
}

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
    title: 'تعديل الرحلة',
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
  const save = async () => {
    const price = Number(overlay.querySelector('#eo-total').value);
    if (!Number.isFinite(price) || price < 100 || price > 250) {
      toast('سعر الرحلة يجب أن يكون بين 100 و 250 أوقية', true);
      return;
    }
    const updateData = {
      customer_name: overlay.querySelector('#eo-name').value.trim(),
      from_area: overlay.querySelector('#eo-from').value.trim(),
      to_area: overlay.querySelector('#eo-to').value.trim(),
      total: price,
      payment_method: overlay.querySelector('#eo-pay').value,
      status: overlay.querySelector('#eo-status').value,
    };
    overlay.remove();
    try {
      await db.collection('orders').doc(id).update(updateData);
      await logActivity('تعديل رحلة', id.substring(0, 8));
      toast('تم حفظ تعديل الرحلة');
      loadOrders();
      loadDashboard();
    } catch (err) { toast(err.message, true); }
  };
  overlay.querySelector('[data-submit]').addEventListener('click', save);
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
}

function deleteOrder(id) {
  const o = ordersState.find((x) => x.id === id);
  askConfirm(
    'حذف الرحلة',
    'هل تريد حذف الرحلة لـ "' + esc(o ? o.customer_name : '') + '" نهائياً؟<br>لن يستطيع أحد عرضها بعد الآن.',
    async () => {
      try {
        await db.collection('orders').doc(id).delete();
        await logActivity('حذف رحلة', o ? o.customer_name : '');
        toast('تم حذف الرحلة');
        loadOrders();
        loadDashboard();
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'حذف نهائي' }
  );
}

/* ---------- Providers ---------- */

/**
 * ظهور صاحب التوصيل للزبائن، بمقياس الزبون نفسه لا بمقياس آخر.
 *
 * **الثلاث قيم في تطبيق الهاتف:** نصف القطر 1 كم (`nearbyDriversMaxKm`)،
 * والنبض كل دقيقة (`driverLocationHeartbeatInterval`)، والنافذة ثلاث دقائق
 * (`nearbyDriversStaleAfter`). فالمشرف يرى «قديماً» بما يُخفى به السائق عن
 * الزبون فعلاً، وإلا عرضت اللوحة «متاحاً» لا يراه زبونٌ فتضلّل المشرف.
 */
const DRIVER_STALE_MS = 3 * 60 * 1000;

/** يقرأ `driver_public` لأرقام أصحاب التوصيل كلها، مستنداً لكل رقم. */
async function loadPresence(phones) {
  const docs = await Promise.all(
    phones.map((phone) =>
      db
        .collection('driver_public')
        .doc(phone)
        .get()
        // **بجهد مبذول:** رقمٌ بلا مستند، أو قراءة رُفضت، تُقرأ «لا ظهور»
        // لا تُعطّل الجدول كلّه؛ فاللوحة تخدم المشرف لا تخدم Firestore.
        .then((d) => (d.exists ? d.data() : null))
        .catch(() => null)
    )
  );
  const byPhone = {};
  phones.forEach((phone, i) => {
    const data = docs[i];
    if (!data) return;
    const at = data.locationAt;
    byPhone[phone] = {
      available: data.available === true,
      lat: typeof data.lat === 'number' ? data.lat : null,
      lng: typeof data.lng === 'number' ? data.lng : null,
      atMs: at && typeof at.toMillis === 'function' ? at.toMillis() : null,
    };
  });
  return byPhone;
}

/** خلية الظهور: ما يراه الزبون الآن عن هذا الرقم. */
function presenceCell(presence) {
  // **الأخضر حضورٌ، والرمادي غيابٌ، والأحمر تناقض:** «متاح الآن» أزرق،
  // و«غير متاح»/«لا ظهور» رماديّان لأنهما قرار السائق لا عطله، ولا يُحمَل
  // المشرف همّهما. والأحمر حالة واحدة: المفتاح مفعّل والنبض انقطع.
  if (!presence) return '<span class="badge offline">لا ظهور</span>';
  if (!presence.available) return '<span class="badge offline">غير متاح</span>';
  // **بلا زمن:** مستندٌ «متاح» لم يكتب قطّ لحظة قياس — قديمٌ من بناءٍ سابق
  // أو كتابةٌ يدوية من اللوحة. كذبٌ أخضر أمّاه، فأصفرٌ يسأل المشرف عنه.
  if (presence.atMs === null) return '<span class="badge pending">متاح · بلا زمن</span>';
  const ageMs = Date.now() - presence.atMs;
  if (ageMs <= DRIVER_STALE_MS) return '<span class="badge online">متاح الآن</span>';
  // **انقطع نبضه:** المفتاح «متاح» كتابةٌ من زمنٍ مضى، والزبون أسقطه من
  // دائرته. هذه هي الحالة التي يسأل المشرف عنها حين يقول سائقٌ
  // «لا يتصل بي أحد» وهو يظنّ نفسه ظاهراً للزبائن.
  const mins = Math.round(ageMs / 60000);
  return '<span class="badge rejected">نبضه انقطع قبل ' + mins + ' د</span>';
}

/**
 * إحداثيات الزبائن المُسلَّمة لأصحاب التوصيل: `trip_requests/{phone}`.
 *
 * **ولماذا هي عمودٌ هنا؟** لأنّها الشقّ الثاني من الدائرة: الزبون يرى
 * القريبين ويتّصل، فإذا تمت المكالمة سُلِّم العنوان إلى السائق. وحين يقول
 * سائقٌ «جاءني طلبٌ بموقعٍ خاطئ» أو «المكالمة تمت ولم يأتني موقع»، كان
 * الجواب في هذه الخلية لا في سؤال الزبون.
 *
 * **والقراءة بالرقم لا بالسرد:** القواعد تمنع `list` على `trip_requests`
 * وتفتح `get`، ومفتاح المستند هو رقم السائق — فأرقام اللوحة معروفة سلفاً،
 * فلا حاجة إلى سردٍ محظور.
 */
async function loadHandovers(phones) {
  const docs = await Promise.all(
    phones.map((phone) =>
      db
        .collection('trip_requests')
        .doc(phone)
        .get()
        .then((d) => (d.exists ? d.data() : null))
        .catch(() => null)
    )
  );
  const byPhone = {};
  phones.forEach((phone, i) => {
    const data = docs[i];
    if (!data) return;
    const at = data.createdAt;
    byPhone[phone] = {
      customerPhone: typeof data.customerPhone === 'string' ? data.customerPhone : '',
      lat: typeof data.lat === 'number' ? data.lat : null,
      lng: typeof data.lng === 'number' ? data.lng : null,
      atMs: at && typeof at.toMillis === 'function' ? at.toMillis() : null,
    };
  });
  return byPhone;
}

/** خلية التسليم: عنوانُ زبونٍ ينتظر هذا السائق، أو لا شيء. */
function handoverCell(handover) {
  if (!handover) return '<span class="badge offline">بلا تسليم</span>';
  // **(0,0) كذبٌ معروف:** منتصف المحيط ليس عنواناً. التطبيق لم يعد يكتبه
  // حين صارت الإحداثيات تُسلَّم بعد المكالمة وبشرط وجودها، لكن نسخ APK
  // القديمة في السوق تكتبه — فاللوحة تُنبّه ولا تعرض «مُسلَّم» على لا شيء.
  if (handover.lat === 0 && handover.lng === 0) {
    return '<span class="badge rejected">موقع كاذب (0,0)</span>';
  }
  if (handover.lat === null || handover.lng === null) {
    return '<span class="badge pending">طلبٌ بلا إحداثيات</span>';
  }
  const coords = handover.lat.toFixed(4) + ', ' + handover.lng.toFixed(4);
  const age = handover.atMs === null
    ? ''
    : ' · منذ ' + Math.max(0, Math.round((Date.now() - handover.atMs) / 60000)) + ' د';
  return (
    '<span class="badge accepted">مُسلَّم' + age + '</span>' +
    '<div style="font-size:11px;color:var(--gray);direction:ltr">' +
    esc(coords) + ' · ' + esc(handover.customerPhone) +
    '</div>'
  );
}

async function loadProviders() {
  const snap = await db.collection('providers').get();
  providersState = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!providersState.length) {
    setAccessSummary(0, 0);
    renderProviders();
    return;
  }
  // **ظهورهم للزبائن من `driver_public`:** أرقامٌ مفتّحة على مستنداتها،
  // بقراءة واحدة لكل رقم لا سرداً محظوراً على اللوحة.
  const providerPhones = providersState.map((p) => String(p.phone || '')).filter(Boolean);
  const [presence, handovers] = await Promise.all([
    loadPresence(providerPhones),
    // **وإحداثيات الزبائن المُسلَّمة إليهم:** `trip_requests/{رقم السائق}`،
    // والمفتاح هو الرقم نفسه فالحاجة القراءةُ بالرقم لا سردَ المجموعة.
    loadHandovers(providerPhones),
  ]);
  // **وقرار اللوحة نفسه:** `driver_access/{الرقم}`، لأن عمود «الاشتراك»
  // يقرأ `providers` وحده، فيرى المشرف جدولًا يقول «نشط» وصاحبَ الرقم في
  // لائحة الزبائن محذوف. فالعمودان معًا، والجواب واحد.
  providersAccess = await loadAccess(providerPhones);
  const shown = providersState.filter(
    (p) => accessIsVisible(providersAccess[String(p.phone || '')])
  ).length;
  setAccessSummary(providersState.length, shown);
  providersMaps = { presence: presence, handovers: handovers };
  renderProviders();
}

let providersMaps = { presence: {}, handovers: {} };

/**
 * رسمُ جدول أصحاب التوصيل وحده.
 *
 * **والرسمُ منفصلٌ عن القراءة لأمرين:** البحثُ في الاسم لا يجوز أن يُعيد
 * قراءةَ الحضور والإحداثيات من القاعدة، والتحديدُ للجماعة يجب أن يبقى
 * محفوظًا وهو يقلّب الصفحات — فلو كُتب الجدولُ كلَّ مرّة من الصفر لضاع
 * من حدّد المشرفُ نصفَهم ثم بحث عن حيٍّ آخر.
 */
function renderProviders() {
  const body = $('#providers-body');
  if (!body) return;
  if (!providersState.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="11">لا يوجد أصحاب توصيل</td></tr>';
    updatePickCount();
    return;
  }
  const rows = providersState.filter((p) =>
    searchHit('providers', [p.name, p.phone, p.plate, p.id])
  );
  if (!rows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="11">لا نتيجة لهذا البحث</td></tr>';
    updatePickCount();
    return;
  }
  body.innerHTML = rows
    .map((p) =>
      '<tr>' +
      '<td class="pick-cell">' +
      (p.phone
        ? '<input type="checkbox" class="prov-pick" data-phone="' + esc(p.phone) + '" ' +
          (providersSelection.has(String(p.phone)) ? 'checked ' : '') +
          'onchange="toggleProviderPick(this)" title="تحديد">'
        : '') +
      '</td>' +
      '<td style="max-width:70px">' +
      (p.photo
        ? '<img class="prov-avatar" src="data:image/jpeg;base64,' + esc(p.photo) + '" onclick="openDocImage(this.src,\'' + esc(p.name) + '\')" style="width:38px;height:38px;border-radius:50%;object-fit:cover;cursor:pointer" title="' + esc(p.id) + '">'
        : '<div style="width:38px;height:38px;border-radius:50%;background:#e5e7eb" title="' + esc(p.id) + '"></div>') +
      '</td>' +
      '<td><strong>' + esc(p.name) + '</strong>' +
      (p.blocked ? ' <span class="badge rejected">محظور</span>' : '') +
      '</td>' +
      '<td>' + esc(p.phone) + '</td>' +
      '<td>' + presenceCell(providersMaps.presence[String(p.phone)]) + '</td>' +
      '<td>' + handoverCell(providersMaps.handovers[String(p.phone)]) + '</td>' +
      '<td>' + esc(p.plate || '') + '</td>' +
      '<td>★ ' + esc(p.rating || 0) + '</td>' +
      '<td>' + accessEndCell(providersAccess[String(p.phone)]) + '</td>' +
      '<td>' + accessCell(providersAccess[String(p.phone || '')]) + '</td>' +
      '<td><div class="row-actions">' +
      // **وبابٌ واحدٌ للقرار:** كان الصفُّ يعرضُ «لوحةُ التحكّم» وزرَّ تجميدٍ
      // سريعٍ معًا، فيظنُّ الرجلُ أنهما يدانِ مختلفتانِ لرجلٍ واحد. البطاقةُ
      // فيها كلُّ قرارٍ، والصفُّ لا يبقى فيه إلا ما ليس قرارًا: الاسمُ والرقم.
      (p.phone
        ? '<button class="btn-sm blue" onclick="openAccessPanel(\'' + esc(p.phone) + '\')" title="مدّته وسجلّ ما مُنح له وكلّ قراراته في شاشة واحدة">بطاقة القرار</button>'
        : '<span class="badge inactive">بلا رقم</span>') +
      (canWrite()
        ? '<button class="btn-sm blue" onclick="editProvider(\'' + p.id + '\')">تعديل</button>' +
          '<button class="btn-sm no" onclick="deleteProvider(\'' + p.id + '\')" title="يمسح سطر اللوحة وبطاقة قراره؛ حسابه في التطبيق لا يُمسّ">حذف</button>'
        : '') +
      '</div></td>' +
      '</tr>'
    )
    .join('');
  updatePickCount();
}

/* ---------- تحديدُ الجماعة: قرارٌ واحدٌ بضغطةٍ لعدةِ أرقام ---------- */

/*
 * **والتحديدُ بالرقم لا بمعرّف الجدول:** بطاقةُ القرار مكتوبةٌ بالرقم في
 * `driver_access`، فلو حُدِّد بالمعرّف لاحتاج كلُّ رقمٍ قراءةً ثانية قبل
 * الكتابة. والرقمُ هو الجسرُ نفسه بين اللوحة والهاتف.
 *
 * **و«لبعضهم» أصلٌ لا فرع:** المحدَّدون هم ما ظهر في الجدول، فمن بحثَ عن
 * حيٍّ ثم ضغط «حدِّد الكل» ثم «تجريبية للمحدَّدين» منحَ ذلك الحيَّ كلَّه
 * بضغطة — وهو المطلوبُ حرفيًّا: الجميعُ دفعة، أو بعضهم، أو واحدٌ وحده من
 * لوحةِ تحكّمه.
 */
const providersSelection = new Set();

function toggleProviderPick(box) {
  const phone = String(box.dataset.phone || '');
  if (!phone) return;
  if (box.checked) providersSelection.add(phone);
  else providersSelection.delete(phone);
  syncPickAllBox();
  updatePickCount();
}

function pickAllProviders(box) {
  document.querySelectorAll('.prov-pick').forEach((b) => {
    b.checked = box.checked;
    const phone = String(b.dataset.phone || '');
    if (!phone) return;
    if (box.checked) providersSelection.add(phone);
    else providersSelection.delete(phone);
  });
  updatePickCount();
}

/** كلُّ من لا يظهر للزبائن الآن — وهي الضغطةُ التي تلي «توحيد الصلاحيات». */
function pickInvisibleProviders() {
  let n = 0;
  document.querySelectorAll('.prov-pick').forEach((b) => {
    const phone = String(b.dataset.phone || '');
    if (!phone || accessIsVisible(providersAccess[phone])) return;
    b.checked = true;
    providersSelection.add(phone);
    n += 1;
  });
  syncPickAllBox();
  updatePickCount();
  toast(n ? 'حُدِّد ' + n + ' لا يظهرون للزبائن' : 'كلُّ من في العرض ظاهرٌ للزبائن');
}

function clearProviderPicks() {
  document.querySelectorAll('.prov-pick').forEach((b) => { b.checked = false; });
  providersSelection.clear();
  syncPickAllBox();
  updatePickCount();
}

function syncPickAllBox() {
  const all = document.getElementById('providers-pick-all');
  if (!all) return;
  const boxes = Array.from(document.querySelectorAll('.prov-pick'));
  all.checked = boxes.length > 0 && boxes.every((b) => b.checked);
}

function updatePickCount() {
  const el = document.getElementById('providers-pick-count');
  if (el) {
    el.className = 'badge ' + (providersSelection.size ? 'pending' : 'inactive');
    el.textContent = providersSelection.size
      ? providersSelection.size + ' محدد'
      : 'لا أحد محدد';
  }
  syncBulkBar();
}

/**
 * تنظيمُ أزرارِ الجماعة: ما لا يُغني مَن اخترتَه لا يُعرَضُ أمامَك.
 *
 * **كانت عشرةُ أزرارٍ في صفٍّ واحد:** «تجميدُ حساباتهم» بجانبِ «رفعِ
 * التجميد» و«منعُ مكالماتهم» بجانبِ «السماحِ بمكالماتهم»، فيقفُ المشرفُ
 * يسألُ أيَّهما يُطبَّقُ على مَن حدّد — والزوجانِ ليسا احتمالينِ بل حالَتينِ
 * تُعرَفانِ من البطاقاتِ نفسها. فالآنَ يُعرَضُ الضدُّ الذي يعني شيئًا: إن
 * كان كلُّ المحدَّدين مجمَّدين بقيَ «رفعُ التجميد» وحدَه.
 *
 * **وبلا تحديدٍ تُطفأُ أزرارُ القرارِ كلُّها:** يبقى سطرُ التحديدِ وحده
 * معَ جُملَةٍ تقولُ ماذا يفعل، لأنَّ زرًّا يكتبُ في بطاقاتٍ بلا أسماءَ يعلّمُ
 * الرجلَ أنَّ اللوحةَ معطوبةٌ لا أنَّ يدَه هي كذلك.
 *
 * **والحالُ تُقرأُ من البطاقاتِ المحفوظةِ لا من الصفحة:** الفحصُ يعرفُ ما
 * في اللوحةِ من مصدرِ القرارِ نفسِه، فلا يختلفُ ما يراهُ الزرُّ عمّا تكتبُه.
 */
function syncBulkBar() {
  const phones = Array.from(providersSelection).filter(Boolean);
  const cards = phones.map((phone) => providersAccess[String(phone)] || null);
  const show = (id, visible) => {
    const b = document.getElementById(id);
    if (b) b.style.display = visible ? '' : 'none';
  };
  const has = (test) => cards.some(test);
  const selected = phones.length > 0;
  const frozen = has((a) => !!a && a.frozen === true);
  const thawed = has((a) => !a || a.frozen !== true);
  const running = has((a) => !!a && a.active === true);
  const silent = has((a) => !!a && a.callsAllowed === false);
  const callable = has((a) => !a || a.callsAllowed !== false);

  show('bg-plan', selected);
  show('bg-freeze', selected);
  show('bg-calls', selected);
  show('bg-remove', selected);
  show('bp-stop', selected && running);
  show('bp-freeze', selected && thawed);
  show('bp-unfreeze', selected && frozen);
  show('bp-block', selected && callable);
  show('bp-allow', selected && silent);

  const hint = document.getElementById('providers-bulk-hint');
  if (!hint) return;
  if (!selected) {
    hint.textContent =
      'لا قرارَ كُتبَ بعدُ: املأْ مربّعاتِ مَن تريدُ من صُفوفِ الجدول، أو اضغطْ «اختر كل من لا يظهر»، أو حدِّدِ الكلَّ من مربّعِ رأسِ الجدول — فتظهرَ هنا أزرارُ القرار، ولا يُعرَضُ منها إلا ما يُغني مَن اخترتَه.';
    return;
  }
  const bits = [];
  const counted = (n, label) => { if (n) bits.push(n + ' ' + label); };
  counted(cards.filter((a) => accessIsVisible(a)).length, 'يظهرون للزبائن');
  counted(cards.filter((a) => !a).length, 'بلا بطاقة قرار');
  counted(cards.filter((a) => !!a && a.frozen === true).length, 'مجمّدون');
  counted(cards.filter((a) => !!a && a.active && a.endMs > Date.now()).length, 'مدّتهم سارية');
  counted(cards.filter((a) => !!a && a.callsAllowed === false).length, 'مكالماتهم ممنوعة');
  hint.textContent =
    'القرارُ هنا يُكتبُ لـ' + phones.length + ' رقمًا دفعةً واحدة: ' + (bits.join(' · ') || 'لا شيء منهم ظاهرًا الآن');
}

function requireSelection() {
  const phones = Array.from(providersSelection).filter(Boolean);
  if (!phones.length) {
    toast('حدّد أحدًا أولًا: لا يُكتب قرارٌ لغيرِ اسم', true);
    return null;
  }
  return phones;
}

/**
 * قرارُ الجماعة: ولكلِّ رقمٍ عدُّه الخاص.
 *
 * **والعدُّ من آخر نهايةٍ سارية:** كُتب للجميع تاريخٌ واحد لأُهديَ لمن بقي
 * له عشرون يومًا شهرٌ كامل، وخُصمَ عن غيره في اللحظة نفسها. فالكتابةُ على
 * بطاقاتٍ مختلفة التاريخ هي التي تجعل «شهرٌ للجميع» قرارًا منصفًا.
 */
async function bulkAccessWrite(phones, makePatch, actionLabel, mirrorActive) {
  try {
    const prev = await loadAccess(phones);
    const ops = [];
    const ends = {};
    phones.forEach((phone) => {
      const patch = makePatch(phone, prev[phone] || null);
      if (!patch) return;
      if (patch.subscriptionEnd) ends[phone] = patch.subscriptionEnd;
      ops.push({
        ref: db.collection(ACCESS_COLLECTION).doc(phone),
        data: Object.assign({}, patch, {
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }),
        opts: { merge: true },
      });
    });
    if (!ops.length) return toast('لم يُكتب شيء', true);
    await commitInChunks(ops);
    if (mirrorActive !== undefined && mirrorActive !== null) {
      await Promise.all(phones.map((phone) =>
        mirrorProviderSubscription(phone, mirrorActive, ends[phone] || null)));
    }
    await logActivity(actionLabel, phones.length + ' صاحب توصيل');
    toast('نُفِّذ على ' + ops.length + ' صاحب توصيل');
    clearProviderPicks();
    loadProviders();
  } catch (err) {
    toast(err.message, true);
  }
}

/** كم يومًا؟ الفراغُ يعني الافتراضي، والعددُ من واحدٍ إلى ثلاثمئةٍ وخمسةٍ وستّين. */
function askGrantDays(title, onDays) {
  askText(title, 'كم يومًا؟ (الافتراضي ' + TRIAL_DEFAULT_DAYS + ')', (text) => {
    const raw = parseInt(String(text).replace(/[^0-9]/g, ''), 10);
    onDays(!raw ? TRIAL_DEFAULT_DAYS : Math.max(1, Math.min(365, raw)));
  }, { confirm: 'منح' });
}

function grantTrialSelected() {
  const phones = requireSelection();
  if (!phones) return;
  askGrantDays('منح فترة تجريبية لـ' + phones.length + ' صاحب توصيل', (days) => {
    bulkAccessWrite(
      phones,
      (phone, access) => ({
        subscriptionActive: true,
        subscriptionEnd: nextSubscriptionEnd(access, days),
        plan: 'trial',
        history: grantHistory(access, days, 'trial'),
      }),
      'منح فترة تجريبية للمحدَّدين · ' + days + ' يومًا',
      true
    );
  });
}

function grantPaidSelected() {
  const phones = requireSelection();
  if (!phones) return;
  askGrantDays('تمديد اشتراكٍ مدفوع لـ' + phones.length + ' صاحب توصيل', (days) => {
    bulkAccessWrite(
      phones,
      (phone, access) => ({
        subscriptionActive: true,
        subscriptionEnd: nextSubscriptionEnd(access, days),
        plan: 'paid',
        history: grantHistory(access, days, 'paid'),
      }),
      'تمديد اشتراك مدفوع للمحدَّدين · ' + days + ' يومًا',
      true
    );
  });
}

function stopSubscriptionSelected() {
  const phones = requireSelection();
  if (!phones) return;
  askConfirm(
    'إيقاف اشتراك المحدَّدين',
    'يُطفأ مفتاحُ الاشتراك عن <strong>' + phones.length + '</strong> صاحب توصيل: تبقى تواريخُهم كما هي ' +
    'ولا ظهورَ لهم عند الزبائن حتى تعيد التفعيل أو تمنحهم مدةً جديدة.',
    () => bulkAccessWrite(phones, () => ({ subscriptionActive: false }),
      'إيقاف اشتراك المحدَّدين', false),
    { danger: true, confirm: 'إيقاف' }
  );
}

function freezeSelected() {
  const phones = requireSelection();
  if (!phones) return;
  askConfirm(
    'تجميد حسابات المحدَّدين',
    'يُجمَّد <strong>' + phones.length + '</strong> صاحب توصيل: لا يظهر للزبائن ولا تُجدي معه مدةٌ سارية، ' +
    'ورفعُ التجميد قرارٌ آخر بيدك. والمددُ المكتوبة لا تُمسح بالتجميد.',
    () => bulkAccessWrite(phones, () => ({ frozen: true }),
      'تجميد حسابات المحدَّدين', null),
    { danger: true, confirm: 'تجميد' }
  );
}

function unfreezeSelected() {
  const phones = requireSelection();
  if (!phones) return;
  bulkAccessWrite(phones, () => ({ frozen: false }), 'رفع التجميد عن المحدَّدين', null);
}

function blockCallsSelected() {
  const phones = requireSelection();
  if (!phones) return;
  askConfirm(
    'منع مكالمات المحدَّدين',
    'لا يظهر <strong>' + phones.length + '</strong> صاحب توصيل في قائمة القريبين ولو كان اشتراكُه ساريًا: ' +
    'المنعُ إخفاءٌ لا نصفُ ظهور، وهذا ما يقرؤه الهاتفُ حرفيًّا.',
    () => bulkAccessWrite(phones, () => ({ callsAllowed: false }),
      'منع مكالمات المحدَّدين', null),
    { danger: true, confirm: 'منع' }
  );
}

function allowCallsSelected() {
  const phones = requireSelection();
  if (!phones) return;
  bulkAccessWrite(phones, () => ({ callsAllowed: true }), 'السماح بمكالمات المحدَّدين', null);
}

function deleteSelectedProviders() {
  const phones = requireSelection();
  if (!phones) return;
  const ids = phones
    .map((phone) => {
      const p = providersState.find((x) => String(x.phone || '') === phone);
      return p ? String(p.id) : null;
    })
    .filter(Boolean);
  askConfirm(
    'حذف المحدَّدين من جدول اللوحة',
    'يُمحى <strong>' + ids.length + '</strong> سطرًا من جدول أصحاب التوصيل في اللوحة، وتسحبُ معهنّ ' +
    'بطاقاتُ قرارك فلا يظهرن للزبائن.' +
    '<br><br><strong>وحسابُ التطبيق لا يُمسّ:</strong> يستطيع أصحابُه الدخولَ واستقبالَ المكالمات. ' +
    'والطردُ الذي يمنع الرقمَ من التسجيل مكانُه «تسجيل أصحاب التوصيل».',
    async () => {
      try {
        const ops = ids.map((id) => ({ ref: db.collection('providers').doc(id), del: true }))
          .concat(phones.map((phone) => ({ ref: db.collection(ACCESS_COLLECTION).doc(phone), del: true })));
        await commitInChunks(ops);
        await logActivity('حذف أصحاب توصيل من اللوحة (جماعي)', phones.length + ' رقمًا');
        toast('حُذف ' + ids.length + ' من الجدول وسُحبت بطاقاتهم');
        clearProviderPicks();
        loadProviders();
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'حذف' }
  );
}

/* ---------- سطرُ صاحبِ توصيلٍ بيدِ اللوحة ---------- */

/**
 * **وليس حسابَ دخول:** هذا البابُ كان يُغرِي بأن يُسمّى «إضافة صاحب
 * توصيل» ثم لا يجد الرجلُ اسمَه في التطبيق. فالسطرُ هنا جدولُ اللوحة
 * وحده، والدخولُ يُنشأ من هاتف صاحبه بوثائقه، والظهورُ للزبائن قرارٌ ثالث
 * لا يُمنح بلا فترةٍ مكتوبة — واللوحةُ تقول الثلاثَ في شاشةٍ واحدة.
 */
function addProvider() {
  const overlay = openModal({
    title: 'إضافة صاحب توصيل إلى جدول اللوحة',
    body:
      '<div style="display:grid;gap:10px">' +
      '<label>الاسم الكامل</label><input id="np-name" type="text" class="modal-input">' +
      '<label>رقم الهاتف</label><input id="np-phone" type="text" class="modal-input" style="direction:ltr" inputmode="tel">' +
      '<label>رقم اللوحة</label><input id="np-plate" type="text" class="modal-input">' +
      '<p class="login-sub">هذا السطرُ يظهر في جداول اللوحة وحدها. ' +
      '<strong>وهو لا يفتح حسابَ دخول في التطبيق:</strong> صاحبُ الرقم يسجّل من هاتفه بوثائقه ثم تقبله أنت. ' +
      'ولن يظهر للزبائن مهما كتبتَه هنا حتى تمنحه فترةً — تجريبيةً أو اشتراكًا.</p>' +
      '</div>',
    foot:
      '<button class="modal-btn ghost" data-close>إلغاء</button>' +
      '<button class="modal-btn ok" data-submit>إضافة السطر</button>',
  });
  const submit = async () => {
    const name = overlay.querySelector('#np-name').value.trim();
    const phone = overlay.querySelector('#np-phone').value.trim();
    const plate = overlay.querySelector('#np-plate').value.trim();
    const btn = overlay.querySelector('[data-submit]');
    if (!name || !phone) return toast('الاسم والرقم مطلوبان', true);
    if (providersState.some((p) => String(p.phone || '').trim() === phone)) {
      return toast('هذا الرقم له سطرٌ في الجدول بالفعل: عدّل سطرَه ولا تُضِف ثانِيًا', true);
    }
    btn.disabled = true;
    try {
      await db.collection('providers').add({
        name: name,
        phone: phone,
        plate: plate,
        rating: 0,
        added_by: String((ADMIN && (ADMIN.full_name || ADMIN.username)) || ''),
        added_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
      overlay.remove();
      await logActivity('إضافة صاحب توصيل إلى جدول اللوحة', name + ' · ' + phone);
      toast('أُضيف السطر: وبلا فترةٍ مكتوبة يبقى مخفيًّا عن الزبائن');
      loadProviders();
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
  };
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
  overlay.querySelector('[data-submit]').addEventListener('click', submit);
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
    '<p class="login-sub">الرقمُ هنا هو صلةُ الوصل بين اللوحة وهاتفِه: إن غيّرته ' +
    'انتقلت بطاقةُ قرارِه إلى الرقم الجديد، فاحتفظ بالفترة والملاحظة كما هي. ' +
    'أما رقمُ الذي يدخُل به صاحبُ التوصيل إلى تطبيقِه فمكانٌ آخر، ولا يُبدَّل من هنا.</p>' +
    '<label>رقم اللوحة</label>' +
    '<input id="ep-plate" type="text" value="' + esc(p.plate || '') + '">' +
    '</div>' +
    '<div class="rv-foot">' +
    '<button class="btn-primary rv-save" onclick="saveProvider(this,\'' + id + '\')">حفظ التعديل</button>' +
    '</div>' +
    '</div>';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

async function saveProvider(btn, id) {
  const overlay = btn.closest('.doc-lightbox');
  const row = providersState.find((x) => String(x.id) === String(id)) || {};
  const oldPhone = String(row.phone || '').trim();
  const name = overlay.querySelector('#ep-name').value.trim();
  const phone = overlay.querySelector('#ep-phone').value.trim();
  const plate = overlay.querySelector('#ep-plate').value.trim();
  if (!name || !phone) return toast('الاسم والهاتف مطلوبان', true);
  btn.disabled = true;
  try {
    await db.collection('providers').doc(id).update({ name, phone, plate });
    await moveAccessCard(oldPhone, phone);
    await logActivity('تعديل بيانات', name);
    toast('تم حفظ التعديل');
    overlay.remove();
    loadProviders();
  } catch (err) { btn.disabled = false; toast(err.message, true); }
}

/**
 * بطاقةُ القرار مكتوبةٌ بالرقم، فتغييرُ الرقم بلا نقلٍ يتيمَّم القرارَ في
 * مكانه القديم: اللوحةُ تراه، والهاتفُ يسأل بالرقم الجديد فلا يجد شيئًا
 * فيُخفى الرجلُ بغير قرار. والنقلُ هنا كتابةٌ ثم حذفٌ — والكتابةُ وحدها
 * تترك بطاقتين لرجلٍ واحد، أحسنُهما للقديم.
 */
async function moveAccessCard(fromPhone, toPhone) {
  if (!fromPhone || !toPhone || fromPhone === toPhone) return false;
  try {
    const ref = db.collection(ACCESS_COLLECTION).doc(fromPhone);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await db.collection(ACCESS_COLLECTION).doc(toPhone).set(snap.data(), { merge: true });
    await ref.delete();
    await logActivity('نقل بطاقة قرار إلى رقم جديد', fromPhone + ' ← ' + toPhone);
    return true;
  } catch (err) {
    // والنقلُ لا يبطلُ حفظَ البيانات: بقِيَ القرارُ باسمه القديم فاللوحة
    // تُخبره، والرقمُ الجديد بلا بطاقةٍ مخفيٌّ لا يظهر خطأً لأحد.
    toast('حُفظ التعديل لكن لم تُنقل البطاقة: ' + err.message, true);
    return false;
  }
}

async function deleteProvider(id) {
  const p = providersState.find((x) => x.id === id);
  if (!p) return;
  // **والرسالةُ تقول ما يحدُث فعلاً:** كانت تعدُ بأن الحسابَ يزول والدخولَ
  // يُمنع، بينما الحذفُ لا يمسّ حسابَ الدخول الذي يسكن مكانًا آخر. فمن
  // قرأها صدّقها، وظنّ أن رجلاً خرج من العمل وهو يعمل.
  const phone = String(p.phone || '').trim();
  askConfirm(
    'حذف من جدول اللوحة',
    'يُحذف «<strong>' + esc(p.name) + '</strong>» من جدول أصحاب التوصيل في اللوحة، ' +
    (phone
      ? 'وتُسحب معه بطاقةُ قراره على الرقم <strong style="direction:ltr">' + esc(phone) + '</strong> فلا يظهر للزبائن.'
      : 'وليس له رقمٌ في الجدول، فلا بطاقةَ تُسحب.') +
    '<br><br><strong>حسابُه في التطبيق يبقى كما هو</strong>: يستطيع الدخولَ واستقبالَ المكالمات. ' +
    'وإن أردتَ إغلاقَ حسابِه ومنعَ رقمِه من التسجيل فمن «تسجيل أصحاب التوصيل» — «طردٌ نهائي».',
    async () => {
      try {
        const batch = db.batch();
        batch.delete(db.collection('providers').doc(id));
        if (phone) batch.delete(db.collection(ACCESS_COLLECTION).doc(phone));
        await batch.commit();
        await logActivity('حذف صاحب توصيل من اللوحة', p.name + (phone ? ' · ' + phone : ''));
        toast(phone ? 'حُذف من اللوحة وسُحبت بطاقتُه: لا يظهر للزبائن' : 'حُذف من اللوحة');
        loadProviders();
        loadDashboard();
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'حذف من اللوحة' }
  );
}

/**
 * عمودُ نهاية الفترة: من بطاقة القرار لا من جدول اللوحة.
 *
 * **ومصدرٌ واحد لكل شاشة:** العمودُ كان يقرأ `providers` والعمودُ الذي
 * بجانبه يقرأ `driver_access`، فيرى المشرف «تاريخ انتهاء» لا علاقة له
 * بالقرار المكتوب تحته — ومرآةُ اللوحة قد تُحدَّثُ وهي لا تُنفَّذ.
 */
function accessEndCell(access) {
  if (!access) return '<span class="badge inactive">لا تاريخ</span>';
  if (access.endMs === null) return '<span class="badge inactive">لم يُكتب</span>';
  const late = access.endMs <= Date.now();
  return '<span class="badge ' + (late ? 'rejected' : 'active') + '">' + esc(fmtDateShort(access.endMs)) + '</span>';
}

/* ---------- صلاحيات أصحاب التوصيل: قرار اللوحة لا نقرَة الهاتف ---------- */

/*
 * **ولا زرَّ سريعًا في الصفِّ ولا مقابضَ توهم:** «تفعيل الاتصال» و
 * «تفعيل الاشتراك» و«حظر» كانت تقلب حقولًا في جدول `providers` لا يقرأه
 * التطبيقُ إطلاقًا — لا ظهورَ يتغيّر، ولا اتصالَ يُقطع، ولا حظرَ يسري.
 * أخطرُ من العدم أن توهمَ بالوجود: يضغط المشرفُ «حظر» فيظنّ أنه أوقف
 * رجلاً وهو أمام الزبائن يعمل، ثم لا يعود يشكّ في اللوحة طَوالَ يومِه.
 * فالصفُّ بابٌ واحدٌ إلى البطاقة، والبطاقةُ هي التي تُنفِّذ.
 */

/*
 * **`driver_access` بمفتاح الرقم، لا `providers` بمعرّفها:** التطبيق
 * يسأل عن رقم صاحبه الذي دخل به، و`providers` مفتاحها معرّف عشوائي وفيها
 * كلمة مرور قديمة وقاعدتها تغلقها على المشرف. فالجسر بين اللوحة والهاتف
 * هو الرقم لا المعرّف — وهو الشيء الوحيد الذي يملكه صاحب التوصيل فعلاً.
 *
 * **والكتابة من هنا هي القرار، والقراءة من هناك هي التنفيذ:** اللوحة تكتب
 * `frozen` و`subscriptionActive` و`subscriptionEnd` و`callsAllowed` و`plan`،
 * وتُطفئ شاشةُ صاحب التوصيل ظهورَه نفسه حين يصلها المنع، وتسقط لائحةُ
 * الزبائن صاحبَه. فلو تُرك الحكم للوحة وحدها والعرض للتطبيق لما نُفِّذ
 * قرارٌ حتى يُعاد فتح التطبيق.
 *
 * **وبلا قرارٍ لا ظهور:** سياسة التطبيق أن صاحب التوصيل لا يظهر للزبائن
 * حتى يكتب فيه المشرف اشتراكًا شهريًا مدفوعًا أو فترةً تجريبية. فغياب
 * المستند ليس سماحًا بل تأجيلًا، واللوحة تقول ذلك صراحةً في العمود بدل أن
 * تُسكت — والحكم الخفيّ أخطر من المعلَن ولو اتفقا. وزرّ «توحيد الصلاحيات»
 * يحوّل كل «بلا قرار» إلى قرارٍ مكتوب باسم صاحبه، وهو أوّل ما يُضغَط بعد
 * هذه القاعدة، وإلا أُظلم كل من لم تكن له بطاقة.
 */
const ACCESS_COLLECTION = 'driver_access';
const RENEWAL_COLLECTION = 'renewal_requests';

/** مدة التمديد بالأيام: ثلاثون لا تقويمُ شهر، لئلّا يختلف الحساب. */
const SUB_MONTH_DAYS = 30;

/** مدة الفترة التجريبية الافتراضية: يسألها المشرف ويكتب ما شاء. */
const TRIAL_DEFAULT_DAYS = 7;

/** وجه المنحة: `paid` اشتراكٌ مدفوع، و`trial` تجريبية — والكلمة للهاتف. */
const PLAN_LABELS = { paid: 'اشتراك مدفوع', trial: 'فترة تجريبية' };

const RENEWAL_STATUS_LABELS = {
  pending: 'بانتظار الاعتماد',
  approved: 'معتمد',
  rejected: 'مرفوض',
};

/** ما تُسمّيه اللوحة كلَّ إجراء على الصلاحية، فيظهر كذلك في سجلّ النشاط. */
const ACCESS_ACTION_LABELS = {
  extend: 'تمديد اشتراك شهرًا',
  trial: 'منح فترة تجريبية',
  stop: 'إيقاف اشتراك',
  start: 'تفعيل اشتراك',
  freeze: 'تجميد حساب',
  unfreeze: 'رفع تجميد حساب',
  blockCalls: 'منع المكالمات',
  allowCalls: 'السماح بالمكالمات',
  note: 'ملاحظة لصاحب التوصيل',
  clear: 'سحب بطاقة القرار',
};

/** حالة صاحب التوصيل كما قررتها اللوحة، أو `null` إن لم يُكتب بعد. */
let providersAccess = {};

/**
 * قراءة صلاحية كل رقم من بين الأرقام.
 *
 * **قراءة بالرقم لا سردًا للمجموعة:** `list` على `driver_access` مفتوح
 * للمشرف وحده، وهو كذلك في القاعدة، لكن البقاء على نمط `loadPresence`
 * يجعل العمودين يُقرآن بالأسلوب نفسه ويُسقَطان معًا عند تعذّر رقم —
 * فاللوحة تخدم المشرف لا تخدم Firestore.
 */
async function loadAccess(phones) {
  const unique = Array.from(new Set(phones.filter(Boolean)));
  const docs = await Promise.all(
    unique.map((phone) =>
      db
        .collection(ACCESS_COLLECTION)
        .doc(phone)
        .get()
        .then((d) => (d.exists ? d.data() : null))
        .catch(() => null)
    )
  );
  const byPhone = {};
  unique.forEach((phone, i) => {
    const data = docs[i];
    // `null` هنا «لم يُكتب مستند»، والفرق بينه وبين «كُتب ثم حُذف» لا
    // أثر له عند العرض: الحالتان بلا قرار، وصاحبُ التوصيل لا يظهر للزبائن.
    if (!data) return;
    const end = data.subscriptionEnd;
    byPhone[phone] = {
      frozen: data.frozen === true,
      // المفتاح لا يُفتح إلا كتابةً: هو نفس الحكم في `driver_access_service.dart`،
      // فلو اكتفت اللوحة بـ`!== false` قالت «سارٍ» لما يراه الهاتف موقوفًا.
      active: data.subscriptionActive === true,
      callsAllowed: data.callsAllowed !== false,
      plan: typeof data.plan === 'string' ? data.plan.trim() : '',
      endMs: end && typeof end.toMillis === 'function' ? end.toMillis() : null,
      note: typeof data.note === 'string' ? data.note : '',
      // والسجلُّ يُقرأ معها: لوحةٌ لا تعرف كم مرة جُرِّب هذا الرقم
      // لوحةٌ تمنح التجريبية بوجهٍ واحد كلَّ شهرٍ بلا أن يرى أحد.
      history: Array.isArray(data.history) ? data.history : [],
    };
  });
  return byPhone;
}

/**
 * هل هو ظاهرٌ للزبون الآن؟ هو الحكم نفسه الذي يمشي عليه الهاتف.
 *
 * **ومنعُ المكالمات إخفاءٌ لا نصفُ ظهور:** قائمةُ القريبين في التطبيق
 * تفلتر بـ`canBeCalled`، أي بالفترة السارية والمكالمات مسموحة معًا. فلو
 * اكتفت اللوحة بالفترة عدّتْ رقمًا لا يراه الزبون ظاهرًا، وقرأ المشرفُ
 * عدًّا لا يطابق ما يراه صاحبُ التوصيل من رزق.
 */
function accessIsVisible(access) {
  if (!access) return false;
  if (access.frozen) return false;
  if (access.callsAllowed === false) return false;
  return access.active && access.endMs !== null && access.endMs > Date.now();
}

/**
 * عدّادُ الظهور فوق جدول أصحاب التوصيل: «كم واحدًا يراه الزبون الآن».
 *
 * **والعدد هو أول ما يحتاجه المشرف بعد هذه القاعدة:** «بلا قرار» صار
 * مخفيًّا، فأسوأُ ما يحدث أن تفتح اللوحةُ على أصحابِ توصيلٍ لا يُدرى أنهم
 * أوقفوا. فالسطرُ يقول كم ظاهرٍ للزبائن وكم مخفيٌّ عنهم.
 */
function setAccessSummary(total, shown) {
  const el = document.getElementById('providers-access-note');
  if (!el) return;
  const hidden = total - shown;
  el.className = 'badge ' + (hidden ? 'offline' : 'active');
  el.textContent = total
    ? (shown + ' يظهر للزبائن · ' + hidden + ' مخفيّ')
    : '';
}

/**
 * خلية القرار: كلمةٌ واحدة تقول للوحة ما يراه الزبون الآن عن هذا الرقم.
 *
 * **«بلا قرار» لم تعد «يعمل»:** العمودُ واللائحةُ حكْمٌ واحد، فلو قالت
 * اللوحة «يعمل» والحسابُ مخفيٌّ عند الزبون لكان للمشرف جوابان عن سؤالٍ
 * واحد — وهو أسرع طريقٍ إلى قرارٍ يُلغى بالخطأ.
 */
function accessCell(access) {
  const badge = (cls, text) => '<span class="badge ' + cls + '">' + text + '</span>';
  if (!access) return badge('offline', 'بلا قرار · لا يظهر');
  const note = access.note
    ? '<div style="font-size:11px;color:var(--gray)">' + esc(access.note) + '</div>'
    : '';
  if (access.frozen) return badge('rejected', 'مجمّد · لا يظهر') + note;
  if (access.endMs === null) return badge('offline', 'بلا فترة ممنوحة · لا يظهر') + note;
  if (access.endMs <= Date.now()) {
    return badge('rejected', 'انتهى ' + esc(fmtDateShort(access.endMs)) + ' · لا يظهر') + note;
  }
  if (!access.active) return badge('offline', 'مفتاحٌ مطفأ · لا يظهر') + note;
  // **وجوابٌ واحد للسؤال:** لا يجوز أن يقرأ المشرف في الخلية «ظاهر» و«لا
  // يظهر» في سطرٍ واحد، فالمنعُ قرارٌ مثله مثل الانتهاء.
  if (access.callsAllowed === false) return badge('pending', 'فترة سارية ومكالماته موقوفة · لا يظهر') + note;
  const plan = PLAN_LABELS[access.plan] ? ' · ' + PLAN_LABELS[access.plan] : '';
  const left = Math.max(0, Math.ceil((access.endMs - Date.now()) / 86400000));
  return badge('active', 'ظاهر · سارٍ ' + left + ' ي' + esc(plan)) + note;
}

/**
 * سطرٌ في سجلِّ المنح: ما مُنح، ومقدارُه، ومَن منح.
 *
 * **ولماذا يُحفَظ وهو مُكرَّرٌ في سجلِّ النشاط؟** لأن سجلَّ النشاط للوحةٍ
 * كلها، وهذا القرارُ لصاحبِ رقمٍ واحد: يسأل المشرفُ «كم مرة جرّبنا هذا
 * الرجل؟» فلا يجد الجوابَ إلا في بطاقتِه. والنافذةُ آخرُ اثني عشر سطرًا
 * لأن المستندَ لا يُترك ينمو إلى الأبد، والعبرةُ بما سبق الآن لا بما مضى
 * منه عام.
 */
function grantHistory(access, days, plan) {
  const prev = access && Array.isArray(access.history) ? access.history : [];
  return prev.concat({
    at: Date.now(),
    days: Number(days) || 0,
    plan: plan || '',
    by: String((ADMIN && (ADMIN.full_name || ADMIN.username)) || ''),
  }).slice(-12);
}

/**
 * كتابة قرارٍ واحد في صلاحية رقم.
 *
 * **`merge` لا `set` كامل:** المشرف يجمّد اليوم ويمنع المكالمات غدًا؛
 * والكتابة الكاملة تمحو ما لم يُذكر، فيجد المشرفُ التجميدَ مرفوعاً وهو
 * يظنّه باقياً.
 */
async function writeAccess(phone, patch, action) {
  try {
    await db
      .collection(ACCESS_COLLECTION)
      .doc(phone)
      .set({ ...patch, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await logActivity(ACCESS_ACTION_LABELS[action] || action, phone);
    toast('تم تسجيل القرار في اللوحة');
    loadProviders();
    // **والقائمة المفتوحة هي المُحدَّثة:** لوحة التحكّم تُفتح من جدول
    // أصحاب التوصيل ومن قائمة التجديدات معاً، فلو حُدِّث الجدول وحده
    // بقيت شارةُ «مجمّد» في الشاشة المفتوحة أمام عينيه قراراً قديماً.
    if (document.querySelector('#view-renewals.active')) loadRenewals();
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * تاريخ نهايةٍ بعد `days` يومًا.
 *
 * **والعدّ من آخر نهاية لا من اليوم:** مدّدَ المشرف شهرًا لسائقٍ بقي له
 * أحد عشر يومًا فالكلمة «تمديد» لا «تصفير». والعدّ من اليوم يجعل
 * التجديد المبكر خصمًا على صاحبه، فينتظر آخر يومٍ ليدفع — وهو أسوأ
 * موعد دفعٍ يمكن أن تختاره لوحة.
 */
function nextSubscriptionEnd(access, days) {
  const now = Date.now();
  const base = access && access.endMs !== null && access.endMs > now ? access.endMs : now;
  return new Date(base + days * 86400000);
}

/**
 * سطرُ السجلِّ في لوحة التحكّم: آخرُ ما مُنح لهذا الرقم، بمنحه.
 *
 * **والعددُ هو مقصدُه:** التجريبيةُ يدٌ للمشرف يمنحها متى شاء، لكن رجلًا
 * جُرِّب ستَّ مراتٍ ثم «جُرِّب» سبعةً وثلاثين يومًا ليس مجرَّبًا — هو
 * مشتركٌ لا يدفع. واللوحةُ التي لا تقول ذلك تجعل معنى الاشتراك المدفوع
 * في يد مَن يُكثر من العطاء.
 */
function grantHistoryLine(access) {
  const list = access && Array.isArray(access.history) ? access.history : [];
  if (!list.length) {
    return '<p class="login-sub" style="margin:0 0 10px">لا منحةَ مسجَّلة لهذا الرقم بعد.</p>';
  }
  const trials = list.filter((h) => h && h.plan === 'trial').length;
  const rows = list.slice(-6).reverse().map((h) =>
    esc(fmtDateShort(h.at)) + ' · ' + esc(String(h.days || 0)) + ' يومًا · ' +
    esc(PLAN_LABELS[h.plan] || h.plan || 'بلا وجه') + ' · ' + esc(h.by || 'غير مذكور'));
  return '<p class="login-sub" style="margin:0 0 10px">سجلُّ المنح: ' +
    list.length + ' — ' + (trials ? 'منها ' + trials + ' تجريبية' : 'كلُّها مدفوعة') +
    '<br>' + rows.join('<br>') + '</p>';
}

/** بطاقةُ القرار في رقم: كل ما يملكه المشرف في حسابه، في مكان واحد. */
function openAccessPanel(phone) {
  const access = providersAccess[String(phone)] || null;
  const p = providersState.find((x) => String(x.phone || '') === String(phone)) || {};
  const endText = access
    ? (access.endMs === null ? 'لم يُكتب تاريخ' : fmtDateShort(access.endMs))
    : 'لم يُكتب بعد';
  const planText = access && PLAN_LABELS[access.plan]
    ? PLAN_LABELS[access.plan]
    : 'لم يُحدَّد';
  const live = accessIsVisible(access);
  // **والمنعُ سبب لا غموض:** `accessIsVisible` تعدّ المكالمات الموقوفة
  // مخفيّة، فاللوحة وحدها لا تفرّق بين «انتهت مدّته» و«منعته من الاتصال
  // ومدّته سارية» — وهذا الفرق هو أول ما يسأل عنه المشرف قبل أي إجراء.
  const granted =
    !!access &&
    !access.frozen &&
    access.active &&
    access.endMs !== null &&
    access.endMs > Date.now();
  const verdict = live
    ? '<span class="badge active">ظاهرٌ للزبائن الآن</span>'
    : granted
      ? '<span class="badge pending">فترةٌ سارية، ومكالماته موقوفة: لا يظهر</span>'
      : '<span class="badge offline">لا يظهر للزبائن الآن</span>';
  const btn = (action, label, cls) =>
    '<button class="btn-sm ' + cls + '" onclick="accessAction(\'' + esc(phone) + '\',\'' + action + '\')">' + label + '</button>';
  // **وللمطالع تُعرض البطاقةُ بلا أزرار:** الحارسُ يمنع التنفيذ، لكن زرًّا
  // يُرفض عند الضغط عليه يعلّم الرجلَ أن اللوحة معطوبة لا أن درجته كذلك.
  // **والأزرارُ مجموعاتٌ لا صفاً واحداً:** ثلاثتُها تُخفي، وكلُّ واحدةٍ تُخفي
  // لسببٍ مختلف — فالعنوانُ يقولُ أيَّ بابٍ تفتح، ولا يبقى أن يسألَ المشرفُ
  // «ما الفرقُ بين تجميدٍ ومنعِ مكالماتٍ وإيقافِ اشتراك».
  const group = (heading, inner) =>
    '<div class="apx-group"><span class="apx-gt">' + heading + '</span>' +
    '<div class="row-actions" style="flex-wrap:wrap">' + inner + '</div></div>';
  const actions = canWrite()
    ? group('مدَّةُ الظهور',
        btn('trial', 'منح فترة تجريبية', 'blue') +
        btn('extend', 'تمديد شهر', 'ok') +
        (access && access.active
          ? btn('stop', 'إيقاف الاشتراك', 'no')
          : btn('start', 'تفعيل الاشتراك', 'ok'))) +
      group('تجميدٌ لا تنفعُ معه مدَّة',
        access && access.frozen
          ? btn('unfreeze', 'رفع التجميد', 'ok')
          : btn('freeze', 'تجميد الحساب', 'no')) +
      group('المكالماتُ داخل التطبيق',
        access && access.callsAllowed === false
          ? btn('allowCalls', 'السماح بالمكالمات', 'ok')
          : btn('blockCalls', 'منع المكالمات', 'no')) +
      group('غيرُ ذلك',
        btn('note', 'ملاحظة تظهر في تطبيقه', 'blue') +
        (access ? btn('clear', 'سحب بطاقة القرار', 'no') : ''))
    : '<span class="badge offline">درجتُك للاطّلاع: القرارُ بيد المشرف</span>';
  const body =
    '<div class="rv-body">' +
    '<p class="login-sub" style="margin-top:0">' +
    'الاسم: <strong>' + esc(p.name || 'بلا اسم في جدول أصحاب التوصيل') + '</strong><br>' +
    'الرقم: <strong style="direction:ltr;display:inline-block">' + esc(phone) + '</strong><br>' +
    'نهاية الفترة: <strong>' + esc(endText) + '</strong><br>' +
    'وجه المنحة: <strong>' + esc(planText) + '</strong>' +
    (access && access.note ? '<br>الملاحظة الحالية: <strong>' + esc(access.note) + '</strong>' : '') +
    '</p>' +
    '<p style="margin:0 0 10px">' + verdict + '</p>' +
    '<p class="apx-lead">هذه البطاقةُ هي القرارُ الذي يقرأُه هاتفُه: ما تكتبُه هنا يسري ظهورًا ومنعًا من فورِه، ولا يُغني عنهُ شيءٌ في جدولِ اللوحة.</p>' +
    grantHistoryLine(access) +
    (access
      ? ''
      : '<p class="badge offline">لا بطاقة له: يبقى مخفيًّا حتى تكتب له فترة — «منح فترة تجريبية» أو «تمديد شهر».</p>') +
    actions + '</div>';
  openModal({
    title: 'بطاقة قرار صاحب التوصيل',
    body,
    foot: '<button class="modal-btn ghost" onclick="this.closest(\'.doc-lightbox\').remove()">إغلاق</button>',
  });
}

/** إجراء واحد من لوحة التحكّم، بأسماءٍ قليلة لا دوالٍ كثيرة. */
function accessAction(phone, action) {
  const access = providersAccess[String(phone)] || null;
  const close = () => {
    const overlay = document.querySelector('.doc-lightbox');
    if (overlay) overlay.remove();
  };
  if (action === 'note') {
    close();
    askText('ملاحظة تظهر في تطبيق صاحب التوصيل', 'لماذا مُنع أو ما المطلوب منه…', (text) => {
      writeAccess(phone, { note: text }, 'note');
    }, { value: access ? access.note : '', confirm: 'حفظ الملاحظة' });
    return;
  }
  if (action === 'trial') {
    close();
    // **والمدة يسألها المشرف لا يقرّها الكود:** التجريبية عنده مدّةٌ
    // يُكافأ بها من لم يدفع بعد، فلو جُمِّدت في سبعٍ لكانت اللوحة هي التي
    // قرّرت. والفراغ يعني الافتراضي، والعدد يقبل من 1 إلى 365.
    askText(
      'منح فترة تجريبية',
      'كم يومًا؟ (الافتراضي ' + TRIAL_DEFAULT_DAYS + ')',
      (text) => {
        const raw = parseInt(String(text).replace(/[^0-9]/g, ''), 10);
        const days = !raw ? TRIAL_DEFAULT_DAYS : Math.max(1, Math.min(365, raw));
        const until = nextSubscriptionEnd(access, days);
        writeAccess(
          phone,
          {
            subscriptionActive: true,
            subscriptionEnd: until,
            plan: 'trial',
            history: grantHistory(access, days, 'trial'),
          },
          'trial'
        );
        mirrorProviderSubscription(phone, true, until);
      },
      { value: String(TRIAL_DEFAULT_DAYS), confirm: 'منح' }
    );
    return;
  }
  if (action === 'extend') {
    // **واللوحة تُغلق قبل السؤال:** يبقى قرارٌ في شاشةٍ بعد أن نُفِّذ،
    // فيقرأه المشرف حالةً قائمةً لا تاريخاً. والإغلاق أولًا يجعل السؤال
    // الشاشة الوحيدة، وهو معنى «تم» التي ينتظرها.
    close();
    const until = nextSubscriptionEnd(access, SUB_MONTH_DAYS);
    askConfirm(
      'تمديد الاشتراك',
      'يُمدّد ' + SUB_MONTH_DAYS + ' يومًا لصاحب التوصيل ' + esc(phone) +
      '<br>إلى: <strong>' + esc(fmtDateShort(until)) + '</strong><br>' +
      'ويُسمّى وجهُ المنحة في تطبيقه «اشتراكًا مدفوعًا».' +
      (access && access.frozen ? '<br><br>الحساب مجمّد: المدّة تُكتب لكن التجميد يبقى حتى ترفعه.' : ''),
      () => {
        writeAccess(
          phone,
          {
            subscriptionActive: true,
            subscriptionEnd: until,
            plan: 'paid',
            history: grantHistory(access, SUB_MONTH_DAYS, 'paid'),
          },
          'extend'
        );
        // والجدول `providers` يُحدَّث معه: عمود «تاريخ الانتهاء» في القائمة
        // يقرأ منه، فبلا هذه الكتابة يرى المشرف قرارين في شاشة واحدة.
        mirrorProviderSubscription(phone, true, until);
      },
      { confirm: 'تمديد' }
    );
    return;
  }
  if (action === 'clear') {
    close();
    askConfirm(
      'سحب بطاقة القرار',
      'يعود الرقم إلى «بلا قرار»: <strong>لا يظهر للزبائن</strong> حتى تكتب له اللوحة فترةً من جديد.',
      async () => {
        try {
          await db.collection(ACCESS_COLLECTION).doc(String(phone)).delete();
          await logActivity(ACCESS_ACTION_LABELS.clear, String(phone));
          toast('سُحبت البطاقة: لا يظهر للزبائن');
          loadProviders();
        } catch (err) { toast(err.message, true); }
      },
      { danger: true, confirm: 'سحب' }
    );
    return;
  }
  const patches = {
    stop: { subscriptionActive: false },
    start: { subscriptionActive: true },
    freeze: { frozen: true },
    unfreeze: { frozen: false },
    blockCalls: { callsAllowed: false },
    allowCalls: { callsAllowed: true },
  };
  const patch = patches[action];
  if (!patch) return;
  close();
  if (action === 'stop') {
    mirrorProviderSubscription(phone, false, null);
  } else if (action === 'start') {
    mirrorProviderSubscription(phone, true, null);
  }
  writeAccess(phone, patch, action);
}

/**
 * نسخ القرار إلى `providers`: العمودان القديمان في الجدول يقرآن من هناك.
 *
 * **والنسخ لا النقل:** `providers` تبقى سجلّ اللوحة التاريخيّا، و
 * `driver_access` هو ما ينفّذه الهاتف ولائحة الزبائن. فلو اختلفا كان
 * للمشرف جوابان عن سؤال واحد، وهذا أصدق طريقٍ إلى قرارٍ يُلغى بالخطأ.
 */
async function mirrorProviderSubscription(phone, active, end) {
  const p = providersState.find((x) => String(x.phone || '') === String(phone));
  if (!p) return;
  try {
    const upd = { subscription_active: active === true };
    if (end) upd.subscription_end = end;
    await db.collection('providers').doc(p.id).set(upd, { merge: true });
  } catch {}
}

/* ---------- قائمة تجديدات الاشتراك ---------- */

let renewalsState = [];
let renewalsFilter = 'pending';
let renewalsAccess = {};

/**
 * يقرأ طلبات التجديد التي أرسلها أصحابُ التوصيل بعد أن دفعوا.
 *
 * **والفرز بعد الجلب:** `createdAt` طابعٌ من الخادم، و`orderBy` مع `where`
 * يستدعي فهرسًا مركّبًا لا تحتاجه لوحةٌ بعشرات الأسطر. فالقراءة كلها ثم
 * الترتيب في المتصفّح، كما في قائمة تسجيل السائقين.
 *
 * **والقرار معروض مع الطلب:** المشرف يعتمد الدفع وهو يرى حالة الحساب —
 * مجمّد؟ منتهٍ من أسبوعين؟ سارٍ فيه عشرون يومًا؟ — لأن الاعتماد مدٌّ من
 * آخر نهاية لا من اليوم، وتلك الجملة لا تُعرف إلا برؤيتها.
 */
async function loadRenewals() {
  const snap = await db.collection(RENEWAL_COLLECTION).get();
  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt));
  if (renewalsFilter) rows = rows.filter((r) => (r.status || 'pending') === renewalsFilter);
  renewalsState = rows;

  renewalsNames = await providerNamesByPhone();
  const phones = Array.from(new Set(rows.map((r) => String(r.phone || '')).filter(Boolean)));
  renewalsAccess = await loadAccess(phones);
  setSegCount('renewals-pending', snap.docs.filter((d) => (d.data().status || 'pending') === 'pending').length);
  renderRenewals();
}

let renewalsNames = {};

/** رسمُ قائمة التجديدات وحدها: الأسماءُ والقراراتُ محفوظةٌ من القراءة. */
function renderRenewals() {
  const body = $('#renewals-body');
  if (!body) return;
  const rows = renewalsState.filter((r) => searchHit('renewals', [r.phone, r.reference, r.id]));
  if (!rows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="8">' +
      (renewalsState.length ? 'لا نتيجة لهذا البحث' : 'لا تجديدات في هذه الحالة') + '</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((r) => {
      const st = r.status || 'pending';
      const phone = String(r.phone || '');
      const badge = '<span class="badge ' + esc(st === 'approved' ? 'accepted' : st) + '">' +
        esc(RENEWAL_STATUS_LABELS[st] || st) + '</span>';
      const ref = r.reference ? '<div class="req-note">رقم العملية: ' + esc(r.reference) + '</div>' : '';
      const note = r.review_note ? '<div class="req-note">سبب الرفض: ' + esc(r.review_note) + '</div>' : '';
      let actions = '<div class="row-actions">';
      if (st === 'pending') {
        actions +=
          '<button class="btn-sm ok" onclick="reviewRenewal(\'' + esc(r.id) + '\',\'approve\')">اعتماد وتمديد شهر</button>' +
          '<button class="btn-sm no" onclick="reviewRenewal(\'' + esc(r.id) + '\',\'reject\')">رفض</button>';
      }
      actions += '<button class="btn-sm blue" onclick="openAccessPanel(\'' + esc(phone) + '\')">بطاقة القرار</button>';
      actions += '</div>';
      return (
        '<tr>' +
        '<td style="font-size:11px;max-width:90px;overflow:hidden;text-overflow:ellipsis" title="' + esc(r.id) + '">' +
          esc(String(r.id).substring(0, 10)) + '</td>' +
        '<td><strong>' + esc(renewalsNames[phone] || 'غير مسجّل في الجدول') + '</strong>' +
          '<div style="direction:ltr;text-align:right;font-size:12px">' + esc(phone) + '</div></td>' +
        '<td>' + esc(fmtMoney(r.amount)) + '</td>' +
        '<td>' + ref + (ref ? '' : '—') + '</td>' +
        '<td>' + fmtDate(r.createdAt) + '</td>' +
        '<td>' + accessCell(renewalsAccess[phone]) + '</td>' +
        '<td>' + badge + note + '</td>' +
        '<td>' + actions + '</td>' +
        '</tr>'
      );
    })
    .join('');
}

/** أسماء أصحاب التوصيل بأرقامهم: رقم → اسم، من جدول `providers`. */
async function providerNamesByPhone() {
  try {
    const snap = await db.collection('providers').get();
    const names = {};
    snap.docs.forEach((d) => {
      const data = d.data() || {};
      const phone = String(data.phone || '');
      if (phone) names[phone] = data.name || '';
    });
    return names;
  } catch {
    return {};
  }
}

/**
 * اعتمادُ دفعةٍ أو رفضُها — القرار كلّه هنا، ولا قرار في التطبيق.
 *
 * **والاعتماد هو وحده ما يطيل الاشتراك:** لو كفى أن يكتب صاحبُ التوصيل
 * «دفعتُ» لكان الدفعُ بيمنِ الدافع. فالطلب سطرٌ معلّق، والاعتماد كتابةٌ
 * في `driver_access` باسم المشرف الذي ضغطه.
 *
 * **والرفض لا يترك الحساب معلّقًا:** سببُ الرفض يُرسَل ملاحظةً إلى
 * تطبيقه، فيعرف أن المال لم يُقبَل ولماذا، بدل أن ينتظر شهرًا قرارًا
 * لا يأتي.
 */
async function reviewRenewal(id, decision) {
  const r = renewalsState.find((x) => x.id === id);
  if (!r) return;
  const phone = String(r.phone || '');
  const access = renewalsAccess[phone] || null;
  if (decision === 'reject') {
    askText('سبب رفض الدفع', 'اكتب ما يصل إلى صاحب التوصيل في تطبيقه…', (reason) => {
      finishRenewal(id, 'rejected', { review_note: reason, note: reason }, phone, null, reason);
    }, { required: true, confirm: 'رفض' });
    return;
  }
  const until = nextSubscriptionEnd(access, SUB_MONTH_DAYS);
  askConfirm(
    'اعتماد التجديد',
    'صاحب التوصيل: <strong>' + esc(phone) + '</strong><br>' +
    'المدفوع: <strong>' + esc(fmtMoney(r.amount)) + '</strong>' +
    (r.reference ? '<br>رقم العملية: <strong>' + esc(r.reference) + '</strong>' : '') +
    '<br><br>يُمدَّد ' + SUB_MONTH_DAYS + ' يومًا إلى: <strong>' + esc(fmtDateShort(until)) + '</strong>' +
    (access && access.frozen ? '<br><br>الحساب مجمّد: تُمدَّد المدّة ويبقى التجميد حتى ترفعه.' : ''),
    () => {
      finishRenewal(id, 'approved', {}, phone, until, '', access);
    },
    { confirm: 'اعتماد' }
  );
}

/**
 * كتابة القرار: الطلب، ثم الصلاحية، ثم المرآة في `providers`.
 *
 * **والمدّة تُكتب قبل حالة الطلب:** لو انقطعت الشبكة بعد الطلب وقبل
 * الصلاحية لرأى المشرف سطرًا معتمدًا بحسابٍ لم يُمَدَّ، فيعيد الاعتماد.
 * وبالعكس — صلاحيةٌ ممدودة وطلبٌ معلّق — يمدّ الشهر مرّتين. فالأخطر هو
 * الثاني، لذا تُكتب المدّة ثم تُعلَّم الحالة: الاعتماد مرّة واحدة في
 * كلتا الحالتين، والفرق يبقى في يد المشرف لا في يد الشبكة.
 */
async function finishRenewal(id, status, extraAccess, phone, until, reason, access) {
  try {
    if (status === 'approved') {
      await db.collection(ACCESS_COLLECTION).doc(phone).set({
        subscriptionActive: true,
        subscriptionEnd: until,
        // الدفعُ المعتمد اشتراكٌ مدفوع الوجه: التجريبية لا تُمنح إلا بزرٍّ
        // من المشرف، فلا يخلط التطبيقُ بين الكلمتين في شاشة صاحب التوصيل.
        plan: 'paid',
        history: grantHistory(access, SUB_MONTH_DAYS, 'paid'),
        ...extraAccess,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      mirrorProviderSubscription(phone, true, until);
    } else {
      await db.collection(ACCESS_COLLECTION).doc(phone).set({
        ...extraAccess,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await db.collection(RENEWAL_COLLECTION).doc(id).update({
      status,
      review_note: reason,
      reviewed_by: ADMIN.full_name,
      reviewed_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await logActivity(status === 'approved' ? 'اعتماد تجديد اشتراك' : 'رفض تجديد اشتراك', phone);
    toast(status === 'approved'
      ? 'تم اعتماد التجديد وتمديد الشهر'
      : 'تم رفض الطلب ووصلت صاحبَه الملاحظة');
    loadRenewals();
    loadProviders();
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * توحيد الصلاحيات: مستند قرارٍ لكل صاحب توصيل ليس له واحد.
 *
 * **ولماذا هو ضروري الآن؟** لأن القاعدة انقلبت: «بلا قرار» لم تعد عملًا
 * بالسماح، بل ظهورًا ممنوعًا. فمن قُبل قبل أن توجد هذه اللوحة سيُظلم كلُّه
 * في اللائحة ما لم تُنسخ حالته من `providers` إلى `driver_access` باسمها،
 * فيصير لكلّ رقمٍ قرارٌ يُمحى ويُكتب، وتسقط الذرائع عند أول خلافٍ على
 * ظهورٍ أو اتصال.
 *
 * **والزرّ لا يُبيضّ أحدًا سرًّا:** من نسخه قرارٌ سارٍ ظهر، ومن لا تاريخ
 * ساريًا له بقي مخفيًّا، واللوحة تقول العددين وتعرض عليه أن يمنح أولئك
 * فترةً تجريبية بمدةٍ يختارها هو — فالقرار بقي في يده لا في الكود.
 */
async function backfillAccess() {
  askConfirm(
    'توحيد الصلاحيات',
    'ينشئ مستند صلاحيات لكلّ صاحب توصيل لا مستند له، بنسخ قرار اللوحة الحاليّ: ' +
    'نشطٌ أو موقوفٌ أو محظورٌ وتاريخُ انتهائه.<br><br>' +
    'لا يغيّر أحدًا له مستند اليوم. ومن لا تاريخَ ساريًا له يبقى <strong>مخفيًّا</strong> ' +
    'عن الزبائن حتى تمنحه فترة — تقترحها اللوحة بعد الكتابة.',
    async () => {
      try {
        const snap = await db.collection('providers').get();
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() || {}) }))
          .filter((p) => String(p.phone || '').trim());
        const phones = rows.map((p) => String(p.phone).trim());
        const existing = await loadAccess(phones);
        const now = Date.now();
        const ops = [];
        const dark = [];
        let live = 0;
        rows.forEach((p) => {
          const phone = String(p.phone || '').trim();
          if (existing[phone]) return;
          // ونفسُ الحقيقة التي يراها في عمود «الاشتراك»: الصدقُ لا «ليس
          // موقوفًا»، فلو اختلف المصدران اختلف الجوابان.
          const active = Boolean(p.subscription_active);
          const endMs = millisOf(p.subscription_end);
          const grant = active && endMs > now && p.blocked !== true;
          if (grant) live++;
          else dark.push(phone);
          ops.push({
            ref: db.collection(ACCESS_COLLECTION).doc(phone),
            data: {
              subscriptionActive: active,
              // **والنسخةُ تُطبَعُ لا تُستنسَخُ نصًّا:** `providers` قديمٌ
              // يحفظ Ending تاريخًا نصًّا، وقاعدةُ الحماية تقارن الوقتَ
              //الخادميَّ بـ`timestamp` لا بسطر. فنكتبُ الرقمَ نفسَهُ الذي
              // صدَّقتهُ اللوحةُ تاريخًا حقيقيًّا، فلا يختلف «سارٍ» هنا على
              // «متاح» هناك، ولا يُحرم مشتركٌ من الظهورِ لأن شكلِ تاريخِهِ
              // مختلف.
              subscriptionEnd: endMs ? new Date(endMs) : null,
              frozen: p.blocked === true,
              callsAllowed: true,
              plan: grant ? 'paid' : '',
              note: '',
              migrated_from: 'providers',
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            opts: { merge: true },
          });
        });
        if (!ops.length) {
          toast('كل أصحاب التوصيل لهم قرارٌ مكتوب بالفعل');
          return;
        }
        await commitInChunks(ops);
        await logActivity('توحيد صلاحيات أصحاب التوصيل', ops.length + ' رقمًا');
        toast(
          'كُتبت ' + ops.length + ' قرارات: ' + live + ' سارية، و' +
          dark.length + ' بلا فترة'
        );
        loadProviders();
        if (dark.length) offerTrialTo(dark);
      } catch (err) {
        toast(err.message, true);
      }
    },
    { confirm: 'توحيد' }
  );
}

/**
 * طمسُ ما خُزّن قبل اليوم: كان القبولُ ينسخ كلمةَ سرّ صاحب التوصيل نصًّا
 * إلى جدول اللوحة، والكتابةُ أُغلقت الآن — لكن المستنداتِ القديمة تحمل ما
 * كُتب فيها. والحقلُ لا يُقرأ للدخول أصلاً، فمسحُهُ لا يقطعُ عن أحدٍ طريقَه.
 */
async function eraseProviderPasswords() {
  try {
    const snap = await db.collection('providers').get();
    const stored = snap.docs.filter((d) => {
      const v = d.data().password;
      return typeof v === 'string' && v.length > 0;
    });
    if (!stored.length) {
      toast('لا كلمةَ سرّ مخزّنة في جدول أصحاب التوصيل');
      return;
    }
    askConfirm(
      'طمس كلمات السرّ المخزّنة',
      'في جدول أصحاب التوصيل <strong>' + stored.length + '</strong> مستندًا يحمل كلمةَ سرٍّ نصًّا. ' +
      'يمسحها هذا الأمرُ من الجدول وحده، ولا يمسّ الاسمَ ولا الرقمَ ولا تواريخَ الاشتراك.' +
      '<br><br><strong>لا يتغيّر دخولُ أحد:</strong> التطبيقُ لا يقرأ من هذا الجدول شيئًا.',
      async () => {
        try {
          await commitInChunks(stored.map((d) => ({
            ref: db.collection('providers').doc(d.id),
            data: { password: firebase.firestore.FieldValue.delete() },
            opts: { merge: true },
          })));
          await logActivity('طمس كلمات السرّ من جدول أصحاب التوصيل', stored.length + ' مستندًا');
          toast('طُمست ' + stored.length + ' كلمة سرّ: لم يبقَ في الجدول نصٌّ يقرأه مشرف');
        } catch (err) {
          toast(err.message, true);
        }
      },
      { danger: true, confirm: 'طمس' }
    );
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * كتابةٌ على دفعات: Firestore لا تقبل أكثر من 500 عمليةٍ في الدفعة واحدة،
 * والدفعة الواحدة هي الضمان أن يرى المشرف إمّا كلَّ القرارات وإلا لا شيء —
 * فقرارٌ كتب نصفه أخطرُ من قرارٍ لم يُكتب.
 */
async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach((op) => {
      // و`del` هي الحذفُ في هذا الطريق: الكتابةُ بدمجٍ لا تمحو حقلًا،
      // والطمسُ والمسحُ يحتاجان عمليةَ حذفٍ مستقلة.
      if (op.del) batch.delete(op.ref);
      else batch.set(op.ref, op.data, op.opts);
    });
    await batch.commit();
  }
}

/** عرضُ فترة تجريبيةٍ على مجموعةِ أرقامٍ بقيت مخفيّة بعد التوحيد. */
function offerTrialTo(phones) {
  askText(
    'منح فترة تجريبية',
    'هؤلاء ' + phones.length + ' صاحب توصيل بلا فترةٍ سارية، فلا يظهرون للزبائن. ' +
    'كم يومًا تُمنح لهم؟ اتركه فارغًا لتُبقيهم مخفيّين حتى تقرّر كلَّ واحدٍ وحده.',
    (text) => {
      const raw = parseInt(String(text).replace(/[^0-9]/g, ''), 10);
      if (!raw) {
        toast('بقيوا بلا فترة: لا يظهرون حتى تكتب لهم قرارًا');
        return;
      }
      const days = Math.max(1, Math.min(365, raw));
      const until = new Date(Date.now() + days * 86400000);
      grantTrialBatch(phones, days, until);
    },
    // والفراغ هو الافتراضي هنا لا سبعٌ مكتوبة: ضغطةُ مفتاح واحد على خانةٍ
    // مليئة تمنح المدة على كل هؤلاء دفعةً واحدة، والمنحة الجماعية قرار
    // يستحق أن يكتبه المشرف بيده. الفردية يبقى فيها الافتراضي مكتوبًا —
    // هو اختار الرقم أولًا.
    { confirm: 'منح للجميع' }
  );
}

/** تنفيذ المنحة الجماعية، والمرآة في `providers` كما في كل قرار. */
async function grantTrialBatch(phones, days, until) {
  try {
    // **والسجلُّ يُقرأ قبل أن يُكتب:** الكتابةُ الجماعية بدمجٍ لا تعرف ما
    // قبلها، فلو كُتب السطرُ وحده لمحو ما قبله من منحٍ ذلك الرقم — وهذا
    // هو معنى «منحته الثالثة هذا العام».
    const prev = await loadAccess(phones);
    await commitInChunks(phones.map((phone) => ({
      ref: db.collection(ACCESS_COLLECTION).doc(phone),
      data: {
        subscriptionActive: true,
        subscriptionEnd: until,
        plan: 'trial',
        history: grantHistory(prev[phone], days, 'trial'),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      opts: { merge: true },
    })));
    await Promise.all(
      phones.map((phone) => mirrorProviderSubscription(phone, true, until))
    );
    await logActivity('منح فترة تجريبية', phones.length + ' رقمًا · ' + days + ' يومًا');
    toast('مُنحت ' + days + ' يومًا لـ' + phones.length + ' صاحب توصيل');
    loadProviders();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------- Customers ---------- */

async function loadCustomers() {
  const snap = await db.collection('customers').get();
  customersState = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCustomers();
}

/** رسمُ جدول الزبائن وحده: البحثُ لا يُعيد قراءة القاعدة. */
function renderCustomers() {
  const body = $('#customers-body');
  if (!body) return;
  if (!customersState.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">لا يوجد زبائن</td></tr>';
    return;
  }
  const rows = customersState.filter((c) => searchHit('customers', [c.name, c.phone, c.id]));
  if (!rows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">لا نتيجة لهذا البحث</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((c) =>
      '<tr>' +
      '<td style="font-size:11px;max-width:80px;overflow:hidden;text-overflow:ellipsis" title="' + esc(c.id) + '">' + esc(c.id.substring(0, 8)) + '</td>' +
      '<td>' +
      '<div class="cell-user">' +
      (c.photo
        ? '<img class="avatar" alt="" src="data:image/jpeg;base64,' + esc(c.photo) + '">'
        : '<span class="avatar avatar-fallback">' + esc(((c.name || '?').trim().charAt(0)) || '?') + '</span>') +
      '<div><strong>' + esc(c.name) + '</strong>' +
      (c.blocked ? ' <span class="badge rejected">محظور</span>' : (c.is_active === 0 ? ' <span class="badge inactive">موقوف</span>' : '')) +
      '</div></div>' +
      '</td>' +
      '<td>' + esc(c.phone) + '</td>' +
      '<td>' + fmtDateShort(c.joined_at) + '</td>' +
      '<td>' + (c.orders_count || 0) + '</td>' +
      '<td><div class="row-actions">' +
      '<button class="btn-sm blue" onclick="editCustomer(\'' + c.id + '\')">تعديل</button>' +
      '<button class="btn-sm ' + (c.is_active ? 'no' : 'ok') + '" onclick="toggleCustomer(\'' + c.id + '\',\'is_active\')">' + (c.is_active ? 'تعطيل' : 'تفعيل') + '</button>' +
      '<button class="btn-sm ' + (c.blocked ? 'ok' : 'no') + '" onclick="toggleCustomer(\'' + c.id + '\',\'blocked\')">' + (c.blocked ? 'رفع الحظر' : 'حظر') + '</button>' +
      '<button class="btn-sm no" onclick="deleteCustomer(\'' + c.id + '\')">حذف</button>' +
      '</div></td>' +
      '</tr>'
    )
    .join('');
}

/* ---------- Areas (المناطق) ---------- */

let areasState = [];

async function loadAreas() {
  const snap = await db.collection('neighborhoods').get();
  areasState = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  areasState.sort((a, b) => (a.ar || '').localeCompare(b.ar || '', 'ar'));
  const body = $('#areas-body');
  if (!areasState.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">لا توجد مناطق. اضغط «إضافة منطقة»</td></tr>';
    return;
  }
  body.innerHTML = areasState
    .map((a, i) =>
      '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><strong>' + esc(a.ar) + '</strong></td>' +
      '<td>' + esc(a.fr || '') + '</td>' +
      '<td>' + esc(a.en || '') + '</td>' +
      '<td>' + (a.hasProviders ? '<span class="badge online">متاح</span>' : '<span class="badge offline">غير متوفر</span>') + '</td>' +
      '<td><div class="row-actions">' +
      '<button class="btn-sm blue" onclick="editArea(\'' + a.id + '\')">تعديل</button>' +
      '<button class="btn-sm no" onclick="deleteArea(\'' + a.id + '\')">حذف</button>' +
      '</div></td>' +
      '</tr>'
    )
    .join('');
}

function areaModal({ title, data, submitLabel, onSubmit }) {
  const overlay = openModal({
    title,
    body:
      '<label class="modal-label">الاسم بالعربية *</label>' +
      '<input id="a-ar" class="modal-input" type="text" value="' + esc(data.ar || '') + '" placeholder="مثال: تيارت">' +
      '<label class="modal-label">الاسم بالفرنسية</label>' +
      '<input id="a-fr" class="modal-input" type="text" value="' + esc(data.fr || '') + '">' +
      '<label class="modal-label">الاسم بالإنجليزية</label>' +
      '<input id="a-en" class="modal-input" type="text" value="' + esc(data.en || '') + '">' +
      '<label class="modal-label">متوفر لديه أصحاب توصيل؟</label>' +
      '<div class="seg" style="margin-top:6px">' +
      '<button type="button" class="seg-btn' + (data.hasProviders ? ' active' : '') + '" id="a-hp-y">متاح</button>' +
      '<button type="button" class="seg-btn' + (!data.hasProviders ? ' active' : '') + '" id="a-hp-n">غير متوفر</button>' +
      '</div>',
    foot:
      '<button class="modal-btn ghost" data-close>إلغاء</button>' +
      '<button class="modal-btn ok" data-submit>' + esc(submitLabel) + '</button>',
  });
  let hasProviders = !!data.hasProviders;
  const y = overlay.querySelector('#a-hp-y');
  const n = overlay.querySelector('#a-hp-n');
  y.addEventListener('click', () => { y.classList.add('active'); n.classList.remove('active'); hasProviders = true; });
  n.addEventListener('click', () => { n.classList.add('active'); y.classList.remove('active'); hasProviders = false; });
  const save = async () => {
    const ar = overlay.querySelector('#a-ar').value.trim();
    const fr = overlay.querySelector('#a-fr').value.trim();
    const en = overlay.querySelector('#a-en').value.trim();
    if (!ar) { toast('الاسم بالعربية مطلوب', true); return; }
    overlay.remove();
    await onSubmit({ ar, fr: fr || ar, en: en || ar, hasProviders });
  };
  overlay.querySelector('[data-submit]').addEventListener('click', save);
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
}

function addArea() {
  areaModal({
    title: 'إضافة منطقة جديدة',
    data: { ar: '', fr: '', en: '', hasProviders: true },
    submitLabel: 'حفظ المنطقة',
    onSubmit: async (v) => {
      try {
        const id = 'ar_' + v.ar.replace(/\s+/g, '_').toLowerCase();
        await db.collection('neighborhoods').doc(id).set({
          id,
          ar: v.ar,
          fr: v.fr,
          en: v.en,
          hasProviders: v.hasProviders,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await logActivity('إضافة منطقة', v.ar);
        toast('تم إضافة المنطقة: ' + v.ar);
        loadAreas();
      } catch (err) { toast(err.message, true); }
    },
  });
}

function editArea(id) {
  const a = areasState.find((x) => x.id === id);
  if (!a) return;
  areaModal({
    title: 'تعديل المنطقة: ' + esc(a.ar),
    data: { ar: a.ar, fr: a.fr, en: a.en, hasProviders: a.hasProviders },
    submitLabel: 'حفظ التعديل',
    onSubmit: async (v) => {
      try {
        await db.collection('neighborhoods').doc(id).update({ ar: v.ar, fr: v.fr, en: v.en, hasProviders: v.hasProviders });
        await logActivity('تعديل منطقة', v.ar);
        toast('تم حفظ التعديل');
        loadAreas();
      } catch (err) { toast(err.message, true); }
    },
  });
}

function deleteArea(id) {
  const a = areasState.find((x) => x.id === id);
  if (!a) return;
  const overlay = openModal({
    title: 'حذف المنطقة',
    body: '<p>هل تريد حذف المنطقة <strong>' + esc(a.ar) + '</strong>؟ لا يمكن التراجع.</p>',
    foot:
      '<button class="modal-btn ghost" data-close>إلغاء</button>' +
      '<button class="modal-btn no" data-submit>حذف</button>',
  });
  const del = async () => {
    overlay.remove();
    try {
      await db.collection('neighborhoods').doc(id).delete();
      await logActivity('حذف منطقة', a.ar);
      toast('تم حذف المنطقة');
      loadAreas();
    } catch (err) { toast(err.message, true); }
  };
  overlay.querySelector('[data-submit]').addEventListener('click', del);
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
}

function editCustomer(id) {
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
  const save = async () => {
    const name = overlay.querySelector('#ec-name').value.trim();
    const phone = overlay.querySelector('#ec-phone').value.trim();
    if (!name || !phone) return toast('الاسم والهاتف مطلوبان', true);
    overlay.remove();
    try {
      await db.collection('customers').doc(id).update({ name, phone });
      await logActivity('تعديل بيانات زبون', name);
      toast('تم حفظ التعديل');
      loadCustomers();
    } catch (err) { toast(err.message, true); }
  };
  overlay.querySelector('[data-submit]').addEventListener('click', save);
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
}

async function toggleCustomer(id, field) {
  try {
    const doc = await db.collection('customers').doc(id).get();
    const current = doc.data()[field];
    let newVal;
    if (field === 'is_active') newVal = current ? 0 : 1;
    else newVal = !current;
    await db.collection('customers').doc(id).update({ [field]: newVal });
    const c = customersState.find(x => x.id === id);
    await logActivity('تغيير حالة زبون', c ? c.name : '');
    toast('تم التحديث');
    loadCustomers();
  } catch (err) { toast(err.message, true); }
}

async function deleteCustomer(id) {
  const c = customersState.find((x) => x.id === id);
  if (!c) return;
  askConfirm(
    'حذف الزبون',
    'هل تريد حذف "' + esc(c.name) + '" نهائياً؟<br>سيفقد حسابه ولن يستطيع الدخول.',
    async () => {
      try {
        await db.collection('customers').doc(id).delete();
        await logActivity('حذف زبون', c.name);
        toast('تم حذف الزبون');
        loadCustomers();
        loadDashboard();
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'حذف نهائي' }
  );
}

/* ---------- سجل النشاط ---------- */

let activityState = [];

async function loadActivity() {
  const snap = await db.collection('activity_log').orderBy('created_at', 'desc').limit(100).get();
  activityState = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderActivity();
}

function renderActivity() {
  const el = $('#activity-full');
  if (!el) return;
  const rows = activityState.filter((a) =>
    searchHit('activity', [a.action, a.target, a.admin_name])
  );
  el.innerHTML = rows.map((a) =>
    '<li>' + esc(a.action) + (a.target ? ' — <strong>' + esc(a.target) + '</strong>' : '') +
    (canWrite()
      ? '<button class="btn-sm no act-del" onclick="deleteActivityLine(\'' + esc(a.id) + '\')">حذف</button>'
      : '') +
    '<span class="act-time">' + fmtDate(a.created_at) + '</span></li>'
  ).join('') ||
    '<li>' + (activityState.length ? 'لا نتيجة لهذا البحث' : 'لا يوجد نشاط بعد') + '</li>';
}

/** سطرٌ واحد يُشَقّ من الدفتر: ما فُعِل وفيمن، في سطرٍ واحد. */
function deleteActivityLine(id) {
  const a = activityState.find((x) => x.id === id);
  askConfirm(
    'حذف سطر من سجل النشاط',
    'يُمحى سطر «<strong>' + esc((a && a.action) || id) + '</strong>' +
    (a && a.target ? ' — ' + esc(a.target) : '') + '» محوًا نهائيًا. ' +
    'والسجلُّ دفترُ اللوحة وحدها: لا يمسّ شيئًا في الحسابات ولا في القرارات.',
    async () => {
      try {
        await db.collection('activity_log').doc(String(id)).delete();
        toast('حُذف السطر');
        loadActivity();
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'حذف' }
  );
}

/**
 * مسحُ السجل كلّه بيد المالك وحده.
 *
 * **وليس مسحًا للقرارات:** يُمحى دفترُ «مَن فعل ماذا»، وتبقى بطاقاتُ القرار
 * والحساباتُ والاشتراكات كما هي. ويبقى بعده سطرٌ واحدٌ يقول إنه حدث — لأن
 * سجلًّا يزول بلا أثرٍ لا يُطمئن أحدًا ولا يُحاسب أحدًا.
 */
function clearActivity() {
  askConfirm(
    'مسح سجل النشاط',
    'يُمحى كلُّ ما في سجل النشاط محوًا نهائيًا. يبقى ما في الحسابات من قراراتٍ واشتراكاتٍ ووثائق.' +
    '<br><br>إن كنت تحتاج السجلَّ لمراجعةٍ بعد شهرٍ فلا تمسحه.',
    async () => {
      try {
        const snap = await db.collection('activity_log').get();
        if (!snap.docs.length) return toast('السجلُّ فارغٌ أصلًا');
        await commitInChunks(snap.docs.map((d) => ({ ref: d.ref, del: true })));
        activityState = [];
        renderActivity();
        await logActivity('مسح سجل النشاط', snap.docs.length + ' سطرًا');
        toast('مُحي السجل (' + snap.docs.length + ' سطرًا) وبقي سطرُ المسح نفسه');
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'مسح الكل' }
  );
}

/* ---------- Settings ---------- */

async function loadSubSettings() {
  try {
    const snap = await db.collection('settings').get();
    const data = {};
    snap.docs.forEach(d => { data[d.id] = d.data().value; });
    $('#set-fee').value = data.subscription_fee || 500;
    $('#set-phone').value = data.payment_phone || '';
    $('#set-note').value = data.payment_note || '';
  } catch (err) {
    toast(err.message, true);
  }
}

$('#subsettings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#subsettings-msg');
  // **والسعرُ ورقمُ المال بيد المالك:** المشرفُ يقرّر لمن يظهر ومتى، أمّا
  // ثمنُ الاشتراكُ ورقمُ الحِساب الذي تذهب إليه الأموال فليس قراراً يومياً
  // يقبل التعدّل بين رجلين في يومٍ واحد.
  if (!needRight('owner', 'الإعدادات العامة')) return;
  try {
    const batch = db.batch();
    batch.set(db.collection('settings').doc('subscription_fee'), { value: Number($('#set-fee').value) });
    batch.set(db.collection('settings').doc('payment_phone'), { value: $('#set-phone').value.trim() });
    batch.set(db.collection('settings').doc('payment_note'), { value: $('#set-note').value.trim() });
    await batch.commit();
    await logActivity('تحديث الإعدادات', 'قيمة الاشتراك ورقم ونص الدفع');
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
  const say = (t, bad) => {
    msg.textContent = t;
    msg.classList.remove('hidden');
    msg.style.color = bad ? 'var(--danger)' : 'var(--primary)';
  };
  const user = auth.currentUser;
  if (!user || !user.email) return say('لا جلسةَ دخولٍ محفوظة لإعادة التعيين', true);
  const current = $('#pw-current').value;
  const next = $('#pw-next').value;
  if (next.length < 6) return say('الجديدة قصيرة: ستّة محارف فأكثر', true);
  try {
    // **والتحقّقُ من القديمة هو إعادةُ الدخول لا مقارنةُ ملفّ:** السرّ
    // تعيش في مكانٍ واحد فقط. وكان البابُ السابق يقارن حقلًا مكتوبًا في
    // Firestore ثم يكتب حقلًا — فيقرأ المشرفُ «تم تغيير كلمة المرور»
    // ويدخل بكلمته القديمة: تحكّمٌ كاملُ الوهم، وسرٌّ مكشوفٌ لكل مشرفٍ
    // يملك قراءة الجدول.
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, current);
    await user.reauthenticateWithCredential(cred);
    await user.updatePassword(next);
    // ويُطمسُ كلُّ أثرٍ للسابق: حقلُ السرّ القديم لا يُقرأ ولا يُكتب بعد.
    await db.collection('admins').doc(user.uid).set(
      { password: firebase.firestore.FieldValue.delete() },
      { merge: true }
    );
    await logActivity('تغيير كلمة المرور', (ADMIN && ADMIN.full_name) || '');
    e.target.reset();
    say('تم تغيير كلمة المرور: ادخل بها من الآن');
  } catch (err) {
    say(err.code === 'auth/requires-recent-login'
      ? 'مرّ على دخولك وقتٌ طويل: اخرج ثم ادخل ثم أعد المحاولة'
      : (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential' || err.code === 'auth/invalid-login-credentials')
        ? 'كلمة المرور الحالية غير صحيحة'
        : 'تعذّر التغيير: ' + err.message, true);
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

document.querySelectorAll('#driverreq-seg .seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#driverreq-seg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    driverReqFilter = b.dataset.status;
    loadDriverRequests();
  })
);

document.querySelectorAll('#renewals-seg .seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#renewals-seg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    renewalsFilter = b.dataset.status;
    loadRenewals();
  })
);

/* فلاتر سجل المكالمات: التصفية من الذاكرة، فلا إعادة قراءة للقاعدة. */
document.querySelectorAll('#calls-seg .seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#calls-seg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    setCallsFilter(b.dataset.status);
  })
);

$('#trips-customer').addEventListener('change', () => loadTrips());

let searchT = null;
$('#orders-search').addEventListener('input', () => {
  clearTimeout(searchT);
  searchT = setTimeout(loadOrders, 350);
});

/* بحثُ الجداول: كلُّ خانةٍ تُرشِّح جدولَها من الذاكرة بلا قراءةٍ جديدة. */
bindSearch('calls-search', 'calls', renderCallsTable);
bindSearch('trips-search', 'trips', renderTrips);
bindSearch('providers-search', 'providers', renderProviders);
bindSearch('customers-search', 'customers', renderCustomers);
bindSearch('requests-search', 'requests', renderRequests);
bindSearch('driverreq-search', 'driverreq', renderDriverRequests);
bindSearch('renewals-search', 'renewals', renderRenewals);
bindSearch('activity-search', 'activity', renderActivity);

function startClock() {
  const update = () => {
    $('#clock').textContent = new Date().toLocaleString('ar-MA');
  };
  update();
  clearInterval(startClock._i);
  startClock._i = setInterval(update, 30000);
}

/* ---------- Boot ---------- */

/*
 * الجلسة تُقرأ من Firebase Auth لا من `sessionStorage`:
 *
 * - **`sessionStorage` كان ثقة كاذبة.** حفظ المشرف فيه كان يعني أن
 *   الصفحة تثق بمتغيّر يكتبه أي سكربت في المتصفح نفسه.
 * - **جلسة Auth تبقى بعد إغلاق المتصفح.** فالدخول يظهر تلقائياً، وهو
 *   ما يفعله أي منتج، والخروج الحقيقي هو `signOut`.
 * - **بلا إنشاء تلقائي لكلمة مرور.** الكود القديم كان يكتب `admins/admin`
 *   بكلمة مرور `admin123` إن كانت المجموعة فارغة — باب مفتوح يُفتح
 *   وحده. حُذف، وإنشاء الحساب الأول صار عمل المالك.
 */
async function boot() {
  // **والحرسُ قبل أي شيء:** الأزرارُ تُرسم بعد الدخول، فلا يفلت فعلٌ
  // من الدرجات لأنّ لافّةً تأخّرت.
  guardRights();
  try {
    const user = auth.currentUser || (await new Promise((res) => {
      const un = auth.onAuthStateChanged((u) => { un(); res(u); });
    }));
    if (user) {
      const profile = await loadAdminProfile(user.uid);
      if (profile) {
        ADMIN = profile;
        sessionStorage.setItem('hamada_admin', JSON.stringify(ADMIN));
        enterApp();
        return;
      }
      // حساب موجود بلا صلاحية: نُخرج منه حتى لا تبقى جلسة معلّقة
      // على شاشة لا يستطيع منها فعل شيء.
      await auth.signOut();
    }
  } catch {}

  // شاشة الدخول ظاهرة افتراضياً الآن؛ نضمن ذلك فقط.
  $('#login-screen').classList.remove('hidden');
}

$('#req-btn').addEventListener('click', handleAdminRequest);

boot();
