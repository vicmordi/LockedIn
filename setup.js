let durationMs = 0;

const presetRow = document.getElementById('presetRow');
const customMinutes = document.getElementById('customMinutes');
const pinField = document.getElementById('pin');

const breakPlan = document.getElementById('breakPlan');
const customBreaks = document.getElementById('customBreaks');
const microEvery = document.getElementById('microEvery');
const standEvery = document.getElementById('standEvery');
const standLen = document.getElementById('standLen');
const enableHeadRest = document.getElementById('enableHeadRest');
const enableStand = document.getElementById('enableStand');

const enableBreakQuotes = document.getElementById('enableBreakQuotes');

const tel1 = document.getElementById('tel1');
const tel2 = document.getElementById('tel2');
const tel3 = document.getElementById('tel3');
const sessionDesc = document.getElementById('sessionDesc');

const form = document.getElementById('setupForm');
const errorsEl = document.getElementById('errors');

const soundEnabledEl = document.getElementById('soundEnabled');
const soundVolumeEl  = document.getElementById('soundVolume');

const LS_ENABLED = 'lockedin.sound.enabled';
const LS_VOLUME  = 'lockedin.sound.volume';

const presetButtons = presetRow ? [...presetRow.querySelectorAll('.chip')] : [];
presetButtons.forEach(btn => btn.setAttribute('aria-pressed','false'));

function clearPresetStates(){
  presetButtons.forEach(btn => {
    btn.dataset.active = 'false';
    btn.setAttribute('aria-pressed','false');
  });
}

function phoneOk(v){ return (v||'').replace(/\s+/g,'').length >= 3; }

function showErrors(list){
  if(!list.length){
    errorsEl.classList.add('hidden');
    errorsEl.textContent = '';
    errorsEl.setAttribute('aria-hidden','true');
    return;
  }
  errorsEl.innerHTML = 'Please fix:<br>• ' + list.join('<br>• ');
  errorsEl.classList.remove('hidden');
  errorsEl.setAttribute('aria-hidden','false');
}

function validate(){
  const errs = [];
  let focusTarget = null;
  const pin = (pinField.value||'').trim();

  if(!durationMs || durationMs < 60000){
    errs.push('Choose a focus duration (≥ 1 minute).');
    focusTarget = focusTarget || (customMinutes.value ? customMinutes : presetButtons[0]);
  }
  if(pin.length < 4 || !/^\d+$/.test(pin)){
    errs.push('PIN must be at least 4 digits (numbers only).');
    focusTarget = focusTarget || pinField;
  }

  if(breakPlan.value === 'custom'){
    const me = +microEvery.value || 0;
    const se = +standEvery.value || 0;
    const sl = +standLen.value || 0;
    if(enableHeadRest.checked && me !== 0 && me < 10){
      errs.push('Head/eye rest every must be 0 or ≥ 10 min.');
      focusTarget = focusTarget || microEvery;
    }
    if(enableStand.checked && se !== 0 && se < 30){
      errs.push('Stand every must be 0 or ≥ 30 min.');
      focusTarget = focusTarget || standEvery;
    }
    if(enableStand.checked && sl < 1){
      errs.push('Stand break length must be ≥ 1 min.');
      focusTarget = focusTarget || standLen;
    }
  }

  const phones = [tel1.value, tel2.value, tel3.value].filter(phoneOk);
  if(phones.length < 1){
    errs.push('Enter at least one emergency contact.');
    focusTarget = focusTarget || tel1;
  }

  showErrors(errs);
  if(errs.length){
    if (focusTarget && typeof focusTarget.focus === 'function'){
      focusTarget.focus({ preventScroll: false });
    }
    return false;
  }
  return true;
}

function applyPlanUI(){
  customBreaks.classList.toggle('hidden', breakPlan.value !== 'custom');
}

presetRow.addEventListener('click', e=>{
  const btn = e.target.closest('.chip'); if(!btn) return;
  clearPresetStates();
  btn.dataset.active = 'true';
  btn.setAttribute('aria-pressed','true');
  const m = parseInt(btn.dataset.min,10);
  durationMs = m * 60 * 1000;
  customMinutes.value = '';
});

customMinutes.addEventListener('input', ()=>{
  const v = +customMinutes.value;
  if(!isNaN(v) && v > 0){
    durationMs = v * 60 * 1000;
    clearPresetStates();
  }else{
    durationMs = 0;
  }
});

breakPlan.addEventListener('change', applyPlanUI);
applyPlanUI();

form.addEventListener('submit', (e)=>{
  e.preventDefault();
  if(!validate()) return;

  // ---- Compute plan values ----
  let microEveryMin = 0, standEveryMin = 0, standLenMin = 0;

  if (breakPlan.value === 'pomodoro') {
    // True Pomodoro = 25/5; headrest every ~20m if enabled
    microEveryMin = enableHeadRest.checked ? 20 : 0;
    standEveryMin = enableStand.checked ? 25 : 0;
    standLenMin   = enableStand.checked ? 5  : 0;
  } else if (breakPlan.value === 'fiftyten') {
    // 50/10 pattern; headrest still every ~20m if enabled
    microEveryMin = enableHeadRest.checked ? 20 : 0;
    standEveryMin = enableStand.checked ? 50 : 0;
    standLenMin   = enableStand.checked ? 10 : 0;
  } else {
    // Custom
    microEveryMin = enableHeadRest.checked ? Math.max(0, +microEvery.value || 0) : 0;
    standEveryMin = enableStand.checked ? Math.max(0, +standEvery.value || 0) : 0;
    standLenMin   = enableStand.checked ? Math.max(1, +standLen.value   || 3) : 0;
  }

  // ---- Persist sound preferences (On/Off + Volume) ----
  if (soundEnabledEl) {
    localStorage.setItem(LS_ENABLED, String(!!soundEnabledEl.checked));
  }
  if (soundVolumeEl) {
    const vol = Math.min(1, Math.max(0, parseFloat(soundVolumeEl.value || '0.7')));
    localStorage.setItem(LS_VOLUME, String(vol));
  }

  // Signal to timer that sounds are expected (timer will try to auto-play;
  // on some mobile browsers a single tap on timer page may still be required)
  sessionStorage.setItem('lockedin.sound.expect', 'true');

  // ---- Build config + navigate ----
  const cfg = {
    durationMs,
    pin: (pinField.value||'').trim(),
    // UPDATED: new flag; default true if element missing
    enableBreakQuotes: enableBreakQuotes ? !!enableBreakQuotes.checked : true,
    microEveryMin,
    standEveryMin,
    standLenMin,
    emergency: [tel1.value, tel2.value, tel3.value].filter(phoneOk),
    description: (sessionDesc.value||'').trim()
  };

  sessionStorage.setItem('lockedInConfig', JSON.stringify(cfg));
  window.location.href = 'timer.html';
});
