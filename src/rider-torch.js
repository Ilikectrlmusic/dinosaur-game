import * as THREE from "three";

const CAPACITY = 24, FLAME_HEIGHT = 0.78;

function haloTexture() {
  const size = 32, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
    pixels.set([255, 255, 255, Math.round(Math.max(0, Math.exp(-r * r * 7) - 0.001) * 255)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class RiderTorch {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = "rider-torch"; scene.add(this.root);
    this.materials = [];
    const wood = new THREE.MeshStandardMaterial({ color: "#68432b", roughness: 0.96, transparent: true });
    const leather = new THREE.MeshStandardMaterial({ color: "#38281c", roughness: 0.95, transparent: true });
    const iron = new THREE.MeshStandardMaterial({ color: "#34332c", metalness: 0.7, roughness: 0.68, transparent: true });
    this.coals = new THREE.MeshStandardMaterial({ color: "#33241c", emissive: "#ff3e0c", emissiveIntensity: 0, roughness: 1, transparent: true });
    this.materials.push(wood, leather, iron, this.coals);
    const part = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z);
      mesh.castShadow = true; this.root.add(mesh); return mesh;
    };
    part(new THREE.CylinderGeometry(0.022, 0.029, 0.64, 12), wood, 0, 0.2, 0);
    for (const y of [-0.08, -0.025, 0.035, 0.095])
      part(new THREE.TorusGeometry(0.028, 0.005, 5, 12).rotateX(Math.PI / 2), leather, 0, y, 0);
    part(new THREE.CylinderGeometry(0.053, 0.044, 0.14, 12), this.coals, 0, 0.55, 0);
    for (const y of [0.49, 0.6])
      part(new THREE.TorusGeometry(0.053, 0.007, 5, 12).rotateX(Math.PI / 2), iron, 0, y, 0);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      part(new THREE.CylinderGeometry(0.006, 0.006, 0.15, 5), iron, Math.cos(a) * 0.052, 0.55, Math.sin(a) * 0.052);
    }
    this.flameMaterial = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, strength: { value: 0 }, wind: { value: new THREE.Vector2() }, stretch: { value: 1 } },
      vertexShader: `varying vec2 vUv;uniform float time,stretch;uniform vec2 wind;
        void main(){vUv=uv;vec3 p=position;float tip=pow(uv.y,1.7);
          p.y+=uv.y*.6*(stretch-1.);
          p.x+=wind.x*tip+(sin(time*6.+uv.y*5.)*.035+sin(time*11.-uv.y*8.)*.018)*tip;
          p.z+=wind.y*tip+cos(time*7.3-uv.y*6.)*.024*tip;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
      fragmentShader: `varying vec2 vUv;uniform float time,strength;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
        void main(){float y=vUv.y,x=(vUv.x-.5)*2.;vec2 flow=vec2(x*3.,y*4.-time*3.4);
          float n=noise(flow)*.55+noise(flow*2.1+3.)*.3+noise(flow*4.3+9.)*.15;
          x+=(n-.5)*.5*y+sin(y*10.-time*8.)*.045*y;
          float width=pow(max(0.,1.-y),.7)*(.8+sin(time*8.1-y*6.)*.075);float edge=abs(x)/max(.03,width);
          float shape=(1.-smoothstep(.55,1.,edge))*(1.-smoothstep(.78+n*.17,1.,y));
          shape*=smoothstep(0.,.08,y);float core=(1.-smoothstep(.05,.55,edge))*(1.-smoothstep(.1,.8,y));
          vec3 color=mix(vec3(1.5,.14,.005),vec3(3.,1.5,.35),core);color=mix(color,vec3(3.3,2.7,1.3),core*core*.55);
          float alpha=shape*strength*.7;if(alpha<.004)discard;gl_FragColor=vec4(color,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.flame = new THREE.Group(); this.flame.position.y = 0.6; this.root.add(this.flame);
    for (const angle of [0, Math.PI / 2]) {
      const geometry = new THREE.PlaneGeometry(0.54, 0.6, 1, 10).rotateY(angle);
      const flame = new THREE.Mesh(geometry, this.flameMaterial);
      flame.position.y = 0.3; flame.frustumCulled = false; this.flame.add(flame);
    }
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(), color: "#ffb454", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    }));
    this.glow.position.y = FLAME_HEIGHT; this.glow.scale.setScalar(0.78); this.root.add(this.glow);
    // Keep the objects registered, but remove their shader loops in daylight.
    // Both lighting variants are warmed while the loading screen is showing.
    this.light = new THREE.PointLight("#ffb66b", 0, 23, 2);
    // A broad forward pool complements the near flame: light the upcoming
    // obstacles rather than aiming most of the torch light beneath the saddle.
    this.groundLight = new THREE.SpotLight("#ffd298", 0, 44, Math.PI * 0.22, 0.85, 2);
    // Unshadowed fire light avoids an extra scene render even while its daytime
    // intensity is zero. The sun and cheap contact shadow ground the dinosaur.
    this.groundLight.castShadow = false;
    scene.add(this.light, this.groundLight, this.groundLight.target);
    this.positions = new Float32Array(CAPACITY * 3); this.sizes = new Float32Array(CAPACITY); this.alphas = new Float32Array(CAPACITY);
    this.particles = Array.from({ length: CAPACITY }, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: Infinity, life: 1 }));
    const geometry = new THREE.BufferGeometry();
    for (const [key, array, size] of [["position", this.positions, 3], ["size", this.sizes, 1], ["alpha", this.alphas, 1]])
      geometry.setAttribute(key, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { pointScale: { value: 700 } },
      vertexShader: `attribute float size,alpha;uniform float pointScale;varying float vAlpha;
        void main(){vec4 p=modelViewMatrix*vec4(position,1.);vAlpha=alpha;gl_PointSize=clamp(size*pointScale/max(.1,-p.z),0.,7.);gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying float vAlpha;void main(){float r=length(gl_PointCoord*2.-1.);float a=(1.-smoothstep(.1,1.,r))*vAlpha;if(a<.005)discard;
        gl_FragColor=vec4(2.5,.7,.08,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    this.sparks = new THREE.Points(geometry, material); this.sparks.frustumCulled = false; scene.add(this.sparks);
    this.origin = new THREE.Vector3(); this.handPosition = new THREE.Vector3(); this.direction = new THREE.Vector3();
    this.lastHandPosition = new THREE.Vector3();
    this.airflow = new THREE.Vector3(); this.localFlow = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
    this.inverseRotation = new THREE.Quaternion();
    this.handRotation = new THREE.Quaternion(); this.previousHandRotation = new THREE.Quaternion(); this.crashRotation = new THREE.Quaternion();
    this.euler = new THREE.Euler(); this.seed = 0x7f4a921;
    this.reset();
  }

  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  reset() {
    this.strength = 0; this.alive = 0; this.emission = 0; this.crashed = false;
    this.airflowInitialized = false; this.verticalAirSpeed = 0;
    this.airflow.set(0, 1, 0); this.flame.quaternion.identity();
    this.flameMaterial.uniforms.wind.value.set(0, 0); this.flameMaterial.uniforms.stretch.value = 1;
    this.root.visible = false; this.sparks.visible = false; this.light.intensity = this.groundLight.intensity = 0;
    this.light.visible = this.groundLight.visible = false;
    this.particles.forEach((p) => { p.age = Infinity; }); this.alphas.fill(0); this.sizes.fill(0);
  }

  beginCrash() {
    this.crashRotation.copy(this.previousHandRotation).invert().multiply(this.root.quaternion);
    this.crashed = true;
  }

  update(dt, hand, amount, time, { camera = null, firstPerson = false, speed = 0, duck = 0, motion = true, groundHeight = 0 } = {}) {
    if (amount <= 0.002 && this.alive === 0) {
      this.strength = 0; this.airflowInitialized = false;
      this.root.visible = this.light.visible = this.groundLight.visible = false;
      this.light.intensity = this.groundLight.intensity = 0;
      return;
    }
    const step = Math.min(0.05, Math.max(0, dt));
    hand.getWorldPosition(this.handPosition); hand.getWorldQuaternion(this.handRotation);
    // The base stays on the wick; only the flame bends. Smooth measured hand
    // motion so footfalls, takeoff and landing disturb the fire without snaps.
    let acceleration = 0;
    if (this.airflowInitialized && step > 0 && this.handPosition.distanceToSquared(this.lastHandPosition) < 1) {
      const velocity = THREE.MathUtils.clamp((this.handPosition.y - this.lastHandPosition.y) / step, -8, 8);
      const previous = this.verticalAirSpeed;
      this.verticalAirSpeed = THREE.MathUtils.damp(previous, velocity, 12, step);
      acceleration = THREE.MathUtils.clamp((this.verticalAirSpeed - previous) / step, -30, 30);
    } else this.verticalAirSpeed = 0;
    this.lastHandPosition.copy(this.handPosition); this.airflowInitialized = true;
    const movement = motion ? 1 : 0.35, air = this.verticalAirSpeed;
    const gust = Math.sin(time * 1.9) * 0.6 + Math.sin(time * 3.7 + 2) * 0.4;
    const wind = this.flameMaterial.uniforms.wind.value;
    wind.x = THREE.MathUtils.damp(wind.x, movement * (gust * 0.1 + air * Math.sin(time * 2.3) * 0.02), 9, step);
    wind.y = THREE.MathUtils.damp(wind.y, movement * (0.01 + gust * 0.075 + Math.abs(acceleration) * 0.002), 9, step);
    // Lean the entire plume from the wick, not just its tip. +Z is behind the
    // moving mount; keeping flow in world space also works while looking around.
    this.localFlow.set(gust * 0.15 * movement, 1 - THREE.MathUtils.clamp(air * 0.04, -0.3, 0.3),
      0.035 + Math.min(Math.max(speed, 0) / 30, 1.2) * 1.25 + gust * 0.1 * movement);
    this.airflow.lerp(this.localFlow, 1 - Math.exp(-step * 8));
    const stretch = THREE.MathUtils.clamp(1 - movement * (air * 0.035 + acceleration * 0.003), 0.76, 1.25);
    this.flameMaterial.uniforms.stretch.value = THREE.MathUtils.damp(this.flameMaterial.uniforms.stretch.value, stretch, 10, step);
    this.root.position.copy(this.handPosition);
    const viewModel = firstPerson && !this.crashed;
    this.root.scale.setScalar(viewModel ? 0.65 : 1);
    if (this.crashed) this.root.quaternion.copy(this.handRotation).multiply(this.crashRotation);
    else if (firstPerson && camera) {
      const depth = 1.35, halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth;
      const halfWidth = halfHeight * camera.aspect;
      this.root.position.set(Math.min(0.5, halfWidth * 0.4), -halfHeight + 0.058 - duck * 0.18, -depth).applyQuaternion(camera.quaternion).add(camera.position);
      this.root.quaternion.copy(camera.quaternion).multiply(this.crashRotation.setFromEuler(this.euler.set(-0.04, 0, -0.1)));
    } else this.root.quaternion.setFromEuler(this.euler.set(-0.07, 0, -0.12 - duck * 0.25 + Math.sin(time * 1.7) * 0.015));
    this.previousHandRotation.copy(this.handRotation);
    this.localFlow.copy(this.airflow).applyQuaternion(this.inverseRotation.copy(this.root.quaternion).invert()).normalize();
    this.flame.quaternion.setFromUnitVectors(this.up, this.localFlow);
    this.root.updateMatrixWorld(true);
    this.root.localToWorld(this.origin.set(0, FLAME_HEIGHT, 0));
    this.strength = THREE.MathUtils.clamp(amount, 0, 1) * (this.crashed ? THREE.MathUtils.smoothstep(this.origin.y, groundHeight + 0.02, groundHeight + 0.16) : 1);
    const strength = this.strength;
    this.root.visible = strength > 0.002;
    this.light.visible = this.groundLight.visible = this.root.visible;
    for (const material of this.materials) material.opacity = THREE.MathUtils.smoothstep(strength, 0, 0.18);
    this.coals.emissiveIntensity = strength * 0.65;
    this.flameMaterial.uniforms.time.value = time;
    this.flameMaterial.uniforms.strength.value = strength;
    this.glow.material.opacity = strength * 0.2;
    const flicker = 1 + (Math.sin(time * 13.7) * 0.055 + Math.sin(time * 23.1 + 2) * 0.025) * (motion ? 1 : 0.4);
    this.light.position.copy(this.origin); this.light.intensity = strength * flicker * (viewModel ? 24 : 68);
    this.groundLight.position.copy(this.origin); this.groundLight.intensity = strength * flicker * (viewModel ? 360 : 440);
    this.direction.set(0, 0, -1);
    if (firstPerson && camera) this.direction.applyQuaternion(camera.quaternion);
    this.direction.y = 0; this.direction.normalize(); this.direction.y = -0.24;
    this.groundLight.target.position.copy(this.origin).addScaledVector(this.direction, 10);
    this.groundLight.target.updateMatrixWorld(true);
    if (camera) this.sparks.material.uniforms.pointScale.value = (camera.userData.viewportHeight || 720) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (firstPerson ? 0.6 : 1);
    this.emission += step * strength * 10;
    let spawn = Math.floor(this.emission); this.emission -= spawn; this.alive = 0;
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.particles[i]; p.age += step;
      if (p.age >= p.life && spawn > 0) {
        p.age = 0; p.life = 0.5 + this.random() * 0.6; p.position.copy(this.origin);
        p.velocity.set((this.random() - 0.5) * 0.18, 0.35 + this.random() * 0.4, 0.05 + speed * 0.015); spawn--;
      }
      if (p.age >= p.life) { this.sizes[i] = this.alphas[i] = 0; continue; }
      p.position.addScaledVector(p.velocity, step); p.velocity.y += step * 0.1;
      p.position.toArray(this.positions, i * 3);
      this.sizes[i] = 0.006 + (1 - p.age / p.life) * 0.012; this.alphas[i] = (1 - p.age / p.life) * 0.8;
      this.alive++;
    }
    this.sparks.visible = this.alive > 0;
    for (const attribute of Object.values(this.sparks.geometry.attributes)) attribute.needsUpdate = true;
  }
}
