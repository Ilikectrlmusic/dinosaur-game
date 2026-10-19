import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./style.css";
import * as THREE from "three";
import { DesertWorld } from "./world.js";
import {
  buildDinosaur,
  animateDinosaur,
  buildCactus,
  buildPterosaur,
  makePortrait,
} from "./creatures.js";
import { GameAudio } from "./audio.js";
import { CrashPhysics } from "./physics.js";
import {
  CONFIG,
  JUMP_VELOCITY,
  BIRD_BOB,
  BIRD_SPEED_BONUS,
  advanceJump,
  overlapsRunner,
  speedAtTime,
  chooseObstacle,
  spawnDelay,
} from "./rules.js";
import { DragLook } from "./drag-look.js";
import { DeathOverlay } from "./death-overlay.js";
import { MobileInput } from "./mobile-input.js";

const $ = (id) => document.getElementById(id);
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem("saurian-preferences") || "{}");
} catch {
  /* Private browsing can disable storage. */
}
const state = {
  mode: "menu",
  rider: Math.min(2, Math.max(0, saved.rider || 0)),
  difficulty: CONFIG[saved.difficulty] ? saved.difficulty : "easy",
  view: saved.view === "first" ? "first" : "third",
  distance: 0,
  best: saved.best || {},
  speed: 0,
  x: 0,
  y: 0,
  vy: 0,
  duck: 0,
  ducking: false,
  time: 0,
  runTime: 0,
  spawn: 1.1,
  milestone: 0,
  motion:
    saved.motion ?? !matchMedia("(prefers-reduced-motion: reduce)").matches,
  quality: saved.quality || "high",
  sound: saved.sound !== false,
  volume: saved.volume ?? 0.55,
};
const audio = new GameAudio();
audio.setEnabled(state.sound);
audio.setVolume(state.volume);
let renderer,
  world,
  camera,
  dragLook,
  mobileInput,
  deathOverlay,
  pauseOverlay,
  dino,
  physics = null,
  obstacles = [],
  deathTimeout = null,
  raf = 0,
  toastTimeout,
  lastFrame = 0,
  crashAge = 0,
  roundGeneration = 0,
  crashIssue = null;
const targetCamera = new THREE.Vector3(),
  targetLook = new THREE.Vector3(),
  cameraLook = new THREE.Vector3(-3, 1.9, 1.5),
  headPos = new THREE.Vector3(),
  orbitPivot = new THREE.Vector3(),
  orbitOffset = new THREE.Vector3(),
  orbitSpherical = new THREE.Spherical(),
  upAxis = new THREE.Vector3(0, 1, 0),
  pitchAxis = new THREE.Vector3(),
  yawRotation = new THREE.Quaternion(),
  pitchRotation = new THREE.Quaternion(),
  lookEuler = new THREE.Euler(0, 0, 0, "YXZ"),
  riderScreen = new THREE.Vector3();
