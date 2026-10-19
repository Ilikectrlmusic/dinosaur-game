import * as THREE from "three";

export const FIRE_DURATION = 1.6;
const CAPACITY = 160;

// World-space embers leave the moving mouth naturally. All particle buffers
// are reused, and the cosmetic RNG is independent of obstacle generation.
export class FireBreath {
  constructor(scene) {
    this.seed = 0x15ab31;
    this.origin = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.positions = new Float32Array(CAPACITY * 3);
    this.sizes = new Float32Array(CAPACITY);
    this.alphas = new Float32Array(CAPACITY);
    const phases = Float32Array.from({ length: CAPACITY }, () => this.random() * 100);
    this.particles = Array.from({ length: CAPACITY }, () => ({
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: Infinity, life: 1,
    }));
    const geometry = new THREE.BufferGeometry();
    for (const [name, array, size] of [["position", this.positions, 3], ["size", this.sizes, 1], ["alpha", this.alphas, 1]])
      geometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { pointScale: { value: 700 }, viewScale: { value: 1 }, opacityScale: { value: 0.85 }, time: { value: 0 } },
      vertexShader: `attribute float size; attribute float alpha; attribute float phase;
        uniform float pointScale; uniform float viewScale; varying float vAlpha; varying float vPhase;
        void main(){vec4 view=modelViewMatrix*vec4(position,1.);vAlpha=alpha;vPhase=phase;
          gl_PointSize=clamp(size*pointScale*viewScale/max(.1,-view.z),0.,150.);
          gl_Position=projectionMatrix*view;}`,
      fragmentShader: `uniform float time; uniform float opacityScale; varying float vAlpha; varying float vPhase;
        void main(){vec2 p=gl_PointCoord*2.-1.;float angle=atan(p.y,p.x);
          float ripple=.07*sin(angle*5.+vPhase+time*14.)+.04*sin(angle*9.-time*19.);
          float radius=length(p)+ripple;
          float glow=pow(max(0.,1.-radius),1.5);
          float core=1.-smoothstep(0.,.6,radius);
          vec3 color=mix(vec3(2.2,.2,.01),vec3(2.7,1.5,.25),core);
          gl_FragColor=vec4(color,glow*vAlpha*opacityScale);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    // Keep this light registered at zero intensity between bursts so the
    // milestone never forces every landscape material to recompile mid-run.
    this.light = new THREE.PointLight("#ff8b35", 0, 12, 2);
    scene.add(this.light);
    this.reset();
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  get strength() {
    return this.elapsed < FIRE_DURATION
      ? Math.min(1, this.elapsed / 0.12, (FIRE_DURATION - this.elapsed) / 0.3)
      : 0;
  }

  get active() { return this.elapsed < FIRE_DURATION || this.alive > 0; }

  start() { this.elapsed = 0; this.bursts++; this.emission = 0; }

  stop() {
    this.elapsed = Infinity; this.alive = 0; this.emission = 0;
    this.particles.forEach((particle) => { particle.age = Infinity; });
    this.alphas.fill(0); this.sizes.fill(0);
    this.points.visible = false; this.light.intensity = 0;
  }

  reset() { this.stop(); this.bursts = 0; }

  setViewport(height, fov, firstPerson = false) {
    this.points.material.uniforms.pointScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    this.points.material.uniforms.viewScale.value = firstPerson ? 0.65 : 1;
    this.points.material.uniforms.opacityScale.value = firstPerson ? 0.5 : 0.85;
  }

  update(dt, head, speed = 0) {
    if (!this.active) return;
    this.elapsed += dt;
    head.getWorldQuaternion(this.rotation);
    this.origin.set(0, -0.24, -1.12);
    head.localToWorld(this.origin);
    this.direction.set(0, 0.03, -1).applyQuaternion(this.rotation).normalize();
    const strength = this.strength;
    this.emission += dt * 145 * strength;
    let spawn = Math.floor(this.emission);
    this.emission -= spawn;
    this.alive = 0;
    for (let i = 0; i < CAPACITY; i++) {
      const particle = this.particles[i];
      let emitted = false;
      particle.age += dt;
      if (particle.age >= particle.life && spawn > 0) {
        particle.age = 0; particle.life = 0.38 + this.random() * 0.24;
        particle.position.copy(this.origin);
        particle.velocity.copy(this.direction).multiplyScalar(12 + this.random() * 5);
        particle.velocity.x += (this.random() - 0.5) * 2;
        particle.velocity.y += (this.random() - 0.5) * 1.4;
        spawn--;
        emitted = true;
      }
      if (particle.age >= particle.life) { this.alphas[i] = this.sizes[i] = 0; continue; }
      this.alive++;
      particle.velocity.y += dt * 2.4;
      if (!emitted) {
        particle.position.addScaledVector(particle.velocity, dt);
        particle.position.z += speed * dt * 0.035;
      }
      const age = particle.age / particle.life;
      this.sizes[i] = 0.18 + age * 1.55;
      this.alphas[i] = (1 - age) ** 1.4 * 0.86;
      particle.position.toArray(this.positions, i * 3);
    }
    this.light.position.copy(this.origin).addScaledVector(this.direction, 1.3);
    this.light.intensity = strength * (7 + Math.sin(this.elapsed * 45) * 1.2);
    this.points.material.uniforms.time.value += dt;
    for (const name of ["position", "size", "alpha"]) this.points.geometry.attributes[name].needsUpdate = true;
    this.points.visible = this.alive > 0;
  }
}
