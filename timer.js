/* === timer.js (time-up prompt + no early navigation + full sound) === */

let cfg = null;

// State
let remainingMs = 0, durationMs = 0;
let endAt = null, timerId = null, paused = true;
let phase = 'focus';
let nextMicroAt = null, nextStandAt = null, nextQuoteAt = null;
let sessionConfigured = false;
let wakeLock = null;
let pendingAction = null;
let timeupHandled = false;

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

// ===== Utilities
function fmt(ms){ const s=Math.max(0,Math.floor(ms/1000)); const h=String(Math.floor(s/3600)).padStart(2,'0'); const m=String(Math.floor((s%3600)/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); return `${h}:${m}:${ss}`;}
function phoneOk(v){ return (v||'').replace(/\s+/g,'').length>=3; }
async function enableWakeLock(){ try{ if('wakeLock' in navigator){ wakeLock = await navigator.wakeLock.request('screen'); wakelockStatus.textContent='Screen lock: on'; wakeLock.addEventListener('release',()=> wakelockStatus.textContent='Screen lock: off'); document.addEventListener('visibilitychange', async ()=>{ if(document.visibilityState==='visible' && !wakeLock){ try{ wakeLock = await navigator.wakeLock.request('screen'); wakelockStatus.textContent='Screen lock: on'; }catch(_){} } }); } else wakelockStatus.textContent='Screen lock: unavailable'; }catch(_){ wakelockStatus.textContent='Screen lock: off'; } }
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

// ===== Quotes
const QUOTES = [
  "Action cures fear. — David J. Schwartz",
  "You don’t need more time, you need more focus.",
  "The secret to getting ahead is getting started. — Twain",
  "Small steps daily beat bursts of effort.",
  "Discipline is remembering what you want.",
  "Done is better than perfect.",
  "You’re one focused session away from momentum."
];
function pushToast(text, sub=""){
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${text}${sub?`<small>${sub}</small>`:''}`;
  toasts.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(6px)'; }, 4200);
  setTimeout(()=> el.remove(), 4800);
}
function maybeQuote(now){
  if(!cfg.enableQuotes) return;
  if(nextQuoteAt && now >= nextQuoteAt){
    const q = QUOTES[Math.floor(Math.random()*QUOTES.length)];
    pushToast(q, "Stay off the phone. Back to work.");
    nextQuoteAt += 30*60*1000;
  }
}

// ===== Break scheduling
function scheduleBreaks(){
  const now = Date.now();
  nextQuoteAt = cfg.enableQuotes ? now + 30*60*1000 : null;
  nextMicroAt = cfg.microEveryMin ? now + cfg.microEveryMin*60*1000 : null;
  nextStandAt = cfg.standEveryMin ? now + cfg.standEveryMin*60*1000 : null;
}

/* ===== Alerts integration + robust unlock ===== */

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
      endSession: () => {
        // no-op now; we handle completion prompt ourselves
      }
    });
    syncSoundPill();
  } catch(e) { /* no-op */ }
}

// If audio is still locked on this page, nudge the user once to tap
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
  }catch(_){/*noop*/}
}

// Optional: sound toggle pill in header
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
  if (type === 'headrest') {
    phase = 'micro';
    pushToast("Head/Eye Rest — 20 seconds", "Look ~20ft away. Blink. No phone.");
    showMinimal(false);
    setTimeout(() => {
      phase = 'focus';
      pushToast("Head rest done", "Back to focus.");
      resumeSession();
    }, 20000);
    updateUI();
    return;
  }

  if (type === 'stand') {
    phase = 'stand';
    const ms = (cfg.standLenMin||1) * 60 * 1000;
    pushToast(`Stand & Stretch — ${cfg.standLenMin} min`, "Hydrate. Walk. No scrolling.");
    showMinimal(false);
    setTimeout(() => {
      phase = 'focus';
      pushToast("Stand break done", "Back to focus.");
      resumeSession();
    }, ms);
    updateUI();
    return;
  }

  if (type === 'break') {
    phase = 'micro';
    const ms = 60 * 1000;
    pushToast("Short Break — 1 min", "No phone scrolling.");
    showMinimal(false);
    setTimeout(() => {
      phase = 'focus';
      pushToast("Break done", "Back to focus.");
      resumeSession();
    }, ms);
    updateUI();
  }
}

/* ===== Completion prompt ===== */
function showCompletionPrompt(){
  // Build a simple modal (not the PIN sheet)
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

  // focus first button for keyboard users
  setTimeout(()=> b1.focus(), 0);
}

/* ===== End + navigate helper (for PIN actions) ===== */
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
  showMinimal(false); sheet.setAttribute('aria-hidden','true');
  window.location.href = url;
}

/* ===== Core timer loop ===== */
function tick(){
  const now = Date.now();
  remainingMs = Math.max(0, (endAt??now) - now);
  maybeTriggerBreak(now);
  maybeQuote(now);
  updateUI();

  if(remainingMs <= 0 && !timeupHandled){
    timeupHandled = true;
    clearInterval(timerId); timerId=null;
    showMinimal(false); sheet.setAttribute('aria-hidden','true');
    unhookUnload(); disableWakeLock();

    // Save history immediately
    const mins = Math.round((durationMs||0)/60000)||0;
    addHistory({date:new Date().toISOString(), minutes:mins, outcome:'Completed', label:'Focus', description: cfg.description||''});

    // Play finish sound (no auto nav), then show prompt
    if (window.LockedInAlerts) {
      try { LockedInAlerts.play('timeup'); } catch(_){}
    }
    // Toast + modal prompt
    pushToast("Great job — session complete!","You stayed LockedIn. 🎉");
    showCompletionPrompt();
  }
}

/* ===== Session control ===== */
function startSession(){
  remainingMs = durationMs;
  endAt = Date.now() + remainingMs;
  paused = false; phase='focus'; sessionConfigured = true;
  scheduleBreaks(); enableWakeLock(); hookUnload();
  enterFocusMode();
  clearInterval(timerId); timerId = setInterval(tick, 200);
  updateUI();

  initAlerts();
  ensureAudioReady(); // show banner and unlock if needed
}
function pauseSession(){
  if(paused) return;
  paused = true; clearInterval(timerId); timerId = null;
  remainingMs = Math.max(0, endAt - Date.now());
  showMinimal(false);
  updateUI();
}
function resumeSession(){
  if(!sessionConfigured){ alert('Start a valid session from setup first.'); return; }
  if(!paused) return;
  paused = false; endAt = Date.now() + remainingMs;
  enterFocusMode();
  clearInterval(timerId); timerId = setInterval(tick, 200);
  updateUI();
}
function resetSession(){
  clearInterval(timerId); timerId=null; paused=true; endAt=null; remainingMs=0; sessionConfigured=false; phase='focus';
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
function openSheet(action){ pendingAction=action||null; setEmergencyLinks(); sheet.setAttribute('aria-hidden','true'); sheet.offsetHeight; sheet.setAttribute('aria-hidden','false'); pinInput.value=''; pinInput.focus(); }
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
// Tap big clock to re-enter Focus Mode
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
