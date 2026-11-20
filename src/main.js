// Glikdev. Glue: URL modes, UI, Day log, the world, the kitty (Day 2) and the render loop. The title
// card and the Day log come from days.json at runtime (the newest entry), so a new day only adds an entry there.
//   ?demo=orbit | reveal | kitty | kittycall | kittypet | kittywalk
//                                scripted camera (and kitty), driven only by frame time (for filming)
//   ?ui=0                        hide every piece of UI
//   ?tag=Mochi&tagAt=1.5         (filming) show the kitty's name tag, popping in at tagAt seconds
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

// ---------------------------------------------------------------- the kitty's name and needs (this device only)
const CARE_KEY = 'glikdev.kitty.v1';
const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
function loadCare() {
  try {
    const d = JSON.parse(localStorage.getItem(CARE_KEY) || 'null');
    if (!d || typeof d !== 'object') return null;
    return d;
  } catch { return null; }
}
function saveCare(d) { try { localStorage.setItem(CARE_KEY, JSON.stringify(d)); } catch { /* private mode: fine */ } }
// the cats you can choose (the ginger kitty is Day 2's own; the other two are the owner's Sketchfab picks)
const CATS = {
  ginger: { label: 'Ginger', url: 'models/kitty.glb', fur: 'models/kitty_fur.png' },
  realistic: { label: 'Realistic', url: 'models/cat_realistic.glb' },
  tabby: { label: 'Tabby', url: 'models/cat_toti.glb' },
};
const THUMB = { ginger: 'models/thumb_ginger.webp', realistic: 'models/thumb_realistic.webp', tabby: 'models/thumb_toti.webp' };
const catOf = (k) => (Object.hasOwn(CATS, k) ? k : null);
const filmTag = cleanName(params.get('tag'));
const filmTagAt = Number(params.get('tagAt')) || 0;

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
      if (b && b.height) root.style.setProperty('--hint-top', `${Math.round(b.bottom + 30)}px`);   // the hint sits just under it
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
  const live = !demo && !short;
  const saved = live ? loadCare() : null;
  const care = {
    name: cleanName(saved?.name) || 'Kitty',
    muted: !!saved?.muted,
    cat: catOf(params.get('cat')) || catOf(saved?.cat) || 'ginger',
  };
  const catOpts = (k) => ({ url: stamped(CATS[k].url), furUrl: CATS[k].fur ? stamped(CATS[k].fur) : null, furLayers: coarse ? 6 : 10 });
  let needs;
  if (saved && Number.isFinite(saved.hunger) && Number.isFinite(saved.happy)) {
    const away = Math.max(0, Math.min(3600, (Date.now() - (Number(saved.at) || Date.now())) / 1000));
    needs = { hunger: Math.min(1, saved.hunger + away / 240), happy: Math.max(0, saved.happy - away / 900) };
  }
  try {
    const [{ createKitty }, { createKittyAudio }] = await kittyMods;
    const ground = Math.sin(home.pol) * home.dist;
    const first = { scene: world.scene, renderer, toysUrl: stamped('models/toys.glb'),
      start: kd ? kd.start(home) : { x: 0, z: 0, heading: home.az, mode: 'sit' },
      script: kd ? kd.script : null,
      viewer: kd ? kd.viewer(home) : [Math.sin(home.az) * ground, Math.cos(home.az) * ground],
      needs: kd ? kd.needs : needs };
    kitty = await createKitty({ ...first, ...catOpts(care.cat) }).catch((err) => {
      if (care.cat === 'ginger') throw err;             // her chosen cat did not load: the ginger kitty instead
      console.warn('Glikdev: that cat did not load, back to the ginger kitty', err);
      care.cat = 'ginger';
      return createKitty({ ...first, ...catOpts('ginger') });
    });
    const focus = new THREE.Vector3();
    world.setShadowFocus(() => kitty.focus(focus));
    if (live) {
      audio = createKittyAudio();
      audio.setMuted(care.muted);
      const head = new THREE.Vector3();
      kitty.on((e) => {
        const d = camera.position.distanceTo(kitty.headPosition(head));
        audio.event(e, Math.max(0, Math.min(1, (70 - d) / 50)));
      });
    }
  } catch (err) { console.warn('Glikdev: the kitty did not load', err); kitty = null; }
  const kittyState = () => {
    const b = kitty.brain, h = kitty.headPosition();
    return { x: b.x, z: b.z, heading: b.heading, head: [h.x, h.y, h.z],
      bowl: b.bowl ? { x: b.bowl.x, z: b.bowl.z } : null, yarn: b.yarn ? { x: b.yarn.x, z: b.yarn.z } : null };
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
  // the yarn: press on it and drag to carry it (it lifts off the floor), let go while moving to throw it
  let carry = null, thrownOnce = false;
  const holdPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function carryPoint(cx, cy) {
    holdPlane.constant = -kitty.yarnHoldHeight;            // the plane the carried yarn's centre moves in
    const p = rayAt(cx, cy).intersectPlane(holdPlane, hit);
    if (!p) return null;
    const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
    if (d > 260) return null;                              // the pointer is up near the horizon: ignore it
    return { x: p.x, z: p.z };
  }
  if (kitty && !demo) {
    // capture phase: this runs before the camera's own drag, so grabbing the yarn never turns the view
    canvas.addEventListener('pointerdown', (e) => {
      if (carry || e.button > 0) return;
      if (kitty.pick(rayAt(e.clientX, e.clientY)) !== 'yarn') return;
      carry = { id: e.pointerId, x: e.clientX, y: e.clientY, live: false, samples: [] };
      rig.enabled = false;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* gone already */ }
    }, { capture: true });
    canvas.addEventListener('pointermove', (e) => {
      if (!carry || e.pointerId !== carry.id) return;
      if (!carry.live) {
        if (Math.hypot(e.clientX - carry.x, e.clientY - carry.y) < 6) return;
        if (!kitty.grabYarn()) { carry = null; rig.enabled = true; return; }
        carry.live = true;
        canvas.style.cursor = 'grabbing';
        audio?.unlock();
        dismissHint();
      }
      const p = carryPoint(e.clientX, e.clientY);
      if (!p) return;
      kitty.holdYarn(p.x, p.z);
      const now = e.timeStamp || performance.now();
      carry.samples.push({ t: now, x: p.x, z: p.z });
      while (carry.samples.length > 2 && now - carry.samples[0].t > 110) carry.samples.shift();
    });
    const letGo = (e) => {
      if (!carry || e.pointerId !== carry.id) return;
      const c = carry;
      carry = null;
      rig.enabled = true;
      canvas.style.cursor = '';
      if (!c.live) return;                                 // just a tap on it: the tap handler below plays
      // the throw: how fast the hand was moving over the last ~0.1 s
      let vx = 0, vz = 0;
      const s = c.samples, now = e.timeStamp || performance.now();
      if (s.length >= 2 && now - s[s.length - 1].t < 90) {
        const a = s[0], b = s[s.length - 1], dt = Math.max(0.016, (b.t - a.t) / 1000);
        vx = (b.x - a.x) / dt; vz = (b.z - a.z) / dt;
      }
      const sp = Math.hypot(vx, vz);
      // a flick on screen is fast on the ground: tone it down; a lob, higher when harder; a slow let-go just drops it
      const k = 0.6, f = Math.min(sp * k, 36);
      kitty.throwYarn(vx * k, vz * k, f < 2 ? 0 : 3 + f * 0.3);
      thrownOnce = true;
      hideYarnHint();
    };
    canvas.addEventListener('pointerup', letGo);
    canvas.addEventListener('pointercancel', letGo);
    canvas.addEventListener('lostpointercapture', letGo);
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
      const what = kitty.pick(r);
      if (what === 'kitty') { kitty.pet(); dismissHint(); return; }
      if (what === 'yarn') { kitty.play(); dismissHint(); return; }
      if (r.intersectPlane(groundPlane, hit) && Math.abs(hit.x) < PLATE.half - 4 && Math.abs(hit.z) < PLATE.half - 4) {
        kitty.call(hit.x, hit.z);
        dismissHint();
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    if (!coarse) {
      canvas.addEventListener('pointermove', (e) => {
        if (e.buttons || carry) return;
        const what = kitty.pick(rayAt(e.clientX, e.clientY));
        canvas.style.cursor = what === 'yarn' ? 'grab' : what ? 'pointer' : '';
      });
    }
  }

  // ------------------------------------------------------------ looking after her: buttons, name tag, rename
  const tag = $('nametag'), tagName = $('nametag-name'), tagHearts = $('nametag-hearts'), tagSr = $('nametag-sr');
  const careEl = $('care'), hungryBadge = $('care-hungry'), soundBtn = $('care-sound');
  const namer = $('namer'), namerInput = $('namer-input');
  const heartEls = Array.from({ length: 5 }, () => { const i = document.createElement('i'); tagHearts.append(i); return i; });
  let shownHearts = -1, shownHungry = null;
  function showName(n) { tagName.textContent = n; }
  function persist() {
    if (!kitty || !live) return;
    const b = kitty.brain;
    saveCare({ name: care.name, muted: care.muted, cat: care.cat, hunger: +b.hunger.toFixed(3), happy: +b.happy.toFixed(3), at: Date.now() });
  }
  if (kitty && (filmTag || (showUI && !demo))) {
    showName(filmTag || care.name);
    if (filmTag) tag.classList.add('is-filmed');
    tag.hidden = false;
  }
  if (kitty && showUI && !demo && !short) {
    careEl.hidden = false;
    root.classList.add('has-care');
    const act = (fn) => () => { audio?.unlock(); fn(); dismissHint(); };
    $('care-pet').addEventListener('click', act(() => kitty.pet()));
    $('care-feed').addEventListener('click', act(() => kitty.feed()));
    $('care-play').addEventListener('click', act(() => kitty.play()));
    const paintSound = () => {
      soundBtn.setAttribute('aria-pressed', String(!care.muted));
      soundBtn.setAttribute('aria-label', care.muted ? 'Sound off' : 'Sound on');
    };
    paintSound();
    soundBtn.addEventListener('click', () => {
      care.muted = !care.muted;
      audio?.unlock();
      audio?.setMuted(care.muted);
      paintSound();
      persist();
    });
    tag.addEventListener('click', () => {
      namerInput.value = care.name === 'Kitty' ? '' : care.name;
      namerInput.placeholder = 'Kitty';
      if (typeof namer.showModal === 'function') namer.showModal(); else namer.setAttribute('open', '');
      namerInput.focus();
    });
    $('namer-cancel').addEventListener('click', () => namer.close());
    $('namer-form').addEventListener('submit', () => {
      care.name = cleanName(namerInput.value) || 'Kitty';
      showName(care.name);
      persist();
      kitty.pet();                                        // she likes her new name
    });
    namer.addEventListener('click', (e) => { if (e.target === namer) namer.close(); });
    namer.addEventListener('close', () => tag.focus());

    // choosing the cat: the new one loads, then takes her place (same name, needs and spot)
    const picker = $('catpick'), catsEl = $('cats'), catStatus = $('cat-status'), catBtn = $('care-cat');
    const cards = Object.entries(CATS).map(([k, c]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-card';
      b.dataset.cat = k;
      const img = document.createElement('img');
      img.src = stamped(THUMB[k]); img.alt = ''; img.width = 480; img.height = 400; img.decoding = 'async';
      const name = document.createElement('span');
      name.textContent = c.label;
      b.append(img, name);
      catsEl.append(b);
      return b;
    });
    const paintCats = () => cards.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === care.cat)));
    paintCats();
    let switching = false;
    catBtn.addEventListener('click', () => {
      catStatus.textContent = '';
      if (typeof picker.showModal === 'function') picker.showModal(); else picker.setAttribute('open', '');
      (cards.find((b) => b.dataset.cat === care.cat) || cards[0]).focus();
    });
    catsEl.addEventListener('click', async (e) => {
      const card = e.target.closest('.cat-card');
      if (!card || switching) return;
      const k = card.dataset.cat;
      if (k === care.cat) { picker.close(); return; }
      switching = true;
      card.classList.add('is-loading');
      catsEl.setAttribute('aria-busy', 'true');
      catStatus.textContent = `Bringing the ${CATS[k].label.toLowerCase()} cat…`;
      try {
        await kitty.setCat(catOpts(k));
        care.cat = k;
        paintCats();
        persist();
        catStatus.textContent = '';
        picker.close();
        kitty.pet();                                      // hello, new cat
      } catch (err) {
        console.warn('Glikdev: that cat did not load', err);
        catStatus.textContent = 'That cat didn’t load. Check your connection and try again.';
      } finally {
        switching = false;
        card.classList.remove('is-loading');
        catsEl.removeAttribute('aria-busy');
      }
    });
    $('catpick-close').addEventListener('click', () => picker.close());
    picker.addEventListener('click', (e) => { if (e.target === picker) picker.close(); });
    picker.addEventListener('close', () => catBtn.focus());
    setInterval(persist, 4000);
    addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  }
  // every frame: the tag floats over her head; hearts and the hungry badge follow her needs
  const tagPos = new THREE.Vector3();
  function placeTag(t) {
    if (tag.hidden || !kitty) return;
    kitty.headPosition(tagPos);
    tagPos.y += 2.6;
    tagPos.project(camera);
    const vis = tagPos.z < 1 && Math.abs(tagPos.x) < 1.2 && Math.abs(tagPos.y) < 1.2;
    let s = 1;
    if (filmTag) s = t < filmTagAt ? 0 : Math.min(1, 1 + 2.7 * (Math.min(1, (t - filmTagAt) / 0.45) - 1) ** 3 + 1.7 * (Math.min(1, (t - filmTagAt) / 0.45) - 1) ** 2);
    tag.style.visibility = vis && s > 0.01 ? 'visible' : 'hidden';
    const x = (tagPos.x + 1) / 2 * innerWidth, y = (1 - tagPos.y) / 2 * innerHeight;
    tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(3)})`;
    const b = kitty.brain;
    const hearts = Math.max(1, Math.round(b.happy * 5));
    if (hearts !== shownHearts) {
      shownHearts = hearts;
      heartEls.forEach((el, k) => el.classList.toggle('off', k >= hearts));
    }
    const hungry = b.hunger > 0.7;
    if (hungry !== shownHungry) {
      shownHungry = hungry;
      hungryBadge.hidden = !hungry;
      tagSr.textContent = `, happiness ${hearts} of 5${hungry ? ', hungry' : ''}. Rename`;
    }
    if (!careEl.hidden) {
      $('care-feed').disabled = !!b.bowl;
      $('care-play').disabled = !!b.bowl;
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
    if (!hintEl.dataset.yarn) hintEl.classList.add('is-gone');
  }
  // the first time the yarn comes out: how to throw it (until you do, or for 9 s)
  let yarnHinted = false, yarnHintTimer = 0;
  function hideYarnHint() {
    clearTimeout(yarnHintTimer);
    if (!hintEl.dataset.yarn) return;
    delete hintEl.dataset.yarn;
    hintEl.classList.add('is-gone');
  }
  if (kitty && showUI && !demo && !short) {
    kitty.on((e) => {
      if (e.type !== 'yarn' || yarnHinted || thrownOnce) return;
      yarnHinted = true;
      setTimeout(() => {
        if (thrownOnce) return;
        hintEl.textContent = 'Drag the yarn ball and let go to throw it';
        hintEl.dataset.yarn = '1';
        hintEl.hidden = false;
        hintEl.classList.remove('is-gone');
        yarnHintTimer = setTimeout(hideYarnHint, 9000);
      }, 1100);
    });
  }

  // ------------------------------------------------------------ loop
  let t0 = null, last = null, external = false, skip = false;
  const interest = new THREE.Vector3();
  function step(t, dt) {
    let ks = 0;
    if (kitty) ks = demo ? kitty.simulateTo(t) : kitty.advance(dt, camera.position);
    if (kitty && !demo) {                                  // the camera keeps her (and what she is after) in the middle
      const k = 1 - Math.exp(-dt * 1.8), f = kitty.interest(interest);
      rig.target[0] += (f.x - rig.target[0]) * k;
      rig.target[2] += (f.z - rig.target[2]) * k;
    }
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
    if (kitty) { kitty.finish(camera.position, ks); placeTag(t); }
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
