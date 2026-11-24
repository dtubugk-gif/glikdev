// The world: renderer, daylight sky, sun, the Blender-built baseplate (models/day1.glb).
// What the days add (the kitty from Day 2) lives in its own module and joins this scene.
// Everything that moves is a pure function of the time passed to update(t), so demo
// recordings are frame exact.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';

export const PALETTE = {
  zenith: new THREE.Color('#a9cfee'),
  sky: new THREE.Color('#c6e0f2'),
  horizon: new THREE.Color('#f1e4cf'),
  haze: new THREE.Color('#d7e6f1'),
  cloud: new THREE.Color('#fbf8f2'),
  cloudShade: new THREE.Color('#c4d3e2'),
  sun: new THREE.Color('#fff1de'),
  hemiSky: new THREE.Color('#d6e5f3'),
  hemiGround: new THREE.Color('#c9b9a0'),
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
  uniform vec3 uZenith, uSky, uHorizon, uHaze, uCloud, uCloudShade, uSunDir;
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

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    float sunAmt = max(dot(d, normalize(uSunDir)), 0.0);

    // upper sky: zenith blue to a warm horizon, a touch warmer toward the sun
    vec3 up = mix(uSky, uZenith, smoothstep(0.03, 0.5, y));
    up = mix(uHorizon, up, smoothstep(-0.01, 0.06, y));   // warm horizon: a thin band only
    up += vec3(0.06, 0.04, 0.01) * pow(sunAmt, 6.0) * (1.0 - smoothstep(0.0, 0.6, y));

    // high, thin clouds
    if (y > 0.0) {
      vec2 q = d.xz / (y + 0.18) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
      float c = smoothstep(0.55, 0.85, fbm(q * vec2(0.6, 1.6)));
      up = mix(up, mix(up, vec3(1.0), 0.55), c * smoothstep(0.02, 0.25, y) * 0.55);
    }

    // a sea of soft clouds far below the plate
    vec3 col = up;
    if (y < 0.04) {
      float depth = max(-y, 0.004);
      vec2 q = d.xz / depth * 1.5 + vec2(uTime * 0.006, uTime * 0.003);
      float n = fbm(q) * 0.75 + fbm(q * 3.1 + 4.0) * 0.25;
      float puff = smoothstep(0.36, 0.6, n);
      // lit tops toward the sun, blue-grey valleys between the puffs
      float lit = clamp(0.55 + 0.45 * dot(normalize(vec2(uSunDir.x, uSunDir.z)), normalize(d.xz + 1e-4)) * 0.4 + (n - 0.5) * 1.6, 0.0, 1.0);
      vec3 cloud = mix(uCloudShade, uCloud, lit);
      vec3 below = mix(uSky * 0.92, cloud, puff);
      float horizonFade = smoothstep(0.06, 0.35, depth);  // streaks near the horizon fade into haze
      below = mix(uHaze, below, horizonFade);
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
    uSunDir: { value: sunDir.clone() }, uTime: { value: 0 },
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

// ---------------------------------------------------------------------------------------------------------
// The film camera (Shorts only, ?cine=1): a lens with depth of field. The scene is drawn into a buffer with
// its depth, then one pass blurs every pixel by how far it is from the plane the subjects stand in. The
// subjects (the kitty, you) stay sharp; the plate behind them and anything close to the lens go soft.
// Stateless: the focus is a pure function of where the subjects are on this frame.
const cineVertex = /* glsl */`
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
      col += mix(col / tot, texture2D(tColor, uv).rgb, m); tot += 1.0;
    }
    gl_FragColor = vec4(col / tot, sc / MAXR);              // alpha: how blurred this pixel is (0-1), for the fill pass
  }`;
// the fill pass: a small soft blur over the blurred areas only (it closes the gaps between the lens samples),
// then tone mapping and the screen's colour space
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
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function makeCine(renderer, camera) {
  const target = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType, depthBuffer: true });
  target.depthTexture = new THREE.DepthTexture(4, 4);
  target.depthTexture.type = THREE.UnsignedIntType;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: target.texture }, tDepth: { value: target.depthTexture },
      uNear: { value: camera.near }, uFar: { value: camera.far },
      uFocusNear: { value: 4 }, uFocusFar: { value: 6 }, uAperture: { value: 1.5 }, uUnit: { value: new THREE.Vector2() },
    },
    vertexShader: cineVertex, fragmentShader: cineFragment, depthTest: false, depthWrite: false,
  });
  const blurred = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  const fill = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: blurred.texture }, uUnit: mat.uniforms.uUnit },
    vertexShader: cineVertex, fragmentShader: fillFragment, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene(); quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2(), p = new THREE.Vector3();
  let subjects = null;                       // () => [[x, y, z] | null, ...] in world space
  return {
    setSubjects(fn) { subjects = fn; },
    /** the nearest and farthest subject on screen (metres from the lens), eased in as one enters the frame */
    focus() {
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
    },
    render(scene) {
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) { target.setSize(size.x, size.y); blurred.setSize(size.x, size.y); }
      camera.updateMatrixWorld();
      const [n, f] = this.focus();
      const u = mat.uniforms;
      u.uFocusNear.value = Math.max(0.5, n); u.uFocusFar.value = f;
      u.uNear.value = camera.near; u.uFar.value = camera.far;
      // the widest blur is 1.15% of the frame's height (22 px in a 1080x1920 frame), whatever the capture scale
      const unit = 0.0115 / 16;
      u.uUnit.value.set(unit * size.y / size.x, unit);
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      quad.material = mat; renderer.setRenderTarget(blurred); renderer.render(quadScene, quadCam);
      quad.material = fill; renderer.setRenderTarget(null); renderer.render(quadScene, quadCam);
    },
  };
}

