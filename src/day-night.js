import * as THREE from "three";

export const DAY_NIGHT_SECONDS = 180;
export const START_DAY_PHASE = 0.38;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

// One continuous astronomical clock drives the sky, lights and rider. Sampling
// an absolute time keeps the cycle identical at 30, 60 and 120 frames per second.
export function sampleDayNight(seconds, out = {}) {
  const phase = ((seconds / DAY_NIGHT_SECONDS + START_DAY_PHASE) % 1 + 1) % 1;
  const angle = phase * Math.PI * 2 - Math.PI / 2;
  const x = -Math.cos(angle), y = Math.sin(angle) * 0.82, z = -0.45;
  const length = Math.hypot(x, y, z), elevation = y / length;
  out.phase = phase;
  out.sunX = x / length; out.sunY = elevation; out.sunZ = z / length;
  out.rising = Math.cos(angle) > 0;
  out.daylight = smooth(-0.12, 0.2, elevation);
  out.solar = smooth(-0.055, 0.2, elevation);
  out.night = 1 - smooth(-0.22, 0.015, elevation);
  out.twilight = Math.exp(-(((elevation + 0.015) / 0.22) ** 2));
  out.torch = 1 - smooth(-0.1, 0.13, elevation);
  out.temperature = Math.round(18 + 14 * smooth(-0.05, 0.7, elevation));
  if (elevation < -0.22) { out.stage = "night"; out.label = "MOONLIT NIGHT"; out.chinese = "月夜"; }
  else if (elevation < -0.055) { out.stage = "blue-hour"; out.label = "BLUE HOUR"; out.chinese = "蓝调时刻"; }
  else if (elevation < 0.2) {
    out.stage = out.rising ? "sunrise" : "sunset";
    out.label = out.rising ? "SUNRISE" : "SUNSET";
    out.chinese = out.rising ? "朝阳" : "夕阳";
  } else if (elevation < 0.48) { out.stage = "golden-hour"; out.label = "GOLDEN HOUR"; out.chinese = "金色时刻"; }
  else { out.stage = "day"; out.label = "DAYLIGHT"; out.chinese = "白昼"; }
  return out;
}

export class DayNightLighting {
  constructor(world, renderer) {
    this.world = world; this.renderer = renderer; this.time = NaN; this.state = {};
    this.palette = Object.fromEntries(Object.entries({
      zenithDay: "#609fc7", zenithNight: "#071126", zenithDusk: "#384d75",
      horizonDay: "#e2d8be", horizonNight: "#19283e", horizonDusk: "#ed9970", horizonDawn: "#eab29b",
      fogDay: "#cfb99d", fogNight: "#17243a", fogDusk: "#ae7e77",
      skyDay: "#d8e4ed", skyNight: "#8198ba", groundDay: "#897054", groundNight: "#40516e",
      sunDay: "#fff0d3", sunDusk: "#ff9146", fillDay: "#c6dce5", fillNight: "#597aa8",
      cloudDay: "#fff3da", cloudNight: "#34435e", cloudDusk: "#edaa8a",
      ridgeNight: "#18263b", dustDay: "#e8d4aa", dustNight: "#756c62", impactNight: "#9d805f", impactDay: "#c1a585",
      stemDay: "#736c49", stemNight: "#1b2638", moon: "#a6c3f4",
    }).map(([key, color]) => [key, new THREE.Color(color)]));
    this.ridges = (world.ridgeMaterials || []).map((material) => ({ material, day: material.color.clone() }));
    this.details = new Map();
    this.register(world.scene);
    this.update(0);
  }

  register(root) {
    root.traverse((object) => {
      const material = object.material;
      if (!material?.isLineBasicMaterial || this.details.has(material)) return;
      const day = material.color.clone();
      this.details.set(material, day);
      material.addEventListener("dispose", () => this.details.delete(material));
      material.color.copy(day).multiplyScalar(0.14 + (this.state.daylight ?? 1) * 0.86);
    });
  }

