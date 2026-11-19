// Glikdev - Day 1. Glue: URL modes, UI, Day log, the world and the render loop.
//   ?demo=orbit | ?demo=reveal   scripted camera, driven only by frame time (for filming)
//   ?ui=0                        hide every piece of UI
// window.renderFrame(t) renders the frame at t seconds (used by frame-exact recorders);
// window.__ready resolves once the world has drawn its first frame.
import { renderDayLog } from './daylog.js';
import { DEMOS, demoPose } from './demo.js';

// Set this to the channel's URL once it exists (for example 'https://www.youtube.com/@glikdev').
const CHANNEL_URL = null;

const params = new URLSearchParams(location.search);
const demo = DEMOS.includes(params.get('demo')) ? params.get('demo') : null;
const showUI = params.get('ui') !== '0';
const root = document.documentElement;
if (!showUI) root.classList.add('no-ui');
if (demo) root.classList.add('demo');

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
$('daylog-close').addEventListener('click', () => dialog.close ? dialog.close() : dialog.removeAttribute('open'));
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => openBtn.focus());

const channel = $('channel');
if (CHANNEL_URL) { channel.href = CHANNEL_URL; channel.hidden = false; }

// ---------------------------------------------------------------- WebGL check
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

function showFallback() {
  root.classList.add('no-webgl');
  $('fallback').hidden = false;
  statusEl.hidden = true;
  resolveReady(false);
}

// ---------------------------------------------------------------- the world
async function start() {
  if (!hasWebGL()) { showFallback(); return; }

  const [{ createRenderer, createWorld, ISLAND }, { OrbitRig, placeCamera }] = await Promise.all([
    import('./world.js'), import('./controls.js'),
  ]);

  const canvas = $('world');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try { renderer = createRenderer(canvas, { lowPower: coarse }); } catch { showFallback(); return; }

  let world;
  try {
    world = await createWorld({ renderer, modelUrl: 'models/day1.glb', phone: coarse || innerWidth < 760 });
  } catch (err) {
    console.warn('Glikdev: the world did not load', err);
    statusEl.textContent = 'The world didn’t load. Check your connection and reload.';
    statusEl.classList.add('is-error');
    resolveReady(false);
    return;
  }
  const { camera } = world;
  world.setAnimate(demo ? true : !reducedMotion);

  // where the signpost stands and which way it faces (so the first view reads "DAY 1")
  const signPos = [3.4, 1.6, 6.2];
  let signAz = -0.42;
  if (world.sign) {
    world.sign.updateWorldMatrix(true, false);
    const p = world.sign.getWorldPosition(world.sign.position.clone());
    signPos[0] = p.x; signPos[1] = p.y + 1.6; signPos[2] = p.z;
    const d = world.sign.getWorldDirection(p.clone());
    signAz = Math.atan2(d.x, d.z);
  }

  const target = [0, ISLAND.centreY, 0];
  const home = { az: signAz + 0.38, pol: 1.24, dist: 50, target, sign: signPos };
  const rig = new OrbitRig(camera, canvas, { target, minPolar: 0.42, maxPolar: 1.72, onInteract: dismissHint });

  // Frame the island for the current screen: fit the width, leave room for the title.
  function layout() {
    const w = innerWidth, h = innerHeight;
    world.resize(w, h);
    const aspect = w / h;
    const portrait = aspect < 0.85;
    camera.fov = portrait ? 52 : aspect < 1.3 ? 44 : 38;
    const vf = (camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    // portrait: fit the slab itself (the small flying rocks may touch the edges); wider screens: everything
    const fitW = (portrait ? 14.2 : ISLAND.radius * 1.04) / Math.tan(hf / 2);
    const fitH = (11.5) / Math.tan(vf / 2) / (portrait ? 0.62 : 0.8);
    const fit = Math.max(fitW, fitH);
    // push the island down a little in portrait so the title sits in clear sky
    const shift = portrait ? -0.045 * h : aspect < 1.3 ? -0.05 * h : -0.03 * h;
    // a little more top-down when the screen is tall, so the ground reads as a place
    home.pol = portrait ? 1.13 : 1.24;
    camera.setViewOffset(w, h, 0, shift, w, h);
    camera.updateProjectionMatrix();
    home.dist = fit;
    rig.setLimits(12, fit * 1.9);
    return fit;
  }
  layout();
  rig.setPose(home);
  addEventListener('resize', () => {
    const before = home.dist;
    layout();
    rig.goal.dist = Math.min(rig.maxDist, rig.goal.dist * (home.dist / before));
    rig.dist = rig.goal.dist;
  });

  // hint, once
  if (showUI && !demo) {
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
  let t0 = null, last = null, external = false;
  function step(t, dt) {
    if (demo) {
      const pose = demoPose(demo, t, home);
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
    last = ts;
    step((ts - t0) / 1000, dt);
  }
  // Recorders call this instead of the rAF loop: the frame at exactly t seconds.
  window.renderFrame = (t) => {
    external = true;
    step(Number(t) || 0, 1 / 30);
  };

  // handles for tests and for the days to come
  window.__glikdev = { world, rig, home };

  step(0, 0);
  statusEl.hidden = true;
  requestAnimationFrame(frame);
  resolveReady(true);
}

start().catch((err) => {
  console.warn('Glikdev: start failed', err);
  showFallback();
});
