import * as THREE from "three";

export const DUST_CAPACITY = 144;
export const TRACK_CAPACITY = 64;
const profiles = {
  run: { count: 4, size: 0.16, growth: 0.30, life: 0.48, alpha: 0.16, lift: 0.30 },
  takeoff: { count: 9, size: 0.22, growth: 0.48, life: 0.62, alpha: 0.18, lift: 0.45 },
  landing: { count: 12, size: 0.25, growth: 0.55, life: 0.72, alpha: 0.20, lift: 0.55 },
  crash: { count: 16, size: 0.27, growth: 0.62, life: 0.78, alpha: 0.20, lift: 0.65 },
};
const smooth = (a, b, v) => THREE.MathUtils.smoothstep(v, a, b);

function footprintTexture() {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  const oval = (x, y, cx, cy, rx, ry, angle = 0) => {
    const dx = x - cx, dy = y - cy, c = Math.cos(angle), s = Math.sin(angle);
    return Math.exp(-2.5 * (((dx * c + dy * s) / rx) ** 2 + ((dy * c - dx * s) / ry) ** 2));
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), i = (y * size + x) * 4;
    let mask = oval(u, v, 0.5, 0.30, 0.24, 0.24);
    for (let toe = -1; toe <= 1; toe++)
      mask = Math.max(mask, oval(u, v, 0.5 + toe * 0.20, toe ? 0.61 : 0.68, 0.095, 0.35, -toe * 0.38));
    const grain = 0.82 + Math.sin(x * 3.1 + y * 1.7) * Math.cos(y * 2.3) * 0.18;
    pixels.set([255, 255, 255, Math.round(mask * grain * 255)], i);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function fadingInstances(geometry, texture, count, color) {
  const material = new THREE.MeshBasicMaterial({ map: texture, color, transparent: true, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = "attribute float contactOpacity; varying float vContactOpacity;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvContactOpacity=contactOpacity;");
    shader.fragmentShader = "varying float vContactOpacity;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a*=vContactOpacity;");
  };
  material.customProgramCacheKey = () => "ground-contact-opacity-v1";
  const mesh = new THREE.InstancedMesh(geometry.clone(), material, count);
  mesh.geometry.setAttribute("contactOpacity", new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

// Contact events, rather than a frame-rate-based emitter, drive all effects.
// A private RNG and fixed pools keep cosmetics independent of obstacle rules.
export class GroundEffects {
  constructor(scene, groundHeightAt, shadowTexture = null) {
    this.groundHeightAt = groundHeightAt;
    this.seed = 0x7a4d219;
    this.temp = new THREE.Object3D();
    this.anchor = new THREE.Vector3();
    this.positions = new Float32Array(DUST_CAPACITY * 3);
    this.sizes = new Float32Array(DUST_CAPACITY);
    this.alphas = new Float32Array(DUST_CAPACITY);
    this.particles = Array.from({ length: DUST_CAPACITY }, () => ({ age: Infinity }));
    this.tracks = Array.from({ length: TRACK_CAPACITY }, () => ({ age: Infinity }));
    const geometry = new THREE.BufferGeometry();
    for (const [name, data, size] of [["position", this.positions, 3], ["size", this.sizes, 1], ["alpha", this.alphas, 1]])
      geometry.setAttribute(name, new THREE.BufferAttribute(data, size).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("phase", new THREE.BufferAttribute(Float32Array.from({ length: DUST_CAPACITY }, () => this.random() * 30), 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        color: { value: new THREE.Color("#c1a585") }, pointScale: { value: 700 }, time: { value: 0 },
      }]),
      vertexShader: `attribute float size; attribute float alpha; attribute float phase;
        uniform float pointScale; varying float vAlpha; varying float vPhase;
        #include <fog_pars_vertex>
        void main(){vec4 mvPosition=modelViewMatrix*vec4(position,1.);vAlpha=alpha;vPhase=phase;
          gl_PointSize=clamp(size*pointScale/max(.1,-mvPosition.z),0.,96.);
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 color; uniform float time; varying float vAlpha; varying float vPhase;
        #include <fog_pars_fragment>
        void main(){vec2 p=gl_PointCoord*2.-1.;float angle=atan(p.y,p.x);
          float radius=length(p)+.06*sin(angle*5.+vPhase+time*1.7);
          float cloud=exp(-radius*radius*3.5)*(1.-smoothstep(.65,1.,radius));
          float grain=.87+.13*sin(p.x*11.+vPhase)*sin(p.y*9.-time);
          float opacity=cloud*grain*vAlpha;if(opacity<.002)discard;
          gl_FragColor=vec4(color,opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.footprints = fadingInstances(plane, footprintTexture(), TRACK_CAPACITY, "#67503a");
    this.footShadows = fadingInstances(plane, shadowTexture, 2, "#ffffff");
    plane.dispose();
    scene.add(this.points, this.footprints, this.footShadows);
    this.reset();
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  reset() {
    this.cursor = this.trackCursor = this.alive = this.tracksAlive = 0;
    this.emissions = { run: 0, takeoff: 0, landing: 0, crash: 0 };
    this.lastImpact = null;
    this.particles.forEach((p) => { p.age = Infinity; });
    this.tracks.forEach((p) => { p.age = Infinity; });
    this.sizes.fill(0); this.alphas.fill(0);
    this.points.visible = this.footprints.visible = this.footShadows.visible = false;
    for (const mesh of [this.footprints, this.footShadows]) {
      mesh.geometry.attributes.contactOpacity.array.fill(0);
      mesh.geometry.attributes.contactOpacity.needsUpdate = true;
    }
  }

  emit(x, z, kind = "run", strength = 1, sizeScale = 1, yaw = 0) {
    const profile = profiles[kind], force = THREE.MathUtils.clamp(strength, 0.4, 1.3);
    const y = this.groundHeightAt(x, z);
    this.emissions[kind]++;
    this.lastImpact = { kind, x, y, z };
    for (let j = 0; j < Math.round(profile.count * force); j++) {
      const p = this.particles[this.cursor];
      // A few heavier grains settle quickly; most particles are fine dust.
      const grain = kind !== "run" && j % 5 === 0;
      Object.assign(p, { x: x + (this.random() - 0.5) * 0.24 * sizeScale,
        y: y + 0.035, z: z + (this.random() - 0.5) * 0.25 * sizeScale,
        vx: (this.random() - 0.5) * (kind === "run" ? 0.45 : 0.9),
        vy: (grain ? 0.9 : profile.lift) * (0.65 + this.random() * 0.55),
        vz: 0.2 + this.random() * (kind === "takeoff" ? 0.9 : 0.45),
        age: 0, life: profile.life * (0.85 + this.random() * 0.3), grain,
        size: (grain ? 0.035 : profile.size) * sizeScale,
        growth: grain ? 0 : profile.growth * sizeScale,
        alpha: profile.alpha * force,
      });
      this.writeParticle(p, this.cursor);
      this.cursor = (this.cursor + 1) % DUST_CAPACITY;
    }
    this.points.visible = true;
    if (kind !== "crash") {
      const track = this.tracks[this.trackCursor];
      Object.assign(track, { x, z, yaw, sizeScale, age: 0, life: 7,
        alpha: (kind === "run" ? 0.15 : 0.20) * force });
      this.writeTrack(track, this.trackCursor);
      this.trackCursor = (this.trackCursor + 1) % TRACK_CAPACITY;
      this.footprints.visible = true;
    }
    this.dirty();
  }

  writeParticle(p, i) {
    const t = p.age / p.life;
    this.positions[i * 3] = p.x; this.positions[i * 3 + 1] = p.y; this.positions[i * 3 + 2] = p.z;
    this.sizes[i] = p.size + p.growth * t;
    this.alphas[i] = p.alpha * smooth(0, 0.055, p.age) * (1 - smooth(0.12, 1, t));
  }

  writeTrack(track, i) {
    this.temp.position.set(track.x, this.groundHeightAt(track.x, track.z) + 0.017, track.z);
    this.temp.rotation.set(0, track.yaw, 0);
    this.temp.scale.set(0.60 * track.sizeScale, 1, 0.88 * track.sizeScale);
    this.temp.updateMatrix(); this.footprints.setMatrixAt(i, this.temp.matrix);
    this.footprints.geometry.attributes.contactOpacity.array[i] = track.alpha * smooth(0, 0.08, track.age) * (1 - smooth(2, track.life, track.age));
  }

  update(dt, speed = 0) {
    if (dt <= 0 || (!this.points.visible && !this.footprints.visible)) return;
    const travel = speed * dt, drag = Math.exp(-dt * 2);
    this.alive = this.tracksAlive = 0;
    for (const [i, p] of this.particles.entries()) {
      p.age += dt;
      if (p.age >= p.life || !Number.isFinite(p.age) || p.z > 70) { this.alphas[i] = this.sizes[i] = 0; continue; }
      this.alive++;
      p.x += 0.13 * dt + (p.vx - 0.13) * (1 - drag) / 2;
      p.vx = 0.13 + (p.vx - 0.13) * drag;
      p.z += travel + p.vz * (1 - drag) / 2; p.vz *= drag;
      const gravity = p.grain ? 3.6 : 0.18;
      p.y += p.vy * dt - gravity * dt * dt / 2; p.vy -= gravity * dt;
      p.y = Math.max(p.y, this.groundHeightAt(p.x, p.z) + 0.025);
      this.writeParticle(p, i);
    }
    for (const [i, track] of this.tracks.entries()) {
      track.age += dt;
      if (track.age >= track.life || !Number.isFinite(track.age) || track.z > 70) {
        this.footprints.geometry.attributes.contactOpacity.array[i] = 0;
        continue;
      }
      this.tracksAlive++;
      track.z += travel;
      this.writeTrack(track, i);
    }
    this.points.material.uniforms.time.value += dt;
    this.points.visible = this.alive > 0;
    this.footprints.visible = this.tracksAlive > 0;
    this.dirty();
  }

  followFeet(dino, quality = "high") {
    this.footShadows.visible = !!dino;
    if (!dino) return;
    dino.legs.forEach((leg, i) => {
      leg.foot.localToWorld(this.anchor.set(0, 0, -0.15));
      const lift = Math.max(0, dino.root.position.y + dino.gait.pose.legs[i].lift * dino.sizeScale);
      this.temp.position.set(this.anchor.x, this.groundHeightAt(this.anchor.x, this.anchor.z) + 0.015, this.anchor.z);
      this.temp.rotation.set(0, dino.root.rotation.y, 0);
      this.temp.scale.set((0.55 + lift * 0.1) * dino.sizeScale, 1, (1.05 + lift * 0.2) * dino.sizeScale);
      this.temp.updateMatrix(); this.footShadows.setMatrixAt(i, this.temp.matrix);
      this.footShadows.geometry.attributes.contactOpacity.array[i] = (quality === "high" ? 0.23 : 0.30) * Math.exp(-lift * 10);
    });
    this.footShadows.instanceMatrix.needsUpdate = true;
    this.footShadows.geometry.attributes.contactOpacity.needsUpdate = true;
  }

  setViewport(height, fov) {
    this.points.material.uniforms.pointScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
  }

  dirty() {
    for (const name of ["position", "size", "alpha"]) this.points.geometry.attributes[name].needsUpdate = true;
    this.footprints.instanceMatrix.needsUpdate = true;
    this.footprints.geometry.attributes.contactOpacity.needsUpdate = true;
  }
}
