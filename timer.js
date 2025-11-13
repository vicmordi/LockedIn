/* === timer.js — modernized focus flow with animated progress & break quotes === */

let cfg = null;
let quotesEnabled = true;

let remainingMs = 0;
let durationMs = 0;
let endAt = null;
let timerId = null;
let paused = true;
let phase = 'focus';
let nextMicroAt = null;
let nextStandAt = null;
let sessionConfigured = false;
let wakeLock = null;
let pendingAction = null;
let timeupHandled = false;

let quoteTimer = null;
let quotePanel = null;
let quoteTextEl = null;
let quoteExpanded = false;
let quoteIdx = 0;

const timerEl = document.getElementById('timer');
const minimal = document.getElementById('minimal');
const minimalTimer = document.getElementById('minimalTimer');
const clockShell = document.getElementById('clockShell');
const phaseLabel = document.getElementById('phaseLabel');
const phasePill = document.getElementById('phasePill');
const progressBar = document.getElementById('bar');
const progressTrack = document.querySelector('.progress');
const pauseResumeBtn = document.getElementById('pauseResume');
const endEarlyBtn = document.getElementById('endEarly');
const resetBtn = document.getElementById('reset');
const emergencyBtn = document.getElementById('emergencyBtn');
const focusModeBtn = document.getElementById('focusModeBtn');
const historyLink = document.getElementById('historyLink');
const backToSetup = document.getElementById('backToSetup');
const historyDiv = document.getElementById('history');
const sessionInfoDiv = document.getElementById('sessionInfo');
const sheet = document.getElementById('sheet');
const emergencyLinks = document.getElementById('emergencyLinks');
const pinInput = document.getElementById('pinInput');
const submitPin = document.getElementById('submitPin');
const cancelSheet = document.getElementById('cancelSheet');
const wakelockStatus = document.getElementById('wakelockStatus');
const toasts = document.getElementById('toasts');
const toggleSound = document.getElementById('toggleSound');

const headerLock = document.getElementById('headerLock');
const headerKeyhole = headerLock ? headerLock.querySelector('.keyhole') : null;

function setLockState(state){
  if (!headerLock) return;
  headerLock.className = `lock-anim ${state}`;
}

function fmt(ms){
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
function phoneOk(v){ return (v || '').replace(/\s+/g, '').length >= 3; }

/* === Wake lock === */
async function enableWakeLock(){
  try{
    if ('wakeLock' in navigator){
      wakeLock = await navigator.wakeLock.request('screen');
      wakelockStatus.textContent = 'Screen lock: on';
      wakeLock.addEventListener('release', () => wakelockStatus.textContent = 'Screen lock: off');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && !wakeLock){
          try{
            wakeLock = await navigator.wakeLock.request('screen');
            wakelockStatus.textContent = 'Screen lock: on';
          }catch(_){}
        }
      });
    }else{
      wakelockStatus.textContent = 'Screen lock: unavailable';
    }
  }catch(_){
    wakelockStatus.textContent = 'Screen lock: off';
  }
}
function disableWakeLock(){
  if (wakeLock){
    wakeLock.release().catch(()=>{});
    wakeLock = null;
    wakelockStatus.textContent = 'Screen lock: off';
  }
}

/* === Before unload guard === */
function hookUnload(){ window.onbeforeunload = () => 'Focus session in progress.'; }
function unhookUnload(){ window.onbeforeunload = null; }

/* === Helpers for focus mode and sound nudge === */
function clearSoundNudge(){
  const n = document.getElementById('soundNudge');
  if (n && n.parentNode){
    n.parentNode.removeChild(n);
  }
}
function isFocusModeActive(){
  return minimal && minimal.getAttribute('aria-hidden') === 'false';
}

/* === Minimal overlay === */
function showMinimal(on){
  if (!minimal) return;
  minimal.setAttribute('aria-hidden', on ? 'false' : 'true');

  // Hide toasts + sound nudge in Focus Mode so nothing sits on top of the full-screen timer
  if (on){
    if (toasts){
      toasts.dataset.prevDisplay = toasts.style.display || '';
      toasts.style.display = 'none';
    }
    clearSoundNudge();
  }else{
    if (toasts){
      toasts.style.display = toasts.dataset.prevDisplay || '';
    }
  }
}

