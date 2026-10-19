export class GameAudio {
  constructor() {
    this.enabled = true;
    this.volume = 0.55;
    this.context = null;
    this.stepTimer = 0;
    this.flapTimer = 0;
  }
  report(error) {
    if (!this.warned)
      console.warn("Audio is unavailable; game controls remain active.", error);
    this.warned = true;
  }
  attempt(operation) {
    try {
      return operation();
    } catch (error) {
      this.report(error);
      return false;
    }
  }
  init() {
    const ready = this.attempt(() => this.initialize());
    if (!ready) {
      if (this.context?.state !== "closed")
        this.attempt(() => this.context?.close().catch(() => {}));
      this.context = null;
      this.master = null;
      this.windGain = null;
      this.noiseBuffer = null;
    }
    return !!ready;
  }
  initialize() {
    if (this.context?.state === "closed") this.context = null;
    if (this.context) {
      if (this.context.state !== "running")
        this.context.resume().catch((error) => this.report(error));
      return true;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.context.destination);
    const len = this.context.sampleRate * 3;
    this.noiseBuffer = this.context.createBuffer(
      1,
      len,
      this.context.sampleRate,
    );
    const data = this.noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.035 * (Math.random() * 2 - 1)) / 1.035;
      data[i] = last * 5;
    }
    this.wind = this.context.createBufferSource();
    this.wind.buffer = this.noiseBuffer;
    this.wind.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 550;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.09;
    this.wind.connect(filter).connect(this.windGain).connect(this.master);
    this.wind.start();
    return true;
  }
  setEnabled(value) {
    this.enabled = value;
    this.applyVolume();
  }
  setVolume(value) {
    this.volume = value;
    this.applyVolume();
  }
  applyVolume() {
    if (!this.master || !this.context || this.context.state === "closed")
      return;
    this.attempt(() =>
      this.master.gain.setTargetAtTime(
        this.enabled ? this.volume : 0,
        this.context.currentTime,
        0.08,
      ),
    );
  }
  tone(freq, duration = 0.1, type = "sine", volume = 0.2, endFreq) {
    if (!this.context || !this.enabled || this.context.state !== "running")
      return;
    this.attempt(() => {
      const now = this.context.currentTime,
        osc = this.context.createOscillator(),
        gain = this.context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (endFreq)
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain).connect(this.master);
      osc.start();
      osc.stop(now + duration);
    });
  }
  noise(duration, volume, frequency) {
    if (!this.context || !this.enabled || this.context.state !== "running")
      return;
    this.attempt(() => {
      const now = this.context.currentTime,
        source = this.context.createBufferSource(),
        gain = this.context.createGain(),
        filter = this.context.createBiquadFilter();
      source.buffer = this.noiseBuffer;
      source.loop = true;
      filter.type = "lowpass";
      filter.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(now, Math.random());
      source.stop(now + duration);
    });
  }
  step() {
    this.tone(65, 0.13, "sine", 0.22, 26);
    this.noise(0.12, 0.23, 700);
  }
  jump() {
    this.tone(100, 0.28, "sine", 0.2, 215);
    this.noise(0.3, 0.22, 900);
  }
  land() {
    this.tone(55, 0.3, "sine", 0.4, 22);
    this.noise(0.28, 0.4, 1000);
  }
  hit() {
    this.tone(70, 0.6, "sawtooth", 0.16, 22);
    this.noise(0.75, 0.6, 1800);
    this.roar(0.45);
  }
  roar(volume = 0.12) {
    this.tone(83, 0.8, "sawtooth", volume, 39);
    this.tone(103, 0.9, "triangle", volume * 0.6, 35);
  }
  flap() {
    this.noise(0.22, 0.26, 700);
  }
  click() {
    this.tone(330, 0.055, "sine", 0.08, 440);
  }
  milestone() {
    this.tone(392, 0.35, "sine", 0.13);
    setTimeout(() => this.tone(523, 0.45, "sine", 0.13), 120);
  }
  fireBreath() {
    this.noise(1.6, 0.42, 1800);
    this.tone(65, 1.1, "sawtooth", 0.06, 32);
  }
  update(dt, speed, running, inAir) {
    if (!this.context || !this.windGain || this.context.state !== "running")
      return;
    this.attempt(() =>
      this.windGain.gain.setTargetAtTime(
        running ? 0.09 + speed * 0.005 : 0.045,
        this.context.currentTime,
        0.4,
      ),
    );
    this.stepTimer -= dt;
    if (running && !inAir && this.stepTimer <= 0) {
      this.step();
      this.stepTimer = 0.27 - Math.min(0.08, speed * 0.002);
    }
  }
}
