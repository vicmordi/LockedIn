let durationMs = 0;

// New simplified UI elements
const durationButtons = document.getElementById('durationButtons');
const startBtn = document.getElementById('startBtn');
const customTimeInput = document.getElementById('customTime');
const totalTimeEl = document.getElementById('totalTime');

// Advanced settings elements (for when form is shown)
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
const soundVolumeEl = document.getElementById('soundVolume');

const LS_ENABLED = 'lockedin.sound.enabled';
const LS_VOLUME  = 'lockedin.sound.volume';

// Calculate and display total focus time
function updateTotalTime(){
  try{
    const history = JSON.parse(localStorage.getItem('li_history') || '[]');
    let totalMs = 0;
    history.forEach(item => {
      if(item.completed && item.durationMs){
        totalMs += item.durationMs;
      }
    });
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    if(totalTimeEl){
      totalTimeEl.textContent = `Total focus time: ${hours}h ${minutes}m`;
    }
  }catch(_){
    if(totalTimeEl) totalTimeEl.textContent = 'Total focus time: 0h 0m';
  }
}

// Initialize total time display
updateTotalTime();

// Default values for quick start (can be overridden by advanced settings)
let defaultPin = '1234';
let defaultEmergency = ['911'];
let defaultBreakPlan = 'pomodoro';
let defaultMicroEveryMin = 20;
let defaultStandEveryMin = 25;
let defaultStandLenMin = 5;
let defaultEnableHeadRest = true;
let defaultEnableStand = true;
let defaultEnableBreakQuotes = true;

// Load defaults from localStorage if available (but don't use saved PIN as default)
try{
  const savedConfig = JSON.parse(localStorage.getItem('lockedInConfig') || 'null');
  if(savedConfig){
    // Don't load saved PIN - user must set it fresh each time or leave empty
    defaultEmergency = savedConfig.emergency && savedConfig.emergency.length > 0 ? savedConfig.emergency : defaultEmergency;
  }
}catch(_){}

// Duration card handling
if(durationButtons){
  const cards = durationButtons.querySelectorAll('.duration-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      // Remove active class from all cards
      cards.forEach(c => c.classList.remove('active'));
      // Add active class to clicked card
      card.classList.add('active');
      // Set duration
      const minutes = parseInt(card.dataset.min, 10);
      durationMs = minutes * 60 * 1000;
      // Clear custom time input when preset is selected
      if(customTimeInput) customTimeInput.value = '';
    });
  });
  
  // Set default to 1h
  const defaultCard = Array.from(cards).find(c => c.dataset.min === '60');
  if(defaultCard){
    defaultCard.classList.add('active');
    durationMs = 60 * 60 * 1000;
  }
}

// Custom time input handling
if(customTimeInput){
  customTimeInput.addEventListener('input', () => {
    const value = customTimeInput.value.trim();
    if(value && !isNaN(value) && parseInt(value) > 0){
      const minutes = parseInt(value, 10);
      durationMs = minutes * 60 * 1000;
      // Clear preset selection when custom time is entered
      if(durationButtons){
        durationButtons.querySelectorAll('.duration-card').forEach(c => c.classList.remove('active'));
      }
    }else if(!value){
      // If cleared, reset to default 1h
      if(durationButtons){
        const defaultCard = Array.from(durationButtons.querySelectorAll('.duration-card')).find(c => c.dataset.min === '60');
        if(defaultCard){
          defaultCard.classList.add('active');
          durationMs = 60 * 60 * 1000;
        }
      }
    }
  });
  
  customTimeInput.addEventListener('focus', () => {
    // Clear preset selection when focusing on custom input
    if(durationButtons){
      durationButtons.querySelectorAll('.duration-card').forEach(c => c.classList.remove('active'));
    }
  });
}

function phoneOk(v){ return (v||'').replace(/\s+/g,'').length >= 3; }