/* === Fullscreen === */
async function enterFullscreen(){
  try{
    if (!document.fullscreenElement){
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  }catch(_){}
}
async function exitFullscreen(){
  try{
    if (document.fullscreenElement){
      await document.exitFullscreen();
    }
  }catch(_){}
}

/* === Focus Mode === */
async function enterFocusMode(){
  if (paused) return;
  showMinimal(true);
  await enterFullscreen();
}
async function exitFocusMode(){
  showMinimal(false);
  await exitFullscreen();
}

/* === Phase & UI === */
function phaseName(){
  switch (phase){
    case 'micro': return 'Micro break';
    case 'stand': return 'Stand / stretch';
    default: return 'Focus';
  }
}

function updateUI(){
  const formatted = fmt(remainingMs);
  if (timerEl) timerEl.textContent = formatted;
  if (minimalTimer) minimalTimer.textContent = formatted;

  const progress = durationMs > 0 ? Math.min(1, Math.max(0, 1 - (remainingMs / durationMs))) : 0;
  if (clockShell){
    clockShell.style.setProperty('--progress', progress);
    clockShell.classList.toggle('paused', paused);
  }
  if (progressBar) progressBar.style.width = `${Math.round(progress * 100)}%`;
  if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(Math.round(progress * 100)));

  const phaseText = phaseName();
  if (phaseLabel) phaseLabel.textContent = `Phase: ${phaseText}`;
  if (phasePill) phasePill.textContent = phaseText;
  if (headerKeyhole){
    headerKeyhole.style.fill = phase === 'focus' ? '#b388ff' : '#7e57c2';
  }

  if (pauseResumeBtn){
    pauseResumeBtn.textContent = paused ? 'Resume' : 'Pause';
  }
}

/* === History === */
function loadHistory(){
  try{
    return JSON.parse(localStorage.getItem('li_history') || '[]');
  }catch(_){
    return [];
  }
}
function saveHistory(list){
  localStorage.setItem('li_history', JSON.stringify(list.slice(-200)));
}
function addHistory(item){
  const list = loadHistory();
  list.push(item);
  saveHistory(list);
  renderHistory();
}
function renderHistory(){
  const list = loadHistory().slice().reverse();
  historyDiv.innerHTML = list.map(entry => {
    const date = new Date(entry.date).toLocaleString();
    const outcomeClass = entry.outcome === 'Completed' ? 'ok' : 'bad';
    const note = entry.description ? `<p class="history-item__note">${escapeHtml(entry.description)}</p>` : '';
    return `<article class="history-item">
      <div class="history-item__meta">
        <span>${date}</span>
        <span class="history-tag ${outcomeClass}">${entry.outcome}</span>
      </div>
      <div class="history-item__details">${entry.minutes} min • ${escapeHtml(entry.label || 'Focus')}</div>
      ${note}
    </article>`;
  }).join('') || '<div class="history-empty">No sessions yet. Complete one to start your streak.</div>';
}

/* === Break quotes === */
const BREAK_QUOTES = [
  'Lock in now, cash out later.',
  'Discipline today becomes freedom tomorrow.',
  'Tiny wins compound. Stay with it.',
  'You are building a future no one can take.',
  'Focus is the edge most people dismiss—use it.',
  'This chapter becomes your testimony.',
  'Momentum loves consistency. Keep your promise.',
  'Protect the work that matters most right now.'
];

