import * as THREE from "three";

/**
 * Procedural planets (docs/lore/DRAFT_9_THE_HEAVENS.md; owner 2026-10-31: "replace all the toy looking ones with real planets"). The worlds' low-poly and pixel-art planet
 * models read as toys; these are drawn by a shader instead — continents and cloud, banded gas, ice, cooled lava, a dark brown dwarf, a star — so detail comes from NOISE evaluated at
 * each pixel and never goes blurry or faceted however close you are (no texture to magnify). One sphere + a thin atmosphere (+ rings) per body, no textures, no downloads.
 * Calm under reduced motion (no spin, no cloud drift).
 */
export type PlanetKind = "terran" | "desert" | "gasBrown" | "gasGold" | "ice" | "lava" | "dwarf" | "star";

export interface PlanetSpec {
  kind: PlanetKind;
  /** Different seed, different world. */
  seed: number;
  /** Diameter in world units. */
  diameter: number;
  rings?: boolean;
  /** World-space direction FROM the planet TOWARD its sun (any length). */
  sunDir?: readonly [number, number, number];
}

const KIND_INDEX: Record<PlanetKind, number> = { terran: 0, desert: 1, gasBrown: 2, gasGold: 3, ice: 4, lava: 5, dwarf: 6, star: 7 };

/** Per kind: three palette colours and the atmosphere's tint/strength. */
const PALETTE: Record<PlanetKind, { a: number; b: number; c: number; air: number; airStrength: number }> = {
  terran: { a: 0x0b2a5c, b: 0x2f7d46, c: 0x8a7a55, air: 0x6fb4ff, airStrength: 1.0 },
  desert: { a: 0x8c3b1d, b: 0xc4793f, c: 0xe2b27a, air: 0xe8a070, airStrength: 0.35 },
  gasBrown: { a: 0x6b4a33, b: 0xc9a07a, c: 0xe8d6bd, air: 0xd9b48f, airStrength: 0.5 },
  gasGold: { a: 0xb59b6a, b: 0xe6d3a0, c: 0xf4ead0, air: 0xf0dca8, airStrength: 0.45 },
  ice: { a: 0x7aa9c9, b: 0xc7e0ee, c: 0xf4fbff, air: 0xa9d4ff, airStrength: 0.7 },
  lava: { a: 0x120807, b: 0x3a1a10, c: 0xff6a1a, air: 0xff7a35, airStrength: 0.6 },
  dwarf: { a: 0x2a0f2e, b: 0x6e2a45, c: 0xb4523f, air: 0xc0603f, airStrength: 0.4 },
  star: { a: 0xff7a1a, b: 0xffb445, c: 0xfff0b8, air: 0xffc15a, airStrength: 1.0 },
};

const NOISE = /* glsl */ `
float hash3(vec3 p){p=fract(p*0.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vnoise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<6;i++){s+=a*vnoise(p);p=p*2.03+17.1;a*=.5;}return s;}
float ridged(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*(1.0-abs(vnoise(p)*2.0-1.0));p=p*2.1+9.3;a*=.5;}return s;}
`;

const VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
void main(){ vObj=position; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
uniform int uKind; uniform float uSeed; uniform float uTime; uniform vec3 uSun;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec3 uAir; uniform float uAirK;
${NOISE}
void main(){
  vec3 p = normalize(vObj); vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
  vec3 q = p*(0.85+0.3*fract(uSeed*1.7))+vec3(uSeed*7.3, uSeed*3.1, uSeed*5.9);
  vec3 col; vec3 emit = vec3(0.0); float spec = 0.0; float lit = 1.0;
  if (uKind==0) {            // terran: ocean, land, ice, cloud
    float h = fbm(q*2.4);
    float lvl = 0.46+0.08*fract(uSeed*3.3); float sea = smoothstep(lvl,lvl+0.03,h);
    vec3 ocean = mix(uA*0.55, uA*1.6, smoothstep(0.25,0.5,h));
    float elev = smoothstep(lvl+0.03,0.78,h);
    vec3 land = mix(uB, uC, elev); land = mix(land, vec3(0.92), smoothstep(0.76,0.9,h));
    col = mix(ocean, land, sea);
    float cap = smoothstep(0.80,0.93, abs(p.y) + 0.10*fbm(q*5.0));
    col = mix(col, vec3(0.94,0.97,1.0), cap);
    float cl = smoothstep(0.52,0.72, fbm(q*3.2 + vec3(uTime*0.01,0.0,0.0)));
    col = mix(col, vec3(1.0), cl*0.85);
    spec = (1.0-sea)*(1.0-cl)*0.6;
  } else if (uKind==1) {     // desert / rust
    float h = fbm(q*3.0); float r = ridged(q*2.2);
    col = mix(uA, uB, h); col = mix(col, uC, smoothstep(0.55,0.85,r)*0.6);
    col = mix(col, vec3(0.93,0.9,0.86), smoothstep(0.86,0.95,abs(p.y)));
    col *= 0.78 + 0.35*fbm(q*9.0);
  } else if (uKind==2 || uKind==3) { // banded gas
    float warp = fbm(q*vec3(1.5,5.0,1.5))*0.22;
    float bands = sin((p.y+warp)*(uKind==2?22.0:15.0)+ fbm(q*vec3(2.0,9.0,2.0))*2.5);
    float t = 0.5+0.5*bands;
    col = mix(uA, uB, t); col = mix(col, uC, smoothstep(0.55,1.0,fbm(q*vec3(3.0,14.0,3.0)))*0.7);
    float storm = smoothstep(0.075,0.02, length(vec2((atan(p.z,p.x)-1.2)*0.55, p.y+0.28)));
    col = mix(col, vec3(0.74,0.34,0.22), storm*(uKind==2?0.9:0.0));
    col *= 0.9+0.2*fbm(q*vec3(6.0,26.0,6.0));
  } else if (uKind==4) {     // ice with fractures
    float h = fbm(q*3.5); float cr = ridged(q*4.0);
    col = mix(uA, uC, h); col = mix(col, uB, smoothstep(0.7,0.95,cr)*0.7);
    spec = 0.5;
  } else if (uKind==5) {     // cooled lava: dark crust, glowing cracks
    float cr = ridged(q*3.2); float crack = smoothstep(0.80,0.93,cr);
    col = mix(uA, uB, fbm(q*6.0)); emit = uC*crack*(1.2+0.6*fbm(q*12.0+uTime*0.02));
  } else if (uKind==6) {     // brown dwarf: dark banded cloud, faint heat
    float bands = sin((p.y+fbm(q*vec3(2.0,6.0,2.0))*0.2)*18.0);
    col = mix(uA, uB, 0.5+0.5*bands); col = mix(col, uC, smoothstep(0.6,1.0,fbm(q*vec3(4.0,16.0,4.0)))*0.5);
    emit = uC*0.10*(0.5+0.5*bands);
  } else {                   // star: emissive granulation
    float g = fbm(q*14.0+uTime*0.05); float s = fbm(q*3.0);
    col = mix(uA, uB, g); col = mix(col, uC, smoothstep(0.55,0.9,g)); col *= 0.85+0.3*s; lit = 0.0; emit = col*1.4;
  }
  float nd = dot(N, normalize(uSun));
  float day = smoothstep(-0.08, 0.30, nd);
  vec3 H = normalize(normalize(uSun)+V);
  float sp = spec*pow(max(dot(N,H),0.0), 60.0)*day;
  vec3 shade = col*(0.05 + 0.95*day);
  vec3 outc = mix(col*1.0, shade, lit) + vec3(sp) + emit*(uKind==7?1.0:1.0);
  // atmosphere rim (inside the sphere), brighter on the lit side
  float rim = pow(1.0 - max(dot(N,V),0.0), 3.0);
  outc += uAir*uAirK*rim*(0.25 + 0.9*day);
  gl_FragColor = vec4(outc, 1.0);
}
`;

const AIR_FRAG = /* glsl */ `
varying vec3 vN; varying vec3 vW; uniform vec3 uAir; uniform float uAirK; uniform vec3 uSun;
void main(){ vec3 N=normalize(vN); vec3 V=normalize(cameraPosition-vW);
  float f = pow(1.0-abs(dot(N,V)), 2.4); float day = smoothstep(-0.35,0.35,dot(N,normalize(uSun)));
  gl_FragColor = vec4(uAir, f*uAirK*(0.15+0.85*day)); }
`;

const RING_FRAG = /* glsl */ `
varying vec3 vObj; varying vec3 vW; uniform vec3 uTint; uniform float uInner; uniform float uOuter; uniform vec3 uSun;
float h1(float x){return fract(sin(x*127.1)*43758.5453);}
float n1(float x){float i=floor(x);float f=fract(x);f=f*f*(3.0-2.0*f);return mix(h1(i),h1(i+1.0),f);}
void main(){ float r = length(vObj.xy); float t=(r-uInner)/(uOuter-uInner);
  float band = 0.55*n1(t*60.0)+0.3*n1(t*17.0)+0.15*n1(t*190.0);
  float gap = smoothstep(0.02,0.0,abs(t-0.62)) + smoothstep(0.04,0.0,abs(t-0.08));
  float a = smoothstep(0.0,0.06,t)*smoothstep(1.0,0.9,t)*(0.25+0.6*band)*(1.0-0.85*gap);
  gl_FragColor = vec4(uTint*(0.6+0.5*band), a); }
`;

export interface ProceduralPlanet {
  group: THREE.Group;
  /** Per-frame: spin and cloud drift. Reduced motion: call with 0 or skip. */
  update(dtMs: number): void;
  dispose(): void;
}

/** A realistic planet from a spec. The group's origin is the planet's centre; its bounding radius is diameter/2 (rings: ~2.3×). */
export function createProceduralPlanet(spec: PlanetSpec, opts: { reducedMotion?: boolean } = {}): ProceduralPlanet {
  const R = spec.diameter / 2;
  const pal = PALETTE[spec.kind];
  const sun = new THREE.Vector3(...(spec.sunDir ?? [0.55, 0.25, 0.8])).normalize();
  const col = (h: number) => new THREE.Color(h);
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(R, 72, 48),
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uKind: { value: KIND_INDEX[spec.kind] },
        uSeed: { value: spec.seed },
        uTime: { value: 0 },
        uSun: { value: sun },
        uA: { value: col(pal.a) },
        uB: { value: col(pal.b) },
        uC: { value: col(pal.c) },
        uAir: { value: col(pal.air) },
        uAirK: { value: pal.airStrength },
      },
    }),
  );
  body.name = "planet-body";
  group.add(body);
  const air = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.035, 40, 28),
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: AIR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uAir: { value: col(pal.air) }, uAirK: { value: pal.airStrength }, uSun: { value: sun } },
    }),
  );
  air.name = "planet-air";
  if (spec.kind !== "star") group.add(air);
  let ring: THREE.Mesh | null = null;
  if (spec.rings) {
    const inner = R * 1.4;
    const outer = R * 2.3;
    ring = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 160, 1),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uTint: { value: col(pal.b) }, uInner: { value: inner }, uOuter: { value: outer }, uSun: { value: sun } },
      }),
    );
    ring.rotation.x = Math.PI / 2 - 0.45;
    ring.rotation.y = 0.2;
    ring.name = "planet-ring";
    group.add(ring);
  }
  const mat = body.material as THREE.ShaderMaterial;
  return {
    group,
    update(dtMs) {
      if (opts.reducedMotion) return;
      mat.uniforms.uTime!.value += dtMs / 1000;
      body.rotation.y += (dtMs / 1000) * 0.012;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (m.material as THREE.Material).dispose();
      });
    },
  };
}

/** Which procedural look replaces each toy-looking model (the sf-* Sketchfab models are real-looking and stay). */
export const TOY_REPLACEMENTS: Readonly<Record<string, Omit<PlanetSpec, "diameter" | "sunDir">>> = {
  planet_earth: { kind: "terran", seed: 1.3 },
  planet_mars: { kind: "desert", seed: 2.1 },
  planet_jupiter: { kind: "gasBrown", seed: 3.7 },
  planet_saturn: { kind: "gasGold", seed: 4.4, rings: true },
  "quaternius-planet-1": { kind: "ice", seed: 5.2 },
  "quaternius-planet-2": { kind: "lava", seed: 6.6 },
  "quaternius-planet-3": { kind: "terran", seed: 7.9 },
  "planets-set": { kind: "desert", seed: 8.3 },
  "earth-and-moon": { kind: "terran", seed: 9.1 },
  "pixel-brown-dwarf": { kind: "dwarf", seed: 10.4 },
  sun: { kind: "star", seed: 11.2 },
};
