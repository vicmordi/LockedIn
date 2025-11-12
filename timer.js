/* === timer.js (paused = quotes replace clock; expand-on-click; 3-min rotation) === */

let cfg = null;

// State
let remainingMs = 0, durationMs = 0;
let endAt = null, timerId = null, paused = true;
let phase = 'focus';
let nextMicroAt = null, nextStandAt = null;
let sessionConfigured = false;
let wakeLock = null;
let pendingAction = null;
let timeupHandled = false;

// Quotes state
let quoteTimer = null;
let quotePanel = null;     // container replacing the clock while paused
let quoteTextEl = null;
let quoteExpanded = false;
let quoteIdx = 0;

// DOM
const timerEl = document.getElementById('timer');
const phaseLabel = document.getElementById('phaseLabel');
const bar = document.getElementById('bar');
const pauseResumeBtn = document.getElementById('pauseResume');
const endEarlyBtn = document.getElementById('endEarly');
const resetBtn = document.getElementById('reset');
const emergencyBtn = document.getElementById('emergencyBtn');
const focusModeBtn = document.getElementById('focusModeBtn');
const historyLink = document.getElementById('historyLink');
const backToSetup = document.getElementById('backToSetup');
const historyDiv = document.getElementById('history');
const sessionInfoDiv = document.getElementById('sessionInfo');
const minimal = document.getElementById('minimal');
const minimalTimer = document.getElementById('minimalTimer');
const sheet = document.getElementById('sheet');
const emergencyLinks = document.getElementById('emergencyLinks');
const pinInput = document.getElementById('pinInput');
const submitPin = document.getElementById('submitPin');
const cancelSheet = document.getElementById('cancelSheet');
const wakelockStatus = document.getElementById('wakelockStatus');
const toasts = document.getElementById('toasts');
const toggleSound = document.getElementById('toggleSound'); // optional

// Optional lock animation in header
const headerLock = document.getElementById('headerLock');
function setLockState(state){ if(!headerLock) return; headerLock.className = `lock-anim ${state}`; }

// ===== Utilities
function fmt(ms){
  const s=Math.max(0,Math.floor(ms/1000));
  const h=String(Math.floor(s/3600)).padStart(2,'0');
  const m=String(Math.floor((s%3600)/60)).padStart(2,'0');
  const ss=String(s%60).padStart(2,'0');
  return `${h}:${m}:${ss}`;
}
function phoneOk(v){ return (v||'').replace(/\s+/g,'').length>=3; }
async function enableWakeLock(){
  try{
    if('wakeLock' in navigator){
      wakeLock = await navigator.wakeLock.request('screen');
      wakelockStatus.textContent='Screen lock: on';
      wakeLock.addEventListener('release',()=> wakelockStatus.textContent='Screen lock: off');
      document.addEventListener('visibilitychange', async ()=>{
        if(document.visibilityState==='visible' && !wakeLock){
          try{ wakeLock = await navigator.wakeLock.request('screen'); wakelockStatus.textContent='Screen lock: on'; }catch(_){}
        }
      });
    } else wakelockStatus.textContent='Screen lock: unavailable';
  }catch(_){ wakelockStatus.textContent='Screen lock: off'; }
}
function disableWakeLock(){ if(wakeLock){ wakeLock.release().catch(()=>{}); wakeLock=null; wakelockStatus.textContent='Screen lock: off'; } }
function hookUnload(){ window.onbeforeunload=()=> 'Focus session in progress.'; }
function unhookUnload(){ window.onbeforeunload=null; }
function showMinimal(on){ minimal.setAttribute('aria-hidden', on?'false':'true'); }
async function enterFullscreen(){ try{ if(!document.fullscreenElement){ await document.documentElement.requestFullscreen({navigationUI:'hide'}); } }catch{} }
async function exitFullscreen(){ try{ if(document.fullscreenElement){ await document.exitFullscreen(); } }catch{} }
async function enterFocusMode(){ showMinimal(true); await enterFullscreen(); }
async function exitFocusMode(){ showMinimal(false); await exitFullscreen(); }
function updateUI(){
  timerEl.textContent = fmt(remainingMs);
  minimalTimer.textContent = fmt(remainingMs);
  const p = (durationMs>0) ? 100 - Math.round((remainingMs/durationMs)*100) : 0;
  bar.style.width = `${Math.min(100,Math.max(0,p))}%`;
  pauseResumeBtn.textContent = paused ? 'Resume' : 'Pause';
  phaseLabel.textContent = `Phase: ${phase==='focus'?'Focus':(phase==='micro'?'Micro break':'Stand/stretch')}`;
}

