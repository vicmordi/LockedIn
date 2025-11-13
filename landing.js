/* landing.js — swipe-to-setup with smooth drag */
(function(){
  const track = document.getElementById('swipeTrack');
  const knob = document.getElementById('swipeKnob');
  const glow = document.getElementById('swipeGlow');
  const hint = document.getElementById('swipeHint');
  if (!track || !knob) return;

  const GOAL = 0.88;
  let max = 0;
  let startX = 0;
  let startOffset = 0;
  let currentPos = 0;
  let dragging = false;
  let completed = false;

  function measure(){
    const prevProgress = max > 0 ? currentPos / max : 0;
    const rect = track.getBoundingClientRect();
    const knobWidth = knob.offsetWidth;
    max = Math.max(0, rect.width - knobWidth);
    currentPos = Math.min(max, Math.max(0, max * prevProgress));
    knob.style.transition = '';
    knob.style.setProperty('--knob-x', `${currentPos}px`);
    applyProgress(max === 0 ? 1 : currentPos / max);
  }
  window.addEventListener('resize', () => measure(), { passive: true });
  requestAnimationFrame(measure);

  knob.addEventListener('transitionend', () => {
    knob.style.transition = '';
  });

  function applyProgress(progress){
    track.style.setProperty('--progress', progress);
    track.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    if (glow){
      glow.style.transform = `scaleX(${Math.max(0.18, progress)})`;
    }
    track.classList.toggle('armed', progress > 0.25 && progress < GOAL);
  }

  function setKnob(px, { animate = false } = {}){
    currentPos = Math.min(max, Math.max(0, px));
    if (animate){
      knob.style.transition = 'transform 260ms cubic-bezier(.22,.8,.25,1)';
      requestAnimationFrame(() => {
        knob.style.setProperty('--knob-x', `${currentPos}px`);
      });
    }else{
      knob.style.transition = '';
      knob.style.setProperty('--knob-x', `${currentPos}px`);
    }
    const progress = max === 0 ? 1 : currentPos / max;
    applyProgress(progress);
    return progress;
  }

  function reset(){
    completed = false;
    track.classList.remove('complete');
    if (hint) hint.textContent = 'Swipe to Setup';
    setKnob(0, { animate: true });
  }

  function success(){
    if (completed) return;
    completed = true;
    track.classList.add('complete');
    if (hint) hint.textContent = 'Launching setup…';
    setKnob(max, { animate: true });
    if (navigator.vibrate) navigator.vibrate(12);
    setTimeout(() => window.location.href = 'setup.html', 320);
  }

  function onPointerDown(event){
    if (completed) return;
    dragging = true;
    track.classList.add('dragging');
    startX = event.clientX;
    startOffset = currentPos;
    knob.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event){
    if (!dragging || completed) return;
    const delta = event.clientX - startX;
    setKnob(startOffset + delta);
  }
  function onPointerUp(event){
    if (!dragging) return;
    dragging = false;
    knob.releasePointerCapture(event.pointerId);
    track.classList.remove('dragging');
    const progress = max === 0 ? 1 : currentPos / max;
    if (progress >= GOAL){
      success();
    }else{
      reset();
    }
  }

  knob.addEventListener('pointerdown', onPointerDown);
  knob.addEventListener('pointermove', onPointerMove);
  knob.addEventListener('pointerup', onPointerUp);
  knob.addEventListener('pointercancel', onPointerUp);

  track.addEventListener('pointerdown', (event) => {
    if (event.target === knob || completed) return;
    const rect = track.getBoundingClientRect();
    const knobWidth = knob.offsetWidth;
    const desired = event.clientX - rect.left - knobWidth / 2;
    const progress = setKnob(desired, { animate: true });
    if (progress >= GOAL){
      success();
    }
  });

  knob.addEventListener('keydown', (event) => {
    if (completed) return;
    const key = event.key;
    if (key === 'ArrowRight' || key === 'ArrowUp'){
      event.preventDefault();
      const progress = setKnob(currentPos + max * 0.22, { animate: true });
      if (progress >= GOAL) success();
    }else if (key === 'ArrowLeft' || key === 'ArrowDown'){
      event.preventDefault();
      setKnob(currentPos - max * 0.22, { animate: true });
    }else if (key === 'Enter' || key === ' '){
      event.preventDefault();
      success();
    }
  });

  document.querySelectorAll('.sheet,.minimal,.veil,.overlay').forEach(el => {
    el.setAttribute('hidden', '');
    el.style.display = 'none';
    el.style.backdropFilter = 'none';
  });
})();
