// Swipe-to-setup (no libraries)
(function(){
  const track = document.querySelector('.track');
  const knob  = document.getElementById('knob');
  if(!track || !knob) return;

  const GOAL = 0.92; // 92% slide to trigger
  let startX = 0, startLeft = 0, max = 0, down = false;

  function layout(){
    const rect = track.getBoundingClientRect();
    const krect = knob.getBoundingClientRect();
    max = rect.width - krect.width - 8; // 4px inset left/right
  }
  layout();
  window.addEventListener('resize', layout, {passive:true});

  function setLeft(px){
    px = Math.max(4, Math.min(4 + px, 4 + max));
    knob.style.left = px + 'px';
  }

  function onDown(e){
    down = true;
    startX = (e.touches ? e.touches[0].clientX : e.clientX);
    const left = parseFloat(getComputedStyle(knob).left) || 4;
    startLeft = left - 4;
    e.preventDefault();
  }
  function onMove(e){
    if(!down) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    const dx = x - startX;
    setLeft(startLeft + dx);
  }
  function onUp(){
    if(!down) return;
    down = false;
    const left = parseFloat(getComputedStyle(knob).left) || 4;
    const progress = (left - 4) / max;
    if(progress >= GOAL){
      knob.style.left = (4 + max) + 'px';
      // small delay for satisfaction
      setTimeout(()=> window.location.href = 'setup.html', 120);
    } else {
      knob.style.left = '4px';
    }
  }

  knob.addEventListener('mousedown', onDown);
  knob.addEventListener('touchstart', onDown, {passive:false});
  window.addEventListener('mousemove', onMove, {passive:false});
  window.addEventListener('touchmove', onMove, {passive:false});
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);

  // Also allow quick Enter/Space to go
  knob.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      window.location.href = 'setup.html';
    }
  });

  // Hard-kill any accidental page-wide blurs from other pages’ CSS
  // (common cause of “everything is blurry”)
  document.querySelectorAll('.sheet,.minimal,.veil,.overlay').forEach(el=>{
    el.setAttribute('hidden','');
    el.style.display = 'none';
    el.style.backdropFilter = 'none';
  });
})();
