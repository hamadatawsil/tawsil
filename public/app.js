'use strict';

const db = firebase.firestore();
let ADMIN = null;
let ordersState = [];
let providersState = [];
let customersState = [];

/* ---------- إعدادات المكالمات (Agora) ---------- */
const AGORA_APP_ID = '9f539745893d4bbb86741430ab9137db';
const AGORA_APP_CERT = '4f051a05587648238e6d208198db110f';
const CALL_ADMIN_ID = 'admin';
const CALL_ADMIN_UID = 2;
const RING_TIMEOUT_MS = 60000;

const CALL_STATUS_LABELS = {
  ringing: 'يرن',
  ongoing: 'جارية',
  ended: 'منتهية',
  declined: 'مرفوضة',
  missed: 'فائتة',
};

let callsState = [];
let callsSub = null;
let ringToneTimer = null;
let activeRingCallId = null;
let callEngine = null;
let callMicTrack = null;
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
    const [pending, resub, newOrders] = await Promise.all([
      pendingRef.count().get(),
      resubRef.count().get(),
      newOrdersRef.count().get(),
    ]);
    setNavBadge('requests', pending.data().count + resub.data().count);
    setNavBadge('orders', newOrders.data().count);
    setSegCount('requests-pending', pending.data().count);
    setSegCount('orders-new', newOrders.data().count);
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

/* ---------- المكالمات (Agora) ---------- */

function callRoleLabel(role) {
  const map = { guest: 'زائر', customer: 'زبون', driver: 'صاحب توصيل', owner: 'صاحب توصيل', admin: 'الإدارة' };
  return map[role] || role || '—';
}

async function agoraHmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, dataBytes);
  return new Uint8Array(sig);
}

function agWriteUint16(bytes, off, v) {
  bytes[off] = v & 0xff;
  bytes[off + 1] = (v >> 8) & 0xff;
}

function agWriteUint32(bytes, off, v) {
  bytes[off] = v & 0xff;
  bytes[off + 1] = (v >>> 8) & 0xff;
  bytes[off + 2] = (v >>> 16) & 0xff;
  bytes[off + 3] = (v >>> 24) & 0xff;
}

function agCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function agBase64(bytes) {
  const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += CH[b0 >> 2];
    out += CH[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? CH[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? CH[b2 & 63] : '=';
  }
  return out;
}

function agPackMessage(salt, ts, expireTs) {
  const out = new Uint8Array(34);
  let off = 0;
  agWriteUint32(out, off, salt); off += 4;
  agWriteUint32(out, off, ts); off += 4;
  agWriteUint16(out, off, 4); off += 2;
  [1, 2, 3, 4].forEach((k) => {
    agWriteUint16(out, off, k); off += 2;
    agWriteUint32(out, off, expireTs); off += 4;
  });
  return out;
}

function agConcat(parts) {
  const len = parts.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const b of parts) { out.set(b, off); off += b.length; }
  return out;
}

async function agoraToken(appId, appCert, channel, uid, expireTs) {
  const te = new TextEncoder();
  const uidStr = uid === 0 ? '' : String(uid);
  const salt = (Math.floor(Math.random() * 0x7fffffff) + (Math.floor(Math.random() * 2) << 31)) >>> 0;
  const ts = Math.floor(Date.now() / 1000) + 24 * 3600;
  const m = agPackMessage(salt, ts, expireTs);

  const signData = agConcat([te.encode(appId), te.encode(channel), te.encode(uidStr), m]);
  const sig = await agoraHmacSha256(te.encode(appCert), signData);
  const crcChannel = agCrc32(te.encode(channel));
  const crcUid = agCrc32(te.encode(uidStr));

  const content = new Uint8Array(2 + sig.length + 4 + 4 + 2 + m.length);
  let off = 0;
  agWriteUint16(content, off, sig.length); off += 2;
  content.set(sig, off); off += sig.length;
  agWriteUint32(content, off, crcChannel); off += 4;
  agWriteUint32(content, off, crcUid); off += 4;
  agWriteUint16(content, off, m.length); off += 2;
  content.set(m, off);

  return '006' + appId + agBase64(content);
}

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

