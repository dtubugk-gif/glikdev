// Day 2: the kitty in the world (idea by @lifediamond888). Loads models/kitty.glb and models/toys.glb
// (both built in Blender: art/day02), plays her clips as kittybrain.js decides, turns her head toward
// the camera, and draws everything around her: the food bowl emptying as she eats, the rolling yarn,
// hearts when she is happy, Zzz while she naps, a paw print where she was called.
//
// Two ways to run it:
//   advance(dt)     live play: real time, stepped in fixed STEPs
//   simulateTo(t)   recordings: the kitty at exactly t seconds (re-simulated from 0 when t goes back)
// then finish(viewer, steps) once the camera is placed (head turn + effects).
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { createBrain, KITTY, STEP, YARN } from './kittybrain.js';

const FADE = 0.28;                 // seconds of crossfade between clips (a clip may ask for its own)
const LIFT = 0.0008;               // the paw pads' depth below the toe joints at real size (m)
const LOOK = { idle: 1, sit: 1, face: 0.8, sitdown: 0.45, meow: 0.35, purr: 0.2, standup: 0.3, groom: 0.1,
  trot: 0.35, walk: 0.25, run: 0.15, pounce: 0.6, bat: 0.5, stretch: 0 };

function blobTexture() {                       // a soft round contact shadow
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(38,32,28,0.9)');
  r.addColorStop(0.55, 'rgba(38,32,28,0.45)');
  r.addColorStop(1, 'rgba(38,32,28,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// footfalls within each gait clip (fraction of the loop): walk = one paw at a time, trot = diagonal pairs,
// run = the gallop's four beats (left hind, left fore, right fore, right hind)
const FOOTFALLS = { Walk: [0, 0.25, 0.5, 0.75], Trot: [0, 0.5], Run: [0, 0.44, 0.53, 0.91] };

function spriteTexture(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const heartTexture = () => spriteTexture((g) => {
  g.translate(64, 68);
  const heart = () => {
    g.beginPath();
    g.moveTo(0, 38);
    g.bezierCurveTo(-58, 2, -46, -48, 0, -22);
    g.bezierCurveTo(46, -48, 58, 2, 0, 38);
    g.closePath();
  };
  g.lineJoin = 'round';
  heart(); g.lineWidth = 12; g.strokeStyle = '#fff8ec'; g.stroke();
  heart(); g.fillStyle = '#f06b78'; g.fill();
  g.lineWidth = 5; g.strokeStyle = '#2f2620'; g.stroke();
  g.beginPath(); g.ellipse(-20, -14, 9, 6, -0.6, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
});

const zTexture = () => spriteTexture((g, s) => {
  g.font = `700 ${s * 0.78}px Fredoka, 'Rubik', sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 14; g.strokeStyle = '#2f2620'; g.strokeText('z', s / 2, s / 2 + 4);
  g.fillStyle = '#fff8ec'; g.fillText('z', s / 2, s / 2 + 4);
});

const pawTexture = () => spriteTexture((g) => {
  const blob = (x, y, rx, ry, rot) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); };
  const shapes = [[128, 160, 52, 44, 0], [64, 96, 21, 27, -0.35], [104, 66, 22, 29, -0.12], [152, 66, 22, 29, 0.12], [192, 96, 21, 27, 0.35]];
  for (const pass of [0, 1]) {
    for (const s of shapes) {
      blob(...s);
      if (pass === 0) { g.lineWidth = 16; g.strokeStyle = 'rgba(47,38,32,0.9)'; g.stroke(); }
      else { g.fillStyle = '#fff8ec'; g.fill(); }
    }
  }
}, 256);

const easeOutBack = (k) => { const x = Math.min(1, Math.max(0, k)) - 1; return 1 + 2.7 * x ** 3 + 1.7 * x ** 2; };

/**
 * Fur: `layers` thin shells of her body, each pushed out along the (skinned) normal and drawing only
 * the strands that reach that height. Strands are cells on a UV grid with their own length and lean;
 * they taper to the tip, are darker at the root and a touch lighter at the tip, and lean back and down
 * with gravity. kitty_fur.png says how long the fur is everywhere (none on the nose, round the eyes,
 * inside the ears or under the paws). Shells use a plain standard material and cast no shadows.
 */
function addFur(body, furMap, layers) {
  const base = body.material;
  const shells = [];
  for (let i = 1; i <= layers; i++) {
    const h = i / layers;
    const m = new THREE.MeshStandardMaterial({
      map: base.map, normalMap: base.normalMap, normalScale: base.normalScale, roughness: 1,
      roughnessMap: base.roughnessMap, alphaTest: 0.5, alphaToCoverage: true,
    });
    const uni = { uFurH: { value: h }, uFurLen: { value: 0.0072 }, uFurMap: { value: furMap }, uDensity: { value: 240 } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uFurH; uniform float uFurLen; uniform sampler2D uFurMap; varying float vFurL;`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>
{
  float L = texture2D(uFurMap, uv).r * 1.5;
  vFurL = L;
  float d = uFurLen * L * uFurH;
  vec3 n = normalize(objectNormal);
  // combed back and down a little more toward the tips (model space: +Z is her front, +Y up)
  vec3 comb = normalize(vec3(0.0, -0.55, -1.0));
  transformed += n * d + comb * d * uFurH * 0.55;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uFurH; uniform float uDensity; varying float vFurL;
float furHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec2 g = vMapUv * uDensity;
  vec2 c = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 off = (vec2(furHash(c), furHash(c + 17.3)) - 0.5) * 0.45;
  float len = 0.45 + 0.55 * furHash(c + 5.1);           // every strand its own length
  float rad = 0.5 * (1.0 - uFurH / max(len, 0.01));      // tapering to a point
  float dist = length(f - off);
  float a = (uFurH > len || vFurL < 0.03) ? 0.0 : smoothstep(rad, rad * 0.4, dist);
  // fur reads at the outline: full strength where the surface turns away, faint where it faces you
  float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
  a *= mix(1.0, 0.22, smoothstep(0.15, 0.85, facing));
  diffuseColor.a *= a;
  diffuseColor.rgb *= mix(0.74, 0.97, uFurH);            // shade at the roots, never brighter than the coat
}`);
    };
    m.customProgramCacheKey = () => 'kitty-fur';
    const shell = new THREE.SkinnedMesh(body.geometry, m);
    shell.name = `Fur${i}`;
    shell.bind(body.skeleton, body.bindMatrix);
    shell.position.copy(body.position); shell.quaternion.copy(body.quaternion); shell.scale.copy(body.scale);
    shell.castShadow = false;
    shell.receiveShadow = true;
    shell.frustumCulled = false;
    shell.renderOrder = i;
    body.parent.add(shell);
    shells.push(shell);
  }
  return shells;
}

/**
 * @param {{scene:THREE.Scene, url:string, toysUrl:string, start?:object, seed?:number,
 *          mind?:object, script?:{t:number,type:string,x?:number,z?:number}[], viewer?:number[], renderer?:THREE.WebGLRenderer,
 *          needs?:{hunger:number, happy:number}}} o
 */
const CLIPS = ['Idle', 'Walk', 'Trot', 'Run', 'Sit', 'SitIdle', 'Purr', 'Meow', 'Eat', 'Groom', 'Stretch', 'Sleep', 'Pounce', 'Bat'];

/** Everything a cat model needs; throws (before anything changes) when one is missing. */
function checkCat(gltf, url) {
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  for (const need of CLIPS) if (!clips[need]) throw new Error(`${url} has no ${need} clip`);
  for (const b of ['head', 'neck', 'spine', 'chest']) if (!gltf.scene.getObjectByName(b)) throw new Error(`${url} has no ${b} bone`);
  return clips;
}

function disposeTree(obj) {
  const seen = new Set();
  obj.traverse((m) => {
    if (!m.isMesh) return;
    if (!seen.has(m.geometry)) { seen.add(m.geometry); m.geometry.dispose(); }
    for (const mat of [].concat(m.material)) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      for (const v of Object.values(mat)) if (v?.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); }
      mat.dispose();
    }
  });
}

export async function createKitty(o) {
  const loader = new GLTFLoader();
  const loadFur = (url) => (url ? new THREE.TextureLoader().loadAsync(url).catch(() => null) : Promise.resolve(null));
  // Day 5: a fur skin = her own coat in another colour (o.skin = {url, lid}: the coat's picture, and the colour of
  // her eyelids to go with it). A skin that does not load leaves her in her own coat.
  const loadSkin = (skin) => (skin?.url ? new THREE.TextureLoader().loadAsync(skin.url).then((map) => ({ map, lid: skin.lid })).catch(() => null) : Promise.resolve(null));
  const [gltf, toys, furMap, skin0] = await Promise.all([loader.loadAsync(o.url), loader.loadAsync(o.toysUrl), loadFur(o.furUrl), loadSkin(o.skin)]);
  const S = KITTY.scale;
  const aniso = Math.min(8, o.renderer?.capabilities.getMaxAnisotropy() ?? 1);
  const shadowy = (obj) => obj.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    for (const mat of [].concat(m.material)) if (mat.map) mat.map.anisotropy = aniso;
  });

  const root = new THREE.Group();
  root.name = 'Kitty';
  // the cat herself: the Day 2 ginger kitty, or one of the other cats (same skeleton and clips)
  let model, clips, B, headScale = 1;                     // headScale: a bigger head on the same body (kitten proportions)
  const bone = (n) => model.getObjectByName(n);
  function mount(g, fur, furLayers, skin = null) {
    clips = checkCat(g, 'the cat');
    model = g.scene;
    model.name = 'Cat';
    model.scale.setScalar(S);
    model.position.y = LIFT * S;
    root.add(model);
    shadowy(model);
    let body = null;
    model.traverse((m) => {
      if (!m.isMesh) return;
      m.frustumCulled = false;                   // skinned: the bind-pose bounds do not follow her
      if (/whisker/i.test(m.name) || /whisker/i.test(m.material?.name ?? '')) m.castShadow = false;
      if (m.isSkinnedMesh && m.material?.name === 'M_Kitty') body = m;
    });
    if (body && skin) {
      const old = body.material.map;
      skin.map.flipY = false;                    // same UV convention as the glTF's own textures
      skin.map.colorSpace = THREE.SRGBColorSpace;
      skin.map.anisotropy = aniso;
      if (old) { skin.map.wrapS = old.wrapS; skin.map.wrapT = old.wrapT; }
      body.material.map = skin.map;
      body.material.needsUpdate = true;
      old?.dispose();
      if (skin.lid) model.traverse((m) => { if (m.isMesh && m.material?.name === 'M_Lid') m.material.color.set(skin.lid); });
    }
    if (body && fur && (furLayers ?? 10) > 0) {
      fur.flipY = false;                         // same UV convention as the glTF's own textures
      fur.colorSpace = THREE.NoColorSpace;
      addFur(body, fur, furLayers ?? 10);
    }
    B = { head: bone('head'), neck: bone('neck'), spine: bone('spine'), chest: bone('chest'),
      ears: [bone('ear_L'), bone('ear_R')], paws: ['frontpaw_L', 'frontpaw_R', 'hindpaw_L', 'hindpaw_R'].map(bone) };
  }
  /** A bone of the current cat with its inverse bind matrix (model space at rest -> the bone's own space). */
  function boneBind(name) {
    let found = null;
    model.traverse((m) => {
      if (found || !m.isSkinnedMesh) return;
      const i = m.skeleton.bones.findIndex((b) => b.name === name);
      if (i >= 0) found = { bone: m.skeleton.bones[i], inverse: m.skeleton.boneInverses[i] };
    });
    return found;
  }
  checkCat(gltf, o.url);
  headScale = o.headScale ?? 1;
  mount(gltf, furMap, o.furLayers, skin0);
  o.scene.add(root);

  // her things
  const bowl = new THREE.Group();
  bowl.name = 'BowlSet';
  const kibble = [];
  for (const n of ['Bowl', 'Kibble_1', 'Kibble_2', 'Kibble_3']) {
    const m = toys.scene.getObjectByName(n);
    if (!m) throw new Error(`toys.glb has no ${n}`);
    bowl.add(m);
    if (n !== 'Bowl') kibble.push(m);
  }
  bowl.scale.setScalar(S);
  bowl.visible = false;
  shadowy(bowl);
  o.scene.add(bowl);
  const yarn = toys.scene.getObjectByName('Yarn');
  if (!yarn) throw new Error('toys.glb has no Yarn');
  yarn.position.set(0, 0, 0);
  const yarnRoot = new THREE.Group();
  yarnRoot.name = 'YarnBall';
  yarnRoot.add(yarn);
  yarnRoot.scale.setScalar(S * YARN.scale);
  yarnRoot.visible = false;
  shadowy(yarnRoot);
  o.scene.add(yarnRoot);

  // ---------------------------------------------------------------- effects
  const fx = new THREE.Group();
  fx.name = 'KittyFX';
  o.scene.add(fx);
  const pool = (tex, k) => Array.from({ length: k }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    s.visible = false;
    fx.add(s);
    return s;
  });
  const hearts = pool(heartTexture(), 12);
  // contact shadows: one soft blob under her body, one under each paw (they fade as a paw lifts)
  const blobTex = blobTexture();
  const blob = (w, d, o) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({
      map: blobTex, transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, fog: true }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    fx.add(m);
    return m;
  };
  const bodyBlob = blob(1, 1, 0.42);
  const yarnBlob = blob(YARN.radius * 2.6, YARN.radius * 2.6, 0.5);   // under the yarn: shows how high it flies
  yarnBlob.visible = false;
  const pawBlobs = B.paws.map(() => blob(0.05 * KITTY.scale, 0.06 * KITTY.scale, 0.5));
  const zees = pool(zTexture(), 4);
  const paw = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({
    map: pawTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  paw.rotation.x = -Math.PI / 2;
  paw.position.y = 0.05;
  paw.visible = false;
  paw.renderOrder = 2;
  fx.add(paw);

  // ---------------------------------------------------------------- state
  let brain, mixer, actions, cur, curKey, heartLog, callLog, bowlLog, scriptAt, look, lastSpin, homeHooks = null;
  let bed = null;                                // Day 3: her bed (town.js BED_SPOT), so she stands and lies ON its cushion
  // Day 3: the toy that is out (it takes the yarn's place): does it roll, how well does it bounce
  const toy = { roll: true, bounce: undefined, yaw: 0 };
  let wandOn = false, wandTip = null;            // Day 4: the fish on a stick is out; where the stick's tip is
  const UP = new THREE.Vector3(0, 1, 0);
  const listeners = [];
  const startOpts = { seed: o.seed ?? 2, ...o.start, viewer: o.viewer, ...(o.needs || {}), mind: o.mind || null };
  const yq = new THREE.Quaternion(), dq = new THREE.Quaternion(), axis = new THREE.Vector3();

  function newMixer() {
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
    mixer = new THREE.AnimationMixer(model);
    actions = Object.fromEntries(Object.entries(clips).map(([n, c]) => [n, mixer.clipAction(c)]));
    cur = null; curKey = '';
  }

  function reset() {
    // a recording starts her mind afresh every time it starts over (o.mind is then a function that makes one)
    brain = createBrain({ ...startOpts, mind: typeof o.mind === 'function' ? o.mind() : o.mind || null });
    brain.toyBounce = toy.bounce;
    brain.bed = bed;
    if (homeHooks) Object.assign(brain, homeHooks);       // Day 8: the way round the house (kept over a restart)
    brain.wandTip = wandTip;
    if (wandOn) brain.setWand(true);
    newMixer();
    heartLog = []; callLog = null; bowlLog = null; scriptAt = 0; lastSpin = 0;
    look = { yaw: 0, pitch: 0, w: 0 };
    yq.identity();
    play(brain.anim(), true);
    mixer.update(0);
    if (headScale !== 1) B.head.scale.setScalar(headScale);
    place();
    emitOut({ t: 0, type: 'reset' });            // a recording starting over: listeners start over too
  }

  /** Change cats in place: she keeps her name, needs, spot and whatever she is doing. */
  async function setCat({ url, furUrl, furLayers, key, headScale: headScaleNew, skin }) {
    const [g, fur, skinNew] = await Promise.all([loader.loadAsync(url), loadFur(furUrl), loadSkin(skin)]);
    checkCat(g, url);                            // a broken file leaves the current cat as she is
    const was = cur ? { name: cur.getClip().name, time: cur.time } : null;
    const old = model;
    emitOut({ t: brain.t, type: 'cat-out' });    // what she wears comes off the old skeleton first
    root.remove(old);
    headScale = headScaleNew ?? 1;
    mount(g, fur, furLayers, skinNew);
    newMixer();
    play(brain.anim(), true);
    if (was && cur.getClip().name === was.name) cur.time = Math.min(was.time, cur.getClip().duration);
    mixer.update(0);
    look.w = 0;                                  // the head turn eases back in on the new skeleton
    disposeTree(old);
    emitOut({ t: brain.t, type: 'cat-in', cat: key });
  }

  function play(a, instant = false) {
    const key = `${a.name}${a.rate < 0 ? '<' : '>'}`;
    const act = actions[a.name];
    if (key === curKey) { if (!a.once) act.timeScale = a.rate; return; }
    if (cur === act) {                           // the same clip changing direction (sitting down -> standing up)
      act.paused = false;
      act.timeScale = a.rate;
      act.setLoop(a.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      curKey = key;
      return;
    }
    act.reset();
    act.setLoop(a.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    act.clampWhenFinished = true;
    act.timeScale = a.rate;
    act.setEffectiveWeight(1);
    if (a.rate < 0) act.time = act.getClip().duration;
    act.play();
    if (cur && !instant) act.crossFadeFrom(cur, a.fade ?? FADE, false);
    else if (cur) cur.stop();
    cur = act; curKey = key;
  }

  function place() {
    let lift = 0;                                // on her bed she is up on the cushion; the step up is eased over the bolster
    if (bed) {
      const d = Math.hypot(brain.x - bed.x, brain.z - bed.z), k = Math.min(1, Math.max(0, (bed.outer - d) / (bed.outer - bed.r * 0.7)));
      lift = bed.h * k * k * (3 - 2 * k);
    }
    root.position.set(brain.x, lift, brain.z);
    root.rotation.y = brain.heading;
  }

  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  function emitOut(e) { for (const fn of listeners) fn(e); }

  function addHearts(t, n = 3) {
    root.updateMatrixWorld(true);
    B.head.getWorldPosition(v1);
    for (let k = 0; k < n; k++) heartLog.push({ t: t + k * 0.22, x: v1.x, y: v1.y + 1.2, z: v1.z, k: heartLog.length });
  }

  function onEvent(e) {
    if (e.type === 'pet' || e.type === 'eaten') addHearts(e.t);
    if (e.type === 'swat' && e.round >= 3) addHearts(e.t, 2);
    if (e.type === 'call') callLog = { t: e.t, x: e.x, z: e.z, end: Infinity };
    if (e.type === 'arrive' && callLog && callLog.end === Infinity) callLog.end = e.t + 0.6;
    if (e.type === 'bowl') bowlLog = { t: e.t, x: e.x, z: e.z, gone: Infinity };
    if (e.type === 'bowl-gone' && bowlLog) bowlLog.gone = e.t;
    if (e.type === 'refill' && bowlLog) bowlLog.refill = e.t;
    emitOut(e);
  }

  function footsteps(prevT) {                    // paw contacts inside the gait clips -> 'step' events
    const name = cur?.getClip().name;
    const marks = FOOTFALLS[name];
    if (!marks || cur.getEffectiveWeight() < 0.5) return;
    const d = cur.getClip().duration;
    const a = (prevT % d) / d, b2 = (cur.time % d) / d;
    for (const m of marks) {
      const hit = a <= b2 ? (m > a && m <= b2) : (m > a || m <= b2);
      if (hit) emitOut({ t: brain.t, type: 'step', strong: name !== 'Walk' });
    }
  }

  function tick() {                              // one fixed step of brain + animation
    if (o.script) {
      while (scriptAt < o.script.length && o.script[scriptAt].t <= brain.t + 1e-6) {
        const s = o.script[scriptAt++];
        if (s.type === 'call') brain.call(s.x, s.z);
        else if (s.type === 'pet') brain.pet();
        else if (s.type === 'meow') brain.meow();
        else if (s.type === 'walk') brain.walkTo(s.x, s.z);
        else if (s.type === 'feed') brain.feed();
        else if (s.type === 'play') brain.play();
        else if (s.type === 'nap') brain.nap();
        else if (s.type === 'tobed') brain.toBed({ snuggle: s.snuggle !== false });   // Day 8: bedtime
        else if (s.type === 'wakeup') brain.wakeUp();
        else if (s.type === 'cast') brain.cast(s.x, s.z);
        else if (s.type === 'castnear') brain.castNear();
        else if (s.type === 'dangle') brain.dangle();
        else emitOut({ t: brain.t, type: 'script', what: s });   // not hers: for whoever is listening (Day 3: 'wear')
      }
    }
    brain.step(STEP);
    play(brain.anim());
    const prevT = cur.time;
    mixer.update(STEP);
    if (headScale !== 1) B.head.scale.setScalar(headScale);
    footsteps(prevT);
    place();
    // the yarn rolls: turn it by the distance it travelled, about the axis across its path
    const y = brain.yarn;
    if (y) {
      const d = y.spin - lastSpin;
      lastSpin = y.spin;
      if (!toy.roll) {                           // a mouse or a fish slides nose first, and wriggles as it goes
        const v = Math.hypot(y.vx, y.vz);
        if (v > 0.4) toy.yaw = Math.atan2(y.vx, y.vz);
        else if (y.held && Math.hypot(y.hx - y.x, y.hz - y.z) > 0.05) toy.yaw = Math.atan2(y.hx - y.x, y.hz - y.z);
        yq.setFromAxisAngle(UP, toy.yaw + 0.22 * Math.sin(y.spin * 0.9) * Math.min(1, v / 3));
      } else if (d) { axis.set(y.ax, 0, y.az).normalize(); dq.setFromAxisAngle(axis, d); yq.premultiply(dq); }
    }
    for (const e of brain.drain()) onEvent(e);
  }

  // head and neck turn toward what she is interested in: the bowl or the yarn when she is after them,
  // otherwise the camera (after the clip has posed the skeleton)
  const tgt = new THREE.Vector3();
  function lookTarget(viewer) {
    const y = brain.yarn, bw = brain.bowl;
    // (the fish hanging from your stick: she watches it while it is near, and you the rest of the time)
    const dangling = y && y.hang && Math.hypot(y.x - brain.x, y.z - brain.z) < 13 && brain.t % 9 < 5.5;
    const chasing = y && ((y.held && !y.hang) || dangling || y.air || brain.goal === 'yarn' || ['pounce', 'bat'].includes(brain.mode) || brain.face?.then === 'pounce');
    if (chasing) return tgt.set(y.x, y.y, y.z);
    if (bw && bw.eatenAt == null && (brain.goal === 'eat' || brain.face?.then === 'eat')) return tgt.set(bw.x, 0.6, bw.z);
    if (['walk', 'trot', 'run'].includes(brain.mode)) return null;   // on the move: eyes ahead
    const pal = brain.palLook;                                       // Day 6: her friend is right there
    if (pal && pal.until > brain.t) return tgt.set(pal.x, pal.y, pal.z);
    return viewer;
  }
  function lookAt(viewer, dt) {
    const target = lookTarget(viewer);
    const snub = brain.snub > brain.t && !['walk', 'trot', 'run', 'pounce', 'bat', 'eat', 'sleep', 'liedown'].includes(brain.mode);
    const palOn = !!(brain.palLook && brain.palLook.until > brain.t && !['walk', 'trot', 'run'].includes(brain.mode));
    const wantW = snub ? 1 : target ? Math.max(LOOK[brain.mode] ?? 0, palOn ? 0.75 : 0) : 0;      // she said no: her nose goes up and away
    look.w += (wantW - look.w) * (1 - Math.exp(-dt * 3));
    if (look.w < 0.01) return;
    const t = target || viewer;
    if (!t) return;
    root.updateMatrixWorld(true);
    B.head.getWorldPosition(v1);
    let yaw = Math.atan2(t.x - v1.x, t.z - v1.z) - brain.heading;
    yaw = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const pitch = Math.atan2(t.y - v1.y, Math.hypot(t.x - v1.x, t.z - v1.z));
    let ty = Math.max(-0.95, Math.min(0.95, yaw)) * (Math.abs(yaw) > 2.4 ? 0 : 1);
    let tp = Math.max(-0.45, Math.min(0.45, pitch * 0.8));
    if (snub) { ty = yaw >= 0 ? -0.95 : 0.95; tp = 0.3; }             // away from whoever asked, chin up
    const k = 1 - Math.exp(-dt * 5);
    look.yaw += (ty - look.yaw) * k;
    look.pitch += (tp - look.pitch) * k;
    const up = v2.set(0, 1, 0);
    const right = new THREE.Vector3(Math.cos(brain.heading), 0, -Math.sin(brain.heading));
    const turn = (b, yawAmt, pitchAmt) => {
      q1.setFromAxisAngle(up, yawAmt * look.w).multiply(q2.setFromAxisAngle(right, -pitchAmt * look.w));
      b.parent.getWorldQuaternion(q2);
      const d = q2.clone().invert().multiply(q1).multiply(q2);
      b.quaternion.premultiply(d);
      b.updateMatrixWorld(true);
    };
    turn(B.neck, look.yaw * 0.4, look.pitch * 0.35);
    turn(B.head, look.yaw * 0.6, look.pitch * 0.65);
  }

  // every few seconds one ear flicks (timing from her own clock, so recordings stay identical)
  function earFlicks() {
    const t = brain.t;
    if (brain.mode === 'sleep' && t % 7 > 0.4) return;
    const slot = Math.floor(t / 3.1);
    const h = Math.sin(slot * 91.7) * 43758.5453;
    const r = h - Math.floor(h);
    const start = slot * 3.1 + r * 1.6, a = t - start;
    if (a < 0 || a > 0.28) return;
    const ear = B.ears[r < 0.5 ? 0 : 1];
    if (!ear) return;
    const amt = Math.sin((a / 0.28) * Math.PI) * 0.45;
    ear.getWorldQuaternion(q2);
    const axis = v2.set(r < 0.5 ? -1 : 1, 0.2, 0).normalize();
    q1.setFromAxisAngle(axis, amt);
    ear.quaternion.multiply(q1);
    ear.updateMatrixWorld(true);
  }

  function drawFX() {
    const now = brain.t;
    root.updateMatrixWorld(true);
    const S2 = KITTY.scale;
    const lowBody = ['sit', 'sitdown', 'purr', 'meow', 'groom', 'liedown', 'sleep'].includes(brain.mode);
    bodyBlob.position.set(brain.x, 0.04, brain.z);
    bodyBlob.rotation.z = brain.heading;
    bodyBlob.scale.set(lowBody ? 0.26 * S2 : 0.2 * S2, lowBody ? 0.36 * S2 : 0.52 * S2, 1);
    B.paws.forEach((b, k) => {
      const pb = pawBlobs[k];
      if (!b) { pb.visible = false; return; }
      b.getWorldPosition(v1);
      const h = Math.max(0, v1.y - 0.03 * S2);
      pb.position.set(v1.x, 0.045, v1.z);
      pb.material.opacity = 0.5 * Math.max(0, 1 - h / (0.05 * S2));
      pb.visible = pb.material.opacity > 0.02;
    });
    // hearts
    let i = 0;
    for (const h of heartLog) {
      const a = now - h.t;
      if (a < 0 || a > 1.7 || i >= hearts.length) continue;
      const s = hearts[i++];
      const side = ((h.k * 7) % 5 - 2) * 0.55;
      s.visible = true;
      s.position.set(h.x + side + Math.sin(a * 5 + h.k) * 0.25, h.y + a * 3.2, h.z);
      const pop = Math.min(1, a / 0.18);
      s.scale.setScalar((0.6 + 0.9 * pop - 0.15 * Math.max(0, a - 1.1)) * 1.5);
      s.material.opacity = Math.min(1, 1.6 - a);
    }
    for (; i < hearts.length; i++) hearts[i].visible = false;
    heartLog = heartLog.filter((h) => now - h.t < 2);
    // Zzz: one every 1.1 s while she sleeps, drifting up and away from her head
    const asleep = brain.mode === 'sleep';
    root.updateMatrixWorld(true);
    B.head.getWorldPosition(v1);
    zees.forEach((z, k) => {
      const a = ((now + k * 1.1) % 4.4) / 4.4;
      z.visible = asleep;
      if (!asleep) return;
      z.position.set(v1.x + 2.2 + a * 3.0 + Math.sin(a * 9 + k) * 0.4, v1.y + 0.8 + a * 4.2, v1.z);
      z.scale.setScalar(1.1 + a * 1.6);
      z.material.opacity = Math.min(1, a * 6) * (1 - a);
    });
    // the paw print where she was called
    if (callLog && now - callLog.t < 8) {
      const a = now - callLog.t, out = now - callLog.end;
      paw.visible = out < 0.6;
      paw.position.set(callLog.x, 0.05, callLog.z);
      paw.scale.setScalar(Math.max(0.01, easeOutBack(a / 0.3)));
      paw.material.opacity = 0.92 * (out > 0 ? Math.max(0, 1 - out / 0.6) : 1);
      paw.rotation.z = -Math.atan2(callLog.x - brain.x, callLog.z - brain.z) + Math.PI;
    } else paw.visible = false;
    // the bowl: pops in, empties as she eats, pops out
    if (bowlLog) {
      const a = now - bowlLog.t, out = now - bowlLog.gone;
      bowl.visible = out < 0.45;
      bowl.position.set(bowlLog.x, 0, bowlLog.z);
      const r = bowlLog.refill != null ? now - bowlLog.refill : 9;   // topped up: a happy little bounce
      const bounce = r < 0.4 ? 1 + 0.2 * Math.sin((r / 0.4) * Math.PI) : 1;
      const s = (out > 0 ? 1 - out / 0.45 : easeOutBack(a / 0.35)) * bounce;
      bowl.scale.setScalar(S * Math.max(0.001, s));
      bowl.rotation.y = Math.atan2(bowlLog.x, bowlLog.z) * 0.5;
      const left = brain.bowl ? brain.bowl.left : 0;
      kibble.forEach((k, n) => { k.visible = n < left; });
      if (out > 1) bowlLog = null;
    } else bowl.visible = false;
    // the yarn
    const y = brain.yarn;
    yarnRoot.visible = !!y;
    yarnBlob.visible = !!y;
    if (y) {
      yarnRoot.position.set(y.x, y.y, y.z);
      yarnRoot.quaternion.copy(yq);
      const h = Math.max(0, y.y - YARN.radius);          // the higher it is, the smaller and fainter its shadow
      yarnBlob.position.set(y.x, 0.04, y.z);
      yarnBlob.scale.setScalar(1 / (1 + h * 0.06));
      yarnBlob.material.opacity = 0.5 / (1 + h * 0.18);
    }
  }

  reset();
  let acc = 0;
  return {
    root,
    get model() { return model; },
    setCat,
    get brain() { return brain; },
    get t() { return brain.t; },
    /** live play: advance by real time; returns the number of fixed steps taken */
    advance(dt, viewer) {
      if (viewer) brain.viewer = [viewer.x, viewer.z];
      acc = Math.min(acc + dt, 0.25);
      let n = 0;
      while (acc >= STEP) { tick(); acc -= STEP; n++; }
      return n;
    },
    /** recordings: the kitty at exactly t seconds; returns the number of fixed steps taken */
    simulateTo(t, before = null) {
      if (t < brain.t - STEP * 0.5) reset();
      let n = 0;
      while (brain.t < t - STEP * 0.5) { before?.(brain.t); tick(); n++; }   // `before`: whoever else must be at this same moment
      return n;
    },
    /** after advance / simulateTo and once the camera is placed: head turn toward it, effects */
    finish(viewer, steps) {
      if (steps) { lookAt(viewer, steps * STEP); earFlicks(); }
      drawFX();
    },
    /** carrying and throwing the yarn (main.js turns a drag into these) */
    yarnHoldHeight: YARN.radius + YARN.hold,
    grabYarn() { return brain.grabYarn(); },
    holdYarn(x, z) { brain.holdYarn(x, z); },
    throwYarn(vx, vz, vy) { brain.throwYarn(vx, vz, vy); },
    yarnPosition(out = new THREE.Vector3()) { const y = brain.yarn; return y ? out.set(y.x, y.y, y.z) : null; },
    call(x, z, opt) { return brain.call(x, z, opt); },
    pet(opt) { return brain.pet(opt); },
    feed() { return brain.feed(); },
    /** Day 3: her bed (see town.js BED_SPOT): where she goes to sleep, and how high its cushion is */
    setBed(spot) { bed = spot; brain.bed = spot; place(); },
    /** Day 8: the home: { route, collide, keep } (kittybrain.js), so she walks round it and in at its door */
    setHome(hooks) { homeHooks = hooks; Object.assign(brain, hooks || { route: null, collide: null, keep: null }); },
    /** Day 3: where you are standing, so she can come over to you of her own accord */
    setFriend(x, z) { brain.friend = [x, z]; },
    play() { brain.play(); },
    /** Day 4: the fish on a stick. setWand: it comes out or is put away; setWandTip: where the stick's tip is now. */
    setWand(on) { wandOn = !!on; brain.setWand(wandOn); },
    setWandTip(p) { wandTip = p; brain.wandTip = p; },
    cast(x, z) { return brain.cast(x, z); },
    castNear() { return brain.castNear(); },
    reel() { brain.reel(); },
    get wandOut() { return wandOn; },
    on(fn) { listeners.push(fn); },
    /**
     * Day 3: fix something to one of her bones. `frame` is where it sits in the model's rest pose (model
     * space, Matrix4); it then follows the bone through every clip. False when this cat has no such bone.
     */
    attach(boneName, obj, frame) {
      const b = boneBind(boneName);
      if (!b) return false;
      obj.matrixAutoUpdate = false;
      obj.matrix.multiplyMatrices(b.inverse, frame);
      b.bone.add(obj);
      return true;
    },
    /**
     * Day 3: the toy she plays with. `obj` takes the yarn ball's place (null = the yarn again);
     * cfg.roll false = it slides nose first instead of rolling; cfg.bounce = how well it bounces.
     */
    setToy(obj, cfg = {}) {
      const next = obj || yarn;
      if (yarnRoot.children[0] !== next) {
        yarnRoot.clear();
        next.position.set(0, 0, 0);
        yarnRoot.add(next);
        shadowy(yarnRoot);
        yq.identity();
      }
      toy.roll = obj ? cfg.roll !== false : true;
      toy.bounce = obj ? cfg.bounce : undefined;
      toy.wand = !!(obj && cfg.wand);                // the fish on a stick is drawn by wand.js: no blob under it up in the air
      brain.toyBounce = toy.bounce;
    },
    /** her own collar and bell (the ginger kitty's): hidden under a bow tie or a scarf */
    setCollar(visible) {
      for (const n of ['Collar', 'Bell']) { const m = model.getObjectByName(n); if (m) m.visible = visible; }
    },
    /** what a ray hits: 'kitty' (two generous spheres: body and head), 'yarn', or null */
    pick(ray) {
      root.updateMatrixWorld(true);
      for (const [b, rad] of [[B.chest, 0.15 * S], [B.spine, 0.15 * S], [B.head, 0.11 * S]]) {
        b.getWorldPosition(v1);
        if (ray.distanceSqToPoint(v1) < rad * rad) return 'kitty';
      }
      if (brain.yarn && !brain.yarn.flying && ray.distanceSqToPoint(yarnRoot.position) < (YARN.radius * (toy.wand ? 2.3 : 1.9)) ** 2) return 'yarn';
      return null;
    },
    headPosition(out = new THREE.Vector3()) { root.updateMatrixWorld(true); return B.head.getWorldPosition(out); },
    focus(out = new THREE.Vector3()) { return out.set(brain.x, 0, brain.z); },
    /** where the camera should look: at her, or between her and the bowl / yarn she is busy with */
    interest(out = new THREE.Vector3()) {
      out.set(brain.x, 0, brain.z);
      const y = brain.yarn, bw = brain.bowl;
      if (bw && bw.eatenAt == null) out.lerp(v2.set(bw.x, 0, bw.z), 0.35);
      else if (y && (y.held || y.air || brain.goal === 'yarn' || ['face', 'pounce', 'bat'].includes(brain.mode) || y.flying > 0)) {
        // lean toward the ball, but never more than ~5 m ahead of her: she stays in the picture
        const d = Math.hypot(y.x - brain.x, y.z - brain.z);
        out.lerp(v2.set(y.x, 0, y.z), Math.min(0.4, 5 / Math.max(d, 1)));
      }
      return out;
    },
    /** true while something is moving (the page then renders every frame) */
    busy() {
      const y = brain.yarn;
      return !['sit', 'idle', 'sleep'].includes(brain.mode) || heartLog.length > 0 || bowl.visible
        || !!(y && (y.flying || (y.held && !y.hang) || y.air || y.reel || y.vx || y.vz));
    },
  };
}
