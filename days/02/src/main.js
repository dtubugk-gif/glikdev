// Glikdev. Glue: URL modes, UI, Day log, the world, the kitty (Day 2) and the render loop. The title
// card and the Day log come from days.json at runtime (the newest entry), so a new day only adds an entry there.
//   ?demo=orbit | reveal | kitty | kittycall | kittypet | kittywalk
//                                scripted camera (and kitty), driven only by frame time (for filming)
//   ?ui=0                        hide every piece of UI
//   ?capture=short               Shorts layout: record at 360x640 CSS with deviceScaleFactor 3
// window.renderFrame(t) renders the frame at t seconds (used by frame-exact recorders);
// window.__ready resolves once the world has drawn its first frame.
// Cache safety: index.html loads this file as src/main.js?v=<build> and maps every module to the same
// ?v= through its import map; data and model URLs below get the same stamp (deploy.mjs writes it).
import { renderDayLog, renderHeadline, latestDay } from './daylog.js';
import { DEMOS, demoPose, KITTY_DEMOS } from './demo.js';

// Set this to the channel's URL once it exists (for example 'https://www.youtube.com/@glikdev').
const CHANNEL_URL = 'https://www.youtube.com/@glikdev';

const params = new URLSearchParams(location.search);
const demo = DEMOS.includes(params.get('demo')) ? params.get('demo') : null;
const showUI = params.get('ui') !== '0';
const short = params.get('capture') === 'short';
const root = document.documentElement;
if (!showUI) root.classList.add('no-ui');
if (demo) root.classList.add('demo');
if (short) root.classList.add('capture-short');

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const hintEl = $('hint');

