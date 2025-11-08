let cfg = null;

// State
let remainingMs = 0, durationMs = 0;
let endAt = null, timerId = null, paused = true;
let phase = 'focus';
let nextMicroAt = null, nextStandAt = null, nextQuoteAt = null;
let sessionConfigured = false;
let wakeLock = null;
let pendingAction = null;

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

// Utils
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

// History
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

// Quotes
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

// Breaks
function scheduleBreaks(){
  const now = Date.now();
  nextQuoteAt = cfg.enableQuotes ? now + 30*60*1000 : null;
  nextMicroAt = cfg.microEveryMin ? now + cfg.microEveryMin*60*1000 : null;
  nextStandAt = cfg.standEveryMin ? now + cfg.standEveryMin*60*1000 : null;
}
function maybeTriggerBreak(now){
  if(paused) return;
  if(nextMicroAt && now>=nextMicroAt && phase==='focus'){
    phase='micro';
    pushToast("Eye/Head Rest • 20 seconds", "Look ~20 feet away. No phone.");
    setTimeout(()=>{ phase='focus'; }, 20000);
    nextMicroAt += cfg.microEveryMin * 60 * 1000;
    return;
  }
  if(nextStandAt && now>=nextStandAt && phase==='focus'){
    phase='stand';
    pushToast(`Stand & Stretch • ${cfg.standLenMin} min`, "Hydrate. Walk. No scrolling.");
    setTimeout(()=>{ phase='focus'; }, cfg.standLenMin*60*1000);
    nextStandAt += cfg.standEveryMin * 60 * 1000;
    return;
  }
}

// End + navigate helper
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

// Session control
function tick(){
  const now = Date.now();
  remainingMs = Math.max(0, (endAt??now) - now);
  maybeTriggerBreak(now);
  maybeQuote(now);
  updateUI();
  if(remainingMs <= 0){
    clearInterval(timerId); timerId=null;
    const mins = Math.round((durationMs||0)/60000)||0;
    addHistory({date:new Date().toISOString(), minutes:mins, outcome:'Completed', label:'Focus', description: cfg.description||''});
    showMinimal(false); sheet.setAttribute('aria-hidden','true');
    unhookUnload(); disableWakeLock();
    const ding=document.getElementById('ding'); if(ding&&ding.play){ ding.play().catch(()=>{});}
    alert('Nice work — session complete!');
    window.location.href = 'setup.html';
  }
}
function startSession(){
  remainingMs = durationMs;
  endAt = Date.now() + remainingMs;
  paused = false; phase='focus'; sessionConfigured = true;
  scheduleBreaks(); enableWakeLock(); hookUnload();
  enterFocusMode();
  clearInterval(timerId); timerId = setInterval(tick, 200);
  updateUI();
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

// Sheet (PIN + emergency)
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
      resetSession(); // goes to setup
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

// Controls
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
// NEW: Tap the big clock (visible on the page) to re-enter Focus Mode
timerEl.addEventListener('click', ()=>{
  if (!sessionConfigured || paused) return;
  enterFocusMode();
});
// Manual button to re-enter Focus Mode
focusModeBtn.addEventListener('click', ()=>{
  if (!sessionConfigured || paused) return;
  enterFocusMode();
});

// History link in header: require PIN and end session first
historyLink.addEventListener('click', (e)=>{
  e.preventDefault();
  if(!sessionConfigured){
    window.location.href = 'history.html';
    return;
  }
  openSheet('nav_history');
});

// NEW: Back to Setup — require PIN to cancel/end the session
backToSetup.addEventListener('click', (e)=>{
  e.preventDefault();
  if(!sessionConfigured){
    window.location.href = 'setup.html';
    return;
  }
  openSheet('nav_setup');
});

// Keep overlay + fullscreen in sync if user presses ESC
document.addEventListener('fullscreenchange', ()=>{
  if(!document.fullscreenElement){ showMinimal(false); }
});

// Boot
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

// Render session info
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
