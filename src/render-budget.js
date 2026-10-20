// Adjust only the 3D framebuffer, leaving the HUD/text at native CSS resolution.
// Sustained load matters; a single shader compilation, pause or tab switch must
// not make the picture repeatedly change resolution.
export class RenderBudget {
  constructor() { this.reset(1, 0.8); }

  reset(maxRatio, minRatio) {
    this.maxRatio = maxRatio;
    this.minRatio = Math.min(maxRatio, minRatio);
    this.ratio = maxRatio;
    this.fps = 60;
    this.resetTiming();
  }

  resetTiming() {
    this.warmup = 1.8;
    this.elapsed = this.frames = this.frameTotal = this.fastTime = 0;
    this.cooldown = 0;
  }

  sample(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return false;
    const dt = Math.min(seconds, 0.25);
    this.warmup -= dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.warmup > 0) return false;
    this.elapsed += dt;
    // Cap the contribution of an isolated long frame while still responding
    // to devices that consistently cannot render fast enough.
    this.frameTotal += Math.min(dt, 0.1);
    this.frames++;
    if (this.elapsed < 1.2 || this.frames < 6) return false;
    const mean = this.frameTotal / this.frames, elapsed = this.elapsed;
    this.fps = Math.round(1 / mean);
    this.elapsed = this.frames = this.frameTotal = 0;
    const before = this.ratio;
    if (mean > 1 / 50) {
      this.fastTime = 0;
      if (this.cooldown === 0) {
        this.ratio = Math.max(this.minRatio, this.ratio * 0.86);
        this.cooldown = 1.2;
      }
    } else if (mean < 1 / 58) {
      this.fastTime += elapsed;
      if (this.fastTime >= 6 && this.cooldown === 0) {
        this.ratio = Math.min(this.maxRatio, this.ratio + 0.06);
        this.fastTime = 0;
        this.cooldown = 4;
      }
    } else this.fastTime = 0;
    return Math.abs(this.ratio - before) > 0.001;
  }
}
