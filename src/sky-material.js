import * as THREE from "three";

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color("#609fc7") }, horizon: { value: new THREE.Color("#e2d8be") },
      sunDirection: { value: new THREE.Vector3(-0.65, 0.5, -0.4).normalize() },
      moonDirection: { value: new THREE.Vector3(0.65, -0.5, 0.4).normalize() },
      sunColor: { value: new THREE.Color("#fff0d3") }, sunVisibility: { value: 1 },
      night: { value: 0 }, twilight: { value: 0 }, time: { value: 0 }, rotation: { value: 0 },
    },
    vertexShader: `varying vec3 vDirection;
      void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vDirection;
      uniform vec3 zenith,horizon,sunDirection,moonDirection,sunColor;
      uniform float sunVisibility,night,twilight,time,rotation;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
      void main(){
        vec3 d=normalize(vDirection);float height=max(d.y,0.);
        vec3 sky=mix(horizon,zenith,pow(clamp(height*2.5,0.,1.),.48));
        float alignment=max(0.,dot(d,sunDirection));
        float forwardHaze=pow(alignment,12.)*exp(-height*5.);
        sky+=sunColor*forwardHaze*(.16+twilight*.45)*sunVisibility;
        float separation=length(d-sunDirection);
        float edge=max(fwidth(separation),.0002);
        float disc=1.-smoothstep(.008-edge,.008+edge,separation);
        float aureole=exp(-separation*separation*1600.)*.35+exp(-separation*separation*140.)*.075;
        sky+=sunColor*(disc*5.+aureole)*sunVisibility;
        if(night>.001){
          float c=cos(rotation),s=sin(rotation);
          vec3 sd=vec3(c*d.x+s*d.z,d.y,-s*d.x+c*d.z);
          vec2 starUV=vec2(atan(sd.z,sd.x)/6.2831853+.5,asin(clamp(sd.y,-1.,1.))/3.1415927+.5)*vec2(700.,350.);
          vec2 cell=floor(starUV),p=fract(starUV)-vec2(hash(cell+17.),hash(cell+43.));float seed=hash(cell);
          float radius=max(.035,length(fwidth(starUV))*.22);
          float star=exp(-dot(p,p)/(radius*radius))*step(.995,seed);
          float twinkle=.82+.18*sin(time*1.1+seed*300.);
          sky+=mix(vec3(.7,.82,1.),vec3(1.,.9,.72),hash(cell+91.))*star*night*twinkle*smoothstep(0.,.12,d.y)*1.8;
          vec3 right=normalize(cross(vec3(0.,1.,0.),moonDirection)),up=cross(moonDirection,right);
          vec2 uv=vec2(dot(d,right),dot(d,up))/.009;
          float r2=dot(uv,uv);float mask=(1.-smoothstep(.96,1.04,r2))*step(.99,dot(d,moonDirection));
          if(mask>.001){float z=sqrt(max(0.,1.-r2));float maria=noise(uv*5.)*.6+noise(uv*13.)*.25+noise(uv*29.)*.15;
            float relief=.7+maria*.3;float light=clamp(z*.75+uv.x*.28+.2,0.,1.);
            vec3 moon=vec3(.7,.78,.9)*relief*light*1.8;sky=mix(sky,moon,mask*night);}
          sky+=vec3(.2,.29,.45)*exp(-pow(length(d-moonDirection)*24.,2.))*night*.12;
        }
        gl_FragColor=vec4(sky,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