function ensureQuotePanel(){
  if (quotePanel || !timerEl) return;

  timerEl.classList.add('is-hidden');
  if (clockShell){
    clockShell.classList.add('quotes-visible');
  }

  quotePanel = document.createElement('div');
  quotePanel.id = 'pausedQuote';
  quotePanel.className = 'quote-card';

  const header = document.createElement('div');
  header.className = 'quote-card__header';

  const chip = document.createElement('span');
  chip.className = 'quote-chip';
  chip.textContent = 'Paused';
  header.appendChild(chip);

  const headerText = document.createElement('span');
  headerText.textContent = 'Tap to expand';
  header.appendChild(headerText);

  quotePanel.appendChild(header);

  quoteTextEl = document.createElement('div');
  quoteTextEl.className = 'quote-card__text';
  quotePanel.appendChild(quoteTextEl);

  const hint = document.createElement('div');
  hint.className = 'quote-card__hint';
  hint.textContent = 'Tap inside to expand. Resume when you are ready.';
  quotePanel.appendChild(hint);

  quotePanel.addEventListener('click', (event) => {
    const isControl = event.target.closest('.controls') || event.target.closest('.sheet-inner');
    if (isControl) return;
    quoteExpanded = !quoteExpanded;
    applyQuoteLayout();
  });

  const container = timerEl.parentNode;
  container.insertBefore(quotePanel, timerEl.nextSibling);

  document.addEventListener('click', onOutsideQuoteClick, true);
}

function onOutsideQuoteClick(event){
  if (!quotePanel || !quoteExpanded) return;
  const insidePanel = event.target.closest('#pausedQuote');
  const isControl = event.target.closest('.controls') || event.target.closest('.sheet-inner');
  if (!insidePanel && !isControl){
    quoteExpanded = false;
    applyQuoteLayout();
  }
}

function removeQuotePanel(){
  document.removeEventListener('click', onOutsideQuoteClick, true);
  if (quoteTimer){
    clearInterval(quoteTimer);
    quoteTimer = null;
  }
  if (quotePanel){
    quotePanel.remove();
    quotePanel = null;
  }
  quoteTextEl = null;
  quoteExpanded = false;
  if (timerEl){
    timerEl.classList.remove('is-hidden');
  }
  if (clockShell){
    clockShell.classList.remove('quotes-visible');
  }
}

function nextQuote(){
  if (!BREAK_QUOTES.length) return;
  const quote = BREAK_QUOTES[quoteIdx % BREAK_QUOTES.length];
  quoteIdx++;
  if (quoteTextEl){
    quoteTextEl.textContent = quote;
  }
}

function applyQuoteLayout(){
  if (!quotePanel) return;
  quotePanel.classList.toggle('expanded', quoteExpanded);
}

function showQuotesDuringPause(){
  if (!quotesEnabled) return;
  ensureQuotePanel();
  nextQuote();
  applyQuoteLayout();
  if (!quoteTimer){
    quoteTimer = setInterval(() => {
      if (paused) nextQuote();
    }, 180000); // 3 min
  }
}

/* === Break scheduling === */
function scheduleBreaks(){
  const now = Date.now();
  nextMicroAt = cfg.microEveryMin ? now + cfg.microEveryMin * 60 * 1000 : null;
  nextStandAt = cfg.standEveryMin ? now + cfg.standEveryMin * 60 * 1000 : null;
}

/* === Sound / Alerts === */
function initAlerts(){
  if (!window.LockedInAlerts) return;
  try{
    LockedInAlerts.loadSettings();
    if (sessionStorage.getItem('lockedin.sound.expect') === 'true'){
      LockedInAlerts.init();
    }
    LockedInAlerts.registerControls({
      pauseTimer: () => pauseSession(),
      resumeTimer: () => resumeSession(),
      startBreak: (type) => beginGuidedBreak(type),
      endSession: () => {}
    });
    syncSoundPill();
  }catch(_){}
}

