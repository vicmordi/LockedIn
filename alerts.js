/* alerts.js  — v2.3
   - Clean bell time-up: "ding–ding" (no files, pure Web Audio)
   - Pause + prompt for headrest/stand/break (user chooses resume or take break)
   - Mobile-safe AudioContext unlock after first tap/click
   - Timer integration via registerControls({ pauseTimer, resumeTimer, startBreak, endSession })
*/

(function (w, d) {
  const LS_ENABLED = 'lockedin.sound.enabled';
  const LS_VOLUME  = 'lockedin.sound.volume';

  const SHEET_CSS = `
    .li-sheet{position:fixed;inset:0;background:rgba(20,20,24,.55);backdrop-filter:blur(6px);
      display:flex;align-items:center;justify-content:center;z-index:9999}
    .li-card{width:min(520px,92vw);background:rgba(40,40,45,.92);color:#E6E6EA;
      border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:18px;
      box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    .li-title{margin:0 0 6px 0;font-weight:800;letter-spacing:.2px}
    .li-sub{margin:0 0 14px 0;color:#9A9AA5;font-size:14px}
    .li-row{display:flex;gap:10px;flex-wrap:wrap}
    .li-btn{flex:1;display:inline-flex;justify-content:center;align-items:center;gap:8px;
      padding:12px 14px;border-radius:14px;border:1px solid rgba(179,136,255,.18);
      background:linear-gradient(180deg,#B388FF,#7E57C2);color:#fff;font-weight:700;cursor:pointer}
    .li-btn.ghost{background:#2C2C32;color:#E6E6EA;border:1px solid rgba(255,255,255,.10)}
    .li-note{margin-top:8px;color:#9A9AA5;font-size:12px}
    @media (max-width:760px){ .li-card{padding:14px} }
  `;

  function injectStyleOnce() {
    if (d.getElementById('lockedin-alerts-style')) return;
    const style = d.createElement('style');
    style.id = 'lockedin-alerts-style';
    style.textContent = SHEET_CSS;
    d.head.appendChild(style);
  }

  const Alerts = {
    ctx: null,
    enabled: true,
    volume: 0.7,
    unlocked: false,
    isPromptOpen: false,
    controls: {
      pauseTimer: () => {},
      resumeTimer: () => {},
      startBreak: (_type) => {},
      endSession: () => {}
    },

    /* ------------ Setup / Settings ------------ */
    init() {
      if (!this.ctx) {
        try { this.ctx = new (w.AudioContext || w.webkitAudioContext)(); }
        catch(e){ console.warn('AudioContext failed', e); }
      }
      this._resumeCtx();

      // Unlock/resume on first user gesture (mobile/iOS)
      const resumeOnce = () => this._resumeCtx(true);
      w.addEventListener('touchstart', resumeOnce, { capture:true, once:true });
      w.addEventListener('click',      resumeOnce, { capture:true, once:true });
      d.addEventListener('visibilitychange', () => {
        if (d.visibilityState === 'visible') this._resumeCtx();
      });

      this.unlocked = true;
      injectStyleOnce();
    },

    _resumeCtx() {
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(()=>{});
      }
      if (this.ctx.state === 'running' || this.ctx.state === 'interrupted') {
        this.unlocked = true;
      }
    },

    loadSettings() {
      const en = localStorage.getItem(LS_ENABLED);
      const vol = localStorage.getItem(LS_VOLUME);
      this.enabled = (en === null) ? true : (en === 'true');
      this.volume  = (vol === null) ? 0.7  : clamp(parseFloat(vol), 0, 1);
    },

    setEnabled(v) {
      this.enabled = !!v;
      localStorage.setItem(LS_ENABLED, String(this.enabled));
    },

    setVolume(v) {
      this.volume = clamp(Number(v), 0, 1);
      localStorage.setItem(LS_VOLUME, String(this.volume));
    },

    registerControls(obj = {}) {
      this.controls.pauseTimer  = isFn(obj.pauseTimer)  ? obj.pauseTimer  : this.controls.pauseTimer;
      this.controls.resumeTimer = isFn(obj.resumeTimer) ? obj.resumeTimer : this.controls.resumeTimer;
      this.controls.startBreak  = isFn(obj.startBreak)  ? obj.startBreak  : this.controls.startBreak;
      this.controls.endSession  = isFn(obj.endSession)  ? obj.endSession  : this.controls.endSession;
    },

    vibrate(msOrPattern = [60, 40, 60]) {
      if (navigator.vibrate) navigator.vibrate(msOrPattern);
    },

    /* ------------ Synths ------------ */
    tone(freq = 880, durMs = 300, type = 'sine', volMul = 1) {
      if (!this.ctx) return;
      this._resumeCtx();
      const t0 = this.ctx.currentTime;
      const t1 = t0 + durMs / 1000;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);

      const v = this.enabled ? (this.volume * volMul) : 0;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(v, 0.0003), t0 + 0.02);
      gain.gain.setValueAtTime(Math.max(v * 0.85, 0.0003), t0 + durMs / 1800);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t1);
    },

    /* ------------ Event tones (includes time-up bell) ------------ */
    play(type = 'timeup') {
      if (!this.ctx) { this.init(); }
      this._resumeCtx();

      if (!this.enabled) {
        // Vibrate even if muted so there’s feedback
        if (type !== 'timeup') this.vibrate();
        else this.vibrate([120, 60, 120]);
        return;
      }

      switch (type) {
        case 'break':        // upbeat triple
          this.tone(880, 180, 'sine');  this.vibrate([50,40,50]);
          setTimeout(() => this.tone(1175, 160, 'sine'), 220);
          setTimeout(() => this.tone(1480, 160, 'sine'), 420);
          break;

        case 'stand':        // posture cue
          this.tone(740, 220, 'square');  this.vibrate([60,40,60]);
          setTimeout(() => this.tone(988, 220, 'square'), 260);
          break;

        case 'headrest':     // soft descending
          this.tone(660, 220, 'sine');    this.vibrate([40,30,40]);
          setTimeout(() => this.tone(530, 220, 'sine'), 260);
          break;

        case 'timeup':
          // 🛎️ Clean bell: two bright dings ~0.55s apart
          this.vibrate([100, 80, 100]);
          this.tone(1046.5, 350, 'triangle', 1.0);               // C6 ding
          setTimeout(() => this.tone(1174.7, 350, 'triangle', 1.0), 550); // D6 ding
          break;

        default:
          this.tone(880, 200);
      }
    },

    /* ------------ Prompt orchestration ------------ */
    // Public: Alerts.trigger('headrest' | 'stand' | 'break' | 'timeup')
    trigger(type) {
      if (!this.unlocked) this.init(); // ensure ctx setup (must follow any user tap)

      if (type === 'timeup') {
        // Only play the finish sound; timer.js should show completion UI / decide navigation.
        this.play('timeup');
        return;
      }

      // For headrest/stand/break: pause -> sound -> prompt
      tryFn(this.controls.pauseTimer);
      requestAnimationFrame(() => this.play(type));

      const meta = metaFor(type);
      this._showPrompt({
        title: meta.title,
        subtitle: meta.subtitle,
        primaryText: meta.primaryText,
        secondaryText: meta.secondaryText,
        onPrimary: () => { tryFn(() => this.controls.startBreak(type)); },
        onSecondary: () => { tryFn(this.controls.resumeTimer); }
      });
    },

    _showPrompt({ title, subtitle, primaryText, secondaryText, onPrimary, onSecondary }) {
      if (this.isPromptOpen) return;
      this.isPromptOpen = true;
      injectStyleOnce();

      const sheet = d.createElement('div'); sheet.className = 'li-sheet'; sheet.role = 'dialog'; sheet.ariaModal = 'true';
      const card  = d.createElement('div'); card.className  = 'li-card';
      const h2    = d.createElement('h2'); h2.className    = 'li-title'; h2.textContent = title;
      const sub   = d.createElement('p');  sub.className   = 'li-sub';   sub.textContent = subtitle;

      const row   = d.createElement('div'); row.className  = 'li-row';
      const b1    = d.createElement('button'); b1.className = 'li-btn';       b1.textContent = primaryText || 'Take Break';
      const b2    = d.createElement('button'); b2.className = 'li-btn ghost'; b2.textContent = secondaryText || 'Continue Focus';

      const note  = d.createElement('div'); note.className = 'li-note';
      note.textContent = 'Tip: Break is off-phone. Stretch / blink 20x / hydrate.';

      const close = () => { try { sheet.remove(); } catch(_){} this.isPromptOpen = false; };
      b1.addEventListener('click', () => { close(); tryFn(onPrimary); });
      b2.addEventListener('click', () => { close(); tryFn(onSecondary); });
      sheet.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); tryFn(onSecondary); }
      });

      row.appendChild(b1); row.appendChild(b2);
      card.appendChild(h2); card.appendChild(sub); card.appendChild(row); card.appendChild(note);
      sheet.appendChild(card);
      d.body.appendChild(sheet);

      setTimeout(() => b1.focus(), 0);
    }
  };

  // Helpers
  function clamp(n, min, max){ return Math.min(max, Math.max(min, n || 0)); }
  function isFn(f){ return typeof f === 'function'; }
  function tryFn(f){ if (isFn(f)) try { f(); } catch(e){ console.warn(e); } }
  function metaFor(type){
    switch(type){
      case 'headrest': return {
        title: 'Head Rest',
        subtitle: 'Relax your eyes and neck for ~20 seconds.',
        primaryText: 'Take Head Rest',
        secondaryText: 'Continue Focus'
      };
      case 'stand': return {
        title: 'Posture / Stand Up',
        subtitle: 'Stand, stretch, hydrate (about your configured minutes).',
        primaryText: 'Take Posture Break',
        secondaryText: 'Continue Focus'
      };
      case 'break': return {
        title: 'Break Time',
        subtitle: 'Short walk, water, breathe. No phone scrolling.',
        primaryText: 'Start Break',
        secondaryText: 'Continue Focus'
      };
      default: return {
        title: 'Pause',
        subtitle: 'Quick check-in.',
        primaryText: 'Take Break',
        secondaryText: 'Continue Focus'
      };
    }
  }

  w.LockedInAlerts = Alerts;

})(window, document);
