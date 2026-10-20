import { GRAVITY } from "./rules.js";

export const STRIDE_RATE = 9.8;
export const LANDING_STEP_DELAY = 0.14;
export const LANDING_RECOVERY = 0.4;
const TAU = Math.PI * 2;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (start, end, value) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const pulse = (age, start, duration) => age > start && age < start + duration
  ? Math.sin((age - start) / duration * Math.PI) ** 2 : 0;
const legPose = () => ({ hip: 0, pitch: 0, lift: 0 });

function runningLeg(leg, phase) {
  const p = ((phase % TAU) + TAU) % TAU;
  leg.hip = -Math.cos(p) * 0.52;
  leg.lift = Math.max(0, Math.sin(p)) ** 1.5 * 0.46;
  if (p < Math.PI) {
    const swing = p / Math.PI;
    leg.pitch = -0.5 * (1 - smooth(0, 0.45, swing)) + 0.18 * smooth(0.45, 1, swing);
  } else {
    const stance = p / Math.PI - 1;
    leg.pitch = 0.18 * (1 - smooth(0, 0.22, stance)) - 0.5 * smooth(0.58, 1, stance);
  }
}

// A local animation clock keeps the same motion when a rendered frame contains
// several physics steps. Flight holds the stride; touchdown chooses its phase.
export class DinosaurGait {
  constructor() {
    this.initialized = false;
    this.airborne = false;
    this.previousHeight = 0;
    this.flightAge = 0;
    this.landingAge = Infinity;
    this.lead = 0;
    this.phase = 0;
    this.takeoff = [legPose(), legPose()];
    this.pose = {
      legs: [legPose(), legPose()], phase: 0, mode: "idle",
      drop: 0, pitch: 0, strideWeight: 0, contacts: 0, landingContacts: 0,
    };
  }

  update(time, run, height, dt, verticalVelocity) {
    const step = Math.max(0, Math.min(0.25, dt));
    const pose = this.pose;
    const fresh = !this.initialized;
    if (fresh) {
      this.initialized = true;
      this.phase = time * STRIDE_RATE;
      pose.legs.forEach((leg, i) => runningLeg(leg, this.phase + i * Math.PI));
    }
    pose.contacts = pose.landingContacts = 0;
    pose.drop = pose.pitch = 0;
    pose.strideWeight = run ? 1 : 0;
    if (!run) {
      this.airborne = false;
      this.landingAge = Infinity;
      this.phase = time * STRIDE_RATE;
      pose.mode = "idle";
      pose.legs.forEach((leg, i) => {
        leg.hip = Math.sin(time * 0.8 + i) * 0.015;
        leg.pitch = leg.lift = 0;
      });
    } else if (height > 0.00001 || verticalVelocity > 0) {
      if (!this.airborne) {
        this.airborne = true;
        this.flightAge = 0;
        this.landingAge = Infinity;
        this.lead = pose.legs[0].hip >= pose.legs[1].hip ? 0 : 1;
        pose.legs.forEach((leg, i) => Object.assign(this.takeoff[i], leg));
      }
      this.flightAge += step;
      const velocity = Number.isFinite(verticalVelocity)
        ? verticalVelocity : (height - this.previousHeight) / Math.max(step, 0.001);
      const remaining = velocity < 0
        ? (velocity + Math.sqrt(velocity * velocity + 2 * GRAVITY * height)) / GRAVITY : Infinity;
      const reach = 1 - smooth(0, 0.17, remaining);
      const tuck = smooth(0, 0.18, this.flightAge);
      pose.mode = reach > 0 ? "reaching" : "airborne";
      pose.strideWeight = 1 - tuck;
      pose.legs.forEach((leg, i) => {
        const leading = i === this.lead;
        leg.hip = mix(this.takeoff[i].hip, mix(0.65 + i * 0.12, leading ? 0.3 : -0.18, reach), tuck);
        leg.pitch = mix(this.takeoff[i].pitch, mix(leading ? 0.22 : 0.08, leading ? 0.18 : -0.35, reach), tuck);
        leg.lift = mix(this.takeoff[i].lift, mix(leading ? 0.52 : 0.64, leading ? 0 : 0.3, reach), tuck);
      });
    } else {
      const previousLandingAge = this.landingAge;
      const previousPhase = this.phase;
      if (this.airborne) {
        this.airborne = false;
        this.landingAge = 0;
        pose.contacts = pose.landingContacts = 1 << this.lead;
      } else if (Number.isFinite(this.landingAge)) this.landingAge += step;
      if (this.landingAge < LANDING_STEP_DELAY) {
        const transfer = smooth(0, LANDING_STEP_DELAY, this.landingAge);
        this.phase = (this.lead === 0 ? Math.PI : 0) + Math.PI * transfer;
        pose.legs.forEach((leg, i) => {
          const leading = i === this.lead;
          leg.hip = leading ? mix(0.3, -0.52, transfer) : mix(-0.18, 0.52, transfer);
          leg.pitch = leading
            ? 0.18 * (1 - smooth(0, 0.04, this.landingAge)) - 0.5 * smooth(0.065, LANDING_STEP_DELAY, this.landingAge)
            : mix(-0.35, 0.18, transfer);
          leg.lift = leading ? 0 : 0.3 * (1 - transfer);
        });
      } else {
        this.phase = Number.isFinite(this.landingAge)
          ? (this.lead === 0 ? TAU : Math.PI) + STRIDE_RATE * (this.landingAge - LANDING_STEP_DELAY)
          : this.phase + (fresh ? 0 : step * STRIDE_RATE);
        pose.legs.forEach((leg, i) => runningLeg(leg, this.phase + i * Math.PI));
        if (previousLandingAge < LANDING_STEP_DELAY) {
          pose.contacts = pose.landingContacts = 1 << (1 - this.lead);
        } else if (!fresh) {
          for (let i = 0; i < 2; i++) {
            const before = Math.floor((previousPhase + i * Math.PI - Math.PI) / TAU);
            const after = Math.floor((this.phase + i * Math.PI - Math.PI) / TAU);
            if (after > before) pose.contacts |= 1 << i;
          }
        }
      }
      pose.mode = this.landingAge < LANDING_RECOVERY ? "landing" : "running";
      if (Number.isFinite(this.landingAge)) {
        const first = pulse(this.landingAge, 0, 0.28);
        const second = pulse(this.landingAge, LANDING_STEP_DELAY, 0.24);
        pose.drop = first * 0.14 + second * 0.045;
        pose.pitch = first * 0.045 - second * 0.018;
        pose.strideWeight = smooth(LANDING_STEP_DELAY, LANDING_RECOVERY, this.landingAge);
        if (this.landingAge >= LANDING_RECOVERY) this.landingAge = Infinity;
      }
    }
    this.previousHeight = height;
    pose.phase = this.phase;
    return pose;
  }
}
