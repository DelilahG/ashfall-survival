// Tiny procedural sound effects with the Web Audio API: no audio files needed.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last = {};
    try {
      this.muted = localStorage.getItem('ashfall.muted') === '1';
    } catch {
      /* storage unavailable */
    }
  }

  // Must be called from a user gesture (browsers block audio until then).
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('ashfall.muted', m ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }

  tone(freq, dur, { type = 'square', vol = 0.3, slide = 0, delay = 0 } = {}) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  burst(dur, { vol = 0.3, freq = 1200, q = 1 } = {}) {
    const c = this.ctx;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur);
  }

  play(type) {
    if (!this.ctx || this.muted) return;
    // rate-limit identical sounds
    const now = this.ctx.currentTime;
    if (this.last[type] && now - this.last[type] < 0.05) return;
    this.last[type] = now;
    switch (type) {
      case 'swing':
        return this.burst(0.08, { vol: 0.15, freq: 2200, q: 0.7 });
      case 'hit':
        return this.tone(180, 0.08, { type: 'square', vol: 0.18, slide: -80 });
      case 'kill':
        return this.tone(320, 0.18, { type: 'triangle', vol: 0.25, slide: -220 });
      case 'hurt':
        return this.tone(110, 0.2, { type: 'sawtooth', vol: 0.22, slide: -40 });
      case 'throw':
        return this.burst(0.1, { vol: 0.12, freq: 900, q: 2 });
      case 'spit':
        return this.tone(520, 0.12, { type: 'sine', vol: 0.1, slide: -300 });
      case 'harvest':
        return this.burst(0.07, { vol: 0.22, freq: 500, q: 3 });
      case 'feed':
      case 'craft':
        this.tone(440, 0.08, { type: 'triangle', vol: 0.18 });
        return this.tone(660, 0.12, { type: 'triangle', vol: 0.18, delay: 0.07 });
      case 'eat':
        return this.tone(300, 0.1, { type: 'sine', vol: 0.2, slide: 120 });
      case 'wallHit':
      case 'fireHit':
        return this.burst(0.12, { vol: 0.2, freq: 300, q: 1 });
      case 'wallBreak':
        return this.burst(0.3, { vol: 0.3, freq: 200, q: 0.5 });
      case 'newDay':
        this.tone(392, 0.4, { type: 'sine', vol: 0.18 });
        return this.tone(523, 0.6, { type: 'sine', vol: 0.18, delay: 0.25 });
      case 'nightfall':
        return this.tone(220, 0.9, { type: 'sine', vol: 0.18, slide: -90 });
      case 'death':
        this.tone(200, 0.5, { type: 'sawtooth', vol: 0.22, slide: -150 });
        return this.tone(100, 0.9, { type: 'sine', vol: 0.25, slide: -60, delay: 0.3 });
      default:
    }
  }
}
