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
const enableQuotes = document.getElementById('enableQuotes');
const tel1 = document.getElementById('tel1');
const tel2 = document.getElementById('tel2');
const tel3 = document.getElementById('tel3');
const sessionDesc = document.getElementById('sessionDesc');
const form = document.getElementById('setupForm');
const errorsEl = document.getElementById('errors');

function phoneOk(v){ return (v||'').replace(/\s+/g,'').length >= 3; }
function showErrors(list){
  if(!list.length){ errorsEl.classList.add('hidden'); errorsEl.textContent = ''; return; }
  errorsEl.innerHTML = 'Please fix:<br>• ' + list.join('<br>• ');
  errorsEl.classList.remove('hidden');
}
function validate(){
  const errs = [];
  const pin = (pinField.value||'').trim();
  if(!durationMs || durationMs < 60000) errs.push('Choose a focus duration (≥ 1 minute).');
  if(pin.length < 4 || !/^\d+$/.test(pin)) errs.push('PIN must be at least 4 digits (numbers only).');

  if(breakPlan.value === 'custom'){
    const me = +microEvery.value || 0;
    const se = +standEvery.value || 0;
    const sl = +standLen.value || 0;
    if(enableHeadRest.checked && me !== 0 && me < 10) errs.push('Head/eye rest every must be 0 or ≥ 10 min.');
    if(enableStand.checked && se !== 0 && se < 30) errs.push('Stand every must be 0 or ≥ 30 min.');
    if(enableStand.checked && sl < 1) errs.push('Stand break length must be ≥ 1 min.');
  }

  const phones = [tel1.value, tel2.value, tel3.value].filter(phoneOk);
  if(phones.length < 1) errs.push('Enter at least one emergency contact.');

  showErrors(errs);
  return errs.length === 0;
}
function applyPlanUI(){ customBreaks.classList.toggle('hidden', breakPlan.value !== 'custom'); }

presetRow.addEventListener('click', e=>{
  const btn = e.target.closest('.chip'); if(!btn) return;
  [...presetRow.querySelectorAll('.chip')].forEach(c=>c.dataset.active='false');
  btn.dataset.active = 'true';
  const m = parseInt(btn.dataset.min,10);
  durationMs = m * 60 * 1000;
  customMinutes.value = '';
});
customMinutes.addEventListener('input', ()=>{
  const v = +customMinutes.value;
  if(!isNaN(v) && v > 0){
    durationMs = v * 60 * 1000;
    [...presetRow.querySelectorAll('.chip')].forEach(c=>c.dataset.active='false');
  }
});
breakPlan.addEventListener('change', applyPlanUI);
applyPlanUI();

form.addEventListener('submit', (e)=>{
  e.preventDefault();
  if(!validate()) return;

  // compute plan
  let micro = 0, standEveryMin = 0, standLenMin = 5;
  if(breakPlan.value === 'pomodoro'){
    standEveryMin = Math.round(durationMs/60000);
    standLenMin = 5;
    micro = enableHeadRest.checked ? 20 : 0;
  }else if(breakPlan.value === 'fiftyten'){
    standEveryMin = Math.round(durationMs/60000);
    standLenMin = 10;
    micro = enableHeadRest.checked ? 25 : 0;
  }else{
    micro = enableHeadRest.checked ? Math.max(0, +microEvery.value || 0) : 0;
    standEveryMin = enableStand.checked ? Math.max(0, +standEvery.value || 0) : 0;
    standLenMin = enableStand.checked ? Math.max(1, +standLen.value || 3) : 0;
  }

  const cfg = {
    durationMs,
    pin: (pinField.value||'').trim(),
    enableQuotes: !!enableQuotes.checked,
    microEveryMin: micro,
    standEveryMin,
    standLenMin,
    emergency: [tel1.value, tel2.value, tel3.value].filter(phoneOk),
    description: (sessionDesc.value||'').trim()
  };
  sessionStorage.setItem('lockedInConfig', JSON.stringify(cfg));
  window.location.href = 'timer.html';
});