function showErrors(list){
  if(!errorsEl) return;
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
  
  // Check if using advanced settings
  const useAdvanced = form && !form.classList.contains('hidden') && form.parentElement && !form.parentElement.classList.contains('hidden');
  
  let pin = defaultPin;
  let phones = defaultEmergency;
  
  if(useAdvanced && pinField){
    pin = (pinField.value||'').trim();
    if(pin.length < 4 || !/^\d+$/.test(pin)){
      errs.push('PIN must be at least 4 digits (numbers only).');
      focusTarget = focusTarget || pinField;
    }
    
    phones = [tel1?.value, tel2?.value, tel3?.value].filter(phoneOk);
    if(phones.length < 1){
      errs.push('Enter at least one emergency contact.');
      focusTarget = focusTarget || tel1;
    }
    
    if(breakPlan && breakPlan.value === 'custom'){
      const me = +microEvery?.value || 0;
      const se = +standEvery?.value || 0;
      const sl = +standLen?.value || 0;
      if(enableHeadRest?.checked && me !== 0 && me < 10){
        errs.push('Head/eye rest every must be 0 or ≥ 10 min.');
        focusTarget = focusTarget || microEvery;
      }
      if(enableStand?.checked && se !== 0 && se < 30){
        errs.push('Stand every must be 0 or ≥ 30 min.');
        focusTarget = focusTarget || standEvery;
      }
      if(enableStand?.checked && sl < 1){
        errs.push('Stand break length must be ≥ 1 min.');
        focusTarget = focusTarget || standLen;
      }
    }
  }else{
    // Quick start validation
    if(!durationMs || durationMs < 60000){
      errs.push('Choose a focus duration (≥ 1 minute).');
    }
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
  if(customBreaks && breakPlan){
    customBreaks.classList.toggle('hidden', breakPlan.value !== 'custom');
  }
}

if(breakPlan){
  breakPlan.addEventListener('change', applyPlanUI);
  applyPlanUI();
}

// Start session handler
function startSession(){
  if(!validate()) return;
  
  const finalDurationMs = durationMs;
  
  if(!finalDurationMs || finalDurationMs < 1000){
    showErrors(['Choose a focus duration.']);
    return;
  }

  // Compute plan values
  let microEveryMin = 0, standEveryMin = 0, standLenMin = 0;
  const useAdvanced = form && !form.classList.contains('hidden') && form.parentElement && !form.parentElement.classList.contains('hidden');
  
  if(useAdvanced && breakPlan){
    if (breakPlan.value === 'pomodoro') {
      microEveryMin = enableHeadRest?.checked ? 20 : 0;
      standEveryMin = enableStand?.checked ? 25 : 0;
      standLenMin   = enableStand?.checked ? 5  : 0;
    } else if (breakPlan.value === 'fiftyten') {
      microEveryMin = enableHeadRest?.checked ? 20 : 0;
      standEveryMin = enableStand?.checked ? 50 : 0;
      standLenMin   = enableStand?.checked ? 10 : 0;
    } else {
      microEveryMin = enableHeadRest?.checked ? Math.max(0, +microEvery?.value || 0) : 0;
      standEveryMin = enableStand?.checked ? Math.max(0, +standEvery?.value || 0) : 0;
      standLenMin   = enableStand?.checked ? Math.max(1, +standLen?.value   || 3) : 0;
    }
  }else{
    // Use defaults for quick start
    microEveryMin = defaultMicroEveryMin;
    standEveryMin = defaultStandEveryMin;
    standLenMin = defaultStandLenMin;
  }

  // Persist sound preferences
  if (soundEnabledEl) {
    localStorage.setItem(LS_ENABLED, String(!!soundEnabledEl.checked));
  }
  if (soundVolumeEl) {
    const vol = Math.min(1, Math.max(0, parseFloat(soundVolumeEl.value || '0.7')));
    localStorage.setItem(LS_VOLUME, String(vol));
  }

  sessionStorage.setItem('lockedin.sound.expect', 'true');

  // Get PIN and emergency contacts
  let pin = '';
  let phones = defaultEmergency;
  let description = '';
  
  if(useAdvanced){
    if(pinField) pin = (pinField.value||'').trim();
    phones = [tel1?.value, tel2?.value, tel3?.value].filter(phoneOk);
    if(sessionDesc) description = (sessionDesc.value||'').trim();
  }
  
  // Only use default PIN if user explicitly set one in advanced settings
  // If no PIN is set, leave it empty (no PIN required)
  if(useAdvanced && pinField && (!pin || pin.length < 4)){
    pin = ''; // No PIN set - don't require PIN
  } else if(!useAdvanced){
    pin = ''; // Quick start - no PIN required
  }
  
  if(!phones || phones.length < 1){
    phones = defaultEmergency;
  }

  // Build config
  const cfg = {
    durationMs: finalDurationMs,
    pin: pin,
    enableBreakQuotes: useAdvanced && enableBreakQuotes ? !!enableBreakQuotes.checked : defaultEnableBreakQuotes,
    microEveryMin,
    standEveryMin,
    standLenMin,
    emergency: phones,
    description: description
  };

  sessionStorage.setItem('lockedInConfig', JSON.stringify(cfg));
  window.location.href = 'timer.html';
}

// Function to close advanced settings
function closeAdvancedSettings(){
  const advancedSettings = document.getElementById('advancedSettings');
  const toggleAdvancedBtn = document.getElementById('toggleAdvanced');
  const toggleAdvancedText = document.getElementById('toggleAdvancedText');
  
  if(advancedSettings){
    advancedSettings.classList.remove('visible');
    if(toggleAdvancedBtn) toggleAdvancedBtn.classList.remove('expanded');
    if(toggleAdvancedText) toggleAdvancedText.textContent = '⚙️ Advanced Settings';
    // Wait for animation then hide
    setTimeout(() => {
      if(!advancedSettings.classList.contains('visible')){
        advancedSettings.classList.add('hidden');
      }
    }, 300);
  }
}

// Function to open advanced settings
function openAdvancedSettings(){
  const advancedSettings = document.getElementById('advancedSettings');
  const toggleAdvancedBtn = document.getElementById('toggleAdvanced');
  const toggleAdvancedText = document.getElementById('toggleAdvancedText');
  
  if(advancedSettings){
    advancedSettings.classList.remove('hidden');
    advancedSettings.classList.add('visible');
    if(toggleAdvancedBtn) toggleAdvancedBtn.classList.add('expanded');
    if(toggleAdvancedText) toggleAdvancedText.textContent = '⚙️ Advanced Settings';
  }
}

// Toggle advanced settings button
const toggleAdvancedBtn = document.getElementById('toggleAdvanced');
const advancedSettings = document.getElementById('advancedSettings');
const toggleAdvancedText = document.getElementById('toggleAdvancedText');
const closeAdvancedBtn = document.getElementById('closeAdvancedBtn');

if(toggleAdvancedBtn && advancedSettings){
  toggleAdvancedBtn.addEventListener('click', () => {
    const isHidden = advancedSettings.classList.contains('hidden');
    if(isHidden){
      openAdvancedSettings();
    }else{
      const isVisible = advancedSettings.classList.contains('visible');
      if(isVisible){
        closeAdvancedSettings();
      }else{
        openAdvancedSettings();
      }
    }
  });
}

// Close button in advanced settings header
if(closeAdvancedBtn){
  closeAdvancedBtn.addEventListener('click', () => {
    closeAdvancedSettings();
  });
}

// Button event listeners
if(startBtn){
  startBtn.addEventListener('click', () => startSession());
}

// Advanced settings start button
const startBtnAdvanced = document.getElementById('startBtnAdvanced');

if(startBtnAdvanced){
  startBtnAdvanced.addEventListener('click', () => startSession());
}

// Form submit handler (for advanced settings)
if(form){
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    startSession(false);
  });
}

// Legacy handlers for advanced settings
if(customMinutes){
  customMinutes.addEventListener('input', ()=>{
    const v = +customMinutes.value;
    if(!isNaN(v) && v > 0){
      durationMs = v * 60 * 1000;
      // Clear preset selection
      if(durationButtons){
        durationButtons.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
      }
    }else{
      durationMs = 0;
    }
  });
}
