import { GRAVITY } from "./rules.js";

export const STRIDE_RATE = 9.8;
export const LANDING_STEP_DELAY = 0.14;
export const LANDING_RECOVERY = 0.65;
const TAU = Math.PI * 2;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (start, end, value) => {
  const t = clamp((value - start) / (end - start), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const impact = (age, duration) => age > 0 ? (age / duration) * Math.exp(1 - age / duration) : 0;
const legPose = () => ({ z: 0.15, pitch: 0, lift: 0 });
const blendLeg = (out, from, to, t) => {
  for (const key of ["z", "pitch", "lift"]) out[key] = mix(from[key], to[key], t);
};

// Stance travels steadily back under the hip. The swing keeps that velocity at
// both ends, folds the knee for clearance, then reaches forward for touchdown.
// A rotating hip alone describes an arc and makes the foot skate / calf stretch.
function runningLeg(leg, phase, span) {
  const p = ((phase % TAU) + TAU) % TAU;
  if (p < Math.PI) {
    const t = p / Math.PI;
    leg.z = span * (1 + 2 * t - 12 * t * t + 8 * t * t * t);
    leg.lift = Math.sin(t * Math.PI) ** 2 * 0.57;
    leg.pitch = -0.52 * (1 - smooth(0, 0.55, t)) + 0.18 * smooth(0.55, 1, t);
  } else {
    const t = p / Math.PI - 1;
    leg.z = mix(-span, span, t);
    leg.lift = 0;
    leg.pitch = 0.18 * (1 - smooth(0, 0.2, t)) - 0.52 * smooth(0.64, 1, t);
  }
}

// Two fixed length bones, with the knee always bending forward. Coordinates
// are in the dinosaur root, relative to the hip; no animated bone scaling.
export function solveLeg(hipHeight, ankleHeight, ankleZ, thighLength, calfLength, restAngle) {
  const maxReach = thighLength + calfLength - 0.001;
  const y = Math.min(hipHeight, ankleHeight + Math.sqrt(Math.max(0, maxReach ** 2 - ankleZ ** 2)));
  const dy = ankleHeight - y;
  const distance = Math.hypot(dy, ankleZ);
  const kneeAngle = Math.acos(clamp((thighLength ** 2 + distance ** 2 - calfLength ** 2) / (2 * thighLength * distance), -1, 1));
  const hip = Math.atan2(-ankleZ, -dy) + kneeAngle - restAngle;
  return { y, hip, footY: Math.cos(hip) * dy + Math.sin(hip) * ankleZ, footZ: -Math.sin(hip) * dy + Math.cos(hip) * ankleZ };
}

// Local clocks survive multiple physics steps in a single rendered frame.
// Jump physics remains immediate; the first 100 ms visibly pushes off before
// the legs fold, and each landing foot resumes its own continuous stride.
export class DinosaurGait {
  constructor() {
    this.initialized = false;
    this.airborne = false;
    this.previousHeight = 0;
    this.flightAge = 0;
    this.landingAge = Infinity;
    this.lead = 0;
    this.support = 0;
    this.phase = 0;
    this.rate = STRIDE_RATE;
    this.span = 0.62;
    this.takeoff = [legPose(), legPose()];
    this.previousLegPhases = [NaN, NaN];
    this.phaseOffsets = [0, 0];
    this.pose = {
      legs: [legPose(), legPose()], phase: 0, mode: "idle",
      bob: 0, drop: 0, pitch: 0, tailPitch: 0, riderPitch: 0,
      strideWeight: 0, contacts: 0, landingContacts: 0,
    };
  }

  update(time, run, height, dt, verticalVelocity, speed = 14) {
    const step = clamp(dt, 0, 0.25), pose = this.pose, fresh = !this.initialized;
    const rate = STRIDE_RATE * clamp((speed / 14) ** 0.35, 0.9, 1.35);
    const span = 0.62 * clamp((speed / 14) ** 0.2, 0.9, 1.12);
    this.rate = mix(this.rate, rate, fresh ? 1 : 1 - Math.exp(-step * 7));
    this.span = mix(this.span, span, fresh ? 1 : 1 - Math.exp(-step * 7));
    if (fresh) {
      this.initialized = true;
      this.phase = time * this.rate;
      pose.legs.forEach((leg, i) => runningLeg(leg, this.phase + i * Math.PI, this.span));
    }
    pose.contacts = pose.landingContacts = 0;
    const previousDrop = pose.drop;
    pose.drop = 0;
    pose.strideWeight = run ? 1 : 0;
    let bob = 0, pitch = 0;
    if (!run) {
      this.airborne = false;
      this.landingAge = Infinity;
      this.previousLegPhases.fill(NaN);
      this.phaseOffsets.fill(0);
      this.phase = time * this.rate;
      pose.mode = "idle";
      pose.legs.forEach((leg) => { leg.z = 0.15; leg.pitch = leg.lift = 0; });
    } else if (height > 0.00001 || verticalVelocity > 0) {
      if (!this.airborne) {
        this.airborne = true;
        this.flightAge = 0;
        this.landingAge = Infinity;
        this.support = pose.legs[0].lift <= pose.legs[1].lift ? 0 : 1;
        this.lead = 1 - this.support;
        pose.legs.forEach((leg, i) => Object.assign(this.takeoff[i], leg));
        this.launchBob = pose.bob - previousDrop;
        pose.bob = this.launchBob;
        this.previousLegPhases.fill(NaN);
      }
      this.flightAge += step;
      const velocity = Number.isFinite(verticalVelocity)
        ? verticalVelocity : (height - this.previousHeight) / Math.max(step, 0.001);
      const remaining = velocity < 0
        ? (velocity + Math.sqrt(velocity * velocity + 2 * GRAVITY * height)) / GRAVITY : Infinity;
      const reach = 1 - smooth(0, 0.2, remaining);
      const push = smooth(0, 0.1, this.flightAge);
      const tuck = smooth(0.08, 0.29, this.flightAge);
      pose.mode = this.flightAge < 0.1 ? "takeoff" : reach > 0 ? "reaching" : "airborne";
      pose.strideWeight = 1 - smooth(0, 0.15, this.flightAge);
      pose.legs.forEach((leg, i) => {
        const supporting = i === this.support, leading = i === this.lead;
        const extended = supporting
          ? { z: Math.min(0.7, this.takeoff[i].z + 0.16), pitch: -0.58, lift: 0.015 }
          : { z: mix(this.takeoff[i].z, -0.24, 0.45), pitch: -0.12, lift: mix(this.takeoff[i].lift, 0.64, 0.6) };
        blendLeg(leg, this.takeoff[i], extended, push);
        const folded = { z: leading ? -0.32 : -0.04, pitch: leading ? 0.13 : -0.12, lift: leading ? 0.72 : 0.82 };
        blendLeg(leg, leg, folded, tuck);
        const landing = leading
          ? { z: -this.span, pitch: 0.18, lift: 0 }
          : { z: 0.24, pitch: -0.38, lift: 0.34 };
        blendLeg(leg, leg, landing, reach);
      });
      bob = mix(this.launchBob, 0.025, smooth(0, 0.2, this.flightAge)) - 0.045 * impact(this.flightAge, 0.035);
      pitch = 0.095 * smooth(0, 0.14, this.flightAge) - 0.14 * smooth(-1, 9, -velocity);
    } else {
      const touchedDown = this.airborne;
      const before = this.landingAge;
      if (touchedDown) {
        this.airborne = false;
        this.landingAge = 0;
        this.phase = Math.PI - this.lead * Math.PI;
        this.phaseOffsets[0] = 0;
        this.phaseOffsets[1] = this.lead === 0 ? -TAU : 0;
        this.landingRate = this.rate;
        this.landingSpan = this.span;
      } else {
        if (Number.isFinite(this.landingAge)) this.landingAge += step;
        this.phase += fresh ? 0 : step * (Number.isFinite(this.landingAge) ? this.landingRate : this.rate);
      }
      const recovering = this.landingAge < LANDING_RECOVERY;
      const strideSpan = recovering ? this.landingSpan : this.span;
      pose.mode = recovering ? "landing" : "running";
      pose.legs.forEach((leg, i) => {
        const trailing = i !== this.lead;
        let phase = this.phase + i * Math.PI + this.phaseOffsets[i];
        if (recovering && trailing) {
          // The second foot takes a shorter first step. Let its next stance
          // linger rather than whipping the planted first leg backward.
          if (this.landingAge < LANDING_STEP_DELAY) {
            const t = this.landingAge / LANDING_STEP_DELAY;
            const blend = smooth(0, 1, t);
            leg.z = mix(0.24, -strideSpan, blend) + strideSpan * 2 / Math.PI * this.landingRate * LANDING_STEP_DELAY * (t ** 3 - t ** 2);
            leg.pitch = mix(-0.38, 0.18, blend);
            leg.lift = 0.34 * (1 - blend);
            return;
          }
          const correction = Math.PI - this.landingRate * LANDING_STEP_DELAY;
          // Use an unwrapped phase to keep contact detection continuous.
          phase += correction * (1 - smooth(LANDING_STEP_DELAY, LANDING_RECOVERY, this.landingAge));
        }
        runningLeg(leg, phase, strideSpan);
        const previous = this.previousLegPhases[i];
        if ((touchedDown && !trailing) || (recovering && trailing && before < LANDING_STEP_DELAY && this.landingAge >= LANDING_STEP_DELAY)) {
          pose.contacts |= 1 << i;
          pose.landingContacts |= 1 << i;
        } else if (Number.isFinite(previous) && Math.floor((phase - Math.PI) / TAU) > Math.floor((previous - Math.PI) / TAU)) {
          pose.contacts |= 1 << i;
        }
        this.previousLegPhases[i] = phase;
      });
      pose.strideWeight = recovering ? smooth(0.16, LANDING_RECOVERY, this.landingAge) : 1;
      if (recovering) {
        pose.drop = (0.16 * impact(this.landingAge, 0.065) + 0.045 * impact(this.landingAge - LANDING_STEP_DELAY, 0.055)) * (1 - smooth(0.36, LANDING_RECOVERY, this.landingAge));
        pitch = -pose.drop * 0.4;
      }
      bob = (-0.15 + Math.sin(this.phase) ** 2 * 0.06) * pose.strideWeight;
      pitch += Math.sin(this.phase * 2 - 0.4) * 0.018 * pose.strideWeight;
      if (this.landingAge >= LANDING_RECOVERY) this.landingAge = Infinity;
    }
    // Head, tail and rider react at different rates instead of moving as one
    // rigid assembly. Exponential response is stable at low/mobile frame rates.
    pose.bob = mix(pose.bob, bob, fresh ? 1 : 1 - Math.exp(-step * 24));
    pose.pitch = mix(pose.pitch, pitch, fresh ? 1 : 1 - Math.exp(-step * 18));
    pose.tailPitch = mix(pose.tailPitch, -pose.pitch * 0.7, 1 - Math.exp(-step * 9));
    pose.riderPitch = mix(pose.riderPitch, -pose.pitch * 0.7 - pose.drop * 0.35, 1 - Math.exp(-step * 11));
    this.previousHeight = height;
    pose.phase = this.phase;
    return pose;
  }
}