async function endCallDoc(callId, status, reason) {
  const patch = { status, endedAt: firebase.firestore.FieldValue.serverTimestamp() };
  if (reason) patch.endReason = reason;
  try { await db.collection('calls').doc(callId).update(patch); } catch {}
}

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
        micHint.textContent = 'إذن الميكروفون مرفوض لهذا الموقع — افتح القفل قرب العنوان وفعّل «الميكروفون: السماح»، ثم أعد تحميل الصفحة.';
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
    handledRinging.add(data.id);
    close();
  });
  close._t = setTimeout(async () => {
    await endCallDoc(data.id, 'missed', 'callee_no_answer');
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
  const overlay = openModal({
    title: 'مكالمة جارية',
    body:
      '<div class="incoming-call-avatar">☎</div>' +
      '<div class="incoming-call-name">' + esc(data.callerName || data.callerId || '') + '</div>' +
      '<div class="call-status-ring" id="call-timer">00:00</div>',
    foot:
      '<button class="modal-btn ghost" data-mute>كتم</button>' +
      '<button class="modal-btn no" data-hangup>إنهاء</button>',
  });
  overlay.classList.add('call-active-overlay');
  const titleClose = overlay.querySelector('.doc-lightbox-head .btn-sm');
  if (titleClose) titleClose.style.display = 'none';

  const t0 = Date.now();
  const tick = setInterval(() => {
    const el = overlay.querySelector('#call-timer');
    if (!el) return;
    const s = Math.floor((Date.now() - t0) / 1000);
    el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 1000);
  clearActiveCallTicker();
  activeCallTicker = tick;

  let muted = false;
  const muteBtn = overlay.querySelector('[data-mute]');
  muteBtn.addEventListener('click', async () => {
    muted = !muted;
    muteBtn.textContent = muted ? 'التحدث' : 'كتم';
    try { if (callMicTrack) await callMicTrack.setEnabled(!muted); } catch {}
  });
  overlay.querySelector('[data-hangup]').addEventListener('click', async () => {
    await hangupCall(data.id);
  });
}

async function answerIncomingCall(data) {
  if (typeof AgoraRTC === 'undefined') {
    toast('فشل تحميل نظام المكالمات (Agora SDK). أعد تحميل الصفحة وتحقق من الإنترنت.', true);
    callInProgress = false;
    return;
  }
  const callId = data.id;
  try {
    callInProgress = true;
    const channel = data.channelName || ('call_' + callId);

    const mic = await AgoraRTC.createMicrophoneAudioTrack();
    callMicTrack = mic;

    const token = await agoraToken(
      AGORA_APP_ID, AGORA_APP_CERT, channel, CALL_ADMIN_UID,
      Math.floor(Date.now() / 1000) + 86400
    );
    const client = AgoraRTC.createClient({ mode: 'rtc' });
    callEngine = client;

    client.on('user-published', async (user, mediaType) => {
      await client.subscribe(user, mediaType);
      if (mediaType === 'audio' && user.audioTrack) user.audioTrack.play();
    });
    client.on('user-unpublished', (user, mediaType) => {
      if (mediaType === 'audio' && user.audioTrack) user.audioTrack.stop();
    });
    client.on('user-left', async () => {
      await hangupCall(callId);
    });

    await client.join(token, channel, CALL_ADMIN_UID);
    await client.publish(mic);
    await db.collection('calls').doc(callId).update({
      status: 'ongoing',
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showActiveCall(data);
    toast('مكالمة جارية الآن — ' + (data.callerName || ''));
  } catch (err) {
    callInProgress = false;
    console.error('[calls] answer error', err);
    try { if (callMicTrack) { callMicTrack.close(); callMicTrack = null; } } catch {}
    try { if (callEngine) await callEngine.leave(); } catch {}
    callEngine = null;
    try { await endCallDoc(callId, 'missed', 'admin_error'); } catch {}
    let msg;
    if (err && err.code) {
      msg = '[' + (err.name || 'AgoraRTCError') + ' ' + err.code + '] ' + (err.message || String(err));
    } else {
      msg = (err && (err.message || err.reason || String(err))) || 'خطأ غير معروف';
    }
    if (/NotAllowed|Permission|denied/i.test(msg)) {
      msg = 'ممنوع الوصول إلى الميكروفون. اسمح بالميكروفون في المتصفح ثم أعد المحاولة.';
    }
    toast('تعذر الرد على المكالمة: ' + msg, true);
  }
}

async function hangupCall(callId) {
  try {
    await db.collection('calls').doc(callId).update({
      status: 'ended',
      endedAt: firebase.firestore.FieldValue.serverTimestamp(),
      endReason: 'admin_ended',
    });
  } catch {}
  clearActiveCallTicker();
  closeActiveCallOverlay();
  try { if (callMicTrack) { callMicTrack.close(); callMicTrack = null; } } catch {}
  try { if (callEngine) await callEngine.leave(); } catch {}
  callEngine = null;
  callInProgress = false;
}

function renderCallsTable() {
  const tbody = $('#calls-body');
  if (!tbody) return;
  if (!callsState.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">لا توجد مكالمات بعد</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  callsState.forEach((c, i) => {
    const created = c.createdAt ? fmtDate(c.createdAt) : '—';
    let duration = '—';
    if (c.startedAt && c.endedAt) {
      const start = c.startedAt.toDate ? c.startedAt.toDate() : new Date(c.startedAt);
      const end = c.endedAt.toDate ? c.endedAt.toDate() : new Date(c.endedAt);
      const diff = Math.max(0, Math.round((end - start) / 1000));
      duration = String(Math.floor(diff / 60)).padStart(2, '0') + ':' + String(diff % 60).padStart(2, '0');
    }
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (i + 1) + '</td>' +
      '<td>' + esc(c.callerName || c.callerId || '—') + '</td>' +
      '<td>' + esc(callRoleLabel(c.callerRole)) + '</td>' +
      '<td>' + esc(created) + '</td>' +
      '<td>' + esc(CALL_STATUS_LABELS[c.status] || c.status || '—') + '</td>' +
      '<td>' + duration + '</td>';
    tbody.appendChild(tr);
  });
}

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
  } catch {}
}

function stopCallsListener() {
  if (callsSub) { callsSub(); callsSub = null; }
  stopRingTone();
  clearActiveCallTicker();
  closeActiveCallOverlay();
  try { if (callMicTrack) { callMicTrack.close(); callMicTrack = null; } } catch {}
  try { if (callEngine) callEngine.leave(); } catch {}
  callEngine = null;
  callInProgress = false;
  activeRingCallId = null;
}

async function loadCalls() {
  const snap = await db.collection('calls').orderBy('createdAt', 'desc').limit(80).get();
  callsState = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  refreshCallsBadge();
  renderCallsTable();
}

/* ---------- Login ---------- */

async function handleLogin(e) {
  e.preventDefault();
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  $('#login-btn').textContent = 'جاري الدخول...';
  try {
    const snap = await db.collection('admins').where('username', '==', username).limit(1).get();
    if (snap.empty) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
    const doc = snap.docs[0];
    const data = doc.data();
    if (data.password !== password) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
    ADMIN = { id: doc.id, username: data.username, full_name: data.full_name, role: data.role };
    sessionStorage.setItem('hamada_admin', JSON.stringify(ADMIN));
    enterApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
    $('#login-error').classList.remove('hidden');
  } finally {
    $('#login-btn').textContent = 'دخول';
  }
}

function logout() {
  ADMIN = null;
  stopActivityPoller();
  stopCallsListener();
  sessionStorage.removeItem('hamada_admin');
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
  refreshNavBadges();
  initCallsListener();
}

/* ---------- Navigation ---------- */

const TITLES = {
  dashboard: 'لوحة الإحصائيات',
  requests: 'طلبات الاشتراك',
  orders: 'الطلبات',
  calls: 'المكالمات',
  providers: 'أصحاب التوصيل',
  customers: 'الزبائن',
  areas: 'المناطق',
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
    if (name === 'orders') await loadOrders();
    if (name === 'calls') await loadCalls();
    if (name === 'providers') await loadProviders();
    if (name === 'customers') await loadCustomers();
    if (name === 'areas') await loadAreas();
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
  const activeProviders = providersSnap.docs.filter(d => d.data().is_connected).length;

  const stats = {
    orders_today: ordersToday.length,
    pending_requests: pendingSnap.size,
    active_providers: activeProviders,
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
  const body = $('#requests-body');
  if (!requestsState.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="8">لا توجد طلبات</td></tr>';
    return;
  }
  body.innerHTML = requestsState
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
              password: req.password || '',
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
          name: req.name, phone: req.phone, password: req.password || '', plate: '', rating: 0,
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

async function loadProviders() {
  const snap = await db.collection('providers').get();
  providersState = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const body = $('#providers-body');
  if (!providersState.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="9">لا يوجد أصحاب توصيل</td></tr>';
    return;
  }
  body.innerHTML = providersState
    .map((p) =>
      '<tr>' +
      '<td style="max-width:70px">' +
      (p.photo
        ? '<img class="prov-avatar" src="data:image/jpeg;base64,' + esc(p.photo) + '" onclick="openDocImage(this.src,\'' + esc(p.name) + '\')" style="width:38px;height:38px;border-radius:50%;object-fit:cover;cursor:pointer" title="' + esc(p.id) + '">'
        : '<div style="width:38px;height:38px;border-radius:50%;background:#e5e7eb" title="' + esc(p.id) + '"></div>') +
      '</td>' +
      '<td><strong>' + esc(p.name) + '</strong>' +
      (p.blocked ? ' <span class="badge rejected">محظور</span>' : '') +
      '</td>' +
      '<td>' + esc(p.phone) + '</td>' +
      '<td>' + esc(p.plate || '') + '</td>' +
      '<td>★ ' + esc(p.rating || 0) + '</td>' +
      '<td><span class="badge ' + (p.is_connected ? 'online' : 'offline') + '">' + (p.is_connected ? 'متصل' : 'غير متصل') + '</span></td>' +
      '<td><span class="badge ' + (p.subscription_active ? 'active' : 'inactive') + '">' + (p.subscription_active ? 'نشط' : 'موقوف') + '</span></td>' +
      '<td>' + fmtDateShort(p.subscription_end) + '</td>' +
      '<td><div class="row-actions">' +
      '<button class="btn-sm blue" onclick="editProvider(\'' + p.id + '\')">تعديل</button>' +
      '<button class="btn-sm blue" onclick="toggleProvider(\'' + p.id + '\',\'is_connected\')">' + (p.is_connected ? 'إيقاف الاتصال' : 'تفعيل الاتصال') + '</button>' +
      '<button class="btn-sm ' + (p.subscription_active ? 'no' : 'ok') + '" onclick="toggleProvider(\'' + p.id + '\',\'subscription_active\')">' + (p.subscription_active ? 'إيقاف الاشتراك' : 'تفعيل الاشتراك') + '</button>' +
      '<button class="btn-sm ' + (p.blocked ? 'ok' : 'no') + '" onclick="toggleProvider(\'' + p.id + '\',\'blocked\')">' + (p.blocked ? 'رفع الحظر' : 'حظر') + '</button>' +
      '<button class="btn-sm no" onclick="deleteProvider(\'' + p.id + '\')">حذف</button>' +
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
    '<button class="btn-primary rv-save" onclick="saveProvider(this,\'' + id + '\')">حفظ التعديل</button>' +
    '</div>' +
    '</div>';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

async function saveProvider(btn, id) {
  const overlay = btn.closest('.doc-lightbox');
  const name = overlay.querySelector('#ep-name').value.trim();
  const phone = overlay.querySelector('#ep-phone').value.trim();
  const plate = overlay.querySelector('#ep-plate').value.trim();
  if (!name || !phone) return toast('الاسم والهاتف مطلوبان', true);
  btn.disabled = true;
  try {
    await db.collection('providers').doc(id).update({ name, phone, plate });
    await logActivity('تعديل بيانات', name);
    toast('تم حفظ التعديل');
    overlay.remove();
    loadProviders();
  } catch (err) { btn.disabled = false; toast(err.message, true); }
}

async function deleteProvider(id) {
  const p = providersState.find((x) => x.id === id);
  if (!p) return;
  askConfirm(
    'حذف صاحب التوصيل',
    'هل تريد حذف "' + esc(p.name) + '" نهائياً؟<br>سيفقد حسابه وصلاحياته ولن يستطيع الدخول.',
    async () => {
      try {
        await db.collection('providers').doc(id).delete();
        await logActivity('حذف صاحب توصيل', p.name);
        toast('تم حذف صاحب التوصيل');
        loadProviders();
        loadDashboard();
      } catch (err) { toast(err.message, true); }
    },
    { danger: true, confirm: 'حذف نهائي' }
  );
}

async function toggleProvider(id, field) {
  try {
    const doc = await db.collection('providers').doc(id).get();
    const current = doc.data()[field];
    await db.collection('providers').doc(id).update({ [field]: !current });
    const p = providersState.find(x => x.id === id);
    const label = field === 'is_connected' ? 'تفعيل/إيقاف الاتصال' : field === 'subscription_active' ? 'تفعيل/إيقاف الاشتراك' : 'حظر/رفع الحظر';
    await logActivity(label, p ? p.name : '');
    toast('تم التحديث');
    loadProviders();
    loadDashboard();
  } catch (err) { toast(err.message, true); }
}

/* ---------- Customers ---------- */

async function loadCustomers() {
  const snap = await db.collection('customers').get();
  customersState = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const body = $('#customers-body');
  if (!customersState.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">لا يوجد زبائن</td></tr>';
    return;
  }
  body.innerHTML = customersState
    .map((c) =>
      '<tr>' +
      '<td style="font-size:11px;max-width:80px;overflow:hidden;text-overflow:ellipsis" title="' + esc(c.id) + '">' + esc(c.id.substring(0, 8)) + '</td>' +
      '<td><strong>' + esc(c.name) + '</strong>' +
      (c.blocked ? ' <span class="badge rejected">محظور</span>' : (c.is_active === 0 ? ' <span class="badge inactive">موقوف</span>' : '')) +
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

/* ---------- Activity ---------- */

async function loadActivity() {
  const snap = await db.collection('activity_log').orderBy('created_at', 'desc').limit(100).get();
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
  try {
    const current = $('#pw-current').value;
    const next = $('#pw-next').value;
    const snap = await db.collection('admins').where('username', '==', ADMIN.username).limit(1).get();
    if (snap.empty || snap.docs[0].data().password !== current) {
      throw new Error('كلمة المرور الحالية غير صحيحة');
    }
    await snap.docs[0].ref.update({ password: next });
    await logActivity('تغيير كلمة المرور', ADMIN.full_name);
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
  const saved = sessionStorage.getItem('hamada_admin');
  if (saved) {
    try {
      ADMIN = JSON.parse(saved);
      if (ADMIN && ADMIN.id) {
        const doc = await db.collection('admins').doc(ADMIN.id).get();
        if (doc.exists) {
          ADMIN = { id: doc.id, ...doc.data() };
          enterApp();
          return;
        }
      }
    } catch {}
    sessionStorage.removeItem('hamada_admin');
  }

  try {
    const snap = await db.collection('admins').limit(1).get();
    if (snap.empty) {
      await db.collection('admins').doc('admin').set({
        username: 'admin',
        password: 'admin123',
        full_name: 'مدير النظام',
        role: 'owner',
      });
      await db.collection('settings').doc('subscription_fee').set({ value: 500 });
      await db.collection('settings').doc('payment_phone').set({ value: '+222 33 123 45 67' });
      await db.collection('settings').doc('payment_note').set({ value: 'قم بالإرسال من خلال بنكيلي أو مصرفي أو بيم بانك أو السداد إلى' });
    }
  } catch {}

  $('#login-screen').classList.remove('hidden');
}

boot();
