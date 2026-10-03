// Motor/pervane sesi, WebAudio ile sentez (ses dosyası yok).
// Her motor: testere dişi osilatör, motorlar arası küçük akort farkı → gerçek dronlardaki dalgalanma.
// Üstüne bant geçiren gürültü (hava akışı) ve uçakta düşük frekanslı motor gümbürtüsü.

const PROFILES = {
  neo: { base: 430, range: [0.8, 1.4], motors: 4, lp: 2.6, noise: 0.35, rumble: 0, vol: 0.45, ref: 3 },
  mini: { base: 300, range: [0.8, 1.35], motors: 4, lp: 2.4, noise: 0.35, rumble: 0, vol: 0.5, ref: 4 },
  air: { base: 250, range: [0.8, 1.35], motors: 4, lp: 2.3, noise: 0.35, rumble: 0, vol: 0.55, ref: 5 },
  mavic: { base: 215, range: [0.8, 1.35], motors: 4, lp: 2.2, noise: 0.35, rumble: 0, vol: 0.6, ref: 6 },
  inspire: { base: 150, range: [0.8, 1.3], motors: 4, lp: 2.2, noise: 0.4, rumble: 0, vol: 0.7, ref: 9 },
  whoop: { base: 390, range: [0.75, 1.6], motors: 4, lp: 2.6, noise: 0.5, rumble: 0, vol: 0.55, ref: 4 },
  racer: { base: 480, range: [0.6, 2.2], motors: 4, lp: 3.0, noise: 0.45, rumble: 0, vol: 0.6, ref: 6 },
  rcplane: { base: 190, range: [0.45, 1.6], motors: 1, lp: 4.0, noise: 0.3, rumble: 0, vol: 0.55, ref: 8 },
  edf: { base: 820, range: [0.5, 1.7], motors: 2, lp: 3.2, noise: 0.7, rumble: 0, vol: 0.55, ref: 10 },
  cessna: { base: 74, range: [0.7, 1.15], motors: 1, lp: 7.0, noise: 0.35, rumble: 37, vol: 0.75, ref: 60 },
};

export const SOUND_OF = {
  neo: 'neo', mini4: 'mini', mini5: 'mini', air3s: 'air', mavic4: 'mavic', inspire3: 'inspire',
  avata2: 'whoop', racer5: 'racer', trainer: 'rcplane', extra: 'rcplane', glider: 'rcplane', jet: 'edf', cessna: 'cessna',
};

export class MotorSound {
  constructor() {
    this.ctx = null;
    this.profile = PROFILES.mini;
    this.volume = 0.6;
    this.muted = false;
  }

  // Tarayıcı ses için kullanıcı etkileşimi ister: tıklama/tuşta çağrılır.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this._build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);

    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.connect(this.master);
    this.oscs = [0, 1, 2, 3].map((i) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      const g = c.createGain();
      g.gain.value = 0;
      o.connect(g).connect(this.lp);
      o.start();
      return { o, g, detune: [0, 0.013, -0.009, 0.021][i] };
    });

    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.nbp = c.createBiquadFilter();
    this.nbp.type = 'bandpass';
    this.nbp.Q.value = 0.7;
    this.ngain = c.createGain();
    noise.connect(this.nbp).connect(this.ngain).connect(this.master);
    noise.start();

    this.rumble = c.createOscillator();
    this.rumble.type = 'square';
    const rlp = c.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 260;
    this.rgain = c.createGain();
    this.rgain.gain.value = 0;
    this.rumble.connect(rlp).connect(this.rgain).connect(this.master);
    this.rumble.start();
  }

  setVehicle(id) {
    this.profile = PROFILES[SOUND_OF[id]] || PROFILES.mini;
  }

  // spin 0..1 (pervane dönüşü), load 0..1 (gaz/manevra), dist m (kameraya uzaklık)
  update(spin, load, dist) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const p = this.profile;
    const t = this.ctx.currentTime;
    const k = 0.06;
    const f = p.base * (p.range[0] + (p.range[1] - p.range[0]) * load) * (0.35 + 0.65 * spin);
    this.oscs.forEach((m, i) => {
      const on = i < p.motors;
      m.o.frequency.setTargetAtTime(f * (1 + m.detune * (0.6 + load)), t, k);
      m.g.gain.setTargetAtTime(on ? 0.22 / p.motors ** 0.5 : 0, t, k);
    });
    this.lp.frequency.setTargetAtTime(Math.min(16000, f * p.lp), t, k);
    this.nbp.frequency.setTargetAtTime(Math.min(12000, f * 3), t, k);
    this.ngain.gain.setTargetAtTime(p.noise * (0.4 + 0.6 * load), t, k);
    this.rumble.frequency.setTargetAtTime(p.rumble * (0.85 + 0.3 * load) || 1, t, k);
    this.rgain.gain.setTargetAtTime(p.rumble ? 0.35 * (0.5 + load) : 0, t, k);
    const near = Math.min(1, p.ref / Math.max(dist, 0.1));
    const level = this.muted ? 0 : this.volume * p.vol * spin * near;
    this.master.gain.setTargetAtTime(level, t, 0.08);
  }
}