// ===== History
function loadHistory(){ try{return JSON.parse(localStorage.getItem('li_history')||'[]');}catch(_){return [];} }
function saveHistory(list){ localStorage.setItem('li_history', JSON.stringify(list.slice(-200))); }
function addHistory(item){ const list=loadHistory(); list.push(item); saveHistory(list); renderHistory(); }
function renderHistory(){
  const list=loadHistory().slice().reverse();
  historyDiv.innerHTML = list.map(i=>{
    const desc = i.description ? `<div class="muted" style="margin-top:4px">${i.description}</div>` : '';
    return `<div class="hrow" style="flex-direction:column; align-items:flex-start">
      <span>${new Date(i.date).toLocaleString()} — ${i.minutes}m — ${i.label||'Focus'} <span class="${i.outcome==='Completed'?'ok':'bad'}" style="margin-left:6px">${i.outcome}</span></span>
      ${desc}
    </div>`;
  }).join('') || `<div class="note">No sessions yet.</div>`;
}

// ===== Break-only quotes =====
const BREAK_QUOTES = [
  "Lock in now, cash out later.",
  "Discipline today is freedom tomorrow.",
  "Tiny wins compound. Stay with it.",
  "You’re building a future no one can take.",
  "Focus is a superpower—use it.",
  "This chapter becomes your testimony.",
  "Dreams don’t work unless you do."
];

// Build once, placed exactly where the clock sits
function ensureQuotePanel(){
  if (quotePanel) return;

  // Hide the big clock and insert quote panel right after it
  timerEl.style.display = 'none';

  quotePanel = document.createElement('div');
  quotePanel.id = 'pausedQuote';
  quotePanel.style.cssText = `
    margin: 0 auto 8px;
    max-width: 820px;
    width: 100%;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,.10);
    background: rgba(32,36,52,.92);
    color: #E6E6EA;
    box-shadow: 0 18px 48px rgba(0,0,0,.35);
    padding: 14px 16px;
    cursor: pointer;
    user-select: none;
    transition: padding .18s ease, background .18s ease, box-shadow .18s ease, transform .18s ease;
  `;

  // “PAUSED — tap to expand” header
  const cap = document.createElement('div');
  cap.style.cssText = `
    display:flex; align-items:center; gap:8px; 
    font: 700 12px/1 system-ui,-apple-system,Segoe UI,Roboto,Inter,sans-serif;
    color:#AEB2C4; letter-spacing:.3px; text-transform:uppercase;
    margin-bottom:8px;
  `;
  cap.innerHTML = `<span class="pill" style="border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); padding:4px 8px; border-radius:999px">Paused</span><span>Tap to expand</span>`;
  quotePanel.appendChild(cap);

  // The quote text (collapsible)
  quoteTextEl = document.createElement('div');
  quoteTextEl.id = 'pausedQuoteText';
  quoteTextEl.style.cssText = `
    font: 800 18px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Inter,sans-serif;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    overflow: hidden;
  `;
  quotePanel.appendChild(quoteTextEl);

  // Footer hint
  const hint = document.createElement('div');
  hint.style.cssText = `
    margin-top:10px; color:#9BA3B5; 
    font: 600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Inter,sans-serif;
  `;
  hint.textContent = 'Tap anywhere to toggle size. Use Resume to continue.';
  quotePanel.appendChild(hint);

  // Toggle expand/collapse on click
  quotePanel.addEventListener('click', (e)=>{
    // If user actually pressed a control button, ignore toggle
    const isControl = e.target.closest('.controls') || e.target.closest('.sheet-inner');
    if (isControl) return;
    quoteExpanded = !quoteExpanded;
    applyQuoteLayout();
  });

  // Insert right where the clock is (same parent)
  const container = timerEl.parentNode;
  container.insertBefore(quotePanel, timerEl.nextSibling);

  // When expanded, clicking anywhere outside collapses (menus remain visible)
  document.addEventListener('click', onOutsideClick, true);
}

