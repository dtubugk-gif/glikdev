// The world: renderer, daylight sky, sun, the Blender-built baseplate (models/day1.glb).
// What the days add (the kitty from Day 2) lives in its own module and joins this scene.
// Everything that moves is a pure function of the time passed to update(t), so demo
// recordings are frame exact.
//
// Day 6 (the owner: "make the game look 1,000 times better"): the picture is now made like a film frame.
//   - the sky is painted with real cloud shapes lit by the sun, a warm glowing horizon and a sea of cloud below;
//   - the same sky lights everything (an environment map made from it), with a warm sun and a cool rim light;
//   - the plate is a floor of big polished tiles: bevelled seams, a little colour from tile to tile, and a soft
//     reflection of the sky that brightens toward the horizon;
//   - the frame is drawn in high dynamic range, then finished like a photograph: a soft glow round the brightest
//     things (never a neon look: only what is truly bright blooms), filmic tones, a gentle grade and a vignette;
//   - specks of dust drift in the sunlight near the lens.
// Phones that cannot draw to a float buffer, or that turn out to be slow, get the same world without the
// finishing pass (setQuality).
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';

export const PALETTE = {
  zenith: new THREE.Color('#5d9fe0'),
  sky: new THREE.Color('#a4cdf0'),
  horizon: new THREE.Color('#ffe9cc'),
  haze: new THREE.Color('#dfe9f1'),
  cloud: new THREE.Color('#fffaf2'),
  cloudShade: new THREE.Color('#a9bfd8'),
  sun: new THREE.Color('#ffe2b8'),
  hemiSky: new THREE.Color('#cfe2f7'),
  hemiGround: new THREE.Color('#d9c7ac'),
  plate: new THREE.Color('#c2bbb0'),
  seam: new THREE.Color('#7f7a73'),
};

// The baseplate: 256 x 256 m, its top is the ground at y = 0, centred on the origin.
export const PLATE = { half: 128, topY: 0 };