function ensureAudioReady(){
  if (!window.LockedInAlerts) return;
  try{
    // Don't show nudge in Focus Mode
    if (isFocusModeActive()) return;

    // Only show once ever
    const dismissed = localStorage.getItem('lockedin.sound.nudge.dismissed') === 'true';
    if (dismissed) return;

    const ctx = LockedInAlerts.ctx;
    const needsTap = !ctx || (ctx && ctx.state !== 'running');
    const existing = document.getElementById('soundNudge');
    if (!needsTap){
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    const n = document.createElement('div');
    n.id = 'soundNudge';
    n.style.cssText = `
      position: fixed; left: 50%; transform: translateX(-50%);
      bottom: 18px; z-index: 1600;
      background: rgba(18,22,40,.92);
      color: #fff; border: 1px solid rgba(255,255,255,.18);
      border-radius: 14px; padding: 12px 16px; font: 600 14px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 18px 48px rgba(0,0,0,.45);
    `;
    n.textContent = 'Tap anywhere to enable sound alerts';
    document.body.appendChild(n);

    const unlock = () => {
      try{ LockedInAlerts.init(); }catch(_){}
      const ok = LockedInAlerts.ctx && LockedInAlerts.ctx.state === 'running';
      if (ok && n.parentNode){
        n.parentNode.removeChild(n);
        localStorage.setItem('lockedin.sound.nudge.dismissed', 'true');
      }
      window.removeEventListener('click', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
      syncSoundPill();
    };
    window.addEventListener('click', unlock, true);
    window.addEventListener('touchstart', unlock, true);
  }catch(_){}
}

function syncSoundPill(){
  if (!toggleSound || !window.LockedInAlerts) return;
  const enabled = localStorage.getItem('lockedin.sound.enabled') !== 'false';
  toggleSound.textContent = `Sound: ${enabled ? 'On' : 'Off'}`;
}
if (toggleSound){
  toggleSound.addEventListener('click', (event) => {
    event.preventDefault();
    if (!window.LockedInAlerts) return;
    const enabled = localStorage.getItem('lockedin.sound.enabled') !== 'false';
    localStorage.setItem('lockedin.sound.enabled', String(!enabled));
    LockedInAlerts.setEnabled(!enabled);
    syncSoundPill();
  });
}

/* === Break triggers === */
function maybeTriggerBreak(now){
  if (paused) return;

  if (nextMicroAt && now >= nextMicroAt && phase === 'focus'){
    if (window.LockedInAlerts){
      LockedInAlerts.trigger('headrest');
    }else{
      pauseSession();
      beginGuidedBreak('headrest');
    }
    nextMicroAt += cfg.microEveryMin * 60 * 1000;
    return;
  }

  if (nextStandAt && now >= nextStandAt && phase === 'focus'){
    if (window.LockedInAlerts){
      LockedInAlerts.trigger('stand');
    }else{
      pauseSession();
      beginGuidedBreak('stand');
    }
    nextStandAt += cfg.standEveryMin * 60 * 1000;
  }
}

function beginGuidedBreak(type){
  setLockState('paused');
  showMinimal(false);

  if (paused){
    if (quotesEnabled){
      showQuotesDuringPause();
    }else if (timerEl){
      timerEl.classList.add('timer-paused');
    }
  }

  if (type === 'headrest'){
    phase = 'micro';
  }else if (type === 'stand'){
    phase = 'stand';
  }else if (type === 'break'){
    phase = 'micro';
  }
  updateUI();
}

/* === Session completion === */
function showCompletionPrompt(){
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:1700;
    display:flex; align-items:center; justify-content:center;
    background:rgba(8,10,20,.72); backdrop-filter:blur(12px);
  `;
  const card = document.createElement('div');
  card.style.cssText = `
    width: min(520px, 92vw);
    border-radius: 24px;
    padding: 24px;
    background: rgba(18,22,40,.94);
    color: #f5f6ff;
    border: 1px solid rgba(255,255,255,.12);
    box-shadow: 0 28px 90px rgba(0,0,0,.55);
    font: 600 16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  `;
  const h = document.createElement('h2');
  h.textContent = 'Great job — session complete!';
  h.style.cssText = 'margin:0 0 8px 0; font-weight:800;';
  const p = document.createElement('p');
  p.textContent = 'You stayed LockedIn. Keep the momentum going.';
  p.style.cssText = 'margin:0 0 20px 0; color:#a6acce;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:12px; flex-wrap:wrap;';

  const setupBtn = document.createElement('button');
  setupBtn.textContent = '✅ Back to Setup';
  setupBtn.className = 'btn';
  setupBtn.addEventListener('click', () => {
    overlay.remove();
    window.location.href = 'setup.html';
  });

  const historyBtn = document.createElement('button');
  historyBtn.textContent = '📜 View History';
  historyBtn.className = 'btn btn-ghost';
  historyBtn.addEventListener('click', () => {
    overlay.remove();
    window.location.href = 'history.html';
  });

  row.appendChild(setupBtn);
  row.appendChild(historyBtn);
  card.appendChild(h);
  card.appendChild(p);
  card.appendChild(row);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => setupBtn.focus(), 0);
}

function endAndNavigate(url, outcomeLabel){
  const elapsed = Math.round(((durationMs || 0) - (Math.max(0, endAt - Date.now()) || 0)) / 60000);
  addHistory({
    date: new Date().toISOString(),
    minutes: elapsed,
    outcome: outcomeLabel || 'Ended via PIN',
    label: phaseName(),
    description: cfg.description || ''
  });
  clearInterval(timerId);
  timerId = null;
  unhookUnload();
  disableWakeLock();
  removeQuotePanel();
  if (timerEl) timerEl.classList.remove('timer-paused');
  showMinimal(false);
  sheet.setAttribute('aria-hidden', 'true');
  window.location.href = url;
}

/* === Tick === */
function tick(){
  const now = Date.now();
  remainingMs = Math.max(0, (endAt ?? now) - now);
  maybeTriggerBreak(now);
  updateUI();

  if (remainingMs <= 0 && !timeupHandled){
    timeupHandled = true;
    clearInterval(timerId);
    timerId = null;
    showMinimal(false);
    sheet.setAttribute('aria-hidden', 'true');
    unhookUnload();
    disableWakeLock();
    setLockState('paused');
    removeQuotePanel();
    if (timerEl) timerEl.classList.remove('timer-paused');

    const mins = Math.round((durationMs || 0) / 60000) || 0;
    addHistory({
      date: new Date().toISOString(),
      minutes: mins,
      outcome: 'Completed',
      label: 'Focus',
      description: cfg.description || ''
    });

    if (window.LockedInAlerts){
      try{ LockedInAlerts.play('timeup'); }catch(_){}
    }
    showCompletionPrompt();
  }
}

/* === Session control === */
function startSession(){
  remainingMs = durationMs;
  endAt = Date.now() + remainingMs;
  paused = false;
  phase = 'focus';
  sessionConfigured = true;
  scheduleBreaks();
  enableWakeLock();
  hookUnload();
  setLockState('intro');
  setTimeout(() => setLockState('run'), 900);

  clearInterval(timerId);
  timerId = setInterval(tick, 200);
  updateUI();
  enterFocusMode();

  initAlerts();
  ensureAudioReady();
}
function pauseSession(){
  if (paused) return;
  paused = true;
  clearInterval(timerId);
  timerId = null;
  remainingMs = Math.max(0, endAt - Date.now());
  setLockState('paused');
  showMinimal(false);
  if (quotesEnabled){
    showQuotesDuringPause();
  }else if (timerEl){
    timerEl.classList.add('timer-paused');
    if (clockShell){
      clockShell.classList.remove('quotes-visible');
    }
  }
  updateUI();
}
function resumeSession(){
  if (!sessionConfigured){
    alert('Start a valid session from setup first.');
    return;
  }
  if (!paused) return;
  paused = false;
  phase = 'focus';
  endAt = Date.now() + remainingMs;
  setLockState('run');
  removeQuotePanel();
  if (timerEl) timerEl.classList.remove('timer-paused');
  showMinimal(false);
  clearInterval(timerId);
  timerId = setInterval(tick, 200);
  updateUI();
}
function resetSession(){
  clearInterval(timerId);
  timerId = null;
  paused = true;
  endAt = null;
  remainingMs = 0;
  sessionConfigured = false;
  phase = 'focus';
  setLockState('paused');
  removeQuotePanel();
  if (timerEl) timerEl.classList.remove('timer-paused');
  showMinimal(false);
  sheet.setAttribute('aria-hidden', 'true');
  unhookUnload();
  disableWakeLock();
  window.location.href = 'setup.html';
}

/* === PIN sheet / emergency === */
function setEmergencyLinks(){
  emergencyLinks.innerHTML = '';
  (cfg.emergency || []).filter(phoneOk).forEach(num => {
    const link = document.createElement('a');
    link.href = `tel:${num.replace(/\s+/g, '')}`;
    link.textContent = '🚨 Emergency Call';
    emergencyLinks.appendChild(link);
  });
  if (!emergencyLinks.children.length){
    const fallback = document.createElement('a');
    fallback.href = 'tel:911';
    fallback.textContent = '🚨 Emergency Call (911)';
    emergencyLinks.appendChild(fallback);
  }
}

/* NEW: emergency overlay without PIN */
function showEmergencyOverlay(){
  if (!cfg) return;

  // remove any existing emergency overlay
  const existing = document.getElementById('emergencyOverlay');
  if (existing && existing.parentNode){
    existing.parentNode.removeChild(existing);
  }

  const overlay = document.createElement('div');
  overlay.id = 'emergencyOverlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 1800;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(8,10,20,0.78);
    backdrop-filter: blur(14px);
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: min(420px, 92vw);
    border-radius: 22px;
    padding: 20px 22px;
    background: rgba(18,22,40,0.96);
    color: #f9f9ff;
    border: 1px solid rgba(248,113,113,0.4);
    box-shadow: 0 26px 80px rgba(0,0,0,0.6);
    font: 600 15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  `;

  const title = document.createElement('h2');
  title.textContent = 'Emergency contacts';
  title.style.cssText = 'margin:0 0 6px 0; font-size:1.1rem;';

  const subtitle = document.createElement('p');
  subtitle.textContent = 'Tap a number to call.';
  subtitle.style.cssText = 'margin:0 0 14px 0; color:#fecaca; font-size:0.9rem;';

  const list = document.createElement('div');
  list.style.cssText = 'display:flex; flex-direction:column; gap:10px; margin-bottom:16px;';

  const nums = (cfg.emergency || []).filter(phoneOk);
  nums.forEach(num => {
    const a = document.createElement('a');
    a.href = `tel:${num.replace(/\s+/g, '')}`;
    a.style.cssText = `
      display:flex;
      align-items:center;
      gap:8px;
      padding:10px 12px;
      border-radius: 14px;
      border: 1px solid rgba(248,113,113,0.4);
      background: rgba(127,29,29,0.4);
      color: #fee2e2;
      text-decoration: none;
      font-size: 0.95rem;
    `;
    const icon = document.createElement('span');
    icon.textContent = '🚨';
    const label = document.createElement('span');
    label.textContent = num;
    a.appendChild(icon);
    a.appendChild(label);
    list.appendChild(a);
  });

  if (!list.children.length){
    const fallback = document.createElement('a');
    fallback.href = 'tel:911';
    fallback.textContent = '🚨 Emergency Call (911)';
    fallback.style.cssText = `
      display:flex;
      align-items:center;
      gap:8px;
      padding:10px 12px;
      border-radius: 14px;
      border: 1px solid rgba(248,113,113,0.4);
      background: rgba(127,29,29,0.4);
      color: #fee2e2;
      text-decoration: none;
      font-size: 0.95rem;
    `;
    list.appendChild(fallback);
  }

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex; justify-content:flex-end;';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.className = 'btn btn-ghost';
  closeBtn.style.cssText = 'font-size:0.9rem; padding-inline:14px;';
  closeBtn.addEventListener('click', () => {
    overlay.remove();
  });

  footer.appendChild(closeBtn);

  card.appendChild(title);
  card.appendChild(subtitle);
  card.appendChild(list);
  card.appendChild(footer);
  overlay.appendChild(card);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay){
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
}

function openSheet(action){
  pendingAction = action || null;
  setEmergencyLinks();
  sheet.setAttribute('aria-hidden', 'true'); // reset
  // small reflow to ensure animation
  // eslint-disable-next-line no-unused-expressions
  sheet.offsetHeight;
  sheet.setAttribute('aria-hidden', 'false');
  pinInput.value = '';
  pinInput.focus();
}
function closeSheet(){
  sheet.setAttribute('aria-hidden', 'true');
  pendingAction = null;
}

/* === Button wiring === */
pauseResumeBtn.addEventListener('click', () => {
  if (!sessionConfigured){
    alert('Start a valid session from setup first.');
    return;
  }
  if (paused){
    resumeSession();
  }else{
    openSheet('pause');
  }
});
endEarlyBtn.addEventListener('click', () => {
  if (!sessionConfigured){
    alert('No active session to end.');
    return;
  }
  openSheet('end');
});
resetBtn.addEventListener('click', () => openSheet('reset'));

// EMERGENCY: show contacts overlay (no PIN)
emergencyBtn.addEventListener('click', () => {
  showEmergencyOverlay();
});

focusModeBtn.addEventListener('click', () => {
  if (!sessionConfigured || paused) return;
  enterFocusMode();
});
if (timerEl){
  timerEl.addEventListener('click', () => {
    if (!sessionConfigured || paused) return;
    enterFocusMode();
  });
  timerEl.addEventListener('keydown', (event) => {
    if (!sessionConfigured || paused) return;
    if (event.key === 'Enter' || event.key === ' '){
      event.preventDefault();
      enterFocusMode();
    }
  });
}

if (minimal){
  minimal.addEventListener('click', () => {
    if (paused) return;
    exitFocusMode();
  });
}

historyLink.addEventListener('click', (event) => {
  event.preventDefault();
  if (!sessionConfigured){
    window.location.href = 'history.html';
    return;
  }
  openSheet('nav_history');
});
backToSetup.addEventListener('click', (event) => {
  event.preventDefault();
  if (!sessionConfigured){
    window.location.href = 'setup.html';
    return;
  }
  openSheet('nav_setup');
});

submitPin.addEventListener('click', () => {
  if ((pinInput.value || '') === (cfg.pin || '')){
    switch (pendingAction){
      case 'end':
        endAndNavigate('setup.html', 'Ended via PIN');
        break;
      case 'pause':
        pauseSession();
        closeSheet();
        break;
      case 'reset':
        resetSession();
        break;
      case 'nav_history':
        endAndNavigate('history.html', 'Ended to view history');
        break;
      case 'nav_setup':
        endAndNavigate('setup.html', 'Ended to go to setup');
        break;
      default:
        closeSheet();
    }
  }else{
    alert('Incorrect PIN.');
  }
});
cancelSheet.addEventListener('click', closeSheet);

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement){
    showMinimal(false);
  }
});