function onOutsideClick(e){
  if (!quotePanel || !quoteExpanded) return;
  const insidePanel = e.target.closest('#pausedQuote');
  const isControl = e.target.closest('.controls') || e.target.closest('.sheet-inner');
  if (!insidePanel && !isControl) {
    quoteExpanded = false;
    applyQuoteLayout();
  }
}

function removeQuotePanel(){
  document.removeEventListener('click', onOutsideClick, true);
  if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; }
  if (quotePanel && quotePanel.parentNode) quotePanel.parentNode.removeChild(quotePanel);
  quotePanel = null;
  quoteTextEl = null;
  quoteExpanded = false;
  // Show clock again
  timerEl.style.display = '';
}

function setQuote(text){ if (quoteTextEl) quoteTextEl.textContent = text; }
function nextQuote(){
  const q = BREAK_QUOTES[quoteIdx % BREAK_QUOTES.length];
  quoteIdx++;
  setQuote(q);
}
function applyQuoteLayout(){
  if (!quotePanel || !quoteTextEl) return;
  if (quoteExpanded) {
    quotePanel.style.padding = '20px 22px';
    quotePanel.style.background = 'rgba(40,44,62,.96)';
    quotePanel.style.boxShadow = '0 22px 64px rgba(0,0,0,.45)';
    quoteTextEl.style.webkitLineClamp = '10';
    quoteTextEl.style.fontSize = 'clamp(18px,3.2vw,28px)';
    quoteTextEl.style.lineHeight = '1.28';
    quotePanel.style.transform = 'translateY(-2px)';
  } else {
    quotePanel.style.padding = '14px 16px';
    quotePanel.style.background = 'rgba(32,36,52,.92)';
    quotePanel.style.boxShadow = '0 18px 48px rgba(0,0,0,.35)';
    quoteTextEl.style.webkitLineClamp = '3';
    quoteTextEl.style.fontSize = '18px';
    quoteTextEl.style.lineHeight = '1.35';
    quotePanel.style.transform = 'translateY(0)';
  }
}
function showQuotesDuringPause(){
  ensureQuotePanel();
  nextQuote();
  applyQuoteLayout();
  if (!quoteTimer) {
    quoteTimer = setInterval(()=>{ if (paused) { nextQuote(); applyQuoteLayout(); } }, 180000); // 3 min
  }
}

// ===== Break scheduling
function scheduleBreaks(){
  const now = Date.now();
  nextMicroAt = cfg.microEveryMin ? now + cfg.microEveryMin*60*1000 : null;
  nextStandAt = cfg.standEveryMin ? now + cfg.standEveryMin*60*1000 : null;
}

/* ===== Alerts integration ===== */
function initAlerts(){
  if (!window.LockedInAlerts) return;
  try {
    LockedInAlerts.loadSettings();
    if (sessionStorage.getItem('lockedin.sound.expect') === 'true') {
      LockedInAlerts.init();
    }
    LockedInAlerts.registerControls({
      pauseTimer: () => pauseSession(),
      resumeTimer: () => resumeSession(),
      startBreak: (type) => beginGuidedBreak(type),
      endSession: () => {}
    });
    syncSoundPill();
  } catch(e) {}
}