const BUILD = new URL(import.meta.url).searchParams.get('v') || '';
const stamped = (url) => (BUILD ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(BUILD)}` : url);
// a snapshot lives at days/NN/: its links to other days go back to the site root first
const SITE_ROOT = /\/days\/\d+\/(?:index\.html)?$/.test(location.pathname) ? '../../' : '';

let resolveReady;
window.__ready = new Promise((r) => { resolveReady = r; });
let onCopyChange = () => {};

// ---------------------------------------------------------------- Day log + title card
const dialog = $('daylog');
const list = $('daylog-list');
const daysLoaded = fetch(stamped('days.json'), { cache: 'no-cache' })
  .then((r) => { if (!r.ok) throw new Error(`days.json ${r.status}`); return r.json(); })
  .then((days) => {
    renderDayLog(list, days, { root: SITE_ROOT });
    renderHeadline({ day: document.querySelector('.title-day'), line: document.querySelector('.title-line'), bubble: document.querySelector('.bubble') }, days);
    const last = latestDay(days);
    if (last && typeof last.alt === 'string' && last.alt.trim()) $('world').setAttribute('aria-label', last.alt.trim());
    onCopyChange();
    return days;
  })
  .catch(() => {
    const li = document.createElement('li');
    li.className = 'daylog-empty';
    li.textContent = 'The Day log could not be loaded. Reload to try again.';
    list.replaceChildren(li);
    return null;
  });

const openBtn = $('daylog-open');
openBtn.addEventListener('click', () => {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
});
$('daylog-close').addEventListener('click', () => (dialog.close ? dialog.close() : dialog.removeAttribute('open')));
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => openBtn.focus());

const channel = $('channel');
if (CHANNEL_URL) { channel.href = CHANNEL_URL; channel.hidden = false; }

// ---------------------------------------------------------------- failure states
function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();   // release the probe context
    return true;
  } catch { return false; }
}

function showFallback() {
  root.classList.add('no-webgl');
  $('fallback').hidden = false;
  statusEl.hidden = true;
  resolveReady(false);
}

function showLoadError(err) {
  console.warn('Glikdev: the world did not load', err);
  statusEl.textContent = 'The world didn’t load. Check your connection and reload.';
  statusEl.classList.add('is-error');
  statusEl.hidden = false;
  resolveReady(false);
}

// ---------------------------------------------------------------- the world
async function start() {
  if (!hasWebGL2()) { showFallback(); return; }

  let mods;
  try {
    mods = await Promise.all([import('./world.js'), import('./controls.js'), import('../vendor/three/three.module.js')]);
  } catch (err) { showLoadError(err); return; }
  const [{ createRenderer, createWorld, PLATE }, { OrbitRig, placeCamera }, THREE] = mods;
  const kittyMods = Promise.all([import('./kitty.js'), import('./kittyaudio.js')]);

  const canvas = $('world');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const maxDpr = coarse ? 1.5 : 2;
  const dpr = () => Math.min(window.devicePixelRatio || 1, short ? 3 : maxDpr);

  let renderer;
  try { renderer = createRenderer(canvas, { lowPower: coarse }); } catch { showFallback(); return; }

  let world;
  try {
    world = await createWorld({ renderer, modelUrl: stamped('models/day1.glb'), phone: coarse || innerWidth < 760 });
  } catch (err) { showLoadError(err); return; }
  const { camera } = world;
  world.setAnimate(demo ? true : !reducedMotion);

  let hinted = false, looked = false;
  // Orbit the centre of the plate. The start view looks along the grid at a slight angle,
  // so the lines run off toward the horizon in perspective.
  const target = [0, PLATE.topY, 0];
  const home = { az: 0.32, pol: 1.05, dist: 32, height: 16, target, shift: 0, shiftX: 0, fov: 60, horizon: 0.42 };
  const rig = new OrbitRig(camera, canvas, { target, minPolar: 0.22, maxPolar: 1.52, minHeight: 1.5, onInteract: () => { looked = true; } });

  // Where the horizon lands for a camera pitched down by `pitch` (radians) with vertical fov `fov` (deg),
  // as a fraction of the height from the top, before any lens shift.
  const horizonAt = (pitch, fov) => 0.5 - 0.5 * Math.tan(pitch) / Math.tan((fov * Math.PI) / 360);
  // How far below the true horizon the plate's far edge sits (radians), seen from a camera at
  // `height` and horizontal distance `back` from the centre, looking along azimuth az toward it.
  function edgeDip(height, back, az) {
    const fx = -Math.sin(az), fz = -Math.cos(az);
    const px = Math.sin(az) * back, pz = Math.cos(az) * back;
    const tx = fx ? ((Math.sign(fx) * PLATE.half) - px) / fx : Infinity;
    const tz = fz ? ((Math.sign(fz) * PLATE.half) - pz) / fz : Infinity;
    return Math.atan2(height, Math.min(tx, tz));
  }

  // Frame the plate for the current screen: camera height and pitch, then a vertical lens shift
  // that puts the horizon below the title (portrait: 38-45% of the height).
  function layout() {
    const w = innerWidth, h = innerHeight;
    world.resize(w, h, dpr());
    const aspect = w / h;
    const portrait = aspect < 0.85;
    const wide = aspect >= 1.3;
    const spec = portrait
      ? { fov: 62, pitch: 30, height: 16, horizon: short ? 0.44 : 0.42 }
      : wide ? { fov: 46, pitch: 26, height: 15, horizon: h < 500 ? 0.45 : 0.4 }
        : { fov: 54, pitch: 28, height: 16, horizon: 0.41 };
    if (portrait && showUI) {
      // keep the horizon below the bubble, however long the day's headline is
      const b = document.querySelector('.bubble')?.getBoundingClientRect();
      if (b && b.height) spec.horizon = Math.min(short ? 0.6 : 0.45, Math.max(spec.horizon, (b.bottom + 34) / h));
    }
    camera.fov = spec.fov;
    const pitch = (spec.pitch * Math.PI) / 180;
    home.fov = spec.fov;
    home.pol = Math.PI / 2 - pitch;
    home.height = spec.height;
    home.dist = spec.height / Math.cos(home.pol);
    home.horizon = spec.horizon;
    // the visible horizon is the plate's far edge: put that line at spec.horizon
    home.shift = horizonAt(pitch - edgeDip(spec.height, spec.height / Math.tan(pitch), home.az), spec.fov) - spec.horizon;
    home.shiftX = 0;
    rig.setLimits(6, 170);
    setShift(home.shift, 0);
  }
  function setShift(sy, sx = 0) {
    const w = innerWidth, h = innerHeight;
    camera.setViewOffset(w, h, sx * w, sy * h, w, h);
    camera.updateProjectionMatrix();
  }
  home.horizonAt = horizonAt;
  home.edgeDip = edgeDip;
  layout();
  rig.setPose(home);
  // web fonts change the bubble's height: frame again once they are in
  // web fonts and the day's copy change the bubble's height: frame again (unless someone is already looking around)
  const reframe = () => { layout(); if (!looked) rig.setPose({ az: rig.goal.az, pol: home.pol, dist: home.dist }); };
  document.fonts?.ready.then(reframe);
  onCopyChange = reframe;
  addEventListener('resize', () => {
    const before = home.dist;
    layout();
    rig.goal.dist *= home.dist / before;
    rig.dist = rig.goal.dist;
    rig.setLimits(rig.minDist, rig.maxDist);               // clamps both ends, current and goal
  });

  // ------------------------------------------------------------ the kitty (Day 2, idea by @lifediamond888)
  let kitty = null, audio = null;
  const kd = demo ? KITTY_DEMOS[demo] : null;
  try {
    const [{ createKitty }, { createKittyAudio }] = await kittyMods;
    const ground = Math.sin(home.pol) * home.dist;
    kitty = await createKitty({
      scene: world.scene, renderer, url: stamped('models/kitty.glb'),
      start: kd ? kd.start(home) : { x: 0, z: 0, heading: home.az, mode: 'sit' },
      script: kd ? kd.script : null,
      viewer: kd ? kd.viewer(home) : [Math.sin(home.az) * ground, Math.cos(home.az) * ground],
    });
    const focus = new THREE.Vector3();
    world.setShadowFocus(() => kitty.focus(focus));
    if (!demo && !short) {
      audio = createKittyAudio();
      kitty.on((e) => audio.event(e));
    }
  } catch (err) { console.warn('Glikdev: the kitty did not load', err); kitty = null; }
  const kittyState = () => {
    const b = kitty.brain, h = kitty.headPosition();
    return { x: b.x, z: b.z, heading: b.heading, head: [h.x, h.y, h.z] };
  };

  // taps: on the kitty = pet her; on the ground = call her there (a drag or a pinch is not a tap)
  const taps = new Map();
  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  function rayAt(cx, cy) {
    camera.updateMatrixWorld();
    ray.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, 1 - (cy / innerHeight) * 2), camera);
    return ray.ray;
  }
  if (kitty && !demo) {
    canvas.addEventListener('pointerdown', (e) => {
      taps.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), multi: taps.size > 0 });
      if (taps.size > 1) for (const v of taps.values()) v.multi = true;
      audio?.unlock();
    });
    const end = (e) => {
      const d = taps.get(e.pointerId);
      taps.delete(e.pointerId);
      if (e.type !== 'pointerup' || !d || d.multi || taps.size) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || performance.now() - d.t > 450) return;
      const r = rayAt(e.clientX, e.clientY);
      if (kitty.pick(r)) { kitty.pet(); dismissHint(); return; }
      if (r.intersectPlane(groundPlane, hit) && Math.abs(hit.x) < PLATE.half - 4 && Math.abs(hit.z) < PLATE.half - 4) {
        kitty.call(hit.x, hit.z);
        dismissHint();
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    if (!coarse) {
      canvas.addEventListener('pointermove', (e) => {
        if (e.buttons) return;
        canvas.style.cursor = kitty.pick(rayAt(e.clientX, e.clientY)) ? 'pointer' : '';
      });
    }
  }

  // hint, until the first tap that does something
  if (showUI && !demo && !short) {
    hintEl.textContent = kitty
      ? (coarse ? 'Tap the ground to call the kitty · Tap her to pet her'
        : 'Click the ground to call the kitty · Click her to pet her · Drag to look around')
      : (coarse ? 'Drag to look around · Pinch to zoom' : 'Drag to look around · Scroll or W/S to zoom');
    hintEl.hidden = false;
  }
  function dismissHint() {
    if (hinted) return;
    hinted = true;
    hintEl.classList.add('is-gone');
  }

  // ------------------------------------------------------------ loop
  let t0 = null, last = null, external = false, skip = false;
  function step(t, dt) {
    let ks = 0;
    if (kitty) ks = demo ? kitty.simulateTo(t) : kitty.advance(dt, camera.position);
    if (demo) {
      const pose = demoPose(demo, t, home, kitty ? kittyState() : null) || demoPose('orbit', t, home);
      setShift(pose.shift, 0);
      if (pose.position) {
        camera.position.set(...pose.position);
        camera.lookAt(...pose.look);
      } else {
        placeCamera(camera, pose.target, pose.az, pose.pol, pose.dist);
      }
    } else {
      rig.update(dt);
    }
    if (kitty) kitty.finish(camera.position, ks);
    world.update(t);
    world.render();
  }
  function frame(ts) {
    if (external) return;
    requestAnimationFrame(frame);
    if (t0 === null) { t0 = ts; last = ts; }
    const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
    if (dialog.open) { last = ts; return; }                // nothing to see behind the Day log
    // when nobody is touching the camera, 30 fps is plenty
    if (!demo && rig.idle() && !(kitty && kitty.busy())) { skip = !skip; if (skip) return; }
    last = ts;
    step((ts - t0) / 1000, dt);
  }
  // Recorders call this instead of the rAF loop: the frame at exactly t seconds.
  window.renderFrame = (t) => {
    external = true;
    step(Number(t) || 0, 1 / 30);
  };

  // handles for tests and for the days to come
  const v = new THREE.Vector3();
  window.__glikdev = {
    world, rig, home, daysLoaded, build: BUILD, kitty,
    /** Screen height fraction (from the top) of the visible horizon: the plate's far edge. */
    horizonFrac() {
      camera.updateMatrixWorld();
      const f = camera.getWorldDirection(new THREE.Vector3());
      f.y = 0;
      if (f.lengthSq() < 1e-8) return null;
      f.normalize();
      const p = camera.position;
      const tx = f.x ? (Math.sign(f.x) * PLATE.half - p.x) / f.x : Infinity;
      const tz = f.z ? (Math.sign(f.z) * PLATE.half - p.z) / f.z : Infinity;
      v.set(p.x + f.x * Math.min(tx, tz), 0, p.z + f.z * Math.min(tx, tz)).project(camera);
      return (1 - v.y) / 2;
    },
    /** Screen height fraction (from the top) where the true (sky) horizon is drawn right now. */
    skyHorizonFrac() {
      camera.updateMatrixWorld();
      const f = camera.getWorldDirection(new THREE.Vector3());
      f.y = 0;
      if (f.lengthSq() < 1e-8) return null;                // looking straight down
      f.normalize().multiplyScalar(1e5).add(camera.position);
      f.y = camera.position.y;
      v.copy(f).project(camera);
      return (1 - v.y) / 2;
    },
    cameraHeight() { return camera.position.y; },
    /** Size in CSS px of one 4 m grid cell on the ground at a screen point (fractions 0-1). */
    gridCellPx(sx = 0.5, sy = 0.8) {
      camera.updateMatrixWorld();
      ray.setFromCamera(new THREE.Vector2(sx * 2 - 1, 1 - sy * 2), camera);
      const hit = ray.ray.intersectPlane(groundPlane, new THREE.Vector3());
      if (!hit) return 0;
      const a = hit.clone().project(camera), b = hit.clone().add(new THREE.Vector3(4, 0, 0)).project(camera);
      const c = hit.clone().add(new THREE.Vector3(0, 0, 4)).project(camera);
      const px = (p, q) => Math.hypot((p.x - q.x) * innerWidth / 2, (p.y - q.y) * innerHeight / 2);
      return Math.max(px(a, b), px(a, c));
    },
  };

  step(0, 0);
  statusEl.hidden = true;
  root.classList.add('world-ready');
  requestAnimationFrame(frame);
  await daysLoaded;                                        // the title card shows the right day before "ready"
  resolveReady(true);
}

start().catch(showLoadError);