const skyVertex = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // keep the dome at the far plane
  }`;

const skyFragment = /* glsl */`
  precision highp float;
  uniform vec3 uZenith, uSky, uHorizon, uHaze, uCloud, uCloudShade, uSunDir, uSunCol;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }
  float fbm3(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }
  // how much cloud there is at a point of the cloud deck: big rounded heaps with clear sky between them
  float heaps(vec2 q) {
    float n = fbm(q) * 0.72 + fbm3(q * 2.7 + 11.0) * 0.28;
    return smoothstep(0.5, 0.74, n + 0.1 * vnoise(q * 0.31));
  }

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 sunD = normalize(uSunDir);
    float mu = max(dot(d, sunD), 0.0);
    vec2 sunXZ = normalize(sunD.xz + 1e-4);

    // the dome: deep blue overhead, paler lower down, a warm band of light sitting on the horizon
    float h = clamp(y, 0.0, 1.0);
    vec3 up = mix(uSky, uZenith, smoothstep(0.08, 0.78, h));
    up = mix(uHorizon, up, smoothstep(-0.02, 0.1, y));
    // the sun's glow: a wide warm wash, a tighter halo, and the disc itself (far brighter than the screen: it blooms)
    up += uSunCol * (0.16 * pow(mu, 5.0) + 0.3 * pow(mu, 40.0)) * (1.0 - 0.45 * h);
    up += uSunCol * 9.0 * smoothstep(0.99935, 0.99975, mu);

    // heaped clouds: lit on the side that faces the sun, blue-grey underneath, thinning out toward the horizon
    if (y > 0.015) {
      vec2 q = d.xz / (y + 0.11) * 0.8 + vec2(uTime * 0.0045, uTime * 0.0018);
      float c = heaps(q);
      if (c > 0.002) {
        float toward = heaps(q + sunXZ * 0.16);                 // the cloud between here and the sun: this side is in shade
        float lit = clamp(0.62 + (c - toward) * 1.5 + 0.25 * pow(mu, 3.0), 0.0, 1.0);
        vec3 cc = mix(uCloudShade, uCloud * 1.12, lit);
        cc += uSunCol * 0.35 * pow(mu, 10.0) * (1.0 - c);       // thin edges catch the sun: a silver lining
        float fade = smoothstep(0.008, 0.055, y);
        up = mix(up, cc, c * fade * 0.94);
      }
      // high, thin streaks above them
      vec2 q2 = d.xz / (y + 0.3) * 1.5 + vec2(uTime * 0.002, -uTime * 0.001);
      float wisp = smoothstep(0.52, 0.86, fbm3(q2 * vec2(0.5, 1.9)));
      up = mix(up, mix(up, vec3(1.0), 0.6), wisp * smoothstep(0.12, 0.45, y) * 0.4);
    }

    // a sea of soft clouds far below the plate
    vec3 col = up;
    if (y < 0.04) {
      float depth = max(-y, 0.004);
      vec2 q = d.xz / depth * 1.5 + vec2(uTime * 0.006, uTime * 0.003);
      float n = fbm(q) * 0.75 + fbm3(q * 3.1 + 4.0) * 0.25;
      float puff = smoothstep(0.34, 0.62, n);
      // lit tops toward the sun, blue-grey valleys between the puffs
      float lit = clamp(0.5 + 0.2 * dot(sunXZ, normalize(d.xz + 1e-4)) + (n - 0.5) * 1.9, 0.0, 1.0);
      vec3 cloud = mix(uCloudShade * 0.92, uCloud * 1.06, lit);
      vec3 below = mix(mix(uSky, uZenith, 0.35) * 0.9, cloud, puff);
      float horizonFade = smoothstep(0.05, 0.4, depth);   // streaks near the horizon fade into haze
      below = mix(mix(uHaze, uHorizon, 0.45), below, horizonFade);
      col = mix(below, up, smoothstep(-0.03, 0.04, y));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function makeSky(sunDir) {
  const uniforms = {
    uZenith: { value: PALETTE.zenith }, uSky: { value: PALETTE.sky }, uHorizon: { value: PALETTE.horizon },
    uHaze: { value: PALETTE.haze }, uCloud: { value: PALETTE.cloud }, uCloudShade: { value: PALETTE.cloudShade },
    uSunDir: { value: sunDir.clone() }, uSunCol: { value: new THREE.Color('#fff0d6') }, uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: skyVertex, fragmentShader: skyFragment,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  dome.name = 'SkyDome';
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}

/** The light everything is lit by: the painted sky itself, with the plate's colour below (made once). */
function makeEnvironment(renderer, sky) {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(sky.geometry, sky.material);
  dome.frustumCulled = false;
  env.add(dome);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(700, 24), new THREE.MeshBasicMaterial({ color: PALETTE.plate.clone().multiplyScalar(0.8) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -12;
  env.add(floor);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.02, 1, 2000).texture;
  pm.dispose();
  floor.geometry.dispose(); floor.material.dispose();
  return tex;
}

// ---------------------------------------------------------------------------------------------------------
// The plate's floor: big polished tiles, drawn in the material (the mesh is still Day 1's plate from Blender).
// One 4 m tile per grid cell, as on Day 1. Seams are anti-aliased from the pixel's own footprint, so they melt
// away cleanly in the distance instead of shimmering.
function tileFloor(mat) {
  mat.map = null;
  mat.color.copy(PALETTE.plate);
  mat.roughness = 0.36;
  mat.metalness = 0;
  mat.envMapIntensity = 1.0;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSeam = { value: PALETTE.seam };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNor;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNor = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNor; uniform vec3 uSeam;
float tHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float tNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y); }
float tSeam; vec2 tBevel; float tTop; float tGrain;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  tTop = step(0.9, vWNor.y);
  vec2 p = vWPos.xz / 4.0;
  vec2 fw = max(fwidth(p), vec2(1e-5));
  vec2 f = fract(p), cell = floor(p);
  vec2 e = min(f, 1.0 - f);                               // how far to the nearest seam, in tiles
  float w = 0.011;                                        // half the seam's width (about 4.5 cm)
  vec2 a = smoothstep(vec2(w) - fw, vec2(w) + fw, e);
  float far = clamp(1.0 - max(fw.x, fw.y) * 2.2, 0.0, 1.0);   // tiles smaller than a pixel: no pattern left to show
  tSeam = (1.0 - min(a.x, a.y)) * far * tTop;
  // the tile's rounded edge: the surface tips away toward the seam over about 12 cm
  vec2 edge = (1.0 - smoothstep(vec2(w), vec2(w + 0.03), e)) * sign(f - 0.5);
  tBevel = edge * far * tTop * 0.5;
  // each tile its own shade, a faint checker, and slow clouds of tone across the whole floor
  float tone = (tHash(cell) - 0.5) * 0.11 + (mod(cell.x + cell.y, 2.0) - 0.5) * 0.05;
  tGrain = tNoise(vWPos.xz * 0.9) * 0.6 + tNoise(vWPos.xz * 3.7) * 0.4;
  float wash = tNoise(vWPos.xz * 0.035) - 0.5;
  diffuseColor.rgb *= 1.0 + (tone * far + wash * 0.09 + (tGrain - 0.5) * 0.035 * far) * tTop;
  diffuseColor.rgb = mix(diffuseColor.rgb, uSeam, tSeam * 0.85);
  diffuseColor.rgb *= mix(0.62, 1.0, tTop);               // the slab's sides are in shade
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + (tGrain - 0.5) * 0.16 + tSeam * 0.4, 0.2, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (tTop > 0.5) normal = normalize(normal + (viewMatrix * vec4(tBevel.x, 0.0, tBevel.y, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'glikdev-tiles';
  mat.needsUpdate = true;
}

// ---------------------------------------------------------------------------------------------------------
// Dust in the sunlight: a few soft specks drifting near the lens. Where each one is depends only on the time
// and on where the camera is, so a recording comes out the same every time.
function makeMotes(count) {
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = (k) => { const v = Math.sin((i + 1) * (12.9898 + k * 78.233)) * 43758.5453; return v - Math.floor(v); };
    seed.set([r(0), r(1), r(2), r(3)], i * 4);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uEye: { value: new THREE.Vector3() }, uPx: { value: 1 }, uTint: { value: new THREE.Color('#fff3da') } },
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime, uPx; uniform vec3 uEye;
      varying float vA;
      const vec3 BOX = vec3(70.0, 22.0, 70.0);
      void main() {
        // a slow drift on the breeze, a slower rise and fall; the box of specks travels with the camera
        vec3 p = aSeed.xyz * BOX + vec3(uTime * (0.5 + aSeed.w * 0.5), sin(uTime * 0.21 + aSeed.w * 40.0) * 1.2, uTime * 0.27);
        p = mod(p - uEye + BOX * 0.5, BOX) - BOX * 0.5;
        p.y = mod(aSeed.y * BOX.y + sin(uTime * 0.21 + aSeed.w * 40.0) * 1.2, BOX.y) + 0.6 - uEye.y;
        vec4 mv = viewMatrix * vec4(p + uEye, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = uPx * (0.1 + 0.11 * aSeed.w) * projectionMatrix[1][1] / max(d, 0.5);
        // never right in front of the lens, fading out with distance, each one twinkling as it turns in the light
        vA = smoothstep(3.0, 9.0, d) * (1.0 - smoothstep(26.0, 34.0, d)) * (0.45 + 0.55 * sin(uTime * (0.6 + aSeed.w) + aSeed.x * 50.0));
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTint; varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        gl_FragColor = vec4(uTint * 1.5, a * a * max(vA, 0.0) * 0.5);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending, toneMapped: false, fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'Motes';
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return pts;
}

// ---------------------------------------------------------------------------------------------------------
// The film camera (Shorts only, ?cine=1): a lens with depth of field. The scene is drawn into a buffer with
// its depth, then one pass blurs every pixel by how far it is from the plane the subjects stand in. The
// subjects (the kitty, you) stay sharp; the plate behind them and anything close to the lens go soft.
// Stateless: the focus is a pure function of where the subjects are on this frame.
const quadVertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const cineFragment = /* glsl */`
  precision highp float;
  #include <packing>
  uniform sampler2D tColor, tDepth;
  uniform float uNear, uFar, uFocusNear, uFocusFar, uAperture;
  uniform vec2 uUnit;                      // one blur unit in uv (the widest blur is MAXR units)
  varying vec2 vUv;
  const int N = 128;
  const float MAXR = 16.0;
  float dist(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
  // blur size (units) of a point z metres away: none between the two focus planes, growing outside them
  float blurOf(float z) {
    float c = z < uFocusNear ? (uFocusNear - z) / max(z, 0.05) * 0.8 : z > uFocusFar ? (z - uFocusFar) / z : 0.0;
    return clamp(c * uAperture, 0.0, 1.0) * MAXR;
  }
  void main() {
    float zc = dist(vUv), sc = blurOf(zc);
    vec3 col = texture2D(tColor, vUv).rgb; float tot = 1.0;
    // each pixel turns the sample spiral by its own angle, so the blur shows no dot pattern (the fill pass smooths the rest)
    float turn = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    for (int i = 0; i < N; i++) {
      float fi = float(i) + 0.5, r = sqrt(fi / float(N)) * MAXR, a = fi * 2.39996323 + turn;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uUnit;
      float zs = dist(uv), ss = blurOf(zs);
      if (zs > zc) ss = min(ss, sc * 2.0);                 // what is behind never bleeds over what is sharp in front
      float m = smoothstep(r - 0.5, r + 0.5, ss);
      col += mix(col / tot, min(texture2D(tColor, uv).rgb, vec3(6.0)), m); tot += 1.0;
    }
    gl_FragColor = vec4(col / tot, sc / MAXR);              // alpha: how blurred this pixel is (0-1), for the fill pass
  }`;
// the fill pass: a small soft blur over the blurred areas only (it closes the gaps between the lens samples)
const fillFragment = /* glsl */`
  precision highp float;
  uniform sampler2D tColor;
  uniform vec2 uUnit;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tColor, vUv);
    float k = smoothstep(0.02, 0.2, c.a);
    vec3 col = c.rgb * 4.0; float tot = 4.0;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5235988, r = (mod(float(i), 2.0) < 0.5 ? 1.5 : 2.9) * k;
      vec4 s = texture2D(tColor, vUv + vec2(cos(a), sin(a)) * r * uUnit);
      float w = step(0.02, s.a);                           // never pull sharp pixels into the blur
      col += s.rgb * w; tot += w;
    }
    gl_FragColor = vec4(col / tot, 1.0);
  }`;

// ---------------------------------------------------------------------------------------------------------
// Finishing the frame. The scene is drawn into a float buffer (brighter than white is kept), then:
//   glow     the parts brighter than white (the sun, lit cloud edges, glints) spread a soft light round themselves:
//            the picture is halved again and again, each smaller copy blurred, and they are added back together;
//   develop  filmic tones (Khronos neutral: colours keep their hue), a touch more contrast and colour, warm
//            highlights and cool shadows, a vignette. All of it depends only on the frame itself.
const brightFragment = /* glsl */`
  precision highp float;
  uniform sampler2D tColor; uniform vec2 uTexel; uniform float uThreshold, uKnee;
  varying vec2 vUv;
  vec3 pick(vec2 uv) {
    vec3 c = min(texture2D(tColor, uv).rgb, vec3(12.0));
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    return c * max(soft, br - uThreshold) / max(br, 1e-4);
  }
  void main() {
    vec2 o = uTexel;
    gl_FragColor = vec4((pick(vUv + vec2(-o.x, -o.y)) + pick(vUv + vec2(o.x, -o.y)) + pick(vUv + vec2(-o.x, o.y)) + pick(vUv + vec2(o.x, o.y))) * 0.25, 1.0);
  }`;
const downFragment = /* glsl */`
  precision highp float;
  uniform sampler2D tColor; uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexel;
    vec3 c = texture2D(tColor, vUv).rgb * 4.0;
    c += texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb
       + texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, o.y)).rgb;
    gl_FragColor = vec4(c / 8.0, 1.0);
  }`;
const upFragment = /* glsl */`
  precision highp float;
  uniform sampler2D tColor; uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexel;
    vec3 c = texture2D(tColor, vUv + vec2(-2.0 * o.x, 0.0)).rgb + texture2D(tColor, vUv + vec2(2.0 * o.x, 0.0)).rgb
           + texture2D(tColor, vUv + vec2(0.0, -2.0 * o.y)).rgb + texture2D(tColor, vUv + vec2(0.0, 2.0 * o.y)).rgb;
    c += (texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, o.y)).rgb
        + texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb) * 2.0;
    gl_FragColor = vec4(c / 12.0, 1.0);
  }`;
const developFragment = /* glsl */`
  precision highp float;
  uniform sampler2D tColor, tGlow;
  uniform float uGlow, uExposure, uVignette;
  varying vec2 vUv;
  vec3 neutral(vec3 color) {                // Khronos PBR neutral tone mapping
    const float startCompression = 0.8 - 0.04, desaturation = 0.15;
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;
    float peak = max(color.r, max(color.g, color.b));
    if (peak < startCompression) return color;
    float d = 1.0 - startCompression;
    float newPeak = 1.0 - d * d / (peak + d - startCompression);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(color, vec3(newPeak), g);
  }
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb + texture2D(tGlow, vUv).rgb * uGlow;
    c = neutral(c * uExposure);
    // the grade: a gentle S through the middle, richer colour, warm lights and cool shadows
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, 1.14);
    c = clamp(c, 0.0, 1.0);
    vec3 s = c * c * (3.0 - 2.0 * c);
    c = mix(c, s, 0.22);
    c *= mix(vec3(0.97, 0.99, 1.04), vec3(1.035, 1.0, 0.955), smoothstep(0.1, 0.85, l));
    // the vignette: the corners fall away a little, which draws the eye to the middle
    vec2 v = vUv - 0.5;
    c *= 1.0 - uVignette * smoothstep(0.25, 0.95, dot(v, v) * 2.0);
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    #include <colorspace_fragment>
  }`;

function makePipeline(renderer, camera, { cine = false, levels = 5 } = {}) {
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene(); quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({
    uniforms, vertexShader: quadVertex, fragmentShader, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
  const hdr = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };

  const target = new THREE.WebGLRenderTarget(4, 4, { ...hdr, samples: 4, depthBuffer: true });
  if (cine) { target.depthTexture = new THREE.DepthTexture(4, 4); target.depthTexture.type = THREE.UnsignedIntType; }
  // the lens (Shorts)
  const blurred = cine ? new THREE.WebGLRenderTarget(4, 4, { ...hdr, depthBuffer: false }) : null;
  const sharp = cine ? new THREE.WebGLRenderTarget(4, 4, { ...hdr, depthBuffer: false }) : null;
  const unit = new THREE.Vector2();
  const lensMat = cine ? pass(cineFragment, {
    tColor: { value: target.texture }, tDepth: { value: target.depthTexture },
    uNear: { value: camera.near }, uFar: { value: camera.far },
    uFocusNear: { value: 4 }, uFocusFar: { value: 6 }, uAperture: { value: 1.5 }, uUnit: { value: unit } }) : null;
  const fillMat = cine ? pass(fillFragment, { tColor: { value: blurred.texture }, uUnit: { value: unit } }) : null;
  // the glow
  const chain = Array.from({ length: levels }, () => new THREE.WebGLRenderTarget(2, 2, { ...hdr, depthBuffer: false }));
  const bright = pass(brightFragment, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 }, uKnee: { value: 0.35 } });
  const down = pass(downFragment, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const up = pass(upFragment, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } },
    { blending: THREE.AdditiveBlending, transparent: true });
  const develop = pass(developFragment, { tColor: { value: null }, tGlow: { value: chain[0].texture },
    uGlow: { value: 0.085 }, uExposure: { value: 1.0 }, uVignette: { value: 0.2 } });

  const size = new THREE.Vector2(), p = new THREE.Vector3();
  let subjects = null;                       // () => [[x, y, z] | null, ...] in world space
  const draw = (mat, to) => { quad.material = mat; renderer.setRenderTarget(to); renderer.render(quadScene, quadCam); };
  /** the nearest and farthest subject on screen (metres from the lens), eased in as one enters the frame */
  function focus() {
    const list = (subjects ? subjects() : []).filter(Boolean).map(([x, y, z]) => {
      p.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      const d = -p.z; if (d < 0.4) return null;
      p.applyMatrix4(camera.projectionMatrix);
      const off = Math.max(Math.abs(p.x), Math.abs(p.y) * 0.8);        // 0 centre, 1 the frame's edge
      return { d, off, on: 1 - Math.min(1, Math.max(0, (off - 0.95) / 0.3)) };
    }).filter(Boolean);
    if (!list.length) return [5, 7];
    const main = list.reduce((a, b) => (b.off < a.off ? b : a));
    let near = main.d, far = main.d;
    for (const s of list) { const d = main.d + (s.d - main.d) * s.on; near = Math.min(near, d); far = Math.max(far, d); }
    return [near - 0.55, far + 0.75];                                // her body and yours are about a metre deep
  }
  return {
    develop,
    setSubjects(fn) { subjects = fn; },
    render(scene) {
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) {
        target.setSize(size.x, size.y);
        blurred?.setSize(size.x, size.y); sharp?.setSize(size.x, size.y);
        let w = size.x, h = size.y;
        for (const rt of chain) { w = Math.max(2, Math.round(w / 2)); h = Math.max(2, Math.round(h / 2)); rt.setSize(w, h); }
      }
      const autoClear = renderer.autoClear;
      renderer.autoClear = true;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      let frame = target.texture;
      if (cine) {
        camera.updateMatrixWorld();
        const [n, f] = focus();
        const u = lensMat.uniforms;
        u.uFocusNear.value = Math.max(0.5, n); u.uFocusFar.value = f;
        u.uNear.value = camera.near; u.uFar.value = camera.far;
        // the widest blur is 1.15% of the frame's height (22 px in a 1080x1920 frame), whatever the capture scale
        const k = 0.0115 / 16;
        unit.set(k * size.y / size.x, k);
        draw(lensMat, blurred);
        draw(fillMat, sharp);
        frame = sharp.texture;
      }
      // the glow: bright parts into the half-size buffer, halved down the chain, then added back up it
      bright.uniforms.tColor.value = frame; bright.uniforms.uTexel.value.set(0.5 / chain[0].width, 0.5 / chain[0].height);
      draw(bright, chain[0]);
      for (let i = 1; i < chain.length; i++) {
        down.uniforms.tColor.value = chain[i - 1].texture; down.uniforms.uTexel.value.set(1 / chain[i - 1].width, 1 / chain[i - 1].height);
        draw(down, chain[i]);
      }
      renderer.autoClear = false;
      for (let i = chain.length - 1; i > 0; i--) {
        up.uniforms.tColor.value = chain[i].texture; up.uniforms.uTexel.value.set(0.5 / chain[i].width, 0.5 / chain[i].height);
        draw(up, chain[i - 1]);
      }
      renderer.autoClear = true;
      develop.uniforms.tColor.value = frame;
      draw(develop, null);
      renderer.autoClear = autoClear;
    },
  };
}

/** Throws if WebGL cannot be created. */
export function createRenderer(canvas, { lowPower = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: lowPower ? 'low-power' : 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export async function createWorld({ renderer, modelUrl, phone = false, cine = false, finish = true }) {
  const scene = new THREE.Scene();
  // haze softens the far tiles; the plate's far edge still shows, like a real baseplate
  scene.fog = new THREE.Fog(PALETTE.haze.clone().lerp(PALETTE.horizon, 0.35), 70, 400);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3000);

  // sun: a warm afternoon sun, from the left behind the viewer's shoulder
  const sunDir = new THREE.Vector3(-0.62, 0.56, 0.48).normalize();
  const sky = makeSky(sunDir);
  scene.add(sky);

  // the sky lights the world (soft light from every side, and what shiny things reflect)
  try {
    scene.environment = makeEnvironment(renderer, sky);
    scene.environmentIntensity = 0.5;
  } catch (err) { console.warn('Glikdev: no sky light', err); }
  const lit = !!scene.environment;

  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, lit ? 0.42 : 1.3);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(PALETTE.sun, 5.2);
  sun.position.copy(sunDir).multiplyScalar(80);
  // soft shadows stay on for what the comments add; the empty plate itself casts none
  sun.castShadow = true;
  const size = phone ? 1024 : 2048;
  sun.shadow.mapSize.set(size, size);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 10; sc.far = 200;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.06;
  sun.shadow.radius = 5;
  scene.add(sun, sun.target);

  // a cool light from behind on the other side: it draws a bright edge round everything that stands on the plate
  const rim = new THREE.DirectionalLight('#cfe1ff', 1.5);
  rim.position.set(0.72, 0.3, -0.62).multiplyScalar(50);
  scene.add(rim);

  // the plate throws the sun back up: warm light under chins and bellies
  const bounce = new THREE.DirectionalLight('#ffe9d2', lit ? 0.55 : 1.1);
  bounce.position.set(-0.3, -1, 0.35).multiplyScalar(50);
  scene.add(bounce);

  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const model = gltf.scene;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = true;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const old = m.map;
      tileFloor(m);
      old?.dispose();
    }
  });
  scene.add(model);
  const plate = model.getObjectByName('Baseplate');

  const motes = makeMotes(phone ? 70 : 140);
  scene.add(motes);

  // the finishing pass needs a float buffer to draw into; without one the frame is drawn straight to the screen
  const canFloat = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  let pipeline = null;
  if (canFloat && (finish || cine)) {
    try { pipeline = makePipeline(renderer, camera, { cine, levels: phone ? 4 : 5 }); } catch (err) { console.warn('Glikdev: no finishing pass', err); pipeline = null; }
  }
  let finishing = !!pipeline;
  const applyQuality = () => { renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = finishing ? 1.0 : 1.02; };
  applyQuality();

  let animate = true;
  let shadowFocus = null;                  // () => Vector3: what the shadow box should centre on
  const px = new THREE.Vector2();
  function update(t) {
    sky.position.copy(camera.position);
    sky.material.uniforms.uTime.value = animate ? t : 0;
    motes.material.uniforms.uTime.value = animate ? t : 0;
    motes.material.uniforms.uEye.value.copy(camera.position);
    motes.material.uniforms.uPx.value = renderer.getDrawingBufferSize(px).y * 0.5;
    // the shadow box follows what casts shadows (the kitty, from Day 2), else the camera's ground focus
    const f = shadowFocus && shadowFocus();
    if (f) sun.target.position.set(f.x, 0, f.z);
    else sun.target.position.set(camera.position.x, 0, camera.position.z);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 80);
  }

  return {
    scene, camera, model, plate, sun, sunDir,
    update,
    setAnimate(on) { animate = on; },
    /** Centre the (smaller, sharper) shadow box on fn() instead of the camera. */
    setShadowFocus(fn, half = 16) {
      shadowFocus = fn;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
    },
    /** Shorts only: fn() returns the subjects' places ([[x, y, z] | null, ...]); the lens keeps them sharp. */
    setCineSubjects(fn) { pipeline?.setSubjects(fn); },
    /** is the frame being finished (glow, tones, grade), or drawn straight to the screen? */
    get finishing() { return finishing; },
    /** a slow device: the same world without the finishing pass (the film camera always keeps it) */
    setQuality(q) { finishing = !!pipeline && (q !== 'plain' || cine); applyQuality(); },
    render() {
      if (finishing) pipeline.render(scene);
      else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
    },
    resize(w, h, pixelRatio) {
      if (pixelRatio && renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
}