// If audio is still locked on this page, nudge once to tap
function ensureAudioReady(){
  if (!window.LockedInAlerts) return;
  try{
    const ctx = LockedInAlerts.ctx;
    const needsTap = !ctx || (ctx && ctx.state !== 'running');
    const existing = document.getElementById('soundNudge');
    if (!needsTap) { if (existing) existing.remove(); return; }
    if (existing) return;

    const n = document.createElement('div');
    n.id = 'soundNudge';
    n.style.cssText = `
      position: fixed; left:50%; transform:translateX(-50%);
      bottom: 16px; z-index: 9999; background: rgba(34,34,42,.92);
      color:#fff; border:1px solid rgba(255,255,255,.15);
      border-radius: 12px; padding: 10px 14px; font: 600 14px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      box-shadow: 0 12px 24px rgba(0,0,0,.35);
    `;
    n.textContent = 'Tap anywhere to enable sound alerts';
    document.body.appendChild(n);

    const unlock = () => {
      try { LockedInAlerts.init(); } catch(_){}
      const ok = LockedInAlerts.ctx && LockedInAlerts.ctx.state === 'running';
      if (ok && n.parentNode) n.parentNode.removeChild(n);
      window.removeEventListener('click', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
      syncSoundPill();
    };
    window.addEventListener('click', unlock, true);
    window.addEventListener('touchstart', unlock, true);
  }catch(_){}
}

// Optional: sound toggle pill
function syncSoundPill(){
  if (!toggleSound || !window.LockedInAlerts) return;
  const enabled = localStorage.getItem('lockedin.sound.enabled') !== 'false';
  toggleSound.textContent = `Sound: ${enabled ? 'On' : 'Off'}`;
}
if (toggleSound) {
  toggleSound.addEventListener('click', (e)=>{
    e.preventDefault();
    if (!window.LockedInAlerts) return;
    const enabled = localStorage.getItem('lockedin.sound.enabled') !== 'false';
    localStorage.setItem('lockedin.sound.enabled', String(!enabled));
    LockedInAlerts.setEnabled(!enabled);
    syncSoundPill();
  });
}

/* ===== Trigger break prompts when due ===== */
function maybeTriggerBreak(now){
  if(paused) return;

  if(nextMicroAt && now>=nextMicroAt && phase==='focus'){
    if (window.LockedInAlerts) { LockedInAlerts.trigger('headrest'); }
    else { pauseSession(); beginGuidedBreak('headrest'); }
    nextMicroAt += cfg.microEveryMin * 60 * 1000;
    return;
  }

  if(nextStandAt && now>=nextStandAt && phase==='focus'){
    if (window.LockedInAlerts) { LockedInAlerts.trigger('stand'); }
    else { pauseSession(); beginGuidedBreak('stand'); }
    nextStandAt += cfg.standEveryMin * 60 * 1000;
    return;
  }
}

/* ===== Guided break flows ===== */
function beginGuidedBreak(type){
  setLockState('paused');
  // Replace clock with quotes
  showQuotesDuringPause();

  if (type === 'headrest') { phase = 'micro'; updateUI(); return; }
  if (type === 'stand')   { phase = 'stand'; updateUI(); return; }
  if (type === 'break')   { phase = 'micro'; updateUI(); }
}

/* ===== Completion prompt ===== */
function showCompletionPrompt(){
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center;
    background:rgba(18,18,22,.55); backdrop-filter:blur(6px);
  `;
  const card = document.createElement('div');
  card.style.cssText = `
    width:min(520px,92vw); border-radius:16px; padding:18px;
    background:rgba(40,40,46,.94); color:#E6E6EA; border:1px solid rgba(255,255,255,.08);
    box-shadow:0 20px 60px rgba(0,0,0,.4); font: 600 15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  `;
  const h = document.createElement('h2');
  h.textContent = 'Great job — session complete!';
  h.style.cssText = 'margin:0 0 6px 0; font-weight:800; letter-spacing:.2px;';
  const p = document.createElement('p');
  p.textContent = 'You did well staying LockedIn. Ready for the next one?';
  p.style.cssText = 'margin:0 0 14px 0; color:#9A9AA5; font-weight:500;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:10px; flex-wrap:wrap;';
  const b1 = document.createElement('button');
  b1.textContent = '✅ Back to Setup';
  b1.style.cssText = btnCss();
  const b2 = document.createElement('button');
  b2.textContent = '📜 View History';
  b2.style.cssText = btnCss(true);

  function btnCss(ghost=false){
    return `
      flex:1; display:inline-flex; justify-content:center; align-items:center; gap:8px;
      padding:12px 14px; border-radius:14px;
      border:1px solid ${ghost?'rgba(255,255,255,.10)':'rgba(179,136,255,.18)'};
      background:${ghost?'#2C2C32':'linear-gradient(180deg,#B388FF,#7E57C2)'}; 
      color:#fff; font-weight:800; cursor:pointer;
    `;
  }

  b1.addEventListener('click', ()=> { try{ overlay.remove(); }catch{} window.location.href='setup.html'; });
  b2.addEventListener('click', ()=> { try{ overlay.remove(); }catch{} window.location.href='history.html'; });

  row.appendChild(b1); row.appendChild(b2);
  card.appendChild(h); card.appendChild(p); card.appendChild(row);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  setTimeout(()=> b1.focus(), 0);
}

/* ===== End + navigate helper ===== */
function endAndNavigate(url, outcomeLabel){
  const elapsed = Math.round(((durationMs||0)-(Math.max(0, endAt - Date.now())||0))/60000);
  addHistory({
    date:new Date().toISOString(),
    minutes: elapsed,
    outcome: outcomeLabel || 'Ended via PIN',
    label: phase==='focus'?'Focus':'Break',
    description: (cfg.description||'')
  });
  clearInterval(timerId); timerId=null;
  unhookUnload(); disableWakeLock();
  removeQuotePanel();
  showMinimal(false); sheet.setAttribute('aria-hidden','true');
  window.location.href = url;
}

/* ===== Core timer loop ===== */
function tick(){
  const now = Date.now();
  remainingMs = Math.max(0, (endAt??now) - now);
  maybeTriggerBreak(now);
  updateUI();

  if(remainingMs <= 0 && !timeupHandled){
    timeupHandled = true;
    clearInterval(timerId); timerId=null;
    showMinimal(false); sheet.setAttribute('aria-hidden','true');
    unhookUnload(); disableWakeLock();
    setLockState('paused');
    removeQuotePanel();

    const mins = Math.round((durationMs||0)/60000)||0;
    addHistory({date:new Date().toISOString(), minutes:mins, outcome:'Completed', label:'Focus', description: cfg.description||''});

    if (window.LockedInAlerts) { try { LockedInAlerts.play('timeup'); } catch(_){ } }
    showCompletionPrompt();
  }
}

/* ===== Session control ===== */
function startSession(){
  remainingMs = durationMs;
  endAt = Date.now() + remainingMs;
  paused = false; phase='focus'; sessionConfigured = true;
  scheduleBreaks(); enableWakeLock(); hookUnload();
  setLockState('intro'); setTimeout(()=> setLockState('run'), 900);

  enterFocusMode();
  clearInterval(timerId); timerId = setInterval(tick, 200);
  updateUI();

  initAlerts();
  ensureAudioReady();
}
function pauseSession(){
  if(paused) return;
  paused = true; clearInterval(timerId); timerId = null;
  remainingMs = Math.max(0, endAt - Date.now());
  setLockState('paused');
  showMinimal(false);             // show menus
  showQuotesDuringPause();        // replace clock with quotes
  updateUI();
}
function resumeSession(){
  if(!sessionConfigured){ alert('Start a valid session from setup first.'); return; }
  if(!paused) return;
  paused = false; endAt = Date.now() + remainingMs;
  setLockState('run');
  removeQuotePanel();             // restore clock
  enterFocusMode();               // re-enter focus overlay if desired
  clearInterval(timerId); timerId = setInterval(tick, 200);
  updateUI();
}
function resetSession(){
  clearInterval(timerId); timerId=null; paused=true; endAt=null; remainingMs=0; sessionConfigured=false; phase='focus';
  setLockState('paused');
  removeQuotePanel();
  showMinimal(false); sheet.setAttribute('aria-hidden','true'); unhookUnload(); disableWakeLock();
  window.location.href = 'setup.html';
}

/* ===== Sheet (PIN + emergency) ===== */
function setEmergencyLinks(){
  emergencyLinks.innerHTML='';
  (cfg.emergency||[]).filter(phoneOk).forEach(t=>{
    const a=document.createElement('a'); a.href=`tel:${t.replace(/\s+/g,'')}`; a.textContent='🚨 Emergency Call'; emergencyLinks.appendChild(a);
  });
  if(!emergencyLinks.children.length){
    const a=document.createElement('a'); a.href='tel:911'; a.textContent='🚨 Emergency Call (911)'; emergencyLinks.appendChild(a);
  }
}
function openSheet(action){
  pendingAction=action||null; setEmergencyLinks();
  sheet.setAttribute('aria-hidden','true'); sheet.offsetHeight; sheet.setAttribute('aria-hidden','false');
  pinInput.value=''; pinInput.focus();
}
function closeSheet(){ sheet.setAttribute('aria-hidden','true'); pendingAction=null; }
['1','2','3','4','5','6','7','8','9','←','0','⟲'].forEach(k=>{
  const b=document.createElement('button'); b.className='kbtn'; b.textContent=k;
  b.addEventListener('click',()=>{ if(k==='←'){ pinInput.value=pinInput.value.slice(0,-1); } else if(k==='⟲'){ pinInput.value=''; } else if(/\d/.test(k)){ pinInput.value+=k; } });
  document.getElementById('keypad').appendChild(b);
});
submitPin.addEventListener('click', ()=>{
  if((pinInput.value||'') === (cfg.pin||'')){
    if(pendingAction==='end'){
      endAndNavigate('setup.html', 'Ended via PIN');
    } else if(pendingAction==='pause'){
      pauseSession(); closeSheet();
    } else if(pendingAction==='reset'){
      resetSession();
    } else if(pendingAction==='nav_history'){
      endAndNavigate('history.html', 'Ended to view history');
    } else if(pendingAction==='nav_setup'){
      endAndNavigate('setup.html', 'Ended to go to setup');
    } else {
      closeSheet();
    }
  } else {
    alert('Incorrect PIN.');
  }
});
cancelSheet.addEventListener('click', closeSheet);

/* ===== Controls ===== */
pauseResumeBtn.addEventListener('click', ()=>{
  if(!sessionConfigured){ alert('Start a valid session from setup first.'); return; }
  if(paused) resumeSession(); else openSheet('pause');
});
endEarlyBtn.addEventListener('click', ()=>{
  if(!sessionConfigured){ alert('No active session to end.'); return; }
  openSheet('end');
});
resetBtn.addEventListener('click', ()=> openSheet('reset'));
emergencyBtn.addEventListener('click', ()=> openSheet(null));

// Tap big clock overlay to exit Focus Mode (show menus)
minimal.addEventListener('click', ()=>{
  if (paused) return;
  exitFocusMode();
});
// Tap big clock text to re-enter Focus Mode (only when running)
timerEl.addEventListener('click', ()=>{
  if (!sessionConfigured || paused) return;
  enterFocusMode();
});
// Manual button to re-enter Focus Mode
focusModeBtn.addEventListener('click', ()=>{
  if (!sessionConfigured || paused) return;
  enterFocusMode();
});

// Header links
historyLink.addEventListener('click', (e)=>{
  e.preventDefault();
  if(!sessionConfigured){
    window.location.href = 'history.html';
    return;
  }
  openSheet('nav_history');
});
backToSetup.addEventListener('click', (e)=>{
  e.preventDefault();
  if(!sessionConfigured){
    window.location.href = 'setup.html';
    return;
  }
  openSheet('nav_setup');
});

// Escape closes overlay
document.addEventListener('fullscreenchange', ()=>{
  if(!document.fullscreenElement){ showMinimal(false); }
});

/* ===== Boot ===== */
(function boot(){
  try{ cfg = JSON.parse(sessionStorage.getItem('lockedInConfig')||'null'); }catch{ cfg=null; }
  if(!cfg){ window.location.href = 'setup.html'; return; }

  durationMs = cfg.durationMs||0;
  if(!durationMs || !cfg.pin || !(cfg.emergency||[]).length){ window.location.href = 'setup.html'; return; }

  renderSessionInfo();
  startSession();
  pauseResumeBtn.disabled = false;
  endEarlyBtn.disabled = false;
  renderHistory();
})();

// Session info
function renderSessionInfo(){
  const lines = [];
  if (cfg.description) lines.push(`<div><strong>Description:</strong> ${escapeHtml(cfg.description)}</div>`);
  lines.push(`<div><strong>Duration:</strong> ${Math.round((cfg.durationMs||0)/60000)} min</div>`);
  const brk = [];
  if (cfg.microEveryMin) brk.push(`Head/eye-rest every ${cfg.microEveryMin}m`);
  if (cfg.standEveryMin) brk.push(`Stand every ${cfg.standEveryMin}m (${cfg.standLenMin}m)`);
  if (brk.length) lines.push(`<div><strong>Breaks:</strong> ${brk.join(' • ')}</div>`);
  sessionInfoDiv.innerHTML = lines.join('') || '<div class="muted">No extra info.</div>';
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