  update(time) {
    if (this.time === time) return this.state;
    this.time = time;
    const state = sampleDayNight(time, this.state), p = this.palette, w = this.world;
    w.sky.material.uniforms.time.value = time;
    // The astronomical clock is continuous; slow atmospheric color changes
    // need only 30 updates per second, independently of the animation frame rate.
    if (Math.abs(time - this.lightingTime) < 1 / 30) return state;
    this.lightingTime = time;
    const { daylight, twilight, night } = state;
    const sky = w.sky.material.uniforms;
    sky.zenith.value.lerpColors(p.zenithNight, p.zenithDay, daylight).lerp(p.zenithDusk, twilight * 0.55);
    sky.horizon.value.lerpColors(p.horizonNight, p.horizonDay, daylight)
      .lerp(state.rising ? p.horizonDawn : p.horizonDusk, twilight * 0.86);
    sky.sunDirection.value.set(state.sunX, state.sunY, state.sunZ);
    sky.moonDirection.value.copy(sky.sunDirection.value).negate();
    sky.sunColor.value.lerpColors(p.sunDusk, p.sunDay, smooth(0.05, 0.7, state.sunY));
    sky.sunVisibility.value = smooth(-0.13, -0.01, state.sunY);
    sky.night.value = night; sky.twilight.value = twilight;
    sky.time.value = time; sky.rotation.value = state.phase * Math.PI * 2;
    w.scene.fog.color.lerpColors(p.fogNight, p.fogDay, daylight).lerp(p.fogDusk, twilight * 0.48);
    w.scene.fog.density = 0.0036 + night * 0.0018;
    w.hemi.color.lerpColors(p.skyNight, p.skyDay, daylight);
    w.hemi.groundColor.lerpColors(p.groundNight, p.groundDay, daylight);
    w.hemi.intensity = 0.7 + daylight * 0.5;
    // Reuse the key light for moonlight. It fades out at the horizon before
    // changing sides, without adding another directional-light shader loop.
    this.solarIntensity = state.solar * (2.1 + smooth(0.1, 0.75, state.sunY) * 1.2);
    this.moonIntensity = (1 - smooth(-0.22, -0.055, state.sunY)) * 0.6;
    w.sun.position.copy(state.sunY < -0.055 ? sky.moonDirection.value : sky.sunDirection.value).multiplyScalar(70);
    w.sun.color.copy(state.sunY < -0.055 ? p.moon : sky.sunColor.value);
    w.sun.intensity = this.solarIntensity + this.moonIntensity;
    w.sun.shadow.intensity = state.solar;
    w.sun.castShadow = w.quality === "high" && this.solarIntensity > 0.001;
    w.fill.color.lerpColors(p.fillNight, p.fillDay, daylight);
    w.fill.intensity = 0.16 + daylight * 0.54;
    w.scene.environmentIntensity = 0.025 + daylight * 0.375;
    this.renderer.toneMappingExposure = 1.05 + night * 0.15;
    w.cloudMaterial.color.lerpColors(p.cloudNight, p.cloudDay, daylight).lerp(p.cloudDusk, twilight * 0.65);
    w.cloudMaterial.opacity = 0.2 + daylight * 0.45;
    for (const { material, day } of this.ridges)
      material.color.lerpColors(p.ridgeNight, day, daylight).lerp(p.fogDusk, twilight * 0.3);
    for (const [material, day] of this.details) material.color.copy(day).multiplyScalar(0.14 + daylight * 0.86);
    w.dust.material.color.lerpColors(p.dustNight, p.dustDay, daylight);
    w.dust.material.opacity = 0.06 + daylight * 0.39;
    w.stemMaterial.color.lerpColors(p.stemNight, p.stemDay, daylight);
    w.groundEffects.points.material.uniforms.color.value.lerpColors(p.impactNight, p.impactDay, daylight);
    return state;
  }
}