let previousStep = 0;
function releaseModel(root) {
  const geometries = new Set(),
    materials = new Set();
  root.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) {
      if (Array.isArray(o.material))
        o.material.forEach((m) => materials.add(m));
      else materials.add(o.material);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

function persist() {
  try {
    localStorage.setItem(
      "saurian-preferences",
      JSON.stringify({
        rider: state.rider,
        difficulty: state.difficulty,
        view: state.view,
        best: state.best,
        sound: state.sound,
        volume: state.volume,
        motion: state.motion,
        quality: state.quality,
      }),
    );
  } catch {
    /* Game remains playable without persistence. */
  }
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $("toast").classList.remove("visible"), 2100);
}
function updateSelection() {
  document.querySelectorAll("[data-rider]").forEach((b) => {
    const selected = Number(b.dataset.rider) === state.rider;
    b.classList.toggle("selected", selected);
    b.setAttribute("aria-pressed", selected);
  });
  document.querySelectorAll("[data-difficulty]").forEach((b) => {
    const selected = b.dataset.difficulty === state.difficulty;
    b.classList.toggle("selected", selected);
    b.setAttribute("aria-pressed", selected);
  });
  $("difficulty-description").textContent =
    CONFIG[state.difficulty].description;
  $("view-toggle").innerHTML =
    state.view === "third"
      ? "第三人称 <span>THIRD PERSON</span>"
      : "第一人称 <span>FIRST PERSON</span>";
  $("sound-toggle").classList.toggle("muted", !state.sound);
  $("sound-toggle").setAttribute(
    "aria-label",
    state.sound ? "关闭音效" : "开启音效",
  );
  $("audio-setting").checked = state.sound;
  $("volume-setting").value = state.volume * 100;
  $("quality-setting").value = state.quality;
  $("motion-setting").checked = state.motion;
}
function resetDino() {
  if (physics) {
    physics.dispose();
    physics = null;
  }
  if (dino) {
    world.scene.remove(dino.root);
    releaseModel(dino.root);
  }
  dino = buildDinosaur(state.rider);
  world.scene.add(dino.root);
  dino.root.position.set(0, 0, 0);
}
function toggleView() {
  dragLook.reset();
  state.view = state.view === "third" ? "first" : "third";
  updateSelection();
  persist();
  audio.click();
  toast(
    state.mode === "menu"
      ? state.view === "first"
        ? "出发后使用第一人称视角"
        : "出发后使用第三人称视角"
      : state.view === "first"
        ? "第一人称 · 透过骑手的双眼"
        : "第三人称 · 尽览荒野",
  );
}
function setSound(enabled) {
  state.sound = enabled;
  audio.setEnabled(enabled);
  if (enabled) audio.init();
  updateSelection();
  persist();
}
function pause() {
  if (state.mode !== "running") return;
  state.mode = "paused";
  resetInputs();
  audio.update(0, 0, false, false);
  pauseOverlay.open();
}
function resume() {
  if (state.mode !== "paused") return;
  pauseOverlay.close();
  state.mode = "running";
  audio.init();
  lastFrame = performance.now();
}
function resetInputs() {
  dragLook?.cancel();
  mobileInput?.reset();
  state.ducking = false;
}
function hasOpenDialog() {
  return (
    deathOverlay?.isOpen ||
    pauseOverlay?.isOpen ||
    !!document.querySelector("dialog[open]")
  );
}
function closeDialogs() {
  resetInputs();
  deathOverlay?.close();
  pauseOverlay?.close();
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
}
function clearObstacles() {
  obstacles.forEach((o) => world.scene.remove(o));
  obstacles = [];
}
function startGame() {
  clearTimeout(deathTimeout);
  roundGeneration++;
  crashIssue = null;
  closeDialogs();
  dragLook.reset();
  audio.init();
  audio.roar(0.12);
  resetDino();
  clearObstacles();
  Object.assign(state, {
    mode: "running",
    distance: 0,
    speed: CONFIG[state.difficulty].speed,
    x: 0,
    y: 0,
    vy: 0,
    duck: 0,
    ducking: false,
    runTime: 0,
    spawn: 1.25,
    milestone: 0,
  });
  document.body.classList.add("playing");
  document.body.classList.remove("dead");
  $("game-hud").classList.remove("hidden");
  $("game-tip").classList.remove("hidden");
  $("mobile-controls").classList.remove("hidden");
  $("hud-difficulty").textContent = CONFIG[state.difficulty].label;
  $("best").innerHTML =
    String(Math.floor(state.best[state.difficulty] || 0)).padStart(5, "0") +
    " <small>M</small>";
  updateHUD();
  persist();
  previousStep = 0;
}
function goHome() {
  clearTimeout(deathTimeout);
  roundGeneration++;
  crashIssue = null;
  closeDialogs();
  dragLook.reset();
  clearObstacles();
  resetDino();
  Object.assign(state, {
    mode: "menu",
    speed: 0,
    x: 0,
    y: 0,
    vy: 0,
    duck: 0,
    ducking: false,
  });
  document.body.classList.remove("playing", "dead");
  ["game-hud", "game-tip", "mobile-controls"].forEach((id) =>
    $(id).classList.add("hidden"),
  );
  dino.rider.root.visible = true;
  persist();
}
function jump() {
  if (state.mode !== "running" || state.y > 0.03) return;
  state.vy = JUMP_VELOCITY;
  state.ducking = false;
  audio.jump();
  world.emitDust(state.x, 0, 12);
}
function spawnObstacle(spec, z = -95) {
  const bird = spec.type === "bird";
  const object = bird ? buildPterosaur() : buildCactus(spec.height);
  object.userData = { ...object.userData, ...spec, passed: false };
  object.position.set(0, bird ? spec.flightHeight : 0, z);
  if (bird) object.rotation.y = Math.PI;
  world.scene.add(object);
  obstacles.push(object);
  return object;
}
function spawnWave() {
  spawnObstacle(chooseObstacle(state.distance));
  state.spawn = spawnDelay(state.difficulty, state.speed);
}
function updateHUD() {
  $("distance").innerHTML =
    String(Math.floor(state.distance)).padStart(5, "0") + "<small> M</small>";
  $("speed").textContent = Math.round(state.speed * 3.6);
}
function finishCrash(generation) {
  if (generation !== roundGeneration || state.mode !== "crashed") return;
  clearTimeout(deathTimeout);
  resetInputs();
  state.mode = "dead";
  audio.update(0, 0, false, false);
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  deathOverlay.open();
}
function crash(obstacle) {
  if (state.mode !== "running") return;
  state.mode = "crashed";
  resetInputs();
  crashAge = 0;
  const generation = roundGeneration;
  document.body.classList.add("dead");
  $("game-tip").classList.add("hidden");
  $("mobile-controls").classList.add("hidden");
  const isBest =
    Math.floor(state.distance) > (state.best[state.difficulty] || 0);
  if (isBest) state.best[state.difficulty] = Math.floor(state.distance);
  persist();
  $("final-distance").innerHTML =
    Math.floor(state.distance) + "<small> M</small>";
  $("final-best").innerHTML =
    (state.best[state.difficulty] || 0) + "<small> M</small>";
  $("new-best").classList.toggle("hidden", !isBest);
  $("death-reason").textContent =
    obstacle.userData.type === "bird"
      ? obstacle.userData.variant === "low"
        ? "低飞翼龙挡住了去路。它贴近地面，需要提前起跳越过。"
        : "高飞翼龙掠过骑手。它无法跳过，需要按住低头从下方穿过。"
      : "没能越过这片荆棘。下次接近仙人掌时，试着提前起跳。";
  // Register the transition first: optional animation/audio must never strand the UI.
  deathTimeout = setTimeout(() => finishCrash(generation), 2700);
  try {
    audio.hit();
    dino.root.updateMatrixWorld(true);
    physics = new CrashPhysics(
      world.scene,
      dino,
      state.speed,
      obstacle,
      (position, impact) => {
        world.emitDust(
          position.x,
          position.z,
          Math.min(25, Math.floor(impact * 2)),
        );
        audio.land();
      },
    );
    dino.root.visible = false;
  } catch (error) {
    crashIssue = error.message;
    console.warn(
      "Crash animation could not start; keeping result controls available.",
      error,
    );
    finishCrash(generation);
  }
}
function updateGameplay(dt) {
  state.runTime += dt;
  state.speed = speedAtTime(state.difficulty, state.runTime);
  state.distance += state.speed * dt;
  state.x = 0;
  if (state.y > 0 || state.vy > 0) {
    const jumpStep = advanceJump(state.y, state.vy, dt);
    state.y = jumpStep.y;
    state.vy = jumpStep.vy;
    if (jumpStep.landed) {
      audio.land();
      world.emitDust(state.x, 0, 15);
    }
  }
  state.duck = THREE.MathUtils.damp(
    state.duck,
    state.ducking && state.y < 0.15 ? 1 : 0,
    12,
    dt,
  );
  dino.root.position.set(state.x, state.y, 0);
  dino.root.rotation.z = THREE.MathUtils.damp(dino.root.rotation.z, 0, 8, dt);
  animateDinosaur(dino, state.time, 1, state.duck, state.y);
  state.spawn -= dt;
  if (state.spawn <= 0) spawnWave();
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obstacle = obstacles[i],
      bird = obstacle.userData.type === "bird";
    obstacle.position.z += (state.speed + (bird ? BIRD_SPEED_BONUS : 0)) * dt;
    if (bird) {
      obstacle.position.y =
        obstacle.userData.flightHeight + Math.sin(state.time * 2.2) * BIRD_BOB;
      obstacle.userData.wings.forEach(
        (w, j) =>
          (w.rotation.z = Math.sin(state.time * 6.5) * (j ? 1 : -1) * 0.43),
      );
      if (obstacle.position.z > -14 && obstacle.position.z < -13.5)
        audio.flap();
    }
    if (obstacle.position.z > 14) {
      world.scene.remove(obstacle);
      obstacles.splice(i, 1);
      continue;
    }
    const dx = Math.abs(obstacle.position.x - state.x),
      z = obstacle.position.z;
    if (
      overlapsRunner(state, {
        type: obstacle.userData.type,
        x: obstacle.position.x,
        y: obstacle.position.y,
        z,
        height: obstacle.userData.height,
      })
    ) {
      crash(obstacle);
      break;
    }
    if (z > 2 && !obstacle.userData.passed) {
      obstacle.userData.passed = true;
      if (dx < 1.5) toast(bird ? "漂亮的闪避！" : "完美越过！");
    }
  }
  const step = Math.floor(state.time * 3.1);
  if (step !== previousStep && state.y < 0.1) {
    world.emitDust(state.x + (step % 2 ? 0.5 : -0.5), 0.35, 4);
    previousStep = step;
  }
  const milestone = Math.floor(state.distance / 250);
  if (milestone > state.milestone) {
    state.milestone = milestone;
    audio.milestone();
    toast(`${milestone * 250} 米 · 荒野仍在延伸`);
  }
  if (state.runTime > 13) $("game-tip").classList.add("hidden");
  updateHUD();
}
function updateCamera(dt) {
  const mobile = innerWidth < 700;
  if (state.mode === "menu") {
    // The menu keeps the mount in the right side of a deliberately asymmetric composition.
    dino.rider.root.visible = true;
    if (mobile) {
      targetCamera.set(8.8, 5.1, 8.8);
      targetLook.set(0, 2.6, 0);
    } else {
      targetCamera.set(8.6, 4.7, 9.6);
      targetLook.set(-3, 1.9, 1.5);
    }
  } else if (physics) {
    const p = physics.centerBody.position;
    targetLook.set(p.x, Math.max(0.7, p.y), p.z);
    targetCamera.set(p.x + 7, Math.max(3.4, p.y + 2.5), p.z + 9);
  } else if (state.view === "first") {
    dino.rider.root.visible = false;
    dino.rider.head.getWorldPosition(headPos);
    const y = headPos.y + 0.03;
    const bob =
      state.motion && state.y < 0.1 ? Math.sin(state.time * 19.6) * 0.035 : 0;
    targetCamera.set(headPos.x, y + bob, headPos.z - 0.25);
    targetLook.set(state.x, y - 0.18, -36);
  } else {
    dino.rider.root.visible = true;
    const bob =
      state.motion && state.y < 0.1 ? Math.sin(state.time * 19.6) * 0.027 : 0;
    targetCamera.set(
      state.x * 0.6 + (mobile ? 4.5 : 6.4),
      4.6 + state.y * 0.45 + bob,
      9.8,
    );
    if (mobile) targetLook.set(0, 2.6 + state.y * 0.4, 0);
    else targetLook.set(0, 1.95 + state.y * 0.35, -5.5);
  }
  if (state.view === "first" && state.mode !== "menu" && !physics) {
    // The eye stays on the rider; dragging changes the direction of the gaze.
    lookEuler.set(-dragLook.pitch, dragLook.yaw, 0, "YXZ");
    orbitOffset.subVectors(targetLook, targetCamera).applyEuler(lookEuler);
    targetLook.copy(targetCamera).add(orbitOffset);
  } else {
    // Rotate the position and aim together around the mount, preserving framing.
    if (physics) orbitPivot.copy(physics.centerBody.position);
    else orbitPivot.set(0, (mobile ? 2.6 : 2.2) + state.y * 0.4, 0);
    orbitOffset.subVectors(targetCamera, orbitPivot);
    orbitSpherical.setFromVector3(orbitOffset);
    const angle = orbitSpherical.theta + dragLook.yaw;
    const pitch =
      THREE.MathUtils.clamp(orbitSpherical.phi - dragLook.pitch, 0.18, 1.45) -
      orbitSpherical.phi;
    yawRotation.setFromAxisAngle(upAxis, dragLook.yaw);
    pitchAxis.set(Math.cos(angle), 0, -Math.sin(angle));
    pitchRotation.setFromAxisAngle(pitchAxis, pitch).multiply(yawRotation);
    targetCamera.sub(orbitPivot).applyQuaternion(pitchRotation).add(orbitPivot);
    targetLook.sub(orbitPivot).applyQuaternion(pitchRotation).add(orbitPivot);
  }
  camera.position.lerp(
    targetCamera,
    1 - Math.exp(-dt * (state.mode === "menu" ? 2 : 5)),
  );
  cameraLook.lerp(targetLook, 1 - Math.exp(-dt * 6));
  camera.lookAt(cameraLook);
  if (crashAge > 0 && crashAge < 0.35 && state.motion) {
    camera.position.x += (Math.random() - 0.5) * 0.13 * (1 - crashAge / 0.35);
    camera.position.y += (Math.random() - 0.5) * 0.1;
  }
}
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000 || 0.016, 0.25);
  lastFrame = now;
  if (state.mode === "paused" || state.mode === "dead") {
    // Leave the last 3D frame behind the modal. No physics or GPU work competes
    // with the dialog's pointer events while the player chooses the next action.
    return;
  }
  state.time += dt;
  if (state.mode === "running") {
    let remaining = dt;
    while (remaining > 0 && state.mode === "running") {
      const step = Math.min(remaining, 1 / 60);
      updateGameplay(step);
      remaining -= step;
    }
  } else if (state.mode === "menu") {
    animateDinosaur(dino, state.time, 0, 0, 0);
  }
  if (physics) {
    crashAge += dt;
    try {
      physics.update(dt);
    } catch (error) {
      crashIssue = error.message;
      console.warn(
        "Crash simulation interrupted; showing the result controls.",
        error,
      );
      finishCrash(roundGeneration);
      return;
    }
  }
  if (state.mode === "dead") return;
  const speed = state.mode === "running" ? state.speed : 0;
  world.update(dt, state.time, speed);
  audio.update(dt, speed, state.mode === "running", state.y > 0.1);
  updateCamera(dt);
  renderer.render(world.scene, camera);
}
function bindUI() {
  document.querySelectorAll("[data-rider]").forEach((b) =>
    b.addEventListener("click", () => {
      state.rider = Number(b.dataset.rider);
      const oldRider = dino.rider.root;
      dino.setRider(state.rider);
      releaseModel(oldRider);
      updateSelection();
      persist();
      audio.click();
    }),
  );
  document.querySelectorAll("[data-difficulty]").forEach((b) =>
    b.addEventListener("click", () => {
      state.difficulty = b.dataset.difficulty;
      updateSelection();
      persist();
      audio.click();
    }),
  );
  $("start-button").addEventListener("click", startGame);
  $("retry-button").addEventListener("click", () => {
    if (deathOverlay.isOpen) startGame();
  });
  $("death-home").addEventListener("click", () => {
    if (deathOverlay.isOpen) goHome();
  });
  $("pause-home").addEventListener("click", goHome);
  $("pause-button").addEventListener("click", pause);
  $("resume-button").addEventListener("click", resume);
  $("view-toggle").addEventListener("click", toggleView);
  $("sound-toggle").addEventListener("click", () => setSound(!state.sound));
  $("fullscreen-toggle").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast("当前浏览器不支持全屏，请使用浏览器全屏功能");
    }
  });
  $("nav-play").addEventListener("click", () => {
    closeDialogs();
    audio.click();
  });
  $("nav-guide").addEventListener("click", () => {
    dragLook.cancel();
    $("guide-dialog").showModal();
    audio.click();
  });
  $("nav-settings").addEventListener("click", () => {
    dragLook.cancel();
    $("settings-dialog").showModal();
    audio.click();
  });
  document.querySelectorAll(".modal-close,.modal-close-action").forEach((b) =>
    b.addEventListener("click", () => {
      b.closest("dialog").close();
      audio.click();
    }),
  );
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) {
        const r = dialog.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          dialog.close();
      }
    });
  });
  $("audio-setting").addEventListener("change", (e) =>
    setSound(e.target.checked),
  );
  $("volume-setting").addEventListener("input", (e) => {
    state.volume = Number(e.target.value) / 100;
    audio.setVolume(state.volume);
    persist();
  });
  $("motion-setting").addEventListener("change", (e) => {
    state.motion = e.target.checked;
    persist();
  });
  $("quality-setting").addEventListener("change", (e) => {
    state.quality = e.target.value;
    applyQuality();
    persist();
  });
  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input,select")) return;
    const key = e.key.toLowerCase();
    if (state.mode === "running" && [" ", "arrowup", "arrowdown"].includes(key))
      e.preventDefault();
    if (hasOpenDialog()) {
      if (key === "r" && state.mode === "dead") {
        e.preventDefault();
        startGame();
      } else if (key === "escape" && state.mode === "dead") {
        e.preventDefault();
        goHome();
      } else if ((key === "escape" || key === "p") && state.mode === "paused") {
        e.preventDefault();
        resume();
      }
      return;
    }
    if (e.repeat) return;
    if (key === "v") toggleView();
    else if (key === "m") setSound(!state.sound);
    else if (key === "f") $("fullscreen-toggle").click();
    else if (key === "escape" || key === "p") {
      // Do not let the same Escape press immediately dismiss the new dialog.
      e.preventDefault();
      if (state.mode === "running") pause();
      else if (state.mode === "paused") resume();
    } else if (
      key === "r" &&
      ["running", "dead", "crashed"].includes(state.mode)
    )
      startGame();
    else if (key === " " || key === "arrowup" || key === "w") jump();
    else if (key === "arrowdown" || key === "s") state.ducking = true;
  });
  window.addEventListener("keyup", (e) => {
    if (["arrowdown", "s"].includes(e.key.toLowerCase())) state.ducking = false;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      resetInputs();
      if (state.mode === "crashed") finishCrash(roundGeneration);
      else pause();
    }
  });
  mobileInput = new MobileInput($("mobile-controls"), {
    canUse: () => state.mode === "running" && !hasOpenDialog(),
    onJump: jump,
    onDuck: (held) => {
      state.ducking = held;
    },
  });
  document.addEventListener("pointerdown", () => audio.init(), { once: true });
}
function applyQuality() {
  renderer.setPixelRatio(
    Math.min(devicePixelRatio, state.quality === "high" ? 1.65 : 1),
  );
  renderer.shadowMap.enabled = state.quality === "high";
  world.sun.castShadow = state.quality === "high";
  renderer.setSize(innerWidth, innerHeight);
}
function init() {
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setClearColor("#b6ac91");
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    $("scene").appendChild(renderer.domElement);
    dragLook = new DragLook(renderer.domElement, {
      canDrag: () =>
        ["menu", "running", "crashed"].includes(state.mode) && !hasOpenDialog(),
      onReset: () => toast("视角已回正"),
    });
    camera = new THREE.PerspectiveCamera(
      innerWidth < 700 ? 53 : 45,
      innerWidth / innerHeight,
      0.08,
      800,
    );
    camera.position.set(8.6, 4.7, 9.6);
    camera.lookAt(-3, 1.9, 1.5);
    world = new DesertWorld(renderer);
    resetDino();
    applyQuality();
    updateSelection();
    deathOverlay = new DeathOverlay($("death-overlay"));
    pauseOverlay = new DeathOverlay($("pause-overlay"));
    bindUI();
    for (let i = 0; i < 3; i++) {
      document.querySelector(`.portrait-${i}`).style.backgroundImage =
        `url(${makePortrait(i)})`;
    }
    window.addEventListener("resize", () => {
      camera.aspect = innerWidth / innerHeight;
      camera.fov = innerWidth < 700 ? 53 : 45;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      if (["paused", "dead"].includes(state.mode))
        renderer.render(world.scene, camera);
    });
    lastFrame = performance.now();
    requestAnimationFrame(frame);
    requestAnimationFrame(() => {
      $("loading").style.opacity = "0";
      setTimeout(() => $("loading").remove(), 750);
    });
    // A small read-only diagnostic surface supports automated functional validation.
    Object.defineProperty(window, "__saurian", {
      value: {
        get state() {
          return {
            mode: state.mode,
            rider: state.rider,
            difficulty: state.difficulty,
            view: state.view,
            distance: state.distance,
            speed: state.speed,
            runTime: state.runTime,
            y: state.y,
            duck: state.duck,
            x: state.x,
            sound: state.sound,
            obstacles: obstacles.map((o) => ({
              type: o.userData.type,
              variant: o.userData.variant,
              x: o.position.x,
              y: o.position.y,
              z: o.position.z,
              height: o.userData.height,
            })),
            camera: {
              position: camera.position.toArray(),
              rotation: camera.rotation.toArray(),
              target: cameraLook.toArray(),
            },
            physicsBodies: physics?.world.bodies.length || 0,
            crashIssue,
            riderScreen: dino.rider.pelvis
              .getWorldPosition(riderScreen)
              .project(camera)
              .toArray(),
          };
        },
        get renderer() {
          return renderer.info;
        },
      },
    });
  } catch (error) {
    console.error(error);
    $("loading")?.remove();
    const fallback = document.createElement("div");
    fallback.className = "fallback-message";
    fallback.innerHTML =
      '<div><h1>THE WILD<br/>IS WAITING.</h1><p>当前设备无法初始化 3D 画面。请启用浏览器的硬件加速，或使用支持 WebGL 2 的新版 Chrome、Edge 或 Safari。</p><button class="start-button" onclick="location.reload()">重新尝试 →</button></div>';
    document.body.appendChild(fallback);
  }
}
init();
