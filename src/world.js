// The Day 1 world: renderer, daylight sky, sun, the Blender-built empty baseplate (models/day1.glb).
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

export async function createWorld({ renderer, modelUrl, phone = false }) {
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

  let animate = true;
  function update(t) {
    sky.position.copy(camera.position);
    sky.material.uniforms.uTime.value = animate ? t : 0;
    // the shadow box follows the camera's ground focus, so whatever gets built casts crisp shadows
    sun.target.position.set(camera.position.x, 0, camera.position.z);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 80);
  }

  return {
    scene, camera, model, plate, sun,
    update,
    setAnimate(on) { animate = on; },
    render() { renderer.render(scene, camera); },
    resize(w, h, pixelRatio) {
      if (pixelRatio && renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
}