/* === Boot === */
(function boot(){
  try{
    cfg = JSON.parse(sessionStorage.getItem('lockedInConfig') || 'null');
  }catch(_){
    cfg = null;
  }
  if (!cfg){
    window.location.href = 'setup.html';
    return;
  }

  durationMs = cfg.durationMs || 0;
  if (!durationMs || !cfg.pin || !(cfg.emergency || []).length){
    window.location.href = 'setup.html';
    return;
  }

  // IMPORTANT: match what setup.js stores: enableQuotes
  quotesEnabled = cfg.enableQuotes !== false;

  renderSessionInfo();
  startSession();
  pauseResumeBtn.disabled = false;
  endEarlyBtn.disabled = false;
  renderHistory();
})();

function renderSessionInfo(){
  if (!sessionInfoDiv) return;
  const lines = [];

  if (cfg.description){
    lines.push(`
      <div class="info-line info-line--stacked">
        <span class="info-label">Description</span>
        <p class="info-value">${escapeHtml(cfg.description)}</p>
      </div>
    `);
  }

  lines.push(`
    <div class="info-line">
      <span class="info-label">Duration</span>
      <span class="info-value">${Math.round((cfg.durationMs || 0) / 60000)} min</span>
    </div>
  `);

  const breakBits = [];
  if (cfg.microEveryMin) breakBits.push(`Head/eye rest every ${cfg.microEveryMin}m`);
  if (cfg.standEveryMin) breakBits.push(`Stand every ${cfg.standEveryMin}m • ${cfg.standLenMin}m`);
  if (breakBits.length){
    lines.push(`
      <div class="info-line info-line--stacked">
        <span class="info-label">Break plan</span>
        <p class="info-value">${breakBits.join('<br>')}</p>
      </div>
    `);
  }

  lines.push(`
    <div class="info-line">
      <span class="info-label">Quotes</span>
      <span class="info-value">${quotesEnabled ? 'On during breaks' : 'Off'}</span>
    </div>
  `);

  sessionInfoDiv.innerHTML = lines.join('');
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&lt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
