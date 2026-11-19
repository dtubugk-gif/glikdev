// The Day 1 world: renderer, daylight sky, sun, the Blender-built island (models/day1.glb).
// Everything that moves is a pure function of the time passed to update(t), so demo
// recordings are frame exact.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';

export const PALETTE = {
  zenith: new THREE.Color('#8fb4d9'),
  sky: new THREE.Color('#bcd3e8'),
  horizon: new THREE.Color('#f1e4cf'),
  haze: new THREE.Color('#e9e2d6'),
  cloud: new THREE.Color('#fbf8f2'),
  cloudShade: new THREE.Color('#b9c4d2'),
  sun: new THREE.Color('#fff1de'),
  hemiSky: new THREE.Color('#d6e5f3'),
  hemiGround: new THREE.Color('#b8ab98'),
};

// The island's top is the ground at y = 0. Its centre of mass sits a few metres lower.
export const ISLAND = { radius: 15.5, centreY: -3.2, topY: 0 };

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
    up = mix(uHorizon, up, smoothstep(-0.01, 0.17, y));
    up += vec3(0.06, 0.04, 0.01) * pow(sunAmt, 6.0) * (1.0 - smoothstep(0.0, 0.6, y));

    // high, thin clouds
    if (y > 0.0) {
      vec2 q = d.xz / (y + 0.18) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
      float c = smoothstep(0.55, 0.85, fbm(q * vec2(0.6, 1.6)));
      up = mix(up, mix(up, vec3(1.0), 0.55), c * smoothstep(0.02, 0.25, y) * 0.55);
    }

    // a sea of soft clouds far below the island
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
      float horizonFade = smoothstep(0.02, 0.3, depth);
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

/** Throws if WebGL cannot be created. */
export function createRenderer(canvas, { lowPower = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: lowPower ? 'low-power' : 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  return renderer;
}

export async function createWorld({ renderer, modelUrl, phone = false }) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.haze, 120, 420);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);

  // sun: late-morning, from the left behind the viewer's shoulder
  const sunDir = new THREE.Vector3(-0.62, 0.56, 0.48).normalize();
  const sky = makeSky(sunDir);
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(PALETTE.sun, 3.3);
  sun.position.copy(sunDir).multiplyScalar(60);
  sun.castShadow = true;
  const size = phone ? 1024 : 2048;
  sun.shadow.mapSize.set(size, size);
  const sc = sun.shadow.camera;
  sc.left = -19; sc.right = 19; sc.top = 19; sc.bottom = -19; sc.near = 20; sc.far = 110;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.09;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  // soft cool bounce from the opposite side so the shadowed walls keep their form
  const fill = new THREE.DirectionalLight('#c8d8ec', 0.45);
  fill.position.set(0.6, 0.15, -0.8).multiplyScalar(50);
  scene.add(fill);

  // the sunlit cloud sea below bounces a little light up into the hanging rock
  const bounce = new THREE.DirectionalLight('#eef1f5', 0.7);
  bounce.position.set(-0.3, -1, 0.35).multiplyScalar(50);
  scene.add(bounce);

  // invisible ground for future gameplay (pointer picks, walking): not visible art
  const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ visible: false }));
  ground.name = 'GroundCollider';
  scene.add(ground);

  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const model = gltf.scene;
  const rocks = [];
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o.material;
      if (m && m.map) m.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (m && o.name === 'Lettering') { m.polygonOffset = true; m.polygonOffsetFactor = -2; }
    }
    if (/^Rock_\d$/.test(o.name)) rocks.push({ obj: o, base: o.position.clone(), phase: rocks.length * 1.7 });
  });
  scene.add(model);
  const sign = model.getObjectByName('Signpost');

  let animate = true;
  function update(t) {
    sky.position.copy(camera.position);
    sky.material.uniforms.uTime.value = animate ? t : 0;
    for (const r of rocks) {
      const k = animate ? t : 0;
      r.obj.position.y = r.base.y + Math.sin(k * 0.55 + r.phase) * 0.35;
      r.obj.rotation.y = Math.sin(k * 0.12 + r.phase) * 0.25;
    }
  }

  return {
    scene, camera, model, sign, sun,
    update,
    setAnimate(on) { animate = on; },
    render() { renderer.render(scene, camera); },
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
}
