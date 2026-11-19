// Glikdev - Day 1. Glue: URL modes, UI, Day log, the world and the render loop.
//   ?demo=orbit | ?demo=reveal   scripted camera, driven only by frame time (for filming)
//   ?ui=0                        hide every piece of UI
//   ?capture=short               Shorts layout: record at 360x640 CSS with deviceScaleFactor 3
// window.renderFrame(t) renders the frame at t seconds (used by frame-exact recorders);
// window.__ready resolves once the world has drawn its first frame.
import { renderDayLog } from './daylog.js';
import { DEMOS, demoPose } from './demo.js';

// Set this to the channel's URL once it exists (for example 'https://www.youtube.com/@glikdev').
const CHANNEL_URL = null;

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

let resolveReady;
window.__ready = new Promise((r) => { resolveReady = r; });

// ---------------------------------------------------------------- Day log
const dialog = $('daylog');
const list = $('daylog-list');
fetch('days.json', { cache: 'no-cache' })
  .then((r) => { if (!r.ok) throw new Error(`days.json ${r.status}`); return r.json(); })
  .then((days) => renderDayLog(list, days))
  .catch(() => {
    const li = document.createElement('li');
    li.className = 'daylog-empty';
    li.textContent = 'The Day log could not be loaded. Reload to try again.';
    list.replaceChildren(li);
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
  const [{ createRenderer, createWorld, ISLAND }, { OrbitRig, placeCamera }, THREE] = mods;

  const canvas = $('world');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const maxDpr = coarse ? 1.5 : 2;
  const dpr = () => Math.min(window.devicePixelRatio || 1, short ? 3 : maxDpr);

  let renderer;
  try { renderer = createRenderer(canvas, { lowPower: coarse }); } catch { showFallback(); return; }

  let world;
  try {
    world = await createWorld({ renderer, modelUrl: 'models/day1.glb', phone: coarse || innerWidth < 760 });
  } catch (err) { showLoadError(err); return; }
  const { camera } = world;
  world.setAnimate(demo ? true : !reducedMotion);

  // where the sign stands and which way it faces (the start view looks straight at it)
  const signPos = [1.9, 3.25, 5.0];
  let signAz = 0.35;
  if (world.sign) {
    world.sign.updateWorldMatrix(true, true);
    const p = world.sign.getWorldPosition(new THREE.Vector3());
    signPos[0] = p.x; signPos[1] = p.y + 3.25; signPos[2] = p.z;
    const d = world.sign.getWorldDirection(new THREE.Vector3());
    signAz = Math.atan2(d.x, d.z);
  }

  const target = [0, ISLAND.centreY, 0];
  const home = { az: signAz + 0.04, pol: 1.2, dist: 50, target, sign: signPos, signDist: 20, shift: 0, shiftX: 0, signShift: 0.05 };
  const rig = new OrbitRig(camera, canvas, { target, minPolar: 0.42, maxPolar: 1.72, onInteract: dismissHint });

  // ---- framing: solve distance and screen offset so the island lands where the layout wants it
  const framePts = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    framePts.push(new THREE.Vector3(Math.sin(a) * 12.6, 0.2, Math.cos(a) * 12.6));
    framePts.push(new THREE.Vector3(Math.sin(a) * 12.4, -2.1, Math.cos(a) * 12.4));
  }
  framePts.push(new THREE.Vector3(1.0, -12.0, 0.7)); // tip of the cone
  const probe = new THREE.PerspectiveCamera();
  const v = new THREE.Vector3();
  function extent(pol, d) {
    placeCamera(probe, target, home.az, pol, d);
    probe.updateMatrixWorld();
    let top = 1, bot = 0, left = 1, right = 0;
    for (const p of framePts) {
      v.copy(p).project(probe);
      const x = (v.x + 1) / 2, y = (1 - v.y) / 2;
      top = Math.min(top, y); bot = Math.max(bot, y); left = Math.min(left, x); right = Math.max(right, x);
    }
    return { top, bot, left, right };
  }
  function solve(fn, want) {      // fn decreases with distance
    let lo = 8, hi = 600;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fn(mid) > want) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  function layout() {
    const w = innerWidth, h = innerHeight;
    world.resize(w, h, dpr());
    const aspect = w / h;
    const portrait = aspect < 0.85;
    const wide = aspect >= 1.3;
    const spec = portrait
      ? { fov: 50, pol: 1.36, top: 0.4, bot: short ? 0.78 : 0.8, maxW: short ? 0.88 : 0.94, cx: short ? 0.47 : 0.5 }
      : wide ? { fov: 38, pol: 1.24, top: h < 500 ? 0.3 : 0.27, bot: h < 500 ? 0.96 : 0.9, maxW: h < 500 ? 0.56 : 0.62, cx: h < 500 ? 0.66 : 0.6 }
        : { fov: 44, pol: 1.2, top: 0.33, bot: 0.86, maxW: 0.86, cx: 0.5 };
    // portrait: the island starts below the title block (its bubble tail included)
    if (portrait) {
      const r = document.querySelector('.title').getBoundingClientRect();
      if (short) spec.top = 0.44;
      else if (showUI && r.height) spec.top = Math.max(spec.top, (r.bottom + 34) / h);
      spec.bot = Math.max(spec.bot, spec.top + 0.3);
    }
    camera.fov = spec.fov;
    probe.fov = spec.fov; probe.aspect = aspect; probe.near = camera.near; probe.far = camera.far;
    probe.clearViewOffset(); probe.updateProjectionMatrix();
    home.pol = spec.pol;
    let d = solve((dd) => { const e = extent(spec.pol, dd); return e.bot - e.top; }, spec.bot - spec.top);
    if ((() => { const e = extent(spec.pol, d); return e.right - e.left; })() > spec.maxW) {
      d = solve((dd) => { const e = extent(spec.pol, dd); return e.right - e.left; }, spec.maxW);
    }
    const e = extent(spec.pol, d);
    home.dist = d;
    home.shift = e.top - spec.top;                         // fraction of the height
    home.shiftX = (e.left + e.right) / 2 - spec.cx;        // fraction of the width
    // reveal ends with the sign plank filling about a third of the frame width
    const hf = 2 * Math.atan(Math.tan((spec.fov * Math.PI) / 360) * aspect);
    home.signDist = 3.75 / (0.36 * 2 * Math.tan(hf / 2));
    rig.setLimits(12, d * 1.9);
    setShift(home.shift, home.shiftX);
  }
  function setShift(sy, sx = home.shiftX) {
    const w = innerWidth, h = innerHeight;
    camera.setViewOffset(w, h, sx * w, sy * h, w, h);
    camera.updateProjectionMatrix();
  }
  layout();
  rig.setPose(home);
  // web fonts change the title's height: frame again once they are in
  document.fonts?.ready.then(() => { layout(); rig.setPose({ az: rig.goal.az, pol: rig.goal.pol, dist: home.dist }); });
  addEventListener('resize', () => {
    const before = home.dist;
    layout();
    rig.goal.dist *= home.dist / before;
    rig.dist = rig.goal.dist;
    rig.setLimits(rig.minDist, rig.maxDist);               // clamps both ends, current and goal
  });

  // hint, once
  if (showUI && !demo && !short) {
    hintEl.textContent = coarse ? 'Drag to look around · Pinch to zoom' : 'Drag to look around · Scroll or W/S to zoom';
    hintEl.hidden = false;
  }
  let hinted = false;
  function dismissHint() {
    if (hinted) return;
    hinted = true;
    hintEl.classList.add('is-gone');
  }

  // ------------------------------------------------------------ loop
  let t0 = null, last = null, external = false, skip = false;
  function step(t, dt) {
    if (demo) {
      const pose = demoPose(demo, t, home);
      setShift(pose.shift, home.shiftX);
      placeCamera(camera, pose.target, pose.az, pose.pol, pose.dist);
    } else {
      rig.update(dt);
    }
    world.update(t);
    world.render();
  }
  function frame(ts) {
    if (external) return;
    requestAnimationFrame(frame);
    if (t0 === null) { t0 = ts; last = ts; }
    const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
    if (dialog.open) { last = ts; return; }                // nothing to see behind the Day log
    // when nobody is touching the camera, 30 fps is plenty for the drifting rocks
    if (!demo && rig.idle()) { skip = !skip; if (skip) return; }
    last = ts;
    step((ts - t0) / 1000, dt);
  }
  // Recorders call this instead of the rAF loop: the frame at exactly t seconds.
  window.renderFrame = (t) => {
    external = true;
    step(Number(t) || 0, 1 / 30);
  };

  // handles for tests and for the days to come
  const box = new THREE.Box3();
  window.__glikdev = {
    world, rig, home,
    /** Screen box (CSS px) of the "DAY 1" lettering in the current view. */
    signBox() {
      const l = world.lettering;
      if (!l) return null;
      box.setFromObject(l);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
        const x = ((v.x + 1) / 2) * innerWidth, y = ((1 - v.y) / 2) * innerHeight;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
    },
  };

  step(0, 0);
  statusEl.hidden = true;
  root.classList.add('world-ready');
  requestAnimationFrame(frame);
  resolveReady(true);
}

start().catch(showLoadError);