/** Throws if WebGL cannot be created. */
export function createRenderer(canvas, { lowPower = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: lowPower ? 'low-power' : 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export async function createWorld({ renderer, modelUrl, phone = false, cine = false }) {
  const scene = new THREE.Scene();
  // haze softens the far grid; the plate's far edge still shows, like a real baseplate
  scene.fog = new THREE.Fog(PALETTE.haze, 60, 360);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3000);

  // sun: late morning, from the left behind the viewer's shoulder
  const sunDir = new THREE.Vector3(-0.62, 0.56, 0.48).normalize();
  const sky = makeSky(sunDir);
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.3);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(PALETTE.sun, 4.0);
  sun.position.copy(sunDir).multiplyScalar(80);
  // soft shadows stay on for what the comments add; the empty plate itself casts none
  sun.castShadow = true;
  const size = phone ? 1024 : 2048;
  sun.shadow.mapSize.set(size, size);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 10; sc.far = 200;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.06;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight('#d2e0f0', 0.8);
  fill.position.set(0.6, 0.15, -0.8).multiplyScalar(50);
  scene.add(fill);

  const bounce = new THREE.DirectionalLight('#eef1f5', 1.1);
  bounce.position.set(-0.3, -1, 0.35).multiplyScalar(50);
  scene.add(bounce);

  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const model = gltf.scene;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m.map) continue;
      // the grid tile repeats 64x across the plate: mipmaps + full anisotropy keep the far lines calm
      m.map.anisotropy = maxAniso;
      m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
      m.map.minFilter = THREE.LinearMipmapLinearFilter;
      m.map.generateMipmaps = true;
      m.map.needsUpdate = true;
    }
  });
  scene.add(model);
  const plate = model.getObjectByName('Baseplate');
  const lens = cine ? makeCine(renderer, camera) : null;      // Shorts only: the film camera

  let animate = true;
  let shadowFocus = null;                  // () => Vector3: what the shadow box should centre on
  function update(t) {
    sky.position.copy(camera.position);
    sky.material.uniforms.uTime.value = animate ? t : 0;
    // the shadow box follows what casts shadows (the kitty, from Day 2), else the camera's ground focus
    const f = shadowFocus && shadowFocus();
    if (f) sun.target.position.set(f.x, 0, f.z);
    else sun.target.position.set(camera.position.x, 0, camera.position.z);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 80);
  }

  return {
    scene, camera, model, plate, sun,
    update,
    setAnimate(on) { animate = on; },
    /** Centre the (smaller, sharper) shadow box on fn() instead of the camera. */
    setShadowFocus(fn, half = 16) {
      shadowFocus = fn;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
    },
    /** Shorts only: fn() returns the subjects' places ([[x, y, z] | null, ...]); the lens keeps them sharp. */
    setCineSubjects(fn) { lens?.setSubjects(fn); },
    render() { if (lens) lens.render(scene); else renderer.render(scene, camera); },
    resize(w, h, pixelRatio) {
      if (pixelRatio && renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
}
